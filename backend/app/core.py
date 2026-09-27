"""Состояние сессии, участники, запись журнала и правила доски для четырёх методик.

Все изменения задач и вех идут через функции этого модуля: каждое изменение
пишется отдельным неизменяемым событием в research.event (раздел 08 концепции).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from tessera.model import MILESTONE_CLOSED, MILESTONE_DEADLINE_CHANGED, STAGES, START_ACTIVITY

from . import auth, content, db
from .db import json

BACKLOG = "Бэклог"
REASSIGNED = "Переназначена"
SPRINT_ADDED = "Добавлена в спринт"
SPRINT_REMOVED = "Убрана из спринта"
DECISION_MADE = "Решение принято"
PHASES = ["lobby", "entry", "briefing", "work", "pulse", "debrief", "retro", "exit", "closed"]
MAX_COLOR_SLOTS = 8


def now() -> datetime:
    return datetime.now(timezone.utc)


def fail(status: int, message: str):
    raise HTTPException(status, message)


def touch(conn, team_id: str, what: str = "state") -> None:
    db.notify(conn, team_id, what)


# ---------------------------------------------------------------- сессия

_SESSION_SQL = """
SELECT s.team_id, s.session_id, s.condition, s.scenario_version, s.protocol, s.started_at, s.ended_at,
       st.phase, st.phase_changed_at, st.work_started_at, st.work_minutes, st.wip_limit, st.sprint_minutes,
       st.time_scale, st.silence_until, st.mechanics,
       ts.is_demo, ts.demo_kind, ts.bot_speed, ts.label, ts.join_code, ts.protocol_id
  FROM research.session s
  JOIN app.session_state st USING (team_id, session_id)
  JOIN app.team_settings ts USING (team_id)
