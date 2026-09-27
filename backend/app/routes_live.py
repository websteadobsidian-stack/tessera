"""Живой канал (SSE) и публичная конфигурация."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from . import auth, config
from .core import fail
from .db import tx
from .live import broadcaster, sse

router = APIRouter(prefix="/api")


def _scope(token: str) -> tuple[str, str | None]:
    """('participant', команда) или ('admin', команда | None для полного доступа)."""
    with tx() as conn:
        dev = conn.execute("SELECT team_id FROM app.device WHERE token = %s", (token,)).fetchone()
        if dev is not None:
            conn.execute("UPDATE app.device SET last_seen_at = now() WHERE token = %s", (token,))
            return "participant", dev["team_id"]
        row = conn.execute(
            "SELECT team_scope FROM app.admin_token WHERE token = %s AND (expires_at IS NULL OR expires_at > now())",
            (token,)).fetchone()
        if row is not None:
            return "admin", row["team_scope"]
    fail(401, "Нужна авторизация")


def _heartbeat(token: str) -> None:
    with tx() as conn:
        conn.execute("UPDATE app.device SET last_seen_at = now() WHERE token = %s", (token,))


@router.get("/live")
async def live(request: Request, token: str = Depends(auth.bearer)):
    kind, team = await asyncio.to_thread(_scope, token)
    sid, queue = broadcaster.subscribe(team)

    async def stream():
        try:
            yield "retry: 2000\n\n"
            yield sse("hello", {"scope": kind, "team": team})
            beats = 0
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=15)
                    batch = [msg]
                    while not queue.empty() and len(batch) < 32:
                        batch.append(queue.get_nowait())
                    teams = sorted({m["team"] for m in batch})
                    whats = sorted({m["what"] for m in batch})
                    yield sse("change", {"teams": teams, "what": whats})
                except asyncio.TimeoutError:
                    beats += 1
                    yield ": ping\n\n"
                    if kind == "participant" and beats % 2 == 0:
                        await asyncio.to_thread(_heartbeat, token)
        finally:
            broadcaster.unsubscribe(sid)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


@router.get("/config")
def public_config():
    return {"public_url": config.PUBLIC_URL, "demo": config.PUBLIC_DEMO, "version": "2.0"}
