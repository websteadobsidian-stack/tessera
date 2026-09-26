"""API участника: вход по коду команды, согласие, опросы, доска, решения, дебрифинг."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from . import analytics, auth, content, core, views
from .core import fail
from .db import tx

router = APIRouter(prefix="/api")

CONSENT_TEXT = [
    "Tessera — учебная среда и научное исследование командной работы.",
    "Во время интенсива система записывает ваши действия с задачами (кто, что и когда сделал), "
    "ответы на короткие опросы и анонимные оценки коллег.",
    "В исследовательской базе вы будете только кодом вида P-001. Имя, если вы его укажете, хранится отдельно, "
    "видно только вашей команде и удаляется после завершения сбора данных.",
    "Данные не используются для выставления оценок по дисциплине.",
    "Участие добровольное: вы можете отказаться сейчас или в любой момент позже без каких-либо последствий.",
]


class JoinIn(BaseModel):
    code: str = Field(min_length=4, max_length=12)


class ConsentIn(BaseModel):
    agree: bool
    role_slug: str | None = None
    display_name: str | None = Field(default=None, max_length=40)


class SurveyIn(BaseModel):
    answers: dict[str, dict[str, float]] = {}
    texts: dict[str, dict[str, str]] = {}
    nominations: dict[str, list[str]] = {}


class ActionIn(BaseModel):
    to: str | None = None
    assignee: str | None = None
    add: bool | None = None


class DeadlineIn(BaseModel):
    minutes: int


class DecisionIn(BaseModel):
    key_decision: bool = False
    title: str | None = Field(default=None, max_length=200)
    chosen: str = Field(max_length=300)
    alternatives: list[str] = []
    rationale: str | None = Field(default=None, max_length=2000)
    proposed_by: str | None = None
    case_key: str | None = Field(default=None, max_length=20)


@router.post("/join")
def join(body: JoinIn):
    code = body.code.strip().upper()
    with tx() as conn:
        team = conn.execute("SELECT team_id FROM app.team_settings WHERE join_code = %s", (code,)).fetchone()
        if team is None:
            fail(404, "Команда с таким кодом не найдена")
        session = core.latest_session(conn, team["team_id"])
        if session["phase"] == "closed":
            fail(409, "Эта сессия уже завершена")
        token = auth.new_token()
        conn.execute("INSERT INTO app.device (token, team_id) VALUES (%s, %s)", (token, team["team_id"]))
    return {"token": token, "team_id": team["team_id"]}


@router.get("/p/state")
def state(token: str = Depends(auth.bearer)):
    with tx() as conn:
        ctx = core.participant_ctx(conn, token, need_participant=False)
        sc = ctx.scenario
        settings = conn.execute("SELECT label FROM app.team_settings WHERE team_id = %s",
                                (ctx.team_id,)).fetchone()
        base = {
            "team": {"team_id": ctx.team_id, "label": settings["label"], "condition": ctx.condition,
                     "condition_title": sc["conditions"][ctx.condition]["title"]},
            "session": views.session_public(ctx.session),
            "company": {"title": sc["title"], "description": sc["description"]},
        }
        if ctx.participant_id is None:
            return {**base, "me": None, "consent_text": CONSENT_TEXT,
                    "roles": views.roles_availability(conn, ctx.team_id, sc)}
        me = conn.execute(
            """SELECT p.participant_id, p.role AS role_title, m.person AS display_name
                 FROM research.participant p
                 LEFT JOIN identity.participant_map m USING (participant_id)
                WHERE p.participant_id = %s""",
            (ctx.participant_id,),
        ).fetchone()
        return {
            **base,
            "me": {**me, "role_slug": ctx.role_slug, "is_pm": ctx.is_pm},
            "scenario": views.scenario_public(sc, ctx.role_slug, ctx.condition),
            "roster": views.roster(conn, ctx.team_id),
            "survey": views.survey_status(conn, ctx.session, ctx.participant_id),
            **views.board(conn, ctx.session, ctx.role_slug),
        }


@router.post("/p/consent")
def consent(body: ConsentIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        ctx = core.participant_ctx(conn, token, need_participant=False)
        if ctx.participant_id is not None:
            fail(409, "Согласие уже получено")
        if not body.agree:
            conn.execute("DELETE FROM app.device WHERE token = %s", (token,))
            return {"declined": True}
        role = content.role(ctx.scenario, body.role_slug)
        if role is None:
            fail(422, "Выберите роль")
        conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (ctx.team_id,))
        taken = conn.execute(
            """SELECT count(*) AS n FROM app.device
                WHERE team_id = %s AND role_slug = %s AND participant_id IS NOT NULL""",
            (ctx.team_id, role["slug"]),
        ).fetchone()["n"]
        if taken >= role["capacity"]:
            fail(409, "Эта роль уже занята — выберите другую")
        pid = core.create_participant(conn, ctx.team_id, role, body.display_name, device_token=token)
    return {"participant_id": pid}


@router.post("/p/survey")
def survey(body: SurveyIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        ctx = core.participant_ctx(conn, token)
        status = views.survey_status(conn, ctx.session, ctx.participant_id)
        if status is None:
            fail(409, "Сейчас нет открытого опроса")
        if status["done"]:
            fail(409, "Вы уже ответили на этот опрос")
        rows = []
        for inst in status["instruments"]:
            for item in inst["items"]:
                if inst["type"] == "text":
                    text = (body.texts.get(inst["id"], {}).get(item["id"]) or "").strip()
                    if not text and not item.get("optional"):
                        fail(422, f"Ответьте на вопрос: {item['text']}")
                    if text:
                        rows.append((inst["id"], item["id"], None, text[:4000]))
                    continue
                value = body.answers.get(inst["id"], {}).get(item["id"])
                if value is None:
                    fail(422, f"Ответьте на все вопросы блока «{inst['title']}»")
                if not inst["min"] <= value <= inst["max"]:
                    fail(422, "Ответ вне шкалы")
                rows.append((inst["id"], item["id"], value, None))
        for instrument, item, value, text in rows:
            conn.execute(
                """INSERT INTO research.survey_response (participant_id, team_id, session_id, phase,
                                                         instrument, item, value, text_value)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (ctx.participant_id, ctx.team_id, ctx.session_id, ctx.session["phase"], instrument, item,
                 value, text),
            )
        if status["nominations"]:
            team = {r["participant_id"] for r in views.roster(conn, ctx.team_id)}
            for question, targets in body.nominations.items():
                if question not in status["nominations"]:
                    fail(422, "Неизвестный вопрос о коллегах")
                for to in set(targets):
                    if to == ctx.participant_id or to not in team:
                        continue
                    conn.execute(
                        """INSERT INTO research.peer_nomination (from_participant, to_participant, team_id,
                                                                 session_id, question)
                           VALUES (%s, %s, %s, %s, %s)""",
                        (ctx.participant_id, to, ctx.team_id, ctx.session_id, question),
                    )
    return {"ok": True}


