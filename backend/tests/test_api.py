from tessera.model import STAGES


def session_url(team):
    return f"/api/admin/sessions/{team['team_id']}/{team['session_id']}"


def full_pass(p, key):
    """Провести задачу по всем этапам одним участником."""
    p.post(f"/api/p/tasks/{key}/pull")
    for _ in STAGES[:-1]:
        p.post(f"/api/p/tasks/{key}/start")
        p.post(f"/api/p/tasks/{key}/advance")


def test_login_and_auth(client, admin):
    from conftest import Api
    Api(client).post("/api/admin/login", {"password": "wrong"}, status=401)
    Api(client, "bad").get("/api/admin/overview", status=401)
    assert admin.get("/api/admin/overview")["teams"] == []


def test_join_consent_decline_and_role_capacity(client, admin):
    from conftest import Api
    team = admin.post("/api/admin/teams", {"condition": "self_org"})
    Api(client).post("/api/join", {"code": "NOPE00"}, status=404)

    p = Api(client, Api(client).post("/api/join", {"code": team["join_code"].lower()})["token"])
    st = p.get("/api/p/state")
    assert st["me"] is None and st["consent_text"] and len(st["roles"]) == 5
    assert "tasks" not in st  # до согласия данные компании не показываем

    assert p.post("/api/p/consent", {"agree": False}) == {"declined": True}
    p.get("/api/p/state", status=401)  # устройство удалено

    a = Api(client, Api(client).post("/api/join", {"code": team["join_code"]})["token"])
    b = Api(client, Api(client).post("/api/join", {"code": team["join_code"]})["token"])
    assert a.post("/api/p/consent", {"agree": True, "role_slug": "pm"})["participant_id"] == "P-001"
    b.post("/api/p/consent", {"agree": True, "role_slug": "pm"}, status=409)
    st = a.get("/api/p/state")
    assert st["me"]["is_pm"] and st["scenario"]["my_role"]["facts"]
    assert "correct" not in st["scenario"]["decision"]


