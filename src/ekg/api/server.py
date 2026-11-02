"""FastAPI server for the ECG project: project state, exported web data and the built UI.

Endpoints
---------
- ``GET /api/health``       -> ``{"status": "ok"}``
- ``GET /api/state``        -> contents of ``project_state.json`` (read fresh on every request)
- ``GET /api/data/{name}``  -> whitelisted JSON export from ``web/public/data/`` or ``artifacts/web/``
  (the latter is written by ``python -m ekg.pipeline train --out artifacts``)
- ``/``                     -> static UI from ``web/dist`` if built, otherwise a JSON hint

The project root comes from the ``EKG_ROOT`` environment variable (default: three levels above
this file, i.e. the repository root in the src layout). It is resolved per request, so changing
``EKG_ROOT`` at runtime (e.g. in tests) takes effect immediately.

Run: ``python -m ekg.api.server --host 127.0.0.1 --port 8000``
"""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from starlette.staticfiles import StaticFiles
from starlette.types import Receive, Scope, Send

# Stems of JSON files the UI may fetch via /api/data/{name}. Nothing else is ever served.
DATA_WHITELIST: frozenset[str] = frozenset(
    {
        "signal_demo",
        "filter_response",
        "architecture",
        "segmentation_demo",
        "dataset_stats",
        "metrics",
        "tree",
        "project_state",
    }
)
_NAME_RE = re.compile(r"[a-z_]+\.json")
# Search order for data exports, relative to the project root.
DATA_DIRS: tuple[str, ...] = ("web/public/data", "artifacts/web")

_DEFAULT_ROOT = Path(__file__).resolve().parents[3]


def get_root() -> Path:
    """Project root: $EKG_ROOT if set, else three levels above this file's package dir."""
    env = os.environ.get("EKG_ROOT")
    return Path(env).resolve() if env else _DEFAULT_ROOT


def resolve_data_file(name: str, root: Path | None = None) -> Path | None:
    """Return the path of a whitelisted data file, or None if not allowed / not present.

    The name must fully match ``[a-z_]+\\.json`` and its stem must be in DATA_WHITELIST,
    which already excludes any path separators or dots beyond the extension. As defence in
    depth, the resolved path must also stay inside the respective data directory.
    """
    if not _NAME_RE.fullmatch(name):
        return None
    if name[: -len(".json")] not in DATA_WHITELIST:
        return None
    root = (root or get_root()).resolve()
    for rel in DATA_DIRS:
        base = (root / rel).resolve()
        candidate = (base / name).resolve()
        if not candidate.is_relative_to(base):
            continue
        if candidate.is_file():
            return candidate
    return None


class _DynamicUI:
    """ASGI app serving ``<root>/web/dist`` (html=True) if it exists, else a JSON hint on '/'.

    The root is resolved per request; StaticFiles instances are cached per dist directory.
    """

    def __init__(self) -> None:
        self._cache: dict[Path, StaticFiles] = {}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":  # pragma: no cover - no websockets/lifespan expected here
            return
        path = scope.get("path", "/")
        # Never let unmatched /api/* requests fall through to the static UI.
        if path == "/api" or path.startswith("/api/"):
            await JSONResponse({"detail": "Not Found"}, status_code=404)(scope, receive, send)
            return
        dist = get_root() / "web" / "dist"
        if dist.is_dir():
            static = self._cache.get(dist)
            if static is None:
                static = self._cache[dist] = StaticFiles(directory=dist, html=True)
            await static(scope, receive, send)
            return
        if path in ("", "/"):
            response = JSONResponse(
                {
                    "status": "ok",
                    "message": "UI noch nicht gebaut: 'cd web && npm run build' ausführen "
                    "(oder 'npm run dev' für den Entwicklungsserver).",
                    "api": ["/api/health", "/api/state", "/api/data/{name}"],
                }
            )
        else:
            response = JSONResponse({"detail": "Not Found"}, status_code=404)
        await response(scope, receive, send)


def create_app() -> FastAPI:
    app = FastAPI(title="EKG-Arrhythmie API", version="0.1.0", docs_url="/api/docs",
                  openapi_url="/api/openapi.json", redoc_url=None)

    @app.middleware("http")
    async def _no_store_for_api(request: Request, call_next):
        response = await call_next(request)
        if request.url.path == "/api" or request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/state")
    def state():
        path = get_root() / "project_state.json"
        try:
            raw = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="project_state.json nicht gefunden")
        except (OSError, UnicodeDecodeError) as exc:  # directory, permissions, bad encoding ...
            raise HTTPException(status_code=503,
                                detail=f"project_state.json nicht lesbar ({type(exc).__name__})")
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=503, detail=f"project_state.json ungültig: {exc.msg}")

    @app.get("/api/data/{name}")
    def data(name: str):
        path = resolve_data_file(name)
        if path is None:
            raise HTTPException(status_code=404, detail="Datei nicht verfügbar")
        return Response(content=path.read_bytes(), media_type="application/json")

    # Mounted last so all /api routes take precedence.
    app.mount("/", _DynamicUI(), name="ui")
    return app


app = create_app()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="EKG-Arrhythmie API + UI server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args(argv)

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
