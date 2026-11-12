"""FastAPI app: serves the dashboard page and /health. Data endpoints arrive in Phase 7."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import config

app = FastAPI(title="Market IQ", docs_url=None, redoc_url=None)
WEB = config.ROOT / "web"


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB / "index.html")


app.mount("/static", StaticFiles(directory=WEB), name="static")
