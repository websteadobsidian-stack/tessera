from __future__ import annotations

import hmac
import secrets
from dataclasses import dataclass

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


@dataclass(frozen=True)
class Admin:
    token: str
    team_scope: str | None  # None — полный доступ; иначе только одна (демо-)команда

    @property
    def full(self) -> bool:
        return self.team_scope is None

    def require_full(self) -> None:
        if not self.full:
            raise HTTPException(403, "Доступно только ведущему с паролем")

    def require_team(self, team_id: str) -> None:
        if self.team_scope is not None and self.team_scope != team_id:
            raise HTTPException(403, "Нет доступа к этой команде")


def check_admin(conn, token: str) -> Admin:
    row = conn.execute(
        """SELECT token, team_scope FROM app.admin_token
            WHERE token = %s AND (expires_at IS NULL OR expires_at > now())""",
        (token,),
    ).fetchone()
    if row is None:
        raise HTTPException(401, "Сессия ведущего истекла — войдите снова")
    return Admin(row["token"], row["team_scope"])
