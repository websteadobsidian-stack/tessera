"""Пул соединений и применение схемы при старте."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from . import config, content

_pool: ConnectionPool | None = None
_MIGRATION_LOCK = 8_237_401


def open_pool(url: str | None = None) -> None:
    global _pool
    _pool = ConnectionPool(url or config.DATABASE_URL, min_size=1, max_size=10,
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


def migrate() -> None:
    """Создаёт схемы research и app, если их нет, и регистрирует версии сценариев."""
    with tx() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (_MIGRATION_LOCK,))
        if conn.execute("SELECT to_regclass('research.event') AS t").fetchone()["t"] is None:
            conn.execute((config.SCHEMA_DIR / "research_db.sql").read_text(encoding="utf-8"))
        if conn.execute("SELECT to_regclass('app.task') AS t").fetchone()["t"] is None:
            conn.execute((config.SCHEMA_DIR / "app_db.sql").read_text(encoding="utf-8"))
        for version, sc in content.scenarios().items():
            conn.execute(
                """INSERT INTO research.scenario_version (scenario_version, description, snapshot_ref)
                   VALUES (%s, %s, %s) ON CONFLICT (scenario_version) DO NOTHING""",
                (version, sc["description"], f"scenarios/{version}.json"),
            )


def json(value) -> Jsonb:
    return Jsonb(value)
