"""Разбор сессии, сравнение условий, гипотезы исследования и выгрузки.

Процессные метрики считает пакет tessera; здесь — связка с механиками взаимодействия."""

from __future__ import annotations

import csv
import io
import tempfile
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean, median, pstdev

from tessera import export, metrics
from tessera.model import MILESTONE_CLOSED, STAGES, START_ACTIVITY, Event, write_csv

from . import content, insights, interventions, mechanics
from .core import BACKLOG, DECISION_MADE

# ================================================================ загрузка

_EVENTS_SQL = """
SELECT e.case_id, e.activity, e.ts, e.resource,
       coalesce(e.role, p.role, '') AS role, coalesce(e.department, p.department, '') AS department,
       e.team_id, e.session_id, s.condition, coalesce(e.milestone_id, '') AS milestone_id, e.attrs
  FROM research.event e
  JOIN research.session s USING (team_id, session_id)
  JOIN research.team t USING (team_id)
  LEFT JOIN research.participant p ON p.participant_id = e.resource
 WHERE (%(team)s::text IS NULL OR e.team_id = %(team)s)
   AND (%(session)s::text IS NULL OR e.session_id = %(session)s)
   AND (%(demo)s OR NOT t.is_demo)
 ORDER BY e.ts, e.event_id
"""


def events_for(conn, team_id: str | None = None, session_id: str | None = None, include_demo: bool = True) -> list[Event]:
    rows = conn.execute(_EVENTS_SQL, {"team": team_id, "session": session_id, "demo": include_demo}).fetchall()
    return [
        Event(case_id=r["case_id"], activity=r["activity"], timestamp=r["ts"], resource=r["resource"],
              team_id=r["team_id"], session_id=r["session_id"], condition=r["condition"], role=r["role"],
              department=r["department"], milestone_id=r["milestone_id"], attrs=r["attrs"] or {})
        for r in rows
    ]


def _minutes(a, b) -> float:
    return (b - a).total_seconds() / 60


def pearson(xs: list[float], ys: list[float]) -> float | None:
    pairs = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
    if len(pairs) < 3:
        return None
    xs, ys = [p[0] for p in pairs], [p[1] for p in pairs]
    sx, sy = pstdev(xs), pstdev(ys)
    if sx == 0 or sy == 0:
        return None
    mx, my = mean(xs), mean(ys)
    return sum((x - mx) * (y - my) for x, y in pairs) / (len(pairs) * sx * sy)


# ================================================================ опросы

def _scored(instrument: dict, item_id: str, value: float) -> float:
    item = next((i for i in instrument["items"] if i["id"] == item_id), {})
    if item.get("reverse"):
        return instrument["min"] + instrument["max"] - value
    return value


def survey_scores(conn, team_id: str | None = None, session_id: str | None = None) -> dict:
    """Средние баллы шкал: {(team, session): {phase: {instrument: {mean, n}}}} с учётом обратных пунктов."""
    instruments = content.surveys()["instruments"]
    rows = conn.execute(
        """SELECT participant_id, team_id, session_id, phase, instrument, item, value
             FROM research.survey_response
            WHERE value IS NOT NULL
              AND (%(team)s::text IS NULL OR team_id = %(team)s)
              AND (%(session)s::text IS NULL OR session_id = %(session)s)""",
        {"team": team_id, "session": session_id},
    ).fetchall()
    per_person: dict[tuple, list[float]] = defaultdict(list)
    for r in rows:
        inst = instruments.get(r["instrument"])
        if inst is None:
            continue
        per_person[(r["team_id"], r["session_id"], r["phase"], r["instrument"], r["participant_id"])].append(
            _scored(inst, r["item"], float(r["value"])))
    per_team: dict[tuple, list[float]] = defaultdict(list)
    for (t, s, ph, inst, _p), vals in per_person.items():
        per_team[(t, s, ph, inst)].append(mean(vals))
    result: dict[tuple, dict] = defaultdict(lambda: defaultdict(dict))
    for (t, s, ph, inst), vals in per_team.items():
        result[(t, s)][ph][inst] = {"mean": mean(vals), "n": len(vals)}
    return result


def _item_values(conn, session: dict, phase: str, instrument: str, item: str) -> dict[str, float]:
    return {r["participant_id"]: float(r["value"]) for r in conn.execute(
        """SELECT participant_id, value FROM research.survey_response
            WHERE team_id = %s AND session_id = %s AND phase = %s AND instrument = %s AND item = %s
              AND value IS NOT NULL""",
        (session["team_id"], session["session_id"], phase, instrument, item))}


def _item_texts(conn, session: dict, phase: str, instrument: str, item: str) -> dict[str, str]:
    return {r["participant_id"]: r["text_value"] for r in conn.execute(
        """SELECT participant_id, text_value FROM research.survey_response
            WHERE team_id = %s AND session_id = %s AND phase = %s AND instrument = %s AND item = %s
              AND text_value IS NOT NULL""",
        (session["team_id"], session["session_id"], phase, instrument, item))}


# ================================================================ мозаика