"""


def latest_session(conn, team_id: str) -> dict:
    row = conn.execute(
        _SESSION_SQL + " WHERE s.team_id = %s ORDER BY substring(s.session_id from 3)::int DESC LIMIT 1",
        (team_id,),
    ).fetchone()
    if row is None:
        fail(404, "У команды нет сессий")
    return row


def session_row(conn, team_id: str, session_id: str) -> dict:
    row = conn.execute(_SESSION_SQL + " WHERE s.team_id = %s AND s.session_id = %s", (team_id, session_id)).fetchone()
    if row is None:
        fail(404, "Сессия не найдена")
    return row


def current_sprint(session: dict, at: datetime | None = None) -> int:
    started = session.get("work_started_at")
    if not started:
        return 1
    elapsed = ((at or now()) - started).total_seconds() / 60
    return max(1, math.floor(elapsed / max(1, session["sprint_minutes"])) + 1)


def work_minute(session: dict, at: datetime | None = None) -> float | None:
    """Минута рабочей фазы (реальная). None — работа ещё не начиналась."""
    started = session.get("work_started_at")
    if not started:
        return None
    return ((at or now()) - started).total_seconds() / 60


def silence_active(session: dict, at: datetime | None = None) -> bool:
    until = session.get("silence_until")
    return bool(until and until > (at or now()))


# ---------------------------------------------------------------- контекст участника

@dataclass
class Ctx:
    """Кто действует и в какой сессии."""
    token: str
    team_id: str
    participant_id: str | None
    role_slug: str | None
    session: dict
    device: dict = field(default_factory=dict)

    @property
    def session_id(self) -> str:
        return self.session["session_id"]

    @property
    def condition(self) -> str:
        return self.session["condition"]

    @property
    def scenario(self) -> dict:
        return content.scenario(self.session["scenario_version"])

    @property
    def mech(self) -> dict[str, bool]:
        return content.mechanics(self.session.get("mechanics"))

    @property
    def is_pm(self) -> bool:
        return self.role_slug == "pm"

    @property
    def hierarchy(self) -> bool:
        return self.condition == "hierarchy"

    @property
    def away_until(self) -> datetime | None:
        until = self.device.get("away_until")
        return until if until and until > now() else None

    @property
    def role(self) -> dict | None:
        return content.role(self.scenario, self.role_slug)


def _ctx_from_device(conn, dev: dict, token: str) -> Ctx:
    return Ctx(token, dev["team_id"], dev["participant_id"], dev["role_slug"],
               latest_session(conn, dev["team_id"]), dev)


def participant_ctx(conn, token: str, need_participant: bool = True) -> Ctx:
    dev = conn.execute("SELECT * FROM app.device WHERE token = %s", (token,)).fetchone()
    if dev is None:
        fail(401, "Код участника не найден — войдите по коду команды заново")
    if need_participant and dev["participant_id"] is None:
        fail(403, "Сначала нужно дать согласие на участие")
    return _ctx_from_device(conn, dev, token)


def ctx_for(conn, participant_id: str) -> Ctx:
    """Контекст от имени участника (боты, фоновые задачи)."""
    dev = conn.execute("SELECT * FROM app.device WHERE participant_id = %s", (participant_id,)).fetchone()
    if dev is None:
        fail(404, "Участник не найден")
    return _ctx_from_device(conn, dev, dev["token"])


def seen(conn, token: str) -> None:
    conn.execute(
        """UPDATE app.device SET last_seen_at = now()
            WHERE token = %s AND (last_seen_at IS NULL OR last_seen_at < now() - interval '15 seconds')""",
        (token,),
    )


def require_mechanic(ctx: Ctx, key: str) -> None:
    if not ctx.mech.get(key):
        title = next((m["title"] for m in content.MECHANICS if m["key"] == key), key)
        fail(403, f"Механика «{title}» выключена в протоколе этой сессии")


def require_present(ctx: Ctx) -> None:
    if ctx.away_until:
        mins = max(1, math.ceil((ctx.away_until - now()).total_seconds() / 60))
        fail(409, f"Вы на выезде у клиента — вернётесь через {mins} мин")


# ---------------------------------------------------------------- журнал

def record(conn, ctx: Ctx, case_id: str, activity: str, milestone_id: str | None = None,
           attrs: dict | None = None) -> None:
    role = ctx.role or {}
    conn.execute(
        """INSERT INTO research.event (case_id, activity, ts, resource, role, department,
                                       team_id, session_id, milestone_id, attrs)
           VALUES (%s, %s, clock_timestamp(), %s, %s, %s, %s, %s, %s, %s)""",
        (case_id, activity, ctx.participant_id, role.get("title"), role.get("department"),
         ctx.team_id, ctx.session_id, milestone_id, json(attrs or {})),
    )


# ---------------------------------------------------------------- протоколы, команды, участники

def get_protocol(conn, protocol_id: str) -> dict:
    row = conn.execute("SELECT * FROM app.protocol WHERE protocol_id = %s", (protocol_id,)).fetchone()
    if row is None:
        fail(422, "Протокол не найден")
    return row


def new_session(conn, team_id: str) -> str:
    t = conn.execute("SELECT * FROM app.team_settings WHERE team_id = %s", (team_id,)).fetchone()
    protocol = get_protocol(conn, t["protocol_id"] or "standard")
    cfg = protocol["config"]
    scale = float(cfg.get("time_scale", 1) or 1)
    n = conn.execute("SELECT count(*) AS n FROM research.session WHERE team_id = %s", (team_id,)).fetchone()["n"]
    session_id = f"S-{n + 1}"
    snapshot = {"protocol_id": protocol["protocol_id"], "title": protocol["title"], **cfg}
    conn.execute(
        """INSERT INTO research.session (team_id, session_id, condition, scenario_version, protocol)
           VALUES (%s, %s, %s, %s, %s)""",
        (team_id, session_id, t["condition"], t["scenario_version"], json(snapshot)),
    )
    conn.execute(
        """INSERT INTO app.session_state (team_id, session_id, work_minutes, wip_limit, sprint_minutes,
                                          time_scale, mechanics)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        (team_id, session_id, max(1, round(cfg.get("work_minutes", 50) * scale)), cfg.get("wip_limit", 3),
         max(1, round(cfg.get("sprint_minutes", 15) * scale)), scale, json(content.mechanics(cfg.get("mechanics")))),
    )
    seed_session(conn, team_id, session_id, content.scenario(t["scenario_version"]))
    for item in cfg.get("timeline", []):
        payload = {k: v for k, v in item.items() if k not in ("minute", "kind")}
        if "minutes" in payload:
            payload["minutes"] = round(float(payload["minutes"]) * scale, 2)
        conn.execute(
            "INSERT INTO app.schedule (team_id, session_id, minute, kind, payload) VALUES (%s, %s, %s, %s, %s)",
            (team_id, session_id, float(item["minute"]) * scale, item["kind"], json(payload)),
        )
    return session_id


