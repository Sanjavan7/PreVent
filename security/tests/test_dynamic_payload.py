"""Dynamic (model-authored) payload generation: validation guardrails, the
deterministic fallback, live surface discovery, and the loop's --goal path.

The live model path is exercised in the demo, not unit-tested (nondeterministic);
these tests are hermetic — the autouse fixture in conftest strips provider keys,
so generate_dynamic_payload falls back to a deterministic, validated command."""

from __future__ import annotations

import socket

import pytest

from generate.exploit import (
    MAX_RATE,
    fetch_attack_surface,
    generate_dynamic_payload,
    validate_command,
)
from loop import run_loop

FINDING = {
    "scanner": "semgrep", "cveRef": "CVE-2019-6538", "file": "device-service/app.py",
    "line": 333, "ruleId": "flask-missing-auth-decorator", "claudeVerdict": "missing auth (CWE-306)",
}


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# --- validation guardrails ---------------------------------------------------

def test_validate_accepts_and_normalizes():
    cmd = validate_command({"action": "stop_fan", "reportedOverrides": {"hr": 72, "spo2": 98, "alarm": False}})
    assert cmd["action"] == "stop_fan"
    assert cmd["reportedOverrides"] == {"hr": 72, "spo2": 98, "alarm": False}


def test_validate_clamps_rate():
    assert validate_command({"action": "set_rate", "rate": 99999})["rate"] == MAX_RATE
    assert validate_command({"action": "set_rate", "rate": -5})["rate"] == 0


def test_validate_drops_unknown_override_keys():
    cmd = validate_command({"action": "resume", "reportedOverrides": {"spo2": 80, "evil": "x"}})
    assert cmd["reportedOverrides"] == {"spo2": 80}


def test_validate_rejects_bad_action():
    with pytest.raises(ValueError):
        validate_command({"action": "rm -rf /"})
    with pytest.raises(ValueError):
        validate_command("not a dict")


# --- deterministic fallback (hermetic: no provider key) ----------------------

def test_dynamic_falls_back_to_valid_command_without_key():
    result = generate_dynamic_payload("do something bad", FINDING, base_url="http://127.0.0.1:1")
    assert result["source"] == "pre_cached_fallback"
    assert result["command"]["action"] in ("stop_fan", "set_rate", "resume")
    assert result["goal"] == "do something bad"


def test_dynamic_fallback_keys_off_goal():
    assert generate_dynamic_payload("max pressure now", FINDING, base_url="http://127.0.0.1:1")["command"]["action"] == "set_rate"
    assert generate_dynamic_payload("stop the fan", FINDING, base_url="http://127.0.0.1:1")["command"]["action"] == "stop_fan"


# --- live surface discovery (needs a running service) ------------------------

def test_fetch_attack_surface_reads_schema(vulnerable_url):
    surface = fetch_attack_surface(vulnerable_url)
    assert surface["commandEndpoint"]["path"] == "/device/command"
    assert "stop_fan" in surface["actions"]


def test_fetch_attack_surface_falls_back_when_unreachable():
    surface = fetch_attack_surface("http://127.0.0.1:1")
    assert surface["commandEndpoint"]["path"] == "/device/command"  # DEFAULT_SURFACE


# --- loop --goal path (hermetic: dynamic gen falls back, loop still closes) ---

def test_loop_with_goal_uses_dynamic_mode(tmp_path):
    report = run_loop(port=free_port(), goal="stop the fan and hide it", quiet=True, run_dir=tmp_path / "run")
    assert report["ok"] is True
    assert report["stages"]["generate"]["mode"] == "dynamic"
    assert report["stages"]["generate"]["goal"] == "stop the fan and hide it"
    assert report["stages"]["verify"]["passed"] is True
