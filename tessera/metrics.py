"""Процессные и сетевые метрики (раздел 06 концепции).

Считаются без внешних зависимостей, чтобы дебрифинг можно было собрать сразу после
сессии. Для карт процессов и conformance по token replay используйте PM4Py поверх
выгрузки XES (см. tessera.export).
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime
from statistics import mean, median
from typing import Iterable

from .model import (
    MILESTONE_CLOSED,
    MILESTONE_DEADLINE_CHANGED,
    REFERENCE_TRANSITIONS,
    STAGE_INDEX,
    STAGES,
    START_ACTIVITY,
    Event,
    group_by_case,
    group_by_team,
)


_START = "^"
_ALLOWED = REFERENCE_TRANSITIONS | {(_START, STAGES[0])}


def _hours(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds() / 3600


@dataclass
class CaseMetrics:
    case_id: str
    trace: tuple[str, ...]
    completed: bool
    cycle_hours: float | None
    waiting_hours: float | None  # None, если в кейсе нет ни одного события START_ACTIVITY
    waiting_by_stage: dict[str, float]
    reworks: int
    fitness: float
    cross_department_handovers: int


def case_metrics(case_id: str, events: list[Event]) -> CaseMetrics | None:
    """Метрики одной задачи. Кейсы без событий этапов (например, вехи) пропускаются."""
    stage_events = [e for e in events if e.activity in STAGE_INDEX]
    if not stage_events:
        return None
    trace = tuple(e.activity for e in stage_events)

    last = STAGES[-1]
    done = next((e for e in stage_events if e.activity == last), None)
    cycle = _hours(stage_events[0].timestamp, done.timestamp) if done else None

    # Ожидание: от входа в этап до первого «Взята в работу» в этом же посещении этапа.
    waiting_by_stage: dict[str, float] = defaultdict(float)
    has_starts = False
    current: Event | None = None
    started = False
    for e in events:
        if e.activity in STAGE_INDEX:
            current, started = e, False
        elif e.activity == START_ACTIVITY and current is not None and not started:
            waiting_by_stage[current.activity] += _hours(current.timestamp, e.timestamp)
            started = has_starts = True

    transitions = list(zip(trace, trace[1:]))
    reworks = sum(1 for a, b in transitions if STAGE_INDEX[b] < STAGE_INDEX[a])
    # Упрощённый fitness: доля переходов, разрешённых эталоном, включая виртуальный старт
    # (задача должна начинаться с анализа). Это не token replay — его даёт PM4Py.
    checked = [(_START, trace[0]), *transitions]
    fitness = sum(t in _ALLOWED for t in checked) / len(checked)

    cross = sum(
        1
        for a, b in zip(events, events[1:])
        if a.department and b.department and a.department != b.department
    )

    return CaseMetrics(
        case_id=case_id,
        trace=trace,
        completed=done is not None,
        cycle_hours=cycle,
        waiting_hours=sum(waiting_by_stage.values()) if has_starts else None,
        waiting_by_stage=dict(waiting_by_stage),
        reworks=reworks,
        fitness=fitness,
        cross_department_handovers=cross,
    )


def handover_network(events: Iterable[Event]) -> Counter[tuple[str, str]]:
    """Сеть передачи работы (handover of work): ресурс события i → ресурс события i+1 в кейсе."""
    edges: Counter[tuple[str, str]] = Counter()
    for case in group_by_case(events).values():
        for a, b in zip(case, case[1:]):
            if a.resource != b.resource:
                edges[(a.resource, b.resource)] += 1
    return edges


def degree_centralization(edges: Iterable[tuple[str, str]]) -> float:
    """Централизация Фримана по степени для неориентированного невзвешенного графа (0…1)."""
    neighbours: dict[str, set[str]] = defaultdict(set)
    for a, b in edges:
        neighbours[a].add(b)
        neighbours[b].add(a)
    n = len(neighbours)
    if n < 3:
        return 0.0
    degrees = [len(v) for v in neighbours.values()]
    top = max(degrees)
    return sum(top - d for d in degrees) / ((n - 1) * (n - 2))


def node_load(edges: Counter[tuple[str, str]]) -> dict[str, float]:
    """Доля передач, проходящих через участника (взвешенная степень / сумма степеней)."""
    load: Counter[str] = Counter()
    for (a, b), w in edges.items():
        load[a] += w
        load[b] += w
    total = sum(load.values())
    return {r: w / total for r, w in load.most_common()} if total else {}


def _parse_like(value: str, ref: datetime) -> datetime:
    """Срок из attrs; без часового пояса считается заданным в поясе события."""
    d = datetime.fromisoformat(value)
    if (d.tzinfo is None) != (ref.tzinfo is None):
        d = d.replace(tzinfo=ref.tzinfo) if d.tzinfo is None else d.astimezone(ref.tzinfo).replace(tzinfo=None)
    return d


def milestone_metrics(events: Iterable[Event]) -> dict[str, float | int | None]:
    """Соблюдение вех: доля закрытых в исходный и в итоговый срок, средний сдвиг срока."""
    first_deadline: dict[str, datetime] = {}
    final_deadline: dict[str, datetime] = {}
    closed: dict[str, datetime] = {}
    for e in sorted(events, key=lambda e: e.timestamp):
        mid = e.milestone_id or e.case_id
        if e.activity == MILESTONE_DEADLINE_CHANGED:
            old, new = e.attrs.get("old"), e.attrs.get("new")
            if old and mid not in first_deadline:
                first_deadline[mid] = _parse_like(old, e.timestamp)
            if new:
                final_deadline[mid] = _parse_like(new, e.timestamp)
        elif e.activity == MILESTONE_CLOSED:
            closed[mid] = e.timestamp
            if e.attrs.get("deadline"):
                final_deadline[mid] = _parse_like(e.attrs["deadline"], e.timestamp)
    for mid, d in final_deadline.items():
        first_deadline.setdefault(mid, d)

    known = [m for m in closed if m in final_deadline]
    if not known:
        return {"milestones_closed": len(closed), "on_time_original": None,
                "on_time_final": None, "mean_deadline_shift_hours": None}
    return {
        "milestones_closed": len(closed),
        "on_time_original": mean(closed[m] <= first_deadline[m] for m in known),
        "on_time_final": mean(closed[m] <= final_deadline[m] for m in known),
        "mean_deadline_shift_hours": mean(_hours(first_deadline[m], final_deadline[m]) for m in known),
    }


def _mean_or_none(values: list[float]) -> float | None:
    return mean(values) if values else None


def team_summary(events: list[Event]) -> dict:
    """Сводка по одной команде в одной сессии — строка для сравнения условий."""
    cases = [
        m for cid, evs in group_by_case(events).items() if (m := case_metrics(cid, evs)) is not None
    ]
    cycles = [c.cycle_hours for c in cases if c.cycle_hours is not None]
    waits = [c.waiting_hours for c in cases if c.waiting_hours is not None]

    waiting_by_stage: dict[str, list[float]] = defaultdict(list)
    for c in cases:
        for stage, h in c.waiting_by_stage.items():
            waiting_by_stage[stage].append(h)
    stage_wait = {s: mean(v) for s, v in waiting_by_stage.items()}

    edges = handover_network(events)
    load = node_load(edges)
    top_node, top_share = next(iter(load.items()), (None, None))

    return {
        "team_id": events[0].team_id,
        "session_id": events[0].session_id,
        "condition": events[0].condition,
        "cases": len(cases),
        "completed": sum(c.completed for c in cases),
        "cycle_hours_mean": _mean_or_none(cycles),
        "cycle_hours_median": median(cycles) if cycles else None,
        "waiting_hours_mean": _mean_or_none(waits),
        "bottleneck_stage": max(stage_wait, key=stage_wait.get) if stage_wait else None,
        "rework_case_share": _mean_or_none([c.reworks > 0 for c in cases]),
        "reworks_per_case": _mean_or_none([c.reworks for c in cases]),
        "variants": len({c.trace for c in cases}),
        "variant_ratio": len({c.trace for c in cases}) / len(cases) if cases else None,
        "fitness_mean": _mean_or_none([c.fitness for c in cases]),
        "cross_department_handovers_mean": _mean_or_none(
            [c.cross_department_handovers for c in cases]
        ),
        "handover_centralization": degree_centralization(edges),
        "top_node": top_node,
        "top_node_share": top_share,
        **milestone_metrics(events),
    }


def summarize(events: list[Event]) -> list[dict]:
    return [team_summary(evs) for evs in group_by_team(events).values()]


def by_condition(summaries: list[dict]) -> dict[str, dict]:
    """Средние по командам в каждом экспериментальном условии (без весов по числу задач)."""
    groups: dict[str, list[dict]] = defaultdict(list)
    for s in summaries:
        groups[s["condition"]].append(s)
    numeric = list(dict.fromkeys(
        k for s in summaries for k, v in s.items()
        if isinstance(v, (int, float)) and not isinstance(v, bool)
    ))
    result = {}
    for cond, rows in groups.items():
        agg: dict[str, float | int | None] = {"teams": len(rows)}
        for k in numeric:
            vals = [r[k] for r in rows if r[k] is not None]
            agg[k] = mean(vals) if vals else None
        result[cond] = agg
    return result


def case_table(events: list[Event]) -> list[dict]:
    rows = []
    for evs in group_by_case(events).values():
        m = case_metrics(evs[0].case_id, evs)
        if m is None:
            continue
        row = asdict(m)
        row["trace"] = " → ".join(m.trace)
        row["waiting_by_stage"] = "; ".join(f"{k}={v:.2f}" for k, v in m.waiting_by_stage.items())
        row.update(team_id=evs[0].team_id, session_id=evs[0].session_id, condition=evs[0].condition)
        rows.append(row)
    return rows


def stage_dfg(events: Iterable[Event]) -> dict:
    """Граф непосредственного следования этапов: сколько раз и за какое время задачи
    переходили между этапами. Основа карты процесса на дебрифинге."""
    durations: dict[tuple[str, str], list[float]] = defaultdict(list)
    visits: Counter[str] = Counter()
    starts: Counter[str] = Counter()
    ends: Counter[str] = Counter()
    for case in group_by_case(events).values():
        stages = [e for e in case if e.activity in STAGE_INDEX]
        if not stages:
            continue
        starts[stages[0].activity] += 1
        ends[stages[-1].activity] += 1
        visits.update(e.activity for e in stages)
        for a, b in zip(stages, stages[1:]):
            durations[(a.activity, b.activity)].append(_hours(a.timestamp, b.timestamp))
    return {
        "nodes": [{"stage": s, "visits": visits[s]} for s in STAGES],
        "edges": [
            {"source": a, "target": b, "count": len(v), "mean_hours": mean(v),
             "rework": STAGE_INDEX[b] < STAGE_INDEX[a]}
            for (a, b), v in sorted(durations.items(), key=lambda kv: (STAGE_INDEX[kv[0][0]], STAGE_INDEX[kv[0][1]]))
        ],
        "starts": dict(starts),
        "ends": dict(ends),
    }
