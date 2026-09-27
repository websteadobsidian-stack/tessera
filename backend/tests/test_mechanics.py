"""Механики командного взаимодействия."""

from conftest import Api


def test_votes_hidden_until_final_and_majority_rules(client, admin, make_team, phase):
    cfg = admin.get("/api/admin/protocols")["protocols"][0]["config"]
    cfg["mechanics"]["votes_visible"] = False
    pid = admin.post("/api/admin/protocols", {"title": "Hidden votes", "config": cfg})["protocol_id"]
    team, ppl = make_team("self_org", protocol=pid)
    phase(team, "work")
    a, b, c = ppl["analyst"], ppl["finance"], ppl["qa"]
    a.post("/api/p/table/vote", {"option": "A"})
    st = b.get("/api/p/state")["table"]
    assert st["votes"]["counts"] is None and st["votes"]["voters"] == [a.pid]
    a.post("/api/p/table/finalize", {}, status=409)  # проголосовал 1 из 5
    b.post("/api/p/table/vote", {"option": "C"})
    c.post("/api/p/table/vote", {"option": "A"})
    ppl["pm"].post("/api/p/table/vote", {"option": "C"})
    r = a.c.post("/api/p/table/finalize", json={}, headers={"Authorization": f"Bearer {a.token}"})
    assert r.status_code == 409 and "поровну" in r.json()["detail"]
    ppl["engineer"].post("/api/p/table/vote", {"option": "C"})
    assert a.post("/api/p/table/finalize", {})["chosen"] == "C"
    st = b.get("/api/p/state")["table"]
    assert st["votes"]["counts"] == {"A": 2, "C": 3}  # после фиксации голоса видны
    assert "correct" not in st["final"]  # правильный ответ — только на разборе
    phase(team, "debrief")
    assert b.get("/api/p/state")["table"]["final"]["is_correct"] is True


def test_air_help_kudos_weather(client, admin, make_team, phase):
    team, ppl = make_team("kanban")
    a, b = ppl["analyst"], ppl["engineer"]
    a.post("/api/p/air", {"body": "привет", "mentions": [b.pid, "P-999"]})  # чат открыт уже в лобби
    msg = b.get("/api/p/state")["air"][-1]
    assert msg["body"] == "привет" and msg["mentions"] == [b.pid]
    phase(team, "work")
    a.post("/api/p/tasks/T01/pull")
    a.post("/api/p/tasks/T01/start")
    hid = a.post("/api/p/help", {"case_key": "T01", "note": "застрял"})["help_id"]
    a.post("/api/p/help", {}, status=409)
    a.post(f"/api/p/help/{hid}/answer", status=409)
    b.post(f"/api/p/help/{hid}/answer")
    ppl["qa"].post(f"/api/p/help/{hid}/answer", status=409)
    a.post("/api/p/tasks/T01/advance")  # задача ушла дальше — просьба закрылась сама
    h = a.get("/api/p/state")["help"][0]
    assert h["helper_id"] == b.pid and h["resolved_at"] and h["case_key"] == "T01"

    a.post("/api/p/kudos", {"to": a.pid, "kind": "help"}, status=422)
    a.post("/api/p/kudos", {"to": b.pid, "kind": "nope"}, status=422)
    a.post("/api/p/kudos", {"to": b.pid, "kind": "help", "note": "спасибо!"})
    a.post("/api/p/kudos", {"to": b.pid, "kind": "info"}, status=429)
    assert b.get("/api/p/state")["kudos"][0]["to_participant"] == b.pid

    a.post("/api/p/weather", {"value": 2})
    b.post("/api/p/weather", {"value": 4})
    w = a.get("/api/p/state")["weather"]
    assert w["mine"] == 2 and w["average"] == 3
    roster = {r["participant_id"]: r for r in a.get("/api/p/state")["roster"]}
    assert roster[b.pid]["weather"] == 4


def test_probe_alignment_and_accuracy(client, admin, make_team, phase):
    team, ppl = make_team("kanban")
    phase(team, "work")
    admin.post(team["url"] + "/interventions", {"kind": "probe", "key": "budget"})
    admin.post(team["url"] + "/interventions", {"kind": "probe", "key": "priority"}, status=409)
    probe = ppl["pm"].get("/api/p/state")["probe"]["open"]
    assert probe["question"].startswith("Какой бюджет") and probe["my_answer"] is None
    for role in ("pm", "analyst", "finance"):
        ppl[role].post(f"/api/p/probe/{probe['probe_id']}", {"answer": "4.5"})
    ppl["qa"].post(f"/api/p/probe/{probe['probe_id']}", {"answer": "7"})
    ppl["qa"].post(f"/api/p/probe/{probe['probe_id']}", {"answer": "zzz"}, status=422)
    live = admin.get(team["url"])["probe"]["open"]
    assert live["answered"] == 4 and live["answers"][ppl["qa"].pid] == "7"


