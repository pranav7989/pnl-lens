"""FastAPI app: serves the dashboard page and /health, and runs the daily jobs (app/jobs/scheduler.py) while it is up.
Set MARKET_IQ_SCHEDULER=off to run without them (tests do). Data endpoints arrive in Phase 7."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import config


@asynccontextmanager
async def lifespan(_: FastAPI):
    sched = None
    if os.getenv("MARKET_IQ_SCHEDULER", "on") != "off":
        from app.jobs import scheduler
        sched = scheduler.build()
        sched.start()
    yield
    if sched:
        sched.shutdown(wait=False)


app = FastAPI(title="Market IQ", docs_url=None, redoc_url=None, lifespan=lifespan)
WEB = config.ROOT / "web"


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB / "index.html")


app.mount("/static", StaticFiles(directory=WEB), name="static")
