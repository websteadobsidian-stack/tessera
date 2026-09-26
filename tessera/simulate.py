"""Синтетический журнал компании «Меридиан» для прогона конвейера до пилота.

ВАЖНО: параметры условий заданы вручную и лишь имитируют правдоподобные различия.
Эти данные годятся для проверки выгрузок, метрик и дашборда дебрифинга, но не для выводов.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import datetime, timedelta

from .model import (
    CONDITIONS,
    MILESTONE_CLOSED,
    MILESTONE_DEADLINE_CHANGED,
    STAGES,
    START_ACTIVITY,
    Event,
    sort_events,
)

# Роль → (отдел, этапы, за которые отвечает). Пять ролей, как в MVP.
ROLES = [
    ("аналитик", "отдел анализа", ["Анализ"]),
    ("архитектор", "отдел проектирования", ["Проектирование"]),
    ("исполнитель", "производство", ["Исполнение"]),
    ("исполнитель", "производство", ["Исполнение"]),
    ("контролёр", "отдел качества", ["Контроль", "Сдача"]),
]


@dataclass(frozen=True)
class ConditionParams:
    wait_min: float      # среднее ожидание перед началом работы на этапе, минуты
    rework_p: float      # вероятность возврата с контроля на исполнение
    via_manager: bool    # передачи идут через назначенного руководителя


PARAMS = {
    "kanban": ConditionParams(wait_min=2.0, rework_p=0.15, via_manager=False),
    "sprints": ConditionParams(wait_min=3.5, rework_p=0.20, via_manager=False),
    "hierarchy": ConditionParams(wait_min=5.0, rework_p=0.25, via_manager=True),
    "self_org": ConditionParams(wait_min=4.0, rework_p=0.30, via_manager=False),
}


def simulate_team(team_id: str, session_id: str, condition: str, start: datetime,
                  rng: random.Random, n_tasks: int = 8, first_code: int = 1) -> list[Event]:
    p = PARAMS[condition]
    people = [
        (f"P-{first_code + i:02d}", role, dept, stages)
        for i, (role, dept, stages) in enumerate(ROLES)
    ]
    # В иерархии руководителем назначается аналитик — он же распределяет задачи.
    manager = people[0]
    by_stage: dict[str, list[tuple]] = {}
    for person in people:
        for s in person[3]:
            by_stage.setdefault(s, []).append(person)

    milestones = {
        "M-1": start + timedelta(minutes=30),
        "M-2": start + timedelta(minutes=55),
    }
    events: list[Event] = []

    def ev(case, activity, ts, person, milestone="", **attrs):
        ts = ts.replace(microsecond=0)
        events.append(Event(case_id=case, activity=activity, timestamp=ts, resource=person[0],
                            role=person[1], department=person[2], team_id=team_id,
                            session_id=session_id, condition=condition, milestone_id=milestone,
                            attrs=attrs))

    done_at: dict[str, datetime] = {}
    for n in range(n_tasks):
        case = f"{team_id}-TASK-{n + 1:03d}"
        milestone = "M-1" if n < n_tasks // 2 else "M-2"
        t = start + timedelta(minutes=rng.uniform(0, 20) + (0 if milestone == "M-1" else 10))
        mover = manager
        i = 0
        prev = None
        while i < len(STAGES):
            stage = STAGES[i]
            ev(case, stage, t, manager if p.via_manager else mover, milestone,
               **({"old": prev, "new": stage} if prev else {}))
            if stage == STAGES[-1]:
                done_at[case] = t
                break
            worker = rng.choice(by_stage[stage])
            t += timedelta(minutes=rng.expovariate(1 / p.wait_min))
            ev(case, START_ACTIVITY, t, worker, milestone)
            t += timedelta(minutes=rng.uniform(1.5, 4.0))
            prev, mover = stage, worker
            if stage == "Контроль" and rng.random() < p.rework_p:
                i = STAGES.index("Исполнение")
            elif stage == "Проектирование" and rng.random() < p.rework_p / 2:
                i = STAGES.index("Анализ")
            else:
                i += 1
        done_at.setdefault(case, t)

    for mid, deadline in milestones.items():
        tasks = [c for c in done_at if (int(c[-3:]) - 1 < n_tasks // 2) == (mid == "M-1")]
        closed = max(done_at[c] for c in tasks) + timedelta(minutes=1)
        if closed > deadline and rng.random() < 0.5:
            new = deadline + timedelta(minutes=10)
            ev(mid, MILESTONE_DEADLINE_CHANGED, deadline - timedelta(minutes=2), manager, mid,
               old=deadline.isoformat(), new=new.isoformat())
            deadline = new
        ev(mid, MILESTONE_CLOSED, closed, people[-1], mid, deadline=deadline.isoformat())

    return sort_events(events)


def simulate(teams_per_condition: int = 2, seed: int = 42,
             start: datetime = datetime(2026, 11, 12, 10, 0)) -> list[Event]:
    rng = random.Random(seed)
    events: list[Event] = []
    k = 0
    for condition in CONDITIONS:
        for _ in range(teams_per_condition):
            k += 1
            session_start = start + timedelta(days=k - 1)
            events += simulate_team(f"T-{k:02d}", "S-1", condition, session_start, rng,
                                    first_code=(k - 1) * len(ROLES) + 1)
    return sort_events(events)
