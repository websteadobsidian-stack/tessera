"""Основные сценарии: вход, согласие, роли и цвета, этапы, доска по методикам, данные исследования."""

from conftest import Api
from tessera.model import STAGES


def full_pass(p, key):
    p.post(f"/api/p/tasks/{key}/pull")
    for _ in STAGES[:-1]:
        p.post(f"/api/p/tasks/{key}/start")
        p.post(f"/api/p/tasks/{key}/advance")


def test_login_scopes_and_catalog(client, admin):
    Api(client).post("/api/admin/login", {"password": "wrong"}, status=401)
    Api(client, "bad").get("/api/admin/overview", status=401)
    assert admin.get("/api/admin/overview")["teams"] == []
    assert admin.get("/api/admin/me") == {"full": True, "team_scope": None}
    cat = admin.get("/api/admin/catalog")
    assert {m["key"] for m in cat["mechanics"]} >= {"facts", "chat", "help", "kudos", "probes", "synergy", "nudges"}
    assert [lv["title"] for lv in cat["levels"]] == ["Фрагменты", "Эскиз", "Узор", "Мозаика", "Картина"]
    protos = admin.get("/api/admin/protocols")["protocols"]
    assert {p["protocol_id"] for p in protos} == {"standard", "feedback_off", "nudges", "minimal", "demo"}
    assert Api(client).get("/api/config")["demo"] is True


def test_join_consent_colors_and_capacity(client, admin):
    team = admin.post("/api/admin/teams", {"condition": "self_org"})
    Api(client).post("/api/join", {"code": "NOPE00"}, status=404)
    p = Api(client, Api(client).post("/api/join", {"code": team["join_code"].lower()})["token"])
    st = p.get("/api/p/state")
    assert st["me"] is None and st["consent_text"] and len(st["roles"]) == 5 and "tasks" not in st
    assert p.post("/api/p/consent", {"agree": False}) == {"declined": True}
    p.get("/api/p/state", status=401)

    a = Api(client, Api(client).post("/api/join", {"code": team["join_code"]})["token"])
    b = Api(client, Api(client).post("/api/join", {"code": team["join_code"]})["token"])
    e1 = Api(client, Api(client).post("/api/join", {"code": team["join_code"]})["token"])
    e2 = Api(client, Api(client).post("/api/join", {"code": team["join_code"]})["token"])
    assert a.post("/api/p/consent", {"agree": True, "role_slug": "pm"})["participant_id"] == "P-001"
    b.post("/api/p/consent", {"agree": True, "role_slug": "pm"}, status=409)
    e1.post("/api/p/consent", {"agree": True, "role_slug": "engineer"})
    e2.post("/api/p/consent", {"agree": True, "role_slug": "engineer"})
    st = a.get("/api/p/state")
    colors = {r["role_slug"] + str(i): r["color_slot"] for i, r in enumerate(st["roster"])}
    assert st["me"]["is_pm"] and st["me"]["color_slot"] == 5
    assert sorted(v for k, v in colors.items() if k.startswith("engineer")) == [3, 6]  # два исполнителя — разные цвета
    assert "correct" not in st["scenario"]["decision"] and st["table"]["my_facts"]
    assert st["mechanics"]["facts"] and st["synergy"]["level"]["title"] == "Фрагменты"


