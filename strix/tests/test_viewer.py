"""Tests for the local run viewer (strix.interface.viewer) and its path helpers."""

from __future__ import annotations

import json
import os
import sqlite3
import urllib.error
import urllib.request
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

from strix.core.paths import latest_run_dir, runs_base_dir
from strix.interface.viewer.server import serve
from strix.interface.viewer.transcript import (
    build_run_state,
    read_report_markdown,
    read_run_summary,
    read_vulnerabilities,
)


if TYPE_CHECKING:
    from collections.abc import Mapping
    from pathlib import Path

    import pytest


def _make_run(base: Path, name: str, *, status: str, end_time: str | None) -> Path:
    run_dir = base / "strix_runs" / name
    state_dir = run_dir / ".state"
    state_dir.mkdir(parents=True)
    record = {"run_name": name, "status": status, "end_time": end_time}
    (run_dir / "run.json").write_text(json.dumps(record), encoding="utf-8")
    agents = {
        "statuses": {"root": "completed", "child": "running"},
        "names": {"root": "strix", "child": "recon"},
        "parent_of": {"root": None, "child": "root"},
    }
    (state_dir / "agents.json").write_text(json.dumps(agents), encoding="utf-8")
    return run_dir


def test_latest_run_dir_none_when_no_runs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    assert latest_run_dir() is None
    assert runs_base_dir() == tmp_path / "strix_runs"


def test_latest_run_dir_picks_newest_by_record_mtime(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    older = _make_run(tmp_path, "old", status="completed", end_time="2026-01-01T00:00:00Z")
    newer = _make_run(tmp_path, "new", status="running", end_time=None)
    # Force a newer mtime on the second run's record.
    os.utime(newer / "run.json", (2_000_000_000, 2_000_000_000))
    os.utime(older / "run.json", (1_000_000_000, 1_000_000_000))
    assert latest_run_dir() == newer


def test_read_run_summary_finished_flag(tmp_path: Path) -> None:
    finished = _make_run(tmp_path, "done", status="completed", end_time="2026-01-01T00:00:00Z")
    live = _make_run(tmp_path, "live", status="running", end_time=None)
    assert read_run_summary(finished)["finished"] is True
    assert read_run_summary(live)["finished"] is False
    # A terminal status without an end_time is not "finished".
    partial = _make_run(tmp_path, "partial", status="failed", end_time=None)
    assert read_run_summary(partial)["finished"] is False


def test_read_missing_artifacts_return_defaults(tmp_path: Path) -> None:
    run_dir = _make_run(tmp_path, "empty", status="running", end_time=None)
    assert read_vulnerabilities(run_dir) == []
    assert read_report_markdown(run_dir) == ""


def test_build_run_state_from_agents_json(tmp_path: Path) -> None:
    run_dir = _make_run(tmp_path, "graph", status="running", end_time=None)
    state = build_run_state(run_dir)
    ids = {a["id"] for a in state["agents"]}
    assert ids == {"root", "child"}
    child = next(a for a in state["agents"] if a["id"] == "child")
    assert child["parent_id"] == "root"
    assert child["name"] == "recon"
    # No agents.db, so no message/tool events.
    assert state["events"] == []


def test_build_run_state_keeps_same_call_id_separate_per_agent(tmp_path: Path) -> None:
    run_dir = _make_run(tmp_path, "tools", status="completed", end_time=None)
    agents_db = run_dir / ".state" / "agents.db"
    rows = [
        (
            "root",
            {
                "type": "function_call",
                "call_id": "exec_command_0",
                "name": "exec_command",
                "arguments": json.dumps({"cmd": "echo root"}),
            },
        ),
        (
            "root",
            {
                "type": "function_call_output",
                "call_id": "exec_command_0",
                "output": json.dumps({"success": True, "output": "root"}),
            },
        ),
        (
            "child",
            {
                "type": "function_call",
                "call_id": "exec_command_0",
                "name": "exec_command",
                "arguments": json.dumps({"cmd": "echo child"}),
            },
        ),
        (
            "child",
            {
                "type": "function_call_output",
                "call_id": "exec_command_0",
                "output": json.dumps({"success": True, "output": "child"}),
            },
        ),
    ]
    with sqlite3.connect(agents_db) as conn:
        conn.execute(
            """
            create table agent_messages (
                id integer primary key,
                session_id text not null,
                message_data text not null,
                created_at text not null
            )
            """
        )
        conn.executemany(
            """
            insert into agent_messages (session_id, message_data, created_at)
            values (?, ?, '2026-01-01T00:00:00+00:00')
            """,
            [(agent_id, json.dumps(message)) for agent_id, message in rows],
        )

    state = build_run_state(run_dir)
    tools = [event for event in state["events"] if event["type"] == "tool"]

    assert len(tools) == 2
    by_agent = {event["agent_id"]: event for event in tools}
    assert by_agent["root"]["data"]["args"] == {"cmd": "echo root"}
    assert by_agent["root"]["data"]["result"]["output"] == "root"
    assert by_agent["child"]["data"]["args"] == {"cmd": "echo child"}
    assert by_agent["child"]["data"]["result"]["output"] == "child"



from fastapi.testclient import TestClient
from strix.interface.viewer.server import app, serve

def test_server_serves_api_and_static(tmp_path, monkeypatch):
    run_dir = _make_run(tmp_path, "served", status="completed", end_time="2026-01-01T00:00:00Z")
    app.state.base_dir = tmp_path
    app.state.run_dir = run_dir
    app.state.steer_handler = None
    client = TestClient(app)
    
    resp = client.get("/api/run")
    assert resp.status_code == 200
    assert resp.json()["finished"] is True
    
    resp = client.get("/api/transcript")
    assert resp.status_code == 200
    assert {a["id"] for a in resp.json()["agents"]} == {"root", "child"}

def test_telemetry_events(tmp_path, monkeypatch):
    client = TestClient(app)
    
    cta_clicked = False
    def mock_viewer_cta_clicked(cta, surface=None):
        nonlocal cta_clicked
        cta_clicked = True
        
    monkeypatch.setattr("strix.telemetry.posthog.viewer_cta_clicked", mock_viewer_cta_clicked)

    resp = client.post("/api/event", json={"event": "cta_clicked", "cta": "test"})
    assert resp.status_code == 204
    assert cta_clicked is True
