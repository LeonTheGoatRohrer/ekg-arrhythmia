"""Tests for ekg.api.server (FastAPI) using a temporary EKG_ROOT."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ekg.api import server
from ekg.api.server import app, resolve_data_file


@pytest.fixture
def root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    (tmp_path / "web" / "public" / "data").mkdir(parents=True)
    (tmp_path / "artifacts" / "web").mkdir(parents=True)
    (tmp_path / "project_state.json").write_text(
        json.dumps({"project": "ekg", "modules": [{"id": "api-server", "status": "in_progress"}]}),
        encoding="utf-8",
    )
    (tmp_path / "web" / "public" / "data" / "project_state.json").write_text(
        json.dumps({"copy": True}), encoding="utf-8"
    )
    (tmp_path / "web" / "public" / "data" / "metrics.json").write_text(
        json.dumps({"status": "pending", "src": "public"}), encoding="utf-8"
    )
    (tmp_path / "artifacts" / "web" / "metrics.json").write_text(
        json.dumps({"status": "pending", "src": "artifacts"}), encoding="utf-8"
    )
    (tmp_path / "artifacts" / "web" / "tree.json").write_text(
        json.dumps({"id": 0, "src": "artifacts"}), encoding="utf-8"
    )
    # Files that exist but must never be served.
    (tmp_path / "web" / "public" / "data" / "secret.json").write_text("{}", encoding="utf-8")
    (tmp_path / "web" / "public" / "data" / "x.py").write_text("print(1)", encoding="utf-8")
    (tmp_path / "secret.json").write_text('{"leak": true}', encoding="utf-8")
    monkeypatch.setenv("EKG_ROOT", str(tmp_path))
    return tmp_path


@pytest.fixture
def client(root: Path) -> TestClient:
    return TestClient(app)


def test_health(client: TestClient) -> None:
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
    assert r.headers["cache-control"] == "no-store"


def test_state_is_read_fresh(client: TestClient, root: Path) -> None:
    r = client.get("/api/state")
    assert r.status_code == 200
    assert r.json()["modules"][0]["status"] == "in_progress"
    assert r.headers["cache-control"] == "no-store"
    (root / "project_state.json").write_text(json.dumps({"modules": [{"status": "done"}]}))
    assert client.get("/api/state").json()["modules"][0]["status"] == "done"


def test_state_missing_and_invalid(client: TestClient, root: Path) -> None:
    (root / "project_state.json").write_text("{not json")
    assert client.get("/api/state").status_code == 503
    (root / "project_state.json").unlink()
    r = client.get("/api/state")
    assert r.status_code == 404
    assert r.headers["cache-control"] == "no-store"


def test_state_unreadable_is_503_not_500(client: TestClient, root: Path) -> None:
    (root / "project_state.json").unlink()
    (root / "project_state.json").mkdir()          # IsADirectoryError (an OSError)
    r = client.get("/api/state")
    assert r.status_code == 503 and "nicht lesbar" in r.json()["detail"]
    (root / "project_state.json").rmdir()
    (root / "project_state.json").write_bytes(b"\xff\xfe{")  # UnicodeDecodeError
    assert client.get("/api/state").status_code == 503


def test_data_whitelisted_and_search_order(client: TestClient) -> None:
    r = client.get("/api/data/project_state.json")
    assert r.status_code == 200
    assert r.json() == {"copy": True}
    assert r.headers["content-type"].startswith("application/json")
    assert r.headers["cache-control"] == "no-store"
    # web/public/data wins over artifacts/web
    assert client.get("/api/data/metrics.json").json()["src"] == "public"
    # fallback to artifacts/web
    assert client.get("/api/data/tree.json").json()["src"] == "artifacts"


def test_data_whitelisted_but_missing_is_404(client: TestClient) -> None:
    r = client.get("/api/data/signal_demo.json")
    assert r.status_code == 404
    assert r.headers["cache-control"] == "no-store"


@pytest.mark.parametrize(
    "path",
    [
        "/api/data/x.py",
        "/api/data/secret.json",  # matches regex but not whitelisted
        "/api/data/metrics",  # missing extension
        "/api/data/Metrics.json",
        "/api/data/metrics.json.bak",
        "/api/data/..%2fproject_state.json",
        "/api/data/..%2f..%2fproject_state.json",
        "/api/data/..%2Fsecret.json",
        "/api/data/%2e%2e%2fsecret.json",
        "/api/data/../../secret.json",
        "/api/data/..",
        "/api/data/",
        "/api/data/%00metrics.json",
        "/api/data/metrics.json%00",
        "/api/data/metrics.json%0a",
        "/api/nope",
    ],
)
def test_data_rejects_traversal_and_unknown(client: TestClient, path: str) -> None:
    r = client.get(path)
    assert r.status_code == 404, (path, r.status_code, r.text)
    assert "leak" not in r.text
    assert "print(1)" not in r.text


def test_resolve_data_file_unit(root: Path) -> None:
    assert resolve_data_file("metrics.json", root) == (root / "web/public/data/metrics.json").resolve()
    for bad in ["../secret.json", "..", "secret.json", "x.py", "metrics.json\n", "/etc/passwd", ""]:
        assert resolve_data_file(bad, root) is None


def test_resolve_rejects_symlink_escape(root: Path) -> None:
    link = root / "web" / "public" / "data" / "dataset_stats.json"
    link.symlink_to(root / "secret.json")
    assert resolve_data_file("dataset_stats.json", root) is None


def test_root_without_dist_returns_hint(client: TestClient) -> None:
    r = client.get("/")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "/api/state" in body["api"]
    assert client.get("/irgendwas.html").status_code == 404


def test_root_serves_dist_when_present(client: TestClient, root: Path) -> None:
    dist = root / "web" / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>EKG</title>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    r = client.get("/")
    assert r.status_code == 200
    assert "<title>EKG</title>" in r.text
    assert "cache-control" not in r.headers or r.headers["cache-control"] != "no-store"
    assert client.get("/assets/app.js").text == "console.log(1)"
    assert client.get("/assets/missing.js").status_code == 404
    # API routes still take precedence over the static mount
    assert client.get("/api/health").json() == {"status": "ok"}
    # traversal through the static mount is impossible
    r = client.get("/..%2fproject_state.json")
    assert r.status_code == 404
    assert "modules" not in r.text


def test_default_root_is_repo_root(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("EKG_ROOT", raising=False)
    assert server.get_root() == Path(server.__file__).resolve().parents[3]
    assert (server.get_root() / "pyproject.toml").is_file()


def test_main_parses_args_and_calls_uvicorn(monkeypatch: pytest.MonkeyPatch) -> None:
    import uvicorn

    calls: dict = {}
    monkeypatch.setattr(uvicorn, "run", lambda a, host, port: calls.update(app=a, host=host, port=port))
    server.main(["--port", "8123"])
    assert calls == {"app": app, "host": "127.0.0.1", "port": 8123}
    server.main(["--host", "0.0.0.0"])
    assert calls["port"] == 8000 and calls["host"] == "0.0.0.0"
