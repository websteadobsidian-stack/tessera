"""Демо-данные для показа платформы: python -m app.demo

ТОЛЬКО для отдельной демо-базы. Журнал событий неизменяем, поэтому демо-команды нельзя
удалить из базы, не пересоздав её. Скрипт откажется работать, если в базе уже есть
настоящие (не демо) команды.

Процесс моделируется упрощённо: очереди к исполнителям, ожидание, доработки на контроле.
Различия между методиками заданы вручную — это иллюстрация, а не результат исследования.
"""

from __future__ import annotations

import argparse
import random
import sys
from datetime import datetime, timedelta, timezone

from tessera.model import MILESTONE_CLOSED, STAGES, START_ACTIVITY

from . import content, core, db
from .db import json

LABEL = "ДЕМО"
NAMES = ["Аня", "Борис", "Вика", "Гоша", "Дина", "Егор", "Женя", "Зоя", "Илья", "Катя", "Лёва", "Маша",
         "Нина", "Олег", "Поля", "Рома", "Света", "Тимур", "Уля", "Федя", "Хава", "Юра", "Яна", "Артём"]
ROLES = ["pm", "analyst", "finance", "engineer", "engineer", "qa"]
STAGE_WORKERS = {  # кто обычно берёт этап (роль → вес)
    "Анализ": {"analyst": 4, "pm": 2, "finance": 2},
    "Проектирование": {"analyst": 2, "pm": 2, "finance": 1, "engineer": 3},
    "Исполнение": {"engineer": 6, "finance": 1, "analyst": 1},
    "Контроль": {"qa": 5, "pm": 2},
}
PARAMS = {  # ожидание, мин · вероятность доработки · интервал запуска задач, мин · шанс верного решения
    "kanban": dict(wait=1.0, rework=0.18, pull_every=3.5, correct=0.7, safety=5.3, tlx=52),
    "sprints": dict(wait=1.8, rework=0.22, pull_every=2.5, correct=0.6, safety=5.0, tlx=58),
    "hierarchy": dict(wait=2.8, rework=0.28, pull_every=2.0, correct=0.35, safety=4.3, tlx=63),
    "self_org": dict(wait=2.2, rework=0.32, pull_every=2.2, correct=0.55, safety=5.1, tlx=60),
}


