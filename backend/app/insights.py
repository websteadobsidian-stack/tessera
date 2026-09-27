"""Сыгранность команды, командные достижения и живые сигналы для ведущего.

Сыгранность — описательный индекс для самой команды (не оценка людей): среднее по доступным
компонентам — обмен информацией, взаимопомощь, равномерность участия, поток, синхрон."""

from __future__ import annotations

from collections import Counter
from statistics import mean

from tessera.model import STAGES, START_ACTIVITY

from . import content, mechanics
from .core import now, touch, work_minute
from .db import json
from .interventions import live_bottleneck, notice


def gini(values: list[float]) -> float:
    vals = sorted(v for v in values if v >= 0)
    n = len(vals)
    total = sum(vals)
    if n < 2 or total == 0:
        return 0.0
    cum = sum((i + 1) * v for i, v in enumerate(vals))
    return (2 * cum) / (n * total) - (n + 1) / n


def present_roles(conn, team_id: str) -> set[str]:
    return {m["orig_role_slug"] or m["role_slug"] for m in mechanics.team_members(conn, team_id)}


def key_facts_in_play(conn, session: dict) -> set[str]:
    sc = content.scenario(session["scenario_version"])
    roles = present_roles(conn, session["team_id"])
    return {fid for fid, f in content.all_facts(sc).items() if f.get("key") and f["role"] in roles}


def shared_facts(conn, session: dict) -> dict[str, dict]:
    rows = conn.execute(
        "SELECT fact_id, participant_id, shared_at FROM research.fact_share WHERE team_id = %s AND session_id = %s",
        (session["team_id"], session["session_id"]),
    ).fetchall()
    return {r["fact_id"]: r for r in rows}


def actions_by_member(conn, session: dict) -> Counter:
    t, s = session["team_id"], session["session_id"]
    counts: Counter = Counter()
    for sql in (
        "SELECT resource AS p, count(*) AS n FROM research.event WHERE team_id = %s AND session_id = %s GROUP BY 1",
        "SELECT participant_id AS p, count(*) AS n FROM research.message WHERE team_id = %s AND session_id = %s GROUP BY 1",
        "SELECT participant_id AS p, count(*) AS n FROM research.fact_share WHERE team_id = %s AND session_id = %s GROUP BY 1",
        "SELECT from_participant AS p, count(*) AS n FROM research.kudos WHERE team_id = %s AND session_id = %s GROUP BY 1",
        "SELECT helper_id AS p, count(*) AS n FROM research.help_request WHERE team_id = %s AND session_id = %s AND helper_id IS NOT NULL GROUP BY 1",
    ):
        for r in conn.execute(sql, (t, s)):
            counts[r["p"]] += r["n"]
    return counts


def mean_wait_minutes(conn, session: dict) -> float | None:
    rows = conn.execute(
        """WITH e AS (
             SELECT case_id, activity, ts,
                    lag(activity) OVER w AS prev_activity, lag(ts) OVER w AS prev_ts
               FROM research.event WHERE team_id = %s AND session_id = %s
             WINDOW w AS (PARTITION BY case_id ORDER BY ts, event_id))
           SELECT extract(epoch FROM ts - prev_ts) / 60 AS wait
             FROM e WHERE activity = %s AND prev_activity = ANY(%s)""",
        (session["team_id"], session["session_id"], START_ACTIVITY, list(STAGES[:-1])),
    ).fetchall()
    waits = [float(r["wait"]) for r in rows if r["wait"] is not None]
    return mean(waits) if waits else None