def test_full_session_flow_produces_research_data(client, admin, make_team):
    team, ppl = make_team("kanban")
    url = session_url(team)
    pm, analyst, eng, qa = ppl["pm"], ppl["analyst"], ppl["engineer"], ppl["qa"]

    # Вход: доска закрыта вне рабочей фазы.
    pm.post("/api/p/tasks/T01/pull", status=409)
    admin.post(url + "/phase", {"phase": "entry"})
    spec = pm.get("/api/p/state")["survey"]
    assert not spec["done"] and [i["id"] for i in spec["instruments"]] == ["psych_safety_7", "goal_clarity"]
    pm.post("/api/p/survey", {"answers": {"psych_safety_7": {"1": 2}}}, status=422)
    ans = {"psych_safety_7": {str(i): 6 for i in range(1, 8)}, "goal_clarity": {"1": 5}}
    for p in ppl.values():
        p.post("/api/p/survey", {"answers": ans})
    pm.post("/api/p/survey", {"answers": ans}, status=409)

    admin.post(url + "/phase", {"phase": "work"})
    st = pm.get("/api/p/state")
    assert all(m["deadline"] for m in st["milestones"])

    # Анализ → ... → Сдача с одной доработкой на контроле.
    analyst.post("/api/p/tasks/T01/pull")
    analyst.post("/api/p/tasks/T01/start")
    analyst.post("/api/p/tasks/T01/advance")
    analyst.post("/api/p/tasks/T01/start")
    analyst.post("/api/p/tasks/T01/advance")
    eng.post("/api/p/tasks/T01/advance", status=409)  # не взята в работу
    eng.post("/api/p/tasks/T01/start")
    qa.post("/api/p/tasks/T01/advance", status=403)  # чужая задача
    eng.post("/api/p/tasks/T01/advance")
    qa.post("/api/p/tasks/T01/start")
    qa.post("/api/p/tasks/T01/return")
    assert next(t for t in pm.get("/api/p/state")["tasks"] if t["key"] == "T01")["stage"] == "Исполнение"
    eng.post("/api/p/tasks/T01/start")
    eng.post("/api/p/tasks/T01/advance")
    qa.post("/api/p/tasks/T01/start")
    qa.post("/api/p/tasks/T01/advance")
    for key in ["T02", "T03", "T04", "T05"]:
        full_pass(pm, key)
    pm.post("/api/p/milestones/M-2/close", status=409)
    pm.post("/api/p/milestones/M-1/deadline", {"minutes": 5})
    pm.post("/api/p/milestones/M-1/close")
    pm.post("/api/p/milestones/M-1/close", status=409)

    pm.post("/api/p/decisions", {"key_decision": True, "chosen": "Z"}, status=422)
    pm.post("/api/p/decisions", {"key_decision": True, "chosen": "C", "proposed_by": analyst.pid,
                                 "rationale": "хранение в РФ и бюджет"})
    pm.post("/api/p/decisions", {"title": "Отказаться от push", "chosen": "да", "case_key": "T08"})

    admin.post(url + "/injects/urgent_order")
    admin.post(url + "/injects/budget_cut")
    assert admin.post(url + "/injects/nope", status=404)
    st_fin = ppl["finance"].get("/api/p/state")
    st_eng = eng.get("/api/p/state")
    assert len(st_fin["notices"]) == 3 and len(st_eng["notices"]) == 2  # адресное сообщение финансисту
    assert any(t["key"] == "T11" and t["priority"] == "urgent" for t in st_eng["tasks"])

    admin.post(url + "/phase", {"phase": "pulse"})
    spec = eng.get("/api/p/state")["survey"]
    assert spec["nominations"]
    pulse = {"wellbeing": {"1": 5}, "nasa_tlx_raw": {k: 50 for k in
             ["mental", "temporal", "performance", "effort", "frustration"]},
             "goal_clarity": {"1": 6}, "self_contribution": {"1": 5}}
    eng.post("/api/p/survey", {"answers": pulse, "nominations": {
        "most_useful": [analyst.pid, eng.pid], "actual_leader": [pm.pid]}})

    admin.post(url + "/phase", {"phase": "debrief"})
    d = eng.get("/api/p/debrief")
    s = d["summary"]
    assert s["completed"] == 5 and s["reworks_per_case"] == 0.2 and s["fitness_mean"] == 1.0
    assert s["milestones_closed"] == 1 and s["on_time_final"] == 1.0
    assert d["decision"]["is_correct"] is True
    rework = next(e for e in d["dfg"]["edges"] if e["rework"])
    assert (rework["source"], rework["target"]) == ("Контроль", "Исполнение")
    # Все ответы 6; три обратных пункта дают 2: (4·6 + 3·2) / 7.
    assert abs(d["surveys"]["entry"]["psych_safety_7"]["mean"] - 30 / 7) < 1e-9
    assert {n["question"] for n in d["nominations"]} == {"most_useful", "actual_leader"}
    assert all(n["source"] != n["target"] for n in d["nominations"])
    assert d["flow"] and set(d["flow"][-1]) >= {"Бэклог", *STAGES}
    assert [i["kind"] for i in d["injects"]] == ["urgent_order", "budget_cut"]

    admin.post(url + "/phase", {"phase": "exit"})
    eng.post("/api/p/survey", {"answers": {"psych_safety_7": {str(i): 7 for i in range(1, 8)},
                                           "team_satisfaction": {"1": 6}},
                               "texts": {"reflection": {"learned": ""}}}, status=422)
    eng.post("/api/p/survey", {"answers": {"psych_safety_7": {str(i): 7 for i in range(1, 8)},
                                           "team_satisfaction": {"1": 6}},
                               "texts": {"reflection": {"learned": "Договариваться заранее"}}})

    live = admin.get(url)
    assert live["team"]["join_code"] == team["join_code"]
    assert "exit" in next(r for r in live["roster"] if r["participant_id"] == eng.pid)["surveys"]
    assert live["feed"][0]["case_id"].startswith("DECISION") or live["feed"]

    research = admin.get("/api/admin/research")
    assert research["conditions"]["kanban"]["teams"] == 1
    row = research["sessions"][0]
    assert row["decision_correct"] == 1.0 and row["psych_safety_exit"] is not None

    # Выгрузки: только псевдонимы, никаких имён.
    for name in ["events.csv", "events.xes", "events.ocel.json", "surveys.csv", "nominations.csv",
                 "decisions.csv", "injects.csv", "participants.csv", "sessions.csv"]:
        r = client.get(f"/api/admin/export/{name}", headers={"Authorization": f"Bearer {admin.token}"})
        assert r.status_code == 200, name
        assert "Имя" not in r.text, name
    ev = client.get("/api/admin/export/events.csv", headers={"Authorization": f"Bearer {admin.token}"}).text
    assert "Взята в работу" in ev and "Веха закрыта" in ev and "P-00" in ev

    admin.post(url + "/phase", {"phase": "closed"})
    assert admin.post("/api/admin/identity/purge")["deleted"] == 5
    assert all(r["display_name"] is None for r in admin.get(url)["roster"])

    # Новая сессия — чистый снимок компании.
    s2 = admin.post(f"/api/admin/teams/{team['team_id']}/sessions")
    assert s2["session_id"] == "S-2"
    st = eng.get("/api/p/state")
    assert st["session"]["session_id"] == "S-2" and all(t["stage"] == "Бэклог" for t in st["tasks"])


