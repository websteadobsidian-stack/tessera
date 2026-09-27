"""Фоновый цикл платформы. Раз в секунду:

* срабатывают запланированные вмешательства протоколов (таймлайн);
* возвращаются роли после смены и оповещаются экраны об окончании тишины, выезда, Синхрона;
* проверяются командные достижения и (если включены) отправляются подсказки;
* действуют боты демо-команд;
* раз в 10 минут удаляются брошенные демо-песочницы старше суток.

Работает ровно в одном процессе: процессы API соревнуются за advisory-lock PostgreSQL,
и если лидер падает, блокировку подхватывает другой."""

from __future__ import annotations

import asyncio
import logging
import random
import time
from datetime import datetime, timezone

import psycopg

from . import bots, config, insights, interventions
from .core import session_row, touch
from .db import tx

log = logging.getLogger("tessera.worker")
LOCK = 8_237_402
ACTIVE_PHASES = ("briefing", "work", "pulse", "debrief", "retro", "exit", "entry", "lobby")


class State:
    def __init__(self) -> None:
        self.n = 0
        self.last = datetime.now(timezone.utc)
        self.rng = random.Random()


def _expiries(conn, since: datetime) -> None:
    """Экраны должны узнать, что тишина, выезд или Синхрон закончились, даже если никто ничего не нажимал."""
    teams = set()
    for sql in (
        "SELECT team_id FROM app.session_state WHERE silence_until > %s AND silence_until <= now()",
        "SELECT team_id FROM app.device WHERE away_until > %s AND away_until <= now()",
        "SELECT team_id FROM research.probe WHERE closes_at > %s AND closes_at <= now()",
    ):
        teams |= {r["team_id"] for r in conn.execute(sql, (since,))}
    for t in teams:
        touch(conn, t, "expire")


def tick(state: State) -> None:
    started = datetime.now(timezone.utc)
    with tx() as conn:
        interventions.fire_due(conn)
        interventions.restore_swaps(conn)
        _expiries(conn, state.last)
    with tx() as conn:
        sessions = conn.execute(
            """SELECT DISTINCT ON (st.team_id) st.team_id, st.session_id
                 FROM app.session_state st JOIN app.team_settings ts USING (team_id)
                WHERE st.phase = ANY(%s) AND st.phase_changed_at > now() - interval '12 hours'
                  AND coalesce(ts.demo_kind, '') <> 'history'
                ORDER BY st.team_id, substring(st.session_id from 3)::int DESC""",
            (list(ACTIVE_PHASES),),
        ).fetchall()
    for s in sessions:
        try:
            with tx() as conn:
                session = session_row(conn, s["team_id"], s["session_id"])
                if state.n % 3 == 0:
                    insights.evaluate_achievements(conn, session)
                if state.n % 5 == 0 and session["phase"] == "work":
                    insights.send_nudges(conn, session)
                if session["is_demo"] and session["demo_kind"] == "sandbox":
                    bots.autopilot(conn, session)
                    bots.tick_session(conn, session_row(conn, s["team_id"], s["session_id"]), state.rng)
        except Exception:
            log.exception("worker: сессия %s/%s", s["team_id"], s["session_id"])
    if state.n % 600 == 0:
        with tx() as conn:
            for r in conn.execute(
                    """SELECT team_id FROM app.team_settings
                        WHERE is_demo AND demo_kind = 'sandbox' AND created_at < now() - interval '24 hours'""").fetchall():
                conn.execute("SELECT research.purge_demo_team(%s)", (r["team_id"],))
                log.info("worker: удалена демо-песочница %s", r["team_id"])
    state.last = started
    state.n += 1


async def run() -> None:
    state = State()
    while True:
        try:
            async with await psycopg.AsyncConnection.connect(config.DATABASE_URL, autocommit=True) as lock_conn:
                cur = await lock_conn.execute("SELECT pg_try_advisory_lock(%s)", (LOCK,))
                got = (await cur.fetchone())[0]
                if not got:
                    await asyncio.sleep(5)
                    continue
                log.info("worker: этот процесс ведёт фоновый цикл")
                while True:
                    t0 = time.monotonic()
                    await asyncio.to_thread(tick, state)
                    if state.n % 30 == 0:
                        await lock_conn.execute("SELECT 1")  # проверка, что блокировка ещё наша
                    await asyncio.sleep(max(0.2, 1.0 - (time.monotonic() - t0)))
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("worker: перезапуск через 3 секунды")
            await asyncio.sleep(3)