def synergy(conn, session: dict) -> dict:
    mech = content.mechanics(session.get("mechanics"))
    t, s = session["team_id"], session["session_id"]
    members = mechanics.team_members(conn, t)
    n = max(1, len(members))
    scale = float(session.get("time_scale") or 1)
    parts: list[dict] = []

    if mech["facts"]:
        keys = key_facts_in_play(conn, session)
        shared = set(shared_facts(conn, session)) & keys
        parts.append({"key": "info", "title": "Обмен информацией",
                      "value": (len(shared) / len(keys)) if keys else None,
                      "hint": f"{len(shared)} из {len(keys)} ключевых фактов на столе"})

    mutual = []
    hint = []
    if mech["help"]:
        h = conn.execute(
            """SELECT count(*) AS total, count(helper_id) AS answered FROM research.help_request
                WHERE team_id = %s AND session_id = %s""", (t, s)).fetchone()
        if h["total"]:
            mutual.append(h["answered"] / h["total"])
            hint.append(f"откликнулись на {h['answered']} из {h['total']} просьб")
    if mech["kudos"]:
        k = conn.execute("SELECT count(*) AS n FROM research.kudos WHERE team_id = %s AND session_id = %s",
                         (t, s)).fetchone()["n"]
        if k:
            mutual.append(min(1.0, k / n))
            hint.append(f"{k} «спасибо»")
    if mech["help"] or mech["kudos"]:
        parts.append({"key": "mutual", "title": "Взаимопомощь", "value": mean(mutual) if mutual else None,
                      "hint": ", ".join(hint) or "пока без просьб и благодарностей"})

    acts = actions_by_member(conn, session)
    per = [acts.get(m["participant_id"], 0) for m in members]
    parts.append({"key": "balance", "title": "Равномерность участия",
                  "value": (1 - gini(per)) if sum(per) >= 5 and len(per) >= 2 else None,
                  "hint": "насколько поровну распределена активность"})

    wait = mean_wait_minutes(conn, session)
    parts.append({"key": "flow", "title": "Поток",
                  "value": None if wait is None else max(0.0, min(1.0, 1 - wait / (6 * scale))),
                  "hint": "задачи почти не ждут" if wait is not None and wait < 1.5 * scale else
                          ("среднее ожидание " + f"{wait:.1f}".replace(".", ",") + " мин") if wait is not None else "ещё нет данных"})

    if mech["probes"]:
        probes = conn.execute(
            "SELECT * FROM research.probe WHERE team_id = %s AND session_id = %s AND closes_at <= clock_timestamp()",
            (t, s)).fetchall()
        summaries = [mechanics.probe_summary(conn, p, n) for p in probes]
        aligns = [x["alignment"] for x in summaries if x["alignment"] is not None and x["answered"] >= 2]
        parts.append({"key": "sync", "title": "Синхрон", "value": mean(aligns) if aligns else None,
                      "hint": f"совпадение ответов в {len(aligns)} проверках" if aligns else "проверок ещё не было"})

    values = [p["value"] for p in parts if p["value"] is not None]
    score = round(mean(values) * 100) if values else 0
    return {"score": score, "level": content.level(score), "components": parts}


# ---------------------------------------------------------------- достижения

def _unlocked(conn, session: dict) -> set[str]:
    return {r["key"] for r in conn.execute(
        "SELECT key FROM research.achievement WHERE team_id = %s AND session_id = %s",
        (session["team_id"], session["session_id"]))}


