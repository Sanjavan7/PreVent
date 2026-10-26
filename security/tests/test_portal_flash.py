"""Portal physical-flash + single-author stream tests (Dev 2).

Covers the two real-hardware endpoints (/api/flash, /api/flash/restore) and the
single-author filter on /api/exploit/stream, all through the Flask test client.

FLASH_DRY_RUN=1 short-circuits the arduino-cli upload, so these assertions are on
the documented JSON SHAPE only — the board is never flashed by the test. The real
compile+upload path is exercised by the user through the UI; here we just prove
the endpoints are well-behaved and never 500. The exploit-stream test seeds a
known ranking and points the author at an unreachable device (same hermetic setup
as test_portal_exploit.py), so no fleet subprocess and no network are touched.
"""

from __future__ import annotations

import json

import pytest

import portal_server
from portal_server import app

# Same representative fleet result the exploit tests use: two real semgrep
# CWE-306 findings (server id 1 + firmware id 3) plus two bandit decoys.
_FINDINGS = [
    {"id": 1, "scanner": "semgrep", "target": "device-service",
     "file": "device-service/app.py", "line": 333, "severity": "ERROR",
     "ruleId": "flask-missing-auth-decorator"},
    {"id": 2, "scanner": "bandit", "target": "device-service",
     "file": "device-service/diagnostics.py", "line": 26, "severity": "HIGH",
     "ruleId": "B324"},
    {"id": 3, "scanner": "semgrep", "target": "firmware",
     "file": "firmware/uno_actuator.ino", "line": 248, "severity": "ERROR",
     "ruleId": "firmware-unauth-serial-control"},
    {"id": 4, "scanner": "bandit", "target": "firmware",
     "file": "firmware/uno_actuator.ino", "line": 20, "severity": "LOW",
     "ruleId": "B105"},
]


@pytest.fixture
def dry_run(monkeypatch):
    """Short-circuit the arduino-cli upload so the flash endpoints never touch
    the live board during the test."""
    monkeypatch.setenv("FLASH_DRY_RUN", "1")


@pytest.fixture
def seeded_scan(monkeypatch):
    """Seed the module cache with a known ranking and point the author at an
    unreachable device so it falls back instantly — fully hermetic."""
    ranking = portal_server.rank_findings(_FINDINGS)
    monkeypatch.setattr(
        portal_server, "_LAST_SCAN", {"findings": _FINDINGS, "ranking": ranking}
    )
    monkeypatch.setattr(portal_server, "DEVICE_SERVICE_URL", "http://127.0.0.1:1")
    return ranking


def _post(client, path: str) -> dict:
    resp = client.post(path)
    assert resp.status_code == 200, (path, resp.status_code)
    return resp.get_json()


def _assert_flash_shape(body: dict) -> None:
    """Every flash response carries the documented {ok,durationMs,port,log,
    error} contract, whatever the outcome."""
    assert set(body) >= {"ok", "durationMs", "port", "log", "error"}
    assert isinstance(body["ok"], bool)
    assert isinstance(body["durationMs"], int) and body["durationMs"] >= 0
    assert body["port"] is None or isinstance(body["port"], str)
    assert isinstance(body["log"], str)
    assert body["error"] is None or isinstance(body["error"], str)


def test_flash_json_shape(dry_run):
    body = _post(app.test_client(), "/api/flash")
    _assert_flash_shape(body)
    # Dry run must report success with the DRY RUN marker and no error.
    assert body["ok"] is True
    assert body["log"] == "DRY RUN"
    assert body["error"] is None


def test_flash_restore_json_shape(dry_run):
    body = _post(app.test_client(), "/api/flash/restore")
    _assert_flash_shape(body)
    assert body["ok"] is True
    assert body["log"] == "DRY RUN"
    assert body["error"] is None


def _events(resp) -> list[dict]:
    body = resp.get_data(as_text=True)
    return [
        json.loads(line[len("data: "):])
        for line in body.splitlines()
        if line.startswith("data: ")
    ]


def test_exploit_stream_single_finding(seeded_scan):
    """?finding=1 authors ONLY finding 1: one agent lifecycle + all_done count 1,
    so the UI can run the server stage on its own."""
    resp = app.test_client().get("/api/exploit/stream", query_string={"finding": 1})
    assert resp.status_code == 200
    events = _events(resp)

    spawned = [e for e in events if e["type"] == "agent_spawned"]
    assert len(spawned) == 1 and spawned[0]["findingId"] == 1

    done = [e for e in events if e["type"] == "agent_done"]
    assert len(done) == 1 and done[0]["findingId"] == 1

    all_done = [e for e in events if e["type"] == "all_done"]
    assert len(all_done) == 1 and all_done[0]["count"] == 1


def test_exploit_stream_no_param_authors_all(seeded_scan):
    """With no ?finding every scanner finding gets a conversation; the two semgrep
    control-path findings (ids 1 + 3) are the ones judged exploitable."""
    events = _events(app.test_client().get("/api/exploit/stream"))
    spawned = [e for e in events if e["type"] == "agent_spawned"]
    assert {e["findingId"] for e in spawned} == {1, 2, 3, 4}
    payloads = [e for e in events if e["type"] == "payload"]
    assert {e["findingId"] for e in payloads} == {1, 3}
    all_done = [e for e in events if e["type"] == "all_done"]
    assert len(all_done) == 1 and all_done[0]["count"] == 4
