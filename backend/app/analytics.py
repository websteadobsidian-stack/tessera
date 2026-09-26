"""Дебрифинг, сравнение условий и выгрузки. Метрики считает пакет tessera."""

from __future__ import annotations

import csv
import io
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean

from tessera import export, metrics
from tessera.model import STAGES, START_ACTIVITY, Event, write_csv

from . import content
from .core import BACKLOG

_EVENTS_SQL = """
SELECT e.case_id, e.activity, e.ts, e.resource,
       coalesce(e.role, p.role, '') AS role, coalesce(e.department, p.department, '') AS department,
       e.team_id, e.session_id, s.condition, coalesce(e.milestone_id, '') AS milestone_id, e.attrs
  FROM research.event e
  JOIN research.session s USING (team_id, session_id)
  LEFT JOIN research.participant p ON p.participant_id = e.resource
 WHERE (%(team)s::text IS NULL OR e.team_id = %(team)s) AND (%(session)s::text IS NULL OR e.session_id = %(session)s)
 ORDER BY e.ts, e.event_id
"""


def events_for(conn, team_id: str | None = None, session_id: str | None = None) -> list[Event]:
    rows = conn.execute(_EVENTS_SQL, {"team": team_id, "session": session_id}).fetchall()
    return [
        Event(case_id=r["case_id"], activity=r["activity"], timestamp=r["ts"], resource=r["resource"],
              team_id=r["team_id"], session_id=r["session_id"], condition=r["condition"], role=r["role"],
              department=r["department"], milestone_id=r["milestone_id"], attrs=r["attrs"] or {})
        for r in rows
    ]


# ---------------------------------------------------------------- опросы

def _scored(instrument: dict, item_id: str, value: float) -> float:
    item = next((i for i in instrument["items"] if i["id"] == item_id), {})
    if item.get("reverse"):
        return instrument["min"] + instrument["max"] - value
    return value


def survey_scores(conn, team_id: str | None = None, session_id: str | None = None) -> dict:
    """Средние баллы шкал: {(team, session): {phase: {instrument: mean}}} с учётом обратных пунктов."""
    instruments = content.surveys()["instruments"]
    rows = conn.execute(
        """SELECT participant_id, team_id, session_id, phase, instrument, item, value
             FROM research.survey_response
            WHERE value IS NOT NULL
              AND (%(team)s::text IS NULL OR team_id = %(team)s)
              AND (%(session)s::text IS NULL OR session_id = %(session)s)""",
        {"team": team_id, "session": session_id},
    ).fetchall()
    # Сначала балл участника по шкале, затем среднее по команде.
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


# ---------------------------------------------------------------- дебрифинг

def _people(conn, team_id: str) -> list[dict]:
    return conn.execute(
        """SELECT p.participant_id, p.role, p.department, d.role_slug, m.person AS display_name
             FROM research.participant p
             LEFT JOIN app.device d ON d.participant_id = p.participant_id
             LEFT JOIN identity.participant_map m ON m.participant_id = p.participant_id
            WHERE p.team_id = %s ORDER BY p.participant_id""",
        (team_id,),
    ).fetchall()


