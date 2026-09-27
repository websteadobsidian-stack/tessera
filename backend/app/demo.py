"""Демо-режим.

* Песочница: одна команда, где человек играет одну роль, а остальных ведут боты. Её можно
  смотреть глазами любого участника и управлять ею как ведущий (токен с доступом к одной команде).
* История: сгенерированные завершённые сессии по всем методикам и протоколам — чтобы увидеть
  разборы и страницу «Исследование» до первого реального интенсива.

Демо-команды помечены (research.team.is_demo), исключаются из исследования и выгрузок по умолчанию
и удаляются целиком (research.purge_demo_team). Различия методик в истории заданы вручную —
это иллюстрация, а не результат.

CLI: python -m app.demo [--teams 2] [--purge]"""

from __future__ import annotations

import argparse
import random
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from tessera.model import MILESTONE_CLOSED, MILESTONE_DEADLINE_CHANGED, STAGES, START_ACTIVITY

from . import auth, bots, content, core, db, mechanics
from .core import BACKLOG, DECISION_MADE, REASSIGNED
from .db import json

NAMES = ["Аня", "Борис", "Вика", "Гоша", "Дина", "Егор", "Женя", "Зоя", "Илья", "Катя", "Лёва", "Маша",
         "Нина", "Олег", "Поля", "Рома", "Света", "Тимур", "Уля", "Федя", "Юра", "Яна", "Артём", "Соня",
         "Даня", "Лиза", "Миша", "Ева", "Паша", "Алиса"]
ROLE_ORDER = ["pm", "analyst", "finance", "engineer", "engineer", "qa"]
CONDITIONS = ["kanban", "sprints", "hierarchy", "self_org"]


# ================================================================ песочница

def create_sandbox(conn, role_slug: str, condition: str | None, name: str | None, rng: random.Random) -> dict:
    version = content.default_scenario()
    sc = content.scenario(version)
    if content.role(sc, role_slug) is None:
        core.fail(422, "Нет такой роли")
    condition = condition if condition in CONDITIONS else rng.choice(CONDITIONS)
    title = sc["conditions"][condition]["title"]
    team = core.create_team(conn, condition, f"Демо-песочница · {title}", version, "demo",
                            is_demo=True, demo_kind="sandbox", bot_speed=1.0)
    names = rng.sample(NAMES, len(ROLE_ORDER))
    human = None
    for i, slug in enumerate(ROLE_ORDER):
        is_human = human is None and slug == role_slug
        pid = core.create_participant(conn, team["team_id"], content.role(sc, slug),
                                      (name or "Вы") if is_human else names[i], is_bot=not is_human)
        if is_human:
            human = pid
    bots.create_bots(conn, team["team_id"], rng, human=human)
    token = conn.execute("SELECT token FROM app.device WHERE participant_id = %s", (human,)).fetchone()["token"]
    facilitator = auth.new_token()
    conn.execute(
        "INSERT INTO app.admin_token (token, team_scope, expires_at) VALUES (%s, %s, now() + interval '24 hours')",
        (facilitator, team["team_id"]),
    )
    return {**team, "participant_token": token, "facilitator_token": facilitator, "participant_id": human}


def possess(conn, team_id: str, participant_id: str) -> str:
    """Смотреть глазами другого участника: он переходит под управление человека, остальные — под ботов."""
    row = conn.execute("SELECT token FROM app.device WHERE team_id = %s AND participant_id = %s",
                       (team_id, participant_id)).fetchone()
    if row is None:
        core.fail(404, "Нет такого участника")
    conn.execute(
        """UPDATE app.bot SET paused = (participant_id = %s), next_action_at = now() + interval '2 seconds'
            WHERE participant_id IN (SELECT participant_id FROM app.device WHERE team_id = %s)""",
        (participant_id, team_id),
    )
    conn.execute("UPDATE app.device SET is_bot = (participant_id <> %s) WHERE team_id = %s AND participant_id IS NOT NULL",
                 (participant_id, team_id))
    core.touch(conn, team_id)
    return row["token"]


def purge(conn, kind: str | None = None) -> int:
    teams = conn.execute(
        "SELECT team_id FROM app.team_settings WHERE is_demo AND (%s::text IS NULL OR demo_kind = %s)",
        (kind, kind)).fetchall()
    for t in teams:
        conn.execute("SELECT research.purge_demo_team(%s)", (t["team_id"],))
    return len(teams)


# ================================================================ история

