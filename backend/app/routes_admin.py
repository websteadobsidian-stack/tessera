"""API ведущего: команды и сессии, этапы, вмешательства и таймлайн, протоколы (Лаборатория),
серии команд с рандомизацией, разбор, исследование, выгрузки, демо-данные.

Токен ведущего бывает полным (по паролю) или ограниченным одной демо-командой («режиссёр» песочницы)."""

from __future__ import annotations

import random
import re
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from . import analytics, auth, content, core, demo, interventions, mechanics, views
from .core import fail
from .db import json, tx

router = APIRouter(prefix="/api/admin")


class LoginIn(BaseModel):
    password: str


class TeamIn(BaseModel):
    condition: Literal["kanban", "sprints", "hierarchy", "self_org"]
    label: str = Field(default="", max_length=120)
    protocol_id: str = "standard"
    scenario_version: str | None = None


class BatchIn(BaseModel):
    count: int = Field(ge=1, le=40)
    label: str = Field(default="", max_length=100)
    protocol_id: str = "standard"
    conditions: list[Literal["kanban", "sprints", "hierarchy", "self_org"]] = ["kanban", "sprints", "hierarchy", "self_org"]
    seed: int | None = None


class PhaseIn(BaseModel):
    phase: str


class SettingsIn(BaseModel):
    work_minutes: int | None = Field(default=None, ge=1, le=240)
    wip_limit: int | None = Field(default=None, ge=1, le=20)
    sprint_minutes: int | None = Field(default=None, ge=1, le=120)
    notes: str | None = Field(default=None, max_length=10000)
    bot_speed: float | None = Field(default=None, ge=0.25, le=4)


class InterventionIn(BaseModel):
    kind: Literal["inject", "probe", "silence", "blind_spot", "role_swap", "nudge"]
    key: str | None = None
    minutes: float | None = Field(default=None, ge=0.25, le=30)
    target: str | None = None
    a: str | None = None
    b: str | None = None
    text: str | None = Field(default=None, max_length=300)
    participant_id: str | None = None


class ProtocolIn(BaseModel):
    title: str = Field(min_length=2, max_length=80)
    description: str = Field(default="", max_length=600)
    config: dict


class DemoHistoryIn(BaseModel):
    per_condition: int = Field(default=2, ge=1, le=6)


class SandboxIn(BaseModel):
    role_slug: str = "analyst"
    condition: str | None = None
    name: str | None = Field(default=None, max_length=40)


def admin(token: str = Depends(auth.bearer)) -> auth.Admin:
    with tx() as conn:
        return auth.check_admin(conn, token)


def full(a: auth.Admin = Depends(admin)) -> auth.Admin:
    a.require_full()
    return a


# ---------------------------------------------------------------- вход

@router.post("/login")
def login(body: LoginIn):
    if not auth.password_ok(body.password):
        fail(401, "Неверный пароль")
    token = auth.new_token()
    with tx() as conn:
        conn.execute("INSERT INTO app.admin_token (token) VALUES (%s)", (token,))
    return {"token": token}


@router.post("/logout")
def logout(a: auth.Admin = Depends(admin)):
    with tx() as conn:
        conn.execute("DELETE FROM app.admin_token WHERE token = %s", (a.token,))
    return {"ok": True}


@router.get("/me")
def me(a: auth.Admin = Depends(admin)):
    return {"full": a.full, "team_scope": a.team_scope}


@router.get("/catalog")
def catalog(_: auth.Admin = Depends(admin)):
    sc = content.scenario(content.default_scenario())
    return {
        "mechanics": content.MECHANICS,
        "interventions": content.INTERVENTIONS,
        "injects": [{"key": i["key"], "title": i["title"], "hint": i.get("hint", ""), "icon": i.get("icon")} for i in sc["injects"]],
        "probes": [{"key": p["key"], "title": p.get("title", p["key"]), "question": p["question"]} for p in sc.get("probes", [])],
        "roles": [{"slug": r["slug"], "title": r["title"]} for r in sc["roles"]],
        "conditions": {k: {"title": v["title"], "tagline": v.get("tagline", "")} for k, v in sc["conditions"].items()},
        "levels": [{"from": lv[0], "title": lv[1], "text": lv[2]} for lv in content.LEVELS],
    }


# ---------------------------------------------------------------- команды