def _cumulative_flow(events: list[Event], task_ids: list[str], start, end) -> list[dict]:
    """Сколько задач находится на каждом этапе в каждую минуту рабочей фазы."""
    if start is None or end is None or end <= start:
        return []
    stage_events = sorted((e for e in events if e.activity in STAGES), key=lambda e: e.timestamp)
    where = {cid: BACKLOG for cid in task_ids}
    minutes = int((end - start).total_seconds() // 60) + 1
    i, out = 0, []
    for m in range(minutes + 1):
        t = start + (end - start) * (m / minutes) if minutes else end
        while i < len(stage_events) and stage_events[i].timestamp <= t:
            e = stage_events[i]
            if e.case_id in where:
                where[e.case_id] = e.activity
            i += 1
        counts = Counter(where.values())
        out.append({"minute": round((t - start).total_seconds() / 60, 1),
                    **{s: counts.get(s, 0) for s in [BACKLOG, *STAGES]}})
    return out


def debrief(conn, session: dict) -> dict:
    team_id, session_id = session["team_id"], session["session_id"]
    sc = content.scenario(session["scenario_version"])
    events = events_for(conn, team_id, session_id)
    people = _people(conn, team_id)
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

    nominations = conn.execute(
        """SELECT from_participant AS source, to_participant AS target, question
             FROM research.peer_nomination WHERE team_id = %s AND session_id = %s""",
        (team_id, session_id),
    ).fetchall()
    decision = conn.execute(
        """SELECT chosen, proposed_by, rationale, decided_at FROM research.decision
            WHERE team_id = %s AND session_id = %s AND case_id = %s
            ORDER BY decided_at DESC LIMIT 1""",
        (team_id, session_id, f"{team_id}/{session_id}/DECISION-{sc['decision']['key']}"),
    ).fetchone()
    milestones = conn.execute(
        """SELECT key, title, deadline, closed_at FROM app.milestone
            WHERE team_id = %s AND session_id = %s ORDER BY key""",
        (team_id, session_id),
    ).fetchall()
    injects = conn.execute(
        "SELECT kind, ts FROM research.inject WHERE team_id = %s AND session_id = %s ORDER BY ts",
        (team_id, session_id),
    ).fetchall()

    start = session.get("work_started_at")
    end = max((e.timestamp for e in events), default=None)
    scores = survey_scores(conn, team_id, session_id).get((team_id, session_id), {})

    return {
        "team_id": team_id,
        "session_id": session_id,
        "condition": session["condition"],
        "work_started_at": start,
        "summary": summary,
        "dfg": metrics.stage_dfg(events),
        "waiting_by_stage": {s: mean(v) * 60 for s, v in waiting.items()},
        "people": [
            {**p, "load": load.get(p["participant_id"], 0.0), "started": starts[p["participant_id"]],
             "completed": completed[p["participant_id"]], "reworks_sent": reworks_sent[p["participant_id"]]}
            for p in people
        ],
        "handover": [{"source": s, "target": t, "weight": w} for (s, t), w in edges.items()],
        "nominations": nominations,
        "tasks": [
            {**t, "trace": case_rows.get(t["case_id"], {}).get("trace", ""),
             "cycle_minutes": (case_rows[t["case_id"]]["cycle_hours"] or 0) * 60
             if t["case_id"] in case_rows and case_rows[t["case_id"]]["cycle_hours"] is not None else None,
             "waiting_minutes": (case_rows[t["case_id"]]["waiting_hours"] or 0) * 60
             if t["case_id"] in case_rows and case_rows[t["case_id"]]["waiting_hours"] is not None else None,
             "reworks": case_rows.get(t["case_id"], {}).get("reworks", 0)}
            for t in tasks
        ],
        "milestones": milestones,
        "decision": {
            "title": sc["decision"]["title"],
            "options": sc["decision"]["options"],
            "chosen": decision["chosen"] if decision else None,
            "correct": sc["decision"]["correct"],
            "is_correct": (decision["chosen"] == sc["decision"]["correct"]) if decision else None,
        },
        "injects": [{"kind": i["kind"], "minute": (i["ts"] - start).total_seconds() / 60 if start else None,
                     "title": next((x["title"] for x in sc["injects"] if x["key"] == i["kind"]), i["kind"])}
                    for i in injects],
        "flow": _cumulative_flow(events, [t["case_id"] for t in tasks], start, end),
        "surveys": scores,
        "events": len(events),
    }


# ---------------------------------------------------------------- сравнение условий

def research(conn) -> dict:
    events = events_for(conn)
    sessions = conn.execute(
        """SELECT s.team_id, s.session_id, s.condition, s.scenario_version, ts.label,
                  (SELECT count(*) FROM research.participant p WHERE p.team_id = s.team_id) AS participants
             FROM research.session s JOIN app.team_settings ts USING (team_id)
            ORDER BY s.team_id, s.session_id"""
    ).fetchall()
    scores = survey_scores(conn)
    decisions = {
        (r["team_id"], r["session_id"]): r["chosen"]
        for r in conn.execute(
            """SELECT DISTINCT ON (team_id, session_id) team_id, session_id, chosen
                 FROM research.decision WHERE case_id LIKE '%%/DECISION-%%'
                ORDER BY team_id, session_id, decided_at DESC"""
        ).fetchall()
    }
    by_key = {(s["team_id"], s["session_id"]): s for s in metrics.summarize(events)} if events else {}

    rows = []
    for s in sessions:
        key = (s["team_id"], s["session_id"])
        sc_scores = scores.get(key, {})
        row = dict(by_key.get(key) or {"team_id": s["team_id"], "session_id": s["session_id"],
                                       "condition": s["condition"], "cases": 0})
        correct = content.scenario(s["scenario_version"])["decision"]["correct"]
        row.update(
            label=s["label"], participants=s["participants"],
            decision_correct=None if key not in decisions else float(decisions[key] == correct),
            psych_safety_entry=sc_scores.get("entry", {}).get("psych_safety_7", {}).get("mean"),
            psych_safety_exit=sc_scores.get("exit", {}).get("psych_safety_7", {}).get("mean"),
            workload_tlx=sc_scores.get("pulse", {}).get("nasa_tlx_raw", {}).get("mean"),
        )
        rows.append(row)
    with_data = [r for r in rows if r.get("cases")]
    return {"sessions": rows, "conditions": metrics.by_condition(with_data) if with_data else {}}


# ---------------------------------------------------------------- выгрузки

def _csv(rows: list[dict], columns: list[str]) -> bytes:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in columns})
    return buf.getvalue().encode("utf-8")


