"""Публичный демо-режим «Попробовать одному» и управление песочницей («режиссёр»)."""

from __future__ import annotations

import random
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from . import auth, config, demo
from .core import fail, touch
from .db import tx
from .routes_admin import admin

router = APIRouter(prefix="/api/demo")

_recent: dict[str, deque] = defaultdict(deque)
LIMIT_PER_HOUR = 30


class DemoIn(BaseModel):
    role_slug: str = "analyst"
    condition: str | None = None
    name: str | None = Field(default=None, max_length=40)


class PossessIn(BaseModel):
    participant_id: str


class SpeedIn(BaseModel):
    speed: float = Field(ge=0.25, le=4)


def _rate_limit(ip: str) -> None:
    q = _recent[ip]
    now = time.monotonic()
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= LIMIT_PER_HOUR:
        fail(429, "Слишком много демо за час — попробуйте позже")
    q.append(now)


@router.post("")
def start(body: DemoIn, request: Request):
    if not config.PUBLIC_DEMO:
        fail(403, "Публичное демо выключено на этом сервере")
    _rate_limit(request.client.host if request.client else "?")
    with tx() as conn:
        return demo.create_sandbox(conn, body.role_slug, body.condition, body.name, random.Random())


def _sandbox(conn, a: auth.Admin) -> str:
    team = a.team_scope
    if team is None:
        fail(400, "Укажите демо-команду через токен режиссёра")
    row = conn.execute("SELECT demo_kind FROM app.team_settings WHERE team_id = %s", (team,)).fetchone()
    if row is None or row["demo_kind"] != "sandbox":
        fail(403, "Это не демо-песочница")
    return team


@router.post("/possess")
def possess(body: PossessIn, a: auth.Admin = Depends(admin)):
    with tx() as conn:
        team = _sandbox(conn, a)
        return {"participant_token": demo.possess(conn, team, body.participant_id)}


@router.post("/speed")
def speed(body: SpeedIn, a: auth.Admin = Depends(admin)):
    with tx() as conn:
        team = _sandbox(conn, a)
        conn.execute("UPDATE app.team_settings SET bot_speed = %s WHERE team_id = %s", (body.speed, team))
        touch(conn, team)
    return {"ok": True}
