"""Точка входа: uvicorn app.main:app"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import db, routes_admin, routes_participant

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.open_pool()
    db.migrate()
    yield
    db.close_pool()


app = FastAPI(title="Tessera", version="0.2.0", lifespan=lifespan)
app.include_router(routes_participant.router)
app.include_router(routes_admin.router)


@app.get("/api/health")
def health():
    with db.tx() as conn:
        conn.execute("SELECT 1")
    return {"ok": True}
