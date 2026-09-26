"""Псевдонимизация на входе (разделы 08–09 концепции).

В исследовательский журнал попадают только коды P-01, P-02, …; таблица соответствия
пишется в отдельный файл, хранится отдельно от данных и уничтожается после сбора.
"""

from __future__ import annotations

import csv
from dataclasses import replace
from pathlib import Path
from typing import Iterable

from .model import Event


class Pseudonymizer:
    def __init__(self, prefix: str = "P", mapping: dict[str, str] | None = None):
        self.prefix = prefix
        self.mapping: dict[str, str] = dict(mapping or {})

    def code(self, identity: str) -> str:
        if identity not in self.mapping:
            n = len(self.mapping) + 1
            self.mapping[identity] = f"{self.prefix}-{n:02d}"
        return self.mapping[identity]

    def apply(self, events: Iterable[Event]) -> list[Event]:
        return [replace(e, resource=self.code(e.resource)) for e in events]

    @classmethod
    def load(cls, path: str | Path, prefix: str = "P") -> "Pseudonymizer":
        with open(path, newline="", encoding="utf-8") as f:
            return cls(prefix, {row["identity"]: row["code"] for row in csv.DictReader(f)})

    def save(self, path: str | Path) -> None:
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["identity", "code"])
            w.writerows(self.mapping.items())
