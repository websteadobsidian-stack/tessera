"""Модель журнала событий Tessera (раздел 05 концепции).

Одна строка журнала — одно неизменяемое событие. Поля совпадают с таблицей
«Журнал событий»; `attrs` хранит старое/новое значение, приоритет, срок и т. п.
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterable

# Эталонный процесс задачи (раздел 03): Анализ → Проектирование → Исполнение → Контроль → Сдача.
STAGES = ["Анализ", "Проектирование", "Исполнение", "Контроль", "Сдача"]
STAGE_INDEX = {s: i for i, s in enumerate(STAGES)}

# Допустимые переходы эталонной модели: шаг вперёд плюс штатные возвраты на доработку.
REFERENCE_TRANSITIONS = {
    (STAGES[i], STAGES[i + 1]) for i in range(len(STAGES) - 1)
} | {("Контроль", "Исполнение"), ("Проектирование", "Анализ")}

# Служебные активности. Вход в этап записывается активностью с именем этапа,
# фактическое начало работы — START_ACTIVITY; разница между ними — время ожидания.
START_ACTIVITY = "Взята в работу"
MILESTONE_CLOSED = "Веха закрыта"  # attrs: {"deadline": ISO-время}
MILESTONE_DEADLINE_CHANGED = "Срок вехи изменён"  # attrs: {"old": ..., "new": ...}

CONDITIONS = ["kanban", "sprints", "hierarchy", "self_org"]

FIELDS = [
    "case_id",
    "activity",
    "timestamp",
    "resource",
    "role",
    "department",
    "team_id",
    "session_id",
    "condition",
    "milestone_id",
    "attrs",
]
REQUIRED = ["case_id", "activity", "timestamp", "resource", "team_id", "session_id", "condition"]


@dataclass(frozen=True)
class Event:
    case_id: str
    activity: str
    timestamp: datetime
    resource: str
    team_id: str
    session_id: str
    condition: str
    role: str = ""
    department: str = ""
    milestone_id: str = ""
    attrs: dict = field(default_factory=dict, compare=False, hash=False)

    @property
    def team_key(self) -> tuple[str, str]:
        return (self.team_id, self.session_id)

    def to_row(self) -> dict[str, str]:
        return {
            "case_id": self.case_id,
            "activity": self.activity,
            "timestamp": self.timestamp.isoformat(sep=" "),
            "resource": self.resource,
            "role": self.role,
            "department": self.department,
            "team_id": self.team_id,
            "session_id": self.session_id,
            "condition": self.condition,
            "milestone_id": self.milestone_id,
            "attrs": json.dumps(self.attrs, ensure_ascii=False) if self.attrs else "",
        }


class EventLogError(ValueError):
    pass


def event_from_row(row: dict[str, str], line: int | None = None) -> Event:
    where = f"строка {line}: " if line is not None else ""
    missing = [f for f in REQUIRED if not (row.get(f) or "").strip()]
    if missing:
        raise EventLogError(f"{where}не заполнены поля {', '.join(missing)}")
    try:
        ts = datetime.fromisoformat(row["timestamp"].strip())
    except ValueError as e:
        raise EventLogError(f"{where}некорректный timestamp {row['timestamp']!r}") from e
    raw_attrs = (row.get("attrs") or "").strip()
    try:
        attrs = json.loads(raw_attrs) if raw_attrs else {}
    except json.JSONDecodeError as e:
        raise EventLogError(f"{where}attrs не является JSON: {raw_attrs!r}") from e
    if not isinstance(attrs, dict):
        raise EventLogError(f"{where}attrs должен быть JSON-объектом")
    return Event(
        case_id=row["case_id"].strip(),
        activity=row["activity"].strip(),
        timestamp=ts,
        resource=row["resource"].strip(),
        team_id=row["team_id"].strip(),
        session_id=row["session_id"].strip(),
        condition=row["condition"].strip(),
        role=(row.get("role") or "").strip(),
        department=(row.get("department") or "").strip(),
        milestone_id=(row.get("milestone_id") or "").strip(),
        attrs=attrs,
    )


def read_csv(path: str | Path) -> list[Event]:
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        absent = [c for c in REQUIRED if c not in (reader.fieldnames or [])]
        if absent:
            raise EventLogError(f"в CSV нет колонок: {', '.join(absent)}")
        events = [event_from_row(row, line=i) for i, row in enumerate(reader, start=2)]
    return sort_events(events)


def write_csv(events: Iterable[Event], path: str | Path) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        for e in events:
            writer.writerow(e.to_row())


def sort_events(events: Iterable[Event]) -> list[Event]:
    # Сортировка устойчивая: события с одинаковым временем сохраняют порядок записи.
    return sorted(events, key=lambda e: e.timestamp)


def group_by_case(events: Iterable[Event]) -> dict[str, list[Event]]:
    cases: dict[str, list[Event]] = {}
    for e in sort_events(events):
        cases.setdefault(e.case_id, []).append(e)
    return cases


def group_by_team(events: Iterable[Event]) -> dict[tuple[str, str], list[Event]]:
    teams: dict[tuple[str, str], list[Event]] = {}
    for e in sort_events(events):
        teams.setdefault(e.team_key, []).append(e)
    return teams
