"""stage_api — the JSON-in/JSON-out subprocess bridge for Dev 1's orchestrator.

Offline stages (ground/scan/generate) are hermetic (the conftest autouse fixture
strips provider keys, so GENERATE uses the cached/deterministic path); the live
stages (deliver/verify) reuse the vulnerable_url/patched_url service fixtures.
Also asserts the CLI contract: `python -m security.stage_api <stage>` writes
exactly ONE JSON object to stdout.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from stage_api import REPO_ROOT, run_stage

FINDING = {
    "scanner": "semgrep",
    "cveRef": "CVE-2019-6538",
    "file": "device-service/app.py",
    "line": 333,
    "severity": "ERROR",
    "ruleId": "flask-missing-auth-decorator",
    "claudeVerdict": "missing auth (CWE-306)",
    "isTheRealOne": True,
}


# --- shapes / envelope -------------------------------------------------------

def _assert_envelope(result, stage):
    assert result["stage"] == stage
    assert isinstance(result["ok"], bool)
    assert isinstance(result["data"], dict)
    assert isinstance(result["events"], list)
    for ev in result["events"]:
        assert set(("actor", "text")) <= set(ev.keys())


# --- ground (offline) --------------------------------------------------------

def test_ground_offline_shape():
    result = run_stage("ground")
    _assert_envelope(result, "ground")
    assert result["ok"] is True
    # groundStub returns {cveId, summary} -> data is a superset.
    assert result["data"]["cveId"] == "CVE-2019-6538"
    assert result["data"]["summary"]
    assert "CWE-306" in result["data"]["cwe"]
    assert result["events"]


# --- scan (offline: triage falls back to the static verdict) -----------------

def test_scan_offline_self_corrects_onto_cwe306():
    result = run_stage("scan", base_url="http://127.0.0.1:1")  # unreachable -> offline verdict
    _assert_envelope(result, "scan")
    assert result["ok"] is True
    data = result["data"]
    assert data["selfCorrected"] is True
    assert data["chosen"]["cveRef"] == "CVE-2019-6538"
    assert data["chosen"]["scanner"] == "semgrep"
    assert data["chosen"]["isTheRealOne"] is True
    # chosen is a clean contract-Finding subset.
    assert {"scanner", "cveRef", "file", "line", "severity", "claudeVerdict", "isTheRealOne"} <= set(data["chosen"])
    assert data["semgrepCount"] == 1
    assert data["banditCount"] >= 1
    # the triage trail was surfaced as events, and the first considered was a decoy.
    assert data["considered"][0]["scanner"] == "bandit"
    assert len(result["events"]) >= 2


# --- generate (offline: cached preset + deterministic dynamic fallback) -------

def test_generate_preset_shape():
    result = run_stage("generate", input_obj=FINDING, payload="stop-breathing")
    _assert_envelope(result, "generate")
    assert result["ok"] is True
    data = result["data"]
    assert data["mode"] == "preset"
    assert data["payloadRef"] == "stop-breathing"
    assert data["command"]["action"] == "stop_fan"
    assert data["source"] == "pre_cached_fallback"  # hermetic: no provider key
    assert "device/command" in data["pocText"]


def test_generate_dynamic_shape():
    result = run_stage("generate", input_obj=FINDING, goal="crank the pressure to maximum")
    _assert_envelope(result, "generate")
    assert result["ok"] is True
    data = result["data"]
    assert data["mode"] == "dynamic"
    assert data["payloadRef"].startswith("dynamic:")
    assert data["command"]["action"] in ("stop_fan", "set_rate", "resume")
    # "pressure"/"max" keys off to set_rate in the deterministic fallback.
    assert data["command"]["action"] == "set_rate"


# --- deliver (live: vulnerable service) --------------------------------------

def test_deliver_against_vulnerable_exploit_works(vulnerable_url):
    result = run_stage("deliver", base_url=vulnerable_url, payload="stop-breathing")
    _assert_envelope(result, "deliver")
    assert result["ok"] is True
    data = result["data"]
    assert data["exploitWorked"] is True
    assert data["httpStatus"] == 200
    assert data["success"] is True  # superset alias of deliverStub.success
    assert data["deviceImpact"]  # superset alias of deliverStub.deviceImpact
    assert "LYING" in data["impact"]
    assert data["row"]["fanOn"] is False


# --- verify (live: patched service) ------------------------------------------

def test_verify_against_patched_passes(patched_url):
    result = run_stage("verify", base_url=patched_url, payload="stop-breathing")
    _assert_envelope(result, "verify")
    assert result["ok"] is True
    data = result["data"]
    assert data["passed"] is True
    assert data["success"] is True  # superset alias of verifyStub.success
    assert data["statusCode"] in (401, 403)
    assert data["detail"]


# --- CLI contract: one JSON object on stdout, correct exit code --------------

def test_cli_emits_single_json_object_on_stdout():
    proc = subprocess.run(
        [sys.executable, "-m", "security.stage_api", "ground"],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    # The entire stdout must parse as exactly one JSON object.
    parsed = json.loads(proc.stdout)
    assert parsed["stage"] == "ground"
    assert parsed["ok"] is True
    assert parsed["data"]["cveId"] == "CVE-2019-6538"
