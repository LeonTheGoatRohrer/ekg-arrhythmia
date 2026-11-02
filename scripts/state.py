#!/usr/bin/env python3
"""Lock-safe updater for project_state.json (the central status file).

Every sub-agent MUST use this tool instead of editing project_state.json by hand,
so that parallel agents never overwrite each other's entries.

Usage:
  python scripts/state.py show [MODULE_ID]
  python scripts/state.py start MODULE_ID --agent NAME
  python scripts/state.py done  MODULE_ID --agent NAME --summary "..." \
        [--decision "..."]... [--file path]... [--test "pytest tests/x.py: 12 passed"]
  python scripts/state.py fail  MODULE_ID --agent NAME --error "log excerpt"
  python scripts/state.py log   MODULE_ID --agent NAME --note "..."
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "project_state.json"
LOCK = ROOT / ".project_state.lock"

VALID = {"planned", "in_progress", "done", "failed", "blocked"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class _Locked:
    def __enter__(self):
        self.fh = open(LOCK, "w")
        fcntl.flock(self.fh, fcntl.LOCK_EX)
        self.data = json.loads(STATE.read_text(encoding="utf-8"))
        return self.data

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self.data["updated_at"] = _now()
            fd, tmp = tempfile.mkstemp(dir=STATE.parent, prefix=".state-", suffix=".json")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2, ensure_ascii=False)
                f.write("\n")
            # mkstemp creates 0600; the state file must stay readable for the API server
            # (which may run as another user), like the pipeline's JSON exports.
            os.chmod(tmp, 0o644)
            os.replace(tmp, STATE)
        fcntl.flock(self.fh, fcntl.LOCK_UN)
        self.fh.close()
        return False


def _module(data: dict, mid: str) -> dict:
    for m in data["modules"]:
        if m["id"] == mid:
            return m
    sys.exit(f"unknown module id: {mid}. Known: {[m['id'] for m in data['modules']]}")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("show"); s.add_argument("module", nargs="?")
    for name in ("start", "done", "fail", "log"):
        q = sub.add_parser(name)
        q.add_argument("module")
        q.add_argument("--agent", required=True)
        if name == "done":
            q.add_argument("--summary", required=True)
            q.add_argument("--decision", action="append", default=[])
            q.add_argument("--file", action="append", default=[])
            q.add_argument("--test", action="append", default=[])
        if name == "fail":
            q.add_argument("--error", required=True)
        if name == "log":
            q.add_argument("--note", required=True)
    a = p.parse_args(argv)

    if a.cmd == "show":
        data = json.loads(STATE.read_text(encoding="utf-8"))
        out = _module(data, a.module) if a.module else data
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return

    with _Locked() as data:
        m = _module(data, a.module)
        m.setdefault("history", [])
        if a.cmd == "start":
            m["status"] = "in_progress"
            m["agent"] = a.agent
            m["started_at"] = _now()
            m["history"].append({"t": _now(), "agent": a.agent, "event": "start"})
        elif a.cmd == "done":
            m["status"] = "done"
            m["agent"] = a.agent
            m["finished_at"] = _now()
            m["summary"] = a.summary
            m["decisions"] = a.decision
            m["files"] = sorted(set(m.get("files", []) + a.file))
            m["tests"] = a.test
            m["history"].append({"t": _now(), "agent": a.agent, "event": "done"})
        elif a.cmd == "fail":
            m["status"] = "failed"
            m["last_error"] = a.error[-4000:]
            m["history"].append({"t": _now(), "agent": a.agent, "event": "fail", "error": a.error[-500:]})
        elif a.cmd == "log":
            m["history"].append({"t": _now(), "agent": a.agent, "event": "note", "note": a.note})
    print(f"{a.cmd}: {a.module} ok")


if __name__ == "__main__":
    main()
