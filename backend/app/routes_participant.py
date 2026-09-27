"""API участника: вход по коду, согласие, опросы, брифинг, доска, стол, Эфир, помощь,
благодарности, погода, Синхрон, ретро и разбор."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from . import analytics, auth, content, core, mechanics, surveys, views
from .core import fail
from .db import tx

router = APIRouter(prefix="/api")

CONSENT_TEXT = [
    "Tessera — учебная среда и научное исследование командной работы.",
    "Во время интенсива система записывает ваши действия с задачами, решения, сообщения в Эфире, "
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
    mirror: dict[str, float | str | None] = {}
    strengths: dict[str, str] = {}
    agreements: dict[str, int] = {}


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


class FactIn(BaseModel):
    fact_id: str


class VoteIn(BaseModel):
    option: str


class FinalizeIn(BaseModel):
    rationale: str | None = Field(default=None, max_length=1000)


class PreferenceIn(BaseModel):
    option: str
    confidence: int = Field(ge=1, le=5)


class CheckIn(BaseModel):
    answers: dict[str, str]


class ForecastIn(BaseModel):
    tasks_done: int = Field(ge=0, le=50)
    m1_on_time: bool
    confidence: int = Field(ge=1, le=5)


class CharterIn(BaseModel):
    field: str
    body: str = Field(max_length=400)


class MessageIn(BaseModel):
    body: str = Field(max_length=500)
    mentions: list[str] = []
    case_key: str | None = None


class HelpIn(BaseModel):
    case_key: str | None = None
    note: str | None = Field(default=None, max_length=200)


class KudosIn(BaseModel):
    to: str
    kind: str
    note: str | None = Field(default=None, max_length=140)


class WeatherIn(BaseModel):
    value: int = Field(ge=1, le=4)


class ProbeIn(BaseModel):
    answer: str


class CardIn(BaseModel):
    lane: Literal["start", "stop", "continue"]
    body: str = Field(max_length=200)


def _ctx(conn, token: str, need: bool = True) -> core.Ctx:
    ctx = core.participant_ctx(conn, token, need_participant=need)
    core.seen(conn, token)
    return ctx


# ---------------------------------------------------------------- вход и состояние

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
        ctx = _ctx(conn, token, need=False)
        sc = ctx.scenario
        s = ctx.session
        base = {
            "team": {"team_id": ctx.team_id, "join_code": s["join_code"], "label": s["label"], "condition": ctx.condition,
                     "condition_title": sc["conditions"][ctx.condition]["title"],
                     "is_demo": s["is_demo"], "demo_kind": s["demo_kind"]},
            "session": views.session_public(s),
            "company": {"title": sc["title"], "description": sc["description"]},
        }
        if ctx.participant_id is None:
            return {**base, "me": None, "consent_text": CONSENT_TEXT,
                    "roles": views.roles_availability(conn, ctx.team_id, sc)}
        return {**base, **views.participant_state(conn, ctx)}


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
                WHERE team_id = %s AND coalesce(orig_role_slug, role_slug) = %s AND participant_id IS NOT NULL""",
            (ctx.team_id, role["slug"]),
        ).fetchone()["n"]
        if taken >= role["capacity"]:
            fail(409, "Эта роль уже занята — выберите другую")
        pid = core.create_participant(conn, ctx.team_id, role, body.display_name, device_token=token)
    return {"participant_id": pid}


