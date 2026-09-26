"""Сценарии и опросники: версионируемые JSON-файлы (раздел 08, «воспроизводимость»)."""

from __future__ import annotations

import json
from functools import cache

from . import config


@cache
def scenarios() -> dict[str, dict]:
    result = {}
    for path in sorted((config.CONTENT_DIR / "scenarios").glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        result[data["version"]] = data
    return result


def scenario(version: str) -> dict:
    return scenarios()[version]


def default_scenario() -> str:
    return sorted(scenarios())[-1]


@cache
def surveys() -> dict:
    return json.loads((config.CONTENT_DIR / "instruments" / "surveys.json").read_text(encoding="utf-8"))


def role(sc: dict, slug: str | None) -> dict | None:
    return next((r for r in sc["roles"] if r["slug"] == slug), None)


def phase_spec(phase: str) -> dict | None:
    s = surveys()
    spec = s["phases"].get(phase)
    if spec is None:
        return None
    return {
        "phase": phase,
        "instruments": [{"id": i, **s["instruments"][i]} for i in spec["instruments"]],
        "nominations": s["nominations"] if spec["nominations"] else None,
    }
