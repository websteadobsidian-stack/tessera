import json
from datetime import datetime, timedelta
from xml.etree import ElementTree as ET

import pytest

from tessera import metrics
from tessera.cli import main
from tessera.export import to_ocel2, to_xes
from tessera.model import (
    MILESTONE_CLOSED,
    MILESTONE_DEADLINE_CHANGED,
    START_ACTIVITY,
    Event,
    EventLogError,
    read_csv,
    write_csv,
)
from tessera.pseudonymize import Pseudonymizer
from tessera.simulate import simulate

T0 = datetime(2026, 10, 14, 11, 0)


def e(case, activity, minute, resource, dept="", **attrs):
    return Event(case_id=case, activity=activity, timestamp=T0 + timedelta(minutes=minute),
                 resource=resource, department=dept, team_id="T-01", session_id="S-1",
                 condition="kanban", attrs=attrs)


# Задача с одной доработкой: Контроль → Исполнение.
REWORK_CASE = [
    e("TASK-1", "Анализ", 0, "P-01", "А"),
    e("TASK-1", START_ACTIVITY, 6, "P-01", "А"),
    e("TASK-1", "Проектирование", 12, "P-01", "А"),
    e("TASK-1", START_ACTIVITY, 15, "P-02", "Б"),
    e("TASK-1", "Исполнение", 18, "P-02", "Б"),
    e("TASK-1", START_ACTIVITY, 18, "P-03", "В"),
    e("TASK-1", "Контроль", 24, "P-03", "В"),
    e("TASK-1", START_ACTIVITY, 30, "P-04", "Г"),
    e("TASK-1", "Исполнение", 36, "P-04", "Г"),
    e("TASK-1", START_ACTIVITY, 42, "P-03", "В"),
    e("TASK-1", "Контроль", 48, "P-03", "В"),
    e("TASK-1", START_ACTIVITY, 48, "P-04", "Г"),
    e("TASK-1", "Сдача", 60, "P-04", "Г"),
]


def test_case_metrics_on_hand_computed_example():
    m = metrics.case_metrics("TASK-1", REWORK_CASE)
    assert m.completed
    assert m.cycle_hours == pytest.approx(1.0)
    # Ожидания: Анализ 6 + Проектирование 3 + Исполнение 0 + Контроль 6 + Исполнение 6 + Контроль 0.
    assert m.waiting_hours == pytest.approx(21 / 60)
    assert m.waiting_by_stage["Исполнение"] == pytest.approx(6 / 60)
    assert m.reworks == 1
    assert m.fitness == 1.0  # возврат Контроль → Исполнение разрешён эталоном


def test_fitness_penalises_skipped_stage_and_wrong_start():
    skip = [e("X", "Анализ", 0, "P-01"), e("X", "Исполнение", 5, "P-01"), e("X", "Сдача", 9, "P-01")]
    assert metrics.case_metrics("X", skip).fitness == pytest.approx(1 / 3)
    late_start = [e("Y", "Исполнение", 0, "P-01"), e("Y", "Контроль", 5, "P-01")]
    assert metrics.case_metrics("Y", late_start).fitness == pytest.approx(1 / 2)


def test_waiting_unknown_without_start_events():
    m = metrics.case_metrics("Z", [e("Z", "Анализ", 0, "P-01"), e("Z", "Проектирование", 5, "P-02")])
    assert m.waiting_hours is None and not m.completed and m.cycle_hours is None


def test_handover_network_and_centralization():
    edges = metrics.handover_network(REWORK_CASE)
    assert edges[("P-01", "P-02")] == 1
    assert edges[("P-03", "P-04")] == 2 and edges[("P-04", "P-03")] == 1
    assert ("P-01", "P-01") not in edges
    # Звезда — максимальная централизация, цикл — нулевая.
    assert metrics.degree_centralization([("H", "a"), ("H", "b"), ("H", "c")]) == 1.0
    assert metrics.degree_centralization([("a", "b"), ("b", "c"), ("c", "a")]) == 0.0


def test_cross_department_handovers():
    m = metrics.case_metrics("TASK-1", REWORK_CASE)
    assert m.cross_department_handovers == 5