def mosaic_tiles(conn, session: dict, limit: int = 720) -> list[dict]:
    """Портрет команды: каждое действие — плитка. a — автор (цвет), b — второй участник
    взаимодействия (плитка делится по диагонали на два цвета), k — вид действия (узор)."""
    t, s = session["team_id"], session["session_id"]
    tiles: list[dict] = []
    last_by_case: dict[str, dict] = {}
    for e in conn.execute(
            """SELECT case_id, activity, ts, resource, attrs FROM research.event
                WHERE team_id = %s AND session_id = %s ORDER BY ts, event_id""", (t, s)):
        prev = last_by_case.get(e["case_id"])
        if e["activity"] == START_ACTIVITY:
            if prev and prev["activity"] in STAGES and prev["resource"] != e["resource"]:
                tiles.append({"t": e["ts"], "k": "handover", "a": prev["resource"], "b": e["resource"]})
            else:
                tiles.append({"t": e["ts"], "k": "start", "a": e["resource"]})
        elif e["activity"] in STAGES:
            kind = "done" if e["activity"] == STAGES[-1] else ("rework" if (e["attrs"] or {}).get("rework") else "step")
            tiles.append({"t": e["ts"], "k": kind, "a": e["resource"]})
        elif e["activity"] == MILESTONE_CLOSED:
            tiles.append({"t": e["ts"], "k": "milestone", "a": e["resource"]})
        elif e["activity"] == DECISION_MADE:
            tiles.append({"t": e["ts"], "k": "decision", "a": (e["attrs"] or {}).get("proposed_by") or e["resource"]})
        last_by_case[e["case_id"]] = e
    for r in conn.execute("SELECT participant_id, shared_at FROM research.fact_share WHERE team_id = %s AND session_id = %s", (t, s)):
        tiles.append({"t": r["shared_at"], "k": "fact", "a": r["participant_id"]})
    for r in conn.execute("SELECT from_participant, to_participant, sent_at FROM research.kudos WHERE team_id = %s AND session_id = %s", (t, s)):
        tiles.append({"t": r["sent_at"], "k": "kudos", "a": r["from_participant"], "b": r["to_participant"]})
    for r in conn.execute(
            "SELECT participant_id, helper_id, created_at, helped_at FROM research.help_request WHERE team_id = %s AND session_id = %s", (t, s)):
        tiles.append({"t": r["created_at"], "k": "help", "a": r["participant_id"]})
        if r["helper_id"]:
            tiles.append({"t": r["helped_at"], "k": "helped", "a": r["helper_id"], "b": r["participant_id"]})
    for r in conn.execute(
            "SELECT participant_id, mentions, sent_at FROM research.message WHERE team_id = %s AND session_id = %s", (t, s)):
        tiles.append({"t": r["sent_at"], "k": "message", "a": r["participant_id"],
                      **({"b": r["mentions"][0]} if r["mentions"] else {})})
    for r in conn.execute("SELECT participant_id, voted_at FROM research.vote_log WHERE team_id = %s AND session_id = %s", (t, s)):
        tiles.append({"t": r["voted_at"], "k": "vote", "a": r["participant_id"]})
    for r in conn.execute("SELECT key, unlocked_at FROM research.achievement WHERE team_id = %s AND session_id = %s", (t, s)):
        tiles.append({"t": r["unlocked_at"], "k": "achievement", "a": None, "key": r["key"]})
    tiles.sort(key=lambda x: x["t"])
    if len(tiles) > limit:
        # Прореживаем сообщения Эфира, остальные действия сохраняем все.
        messages = [x for x in tiles if x["k"] == "message"]
        keep_every = max(2, len(messages) // max(1, limit - (len(tiles) - len(messages))) + 1)
        seen = 0
        thinned = []
        for x in tiles:
            if x["k"] == "message":
                seen += 1
                if seen % keep_every:
                    continue
            thinned.append(x)
        tiles = thinned[-limit:]
    return tiles


# ================================================================ составные метрики сессии

def _people(conn, session: dict) -> list[dict]:
    rows = conn.execute(
        """SELECT p.participant_id, p.role, p.department, d.role_slug, d.orig_role_slug, d.color_slot, d.is_bot,
                  m.person AS display_name
             FROM research.participant p
             LEFT JOIN app.device d ON d.participant_id = p.participant_id
             LEFT JOIN identity.participant_map m ON m.participant_id = p.participant_id
            WHERE p.team_id = %s ORDER BY p.participant_id""",
        (session["team_id"],),
    ).fetchall()
    for r in rows:
        r["role_slug"] = r["orig_role_slug"] or r["role_slug"]
        r["color_slot"] = r["color_slot"] or 1
    return rows


def info_pooling(conn, session: dict) -> dict:
    sc = content.scenario(session["scenario_version"])
    t, s = session["team_id"], session["session_id"]
    facts = content.all_facts(sc)
    keys = insights.key_facts_in_play(conn, session)
    shared = insights.shared_facts(conn, session)
    final = mechanics.final_decision(conn, session, sc)
    decided_at = final["decided_at"] if final else None
    start = session.get("work_started_at")
    before = {f for f, r in shared.items() if decided_at is None or r["shared_at"] <= decided_at}
    pre = conn.execute(
        """SELECT participant_id, option, confidence FROM research.preference
            WHERE team_id = %s AND session_id = %s AND stage = 'pre'""", (t, s)).fetchall()
    votes = conn.execute(
        "SELECT participant_id, option, voted_at FROM research.vote_log WHERE team_id = %s AND session_id = %s ORDER BY vote_id",
        (t, s)).fetchall()
    correct = sc["decision"]["correct"]
    return {
        "facts": [{"fact_id": fid, "text": facts[fid]["text"], "role": facts[fid]["role"], "key": fid in keys,
                   "owner": r["participant_id"], "shared_at": r["shared_at"],
                   "minute": _minutes(start, r["shared_at"]) if start else None}
                  for fid, r in sorted(shared.items(), key=lambda kv: kv[1]["shared_at"]) if fid in facts],
        "key_total": len(keys),
        "key_shared": len(keys & set(shared)),
        "key_before_decision": len(keys & before),
        "decision": {"chosen": final["chosen"] if final else None, "correct": correct,
                     "is_correct": (final["chosen"] == correct) if final else None,
                     "decided_at": decided_at, "minute": _minutes(start, decided_at) if start and decided_at else None,
                     "proposed_by": final["proposed_by"] if final else None,
                     "explanation": sc["decision"]["explanation"], "title": sc["decision"]["title"],
                     "options": sc["decision"]["options"]},
        "pre": [{"participant_id": p["participant_id"], "option": p["option"], "confidence": p["confidence"]} for p in pre],
        "pre_correct_share": (sum(p["option"] == correct for p in pre) / len(pre)) if pre else None,
        "votes": [{"participant_id": v["participant_id"], "option": v["option"],
                   "minute": _minutes(start, v["voted_at"]) if start else None} for v in votes],
    }


def forecast_stats(conn, session: dict) -> dict:
    tasks = _item_values(conn, session, "briefing", "forecast", "tasks_done")
    on_time = _item_values(conn, session, "briefing", "forecast", "m1_on_time")
    conf = _item_values(conn, session, "briefing", "forecast", "confidence")
    done = conn.execute("SELECT count(*) AS n FROM app.task WHERE team_id = %s AND session_id = %s AND stage = %s",
                        (session["team_id"], session["session_id"], STAGES[-1])).fetchone()["n"]
    m1 = conn.execute("SELECT deadline, closed_at FROM app.milestone WHERE team_id = %s AND session_id = %s AND key = 'M-1'",
                      (session["team_id"], session["session_id"])).fetchone()
    m1_actual = bool(m1 and m1["closed_at"] and m1["deadline"] and m1["closed_at"] <= m1["deadline"])
    preds = list(tasks.values())
    return {
        "people": [{"participant_id": p, "tasks_done": tasks[p], "m1_on_time": bool(on_time.get(p)),
                    "confidence": conf.get(p)} for p in tasks],
        "actual_tasks": done,
        "actual_m1_on_time": m1_actual,
        "mean_prediction": mean(preds) if preds else None,
        "spread": pstdev(preds) if len(preds) >= 2 else None,
        "error": mean(abs(x - done) for x in preds) if preds else None,
        "m1_accuracy": (sum(bool(v) == m1_actual for v in on_time.values()) / len(on_time)) if on_time else None,
    }


def probe_stats(conn, session: dict) -> dict:
    size = len(mechanics.team_members(conn, session["team_id"]))
    start = session.get("work_started_at")
    items = []
    for p in conn.execute("SELECT * FROM research.probe WHERE team_id = %s AND session_id = %s ORDER BY probe_id",
                          (session["team_id"], session["session_id"])):
        sm = mechanics.probe_summary(conn, p, size)
        sm["minute"] = _minutes(start, p["fired_at"]) if start else None
        items.append(sm)
    aligns = [x["alignment"] for x in items if x["alignment"] is not None and x["answered"] >= 2]
    accs = [x["accuracy"] for x in items if x["accuracy"] is not None]
    return {"items": items, "alignment": mean(aligns) if aligns else None, "accuracy": mean(accs) if accs else None}


def help_stats(conn, session: dict) -> dict:
    rows = conn.execute(
        """SELECT h.*, t.key AS case_key FROM research.help_request h LEFT JOIN app.task t ON t.case_id = h.case_id
            WHERE h.team_id = %s AND h.session_id = %s ORDER BY h.help_id""",
        (session["team_id"], session["session_id"])).fetchall()
    latencies = [_minutes(r["created_at"], r["helped_at"]) for r in rows if r["helped_at"]]
    return {
        "items": [{"help_id": r["help_id"], "participant_id": r["participant_id"], "helper_id": r["helper_id"],
                   "case_key": r["case_key"], "note": r["note"], "created_at": r["created_at"],
                   "latency": _minutes(r["created_at"], r["helped_at"]) if r["helped_at"] else None} for r in rows],
        "total": len(rows),
        "answered": sum(1 for r in rows if r["helper_id"]),
        "median_latency": median(latencies) if latencies else None,
    }


def kudos_stats(conn, session: dict) -> dict:
    rows = conn.execute(
        """SELECT kudos_id, from_participant, to_participant, kind, note, sent_at FROM research.kudos
            WHERE team_id = %s AND session_id = %s ORDER BY kudos_id""",
        (session["team_id"], session["session_id"])).fetchall()
    pairs = {(r["from_participant"], r["to_participant"]) for r in rows}
    undirected = {tuple(sorted(p)) for p in pairs}
    mutual = sum(1 for a, b in undirected if (a, b) in pairs and (b, a) in pairs)
    return {
        "items": rows,
        "total": len(rows),
        "by_kind": dict(Counter(r["kind"] for r in rows)),
        "received": dict(Counter(r["to_participant"] for r in rows)),
        "sent": dict(Counter(r["from_participant"] for r in rows)),
        "reciprocity": (mutual / len(undirected)) if undirected else None,
    }


def chat_stats(conn, session: dict) -> dict:
    rows = conn.execute(
        """SELECT participant_id, mentions, during_silence, sent_at FROM research.message
            WHERE team_id = %s AND session_id = %s""", (session["team_id"], session["session_id"])).fetchall()
    edges: Counter = Counter()
    for r in rows:
        for m in r["mentions"]:
            edges[(r["participant_id"], m)] += 1
    return {
        "total": len(rows),
        "by_person": dict(Counter(r["participant_id"] for r in rows)),
        "during_silence": sum(1 for r in rows if r["during_silence"]),
        "mentions": [{"source": a, "target": b, "weight": w} for (a, b), w in edges.items()],
    }


def weather_series(conn, session: dict) -> dict:
    start = session.get("work_started_at") or session.get("phase_changed_at")
    rows = conn.execute(
        """SELECT participant_id, value, set_at FROM research.mood
            WHERE team_id = %s AND session_id = %s ORDER BY mood_id""", (session["team_id"], session["session_id"])).fetchall()
    return {
        "points": [{"participant_id": r["participant_id"], "value": r["value"],
                    "minute": _minutes(start, r["set_at"]) if start else None} for r in rows],
    }


def mirror_stats(conn, session: dict, people: list[dict], load: dict[str, float]) -> dict:
    guesses = _item_values(conn, session, "pulse", "mirror", "team_stress")
    picks = _item_texts(conn, session, "pulse", "mirror", "most_loaded")
    stress = _item_values(conn, session, "pulse", "nasa_tlx_raw", "frustration")
    actual_stress = mean(stress.values()) if stress else None
    busiest = max(load, key=load.get) if load else None
    return {
        "stress_guesses": guesses,
        "stress_actual": actual_stress,
        "stress_error": mean(abs(g - actual_stress) for g in guesses.values()) if guesses and actual_stress is not None else None,
        "loaded_picks": picks,
        "loaded_actual": busiest,
        "loaded_accuracy": (sum(p == busiest for p in picks.values()) / len(picks)) if picks and busiest else None,
    }


def agreements_stats(conn, session: dict) -> dict:
    """Договорённости прошлой сессии и то, как команда оценила их соблюдение сейчас."""
    prev = mechanics.previous_agreements(conn, session["team_id"], session["session_id"])
    out = []
    for a in prev:
        scores = [r["score"] for r in conn.execute(
            "SELECT score FROM research.agreement_check WHERE agreement_id = %s AND session_id = %s",
            (a["agreement_id"], session["session_id"]))]
        out.append({**a, "mean": mean(scores) if scores else None, "n": len(scores)})
    kept = [x["mean"] for x in out if x["mean"] is not None]
    return {"items": out, "kept": mean(kept) if kept else None}


def _cumulative_flow(events: list[Event], task_ids: list[str], start, end) -> list[dict]:
    """Сколько задач находится на каждом этапе в каждую минуту рабочей фазы."""
    if start is None or end is None or end <= start:
        return []
    stage_events = sorted((e for e in events if e.activity in STAGES), key=lambda e: e.timestamp)
    where = {cid: BACKLOG for cid in task_ids}
    total = (end - start).total_seconds() / 60
    steps = max(2, min(120, int(total * 2)))
    i, out = 0, []
    for m in range(steps + 1):
        t = start + (end - start) * (m / steps)
        while i < len(stage_events) and stage_events[i].timestamp <= t:
            e = stage_events[i]
            if e.case_id in where:
                where[e.case_id] = e.activity
            i += 1
        counts = Counter(where.values())
        out.append({"minute": round((t - start).total_seconds() / 60, 2),
                    **{s: counts.get(s, 0) for s in [BACKLOG, *STAGES]}})
    return out


# ================================================================ разбор сессии

def debrief(conn, session: dict, viewer: str | None = None) -> dict:
    team_id, session_id = session["team_id"], session["session_id"]
    events = events_for(conn, team_id, session_id)
    people = _people(conn, session)
    tasks = conn.execute(
        """SELECT case_id, key, title, project, priority, stage, inject_id IS NOT NULL AS injected
             FROM app.task WHERE team_id = %s AND session_id = %s ORDER BY position""",
        (team_id, session_id),
    ).fetchall()
    summary = metrics.team_summary(events) if events else None
    case_rows = {r["case_id"]: r for r in metrics.case_table(events)} if events else {}
    edges = metrics.handover_network(events)
    load = metrics.node_load(edges)

    waiting: dict[str, list[float]] = defaultdict(list)
    for r in case_rows.values():
        for part in filter(None, r["waiting_by_stage"].split("; ")):
            stage, hours = part.split("=")
            waiting[stage].append(float(hours))

    starts = Counter(e.resource for e in events if e.activity == START_ACTIVITY)
    completed = Counter(e.resource for e in events if e.activity == STAGES[-1])
    reworks_sent = Counter(e.resource for e in events if e.attrs.get("rework"))
    takeovers = Counter(e.resource for e in events if e.attrs.get("takeover"))
    actions = insights.actions_by_member(conn, session)
    nominations = conn.execute(
        """SELECT from_participant AS source, to_participant AS target, question
             FROM research.peer_nomination WHERE team_id = %s AND session_id = %s""",
        (team_id, session_id),
    ).fetchall()
    milestones = conn.execute(
        "SELECT key, title, deadline, closed_at FROM app.milestone WHERE team_id = %s AND session_id = %s ORDER BY key",
        (team_id, session_id),
    ).fetchall()
    start = session.get("work_started_at")
    end = max((e.timestamp for e in events), default=None)
    scores = survey_scores(conn, team_id, session_id).get((team_id, session_id), {})
    kud = kudos_stats(conn, session)
    chat = chat_stats(conn, session)
    hlp = help_stats(conn, session)
    helps_given = Counter(h["helper_id"] for h in hlp["items"] if h["helper_id"])
    helps_asked = Counter(h["participant_id"] for h in hlp["items"])
    per_actions = [actions.get(p["participant_id"], 0) for p in people]
    leaders = Counter(n["target"] for n in nominations if n["question"] == "actual_leader")

    data = {
        "team_id": team_id,
        "session_id": session_id,
        "condition": session["condition"],
        "phase": session["phase"],
        "time_scale": float(session.get("time_scale") or 1),
        "work_started_at": start,
        "work_minutes": session.get("work_minutes"),
        "mechanics": content.mechanics(session.get("mechanics")),
        "summary": summary,
        "dfg": metrics.stage_dfg(events),
        "waiting_by_stage": {s: mean(v) * 60 for s, v in waiting.items()},
        "people": [
            {**p, "load": load.get(p["participant_id"], 0.0), "started": starts[p["participant_id"]],
             "completed": completed[p["participant_id"]], "reworks_sent": reworks_sent[p["participant_id"]],
             "takeovers": takeovers[p["participant_id"]], "actions": actions.get(p["participant_id"], 0),
             "messages": chat["by_person"].get(p["participant_id"], 0),
             "kudos_received": kud["received"].get(p["participant_id"], 0),
             "kudos_sent": kud["sent"].get(p["participant_id"], 0),
             "helps_given": helps_given[p["participant_id"]], "helps_asked": helps_asked[p["participant_id"]],
             "leader_votes": leaders[p["participant_id"]]}
            for p in people
        ],
        "balance": {"gini": insights.gini(per_actions), "total_actions": sum(per_actions)},
        "handover": [{"source": s, "target": t, "weight": w} for (s, t), w in edges.items()],
        "nominations": nominations,
        "tasks": [
            {**t, "trace": case_rows.get(t["case_id"], {}).get("trace", ""),
             "cycle_minutes": case_rows[t["case_id"]]["cycle_hours"] * 60
             if t["case_id"] in case_rows and case_rows[t["case_id"]]["cycle_hours"] is not None else None,
             "waiting_minutes": case_rows[t["case_id"]]["waiting_hours"] * 60
             if t["case_id"] in case_rows and case_rows[t["case_id"]]["waiting_hours"] is not None else None,
             "reworks": case_rows.get(t["case_id"], {}).get("reworks", 0)}
            for t in tasks
        ],
        "milestones": milestones,
        "timeline": interventions.timeline(conn, session),
        "flow": _cumulative_flow(events, [t["case_id"] for t in tasks], start, end),
        "surveys": scores,
        "events": len(events),
        "tiles": mosaic_tiles(conn, session),
        "synergy": insights.synergy(conn, session),
        "achievements": [
            {**next((a for a in content.scenario(session["scenario_version"]).get("achievements", [])
                     if a["key"] == r["key"]), {"key": r["key"], "title": r["key"], "text": ""}),
             "unlocked_at": r["unlocked_at"]}
            for r in conn.execute("SELECT key, unlocked_at FROM research.achievement WHERE team_id = %s AND session_id = %s ORDER BY unlocked_at",
                                  (team_id, session_id))],
        "pooling": info_pooling(conn, session),
        "forecast": forecast_stats(conn, session),
        "probes": probe_stats(conn, session),
        "help": hlp,
        "kudos": kud,
        "chat": chat,
        "weather": weather_series(conn, session),
        "mirror": mirror_stats(conn, session, people, load),
        "agreements": agreements_stats(conn, session),
        "retro": conn.execute(
            """SELECT c.card_id, c.lane, c.body, count(v.participant_id) AS votes
                 FROM research.retro_card c LEFT JOIN research.retro_vote v USING (card_id)
                WHERE c.team_id = %s AND c.session_id = %s GROUP BY c.card_id ORDER BY votes DESC, c.card_id""",
            (team_id, session_id)).fetchall(),
        "charter": {r["field"]: r["body"] for r in conn.execute(
            "SELECT field, body FROM research.charter WHERE team_id = %s AND session_id = %s", (team_id, session_id))},
    }
    if viewer:
        data["personal"] = personal(conn, session, viewer, data)
    return data


def personal(conn, session: dict, pid: str, d: dict) -> dict:
    """«Ваш фрагмент»: личная карточка участника — только для него самого."""
    me = next((p for p in d["people"] if p["participant_id"] == pid), None)
    if me is None:
        return {}
    titles = {x["id"]: x["title"] for x in content.scenario(session["scenario_version"]).get("strengths", [])}
    strengths = Counter(titles.get(r["strength"], r["strength"]) for r in conn.execute(
        "SELECT strength FROM research.strength WHERE team_id = %s AND session_id = %s AND to_participant = %s",
        (session["team_id"], session["session_id"], pid)))
    kinds = Counter(k["kind"] for k in d["kudos"]["items"] if k["to_participant"] == pid)
    notes = [k["note"] for k in d["kudos"]["items"] if k["to_participant"] == pid and k["note"]]
    tiles = [t for t in d["tiles"] if t.get("a") == pid or t.get("b") == pid]
    together = Counter(t["b"] if t.get("a") == pid else t.get("a") for t in tiles if t.get("b"))
    ranked = sorted(d["people"], key=lambda p: p["load"], reverse=True)
    rank = next((i for i, p in enumerate(ranked) if p["participant_id"] == pid), None)
    if me["load"] >= 0.3:
        role = "узел"
        role_text = "Через вас проходила большая часть работы. Команда на вас опиралась — и это же риск перегруза."
    elif me["helps_given"] + me["kudos_sent"] >= 3:
        role = "опора"
        role_text = "Вы чаще других помогали и благодарили — вы держите команду вместе."
    elif me["messages"] >= 5 and me["load"] < 0.15:
        role = "связной"
        role_text = "Вы много общались и связывали людей, хотя сами передавали немного задач."
    else:
        role = "мастер"
        role_text = "Вы работали сфокусированно над своей частью процесса."
    forecast = next((f for f in d["forecast"]["people"] if f["participant_id"] == pid), None)
    return {
        "participant_id": pid,
        "tiles": len(tiles),
        "tiles_share": len(tiles) / max(1, len(d["tiles"])),
        "with_most": together.most_common(1)[0][0] if together else None,
        "archetype": role, "archetype_text": role_text,
        "load_rank": (rank + 1) if rank is not None else None,
        "kudos_by_kind": dict(kinds), "kudos_notes": notes[-5:],
        "strengths": dict(strengths),
        "forecast": forecast,
        "stats": {k: me[k] for k in ("started", "completed", "messages", "kudos_received", "kudos_sent",
                                     "helps_given", "helps_asked", "takeovers", "reworks_sent", "actions")},
    }


# ================================================================ исследование

def session_row(conn, s: dict, events_by_session: dict, scores: dict) -> dict:
    """Строка сравнения по одной сессии: процесс + взаимодействие + опросы (минуты — логические)."""
    key = (s["team_id"], s["session_id"])
    scale = float(s.get("time_scale") or 1)
    evs = events_by_session.get(key, [])
    base = metrics.team_summary(evs) if evs else {"cases": 0}
    sess = {**s, "mechanics": s.get("mechanics") or {}}
    pool = info_pooling(conn, sess)
    fc = forecast_stats(conn, sess)
    pr = probe_stats(conn, sess)
    hlp = help_stats(conn, sess)
    kud = kudos_stats(conn, sess)
    people = s["participants"] or 1
    acts = insights.actions_by_member(conn, sess)
    members = [m["participant_id"] for m in mechanics.team_members(conn, s["team_id"])]
    ps = scores.get(key, {})
    ag = agreements_stats(conn, sess)

    def lm(hours):
        return None if hours is None else hours * 60 / scale

    ps_in = ps.get("entry", {}).get("psych_safety_7", {}).get("mean")
    ps_out = ps.get("exit", {}).get("psych_safety_7", {}).get("mean")
    return {
        "team_id": s["team_id"], "session_id": s["session_id"], "label": s["label"],
        "condition": s["condition"], "protocol_id": s["protocol"].get("protocol_id"),
        "protocol_title": s["protocol"].get("title"), "is_demo": s["is_demo"], "participants": s["participants"],
        "cases": base.get("cases", 0), "completed": base.get("completed"),
        "cycle_minutes": lm(base.get("cycle_hours_mean")), "waiting_minutes": lm(base.get("waiting_hours_mean")),
        "rework_case_share": base.get("rework_case_share"), "fitness_mean": base.get("fitness_mean"),
        "on_time_final": base.get("on_time_final"), "handover_centralization": base.get("handover_centralization"),
        "cross_department_handovers_mean": base.get("cross_department_handovers_mean"),
        "decision_correct": None if pool["decision"]["is_correct"] is None else float(pool["decision"]["is_correct"]),
        "info_pooled": (pool["key_before_decision"] / pool["key_total"]) if pool["key_total"] and pool["decision"]["chosen"] else None,
        "pre_correct_share": pool["pre_correct_share"],
        "forecast_error": fc["error"],
        "probe_alignment": pr["alignment"],
        "help_per_person": hlp["total"] / people,
        "help_latency": None if hlp["median_latency"] is None else hlp["median_latency"] / scale,
        "kudos_per_person": kud["total"] / people,
        "gini": insights.gini([acts.get(m, 0) for m in members]) if members else None,
        "synergy": insights.synergy(conn, sess)["score"],
        "psych_safety_entry": ps_in, "psych_safety_exit": ps_out,
        "psych_safety_delta": (ps_out - ps_in) if ps_in is not None and ps_out is not None else None,
        "workload_tlx": ps.get("pulse", {}).get("nasa_tlx_raw", {}).get("mean"),
        "agreements_kept": ag["kept"],
    }


def research(conn, include_demo: bool = False) -> dict:
    sessions = conn.execute(
        """SELECT s.team_id, s.session_id, s.condition, s.scenario_version, s.protocol, ts.label, ts.is_demo,
                  st.time_scale, st.work_started_at, st.mechanics, st.phase, st.phase_changed_at,
                  (SELECT count(*) FROM research.participant p WHERE p.team_id = s.team_id) AS participants
             FROM research.session s
             JOIN app.team_settings ts USING (team_id)
             JOIN app.session_state st USING (team_id, session_id)
            WHERE (%s OR NOT ts.is_demo) AND coalesce(ts.demo_kind, '') <> 'sandbox'
            ORDER BY s.team_id, s.session_id""",
        (include_demo,),
    ).fetchall()
    events = events_for(conn, include_demo=include_demo)
    by_session: dict[tuple, list[Event]] = defaultdict(list)
    for e in events:
        by_session[(e.team_id, e.session_id)].append(e)
    scores = survey_scores(conn)
    rows = [session_row(conn, s, by_session, scores) for s in sessions]
    with_data = [r for r in rows if r.get("cases")]

    def group(key: str) -> dict:
        groups: dict[str, list[dict]] = defaultdict(list)
        for r in with_data:
            groups[r[key] or "—"].append(r)
        numeric = [k for k in (with_data[0].keys() if with_data else [])
                   if k not in ("participants",) and any(isinstance(r[k], (int, float)) and not isinstance(r[k], bool)
                                                          for r in with_data)]
        out = {}
        for g, items in groups.items():
            agg = {"teams": len(items)}
            for k in numeric:
                vals = [r[k] for r in items if isinstance(r[k], (int, float)) and not isinstance(r[k], bool)]
                agg[k] = mean(vals) if vals else None
            out[g] = agg
        return out

    return {
        "sessions": rows,
        "conditions": group("condition"),
        "protocols": group("protocol_title"),
        "hypotheses": hypotheses(conn, sessions, with_data, by_session),
        "include_demo": include_demo,
        "demo_available": conn.execute("SELECT count(*) AS n FROM app.team_settings WHERE is_demo AND demo_kind = 'history'").fetchone()["n"],
    }


def hypotheses(conn, sessions: list[dict], rows: list[dict], by_session: dict) -> dict:
    """Данные для четырёх исследовательских вопросов концепции (раздел 07)."""
    # H2: психологическая безопасность и доработки.
    h2 = [{"team_id": r["team_id"], "session_id": r["session_id"], "condition": r["condition"],
           "x": r["psych_safety_exit"], "y": r["rework_case_share"], "decision_correct": r["decision_correct"]}
          for r in rows if r["psych_safety_exit"] is not None and r["rework_case_share"] is not None]
    # H3: межотдельные передачи задач вехи и срыв срока.
    h3 = []
    for s in sessions:
        evs = by_session.get((s["team_id"], s["session_id"]), [])
        if not evs:
            continue
        cases = {c["case_id"]: c for c in metrics.case_table(evs)}
        for m in conn.execute(
                """SELECT m.milestone_id, m.key, m.deadline, m.closed_at,
                          array_agg(t.case_id) AS cases
                     FROM app.milestone m JOIN app.task t USING (milestone_id)
                    WHERE m.team_id = %s AND m.session_id = %s AND m.deadline IS NOT NULL GROUP BY m.milestone_id""",
                (s["team_id"], s["session_id"])):
            cross = [cases[c]["cross_department_handovers"] for c in m["cases"] if c in cases]
            late = not (m["closed_at"] and m["closed_at"] <= m["deadline"])
            h3.append({"team_id": s["team_id"], "session_id": s["session_id"], "milestone": m["key"],
                       "condition": s["condition"], "x": mean(cross) if cross else 0.0, "late": late})
    # H4: неформальное лидерство — центральность против выбора коллег.
    h4 = []
    for s in sessions:
        evs = by_session.get((s["team_id"], s["session_id"]), [])
        load = metrics.node_load(metrics.handover_network(evs)) if evs else {}
        noms = Counter(r["to_participant"] for r in conn.execute(
            """SELECT to_participant FROM research.peer_nomination
                WHERE team_id = %s AND session_id = %s AND question = 'actual_leader'""",
            (s["team_id"], s["session_id"])))
        members = conn.execute(
            """SELECT p.participant_id, coalesce(d.orig_role_slug, d.role_slug) AS role_slug
                 FROM research.participant p JOIN app.device d USING (participant_id) WHERE p.team_id = %s""",
            (s["team_id"],)).fetchall()
        voters = max(1, (s["participants"] or 1) - 1)
        if not noms and not load:
            continue
        for m in members:
            h4.append({"team_id": s["team_id"], "participant_id": m["participant_id"], "condition": s["condition"],
                       "pm": m["role_slug"] == "pm", "x": load.get(m["participant_id"], 0.0),
                       "y": noms.get(m["participant_id"], 0) / voters})
    return {
        "h1": {"metric": ["waiting_minutes", "rework_case_share"]},
        "h2": {"points": h2, "r": pearson([p["x"] for p in h2], [p["y"] for p in h2]), "n": len(h2)},
        "h3": {"points": h3, "r": pearson([p["x"] for p in h3], [float(p["late"]) for p in h3]), "n": len(h3)},
        "h4": {"points": h4, "r": pearson([p["x"] for p in h4], [p["y"] for p in h4]), "n": len(h4),
               "r_pm": pearson([float(p["pm"]) for p in h4], [p["y"] for p in h4])},
    }


# ================================================================ выгрузки

def _csv(rows: list[dict], columns: list[str]) -> bytes:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in columns})
    return buf.getvalue().encode("utf-8")