TABLE_EXPORTS = {
    "surveys.csv": (
        """SELECT r.participant_id, r.team_id, r.session_id, s.condition, r.phase, r.instrument, r.item,
                  r.value, r.text_value, r.answered_at
             FROM research.survey_response r JOIN research.session s USING (team_id, session_id)
            ORDER BY r.team_id, r.session_id, r.phase, r.participant_id, r.instrument, r.item""",
        ["participant_id", "team_id", "session_id", "condition", "phase", "instrument", "item", "value",
         "text_value", "answered_at"],
    ),
    "nominations.csv": (
        """SELECT n.from_participant, n.to_participant, n.team_id, n.session_id, s.condition, n.question, n.weight
             FROM research.peer_nomination n JOIN research.session s USING (team_id, session_id)
            ORDER BY n.team_id, n.session_id, n.question""",
        ["from_participant", "to_participant", "team_id", "session_id", "condition", "question", "weight"],
    ),
    "decisions.csv": (
        """SELECT d.decision_id, d.team_id, d.session_id, s.condition, d.case_id, d.proposed_by,
                  d.alternatives::text AS alternatives, d.chosen, d.rationale, d.decided_at
             FROM research.decision d JOIN research.session s USING (team_id, session_id) ORDER BY d.decided_at""",
        ["decision_id", "team_id", "session_id", "condition", "case_id", "proposed_by", "alternatives",
         "chosen", "rationale", "decided_at"],
    ),
    "injects.csv": (
        """SELECT i.inject_id, i.team_id, i.session_id, s.condition, i.kind, i.ts, i.payload::text AS payload
             FROM research.inject i JOIN research.session s USING (team_id, session_id) ORDER BY i.ts""",
        ["inject_id", "team_id", "session_id", "condition", "kind", "ts", "payload"],
    ),
    "participants.csv": (
        """SELECT participant_id, team_id, role, department, consent_at FROM research.participant
            ORDER BY participant_id""",
        ["participant_id", "team_id", "role", "department", "consent_at"],
    ),
    "sessions.csv": (
        """SELECT team_id, session_id, condition, scenario_version, started_at, ended_at
             FROM research.session ORDER BY team_id, session_id""",
        ["team_id", "session_id", "condition", "scenario_version", "started_at", "ended_at"],
    ),
}

MEDIA = {".csv": "text/csv; charset=utf-8", ".xes": "application/xml", ".json": "application/json"}


def export_file(conn, name: str) -> tuple[bytes, str] | None:
    if name in TABLE_EXPORTS:
        sql, cols = TABLE_EXPORTS[name]
        return _csv(conn.execute(sql).fetchall(), cols), MEDIA[".csv"]
    writers = {"events.csv": write_csv, "events.xes": export.to_xes, "events.ocel.json": export.to_ocel2}
    if name not in writers:
        return None
    events = events_for(conn)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / name
        writers[name](events, path)
        return path.read_bytes(), MEDIA[path.suffix]