def create_team(conn, condition: str, label: str, scenario_version: str, protocol_id: str = "standard", *,
                is_demo: bool = False, demo_kind: str | None = None, bot_speed: float = 1.0) -> dict:
    get_protocol(conn, protocol_id)
    conn.execute("SELECT pg_advisory_xact_lock(4243)")
    prefix = "DT" if is_demo else "T"
    n = conn.execute("SELECT count(*) AS n FROM research.team WHERE team_id LIKE %s",
                     (f"{prefix}-%",)).fetchone()["n"] + 1
    while conn.execute("SELECT 1 FROM research.team WHERE team_id = %s", (f"{prefix}-{n:02d}",)).fetchone():
        n += 1
    team_id = f"{prefix}-{n:02d}"
    conn.execute("INSERT INTO research.team (team_id, is_demo) VALUES (%s, %s)", (team_id, is_demo))
    code = auth.new_join_code()
    while conn.execute("SELECT 1 FROM app.team_settings WHERE join_code = %s", (code,)).fetchone():
        code = auth.new_join_code()
    conn.execute(
        """INSERT INTO app.team_settings (team_id, join_code, condition, scenario_version, label, protocol_id,
                                          is_demo, demo_kind, bot_speed)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (team_id, code, condition, scenario_version, label.strip(), protocol_id, is_demo, demo_kind, bot_speed),
    )
    session_id = new_session(conn, team_id)
    return {"team_id": team_id, "session_id": session_id, "join_code": code}


def _color_slot(conn, team_id: str, role: dict) -> int:
    used = {r["color_slot"] for r in conn.execute(
        "SELECT color_slot FROM app.device WHERE team_id = %s AND participant_id IS NOT NULL", (team_id,))}
    for slot in [*role.get("colors", []), *range(1, MAX_COLOR_SLOTS + 1)]:
        if slot not in used:
            return slot
    return 1


def create_participant(conn, team_id: str, role: dict, display_name: str | None,
                       device_token: str | None = None, *, is_bot: bool = False) -> str:
    """Участник появляется только в момент согласия. Имя — в отдельной схеме identity."""
    conn.execute("SELECT pg_advisory_xact_lock(4242)")
    demo = conn.execute("SELECT is_demo FROM research.team WHERE team_id = %s", (team_id,)).fetchone()["is_demo"]
    prefix = "DP" if demo else "P"
    n = conn.execute("SELECT count(*) AS n FROM research.participant WHERE participant_id LIKE %s",
                     (f"{prefix}-%",)).fetchone()["n"] + 1
    while conn.execute("SELECT 1 FROM research.participant WHERE participant_id = %s", (f"{prefix}-{n:03d}",)).fetchone():
        n += 1
    pid = f"{prefix}-{n:03d}"
    conn.execute(
        """INSERT INTO research.participant (participant_id, team_id, role, department, consent_at)
           VALUES (%s, %s, %s, %s, now())""",
        (pid, team_id, role["title"], role["department"]),
    )
    if display_name and display_name.strip():
        conn.execute("INSERT INTO identity.participant_map (participant_id, person) VALUES (%s, %s)",
                     (pid, display_name.strip()[:40]))
    slot = _color_slot(conn, team_id, role)
    if device_token is None:
        conn.execute(
            """INSERT INTO app.device (token, team_id, participant_id, role_slug, color_slot, is_bot)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (auth.new_token(), team_id, pid, role["slug"], slot, is_bot))
    else:
        conn.execute("UPDATE app.device SET participant_id = %s, role_slug = %s, color_slot = %s WHERE token = %s",
                     (pid, role["slug"], slot, device_token))
    touch(conn, team_id)
    return pid


# ---------------------------------------------------------------- снимок компании