# Параметры условий подобраны вручную, чтобы разборы и страница «Исследование» выглядели живыми.
PARAMS = {
    "kanban": dict(wait=1.0, rework=0.16, pull_every=2.6, share=0.78, help=0.9, chat=1.0, safety=5.35, align=0.62, smart=0.85, negotiate=0.5),
    "sprints": dict(wait=1.7, rework=0.20, pull_every=2.6, share=0.72, help=0.8, chat=0.9, safety=5.05, align=0.58, smart=0.6, negotiate=0.55),
    "hierarchy": dict(wait=2.6, rework=0.24, pull_every=2.2, share=0.42, help=0.5, chat=0.6, safety=4.35, align=0.5, smart=0.35, negotiate=0.7),
    "self_org": dict(wait=2.0, rework=0.28, pull_every=2.3, share=0.9, help=1.0, chat=1.3, safety=5.2, align=0.52, smart=0.75, negotiate=0.45),
}
STAGE_WORKERS = {
    "Анализ": {"analyst": 4, "pm": 2, "finance": 2},
    "Проектирование": {"analyst": 2, "pm": 2, "finance": 1, "engineer": 3},
    "Исполнение": {"engineer": 6, "finance": 1, "analyst": 1},
    "Контроль": {"qa": 5, "pm": 2},
}


