"""Tests for the agent status protocol (scripts/state.py) and the download CLI wrapper.

Both scripts live outside the package; they are imported from their file paths.
state.py always operates on a temporary copy of the state file (ROOT/STATE/LOCK
are monkeypatched), never on the real project_state.json.
"""

from __future__ import annotations

import importlib.util
import json
import stat
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(f"_script_{name}", SCRIPTS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def state(tmp_path, monkeypatch):
    mod = _load("state")
    path = tmp_path / "project_state.json"
    path.write_text(json.dumps({
        "project": "test",
        "modules": [
            {"id": "alpha", "status": "planned", "files": ["a.py"]},
            {"id": "beta", "status": "planned"},
        ],
    }), encoding="utf-8")
    monkeypatch.setattr(mod, "ROOT", tmp_path)
    monkeypatch.setattr(mod, "STATE", path)
    monkeypatch.setattr(mod, "LOCK", tmp_path / ".project_state.lock")
    return mod, path


def _module(path: Path, mid: str) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    return next(m for m in data["modules"] if m["id"] == mid)


def test_start_done_transitions(state):
    mod, path = state
    mod.main(["start", "alpha", "--agent", "a-agent"])
    m = _module(path, "alpha")
    assert m["status"] == "in_progress" and m["agent"] == "a-agent" and "started_at" in m
    mod.main(["done", "alpha", "--agent", "a-agent", "--summary", "ok", "--decision", "d1",
              "--decision", "d2", "--file", "b.py", "--file", "a.py", "--test", "pytest: 3 passed"])
    m = _module(path, "alpha")
    assert m["status"] == "done" and m["summary"] == "ok"
    assert m["decisions"] == ["d1", "d2"]
    assert m["files"] == ["a.py", "b.py"]          # merged, de-duplicated, sorted
    assert m["tests"] == ["pytest: 3 passed"]
    assert [h["event"] for h in m["history"]] == ["start", "done"]
    assert _module(path, "beta")["status"] == "planned"   # other modules untouched
    data = json.loads(path.read_text(encoding="utf-8"))
    assert "updated_at" in data
    assert all(m["status"] in mod.VALID for m in data["modules"])


def test_fail_and_log(state):
    mod, path = state
    mod.main(["start", "beta", "--agent", "b"])
    mod.main(["log", "beta", "--agent", "b", "--note", "contract deviation"])
    mod.main(["fail", "beta", "--agent", "b", "--error", "x" * 5000])
    m = _module(path, "beta")
    assert m["status"] == "failed"
    assert len(m["last_error"]) == 4000
    events = [h["event"] for h in m["history"]]
    assert events == ["start", "note", "fail"]
    assert m["history"][1]["note"] == "contract deviation"
    assert len(m["history"][2]["error"]) == 500


def test_written_file_is_valid_json_and_world_readable(state):
    mod, path = state
    mod.main(["start", "alpha", "--agent", "a"])
    json.loads(path.read_text(encoding="utf-8"))
    assert stat.S_IMODE(path.stat().st_mode) == 0o644   # mkstemp would leave 0600
    assert not list(path.parent.glob(".state-*.json"))  # no temp files left behind


def test_rejects_unknown_module_and_command(state):
    mod, path = state
    before = path.read_text(encoding="utf-8")
    with pytest.raises(SystemExit) as exc:
        mod.main(["start", "nope", "--agent", "a"])
    assert "unknown module id" in str(exc.value.code)
    with pytest.raises(SystemExit):
        mod.main(["set-status", "alpha", "--agent", "a"])   # no free-form status changes
    with pytest.raises(SystemExit):
        mod.main(["done", "alpha", "--agent", "a"])         # --summary is required
    assert path.read_text(encoding="utf-8") == before


def test_show_prints_module(state, capsys):
    mod, _ = state
    mod.main(["show", "alpha"])
    assert json.loads(capsys.readouterr().out)["id"] == "alpha"


# ----------------------------------------------------------- download_mitdb.py

@pytest.fixture
def dl():
    return _load("download_mitdb")


@pytest.mark.parametrize("values, expected", [
    (None, None),
    ([], None),
    (["100", "101"], ["100", "101"]),
    (["100,101"], ["100", "101"]),
    (["100, 101,", "102"], ["100", "101", "102"]),
])
def test_parse_records(dl, values, expected):
    assert dl.parse_records(values) == expected


def test_download_unavailable_exit_code_2(dl, monkeypatch, capsys, tmp_path):
    def boom(*a, **k):
        raise dl.DataUnavailableError("network blocked")
    monkeypatch.setattr(dl, "download_mitdb", boom)
    assert dl.main(["--data-dir", str(tmp_path), "--records", "100"]) == 2
    err = capsys.readouterr().err
    assert "physionet.org" in err and "network blocked" in err


def test_download_success_and_bad_record(dl, monkeypatch, capsys, tmp_path):
    calls = {}

    def fake(data_dir, records=None, base_url=None):
        calls["records"] = records
        if records and "999" in records:
            raise ValueError("unknown record 999")
        return records or []
    monkeypatch.setattr(dl, "download_mitdb", fake)
    assert dl.main(["--data-dir", str(tmp_path), "--records", "100,101"]) == 0
    assert calls["records"] == ["100", "101"]
    assert dl.main(["--data-dir", str(tmp_path), "--records", "999"]) == 1
    assert "Gültige Records" in capsys.readouterr().err