@router.get("/overview")
def overview(a: auth.Admin = Depends(admin)):
    with tx() as conn:
        teams = conn.execute(
            """SELECT t.team_id, t.join_code, t.condition, t.label, t.scenario_version, t.created_at, t.protocol_id,
                      t.is_demo, t.demo_kind, p.title AS protocol_title,
                      (SELECT count(*) FROM research.participant x WHERE x.team_id = t.team_id) AS participants
                 FROM app.team_settings t LEFT JOIN app.protocol p USING (protocol_id)
                WHERE (%s::text IS NULL OR t.team_id = %s)
                ORDER BY t.is_demo, t.created_at DESC""",
            (a.team_scope, a.team_scope),
        ).fetchall()
        sessions = conn.execute(
            """SELECT st.team_id, st.session_id, st.phase, st.phase_changed_at, st.work_started_at, st.work_minutes,
                      (SELECT count(*) FROM research.event e
                        WHERE e.team_id = st.team_id AND e.session_id = st.session_id) AS events,
                      (SELECT count(*) FROM app.task k WHERE k.team_id = st.team_id AND k.session_id = st.session_id
                          AND k.stage = 'Сдача') AS done,
                      (SELECT count(*) FROM app.task k WHERE k.team_id = st.team_id AND k.session_id = st.session_id) AS tasks
                 FROM app.session_state st
                WHERE (%s::text IS NULL OR st.team_id = %s)
                ORDER BY st.team_id, substring(st.session_id from 3)::int""",
            (a.team_scope, a.team_scope),
        ).fetchall()
    by_team: dict[str, list] = {}
    for s in sessions:
        by_team.setdefault(s["team_id"], []).append(s)
    return {"teams": [{**t, "sessions": by_team.get(t["team_id"], [])} for t in teams], "now": core.now()}


@router.post("/teams")
def create_team(body: TeamIn, _: auth.Admin = Depends(full)):
    version = body.scenario_version or content.default_scenario()
    if version not in content.scenarios():
        fail(422, "Неизвестный сценарий")
    with tx() as conn:
        return core.create_team(conn, body.condition, body.label, version, body.protocol_id)


@router.post("/teams/batch")
def create_batch(body: BatchIn, _: auth.Admin = Depends(full)):
    """Серия команд с блочной рандомизацией условий: в каждом блоке каждая методика встречается один раз."""
    rng = random.Random(body.seed)
    conditions = list(dict.fromkeys(body.conditions)) or ["kanban"]
    order: list[str] = []
    while len(order) < body.count:
        block = conditions[:]
        rng.shuffle(block)
        order.extend(block)
    created = []
    with tx() as conn:
        for i, cond in enumerate(order[:body.count], start=1):
            label = f"{body.label} · №{i}".strip(" ·") if body.label else f"Серия · №{i}"
            created.append({**core.create_team(conn, cond, label, content.default_scenario(), body.protocol_id),
                            "condition": cond})
    return {"teams": created}


@router.post("/teams/{team_id}/sessions")
def create_session(team_id: str, a: auth.Admin = Depends(admin)):
    a.require_team(team_id)
    with tx() as conn:
        prev = core.latest_session(conn, team_id)
        if prev["phase"] != "closed":
            fail(409, "Сначала завершите текущую сессию команды")
        session_id = core.new_session(conn, team_id)
        core.touch(conn, team_id, "phase")
    return {"team_id": team_id, "session_id": session_id}


# ---------------------------------------------------------------- сессия

def _session(conn, a: auth.Admin, team_id: str, session_id: str) -> dict:
    a.require_team(team_id)
    return core.session_row(conn, team_id, session_id)


@router.get("/sessions/{team_id}/{session_id}")
def live(team_id: str, session_id: str, a: auth.Admin = Depends(admin)):
    with tx() as conn:
        return {**views.admin_live(conn, _session(conn, a, team_id, session_id)), "scope": a.team_scope}


@router.get("/sessions/{team_id}/{session_id}/stage")
def stage(team_id: str, session_id: str, a: auth.Admin = Depends(admin)):
    with tx() as conn:
        return views.stage_state(conn, _session(conn, a, team_id, session_id))


@router.post("/sessions/{team_id}/{session_id}/phase")
def phase(team_id: str, session_id: str, body: PhaseIn, a: auth.Admin = Depends(admin)):
    with tx() as conn:
        session = _session(conn, a, team_id, session_id)
        if body.phase in ("exit", "closed") and content.mechanics(session["mechanics"]).get("retro"):
            mechanics.make_agreements(conn, team_id, session_id)
        core.set_phase(conn, session, body.phase)
    return {"ok": True}


@router.patch("/sessions/{team_id}/{session_id}")
def settings(team_id: str, session_id: str, body: SettingsIn, a: auth.Admin = Depends(admin)):
    with tx() as conn:
        _session(conn, a, team_id, session_id)
        fields = body.model_dump(exclude_none=True)
        notes = fields.pop("notes", None)
        speed = fields.pop("bot_speed", None)
        if fields:
            sets = ", ".join(f"{k} = %s" for k in fields)
            conn.execute(f"UPDATE app.session_state SET {sets} WHERE team_id = %s AND session_id = %s",
                         (*fields.values(), team_id, session_id))
        if notes is not None:
            conn.execute("UPDATE research.session SET notes = %s WHERE team_id = %s AND session_id = %s",
                         (notes, team_id, session_id))
        if speed is not None:
            conn.execute("UPDATE app.team_settings SET bot_speed = %s WHERE team_id = %s", (speed, team_id))
        core.touch(conn, team_id)
    return {"ok": True}