def test_full_session_produces_research_data(client, admin, make_team, phase):
    team, ppl = make_team("kanban")
    pm, analyst, eng, qa = ppl["pm"], ppl["analyst"], ppl["engineer"], ppl["qa"]

    pm.post("/api/p/tasks/T01/pull", status=409)  # доска закрыта до работы
    phase(team, "entry")
    ans = {"psych_safety_7": {str(i): 6 for i in range(1, 8)}, "goal_clarity": {"1": 5}}
    for p in ppl.values():
        p.post("/api/p/survey", {"answers": ans})
    pm.post("/api/p/survey", {"answers": ans}, status=409)

    phase(team, "briefing")
    analyst.post("/api/p/briefing/preference", {"option": "A", "confidence": 3})
    res = analyst.post("/api/p/briefing/check", {"answers": {"who_assigns": "self", "rule": "help"}})
    assert res["who_assigns"]["correct"] and res["rule"]["correct"]
    analyst.post("/api/p/briefing/forecast", {"tasks_done": 7, "m1_on_time": True, "confidence": 4})
    pm.post("/api/p/charter", {"field": "goal", "body": "Сдать M-1"})

    phase(team, "work")
    assert all(m["deadline"] for m in pm.get("/api/p/state")["milestones"])
    analyst.post("/api/p/tasks/T01/pull")
    analyst.post("/api/p/tasks/T01/start")
    analyst.post("/api/p/tasks/T01/advance")
    analyst.post("/api/p/tasks/T01/start")
    analyst.post("/api/p/tasks/T01/advance")
    eng.post("/api/p/tasks/T01/start")
    qa.post("/api/p/tasks/T01/advance", status=403)
    eng.post("/api/p/tasks/T01/advance")
    qa.post("/api/p/tasks/T01/start")
    qa.post("/api/p/tasks/T01/return")
    eng.post("/api/p/tasks/T01/start")
    eng.post("/api/p/tasks/T01/advance")
    qa.post("/api/p/tasks/T01/start")
    qa.post("/api/p/tasks/T01/advance")
    for key in ["T02", "T03", "T04", "T05"]:
        full_pass(pm, key)
    pm.post("/api/p/milestones/M-1/close")

    # Скрытый профиль: факты на стол, голосование, фиксация.
    for role, p in ppl.items():
        for f in p.get("/api/p/state")["table"]["my_facts"]:
            p.post("/api/p/table/facts", {"fact_id": f["fact_id"]})
    analyst.post("/api/p/table/facts", {"fact_id": "finance.1"}, status=403)
    for p in ppl.values():
        p.post("/api/p/table/vote", {"option": "C"})
    analyst.post("/api/p/table/finalize", {"rationale": "факты"})
    pm.post("/api/p/table/vote", {"option": "A"}, status=409)

    admin.post(team["url"] + "/interventions", {"kind": "inject", "key": "urgent_order"})
    admin.post(team["url"] + "/interventions", {"kind": "inject", "key": "nope"}, status=404)
    assert any(t["key"] == "T11" for t in eng.get("/api/p/state")["tasks"])

    phase(team, "pulse")
    spec = eng.get("/api/p/state")["survey"]
    assert spec["nominations"] and spec["mirror"]
    pulse = {"wellbeing": {"1": 5}, "goal_clarity": {"1": 6}, "self_contribution": {"1": 5},
             "decision_confidence": {"1": 4},
             "nasa_tlx_raw": {k: 50 for k in ["mental", "temporal", "performance", "effort", "frustration"]}}
    eng.post("/api/p/survey", {"answers": pulse}, status=422)  # без Зеркала
    eng.post("/api/p/survey", {"answers": pulse, "mirror": {"team_stress": 60, "most_loaded": qa.pid},
                               "nominations": {"actual_leader": [pm.pid], "most_useful": [analyst.pid, eng.pid]}})

    phase(team, "debrief")
    d = eng.get("/api/p/debrief")
    s = d["summary"]
    assert s["completed"] == 5 and s["reworks_per_case"] == 0.2
    assert d["pooling"]["decision"]["is_correct"] is True and d["pooling"]["key_shared"] == d["pooling"]["key_total"]
    assert d["forecast"]["actual_tasks"] == 5 and d["forecast"]["people"][0]["tasks_done"] == 7
    assert abs(d["surveys"]["entry"]["psych_safety_7"]["mean"] - 30 / 7) < 1e-9
    assert d["tiles"] and {t["k"] for t in d["tiles"]} >= {"step", "start", "handover", "fact", "vote", "decision"}
    assert d["personal"]["participant_id"] == eng.pid and d["personal"]["archetype"]
    assert d["mirror"]["stress_guesses"] and d["timeline"][0]["kind"] == "inject"

    live = admin.get(team["url"])
    assert live["team"]["join_code"] == team["join_code"] and live["synergy"]["score"] > 0
    assert {"schedule", "timeline", "signals", "table", "air"} <= set(live)
    assert admin.get(team["url"] + "/stage")["tiles"]

    phase(team, "closed")
    r = client.get("/api/admin/export/all.zip", headers={"Authorization": f"Bearer {admin.token}"})
    assert r.status_code == 200 and r.content[:2] == b"PK"
    ev = client.get("/api/admin/export/events.csv", headers={"Authorization": f"Bearer {admin.token}"}).text
    assert "Взята в работу" in ev and "Имя" not in ev

    assert admin.post("/api/admin/data/purge-names")["deleted"] == 5
    assert all(r["display_name"] is None for r in admin.get(team["url"])["roster"])
    s2 = admin.post(f"/api/admin/teams/{team['team_id']}/sessions")
    assert s2["session_id"] == "S-2" and all(t["stage"] == "Бэклог" for t in eng.get("/api/p/state")["tasks"])