def test_event_log_is_append_only(client, admin, make_team):
    import psycopg
    from app import config
    team, ppl = make_team("self_org", roles=("analyst",))
    admin.post(session_url(team) + "/phase", {"phase": "work"})
    ppl["analyst"].post("/api/p/tasks/T01/pull")
    with psycopg.connect(config.DATABASE_URL) as c:
        try:
            c.execute("UPDATE research.event SET activity = 'x'")
            raise AssertionError("журнал изменился")
        except psycopg.errors.RaiseException:
            pass


def test_hierarchy_rules(client, admin, make_team):
    team, ppl = make_team("hierarchy")
    admin.post(session_url(team) + "/phase", {"phase": "work"})
    pm, eng = ppl["pm"], ppl["engineer"]
    eng.post("/api/p/tasks/T01/pull", status=403)
    pm.post("/api/p/tasks/T01/assign", {"assignee": eng.pid})
    pm.post("/api/p/tasks/T01/pull")
    ppl["qa"].post("/api/p/tasks/T01/start", status=403)
    eng.post("/api/p/tasks/T01/start")
    eng.post("/api/p/tasks/T01/advance")
    eng.post("/api/p/tasks/T01/assign", {"assignee": eng.pid}, status=403)
    eng.post("/api/p/decisions", {"key_decision": True, "chosen": "C"}, status=403)
    pm.post("/api/p/decisions", {"key_decision": True, "chosen": "A"})
    eng.post("/api/p/milestones/M-1/deadline", {"minutes": 5}, status=403)


def test_kanban_wip_limit(client, admin, make_team):
    team, ppl = make_team("kanban", roles=("analyst",))
    url = session_url(team)
    admin.patch(url, {"wip_limit": 2})
    admin.post(url + "/phase", {"phase": "work"})
    a = ppl["analyst"]
    a.post("/api/p/tasks/T01/pull")
    a.post("/api/p/tasks/T02/pull")
    r = a.c.post("/api/p/tasks/T03/pull", headers={"Authorization": f"Bearer {a.token}"})
    assert r.status_code == 409 and "Лимит" in r.json()["detail"]


def test_sprints_require_planning(client, admin, make_team):
    team, ppl = make_team("sprints", roles=("analyst",))
    admin.post(session_url(team) + "/phase", {"phase": "work"})
    a = ppl["analyst"]
    a.post("/api/p/tasks/T01/pull", status=409)
    a.post("/api/p/tasks/T01/sprint", {"add": True})
    assert next(t for t in a.get("/api/p/state")["tasks"] if t["key"] == "T01")["sprint"] == 1
    a.post("/api/p/tasks/T01/pull")


def test_new_session_requires_closed_previous(client, admin, make_team):
    team, _ = make_team("self_org", roles=())
    admin.post(f"/api/admin/teams/{team['team_id']}/sessions", status=409)