@router.post("/sessions/{team_id}/{session_id}/interventions")
def intervene(team_id: str, session_id: str, body: InterventionIn, a: auth.Admin = Depends(admin)):
    with tx() as conn:
        session = _session(conn, a, team_id, session_id)
        source = "director" if a.team_scope else "facilitator"
        return interventions.fire(conn, session, body.kind, body.model_dump(exclude_none=True), source)


@router.post("/sessions/{team_id}/{session_id}/schedule/{item_id}/{action}")
def schedule_item(team_id: str, session_id: str, item_id: int, action: Literal["fire", "skip"],
                  a: auth.Admin = Depends(admin)):
    with tx() as conn:
        session = _session(conn, a, team_id, session_id)
        item = conn.execute(
            "SELECT * FROM app.schedule WHERE item_id = %s AND team_id = %s AND session_id = %s AND fired_at IS NULL FOR UPDATE",
            (item_id, team_id, session_id)).fetchone()
        if item is None:
            fail(404, "Пункт таймлайна уже сработал или не найден")
        if action == "fire":
            interventions.fire(conn, session, item["kind"], item["payload"], "facilitator")
            conn.execute("UPDATE app.schedule SET fired_at = now() WHERE item_id = %s", (item_id,))
        else:
            conn.execute("UPDATE app.schedule SET fired_at = now(), payload = payload || %s WHERE item_id = %s",
                         (json({"skipped": True}), item_id))
        core.touch(conn, team_id)
    return {"ok": True}


@router.get("/sessions/{team_id}/{session_id}/debrief")
def debrief(team_id: str, session_id: str, a: auth.Admin = Depends(admin)):
    with tx() as conn:
        return analytics.debrief(conn, _session(conn, a, team_id, session_id))


# ---------------------------------------------------------------- Лаборатория: протоколы

def _validate_config(cfg: dict) -> dict:
    sc = content.scenario(content.default_scenario())
    out = {
        "work_minutes": int(cfg.get("work_minutes", 50)),
        "wip_limit": int(cfg.get("wip_limit", 3)),
        "sprint_minutes": int(cfg.get("sprint_minutes", 15)),
        "time_scale": float(cfg.get("time_scale", 1)),
        "mechanics": content.mechanics(cfg.get("mechanics")),
        "timeline": [],
    }
    if not 5 <= out["work_minutes"] <= 240 or not 1 <= out["wip_limit"] <= 20 or not 3 <= out["sprint_minutes"] <= 120:
        fail(422, "Параметры вне допустимых границ")
    if not 0.1 <= out["time_scale"] <= 2:
        fail(422, "Масштаб времени — от 0,1 до 2")
    kinds = {i["kind"] for i in content.INTERVENTIONS}
    injects = {i["key"] for i in sc["injects"]}
    probes = {p["key"] for p in sc.get("probes", [])}
    for item in cfg.get("timeline", []):
        kind = item.get("kind")
        minute = float(item.get("minute", -1))
        if kind not in kinds or not 0 <= minute <= out["work_minutes"]:
            fail(422, "Ошибка в таймлайне: вид или минута вне рабочей фазы")
        clean = {"minute": round(minute, 2), "kind": kind}
        if kind == "inject":
            if item.get("key") not in injects:
                fail(422, "В таймлайне неизвестный вброс")
            clean["key"] = item["key"]
        elif kind == "probe":
            if item.get("key") not in probes:
                fail(422, "В таймлайне неизвестный вопрос Синхрона")
            clean["key"] = item["key"]
        elif kind in ("silence", "blind_spot", "role_swap"):
            clean["minutes"] = max(0.5, min(30.0, float(item.get("minutes", 4))))
            if kind == "blind_spot":
                clean["target"] = item.get("target") or "busiest"
        elif kind == "nudge":
            text = (item.get("text") or "").strip()
            if not text:
                fail(422, "У подсказки в таймлайне нет текста")
            clean["text"] = text[:300]
        out["timeline"].append(clean)
    out["timeline"].sort(key=lambda x: x["minute"])
    return out


@router.get("/protocols")
def protocols(_: auth.Admin = Depends(admin)):
    with tx() as conn:
        rows = conn.execute(
            """SELECT p.*, (SELECT count(*) FROM app.team_settings t WHERE t.protocol_id = p.protocol_id AND NOT t.is_demo) AS teams
                 FROM app.protocol p ORDER BY p.builtin DESC, p.created_at""").fetchall()
    return {"protocols": rows}


