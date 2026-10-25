"""Portal control-plane tests (Dev 2).

Drives the Flask app with its test client (no live server needed) for the
cheap, deterministic surfaces — health, the target description, and the
path-escape guard on /api/file — plus a direct unit test of rank_findings()
that the two genuine semgrep CWE-306 findings land at ranks 1-2 as 'real'.

The real scanner fleet (/api/scan/stream) is covered by the live curl smoke
test and by tests/test_scan_agents.py; it isn't re-run here to keep this
module fast and offline.
"""

from __future__ import annotations

from portal_server import app, rank_findings


def _client():
    return app.test_client()


def test_health_ok():
    resp = _client().get("/api/health")
    assert resp.status_code == 200
    assert resp.get_json() == {"ok": True}


def test_target_shape():
    body = _client().get("/api/target").get_json()
    assert body["name"] == "prevent-device"
    # The three scanned source files, each with a positive line count.
    assert len(body["files"]) == 3
    paths = {f["path"] for f in body["files"]}
    assert paths == {
        "device-service/app.py",
        "device-service/diagnostics.py",
        "firmware/uno_actuator.ino",
    }
    assert all(f["loc"] > 0 for f in body["files"])
    # The two planted CWE-306 vulns (server + firmware), both CVE-2019-6538.
    assert len(body["plantedVulns"]) == 2
    assert {v["file"] for v in body["plantedVulns"]} == {
        "device-service/app.py",
        "firmware/uno_actuator.ino",
    }
    assert all(v["cwe"] == "CWE-306" for v in body["plantedVulns"])
    assert all(v["cveRef"] == "CVE-2019-6538" for v in body["plantedVulns"])


def test_file_rejects_path_escape():
    resp = _client().get("/api/file", query_string={"path": "../../etc/passwd"})
    assert resp.status_code == 400


def test_file_returns_app_py():
    resp = _client().get("/api/file", query_string={"path": "device-service/app.py"})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["path"] == "device-service/app.py"
    assert body["lang"] == "python"
    assert body["lines"] > 0
    assert "device_command" in body["content"]


def test_rank_puts_both_cwe306_at_top():
    # A representative fleet result: 2 real semgrep CWE-306 findings + 2 bandit
    # decoys, deliberately out of order.
    findings = [
        {"id": 1, "scanner": "semgrep", "file": "device-service/app.py",
         "line": 333, "severity": "ERROR", "ruleId": "flask-missing-auth-decorator"},
        {"id": 2, "scanner": "bandit", "file": "device-service/diagnostics.py",
         "line": 26, "severity": "HIGH", "ruleId": "B324"},
        {"id": 3, "scanner": "semgrep", "file": "firmware/uno_actuator.ino",
         "line": 248, "severity": "ERROR", "ruleId": "firmware-unauth-serial-control"},
        {"id": 4, "scanner": "bandit", "file": "device-service/diagnostics.py",
         "line": 20, "severity": "LOW", "ruleId": "B105"},
    ]
    ranking = rank_findings(findings)

    by_rank = {r["rank"]: r for r in ranking}
    # Ranks 1-2 are the two semgrep CWE-306 findings, both flagged exploitable.
    assert by_rank[1]["real"] is True
    assert by_rank[2]["real"] is True
    assert {by_rank[1]["findingId"], by_rank[2]["findingId"]} == {1, 3}
    # Highest CVSS (server, 9.3) outranks the firmware analog (8.8).
    assert by_rank[1]["findingId"] == 1 and by_rank[1]["cvss"] == 9.3
    assert by_rank[2]["findingId"] == 3 and by_rank[2]["cvss"] == 8.8
    # The bandit decoys are below them and not 'real'.
    assert by_rank[3]["real"] is False
    assert by_rank[4]["real"] is False