def test_event_log_append_only_for_real_teams(client, admin, make_team, phase, sql):
    import psycopg
    team, ppl = make_team("self_org", roles=("analyst",))
    phase(team, "work")
    ppl["analyst"].post("/api/p/tasks/T01/pull")
    try:
        sql("UPDATE research.event SET activity = 'x'", fetch=False)
        raise AssertionError("журнал изменился")
    except psycopg.errors.RaiseException:
        pass
    try:
        sql("SELECT research.purge_demo_team(%s)", (team["team_id"],))
        raise AssertionError("настоящую команду удалили")
    except psycopg.errors.RaiseException:
        pass


def test_hierarchy_rules(client, admin, make_team, phase):
    team, ppl = make_team("hierarchy")
    phase(team, "work")
    pm, eng = ppl["pm"], ppl["engineer"]
    eng.post("/api/p/tasks/T01/pull", status=403)
    pm.post("/api/p/tasks/T01/assign", {"assignee": eng.pid})
    pm.post("/api/p/tasks/T01/pull")
    ppl["qa"].post("/api/p/tasks/T01/start", status=403)
    eng.post("/api/p/tasks/T01/start")
    eng.post("/api/p/tasks/T01/advance")
    eng.post("/api/p/tasks/T01/assign", {"assignee": eng.pid}, status=403)
    # Решение в иерархии: голос руководителя и есть решение, фиксирует только он.
    eng.post("/api/p/table/vote", {"option": "C"})
    eng.post("/api/p/table/finalize", {}, status=403)
    pm.post("/api/p/table/finalize", {}, status=409)
    pm.post("/api/p/table/vote", {"option": "A"})
    assert pm.post("/api/p/table/finalize", {})["chosen"] == "A"
    eng.post("/api/p/milestones/M-1/deadline", {"minutes": 5}, status=403)


def test_kanban_wip_and_sprints(client, admin, make_team, phase):
    team, ppl = make_team("kanban", roles=("analyst",))
    admin.patch(team["url"], {"wip_limit": 2})
    phase(team, "work")
    a = ppl["analyst"]
    a.post("/api/p/tasks/T01/pull")
    a.post("/api/p/tasks/T02/pull")
    r = a.c.post("/api/p/tasks/T03/pull", headers={"Authorization": f"Bearer {a.token}"})
    assert r.status_code == 409 and "Лимит" in r.json()["detail"]

    team2, ppl2 = make_team("sprints", roles=("analyst",))
    phase(team2, "work")
    b = ppl2["analyst"]
    b.post("/api/p/tasks/T01/pull", status=409)
    b.post("/api/p/tasks/T01/sprint", {"add": True})
    b.post("/api/p/tasks/T01/pull")


def test_scoped_facilitator_token(client, admin, make_team):
    team, _ = make_team("kanban", roles=("analyst",))
    other, _ = make_team("kanban", roles=("analyst",))
    sb = Api(client).post("/api/demo", {"role_slug": "qa", "condition": "kanban"})
    director = Api(client, sb["facilitator_token"])
    assert director.get("/api/admin/me")["team_scope"] == sb["team_id"]
    assert [t["team_id"] for t in director.get("/api/admin/overview")["teams"]] == [sb["team_id"]]
    director.get(team["url"], status=403)
    director.get("/api/admin/research", status=403)
    director.post("/api/admin/teams", {"condition": "kanban"}, status=403)
    director.get(f"/api/admin/sessions/{sb['team_id']}/{sb['session_id']}")
    assert other["team_id"] != sb["team_id"]
