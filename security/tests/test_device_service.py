"""device-service behavior: the vulnerable attack surface + the patched fix."""

from __future__ import annotations

import os

import requests

STOP_EXPLOIT = {"action": "stop_fan", "reportedOverrides": {"hr": 72, "spo2": 98, "alarm": False}}
TOKEN = os.environ.get("DEVICE_SERVICE_TOKEN", "prevent-demo-token")


def _truth(base_url):
    return requests.get(f"{base_url}/device/_truth", timeout=5).json()


def test_baseline_is_healthy(vulnerable_url):
    row = _truth(vulnerable_url)
    assert row["fanOn"] is True
    assert row["trueHr"] == row["reportedHr"] == 72
    assert row["compromised"] is False


def test_public_status_hides_true_vitals(vulnerable_url):
    body = requests.get(f"{vulnerable_url}/device/status", timeout=5).json()
    # The public endpoint exposes only the reported view + fan + alarm.
    assert set(body.keys()) == {"fan_on", "reported", "alarm"}
    assert set(body["reported"].keys()) == {"hr", "spo2"}


def test_vulnerable_exploit_crashes_and_lies(vulnerable_url):
    """Unauthenticated stop_fan: fan stops, patient truly crashes, but the
    device keeps reporting normal vitals and never alarms (the lie)."""
    resp = requests.post(f"{vulnerable_url}/device/command", json=STOP_EXPLOIT, timeout=5)
    assert resp.status_code == 200

    row = _truth(vulnerable_url)
    assert row["fanOn"] is False  # control: the fan really stopped
    assert row["trueHr"] == 38 and row["trueSpo2"] == 61  # patient crashing
    assert row["reportedHr"] == 72 and row["reportedSpo2"] == 98  # integrity: still "normal"
    assert row["alarmActive"] is False  # the silence beat
    assert row["compromised"] is True  # true != reported


def test_vulnerable_active_lie_applies_overrides(vulnerable_url):
    """Falsify-vitals pins reported to attacker-chosen values even as true
    vitals diverge — proves the overrides are actually honored over the wire."""
    requests.post(
        f"{vulnerable_url}/device/command",
        json={"action": "stop_fan", "reportedOverrides": {"hr": 60, "spo2": 95, "alarm": False}},
        timeout=5,
    )
    row = _truth(vulnerable_url)
    assert (row["reportedHr"], row["reportedSpo2"]) == (60, 95)
    assert (row["trueHr"], row["trueSpo2"]) == (38, 61)


def test_patched_rejects_unauthenticated(patched_url):
    resp = requests.post(f"{patched_url}/device/command", json=STOP_EXPLOIT, timeout=5)
    assert resp.status_code in (401, 403)
    row = _truth(patched_url)
    assert row["fanOn"] is True  # nothing changed
    assert row["compromised"] is False


def test_patched_accepts_valid_token_but_ignores_overrides(patched_url):
    resp = requests.post(
        f"{patched_url}/device/command",
        json=STOP_EXPLOIT,
        headers={"Authorization": f"Bearer {TOKEN}"},
        timeout=5,
    )
    assert resp.status_code == 200
    row = _truth(patched_url)
    # Authenticated stop_fan is honored (fan off) ...
    assert row["fanOn"] is False
    # ... but the untrusted reportedOverrides are ignored: reported mirrors true,
    # and the alarm honestly reflects the stopped fan -> device cannot lie.
    assert row["reportedHr"] == row["trueHr"] == 38
    assert row["reportedSpo2"] == row["trueSpo2"] == 61
    assert row["alarmActive"] is True
    assert row["compromised"] is False


def test_reset_hook_restores_healthy(vulnerable_url):
    requests.post(f"{vulnerable_url}/device/command", json=STOP_EXPLOIT, timeout=5)
    assert _truth(vulnerable_url)["fanOn"] is False
    requests.get(f"{vulnerable_url}/device/_reset", timeout=5)
    row = _truth(vulnerable_url)
    assert row["fanOn"] is True and row["compromised"] is False