def evaluate_achievements(conn, session: dict) -> list[str]:
    mech = content.mechanics(session.get("mechanics"))
    if not mech["achievements"] or session["phase"] not in ("work", "pulse", "debrief", "retro", "exit"):
        return []
    t, s = session["team_id"], session["session_id"]
    sc = content.scenario(session["scenario_version"])
    have = _unlocked(conn, session)
    members = mechanics.team_members(conn, t)
    got: list[str] = []

    def check(key: str, cond) -> None:
        if key not in have and cond():
            got.append(key)

    stages = [r["stage"] for r in conn.execute("SELECT stage FROM app.task WHERE team_id = %s AND session_id = %s", (t, s))]
    check("first_done", lambda: STAGES[-1] in stages)
    check("all_done", lambda: stages and all(x == STAGES[-1] for x in stages))
    if mech["facts"]:
        keys = key_facts_in_play(conn, session)
        check("all_facts", lambda: keys and keys <= set(shared_facts(conn, session)))
    final = mechanics.final_decision(conn, session, sc)
    check("best_decision", lambda: final is not None and final["chosen"] == sc["decision"]["correct"])
    ms = conn.execute("SELECT * FROM app.milestone WHERE team_id = %s AND session_id = %s AND closed_at IS NOT NULL",
                      (t, s)).fetchall()
    check("milestone_on_time", lambda: any(m["deadline"] and m["closed_at"] <= m["deadline"] for m in ms))

    def clean() -> bool:
        for m in ms:
            rework = conn.execute(
                """SELECT 1 FROM research.event e JOIN app.task k ON k.case_id = e.case_id
                    WHERE k.milestone_id = %s AND e.attrs ? 'rework' LIMIT 1""", (m["milestone_id"],)).fetchone()
            if rework is None:
                return True
        return False
    check("clean_milestone", clean)
    if mech["help"]:
        h = conn.execute("""SELECT count(*) AS total, count(helper_id) AS answered FROM research.help_request
                             WHERE team_id = %s AND session_id = %s""", (t, s)).fetchone()
        check("help_loop", lambda: h["total"] >= 2 and h["answered"] == h["total"])
    if mech["probes"]:
        def synced() -> bool:
            for p in conn.execute("SELECT * FROM research.probe WHERE team_id = %s AND session_id = %s", (t, s)):
                summ = mechanics.probe_summary(conn, p, len(members))
                if summ["answered"] >= max(3, len(members) - 1) and summ["alignment"] == 1.0:
                    return True
            return False
        check("sync", synced)
    if mech["kudos"] and len(members) >= 3:
        received = {r["to_participant"] for r in conn.execute(
            "SELECT DISTINCT to_participant FROM research.kudos WHERE team_id = %s AND session_id = %s", (t, s))}
        check("thanks_circle", lambda: all(m["participant_id"] in received for m in members))

    defs = {a["key"]: a for a in sc.get("achievements", [])}
    for key in got:
        conn.execute("INSERT INTO research.achievement (team_id, session_id, key) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                     (t, s, key))
        a = defs.get(key, {"title": key, "text": ""})
        notice(conn, session, a["title"], a["text"], kind="achievement", signal=key)
    if got:
        touch(conn, t, "achievement")
    return got


# ---------------------------------------------------------------- живые сигналы

def _names(conn, team_id: str) -> dict[str, str]:
    return {r["participant_id"]: r["name"] for r in conn.execute(
        """SELECT p.participant_id, coalesce(m.person, p.role) AS name FROM research.participant p
             LEFT JOIN identity.participant_map m USING (participant_id) WHERE p.team_id = %s""", (team_id,))}


def signals(conn, session: dict) -> list[dict]:
    """Что сейчас требует внимания. Для пульта ведущего и автоматических подсказок."""
    if session["phase"] != "work":
        return []
    t, s = session["team_id"], session["session_id"]
    scale = float(session.get("time_scale") or 1)
    mech = content.mechanics(session.get("mechanics"))
    names = _names(conn, t)
    minute = work_minute(session) or 0
    out: list[dict] = []
    current = now()

    for r in conn.execute(
            """SELECT key, title, stage, updated_at FROM app.task
                WHERE team_id = %s AND session_id = %s AND NOT started AND stage = ANY(%s)""",
            (t, s, list(STAGES[:-1]))):
        waited = (current - r["updated_at"]).total_seconds() / 60
        if waited >= 3 * scale:
            out.append({"id": f"waiting:{r['key']}", "kind": "waiting", "severity": "bad" if waited >= 6 * scale else "warn",
                        "title": f"{r['key']} ждёт {waited:.0f} мин".replace(".", ","),
                        "text": f"«{r['title']}» стоит на этапе «{r['stage']}» и никто её не взял.",
                        "nudge": f"Задача {r['key']} ждёт на этапе «{r['stage']}» уже {max(1, round(waited))} мин. Кто может подхватить?",
                        "case_key": r["key"]})

    for r in conn.execute(
            """SELECT assignee, count(*) AS n FROM app.task WHERE team_id = %s AND session_id = %s AND started
                GROUP BY assignee HAVING count(*) >= 3""", (t, s)):
        name = names.get(r["assignee"], r["assignee"])
        out.append({"id": f"overloaded:{r['assignee']}", "kind": "overloaded", "severity": "warn",
                    "title": f"{name}: {r['n']} задачи в работе",
                    "text": "Много параллельной работы на одном человеке.",
                    "nudge": f"У {name} сейчас {r['n']} задачи в работе. Может, кто-то поможет?",
                    "participant_id": r["assignee"]})

    if mech["help"]:
        for r in conn.execute(
                """SELECT help_id, participant_id, created_at FROM research.help_request
                    WHERE team_id = %s AND session_id = %s AND helper_id IS NULL AND resolved_at IS NULL""", (t, s)):
            waited = (current - r["created_at"]).total_seconds() / 60
            if waited >= 1 * scale:
                name = names.get(r["participant_id"], r["participant_id"])
                out.append({"id": f"help:{r['help_id']}", "kind": "help_open", "severity": "bad",
                            "title": f"{name} ждёт помощи", "text": f"Просьба без отклика {waited:.0f} мин.".replace(".", ","),
                            "nudge": f"{name} просит помощи уже {max(1, round(waited))} мин — кто откликнется?",
                            "participant_id": r["participant_id"]})

    if mech["facts"] and minute >= 15 * scale:
        keys = key_facts_in_play(conn, session)
        shared = set(shared_facts(conn, session)) & keys
        if keys and len(shared) < len(keys) / 2:
            out.append({"id": "facts_hidden", "kind": "facts_hidden", "severity": "warn",
                        "title": f"На столе {len(shared)} из {len(keys)} ключевых фактов",
                        "text": "Команда может принять решение, не видя всей картины.",
                        "nudge": "У каждого из вас есть факты, которых нет у других. Выложите их на общий стол до решения."})

    for m in conn.execute("""SELECT m.key, m.title, m.deadline, count(t.*) AS tasks,
                                    count(t.*) FILTER (WHERE t.stage = %s) AS done
                               FROM app.milestone m LEFT JOIN app.task t USING (milestone_id)
                              WHERE m.team_id = %s AND m.session_id = %s AND m.closed_at IS NULL AND m.deadline IS NOT NULL
                              GROUP BY m.milestone_id""", (STAGES[-1], t, s)):
        left = (m["deadline"] - current).total_seconds() / 60
        progress = m["done"] / m["tasks"] if m["tasks"] else 1
        if left <= 5 * scale and progress < 0.7:
            out.append({"id": f"milestone:{m['key']}", "kind": "milestone_risk", "severity": "bad",
                        "title": f"Риск срыва {m['key']}",
                        "text": f"До срока {max(0, left):.0f} мин, сдано {m['done']} из {m['tasks']}.".replace(".", ",", 1),
                        "nudge": f"До срока вехи {m['key']} осталось совсем немного, а сдано {m['done']} из {m['tasks']}. Что можно ускорить?"})

    if minute >= 30 * scale:
        sc = content.scenario(session["scenario_version"])
        if mechanics.final_decision(conn, session, sc) is None:
            out.append({"id": "decision_pending", "kind": "decision_pending", "severity": "warn",
                        "title": "Ключевое решение не принято", "text": "Платформа для «ТехноСтроя» всё ещё не выбрана.",
                        "nudge": "Клиент ждёт решения по платформе. Пора выбирать."})

    if mech["weather"]:
        w = mechanics.latest_weather(conn, t, s)
        if len(w) >= 2 and mean(w.values()) <= 2:
            out.append({"id": "storm", "kind": "storm", "severity": "warn", "title": "В команде непогода",
                        "text": "Большинство отметили «тяжело» или «буря».", "nudge": None})

    bottleneck = live_bottleneck(conn, session)
    if bottleneck != "none":
        out.append({"id": f"bottleneck:{bottleneck}", "kind": "bottleneck", "severity": "info",
                    "title": f"Затор: {bottleneck}", "text": "Здесь больше всего задач ждут начала работы.", "nudge": None})

    order = {"bad": 0, "warn": 1, "info": 2}
    out.sort(key=lambda x: order[x["severity"]])
    return out


def send_nudges(conn, session: dict) -> int:
    """Автоподсказки (если включены протоколом), не чаще одной на сигнал за 3 минуты сессии."""
    if not content.mechanics(session.get("mechanics")).get("nudges"):
        return 0
    scale = float(session.get("time_scale") or 1)
    sent = 0
    for sig in signals(conn, session):
        if not sig.get("nudge") or sig["kind"] not in ("waiting", "overloaded", "help_open", "facts_hidden",
                                                        "milestone_risk", "decision_pending"):
            continue
        recent = conn.execute(
            """SELECT 1 FROM app.notice WHERE team_id = %s AND session_id = %s AND signal = %s
                  AND created_at > now() - make_interval(secs => %s)""",
            (session["team_id"], session["session_id"], sig["id"], 180 * scale),
        ).fetchone()
        if recent:
            continue
        notice(conn, session, "Подсказка", sig["nudge"], kind="nudge", signal=sig["id"])
        conn.execute(
            """INSERT INTO research.intervention (team_id, session_id, kind, payload, source)
               VALUES (%s, %s, 'auto_nudge', %s, 'system')""",
            (session["team_id"], session["session_id"], json({"signal": sig["id"], "text": sig["nudge"]})),
        )
        sent += 1
        if sent >= 1:  # не больше одной подсказки за такт — чтобы не заваливать команду
            break
    if sent:
        touch(conn, session["team_id"], "nudge")
    return sent

