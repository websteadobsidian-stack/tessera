from __future__ import annotations

import hmac
import secrets

from fastapi import Header, HTTPException

from . import config

JOIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def new_token() -> str:
    return secrets.token_urlsafe(32)


def new_join_code() -> str:
    return "".join(secrets.choice(JOIN_ALPHABET) for _ in range(6))


def password_ok(password: str) -> bool:
    return hmac.compare_digest(password.encode(), config.ADMIN_PASSWORD.encode())


def bearer(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Нужна авторизация")
    return authorization[7:].strip()


def check_admin(conn, token: str) -> None:
    if conn.execute("SELECT 1 FROM app.admin_token WHERE token = %s", (token,)).fetchone() is None:
        raise HTTPException(401, "Сессия ведущего истекла — войдите снова")