def test_milestones_original_vs_final_deadline():
    d0, d1 = T0 + timedelta(minutes=30), T0 + timedelta(minutes=45)
    evs = [
        e("M-1", MILESTONE_DEADLINE_CHANGED, 28, "P-01", old=d0.isoformat(), new=d1.isoformat()),
        e("M-1", MILESTONE_CLOSED, 40, "P-05", deadline=d1.isoformat()),
        e("M-2", MILESTONE_CLOSED, 50, "P-05", deadline=(T0 + timedelta(minutes=55)).isoformat()),
    ]
    m = metrics.milestone_metrics(evs)
    assert m["milestones_closed"] == 2
    assert m["on_time_original"] == 0.5
    assert m["on_time_final"] == 1.0
    assert m["mean_deadline_shift_hours"] == pytest.approx(0.125)


def test_milestone_deadline_without_timezone_uses_event_timezone():
    from datetime import timezone
    msk = timezone(timedelta(hours=3))
    closed = Event(case_id="M-1", activity=MILESTONE_CLOSED, timestamp=datetime(2026, 10, 14, 12, 0, tzinfo=msk),
                   resource="P-05", team_id="T-01", session_id="S-1", condition="kanban",
                   attrs={"deadline": "2026-10-14T12:30:00"})
    assert metrics.milestone_metrics([closed])["on_time_final"] == 1.0


def test_csv_roundtrip_and_validation(tmp_path):
    path = tmp_path / "log.csv"
    write_csv(REWORK_CASE, path)
    back = read_csv(path)
    assert [(x.case_id, x.activity, x.timestamp) for x in back] == \
           [(x.case_id, x.activity, x.timestamp) for x in REWORK_CASE]

    bad = tmp_path / "bad.csv"
    bad.write_text(path.read_text(encoding="utf-8").replace("T-01", "", 1), encoding="utf-8")
    with pytest.raises(EventLogError, match="строка 2.*team_id"):
        read_csv(bad)


def test_xes_and_ocel_structure(tmp_path):
    evs = simulate(teams_per_condition=1, seed=1)
    to_xes(evs, tmp_path / "log.xes")
    ns = {"x": "http://www.xes-standard.org/"}
    root = ET.parse(tmp_path / "log.xes").getroot()
    assert root.attrib["xes.version"] == "1849-2016"
    assert sum(len(t.findall("x:event", ns)) for t in root.findall("x:trace", ns)) == len(evs)

    to_ocel2(evs, tmp_path / "log.json")
    doc = json.loads((tmp_path / "log.json").read_text(encoding="utf-8"))
    assert len(doc["events"]) == len(evs)
    ids = {o["id"] for o in doc["objects"]}
    assert all(r["objectId"] in ids for ev in doc["events"] for r in ev["relationships"])
    assert {t["name"] for t in doc["objectTypes"]} == {"task", "milestone", "participant", "team_session"}


def test_pseudonymizer_is_stable_and_persistent(tmp_path):
    evs = [e("C", "Анализ", 0, "ivanov"), e("C", "Проектирование", 1, "petrova"),
           e("C", "Исполнение", 2, "ivanov")]
    p = Pseudonymizer()
    assert [x.resource for x in p.apply(evs)] == ["P-01", "P-02", "P-01"]
    p.save(tmp_path / "map.csv")
    p2 = Pseudonymizer.load(tmp_path / "map.csv")
    assert p2.code("petrova") == "P-02" and p2.code("sidorov") == "P-03"


def test_simulation_is_deterministic_and_covers_all_conditions():
    a, b = simulate(seed=7), simulate(seed=7)
    assert [x.to_row() for x in a] == [x.to_row() for x in b]
    conditions = metrics.by_condition(metrics.summarize(a))
    assert set(conditions) == {"kanban", "sprints", "hierarchy", "self_org"}
    assert all(c["teams"] == 2 for c in conditions.values())


def test_cli_end_to_end(tmp_path, capsys):
    log = tmp_path / "log.csv"
    assert main(["simulate", "--teams", "1", "--out", str(log)]) == 0
    assert main(["pseudonymize", str(log), "--out", str(tmp_path / "p.csv"),
                 "--mapping", str(tmp_path / "map.csv")]) == 0
    assert main(["metrics", str(tmp_path / "p.csv"), "--out", str(tmp_path / "out")]) == 0
    assert (tmp_path / "out" / "teams.csv").exists()
    assert main(["export", str(log), "--format", "ocel", "--out", str(tmp_path / "o.json")]) == 0
    (tmp_path / "broken.csv").write_text("case_id,activity\nA,B\n", encoding="utf-8")
    assert main(["validate", str(tmp_path / "broken.csv")]) == 1
    assert "ошибка журнала" in capsys.readouterr().err
