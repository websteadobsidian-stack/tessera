"""Пул соединений, миграции схемы и уведомления об изменениях."""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Iterator

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from . import config

log = logging.getLogger("tessera.db")

_pool: ConnectionPool | None = None
_MIGRATION_LOCK = 8_237_401
CHANNEL = "tessera_live"


def open_pool(url: str | None = None) -> None:
    global _pool
    _pool = ConnectionPool(url or config.DATABASE_URL, min_size=1, max_size=12,
                           kwargs={"row_factory": dict_row}, open=True)
    _pool.wait(timeout=60)


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def tx() -> Iterator[Connection]:
    """Одна транзакция: commit при выходе, rollback при исключении."""
    assert _pool is not None, "пул не открыт"
    with _pool.connection() as conn:
        yield conn


def json(value) -> Jsonb:
    return Jsonb(value)


def notify(conn: Connection, team_id: str, what: str = "state") -> None:
    """Сообщить подписчикам, что состояние команды изменилось. Доставляется при commit."""
    conn.execute("SELECT pg_notify(%s, %s)", (CHANNEL, f"{team_id}|{what}"))


# ---------------------------------------------------------------- миграции

def _migrations() -> list[tuple[str, str]]:
    files = sorted((config.SCHEMA_DIR / "migrations").glob("*.sql"))
    return [(f.stem, f.read_text(encoding="utf-8")) for f in files]


def migrate() -> None:
    """Применяет недостающие миграции по порядку. База версии 0.1 распознаётся по таблицам."""
    from . import content  # избегаем цикла импортов

    with tx() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (_MIGRATION_LOCK,))
        conn.execute("""CREATE TABLE IF NOT EXISTS public.tessera_migrations (
                            version    text PRIMARY KEY,
                            applied_at timestamptz NOT NULL DEFAULT now())""")
        applied = {r["version"] for r in conn.execute("SELECT version FROM public.tessera_migrations")}
        if not applied:
            # Базы 0.1 создавались без журнала миграций — отмечаем уже существующие схемы.
            legacy = {"0001_research": "research.event", "0002_app": "app.task"}
            for version, table in legacy.items():
                if conn.execute("SELECT to_regclass(%s) AS t", (table,)).fetchone()["t"] is not None:
                    conn.execute("INSERT INTO public.tessera_migrations (version) VALUES (%s)", (version,))
                    applied.add(version)
        for version, sql in _migrations():
            if version in applied:
                continue
            log.info("миграция %s", version)
            conn.execute(sql)
            conn.execute("INSERT INTO public.tessera_migrations (version) VALUES (%s)", (version,))

        for version, sc in content.scenarios().items():
            conn.execute(
                """INSERT INTO research.scenario_version (scenario_version, description, snapshot_ref)
                   VALUES (%s, %s, %s) ON CONFLICT (scenario_version) DO NOTHING""",
                (version, sc["description"], f"scenarios/{version}.json"),
            )
        for p in content.builtin_protocols():
            conn.execute(
                """INSERT INTO app.protocol (protocol_id, title, description, config, builtin)
                   VALUES (%s, %s, %s, %s, true)
                   ON CONFLICT (protocol_id) DO UPDATE
                      SET title = EXCLUDED.title, description = EXCLUDED.description,
                          config = EXCLUDED.config, updated_at = now()
                    WHERE app.protocol.builtin""",
                (p["protocol_id"], p["title"], p["description"], json(p["config"])),
            )