class Sim:
    """Одна завершённая сессия с синтетическими метками времени."""

    def __init__(self, conn, rng: random.Random, team_id: str, session_id: str, start: datetime):
        self.conn, self.rng = conn, rng
        self.team_id, self.session_id = team_id, session_id
        self.session = core.session_row(conn, team_id, session_id)
        self.sc = content.scenario(self.session["scenario_version"])
        self.cfg = self.session["protocol"]
        self.mech = content.mechanics(self.session["mechanics"])
        self.cond = self.session["condition"]
        self.p = dict(PARAMS[self.cond])
        pid = self.cfg.get("protocol_id")
        if pid == "nudges":
            self.p["wait"] *= 0.8
        self.start = start
        self.end = start + timedelta(minutes=self.session["work_minutes"])
        self.people = conn.execute(
            """SELECT d.participant_id, d.role_slug, coalesce(m.person, p.role) AS name
                 FROM app.device d JOIN research.participant p USING (participant_id)
                 LEFT JOIN identity.participant_map m USING (participant_id)
                WHERE d.team_id = %s AND d.participant_id IS NOT NULL ORDER BY d.participant_id""",
            (team_id,)).fetchall()
        self.by_role: dict[str, list[dict]] = defaultdict(list)
        for x in self.people:
            self.by_role[x["role_slug"]].append(x)
        self.pm = self.by_role["pm"][0]
        self.safety = rng.gauss(self.p["safety"], 0.4)
        self.p["rework"] = max(0.04, self.p["rework"] - 0.07 * (self.safety - 5))
        self.share_times: dict[str, datetime] = {}
        self.events_count = 0
        self.away: tuple[str, datetime, datetime] | None = None
        self.silence: tuple[datetime, datetime] | None = None

    # ---------------------------------------------------------------- вставки
    def at(self, minute: float) -> datetime:
        return self.start + timedelta(minutes=minute)

    def minute(self, ts: datetime) -> float:
        return (ts - self.start).total_seconds() / 60

    def ev(self, case: str, activity: str, ts: datetime, person: dict, milestone: str | None = None, **attrs) -> None:
        role = content.role(self.sc, person["role_slug"]) or {}
        self.conn.execute(
            """INSERT INTO research.event (case_id, activity, ts, resource, role, department, team_id, session_id,
                                           milestone_id, attrs, recorded_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (case, activity, ts.replace(microsecond=0), person["participant_id"], role.get("title"),
             role.get("department"), self.team_id, self.session_id, milestone, json(attrs), ts),
        )
        self.events_count += 1

    def survey(self, person: dict, phase: str, instrument: str, item: str, value=None, text=None, ts=None) -> None:
        self.conn.execute(
            """INSERT INTO research.survey_response (participant_id, team_id, session_id, phase, instrument, item,
                                                     value, text_value, answered_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
            (person["participant_id"], self.team_id, self.session_id, phase, instrument, item, value, text,
             ts or self.start),
        )

    def say(self, person: dict, text: str, ts: datetime, mention: dict | None = None, case_key: str | None = None) -> None:
        if not self.mech["chat"]:
            return
        silent = bool(self.silence and self.silence[0] <= ts <= self.silence[1])
        mid = self.conn.execute(
            """INSERT INTO research.message (team_id, session_id, participant_id, mentions, length, case_key,
                                             during_silence, sent_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING message_id""",
            (self.team_id, self.session_id, person["participant_id"], [mention["participant_id"]] if mention else [],
             len(text), case_key, silent, ts),
        ).fetchone()["message_id"]
        body = (f"@{mention['name']} " if mention else "") + text
        self.conn.execute("INSERT INTO app.message_body (message_id, body) VALUES (%s, %s)", (mid, body))

    def lik(self, center: float, lo: int = 1, hi: int = 7) -> int:
        return int(max(lo, min(hi, round(self.rng.gauss(center, 0.9)))))

    # ---------------------------------------------------------------- сценарий сессии
    def run(self) -> None:
        conn = self.conn
        conn.execute(
            """UPDATE app.session_state SET phase = 'closed', phase_changed_at = %s, work_started_at = %s
                WHERE team_id = %s AND session_id = %s""",
            (self.end + timedelta(minutes=45), self.start, self.team_id, self.session_id))
        conn.execute("UPDATE research.session SET started_at = %s, ended_at = %s WHERE team_id = %s AND session_id = %s",
                     (self.start - timedelta(minutes=25), self.end + timedelta(minutes=45), self.team_id, self.session_id))
        conn.execute("""UPDATE app.milestone SET deadline = %s::timestamptz + make_interval(mins => offset_minutes)
                         WHERE team_id = %s AND session_id = %s""", (self.start, self.team_id, self.session_id))
        conn.execute("UPDATE app.schedule SET fired_at = %s::timestamptz + make_interval(secs => minute * 60) WHERE team_id = %s AND session_id = %s",
                     (self.start, self.team_id, self.session_id))
        self.briefing()
        self.interventions()
        self.facts_and_decision()
        self.process()
        self.social()
        self.probes()
        self.surveys()
        self.retro()
        self.achievements()

    def briefing(self) -> None:
        before = self.start - timedelta(minutes=8)
        for x in self.people:
            if self.mech["preference"]:
                own = content.role(self.sc, x["role_slug"]) or {}
                n_key = sum(1 for f in own.get("facts", []) if f.get("key"))
                p_c = min(0.7, 0.18 + 0.09 * n_key)
                opt = "C" if self.rng.random() < p_c else ("A" if self.rng.random() < 0.75 else "B")
                self.conn.execute(
                    """INSERT INTO research.preference (participant_id, team_id, session_id, stage, option, confidence, answered_at)
                       VALUES (%s, %s, %s, 'pre', %s, %s, %s)""",
                    (x["participant_id"], self.team_id, self.session_id, opt, self.rng.randint(2, 5), before))
            if self.mech["check"]:
                for q in mechanics.check_spec(self.sc, self.cond):
                    ans = q["correct"] if self.rng.random() < 0.85 else self.rng.choice(q["options"])["id"]
                    self.survey(x, "briefing", "check", q["id"], text=ans, ts=before)
            if self.mech["forecast"]:
                self.survey(x, "briefing", "forecast", "tasks_done", value=self.rng.randint(5, 10), ts=before)
                self.survey(x, "briefing", "forecast", "m1_on_time", value=float(self.rng.random() < 0.6), ts=before)
                self.survey(x, "briefing", "forecast", "confidence", value=self.rng.randint(2, 5), ts=before)
            if self.mech["weather"]:
                self.conn.execute("INSERT INTO research.mood (team_id, session_id, participant_id, value, set_at) VALUES (%s, %s, %s, %s, %s)",
                                  (self.team_id, self.session_id, x["participant_id"], self.rng.choice([3, 4, 4]), before))
        if self.mech["charter"]:
            for f in self.sc.get("charter", []):
                if f.get("optional") and self.rng.random() < 0.5:
                    continue
                who = self.rng.choice(self.people)
                self.conn.execute(
                    """INSERT INTO research.charter (team_id, session_id, field, body, participant_id, updated_at)
                       VALUES (%s, %s, %s, %s, %s, %s)""",
                    (self.team_id, self.session_id, f["id"], bots.PHRASES["charter"].get(f["id"], "Работаем вместе"),
                     who["participant_id"], before))

    def interventions(self) -> None:
        """Вбросы и эксперименты — по таймлайну протокола сессии."""
        for item in self.cfg.get("timeline", []):
            ts = self.at(item["minute"])
            kind = item["kind"]
            if kind == "inject":
                inj = next(i for i in self.sc["injects"] if i["key"] == item["key"])
                iid = self.conn.execute(
                    """INSERT INTO research.inject (team_id, session_id, kind, ts, payload)
                       VALUES (%s, %s, %s, %s, %s) RETURNING inject_id""",
                    (self.team_id, self.session_id, inj["key"], ts, json({"title": inj["title"], "source": "schedule"})),
                ).fetchone()["inject_id"]
                for n in inj["notices"]:
                    self.conn.execute(
                        """INSERT INTO app.notice (team_id, session_id, inject_id, roles, title, body, kind, created_at)
                           VALUES (%s, %s, %s, %s, %s, %s, 'inject', %s)""",
                        (self.team_id, self.session_id, iid, n.get("roles"), n["title"], n.get("body", ""), ts))
                for t in inj.get("add_tasks", []):
                    core.insert_task(self.conn, self.team_id, self.session_id, t, 90, iid)
            elif kind == "silence":
                end = ts + timedelta(minutes=item.get("minutes", 4))
                self.silence = (ts, end)
                self.conn.execute(
                    """INSERT INTO research.intervention (team_id, session_id, kind, payload, source, started_at, ends_at)
                       VALUES (%s, %s, 'silence', %s, 'schedule', %s, %s)""",
                    (self.team_id, self.session_id, json({"minutes": item.get("minutes", 4)}), ts, end))
            elif kind == "blind_spot":
                # Кто «самый занятой», станет ясно после моделирования процесса — сначала отметим время.
                self.away_plan = (ts, ts + timedelta(minutes=item.get("minutes", 5)))

    def facts_and_decision(self) -> None:
        if self.mech["facts"]:
            for x in self.people:
                own = content.role(self.sc, x["role_slug"]) or {}
                for f in own.get("facts", []):
                    if f["id"] in self.share_times:
                        continue
                    p = self.p["share"] + 0.08 * (self.safety - 5) + (0.1 if f.get("key") else 0)
                    if self.rng.random() < p:
                        ts = self.at(self.rng.uniform(1.5, 30))
                        self.share_times[f["id"]] = ts
                        self.conn.execute(
                            """INSERT INTO research.fact_share (team_id, session_id, fact_id, participant_id, shared_at)
                               VALUES (%s, %s, %s, %s, %s)""",
                            (self.team_id, self.session_id, f["id"], x["participant_id"], ts))
        keys = {fid for fid, f in content.all_facts(self.sc).items() if f.get("key")}

        def frac(ts: datetime) -> float:
            return sum(1 for k in keys if k in self.share_times and self.share_times[k] <= ts) / max(1, len(keys))

        decide_at = self.at(self.rng.uniform(20, 33))
        votes: dict[str, str] = {}
        if self.mech["vote"]:
            for x in self.people:
                for vt in sorted(self.rng.uniform(8, self.minute(decide_at) - 0.5) for _ in range(self.rng.randint(1, 2))):
                    ts = self.at(vt)
                    opt = "C" if self.rng.random() < 0.15 + 0.85 * frac(ts) else ("A" if self.rng.random() < 0.7 else "B")
                    votes[x["participant_id"]] = opt
                    self.conn.execute(
                        """INSERT INTO research.vote_log (participant_id, team_id, session_id, option, voted_at)
                           VALUES (%s, %s, %s, %s, %s)""",
                        (x["participant_id"], self.team_id, self.session_id, opt, ts))
            if self.cond == "hierarchy":
                chosen = votes.get(self.pm["participant_id"], "A")
                proposer = self.pm
            else:
                ranked = Counter(votes.values()).most_common()
                chosen = ranked[0][0] if ranked else "A"
                proposer = next((x for x in self.people if votes.get(x["participant_id"]) == chosen), self.pm)
        else:
            chosen = "C" if self.rng.random() < 0.2 + 0.8 * frac(decide_at) else "A"
            proposer = self.pm if self.cond == "hierarchy" else self.rng.choice(self.people)
        case = f"{self.team_id}/{self.session_id}/DECISION-{self.sc['decision']['key']}"
        self.conn.execute(
            """INSERT INTO research.decision (team_id, session_id, case_id, title, proposed_by, alternatives, chosen,
                                              rationale, decided_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (self.team_id, self.session_id, case, self.sc["decision"]["title"], proposer["participant_id"],
             json(["A", "B", "C"]), chosen,
             "Сложили факты аналитика, финансиста и исполнителя" if chosen == "C" else "Самое популярное решение на рынке",
             decide_at))
        self.ev(case, DECISION_MADE, decide_at, self.pm if self.cond == "hierarchy" else proposer, None,
                chosen=chosen, proposed_by=proposer["participant_id"], via="vote")
        self.decision = (chosen, decide_at)

    def pick(self, stage: str, free: dict | None = None, ts: datetime | None = None) -> dict:
        weights = STAGE_WORKERS[stage]
        pool = [x for x in self.people if x["role_slug"] in weights]
        # Команда с общим потоком чаще отдаёт задачу тому, кто раньше освободится; иерархия — реже.
        if free is not None and ts is not None and self.rng.random() < self.p["smart"]:
            return min(pool, key=lambda x: (max(free[x["participant_id"]], ts) - ts).total_seconds() / weights[x["role_slug"]])
        return self.rng.choices(pool, [weights[x["role_slug"]] for x in pool])[0]

    def process(self) -> None:
        conn, rng = self.conn, self.rng
        free = {x["participant_id"]: self.start for x in self.people}
        tasks = conn.execute("SELECT * FROM app.task WHERE team_id = %s AND session_id = %s ORDER BY position",
                             (self.team_id, self.session_id)).fetchall()
        release = self.at(rng.uniform(0.5, 1.5))
        inject_at = min((self.at(i["minute"]) for i in self.cfg.get("timeline", [])
                         if i["kind"] == "inject" and i["key"] == "urgent_order"), default=self.at(18))
        away_plan = getattr(self, "away_plan", None)
        if away_plan:
            load = Counter()
        done_at: dict[str, datetime] = {}
        for t in tasks:
            case, ms = t["case_id"], t["milestone_id"]
            ready = max(release, inject_at + timedelta(minutes=1)) if t["inject_id"] else release
            if not t["inject_id"]:
                release += timedelta(minutes=rng.uniform(0.6, 1.4) * self.p["pull_every"])
            stage, prev, ts, mover = "Анализ", BACKLOG, ready, self.pm if self.cond == "hierarchy" else self.pick("Анализ")
            final, assignee, started = None, None, False
            while ts < self.end:
                attrs = {"old": prev, "new": stage}
                if prev in STAGES and STAGES.index(prev) > STAGES.index(stage):
                    attrs["rework"] = True
                self.ev(case, stage, ts, mover, ms, **attrs)
                final, assignee, started = stage, None, False
                if stage == STAGES[-1]:
                    done_at[case] = ts
                    break
                worker = self.pick(stage, free, ts)
                if self.cond == "hierarchy":
                    self.ev(case, REASSIGNED, ts + timedelta(seconds=rng.uniform(5, 40)), self.pm, ms,
                            old=None, new=worker["participant_id"])
                begin = max(ts, free[worker["participant_id"]]) + timedelta(minutes=rng.expovariate(1 / (self.p["wait"] * 0.75)))
                if away_plan and away_plan[0] <= begin <= away_plan[1] and load and worker["participant_id"] == load.most_common(1)[0][0]:
                    # Выезд: задачу подхватывает другой участник.
                    other = rng.choice([x for x in self.people if x is not worker])
                    self.ev(case, REASSIGNED, begin, other, ms, old=worker["participant_id"], new=other["participant_id"], takeover=True)
                    worker = other
                if begin >= self.end:
                    break
                self.ev(case, START_ACTIVITY, begin, worker, ms)
                if away_plan:
                    load[worker["participant_id"]] += 1
                assignee, started = worker["participant_id"], True
                finish = begin + timedelta(minutes=rng.uniform(0.9, 2.3))
                free[worker["participant_id"]] = finish
                if finish >= self.end:
                    break
                prev, ts, mover = stage, finish, worker
                if stage == "Контроль" and rng.random() < self.p["rework"]:
                    stage = "Исполнение"
                elif stage == "Проектирование" and rng.random() < self.p["rework"] / 3:
                    stage = "Анализ"
                else:
                    stage = STAGES[STAGES.index(stage) + 1]
            if final:
                conn.execute("UPDATE app.task SET stage = %s, assignee = %s, started = %s WHERE case_id = %s",
                             (final, assignee, started, case))
        self.done_at = done_at
        if away_plan and load:
            pid = load.most_common(1)[0][0]
            conn.execute(
                """INSERT INTO research.intervention (team_id, session_id, kind, payload, source, started_at, ends_at)
                   VALUES (%s, %s, 'blind_spot', %s, 'schedule', %s, %s)""",
                (self.team_id, self.session_id, json({"participant_id": pid, "minutes": 5}), away_plan[0], away_plan[1]))
        # Вехи.
        for m in conn.execute("SELECT * FROM app.milestone WHERE team_id = %s AND session_id = %s",
                              (self.team_id, self.session_id)).fetchall():
            cases = [r["case_id"] for r in conn.execute("SELECT case_id FROM app.task WHERE milestone_id = %s", (m["milestone_id"],))]
            if cases and all(c in done_at for c in cases):
                closed = max(done_at[c] for c in cases) + timedelta(minutes=rng.uniform(0.3, 1.5))
                deadline = m["deadline"]
                # Не успевают — руководитель договаривается с клиентом о переносе (не всегда удачно).
                if closed > deadline and rng.random() < self.p["negotiate"]:
                    new = deadline + timedelta(minutes=rng.choice([5, 5, 10]))
                    at = deadline - timedelta(minutes=rng.uniform(1, 4))
                    conn.execute("UPDATE app.milestone SET deadline = %s WHERE milestone_id = %s", (new, m["milestone_id"]))
                    self.ev(m["milestone_id"], MILESTONE_DEADLINE_CHANGED, at, self.pm, m["milestone_id"],
                            old=deadline.isoformat(), new=new.isoformat())
                    m["deadline"] = new
                if closed < self.end:
                    conn.execute("UPDATE app.milestone SET closed_at = %s WHERE milestone_id = %s", (closed, m["milestone_id"]))
                    self.ev(m["milestone_id"], MILESTONE_CLOSED, closed, self.pm, m["milestone_id"],
                            deadline=m["deadline"].isoformat())

    def social(self) -> None:
        conn, rng = self.conn, self.rng
        protocol = self.cfg.get("protocol_id")
        # Помощь: чем выше безопасность, тем чаще просят и быстрее откликаются.
        helps = []
        if self.mech["help"]:
            n = max(0, round(rng.gauss(1.6 * self.p["help"] * max(0.3, (self.safety - 3.2) / 1.8), 0.8)))
            for _ in range(n):
                asker = rng.choice(self.people)
                ts = self.at(rng.uniform(4, 45))
                answered = rng.random() < (0.95 if protocol == "nudges" else 0.82)
                helper = rng.choice([x for x in self.people if x is not asker]) if answered else None
                latency = rng.expovariate(1 / (0.7 if protocol == "nudges" else 1.3))
                helped = ts + timedelta(minutes=latency) if helper else None
                resolved = (helped or ts) + timedelta(minutes=rng.uniform(1, 3))
                conn.execute(
                    """INSERT INTO research.help_request (team_id, session_id, participant_id, note, created_at,
                                                          helper_id, helped_at, resolved_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                    (self.team_id, self.session_id, asker["participant_id"], None, ts,
                     helper["participant_id"] if helper else None, helped, resolved))
                self.say(asker, rng.choice(["Нужна помощь, застрял(а)", "Кто может помочь со сметой?", "Не понимаю схему интеграции"]), ts)
                if helper:
                    self.say(helper, rng.choice(bots.PHRASES["help_answer"]), helped, mention=asker)
                    helps.append((helper, asker, resolved))
        # Благодарности.
        if self.mech["kudos"]:
            factor = 0.6 if protocol == "feedback_off" else 1.0
            for helper, asker, ts in helps:
                if rng.random() < 0.8 * factor:
                    self._kudos(asker, helper, "help", ts + timedelta(seconds=rng.uniform(10, 60)))
            for _ in range(round(len(self.people) * rng.uniform(0.7, 1.5) * factor)):
                a, b = rng.sample(self.people, 2)
                self._kudos(a, b, rng.choice([k["id"] for k in self.sc["kudos"]]), self.at(rng.uniform(5, 49)))
        # Погода после вбросов проседает и потом восстанавливается.
        if self.mech["weather"]:
            for x in self.people:
                for minute, val in ((rng.uniform(19, 23), rng.choice([2, 3, 3])), (rng.uniform(36, 40), rng.choice([2, 3])),
                                    (rng.uniform(44, 49), rng.choice([3, 4]))):
                    if rng.random() < 0.7:
                        conn.execute("INSERT INTO research.mood (team_id, session_id, participant_id, value, set_at) VALUES (%s, %s, %s, %s, %s)",
                                     (self.team_id, self.session_id, x["participant_id"], val, self.at(minute)))
        # Эфир.
        if self.mech["chat"]:
            chatty = {x["participant_id"]: rng.uniform(0.3, 1.5) for x in self.people}
            for _ in range(round(22 * self.p["chat"])):
                x = rng.choices(self.people, [chatty[p["participant_id"]] for p in self.people])[0]
                other = rng.choice([p for p in self.people if p is not x]) if rng.random() < 0.3 else None
                minute = rng.uniform(1, 49)
                if self.silence and rng.random() < 0.3:
                    minute = self.minute(self.silence[0]) + rng.uniform(0, 3.5)
                phrase = rng.choice(bots.PHRASES["chatter"]).format(stage=rng.choice(STAGES[:-1]))
                self.say(x, phrase, self.at(minute), mention=other)

    def _kudos(self, a: dict, b: dict, kind: str, ts: datetime) -> None:
        self.conn.execute(
            """INSERT INTO research.kudos (team_id, session_id, from_participant, to_participant, kind, note, sent_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (self.team_id, self.session_id, a["participant_id"], b["participant_id"], kind,
             self.rng.choice(bots.PHRASES["kudos_note"]) if self.rng.random() < 0.3 else None, ts))

    def probes(self) -> None:
        if not self.mech["probes"]:
            return
        rng = self.rng
        for item in self.cfg.get("timeline", []):
            if item["kind"] != "probe":
                continue
            spec = next(p for p in self.sc["probes"] if p["key"] == item["key"])
            ts = self.at(item["minute"])
            if spec["options"] == "open_tasks":
                options = [{"id": t["key"], "title": f"{t['key']} · {t['title']}"} for t in self.sc["tasks"][:5]]
                truth = None
            elif spec["options"] == "stages":
                options = [{"id": s, "title": s} for s in STAGES[:-1]] + [{"id": "none", "title": "Затора нет"}]
                truth = "Контроль" if self.cond != "kanban" else rng.choice(["Контроль", "Исполнение"])
            elif spec["options"] == "roster":
                options = [{"id": x["participant_id"], "title": x["name"]} for x in self.people] + [{"id": "none", "title": "Никто конкретно"}]
                truth = None
            elif spec["options"] == "weather":
                options = [{"id": str(w["value"]), "title": w["title"]} for w in self.sc["weather"]]
                truth = "3"
            else:
                options, truth = spec["options"], spec.get("truth")
            pid = self.conn.execute(
                """INSERT INTO research.probe (team_id, session_id, kind, question, options, truth, source, fired_at, closes_at)
                   VALUES (%s, %s, %s, %s, %s, %s, 'schedule', %s, %s) RETURNING probe_id""",
                (self.team_id, self.session_id, spec["key"], spec["question"], json(options), truth, ts,
                 ts + timedelta(seconds=45))).fetchone()["probe_id"]
            ids = [o["id"] for o in options]
            modal = truth if truth in ids else rng.choice(ids[:3])
            align = self.p["align"] + 0.07 * (self.safety - 5)
            for x in self.people:
                if spec["key"] == "budget":
                    knows = x["role_slug"] == "finance" or ("finance.1" in self.share_times and self.share_times["finance.1"] <= ts)
                    ans = "4.5" if knows else rng.choice(["3", "7", "?", "?"])
                else:
                    ans = modal if rng.random() < align else rng.choice(ids)
                self.conn.execute(
                    "INSERT INTO research.probe_answer (probe_id, participant_id, answer, answered_at) VALUES (%s, %s, %s, %s)",
                    (pid, x["participant_id"], ans, ts + timedelta(seconds=rng.uniform(5, 40))))

    def surveys(self) -> None:
        rng, s = self.rng, self.safety
        instruments = content.surveys()["instruments"]
        pulse_at = self.end + timedelta(minutes=2)
        exit_at = self.end + timedelta(minutes=40)
        tlx = 50 + (5 - s) * 12 + (6 if self.cond == "hierarchy" else 0)
        for x in self.people:
            for i in instruments["psych_safety_7"]["items"]:
                v = self.lik(s - 0.25)
                self.survey(x, "entry", "psych_safety_7", i["id"], value=(8 - v) if i.get("reverse") else v,
                            ts=self.start - timedelta(minutes=20))
                v = self.lik(s + 0.25)
                self.survey(x, "exit", "psych_safety_7", i["id"], value=(8 - v) if i.get("reverse") else v, ts=exit_at)
            self.survey(x, "entry", "goal_clarity", "1", value=self.lik(4.8), ts=self.start - timedelta(minutes=20))
            self.survey(x, "pulse", "wellbeing", "1", value=self.lik(s), ts=pulse_at)
            for i in instruments["nasa_tlx_raw"]["items"]:
                self.survey(x, "pulse", "nasa_tlx_raw", i["id"], value=max(0, min(100, 5 * round(rng.gauss(tlx, 12) / 5))), ts=pulse_at)
            self.survey(x, "pulse", "goal_clarity", "1", value=self.lik(5.4), ts=pulse_at)
            self.survey(x, "pulse", "self_contribution", "1", value=self.lik(5), ts=pulse_at)
            if self.mech["vote"] or self.mech["facts"]:
                self.survey(x, "pulse", "decision_confidence", "1",
                            value=self.lik(4.2 if self.decision[0] == "C" else 3.2, 1, 5), ts=pulse_at)
            if self.mech["mirror"]:
                self.survey(x, "pulse", "mirror", "team_stress", value=max(0, min(100, 5 * round(rng.gauss(tlx, 18) / 5))), ts=pulse_at)
                self.survey(x, "pulse", "mirror", "most_loaded", text=rng.choice(self.people)["participant_id"], ts=pulse_at)
            self.survey(x, "exit", "team_satisfaction", "1", value=self.lik(s), ts=exit_at)
            self.survey(x, "exit", "reflection", "learned", text=rng.choice([
                "Нужно раньше делиться тем, что знаешь только ты.",
                "Контроль стал узким местом — стоило помогать контролёру.",
                "Договорились о правилах слишком поздно.",
                "Лимиты на незавершённую работу реально помогают.",
                "Просить помощи — нормально, это ускоряет всех.",
            ]), ts=exit_at)
        # Оценки коллег: неформальный лидер — самый центральный участник (в иерархии чаще руководитель).
        starts = Counter(r["resource"] for r in self.conn.execute(
            "SELECT resource FROM research.event WHERE team_id = %s AND session_id = %s AND activity = %s",
            (self.team_id, self.session_id, START_ACTIVITY)))
        central = starts.most_common(1)[0][0] if starts else self.pm["participant_id"]
        leader_default = self.pm["participant_id"] if self.cond == "hierarchy" else central
        strengths = [st["id"] for st in self.sc["strengths"]]
        for x in self.people:
            others = [p for p in self.people if p is not x]
            leader = leader_default if rng.random() < 0.7 else rng.choice(others)["participant_id"]
            noms = {"actual_leader": [leader] if leader != x["participant_id"] else [rng.choice(others)["participant_id"]],
                    "most_useful": [p["participant_id"] for p in rng.sample(others, k=min(2, len(others)))],
                    "asked_for_info": [p["participant_id"] for p in rng.sample(others, k=min(rng.randint(1, 3), len(others)))]}
            for q, targets in noms.items():
                for t in targets:
                    self.conn.execute(
                        """INSERT INTO research.peer_nomination (from_participant, to_participant, team_id, session_id, question)
                           VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                        (x["participant_id"], t, self.team_id, self.session_id, q))
            if self.mech["strengths"]:
                for o in others:
                    self.conn.execute(
                        """INSERT INTO research.strength (from_participant, to_participant, team_id, session_id, strength)
                           VALUES (%s, %s, %s, %s, %s)""",
                        (x["participant_id"], o["participant_id"], self.team_id, self.session_id, rng.choice(strengths)))

    def retro(self) -> None:
        if not self.mech["retro"]:
            return
        rng = self.rng
        ts = self.end + timedelta(minutes=25)
        cards = []
        for x in self.people:
            for _ in range(rng.randint(1, 2)):
                lane = rng.choice(["start", "stop", "continue"])
                cid = self.conn.execute(
                    """INSERT INTO research.retro_card (team_id, session_id, participant_id, lane, body, created_at)
                       VALUES (%s, %s, %s, %s, %s, %s) RETURNING card_id""",
                    (self.team_id, self.session_id, x["participant_id"], lane, rng.choice(bots.PHRASES["retro"][lane]), ts),
                ).fetchone()["card_id"]
                cards.append(cid)
        for x in self.people:
            for cid in set(rng.sample(cards, k=min(3, len(cards)))):
                self.conn.execute("INSERT INTO research.retro_vote (card_id, participant_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                                  (cid, x["participant_id"]))
        mechanics.make_agreements(self.conn, self.team_id, self.session_id)
        # Проверка договорённостей прошлой сессии.
        for a in mechanics.previous_agreements(self.conn, self.team_id, self.session_id):
            for x in self.people:
                self.conn.execute(
                    """INSERT INTO research.agreement_check (agreement_id, participant_id, session_id, score, answered_at)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (a["agreement_id"], x["participant_id"], self.session_id, self.lik(3.8, 1, 5), ts))

    def achievements(self) -> None:
        if not self.mech["achievements"]:
            return
        got: dict[str, datetime] = {}
        if self.done_at:
            got["first_done"] = min(self.done_at.values())
        total = self.conn.execute("SELECT count(*) AS n FROM app.task WHERE team_id = %s AND session_id = %s",
                                  (self.team_id, self.session_id)).fetchone()["n"]
        if len(self.done_at) == total:
            got["all_done"] = max(self.done_at.values())
        keys = {fid for fid, f in content.all_facts(self.sc).items() if f.get("key")}
        if keys <= set(self.share_times):
            got["all_facts"] = max(self.share_times[k] for k in keys)
        if self.decision[0] == self.sc["decision"]["correct"]:
            got["best_decision"] = self.decision[1]
        for m in self.conn.execute("SELECT * FROM app.milestone WHERE team_id = %s AND session_id = %s AND closed_at IS NOT NULL",
                                   (self.team_id, self.session_id)):
            if m["closed_at"] <= m["deadline"]:
                got.setdefault("milestone_on_time", m["closed_at"])
        for key, ts in got.items():
            self.conn.execute("INSERT INTO research.achievement (team_id, session_id, key, unlocked_at) VALUES (%s, %s, %s, %s)",
                              (self.team_id, self.session_id, key, ts))


def seed_history(conn, per_condition: int = 2, rng: random.Random | None = None) -> list[str]:
    """Завершённые демо-сессии: по `per_condition` команды на методику, разные протоколы.
    У первой команды каждой методики — две сессии, чтобы были видны договорённости ретро."""
    rng = rng or random.Random(7)
    version = content.default_scenario()
    sc = content.scenario(version)
    protocols = ["standard", "feedback_off", "nudges"]
    names = iter(rng.sample(NAMES, len(NAMES)) * 20)
    base = datetime.now(timezone.utc) - timedelta(days=per_condition * 8 + 3)
    created = []
    k = 0
    for i in range(per_condition):
        for condition in CONDITIONS:
            protocol = protocols[(i + CONDITIONS.index(condition)) % len(protocols)]
            title = sc["conditions"][condition]["title"]
            team = core.create_team(conn, condition, f"Демо · {title} · группа {i + 1}", version, protocol,
                                    is_demo=True, demo_kind="history")
            for slug in ROLE_ORDER:
                core.create_participant(conn, team["team_id"], content.role(sc, slug), next(names), is_bot=True)
            start = base + timedelta(days=k * 2, hours=rng.randint(9, 15))
            Sim(conn, rng, team["team_id"], team["session_id"], start).run()
            if i == 0:
                s2 = core.new_session(conn, team["team_id"])
                Sim(conn, rng, team["team_id"], s2, start + timedelta(days=7)).run()
            created.append(team["team_id"])
            k += 1
    return created


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--teams", type=int, default=2, help="команд на каждую методику")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--purge", action="store_true", help="удалить все демо-данные")
    a = ap.parse_args()
    db.open_pool()
    db.migrate()
    with db.tx() as conn:
        if a.purge:
            print(f"Удалено демо-команд: {purge(conn)}")
        else:
            teams = seed_history(conn, a.teams, random.Random(a.seed))
            print(f"Создано демо-команд: {len(teams)}. Откройте пульт ведущего → Исследование.")
    db.close_pool()


if __name__ == "__main__":
    main()