@router.post("/p/survey")
def survey(body: SurveyIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        surveys.submit_survey(conn, _ctx(conn, token), body.model_dump())
    return {"ok": True}


# ---------------------------------------------------------------- доска

@router.post("/p/tasks/{key}/{action}")
def task_action(key: str, action: str, body: ActionIn | None = None, token: str = Depends(auth.bearer)):
    with tx() as conn:
        core.task_action(conn, _ctx(conn, token), key, action, (body or ActionIn()).model_dump(exclude_none=True))
    return {"ok": True}


@router.post("/p/milestones/{key}/close")
def close_milestone(key: str, token: str = Depends(auth.bearer)):
    with tx() as conn:
        core.close_milestone(conn, _ctx(conn, token), key)
    return {"ok": True}


@router.post("/p/milestones/{key}/deadline")
def shift_deadline(key: str, body: DeadlineIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        core.shift_deadline(conn, _ctx(conn, token), key, body.minutes)
    return {"ok": True}


@router.post("/p/decisions")
def decision(body: DecisionIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        core.record_decision(conn, _ctx(conn, token), body.model_dump())
    return {"ok": True}


# ---------------------------------------------------------------- общий стол и брифинг

@router.post("/p/table/facts")
def share_fact(body: FactIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        mechanics.share_fact(conn, _ctx(conn, token), body.fact_id)
    return {"ok": True}


@router.post("/p/table/vote")
def vote(body: VoteIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        mechanics.vote(conn, _ctx(conn, token), body.option)
    return {"ok": True}


@router.post("/p/table/finalize")
def finalize(body: FinalizeIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        chosen = mechanics.finalize(conn, _ctx(conn, token), body.rationale)
    return {"chosen": chosen}


@router.post("/p/briefing/preference")
def preference(body: PreferenceIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        mechanics.set_preference(conn, _ctx(conn, token), body.option, body.confidence)
    return {"ok": True}


@router.post("/p/briefing/check")
def check(body: CheckIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        return mechanics.answer_check(conn, _ctx(conn, token), body.answers)


@router.post("/p/briefing/forecast")
def forecast(body: ForecastIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        mechanics.forecast(conn, _ctx(conn, token), body.tasks_done, body.m1_on_time, body.confidence)
    return {"ok": True}


@router.post("/p/charter")
def charter(body: CharterIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        mechanics.set_charter(conn, _ctx(conn, token), body.field, body.body)
    return {"ok": True}


# ---------------------------------------------------------------- взаимодействие

@router.post("/p/air")
def post_message(body: MessageIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        mid = mechanics.post_message(conn, _ctx(conn, token), body.body, body.mentions, body.case_key)
    return {"message_id": mid}


@router.post("/p/help")
def request_help(body: HelpIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        hid = mechanics.request_help(conn, _ctx(conn, token), body.case_key, body.note)
    return {"help_id": hid}


@router.post("/p/help/{help_id}/answer")
def answer_help(help_id: int, token: str = Depends(auth.bearer)):
    with tx() as conn:
        mechanics.answer_help(conn, _ctx(conn, token), help_id)
    return {"ok": True}


@router.post("/p/help/{help_id}/resolve")
def resolve_help(help_id: int, token: str = Depends(auth.bearer)):
    with tx() as conn:
        mechanics.resolve_help(conn, _ctx(conn, token), help_id)
    return {"ok": True}


@router.post("/p/kudos")
def kudos(body: KudosIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        mechanics.send_kudos(conn, _ctx(conn, token), body.to, body.kind, body.note)
    return {"ok": True}


@router.post("/p/weather")
def weather(body: WeatherIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        mechanics.set_weather(conn, _ctx(conn, token), body.value)
    return {"ok": True}


@router.post("/p/probe/{probe_id}")
def answer_probe(probe_id: int, body: ProbeIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        mechanics.answer_probe(conn, _ctx(conn, token), probe_id, body.answer)
    return {"ok": True}


# ---------------------------------------------------------------- ретро и разбор

@router.post("/p/retro/cards")
def retro_card(body: CardIn, token: str = Depends(auth.bearer)):
    with tx() as conn:
        mechanics.retro_add(conn, _ctx(conn, token), body.lane, body.body)
    return {"ok": True}


@router.post("/p/retro/cards/{card_id}/vote")
def retro_vote(card_id: int, token: str = Depends(auth.bearer)):
    with tx() as conn:
        mechanics.retro_vote(conn, _ctx(conn, token), card_id)
    return {"ok": True}


@router.get("/p/debrief")
def debrief(token: str = Depends(auth.bearer)):
    with tx() as conn:
        ctx = _ctx(conn, token)
        if ctx.session["phase"] not in views.DEBRIEF_PHASES:
            fail(409, "Разбор откроется после рабочей сессии")
        return analytics.debrief(conn, ctx.session, viewer=ctx.participant_id)