_DEMO = "(%(demo)s OR NOT EXISTS (SELECT 1 FROM research.team tt WHERE tt.team_id = x.team_id AND tt.is_demo))"

TABLE_EXPORTS: dict[str, tuple[str, list[str]]] = {
    "sessions.csv": (
        f"""SELECT x.team_id, x.session_id, x.condition, x.scenario_version, x.protocol->>'protocol_id' AS protocol_id,
                   x.started_at, x.ended_at FROM research.session x WHERE {_DEMO} ORDER BY x.team_id, x.session_id""",
        ["team_id", "session_id", "condition", "scenario_version", "protocol_id", "started_at", "ended_at"]),
    "participants.csv": (
        f"""SELECT x.participant_id, x.team_id, x.role, x.department, x.consent_at FROM research.participant x
             WHERE {_DEMO} ORDER BY x.participant_id""",
        ["participant_id", "team_id", "role", "department", "consent_at"]),
    "surveys.csv": (
        f"""SELECT x.participant_id, x.team_id, x.session_id, s.condition, x.phase, x.instrument, x.item,
                   x.value, x.text_value, x.answered_at
              FROM research.survey_response x JOIN research.session s USING (team_id, session_id) WHERE {_DEMO}
             ORDER BY x.team_id, x.session_id, x.phase, x.participant_id, x.instrument, x.item""",
        ["participant_id", "team_id", "session_id", "condition", "phase", "instrument", "item", "value", "text_value",
         "answered_at"]),
    "nominations.csv": (
        f"""SELECT x.from_participant, x.to_participant, x.team_id, x.session_id, x.question
              FROM research.peer_nomination x WHERE {_DEMO} ORDER BY x.team_id, x.session_id""",
        ["from_participant", "to_participant", "team_id", "session_id", "question"]),
    "decisions.csv": (
        f"""SELECT x.decision_id, x.team_id, x.session_id, x.case_id, x.title, x.proposed_by,
                   x.alternatives::text AS alternatives, x.chosen, x.rationale, x.decided_at
              FROM research.decision x WHERE {_DEMO} ORDER BY x.decided_at""",
        ["decision_id", "team_id", "session_id", "case_id", "title", "proposed_by", "alternatives", "chosen",
         "rationale", "decided_at"]),
    "injects.csv": (
        f"""SELECT x.inject_id, x.team_id, x.session_id, x.kind, x.ts, x.payload::text AS payload
              FROM research.inject x WHERE {_DEMO} ORDER BY x.ts""",
        ["inject_id", "team_id", "session_id", "kind", "ts", "payload"]),
    "interventions.csv": (
        f"""SELECT x.intervention_id, x.team_id, x.session_id, x.kind, x.payload::text AS payload, x.source,
                   x.started_at, x.ends_at FROM research.intervention x WHERE {_DEMO} ORDER BY x.started_at""",
        ["intervention_id", "team_id", "session_id", "kind", "payload", "source", "started_at", "ends_at"]),
    "fact_shares.csv": (
        f"""SELECT x.team_id, x.session_id, x.fact_id, x.participant_id, x.shared_at FROM research.fact_share x
             WHERE {_DEMO} ORDER BY x.shared_at""",
        ["team_id", "session_id", "fact_id", "participant_id", "shared_at"]),
    "preferences.csv": (
        f"""SELECT x.participant_id, x.team_id, x.session_id, x.stage, x.option, x.confidence, x.answered_at
              FROM research.preference x WHERE {_DEMO} ORDER BY x.answered_at""",
        ["participant_id", "team_id", "session_id", "stage", "option", "confidence", "answered_at"]),
    "votes.csv": (
        f"""SELECT x.vote_id, x.participant_id, x.team_id, x.session_id, x.option, x.voted_at FROM research.vote_log x
             WHERE {_DEMO} ORDER BY x.vote_id""",
        ["vote_id", "participant_id", "team_id", "session_id", "option", "voted_at"]),
    "kudos.csv": (
        f"""SELECT x.kudos_id, x.team_id, x.session_id, x.from_participant, x.to_participant, x.kind, x.sent_at
              FROM research.kudos x WHERE {_DEMO} ORDER BY x.kudos_id""",
        ["kudos_id", "team_id", "session_id", "from_participant", "to_participant", "kind", "sent_at"]),
    "help.csv": (
        f"""SELECT x.help_id, x.team_id, x.session_id, x.participant_id, x.case_id, x.created_at, x.helper_id,
                   x.helped_at, x.resolved_at FROM research.help_request x WHERE {_DEMO} ORDER BY x.help_id""",
        ["help_id", "team_id", "session_id", "participant_id", "case_id", "created_at", "helper_id", "helped_at",
         "resolved_at"]),
    "weather.csv": (
        f"""SELECT x.team_id, x.session_id, x.participant_id, x.value, x.set_at FROM research.mood x
             WHERE {_DEMO} ORDER BY x.mood_id""",
        ["team_id", "session_id", "participant_id", "value", "set_at"]),
    "messages.csv": (
        f"""SELECT x.message_id, x.team_id, x.session_id, x.participant_id, array_to_string(x.mentions, ' ') AS mentions,
                   x.length, x.case_key, x.during_silence, x.sent_at FROM research.message x WHERE {_DEMO}
             ORDER BY x.message_id""",
        ["message_id", "team_id", "session_id", "participant_id", "mentions", "length", "case_key", "during_silence",
         "sent_at"]),
    "probes.csv": (
        f"""SELECT x.probe_id, x.team_id, x.session_id, x.kind, x.question, x.truth, x.source, x.fired_at, x.closes_at,
                   a.participant_id, a.answer, a.answered_at
              FROM research.probe x LEFT JOIN research.probe_answer a USING (probe_id) WHERE {_DEMO}
             ORDER BY x.probe_id""",
        ["probe_id", "team_id", "session_id", "kind", "question", "truth", "source", "fired_at", "closes_at",
         "participant_id", "answer", "answered_at"]),
    "charter.csv": (
        f"""SELECT x.team_id, x.session_id, x.field, x.body, x.participant_id, x.updated_at FROM research.charter x
             WHERE {_DEMO}""",
        ["team_id", "session_id", "field", "body", "participant_id", "updated_at"]),
    "retro.csv": (
        f"""SELECT x.card_id, x.team_id, x.session_id, x.lane, x.body, x.created_at,
                   (SELECT count(*) FROM research.retro_vote v WHERE v.card_id = x.card_id) AS votes
              FROM research.retro_card x WHERE {_DEMO} ORDER BY x.card_id""",
        ["card_id", "team_id", "session_id", "lane", "body", "created_at", "votes"]),
    "agreements.csv": (
        f"""SELECT x.agreement_id, x.team_id, x.session_id, x.body, c.session_id AS checked_in, c.participant_id,
                   c.score FROM research.agreement x LEFT JOIN research.agreement_check c USING (agreement_id)
             WHERE {_DEMO} ORDER BY x.agreement_id""",
        ["agreement_id", "team_id", "session_id", "body", "checked_in", "participant_id", "score"]),
    "strengths.csv": (
        f"""SELECT x.from_participant, x.to_participant, x.team_id, x.session_id, x.strength FROM research.strength x
             WHERE {_DEMO}""",
        ["from_participant", "to_participant", "team_id", "session_id", "strength"]),
    "achievements.csv": (
        f"""SELECT x.team_id, x.session_id, x.key, x.unlocked_at FROM research.achievement x WHERE {_DEMO}
             ORDER BY x.unlocked_at""",
        ["team_id", "session_id", "key", "unlocked_at"]),
}

