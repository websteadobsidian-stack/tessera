"""Вмешательства ведущего и протокола, таймлайн, подсказки."""


def test_silence_blind_spot_and_role_swap(client, admin, make_team, phase, sql):
    team, ppl = make_team("hierarchy")
    phase(team, "work")
    pm, qa, analyst = ppl["pm"], ppl["qa"], ppl["analyst"]

    admin.post(team["url"] + "/interventions", {"kind": "silence", "minutes": 3})
    assert pm.get("/api/p/state")["session"]["silence_until"]
    analyst.post("/api/p/air", {"body": "пишу в тишине"})
    assert sql("SELECT during_silence FROM research.message")[0][0] is True

    r = admin.post(team["url"] + "/interventions", {"kind": "blind_spot", "target": analyst.pid, "minutes": 2})
    assert r["participant_id"] == analyst.pid
    st = analyst.get("/api/p/state")
    assert st["me"]["away_until"] and any(n["kind"] == "blind_spot_self" for n in st["notices"])
    assert not any(n["kind"] == "blind_spot_self" for n in pm.get("/api/p/state")["notices"])
    pm.post("/api/p/tasks/T01/assign", {"assignee": analyst.pid})
    pm.post("/api/p/tasks/T01/pull")
    r = analyst.c.post("/api/p/tasks/T01/start", headers={"Authorization": f"Bearer {analyst.token}"})
    assert r.status_code == 409 and "выезде" in r.json()["detail"]

    # Смена ролей: контролёр на время становится руководителем и получает его права.
    admin.post(team["url"] + "/interventions", {"kind": "role_swap", "a": qa.pid, "b": pm.pid, "minutes": 2})
    me = qa.get("/api/p/state")["me"]
    assert me["role_slug"] == "pm" and me["is_pm"] and me["orig_role_title"] == "контролёр качества"
    qa.post("/api/p/tasks/T02/pull")  # теперь может — он руководитель
    pm.post("/api/p/tasks/T03/pull", status=403)
    # Свои факты остаются при человеке.
    assert {f["fact_id"] for f in qa.get("/api/p/state")["table"]["my_facts"]} == {"qa.1", "qa.2"}
    sql("UPDATE app.device SET swap_until = now() - interval '1 second' WHERE swap_until IS NOT NULL", fetch=False)
    from app import db, interventions
    with db.tx() as conn:
        assert interventions.restore_swaps(conn) == {team["team_id"]}
    assert qa.get("/api/p/state")["me"]["role_slug"] == "qa"
    ev = sql("SELECT role FROM research.event WHERE resource = %s AND activity = 'Анализ'", (qa.pid,))
    assert ev[0][0] == "руководитель проекта"  # событие записано с ролью на момент действия

    admin.post(team["url"] + "/interventions", {"kind": "nudge", "text": "Посмотрите на контроль", "participant_id": pm.pid})
    assert any(n["kind"] == "nudge" for n in pm.get("/api/p/state")["notices"])
    assert not any(n["kind"] == "nudge" for n in qa.get("/api/p/state")["notices"])
    kinds = [x["kind"] for x in admin.get(team["url"])["timeline"]]
    assert kinds == ["silence", "blind_spot", "role_swap", "nudge"]


def test_schedule_fires_by_protocol_timeline(client, admin, make_team, phase, sql):
    from app import db, interventions

    team, ppl = make_team("kanban")
    sched = admin.get(team["url"])["schedule"]
    assert [x["kind"] for x in sched][:2] == ["probe", "inject"] and all(x["fired_at"] is None for x in sched)
    phase(team, "work")
    sql("UPDATE app.session_state SET work_started_at = now() - interval '19 minutes'", fetch=False)
    with db.tx() as conn:
        assert interventions.fire_due(conn) == 2  # Синхрон на 10-й и вброс на 18-й минуте
    live = admin.get(team["url"])
    fired = [x for x in live["schedule"] if x["fired_at"]]
    assert {x["kind"] for x in fired} == {"probe", "inject"}
    assert any(t["key"] == "T11" for t in live["tasks"])
    # Ведущий может запустить пункт раньше или пропустить.
    pending = [x for x in live["schedule"] if not x["fired_at"]]
    admin.post(team["url"] + f"/schedule/{pending[-1]['item_id']}/skip")
    admin.post(team["url"] + f"/schedule/{pending[-1]['item_id']}/skip", status=404)
    assert next(x for x in admin.get(team["url"])["schedule"] if x["item_id"] == pending[-1]["item_id"])["skipped"]


def test_signals_and_auto_nudges(client, admin, make_team, phase, sql):
    from app import db, insights
    from app.core import session_row

    team, ppl = make_team("kanban", protocol="nudges")
    phase(team, "work")
    ppl["analyst"].post("/api/p/tasks/T01/pull")
    sql("UPDATE app.task SET updated_at = now() - interval '7 minutes' WHERE key = 'T01'", fetch=False)
    hid = ppl["qa"].post("/api/p/help", {})["help_id"]
    sql("UPDATE research.help_request SET created_at = now() - interval '2 minutes' WHERE help_id = %s", (hid,), fetch=False)
    kinds = {s["kind"] for s in admin.get(team["url"])["signals"]}
    assert {"waiting", "help_open"} <= kinds
    with db.tx() as conn:
        s = session_row(conn, team["team_id"], team["session_id"])
        assert insights.send_nudges(conn, s) == 1
        assert insights.send_nudges(conn, s) == 1  # другой сигнал
        assert insights.send_nudges(conn, s) == 0  # повторно те же — не чаще раза в 3 минуты
    nudges = [n for n in ppl["pm"].get("/api/p/state")["notices"] if n["kind"] == "nudge"]
    assert len(nudges) == 2
