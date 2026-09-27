"""Точка входа: uvicorn app.main:app"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import config, db, routes_admin, routes_demo, routes_live, routes_participant, worker
from .live import broadcaster

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.open_pool()
    db.migrate()
    broadcaster.start()
    task = asyncio.create_task(worker.run(), name="tessera-worker") if config.WORKER else None
    yield
    if task:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    await broadcaster.stop()
    db.close_pool()


app = FastAPI(title="Tessera", version="2.0.0", lifespan=lifespan)
app.include_router(routes_participant.router)
app.include_router(routes_admin.router)
app.include_router(routes_demo.router)
app.include_router(routes_live.router)


@app.get("/api/health")
def health():
    with db.tx() as conn:
        conn.execute("SELECT 1")
    return {"ok": True}