MEDIA = {".csv": "text/csv; charset=utf-8", ".xes": "application/xml", ".json": "application/json",
         ".zip": "application/zip"}


def export_file(conn, name: str, include_demo: bool = False) -> tuple[bytes, str] | None:
    if name in TABLE_EXPORTS:
        sql, cols = TABLE_EXPORTS[name]
        return _csv(conn.execute(sql, {"demo": include_demo}).fetchall(), cols), MEDIA[".csv"]
    writers = {"events.csv": write_csv, "events.xes": export.to_xes, "events.ocel.json": export.to_ocel2}
    if name in writers:
        events = events_for(conn, include_demo=include_demo)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / name
            writers[name](events, path)
            return path.read_bytes(), MEDIA[path.suffix]
    if name == "all.zip":
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for n in [*TABLE_EXPORTS, *writers]:
                data, _ = export_file(conn, n, include_demo)
                z.writestr(n, data)
            z.writestr("README.txt", (
                "Tessera — выгрузка данных исследования.\n"
                "Во всех файлах только псевдонимы участников. Минуты и время — UTC.\n"
                f"Демо-данные {'включены' if include_demo else 'исключены'}.\n"
                "Журнал процесса: events.csv / events.xes / events.ocel.json (PM4Py).\n").encode("utf-8"))
        return buf.getvalue(), MEDIA[".zip"]
    return None