@router.post("/p/tasks/{key}/{action}")
def task_action(key: str, action: str, body: ActionIn | None = None, token: str = Depends(auth.bearer)):
    with tx() as conn:
        ctx = core.participant_ctx(conn, token)
        core.task_action(conn, ctx, key, action, (body or ActionIn()).model_dump(exclude_none=True))
    return {"ok": True}


@router.post("/p/milestones/{key}/close")
def close_milestone(key: str, token: str = Depends(auth.bearer)):
    with tx() as conn:
        core.close_milestone(conn, core.participant_ctx(conn, token), key)
    return {"ok": True}


@router.post("/p/milestones/{key}/deadline")
def shift_deadline(key: str, body: DeadlineIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        core.shift_deadline(conn, core.participant_ctx(conn, token), key, body.minutes)
    return {"ok": True}


@router.post("/p/decisions")
def decision(body: DecisionIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        core.record_decision(conn, core.participant_ctx(conn, token), body.model_dump())
    return {"ok": True}


@router.get("/p/debrief")
def debrief(token: str = Depends(auth.bearer)):
    with tx() as conn:
        ctx = core.participant_ctx(conn, token)
        if ctx.session["phase"] not in ("debrief", "exit", "closed"):
            fail(409, "Разбор откроется после рабочей сессии")
        return analytics.debrief(conn, ctx.session)
