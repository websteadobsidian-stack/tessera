"""Живые обновления: Server-Sent Events поверх PostgreSQL LISTEN/NOTIFY.

Любое изменение делает pg_notify('tessera_live', '<team>|<что>') внутри своей транзакции —
уведомление уходит только при commit. Каждый процесс API держит одно слушающее соединение
и раздаёт события подписчикам своей команды. Работает при нескольких воркерах uvicorn."""

from __future__ import annotations

import asyncio
import itertools
import json
import logging

import psycopg

from . import config
from .db import CHANNEL

log = logging.getLogger("tessera.live")


class Broadcaster:
    def __init__(self) -> None:
        self._subs: dict[int, tuple[str | None, asyncio.Queue]] = {}
        self._ids = itertools.count(1)
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="tessera-live")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None

    def subscribe(self, team: str | None) -> tuple[int, asyncio.Queue]:
        """team=None — все команды (полный доступ ведущего)."""
        sid = next(self._ids)
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        self._subs[sid] = (team, q)
        return sid, q

    def unsubscribe(self, sid: int) -> None:
        self._subs.pop(sid, None)

    def publish(self, team: str, what: str) -> None:
        for scope, q in list(self._subs.values()):
            if scope is None or scope == team:
                try:
                    q.put_nowait({"team": team, "what": what})
                except asyncio.QueueFull:
                    pass  # клиент всё равно перечитает состояние целиком

    async def _run(self) -> None:
        while True:
            try:
                async with await psycopg.AsyncConnection.connect(config.DATABASE_URL, autocommit=True) as conn:
                    await conn.execute(f"LISTEN {CHANNEL}")
                    log.info("live: слушаю %s", CHANNEL)
                    async for n in conn.notifies():
                        team, _, what = n.payload.partition("|")
                        self.publish(team, what or "state")
            except asyncio.CancelledError:
                raise
            except Exception as e:  # соединение оборвалось — переподключаемся
                log.warning("live: %s, переподключение", e)
                await asyncio.sleep(2)


broadcaster = Broadcaster()


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
