"""Экспорт журнала в стандарты process mining: XES (IEEE 1849) и OCEL 2.0 (JSON).

Оба формата читаются PM4Py: pm4py.read_xes(...) и pm4py.read_ocel2_json(...).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET

from .model import Event, group_by_case, sort_events

_XES_NS = "http://www.xes-standard.org/"
_EXTENSIONS = [
    ("Concept", "concept", "http://www.xes-standard.org/concept.xesext"),
    ("Time", "time", "http://www.xes-standard.org/time.xesext"),
    ("Organizational", "org", "http://www.xes-standard.org/org.xesext"),
]


def _attr(parent: ET.Element, key: str, value) -> None:
    if isinstance(value, bool):
        ET.SubElement(parent, "boolean", key=key, value=str(value).lower())
    elif isinstance(value, int):
        ET.SubElement(parent, "int", key=key, value=str(value))
    elif isinstance(value, float):
        ET.SubElement(parent, "float", key=key, value=repr(value))
    elif isinstance(value, (dict, list)):
        ET.SubElement(parent, "string", key=key, value=json.dumps(value, ensure_ascii=False))
    else:
        ET.SubElement(parent, "string", key=key, value=str(value))


def to_xes(events: Iterable[Event], path: str | Path) -> None:
    log = ET.Element("log", {"xes.version": "1849-2016", "xes.features": "", "xmlns": _XES_NS})
    for name, prefix, uri in _EXTENSIONS:
        ET.SubElement(log, "extension", name=name, prefix=prefix, uri=uri)
    ET.SubElement(ET.SubElement(log, "global", scope="trace"), "string",
                  key="concept:name", value="")
    g = ET.SubElement(log, "global", scope="event")
    ET.SubElement(g, "string", key="concept:name", value="")
    ET.SubElement(g, "date", key="time:timestamp", value="1970-01-01T00:00:00")
    ET.SubElement(g, "string", key="org:resource", value="")

    for case_id, case in group_by_case(events).items():
        trace = ET.SubElement(log, "trace")
        _attr(trace, "concept:name", case_id)
        first = case[0]
        for key in ("team_id", "session_id", "condition"):
            _attr(trace, key, getattr(first, key))
        for e in case:
            ev = ET.SubElement(trace, "event")
            _attr(ev, "concept:name", e.activity)
            ET.SubElement(ev, "date", key="time:timestamp", value=e.timestamp.isoformat())
            _attr(ev, "org:resource", e.resource)
            if e.role:
                _attr(ev, "org:role", e.role)
            if e.department:
                _attr(ev, "org:group", e.department)
            if e.milestone_id:
                _attr(ev, "milestone_id", e.milestone_id)
            for k, v in e.attrs.items():
                _attr(ev, f"attr:{k}", v)

    ET.indent(log)
    ET.ElementTree(log).write(path, encoding="utf-8", xml_declaration=True)


def to_ocel2(events: Iterable[Event], path: str | Path) -> None:
    """Объектно-ориентированный журнал: событие связано с задачей, вехой, участником и командой."""
    events = sort_events(events)
    objects: dict[str, dict] = {}

    def obj(oid: str, otype: str) -> str:
        objects.setdefault(oid, {"id": oid, "type": otype, "attributes": [], "relationships": []})
        return oid

    ocel_events = []
    attr_names: dict[str, set[str]] = {}
    for i, e in enumerate(events, start=1):
        rel = [
            {"objectId": obj(e.case_id, "milestone" if e.case_id == e.milestone_id else "task"),
             "qualifier": "case"},
            {"objectId": obj(e.resource, "participant"), "qualifier": "performed_by"},
            {"objectId": obj(f"{e.team_id}/{e.session_id}", "team_session"), "qualifier": "team"},
        ]
        if e.milestone_id and e.milestone_id != e.case_id:
            rel.append({"objectId": obj(e.milestone_id, "milestone"), "qualifier": "milestone"})
        attrs = {"role": e.role, "department": e.department, "condition": e.condition}
        attrs.update({k: v if isinstance(v, (str, int, float, bool)) else json.dumps(v, ensure_ascii=False)
                      for k, v in e.attrs.items()})
        attrs = {k: v for k, v in attrs.items() if v not in ("", None)}
        attr_names.setdefault(e.activity, set()).update(attrs)
        ocel_events.append({
            "id": f"e{i}",
            "type": e.activity,
            "time": e.timestamp.isoformat(),
            "attributes": [{"name": k, "value": v} for k, v in attrs.items()],
            "relationships": rel,
        })

    doc = {
        "objectTypes": [{"name": t, "attributes": []}
                        for t in sorted({o["type"] for o in objects.values()})],
        "eventTypes": [{"name": t, "attributes": [{"name": a, "type": "string"} for a in sorted(n)]}
                       for t, n in attr_names.items()],
        "objects": list(objects.values()),
        "events": ocel_events,
    }
    Path(path).write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
