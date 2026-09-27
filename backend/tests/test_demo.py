"""Демо-режим: песочница с ботами, смена участника, история, исследование и удаление демо."""

import random

from conftest import Api


def _tick(sql, session, rounds=1, fast=True):
    from app import bots, db
    from app.core import session_row
    rng = random.Random(1)
    for _ in range(rounds):
        if fast:
            sql("UPDATE app.bot SET next_action_at = now() - interval '1 second', "
                "busy_until = CASE WHEN busy_until IS NULL THEN NULL ELSE now() - interval '1 second' END", fetch=False)
        with db.tx() as conn:
            bots.tick_session(conn, session_row(conn, session["team_id"], session["session_id"]), rng)


def test_sandbox_bots_play_the_whole_session(client, sql):
    sb = Api(client).post("/api/demo", {"role_slug": "analyst", "condition": "kanban", "name": "Тестер"})
    me = Api(client, sb["participant_token"])
    director = Api(client, sb["facilitator_token"])
    st = me.get("/api/p/state")
    assert st["team"]["is_demo"] and st["me"]["display_name"] == "Тестер" and len(st["roster"]) == 6
    assert st["me"]["participant_id"].startswith("DP-") and sb["team_id"].startswith("DT-")
    url = f"/api/admin/sessions/{sb['team_id']}/{sb['session_id']}"

    director.post(url + "/phase", {"phase": "entry"})
    _tick(sql, sb, rounds=12)
    progress = director.get(url)["progress"]
    assert len([p for p in progress if p != sb["participant_id"]]) >= 4  # боты ответили на опрос

    director.post(url + "/phase", {"phase": "briefing"})
    _tick(sql, sb, rounds=25)
    assert sql("SELECT count(*) FROM research.preference")[0][0] >= 4

    director.post(url + "/phase", {"phase": "work"})
    _tick(sql, sb, rounds=120)
    live = director.get(url)
    assert live["events"] > 20, live["events"]
    assert live["air"] and live["table"]["shared"]
    assert sum(1 for t in live["tasks"] if t["stage"] != "Бэклог") >= 3
    assert me.get("/api/p/state")["roster"]

    # Смотреть глазами другого: он переходит к человеку, аналитик — к боту.
    qa = next(r for r in live["roster"] if r["role_slug"] == "qa")
    token = director.post("/api/demo/possess", {"participant_id": qa["participant_id"]})["participant_token"]
    assert Api(client, token).get("/api/p/state")["me"]["role_slug"] == "qa"
    paused = sql("SELECT participant_id FROM app.bot WHERE paused")
    assert [r[0] for r in paused] == [qa["participant_id"]]
    director.post("/api/demo/speed", {"speed": 2})
    director.post(url + "/interventions", {"kind": "inject", "key": "urgent_order"})

    director.post(url + "/phase", {"phase": "retro"})
    _tick(sql, sb, rounds=20)
    assert sql("SELECT count(*) FROM research.retro_card")[0][0] >= 3


def test_history_research_and_purge(client, admin, sql):
    before = admin.get("/api/admin/research")
    assert before["sessions"] == []
    teams = admin.post("/api/admin/demo/history", {"per_condition": 1})["teams"]
    assert len(teams) == 4
    assert admin.get("/api/admin/research")["sessions"] == []  # демо по умолчанию исключено
    r = admin.get("/api/admin/research?include_demo=true")
    assert len(r["sessions"]) == 8  # у первой команды каждой методики две сессии
    assert set(r["conditions"]) == {"kanban", "sprints", "hierarchy", "self_org"}
    assert r["hypotheses"]["h2"]["n"] == 8 and r["hypotheses"]["h4"]["points"]
    row = r["sessions"][0]
    for k in ("info_pooled", "probe_alignment", "kudos_per_person", "synergy", "psych_safety_delta"):
        assert k in row
    assert any(s["agreements_kept"] is not None for s in r["sessions"])
    d = admin.get(f"/api/admin/sessions/{teams[0]}/S-1/debrief")
    assert d["summary"]["completed"] > 0 and d["tiles"] and d["pooling"]["pre"]

    ev_demo = client.get("/api/admin/export/events.csv?include_demo=true", headers={"Authorization": f"Bearer {admin.token}"}).text
    ev_real = client.get("/api/admin/export/events.csv", headers={"Authorization": f"Bearer {admin.token}"}).text
    assert ev_demo.count("\n") > 100 and ev_real.count("\n") == 1

    status = admin.get("/api/admin/data/status")
    assert status["demo_history"] == 4 and status["teams"] == 0
    assert admin.delete("/api/admin/demo")["deleted"] == 4
    assert sql("SELECT count(*) FROM research.event")[0][0] == 0
    assert sql("SELECT count(*) FROM research.participant")[0][0] == 0


def test_public_demo_can_be_disabled(client):
    from app import config
    config.PUBLIC_DEMO = False
    try:
        Api(client).post("/api/demo", {"role_slug": "qa"}, status=403)
    finally:
        config.PUBLIC_DEMO = True