def test_retro_agreements_carry_over(client, admin, make_team, phase):
    team, ppl = make_team("self_org", roles=("pm", "analyst", "qa"))
    phase(team, "retro")
    a, b, c = ppl["pm"], ppl["analyst"], ppl["qa"]
    a.post("/api/p/retro/cards", {"lane": "start", "body": "Раньше выкладывать факты"})
    b.post("/api/p/retro/cards", {"lane": "stop", "body": "Молчать, когда застрял"})
    b.post("/api/p/retro/cards", {"lane": "continue", "body": "Благодарить"})
    cards = c.get("/api/p/state")["retro"]["cards"]
    assert all("participant_id" not in x for x in cards)  # анонимно
    ids = {x["body"]: x["card_id"] for x in cards}
    for p in (a, b, c):
        p.post(f"/api/p/retro/cards/{ids['Раньше выкладывать факты']}/vote")
    c.post(f"/api/p/retro/cards/{ids['Молчать, когда застрял']}/vote")
    c.post(f"/api/p/retro/cards/{ids['Благодарить']}/vote")
    c.post(f"/api/p/retro/cards/{ids['Благодарить']}/vote")  # снять голос
    st = c.get("/api/p/state")["retro"]
    assert st["votes_left"] == 1
    phase(team, "exit")
    agreements = admin.get(team["url"])["retro"]["agreements"]
    assert [x["body"] for x in agreements] == ["Начать: Раньше выкладывать факты", "Перестать: Молчать, когда застрял"]
    phase(team, "closed")
    admin.post(f"/api/admin/teams/{team['team_id']}/sessions")
    phase({**team, "url": f"/api/admin/sessions/{team['team_id']}/S-2"}, "briefing")
    prev = a.get("/api/p/state")["briefing"]["agreements_prev"]
    assert len(prev) == 2
    phase({**team, "url": f"/api/admin/sessions/{team['team_id']}/S-2"}, "exit")
    spec = a.get("/api/p/state")["survey"]
    assert spec["strengths"] and len(spec["agreements"]) == 2
    ans = {"psych_safety_7": {str(i): 5 for i in range(1, 8)}, "team_satisfaction": {"1": 6}}
    a.post("/api/p/survey", {"answers": ans, "texts": {"reflection": {"learned": "Многое"}},
                             "strengths": {b.pid: "share", c.pid: "calm"},
                             "agreements": {str(x["agreement_id"]): 4 for x in prev}})
    phase({**team, "url": f"/api/admin/sessions/{team['team_id']}/S-2"}, "closed")
    d = b.get("/api/p/debrief")
    assert d["agreements"]["kept"] == 4 and d["personal"]["strengths"] == {"Делится информацией": 1}


def test_synergy_and_achievements(client, admin, make_team, phase):
    from app import db, insights
    from app.core import session_row

    team, ppl = make_team("kanban")
    phase(team, "work")
    for p in ppl.values():
        for f in p.get("/api/p/state")["table"]["my_facts"]:
            p.post("/api/p/table/facts", {"fact_id": f["fact_id"]})
    ppl["analyst"].post("/api/p/kudos", {"to": ppl["qa"].pid, "kind": "info"})
    with db.tx() as conn:
        got = insights.evaluate_achievements(conn, session_row(conn, team["team_id"], team["session_id"]))
        again = insights.evaluate_achievements(conn, session_row(conn, team["team_id"], team["session_id"]))
    assert "all_facts" in got and again == []
    st = ppl["pm"].get("/api/p/state")
    assert st["achievements"][0]["key"] == "all_facts"
    assert any(n["kind"] == "achievement" for n in st["notices"])
    info = next(c for c in st["synergy"]["components"] if c["key"] == "info")
    assert info["value"] == 1.0 and st["synergy"]["score"] > 0


def test_mechanic_disabled_by_protocol(client, admin, make_team, phase):
    team, ppl = make_team("kanban", roles=("analyst", "qa"), protocol="minimal")
    phase(team, "work")
    r = ppl["analyst"].c.post("/api/p/air", json={"body": "эй"}, headers={"Authorization": f"Bearer {ppl['analyst'].token}"})
    assert r.status_code == 403 and "выключена" in r.json()["detail"]
    ppl["analyst"].post("/api/p/kudos", {"to": ppl["qa"].pid, "kind": "help"}, status=403)
    st = ppl["analyst"].get("/api/p/state")
    assert st["mechanics"]["chat"] is False and st["synergy"] is None
    # В базовом протоколе голосования нет — ключевое решение пишется в журнал решений.
    ppl["analyst"].post("/api/p/decisions", {"key_decision": True, "chosen": "C"})
    assert ppl["qa"].get("/api/p/state")["table"]["final"]["chosen"] == "C"


def test_unauthorized_participant(client):
    Api(client, "nope").post("/api/p/air", {"body": "x"}, status=401)
