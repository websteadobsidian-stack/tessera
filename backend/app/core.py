"""Состояние сессии, запись журнала и правила доски для четырёх методик.

Все изменения задач и вех идут через функции этого модуля: каждое изменение
пишется отдельным неизменяемым событием в research.event (раздел 08 концепции).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from tessera.model import MILESTONE_CLOSED, MILESTONE_DEADLINE_CHANGED, STAGES, START_ACTIVITY

from . import auth, content
from .db import json

BACKLOG = "Бэклог"
REASSIGNED = "Переназначена"
SPRINT_ADDED = "Добавлена в спринт"
SPRINT_REMOVED = "Убрана из спринта"
DECISION_MADE = "Решение принято"
PHASES = ["lobby", "entry", "briefing", "work", "pulse", "debrief", "exit", "closed"]


def now() -> datetime:
    return datetime.now(timezone.utc)


def fail(status: int, message: str):
    raise HTTPException(status, message)


# ---------------------------------------------------------------- сессия и участник

def latest_session(conn, team_id: str) -> dict:
    row = conn.execute(
        """SELECT s.team_id, s.session_id, s.condition, s.scenario_version, st.*
             FROM research.session s JOIN app.session_state st USING (team_id, session_id)
            WHERE s.team_id = %s
            ORDER BY substring(s.session_id from 3)::int DESC LIMIT 1""",
        (team_id,),
    ).fetchone()
    if row is None:
        fail(404, "У команды нет сессий")
    return row


def session_row(conn, team_id: str, session_id: str) -> dict:
    row = conn.execute(
        """SELECT s.team_id, s.session_id, s.condition, s.scenario_version, st.*
             FROM research.session s JOIN app.session_state st USING (team_id, session_id)
            WHERE s.team_id = %s AND s.session_id = %s""",
        (team_id, session_id),
    ).fetchone()
    if row is None:
        fail(404, "Сессия не найдена")
    return row


def current_sprint(session: dict, at: datetime | None = None) -> int:
    started = session.get("work_started_at")
    if not started:
        return 1
    elapsed = ((at or now()) - started).total_seconds() / 60
    return max(1, math.floor(elapsed / max(1, session["sprint_minutes"])) + 1)


@dataclass
class Ctx:
    """Кто действует и в какой сессии."""
    token: str
    team_id: str
    participant_id: str | None
    role_slug: str | None
    session: dict

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
    def is_pm(self) -> bool:
        return self.role_slug == "pm"

    @property
    def hierarchy(self) -> bool:
        return self.condition == "hierarchy"


def participant_ctx(conn, token: str, need_participant: bool = True) -> Ctx:
    dev = conn.execute("SELECT * FROM app.device WHERE token = %s", (token,)).fetchone()
    if dev is None:
        fail(401, "Код участника не найден — войдите по коду команды заново")
    if need_participant and dev["participant_id"] is None:
        fail(403, "Сначала нужно дать согласие на участие")
    return Ctx(token, dev["team_id"], dev["participant_id"], dev["role_slug"],
               latest_session(conn, dev["team_id"]))


# ---------------------------------------------------------------- журнал

def record(conn, ctx: Ctx, case_id: str, activity: str, milestone_id: str | None = None,
           attrs: dict | None = None) -> None:
    conn.execute(
        """INSERT INTO research.event (case_id, activity, ts, resource, role, department,
                                       team_id, session_id, milestone_id, attrs)
           SELECT %s, %s, clock_timestamp(), p.participant_id, p.role, p.department, %s, %s, %s, %s
             FROM research.participant p WHERE p.participant_id = %s""",
        (case_id, activity, ctx.team_id, ctx.session_id, milestone_id, json(attrs or {}),
         ctx.participant_id),
    )


# ---------------------------------------------------------------- команды и участники

def new_session(conn, team_id: str, condition: str, scenario_version: str) -> str:
    n = conn.execute("SELECT count(*) AS n FROM research.session WHERE team_id = %s", (team_id,)).fetchone()["n"]
    session_id = f"S-{n + 1}"
    conn.execute(
        """INSERT INTO research.session (team_id, session_id, condition, scenario_version)
           VALUES (%s, %s, %s, %s)""",
        (team_id, session_id, condition, scenario_version),
    )
    conn.execute("INSERT INTO app.session_state (team_id, session_id) VALUES (%s, %s)", (team_id, session_id))
    seed_session(conn, team_id, session_id, content.scenario(scenario_version))
    return session_id


def create_team(conn, condition: str, label: str, scenario_version: str) -> dict:
    conn.execute("SELECT pg_advisory_xact_lock(4243)")
    n = conn.execute("SELECT count(*) AS n FROM research.team").fetchone()["n"] + 1
    while conn.execute("SELECT 1 FROM research.team WHERE team_id = %s", (f"T-{n:02d}",)).fetchone():
        n += 1
    team_id = f"T-{n:02d}"
    conn.execute("INSERT INTO research.team (team_id) VALUES (%s)", (team_id,))
    code = auth.new_join_code()
    while conn.execute("SELECT 1 FROM app.team_settings WHERE join_code = %s", (code,)).fetchone():
        code = auth.new_join_code()
    conn.execute(
        """INSERT INTO app.team_settings (team_id, join_code, condition, scenario_version, label)
           VALUES (%s, %s, %s, %s, %s)""",
        (team_id, code, condition, scenario_version, label.strip()),
    )
    session_id = new_session(conn, team_id, condition, scenario_version)
    return {"team_id": team_id, "session_id": session_id, "join_code": code}


def create_participant(conn, team_id: str, role: dict, display_name: str | None,
                       device_token: str | None = None) -> str:
    """Участник появляется только в момент согласия. Имя — в отдельной схеме identity."""
    conn.execute("SELECT pg_advisory_xact_lock(4242)")
    n = conn.execute("SELECT count(*) AS n FROM research.participant").fetchone()["n"] + 1
    while conn.execute("SELECT 1 FROM research.participant WHERE participant_id = %s", (f"P-{n:03d}",)).fetchone():
        n += 1
    pid = f"P-{n:03d}"
    conn.execute(
        """INSERT INTO research.participant (participant_id, team_id, role, department, consent_at)
           VALUES (%s, %s, %s, %s, now())""",
        (pid, team_id, role["title"], role["department"]),
    )
    if display_name and display_name.strip():
        conn.execute("INSERT INTO identity.participant_map (participant_id, person) VALUES (%s, %s)",
                     (pid, display_name.strip()))
    if device_token is None:
        conn.execute("INSERT INTO app.device (token, team_id, participant_id, role_slug) VALUES (%s, %s, %s, %s)",
                     (auth.new_token(), team_id, pid, role["slug"]))
    else:
        conn.execute("UPDATE app.device SET participant_id = %s, role_slug = %s WHERE token = %s",
                     (pid, role["slug"], device_token))
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
        conn.execute(
            """UPDATE app.session_state SET work_started_at = now()
                WHERE team_id = %s AND session_id = %s""",
            (team_id, session_id),
        )
        conn.execute(
            """UPDATE app.milestone SET deadline = now() + make_interval(mins => offset_minutes)
                WHERE team_id = %s AND session_id = %s AND deadline IS NULL""",
            (team_id, session_id),
        )
        conn.execute("UPDATE research.session SET started_at = now() WHERE team_id = %s AND session_id = %s",
                     (team_id, session_id))
    if phase == "closed":
        conn.execute("UPDATE research.session SET ended_at = now() WHERE team_id = %s AND session_id = %s",
                     (team_id, session_id))


# ---------------------------------------------------------------- правила доски

def _task(conn, ctx: Ctx, key: str) -> dict:
    row = conn.execute(
        "SELECT * FROM app.task WHERE team_id = %s AND session_id = %s AND key = %s FOR UPDATE",
        (ctx.team_id, ctx.session_id, key),
    ).fetchone()
    if row is None:
        fail(404, "Задача не найдена")
    return row


def _require_work(ctx: Ctx) -> None:
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
        fail(409, f"Лимит незавершённой работы: в колонке «{stage}» уже {n} задачи. Помогите закончить их.")


def _can_touch(ctx: Ctx, task: dict) -> None:
    """В иерархии работать можно только со своими задачами (руководитель — с любыми)."""
    if ctx.hierarchy and not ctx.is_pm and task["assignee"] != ctx.participant_id:
        fail(403, "В иерархии работать можно только с задачами, которые назначил руководитель")


def _update(conn, task: dict, **fields) -> None:
    sets = ", ".join(f"{k} = %s" for k in fields)
    conn.execute(f"UPDATE app.task SET {sets}, updated_at = now() WHERE case_id = %s",
                 (*fields.values(), task["case_id"]))


def task_action(conn, ctx: Ctx, key: str, action: str, body: dict) -> None:
    _require_work(ctx)
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
                   {"old": task["assignee"], "new": ctx.participant_id})
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
        if to is not None:
            ok = conn.execute(
                "SELECT 1 FROM research.participant WHERE participant_id = %s AND team_id = %s",
                (to, ctx.team_id)).fetchone()
            if ok is None:
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


def _milestone(conn, ctx: Ctx, key: str) -> dict:
    row = conn.execute(
        "SELECT * FROM app.milestone WHERE team_id = %s AND session_id = %s AND key = %s FOR UPDATE",
        (ctx.team_id, ctx.session_id, key),
    ).fetchone()
    if row is None:
        fail(404, "Веха не найдена")
    return row


def close_milestone(conn, ctx: Ctx, key: str) -> None:
    _require_work(ctx)
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


def shift_deadline(conn, ctx: Ctx, key: str, minutes: int) -> None:
    _require_work(ctx)
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


# ---------------------------------------------------------------- решения и вбросы

def record_decision(conn, ctx: Ctx, body: dict) -> None:
    if ctx.session["phase"] not in ("work", "briefing"):
        fail(409, "Решения записываются в рабочей фазе")
    key_decision = bool(body.get("key_decision"))
    alternatives = [a.strip() for a in body.get("alternatives", []) if a and a.strip()]
    chosen = (body.get("chosen") or "").strip()
    title = (body.get("title") or "").strip()
    case_id = body.get("case_key")
    if key_decision:
        d = ctx.scenario["decision"]
        if ctx.hierarchy and not ctx.is_pm:
            fail(403, "В иерархии ключевое решение принимает руководитель")
        options = [o["id"] for o in d["options"]]
        if chosen not in options:
            fail(422, "Выберите один из вариантов")
        title, alternatives = d["title"], options
        case_id = f"{ctx.team_id}/{ctx.session_id}/DECISION-{d['key']}"
    else:
        if not title or not chosen:
            fail(422, "Нужно указать, что решали и что выбрали")
        case_id = f"{ctx.team_id}/{ctx.session_id}/{case_id}" if case_id else None
    proposed_by = body.get("proposed_by") or ctx.participant_id
    ok = conn.execute("SELECT 1 FROM research.participant WHERE participant_id = %s AND team_id = %s",
                      (proposed_by, ctx.team_id)).fetchone()
    if ok is None:
        fail(422, "Автор предложения должен быть участником команды")
    conn.execute(
        """INSERT INTO research.decision (team_id, session_id, case_id, proposed_by, alternatives,
                                          chosen, rationale, decided_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, now())""",
        (ctx.team_id, ctx.session_id, case_id, proposed_by, json(alternatives), chosen,
         (body.get("rationale") or "").strip() or None),
    )
    if key_decision:
        record(conn, ctx, case_id, DECISION_MADE, None, {"chosen": chosen, "proposed_by": proposed_by})


def fire_inject(conn, session: dict, key: str) -> None:
    sc = content.scenario(session["scenario_version"])
    inj = next((i for i in sc["injects"] if i["key"] == key), None)
    if inj is None:
        fail(404, "Вброс не найден в сценарии")
    team_id, session_id = session["team_id"], session["session_id"]
    inject_id = conn.execute(
        """INSERT INTO research.inject (team_id, session_id, kind, ts, payload)
           VALUES (%s, %s, %s, now(), %s) RETURNING inject_id""",
        (team_id, session_id, key, json({"title": inj["title"], "phase": session["phase"]})),
    ).fetchone()["inject_id"]
    for n in inj.get("notices", []):
        conn.execute(
            """INSERT INTO app.notice (team_id, session_id, inject_id, roles, title, body)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (team_id, session_id, inject_id, n.get("roles"), n["title"], n.get("body", "")),
        )
    pos = conn.execute("SELECT coalesce(max(position), 0) AS p FROM app.task WHERE team_id = %s AND session_id = %s",
                       (team_id, session_id)).fetchone()["p"]
    for i, t in enumerate(inj.get("add_tasks", []), start=1):
        insert_task(conn, team_id, session_id, t, pos + i, inject_id)