@router.post("/protocols")
def create_protocol(body: ProtocolIn, _: auth.Admin = Depends(full)):
    cfg = _validate_config(body.config)
    base = re.sub(r"[^a-z0-9]+", "-", body.title.lower()).strip("-")[:24] or "protocol"
    with tx() as conn:
        pid = f"{base}-{secrets.token_hex(2)}"
        while conn.execute("SELECT 1 FROM app.protocol WHERE protocol_id = %s", (pid,)).fetchone():
            pid = f"{base}-{secrets.token_hex(2)}"
        conn.execute(
            "INSERT INTO app.protocol (protocol_id, title, description, config) VALUES (%s, %s, %s, %s)",
            (pid, body.title.strip(), body.description.strip(), json(cfg)))
    return {"protocol_id": pid}


@router.put("/protocols/{protocol_id}")
def update_protocol(protocol_id: str, body: ProtocolIn, _: auth.Admin = Depends(full)):
    cfg = _validate_config(body.config)
    with tx() as conn:
        p = core.get_protocol(conn, protocol_id)
        if p["builtin"]:
            fail(409, "Встроенный протокол нельзя менять — сделайте копию")
        conn.execute(
            "UPDATE app.protocol SET title = %s, description = %s, config = %s, updated_at = now() WHERE protocol_id = %s",
            (body.title.strip(), body.description.strip(), json(cfg), protocol_id))
    return {"ok": True}


@router.delete("/protocols/{protocol_id}")
def delete_protocol(protocol_id: str, _: auth.Admin = Depends(full)):
    with tx() as conn:
        p = core.get_protocol(conn, protocol_id)
        if p["builtin"]:
            fail(409, "Встроенный протокол удалить нельзя")
        used = conn.execute("SELECT 1 FROM app.team_settings WHERE protocol_id = %s LIMIT 1", (protocol_id,)).fetchone()
        if used:
            fail(409, "По этому протоколу уже работали команды — его нельзя удалить")
        conn.execute("DELETE FROM app.protocol WHERE protocol_id = %s", (protocol_id,))
    return {"ok": True}


# ---------------------------------------------------------------- исследование и данные

@router.get("/research")
def research(include_demo: bool = False, _: auth.Admin = Depends(full)):
    with tx() as conn:
        return analytics.research(conn, include_demo)


@router.get("/export/{name}")
def export(name: str, include_demo: bool = False, _: auth.Admin = Depends(full)):
    with tx() as conn:
        result = analytics.export_file(conn, name, include_demo)
    if result is None:
        fail(404, "Неизвестная выгрузка")
    data, media = result
    return Response(data, media_type=media, headers={"Content-Disposition": f'attachment; filename="tessera-{name}"'})


@router.get("/data/status")
def data_status(_: auth.Admin = Depends(full)):
    with tx() as conn:
        return conn.execute(
            """SELECT (SELECT count(*) FROM identity.participant_map) AS names,
                      (SELECT count(*) FROM app.message_body) AS messages,
                      (SELECT count(*) FROM app.team_settings WHERE NOT is_demo) AS teams,
                      (SELECT count(*) FROM app.team_settings WHERE is_demo AND demo_kind = 'history') AS demo_history,
                      (SELECT count(*) FROM app.team_settings WHERE is_demo AND demo_kind = 'sandbox') AS demo_sandbox,
                      (SELECT count(*) FROM research.event e JOIN research.team t USING (team_id) WHERE NOT t.is_demo) AS events""",
        ).fetchone()


@router.post("/data/purge-names")
def purge_names(_: auth.Admin = Depends(full)):
    with tx() as conn:
        n = conn.execute("DELETE FROM identity.participant_map").rowcount
    return {"deleted": n}


@router.post("/data/purge-messages")
def purge_messages(_: auth.Admin = Depends(full)):
    """Тексты сообщений Эфира удаляются, метаданные (кто, когда, кому, длина) остаются для анализа."""
    with tx() as conn:
        n = conn.execute("DELETE FROM app.message_body").rowcount
    return {"deleted": n}


@router.post("/demo/history")
def demo_history(body: DemoHistoryIn, _: auth.Admin = Depends(full)):
    with tx() as conn:
        teams = demo.seed_history(conn, body.per_condition, random.Random())
    return {"teams": teams}


@router.post("/demo/sandbox")
def demo_sandbox(body: SandboxIn, _: auth.Admin = Depends(full)):
    with tx() as conn:
        return demo.create_sandbox(conn, body.role_slug, body.condition, body.name, random.Random())


@router.delete("/demo")
def demo_purge(kind: Literal["history", "sandbox"] | None = None, _: auth.Admin = Depends(full)):
    with tx() as conn:
        return {"deleted": demo.purge(conn, kind)}