def _ev(conn, team_id, session_id, case_id, activity, ts, person, milestone_id=None, attrs=None):
    conn.execute(
        """INSERT INTO research.event (case_id, activity, ts, resource, role, department, team_id, session_id,
                                       milestone_id, attrs)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (case_id, activity, ts, person["pid"], person["role"]["title"], person["role"]["department"],
         team_id, session_id, milestone_id, json(attrs or {})),
    )


def simulate_session(conn, rng: random.Random, team: dict, condition: str, people: list[dict], start: datetime):
    sc = content.scenario(content.default_scenario())
    p = PARAMS[condition]
    team_id, session_id = team["team_id"], team["session_id"]
    prefix = f"{team_id}/{session_id}"
    end = start + timedelta(minutes=50)
    pm = next(x for x in people if x["role"]["slug"] == "pm")
    free_at = {x["pid"]: start for x in people}

    conn.execute(
        """UPDATE app.session_state SET phase = 'closed', phase_changed_at = %s, work_started_at = %s
            WHERE team_id = %s AND session_id = %s""", (end + timedelta(minutes=30), start, team_id, session_id))
    conn.execute("UPDATE research.session SET started_at = %s, ended_at = %s WHERE team_id = %s AND session_id = %s",
                 (start, end + timedelta(minutes=30), team_id, session_id))
    conn.execute("""UPDATE app.milestone SET deadline = %s::timestamptz + make_interval(mins => offset_minutes)
                     WHERE team_id = %s AND session_id = %s""", (start, team_id, session_id))

    # Вброс «срочный заказ» на 20-й минуте добавляет задачу T11.
    inject_at = start + timedelta(minutes=20 + rng.uniform(-2, 2))
    inject_id = conn.execute(
        """INSERT INTO research.inject (team_id, session_id, kind, ts, payload) VALUES (%s, %s, 'urgent_order', %s, %s)
           RETURNING inject_id""", (team_id, session_id, inject_at, json({"title": "Срочный заказ", "phase": "work"})),
    ).fetchone()["inject_id"]
    urgent = next(i for i in sc["injects"] if i["key"] == "urgent_order")
    for n in urgent["notices"]:
        conn.execute("""INSERT INTO app.notice (team_id, session_id, inject_id, roles, title, body, created_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                     (team_id, session_id, inject_id, n["roles"], n["title"], n["body"], inject_at))
    core.insert_task(conn, team_id, session_id, urgent["add_tasks"][0], 99, inject_id)

    tasks = conn.execute("SELECT * FROM app.task WHERE team_id = %s AND session_id = %s ORDER BY position",
                         (team_id, session_id)).fetchall()
    release = start + timedelta(minutes=rng.uniform(0.5, 1.5))
    done_at: dict[str, datetime] = {}
    for t in tasks:
        case, ms = t["case_id"], t["milestone_id"]
        t_ready = max(release, inject_at + timedelta(minutes=1)) if t["inject_id"] else release
        if not t["inject_id"]:
            release += timedelta(minutes=rng.uniform(0.6, 1.4) * p["pull_every"])
        mover = pm if condition == "hierarchy" else rng.choice(people)
        stage, prev, ts, final = "Анализ", "Бэклог", t_ready, None
        assignee, started = None, False
        while ts < end:
            _ev(conn, team_id, session_id, case, stage, ts, pm if condition == "hierarchy" else mover, ms,
                {"old": prev, "new": stage} | ({"rework": True} if prev in STAGES and STAGES.index(prev) > STAGES.index(stage) else {}))
            final, assignee, started = stage, None, False
            if stage == "Сдача":
                done_at[case] = ts
                break
            weights = STAGE_WORKERS[stage]
            pool = [x for x in people if x["role"]["slug"] in weights]
            worker = rng.choices(pool, [weights[x["role"]["slug"]] for x in pool])[0]
            begin = max(ts, free_at[worker["pid"]]) + timedelta(minutes=rng.expovariate(1 / p["wait"]))
            if begin >= end:
                break
            _ev(conn, team_id, session_id, case, START_ACTIVITY, begin, worker, ms)
            assignee, started = worker["pid"], True
            finish = begin + timedelta(minutes=rng.uniform(0.8, 2.2))
            free_at[worker["pid"]] = finish
            if finish >= end:
                break
            prev, ts, mover = stage, finish, worker
            if stage == "Контроль" and rng.random() < p["rework"]:
                stage = "Исполнение"
            elif stage == "Проектирование" and rng.random() < p["rework"] / 3:
                stage = "Анализ"
            else:
                stage = STAGES[STAGES.index(stage) + 1]
        if final:
            conn.execute("UPDATE app.task SET stage = %s, assignee = %s, started = %s WHERE case_id = %s",
                         (final, assignee, started, case))

    for m in conn.execute("SELECT * FROM app.milestone WHERE team_id = %s AND session_id = %s",
                          (team_id, session_id)).fetchall():
        cases = [t["case_id"] for t in conn.execute("SELECT case_id FROM app.task WHERE milestone_id = %s",
                                                    (m["milestone_id"],)).fetchall()]
        if all(c in done_at for c in cases):
            closed = max(done_at[c] for c in cases) + timedelta(minutes=rng.uniform(0.3, 1.5))
            if closed < end:
                conn.execute("UPDATE app.milestone SET closed_at = %s WHERE milestone_id = %s", (closed, m["milestone_id"]))
                _ev(conn, team_id, session_id, m["milestone_id"], MILESTONE_CLOSED, closed, pm, m["milestone_id"],
                    {"deadline": m["deadline"].isoformat()})

    # Ключевое решение.
    chosen = "C" if rng.random() < p["correct"] else rng.choice(["A", "B"])
    proposer = pm if condition == "hierarchy" else rng.choice(people)
    decided = start + timedelta(minutes=rng.uniform(12, 30))
    case = f"{prefix}/DECISION-{sc['decision']['key']}"
    conn.execute(
        """INSERT INTO research.decision (team_id, session_id, case_id, proposed_by, alternatives, chosen, rationale, decided_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (team_id, session_id, case, proposer["pid"], json(["A", "B", "C"]), chosen,
         "Сложили факты аналитика, финансиста и исполнителя" if chosen == "C" else "Самое популярное решение на рынке",
         decided))
    _ev(conn, team_id, session_id, case, core.DECISION_MADE, decided, pm if condition == "hierarchy" else proposer,
        None, {"chosen": chosen, "proposed_by": proposer["pid"]})

    # Опросы: входной, пульс, выходной; оценки коллег.
    instruments = content.surveys()["instruments"]
    def likert(center, inst_id):
        inst = instruments[inst_id]
        for item in inst["items"]:
            v = max(1, min(7, round(rng.gauss(center, 0.9))))
            yield item["id"], (8 - v) if item.get("reverse") else v
    for x in people:
        rows = [("entry", "psych_safety_7", i, v) for i, v in likert(p["safety"] - 0.2, "psych_safety_7")]
        rows += [("entry", "goal_clarity", "1", max(1, min(7, round(rng.gauss(5, 1)))))]
        rows += [("pulse", "wellbeing", "1", max(1, min(7, round(rng.gauss(5.2, 1)))))]
        rows += [("pulse", "nasa_tlx_raw", i["id"], max(0, min(100, 5 * round(rng.gauss(p["tlx"], 12) / 5))))
                 for i in instruments["nasa_tlx_raw"]["items"]]
        rows += [("pulse", "goal_clarity", "1", max(1, min(7, round(rng.gauss(5.5, 1)))))]
        rows += [("pulse", "self_contribution", "1", max(1, min(7, round(rng.gauss(5, 1)))))]
        rows += [("exit", "psych_safety_7", i, v) for i, v in likert(p["safety"] + 0.3, "psych_safety_7")]
        rows += [("exit", "team_satisfaction", "1", max(1, min(7, round(rng.gauss(p["safety"], 1)))))]
        for phase, inst, item, v in rows:
            conn.execute(
                """INSERT INTO research.survey_response (participant_id, team_id, session_id, phase, instrument, item, value, answered_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (x["pid"], team_id, session_id, phase, inst, item, v, end + timedelta(minutes=2)))
        conn.execute(
            """INSERT INTO research.survey_response (participant_id, team_id, session_id, phase, instrument, item, text_value, answered_at)
               VALUES (%s, %s, %s, 'exit', 'reflection', 'learned', %s, %s)""",
            (x["pid"], team_id, session_id, rng.choice([
                "Нужно раньше делиться информацией, которая есть только у тебя.",
                "Контроль стал узким местом — стоило помогать контролёру.",
                "Договорились о правилах слишком поздно.",
                "Лимиты на незавершённую работу реально помогают."]), end + timedelta(minutes=25)))
        others = [y for y in people if y is not x]
        informal = rng.choice([y for y in people if y["role"]["slug"] in ("analyst", "pm")])
        noms = {
            "asked_for_info": rng.sample(others, k=min(len(others), rng.randint(1, 3))),
            "most_useful": rng.sample(others, k=min(len(others), rng.randint(1, 2))),
            "actual_leader": [pm if condition == "hierarchy" and pm is not x else informal] if informal is not x or condition == "hierarchy" else [],
        }
        for q, targets in noms.items():
            for y in {t["pid"]: t for t in targets if t is not x}.values():
                conn.execute(
                    """INSERT INTO research.peer_nomination (from_participant, to_participant, team_id, session_id, question)
                       VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                    (x["pid"], y["pid"], team_id, session_id, q))


def run(teams_per_condition: int, seed: int, force: bool) -> None:
    db.open_pool()
    db.migrate()
    rng = random.Random(seed)
    sc = content.scenario(content.default_scenario())
    roles = {r["slug"]: r for r in sc["roles"]}
    with db.tx() as conn:
        real = conn.execute("SELECT count(*) AS n FROM app.team_settings WHERE label NOT LIKE %s",
                            (f"{LABEL}%",)).fetchone()["n"]
        if real and not force:
            sys.exit("В базе есть настоящие команды. Демо-данные смешаются с исследованием и их нельзя будет удалить. "
                     "Запустите на отдельной базе (или --force, если понимаете последствия).")
        names = iter(rng.sample(NAMES, len(NAMES)) * 10)
        base = datetime.now(timezone.utc) - timedelta(days=teams_per_condition * 4)
        k = 0
        for i in range(teams_per_condition):
            for condition in ["kanban", "sprints", "hierarchy", "self_org"]:
                title = sc["conditions"][condition]["title"]
                team = core.create_team(conn, condition, f"{LABEL} · {title} · группа {i + 1}", sc["version"])
                people = []
                for slug in ROLES:
                    pid = core.create_participant(conn, team["team_id"], roles[slug], next(names))
                    people.append({"pid": pid, "role": roles[slug]})
                start = base + timedelta(days=k, hours=rng.randint(0, 3))
                simulate_session(conn, rng, team, condition, people, start)
                k += 1
                print(f"{team['team_id']} {condition:10} код {team['join_code']}")
    db.close_pool()
    print("Готово. Откройте пульт ведущего → Исследование.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--teams", type=int, default=2, help="команд на каждую методику")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    run(a.teams, a.seed, a.force)


if __name__ == "__main__":
    main()
