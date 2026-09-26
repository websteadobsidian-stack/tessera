"""API ведущего: команды и сессии, управление фазами, вбросы, дебрифинг, данные."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from . import analytics, auth, content, core, views
from .core import fail
from .db import tx

router = APIRouter(prefix="/api/admin")


class LoginIn(BaseModel):
    password: str


class TeamIn(BaseModel):
    condition: Literal["kanban", "sprints", "hierarchy", "self_org"]
    label: str = Field(default="", max_length=120)
    scenario_version: str | None = None


class PhaseIn(BaseModel):
    phase: str


class SettingsIn(BaseModel):
    work_minutes: int | None = Field(default=None, ge=5, le=240)
    wip_limit: int | None = Field(default=None, ge=1, le=20)
    sprint_minutes: int | None = Field(default=None, ge=3, le=120)
    notes: str | None = Field(default=None, max_length=10000)


def admin(token: str = Depends(auth.bearer)) -> str:
    with tx() as conn:
        auth.check_admin(conn, token)
    return token


@router.post("/login")
def login(body: LoginIn):
    if not auth.password_ok(body.password):
        fail(401, "Неверный пароль")
    token = auth.new_token()
    with tx() as conn:
        conn.execute("INSERT INTO app.admin_token (token) VALUES (%s)", (token,))
    return {"token": token}


@router.post("/logout")
def logout(token: str = Depends(admin)):
    with tx() as conn:
        conn.execute("DELETE FROM app.admin_token WHERE token = %s", (token,))
    return {"ok": True}


@router.get("/overview")
def overview(_: str = Depends(admin)):
    with tx() as conn:
        teams = conn.execute(
            """SELECT t.team_id, t.join_code, t.condition, t.label, t.scenario_version, t.created_at,
                      (SELECT count(*) FROM research.participant p WHERE p.team_id = t.team_id) AS participants
                 FROM app.team_settings t ORDER BY t.created_at DESC"""
        ).fetchall()
        sessions = conn.execute(
            """SELECT st.team_id, st.session_id, st.phase, st.phase_changed_at, st.work_started_at,
                      (SELECT count(*) FROM research.event e
                        WHERE e.team_id = st.team_id AND e.session_id = st.session_id) AS events
                 FROM app.session_state st
                ORDER BY st.team_id, substring(st.session_id from 3)::int"""
        ).fetchall()
    by_team: dict[str, list] = {}
    for s in sessions:
        by_team.setdefault(s["team_id"], []).append(s)
    return {
        "teams": [{**t, "sessions": by_team.get(t["team_id"], [])} for t in teams],
        "scenarios": [{"version": v, "title": s["title"]} for v, s in content.scenarios().items()],
        "conditions": {k: v["title"] for k, v in content.scenario(content.default_scenario())["conditions"].items()},
    }


@router.post("/teams")
def create_team(body: TeamIn, _: str = Depends(admin)):
    version = body.scenario_version or content.default_scenario()
    if version not in content.scenarios():
        fail(422, "Неизвестный сценарий")
    with tx() as conn:
        return core.create_team(conn, body.condition, body.label, version)



@router.post("/teams/{team_id}/sessions")
def create_session(team_id: str, _: str = Depends(admin)):
    with tx() as conn:
        t = conn.execute("SELECT * FROM app.team_settings WHERE team_id = %s", (team_id,)).fetchone()
        if t is None:
            fail(404, "Команда не найдена")
        prev = core.latest_session(conn, team_id)
        if prev["phase"] != "closed":
            fail(409, "Сначала завершите текущую сессию команды")
        session_id = core.new_session(conn, team_id, t["condition"], t["scenario_version"])
    return {"team_id": team_id, "session_id": session_id}


@router.get("/sessions/{team_id}/{session_id}")
def live(team_id: str, session_id: str, _: str = Depends(admin)):
    with tx() as conn:
        session = core.session_row(conn, team_id, session_id)
        sc = content.scenario(session["scenario_version"])
        settings = conn.execute("SELECT * FROM app.team_settings WHERE team_id = %s", (team_id,)).fetchone()
        people = views.roster(conn, team_id)
        answered = conn.execute(
            """SELECT DISTINCT participant_id, phase FROM research.survey_response
                WHERE team_id = %s AND session_id = %s""",
            (team_id, session_id),
        ).fetchall()
        fired = conn.execute(
            """SELECT kind, count(*) AS n, max(ts) AS last FROM research.inject
                WHERE team_id = %s AND session_id = %s GROUP BY kind""",
            (team_id, session_id),
        ).fetchall()
        feed = conn.execute(
            """SELECT e.event_id, e.ts, e.activity, e.case_id, e.resource, e.attrs
                 FROM research.event e WHERE e.team_id = %s AND e.session_id = %s
                ORDER BY e.event_id DESC LIMIT 40""",
            (team_id, session_id),
        ).fetchall()
        meta = conn.execute("SELECT notes FROM research.session WHERE team_id = %s AND session_id = %s",
                            (team_id, session_id)).fetchone()
        pending_devices = conn.execute(
            "SELECT count(*) AS n FROM app.device WHERE team_id = %s AND participant_id IS NULL",
            (team_id,)).fetchone()["n"]
        board = views.board(conn, session, admin=True)
    done: dict[str, list[str]] = {}
    for a in answered:
        done.setdefault(a["participant_id"], []).append(a["phase"])
    prefix = f"{team_id}/{session_id}/"
    fired_by = {f["kind"]: f for f in fired}
    return {
        "team": {"team_id": team_id, "join_code": settings["join_code"], "label": settings["label"],
                 "condition": session["condition"], "condition_title": sc["conditions"][session["condition"]]["title"],
                 "scenario_version": session["scenario_version"]},
        "session": views.session_public(session),
        "notes": meta["notes"] or "",
        "roster": [{**p, "surveys": done.get(p["participant_id"], [])} for p in people],
        "pending_devices": pending_devices,
        "injects": [{"key": i["key"], "title": i["title"], "hint": i.get("hint", ""),
                     "fired": fired_by.get(i["key"], {}).get("n", 0),
                     "last": fired_by.get(i["key"], {}).get("last")} for i in sc["injects"]],
        "decision": sc["decision"],
        "feed": [{**f, "case_id": f["case_id"].removeprefix(prefix)} for f in feed],
        "phases": core.PHASES,
        **board,
    }


@router.post("/sessions/{team_id}/{session_id}/phase")
def phase(team_id: str, session_id: str, body: PhaseIn, _: str = Depends(admin)):
    with tx() as conn:
        core.set_phase(conn, core.session_row(conn, team_id, session_id), body.phase)
    return {"ok": True}


@router.patch("/sessions/{team_id}/{session_id}")
def settings(team_id: str, session_id: str, body: SettingsIn, _: str = Depends(admin)):
    with tx() as conn:
        core.session_row(conn, team_id, session_id)
        fields = body.model_dump(exclude_none=True)
        notes = fields.pop("notes", None)
        if fields:
            sets = ", ".join(f"{k} = %s" for k in fields)
            conn.execute(f"UPDATE app.session_state SET {sets} WHERE team_id = %s AND session_id = %s",
                         (*fields.values(), team_id, session_id))
        if notes is not None:
            conn.execute("UPDATE research.session SET notes = %s WHERE team_id = %s AND session_id = %s",
                         (notes, team_id, session_id))
    return {"ok": True}


@router.post("/sessions/{team_id}/{session_id}/injects/{key}")
def inject(team_id: str, session_id: str, key: str, _: str = Depends(admin)):
    with tx() as conn:
        core.fire_inject(conn, core.session_row(conn, team_id, session_id), key)
    return {"ok": True}


@router.get("/sessions/{team_id}/{session_id}/debrief")
def debrief(team_id: str, session_id: str, _: str = Depends(admin)):
    with tx() as conn:
        return analytics.debrief(conn, core.session_row(conn, team_id, session_id))


@router.get("/research")
def research(_: str = Depends(admin)):
    with tx() as conn:
        return analytics.research(conn)


@router.get("/export/{name}")
def export(name: str, _: str = Depends(admin)):
    with tx() as conn:
        result = analytics.export_file(conn, name)
    if result is None:
        fail(404, "Неизвестная выгрузка")
    data, media = result
    return Response(data, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="tessera-{name}"'})


@router.get("/identity")
def identity_status(_: str = Depends(admin)):
    with tx() as conn:
        n = conn.execute("SELECT count(*) AS n FROM identity.participant_map").fetchone()["n"]
    return {"names": n}


@router.post("/identity/purge")
def identity_purge(_: str = Depends(admin)):
    with tx() as conn:
        n = conn.execute("DELETE FROM identity.participant_map").rowcount
    return {"deleted": n}