def seed_session(conn, team_id: str, session_id: str, scenario: dict) -> None:
    """Каждая сессия стартует из «чистого» снимка сценария."""
    prefix = f"{team_id}/{session_id}"
    for m in scenario["milestones"]:
        conn.execute(
            """INSERT INTO app.milestone (milestone_id, team_id, session_id, key, title, offset_minutes)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (f"{prefix}/{m['key']}", team_id, session_id, m["key"], m["title"], m["offset_minutes"]),
        )
    for pos, t in enumerate(scenario["tasks"]):
        insert_task(conn, team_id, session_id, t, pos)


def insert_task(conn, team_id: str, session_id: str, t: dict, position: int,
                inject_id: int | None = None) -> bool:
    prefix = f"{team_id}/{session_id}"
    cur = conn.execute(
        """INSERT INTO app.task (case_id, team_id, session_id, key, title, description, project,
                                 priority, milestone_id, position, inject_id)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (case_id) DO NOTHING""",
        (f"{prefix}/{t['key']}", team_id, session_id, t["key"], t["title"], t.get("description", ""),
         t.get("project", ""), t.get("priority", "normal"),
         f"{prefix}/{t['milestone']}" if t.get("milestone") else None, position, inject_id),
    )
    return cur.rowcount == 1


def set_phase(conn, session: dict, phase: str) -> None:
    if phase not in PHASES:
        fail(422, "Неизвестная фаза")
    team_id, session_id = session["team_id"], session["session_id"]
    conn.execute(
        """UPDATE app.session_state SET phase = %s, phase_changed_at = now()
            WHERE team_id = %s AND session_id = %s""",
        (phase, team_id, session_id),
    )
    if phase == "work" and session["work_started_at"] is None:
        conn.execute("UPDATE app.session_state SET work_started_at = now() WHERE team_id = %s AND session_id = %s",
                     (team_id, session_id))
        conn.execute(
            """UPDATE app.milestone
                  SET deadline = now() + make_interval(secs => offset_minutes * %s * 60)
                WHERE team_id = %s AND session_id = %s AND deadline IS NULL""",
            (float(session["time_scale"]), team_id, session_id),
        )
        conn.execute("UPDATE research.session SET started_at = now() WHERE team_id = %s AND session_id = %s",
                     (team_id, session_id))
    if phase == "closed":
        conn.execute("UPDATE research.session SET ended_at = now() WHERE team_id = %s AND session_id = %s",
                     (team_id, session_id))
    touch(conn, team_id, "phase")


# ---------------------------------------------------------------- правила доски

def _task(conn, ctx: Ctx, key: str) -> dict:
    row = conn.execute(
        "SELECT * FROM app.task WHERE team_id = %s AND session_id = %s AND key = %s FOR UPDATE",
        (ctx.team_id, ctx.session_id, key),
    ).fetchone()
    if row is None:
        fail(404, "Задача не найдена")
    return row


def require_work(ctx: Ctx) -> None:
    if ctx.session["phase"] != "work":
        fail(409, "Доска доступна только в рабочей фазе")


def _check_wip(conn, ctx: Ctx, stage: str) -> None:
    if ctx.condition != "kanban" or stage == STAGES[-1]:
        return
    n = conn.execute(
        "SELECT count(*) AS n FROM app.task WHERE team_id = %s AND session_id = %s AND stage = %s",
        (ctx.team_id, ctx.session_id, stage),
    ).fetchone()["n"]
    if n >= ctx.session["wip_limit"]:
        fail(409, f"Лимит незавершённой работы: в колонке «{stage}» уже {n}. Помогите закончить то, что там есть.")


def _can_touch(ctx: Ctx, task: dict) -> None:
    """В иерархии работать можно только со своими задачами (руководитель — с любыми)."""
    if ctx.hierarchy and not ctx.is_pm and task["assignee"] != ctx.participant_id:
        fail(403, "В иерархии работать можно только с задачами, которые назначил руководитель")


def _update(conn, task: dict, **fields) -> None:
    sets = ", ".join(f"{k} = %s" for k in fields)
    conn.execute(f"UPDATE app.task SET {sets}, updated_at = now() WHERE case_id = %s",
                 (*fields.values(), task["case_id"]))


def _in_team(conn, ctx: Ctx, pid: str) -> bool:
    return conn.execute("SELECT 1 FROM research.participant WHERE participant_id = %s AND team_id = %s",
                        (pid, ctx.team_id)).fetchone() is not None


def task_action(conn, ctx: Ctx, key: str, action: str, body: dict) -> None:
    require_work(ctx)
    require_present(ctx)
    task = _task(conn, ctx, key)
    stage = task["stage"]
    ms = task["milestone_id"]

    if action == "pull":
        if stage != BACKLOG:
            fail(409, "Задача уже в работе")
        if ctx.hierarchy and not ctx.is_pm:
            fail(403, "В иерархии задачи из бэклога берёт руководитель")
        if ctx.condition == "sprints" and (task["sprint"] is None or task["sprint"] > current_sprint(ctx.session)):
            fail(409, "Сначала добавьте задачу в текущий спринт")
        _check_wip(conn, ctx, STAGES[0])
        _update(conn, task, stage=STAGES[0], started=False,
                assignee=task["assignee"] if ctx.hierarchy else None)
        record(conn, ctx, task["case_id"], STAGES[0], ms, {"old": BACKLOG, "new": STAGES[0]})

    elif action == "start":
        if stage not in STAGES[:-1]:
            fail(409, "Эту задачу нельзя взять в работу")
        if task["started"]:
            fail(409, "Задача уже в работе")
        _can_touch(ctx, task)
        if task["assignee"] and task["assignee"] != ctx.participant_id:
            if ctx.hierarchy:
                fail(403, "Задача назначена другому участнику")
            record(conn, ctx, task["case_id"], REASSIGNED, ms,
                   {"old": task["assignee"], "new": ctx.participant_id, "takeover": True})
        _update(conn, task, assignee=ctx.participant_id, started=True)
        record(conn, ctx, task["case_id"], START_ACTIVITY, ms)

    elif action == "advance":
        if stage not in STAGES[:-1]:
            fail(409, "Задача уже сдана")
        if not task["started"]:
            fail(409, "Сначала возьмите задачу в работу")
        if task["assignee"] != ctx.participant_id and not (ctx.hierarchy and ctx.is_pm):
            fail(403, "Передать дальше может только исполнитель задачи")
        nxt = STAGES[STAGES.index(stage) + 1]
        _check_wip(conn, ctx, nxt)
        _update(conn, task, stage=nxt, started=False, assignee=None)
        record(conn, ctx, task["case_id"], nxt, ms, {"old": stage, "new": nxt})
        # Задача продвинулась — просьбы о помощи по ней закрываются сами.
        conn.execute(
            """UPDATE research.help_request SET resolved_at = clock_timestamp()
                WHERE team_id = %s AND session_id = %s AND case_id = %s AND resolved_at IS NULL""",
            (ctx.team_id, ctx.session_id, task["case_id"]),
        )

    elif action == "return":
        if stage not in STAGES[1:-1]:
            fail(409, "Вернуть на доработку можно с проектирования, исполнения или контроля")
        target = body.get("to") or STAGES[STAGES.index(stage) - 1]
        if target not in STAGES or STAGES.index(target) >= STAGES.index(stage):
            fail(422, "Вернуть можно только на один из предыдущих этапов")
        if task["assignee"] and task["assignee"] != ctx.participant_id and not (ctx.hierarchy and ctx.is_pm):
            fail(403, "Вернуть задачу может её исполнитель")
        _can_touch(ctx, task)
        _update(conn, task, stage=target, started=False, assignee=None)
        record(conn, ctx, task["case_id"], target, ms, {"old": stage, "new": target, "rework": True})

    elif action == "assign":
        if stage == STAGES[-1]:
            fail(409, "Задача уже сдана")
        if ctx.hierarchy and not ctx.is_pm:
            fail(403, "В иерархии задачи назначает руководитель")
        to = body.get("assignee") or None
        if to is not None and not _in_team(conn, ctx, to):
            fail(422, "Такого участника нет в команде")
        if to == task["assignee"]:
            return
        _update(conn, task, assignee=to, started=False)
        record(conn, ctx, task["case_id"], REASSIGNED, ms, {"old": task["assignee"], "new": to})

    elif action == "sprint":
        if ctx.condition != "sprints":
            fail(409, "Спринты используются только в условии «Спринты»")
        if stage != BACKLOG:
            fail(409, "Планировать в спринт можно задачи из бэклога")
        add = bool(body.get("add", True))
        sprint = current_sprint(ctx.session)
        if add == (task["sprint"] is not None):
            return
        _update(conn, task, sprint=sprint if add else None)
        record(conn, ctx, task["case_id"], SPRINT_ADDED if add else SPRINT_REMOVED, ms, {"sprint": sprint})

    else:
        fail(404, "Неизвестное действие")
    touch(conn, ctx.team_id)


def _milestone(conn, ctx: Ctx, key: str) -> dict:
    row = conn.execute(
        "SELECT * FROM app.milestone WHERE team_id = %s AND session_id = %s AND key = %s FOR UPDATE",
        (ctx.team_id, ctx.session_id, key),
    ).fetchone()
    if row is None:
        fail(404, "Веха не найдена")
    return row


def close_milestone(conn, ctx: Ctx, key: str) -> None:
    require_work(ctx)
    require_present(ctx)
    m = _milestone(conn, ctx, key)
    if m["closed_at"]:
        fail(409, "Веха уже закрыта")
    if ctx.hierarchy and not ctx.is_pm:
        fail(403, "В иерархии вехи закрывает руководитель")
    open_tasks = conn.execute(
        "SELECT count(*) AS n FROM app.task WHERE milestone_id = %s AND stage <> %s",
        (m["milestone_id"], STAGES[-1]),
    ).fetchone()["n"]
    if open_tasks:
        fail(409, f"Не все задачи вехи сданы: осталось {open_tasks}")
    conn.execute("UPDATE app.milestone SET closed_at = now() WHERE milestone_id = %s", (m["milestone_id"],))
    record(conn, ctx, m["milestone_id"], MILESTONE_CLOSED, m["milestone_id"],
           {"deadline": m["deadline"].isoformat() if m["deadline"] else None})
    touch(conn, ctx.team_id)


def shift_deadline(conn, ctx: Ctx, key: str, minutes: int) -> None:
    require_work(ctx)
    m = _milestone(conn, ctx, key)
    if m["closed_at"]:
        fail(409, "Веха уже закрыта")
    if m["deadline"] is None:
        fail(409, "Срок ещё не назначен")
    if ctx.hierarchy and not ctx.is_pm:
        fail(403, "В иерархии сроки переносит руководитель")
    if not -60 <= minutes <= 60 or minutes == 0:
        fail(422, "Сдвиг срока — от −60 до +60 минут")
    new = m["deadline"] + timedelta(minutes=minutes)
    conn.execute("UPDATE app.milestone SET deadline = %s WHERE milestone_id = %s", (new, m["milestone_id"]))
    record(conn, ctx, m["milestone_id"], MILESTONE_DEADLINE_CHANGED, m["milestone_id"],
           {"old": m["deadline"].isoformat(), "new": new.isoformat()})
    touch(conn, ctx.team_id)


# ---------------------------------------------------------------- решения

def key_decision_case(ctx: Ctx) -> str:
    return f"{ctx.team_id}/{ctx.session_id}/DECISION-{ctx.scenario['decision']['key']}"


def commit_key_decision(conn, ctx: Ctx, chosen: str, proposed_by: str | None, rationale: str | None,
                        via: str = "log") -> None:
    d = ctx.scenario["decision"]
    options = [o["id"] for o in d["options"]]
    if chosen not in options:
        fail(422, "Выберите один из вариантов")
    if ctx.hierarchy and not ctx.is_pm:
        fail(403, "В иерархии ключевое решение принимает руководитель")
    proposed_by = proposed_by or ctx.participant_id
    if not _in_team(conn, ctx, proposed_by):
        fail(422, "Автор предложения должен быть участником команды")
    case_id = key_decision_case(ctx)
    conn.execute(
        """INSERT INTO research.decision (team_id, session_id, case_id, title, proposed_by, alternatives,
                                          chosen, rationale, decided_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now())""",
        (ctx.team_id, ctx.session_id, case_id, d["title"], proposed_by, json(options), chosen,
         (rationale or "").strip()[:2000] or None),
    )
    record(conn, ctx, case_id, DECISION_MADE, None, {"chosen": chosen, "proposed_by": proposed_by, "via": via})
    touch(conn, ctx.team_id)


def record_decision(conn, ctx: Ctx, body: dict) -> None:
    if ctx.session["phase"] not in ("work", "briefing"):
        fail(409, "Решения записываются в рабочей фазе")
    if body.get("key_decision"):
        if ctx.mech.get("vote"):
            fail(409, "Ключевое решение принимается голосованием на общем столе")
        commit_key_decision(conn, ctx, (body.get("chosen") or "").strip(), body.get("proposed_by"),
                            body.get("rationale"))
        return
    alternatives = [a.strip() for a in body.get("alternatives", []) if a and a.strip()]
    chosen = (body.get("chosen") or "").strip()
    title = (body.get("title") or "").strip()
    if not title or not chosen:
        fail(422, "Нужно указать, что решали и что выбрали")
    case_key = body.get("case_key")
    case_id = f"{ctx.team_id}/{ctx.session_id}/{case_key}" if case_key else None
    proposed_by = body.get("proposed_by") or ctx.participant_id
    if not _in_team(conn, ctx, proposed_by):
        fail(422, "Автор предложения должен быть участником команды")
    conn.execute(
        """INSERT INTO research.decision (team_id, session_id, case_id, title, proposed_by, alternatives,
                                          chosen, rationale, decided_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now())""",
        (ctx.team_id, ctx.session_id, case_id, title[:200], proposed_by, json(alternatives), chosen[:300],
         (body.get("rationale") or "").strip()[:2000] or None),
    )
    touch(conn, ctx.team_id)
