"""device-service — the PreVent "attack surface" (Dev 2 / security-verification).

A deliberately vulnerable *local toy* HTTP service that models the CWE-306
"missing authentication on a critical control function" vulnerability class
(grounded read-only in CVE-2019-6538). It is NOT a real medical device: it is
a Flask app on 127.0.0.1 whose "ventilator" is a boolean fan flag. All exploit
activity in this project is authorized testing against this service, which the
team wrote and owns.

It holds TWO separate state dicts on purpose:
  - true_state:     what is physically happening to the patient (fan, vitals).
  - reported_state: what the device DISPLAYS / reports upstream (can be a lie).

The vulnerable POST /device/command handler (CWE-306, see
rules/missing-auth.yaml) has NO auth check and will blindly apply
client-supplied `reported_overrides` onto reported_state even when they
contradict true_state. That true/reported desync *is* the exploit: the fan
stops (true_state.fan_on=False) and the patient truly crashes (true vitals
fall) while reported vitals/alarm stay "normal" (the silence beat).

There is ONE command handler, and it is intentionally vulnerable: a single bare
`@app.post("/device/command")` with no auth check (CWE-306, see
rules/missing-auth.yaml). The patch stage (Factory Droid, Dev 1) closes it by
writing a real diff that stacks an auth decorator above the route; after that
SemGrep goes silent and the byte-identical exploit re-run fails. Patched-ness is
therefore a property of the file bytes on disk, not an env flag — so VERIFY can
only pass on code the patch actually wrote.

Wire shapes mirror contracts/src/types.ts (DeviceStatus / DeviceCommand). The
public JSON here uses snake_case; push_device_status() re-maps to the camelCase
contracts shape before writing the shared source-of-truth row.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Optional

from flask import Flask, jsonify, request

from diagnostics import diagnostics_ok, request_checksum, safe_parse_int

app = Flask(__name__)

# --- configuration (all via env; never hardcode a token) -------------------
DEVICE_SERVICE_HOST = os.environ.get("DEVICE_SERVICE_HOST", "127.0.0.1")
DEVICE_SERVICE_PORT = int(os.environ.get("DEVICE_SERVICE_PORT", "5000"))

# The bearer token an auth guard added by the patch stage will read. The
# committed vulnerable handler never consults it; it exists so the patched code
# (and the headless loop) has a secret to check against.
DEVICE_SERVICE_TOKEN = os.environ.get("DEVICE_SERVICE_TOKEN", "")

# Where to write the single source-of-truth DeviceStatus row. In the real
# system this is the SpacetimeDB `device_status` row (written by Dev 3's
# updateDeviceStatus reducer); for the headless Dev 2 loop it is a local JSON
# file that the deterministic verifier and the serial emulator can read. Unset
# -> only logged (no file written).
DEVICE_ROW_FILE = os.environ.get("PREVENT_DEVICE_ROW_FILE", "").strip()

# Healthy baseline vitals and the crashing values the patient falls to when the
# fan (ventilator) stops. These mirror contracts/src/mocks.ts DEVICE_HEALTHY /
# DEVICE_EXPLOITED so the true-vs-reported divergence is a real, visible lie.
HEALTHY_HR, HEALTHY_SPO2 = 72, 98
CRASH_HR, CRASH_SPO2 = 38, 61

# --- separate true vs. reported state (contracts/src/types.ts DeviceStatus) --
true_state: dict[str, Any] = {
    "fan_on": True,
    "true_hr": HEALTHY_HR,
    "true_spo2": HEALTHY_SPO2,
    "set_rate_value": 180,
}

reported_state: dict[str, Any] = {
    "reported_hr": HEALTHY_HR,
    "reported_spo2": HEALTHY_SPO2,
    "alarm_active": False,
}

compromised: bool = False
last_command: str = "resume"
updated_at: int = 0


def _now_ms() -> int:
    return int(time.time() * 1000)


def current_row() -> dict[str, Any]:
    """The full source-of-truth DeviceStatus row (camelCase, id always 1),
    exactly the shape contracts/src/types.ts DeviceStatus / Dev 3's
    updateDeviceStatus reducer expects."""
    return {
        "id": 1,
        "fanOn": bool(true_state["fan_on"]),
        "trueHr": int(true_state["true_hr"]),
        "trueSpo2": int(true_state["true_spo2"]),
        "reportedHr": int(reported_state["reported_hr"]),
        "reportedSpo2": int(reported_state["reported_spo2"]),
        "alarmActive": bool(reported_state["alarm_active"]),
        "compromised": bool(compromised),
        "lastCommand": str(last_command),
        "updatedAt": int(updated_at),
    }


def push_device_status() -> dict[str, Any]:
    """Publish the single source-of-truth DeviceStatus row so the dashboard,
    the patient sim, and the serial bridge/emulator all react to one row.

    In production this is Dev 3's `updateDeviceStatus(...)` reducer. Here it
    writes the row atomically to PREVENT_DEVICE_ROW_FILE (if set) and always
    logs it, so the headless loop + verifier work with no realtime backend
    running.
    """
    row = current_row()
    if DEVICE_ROW_FILE:
        try:
            path = Path(DEVICE_ROW_FILE)
            path.parent.mkdir(parents=True, exist_ok=True)
            # Atomic write so a reader never sees a half-written row.
            fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(row, fh)
            os.replace(tmp, path)
        except OSError as exc:  # never let the sink crash the service
            print(f"[push_device_status] could not write {DEVICE_ROW_FILE}: {exc}", flush=True)
    print(f"[push_device_status] {row}", flush=True)
    return row


def _recompute_compromised() -> bool:
    """A device is 'compromised' once its reported state no longer matches the
    true physiological/mechanical state — i.e. the device is lying."""
    return (
        reported_state["reported_hr"] != true_state["true_hr"]
        or reported_state["reported_spo2"] != true_state["true_spo2"]
        or (not true_state["fan_on"] and not reported_state["alarm_active"])
    )


def _apply_physiology(action: str, rate: Optional[int]) -> Optional[tuple[dict, int]]:
    """Apply the TRUE physical effect of a command to true_state. Returns an
    error (body, status) tuple for an unknown action, else None."""
    if action == "stop_fan":
        true_state["fan_on"] = False
        # The ventilator stopped: the patient truly begins to crash.
        true_state["true_hr"] = CRASH_HR
        true_state["true_spo2"] = CRASH_SPO2
    elif action == "set_rate":
        # No bound/validation on `rate` in the vulnerable path (same
        # "trust everything the client sends" class). safe_parse_int keeps a
        # non-numeric rate from 500-ing the toy service.
        true_state["set_rate_value"] = safe_parse_int(rate, default=180)
    elif action == "resume":
        true_state["fan_on"] = True
        true_state["true_hr"] = HEALTHY_HR
        true_state["true_spo2"] = HEALTHY_SPO2
    else:
        return {"error": "unknown action"}, 400
    return None


def _sync_and_push(command: str) -> None:
    global compromised, last_command, updated_at
    compromised = _recompute_compromised()
    last_command = command
    updated_at = _now_ms()
    push_device_status()


@app.get("/device/status")
def get_device_status():
    """Public device UI view -> { fan_on, reported:{hr,spo2}, alarm }.

    Deliberately exposes only the REPORTED (possibly lying) view, exactly like
    a real device's upstream telemetry. The TRUE vitals are NOT on this public
    endpoint — that asymmetry is the whole point of "the lie"."""
    return jsonify(
        {
            "fan_on": true_state["fan_on"],
            "reported": {
                "hr": reported_state["reported_hr"],
                "spo2": reported_state["reported_spo2"],
            },
            "alarm": reported_state["alarm_active"],
        }
    )


@app.get("/device/_truth")
def get_device_truth():
    """INTERNAL — the full true+reported source-of-truth row (camelCase
    DeviceStatus). Stands in for the shared SpacetimeDB `device_status` row
    that the dashboard/sim/verifier read in the real system; it is NOT part of
    the device's public API (the public /device/status lies). Used by the
    deterministic verifier and the test suite to assert true-vs-reported."""
    return jsonify(current_row())


@app.get("/device/_diag")
def get_device_diag():
    """INTERNAL — read-only diagnostics hook. Returns a checksum of the query
    for log correlation and whether a supplied ?token= matches the baked-in
    diagnostic token. Read-only (GET), off the device control surface."""
    token = request.args.get("token", "")
    return jsonify(
        {
            "checksum": request_checksum(request.query_string.decode("utf-8", "replace")),
            "diagnosticsAuthorized": diagnostics_ok(token),
        }
    )


@app.get("/device/_schema")
def get_device_schema():
    """INTERNAL — the device's self-advertised command surface. The dynamic
    exploit generator reads this live so it authors a payload that fits THIS
    device (point the generator at a device with a different surface and it
    adapts). Read-only; off the control surface."""
    return jsonify(
        {
            "service": "device-control-service",
            "commandEndpoint": {
                "method": "POST",
                "path": "/device/command",
                # Honest reflection of the committed truth: the vulnerable
                # handler enforces no auth. (The patch stage adds a guard and
                # would flip this to True in its diff.)
                "authRequired": False,
            },
            "actions": {
                "stop_fan": "stop the ventilator fan (patient stops being ventilated)",
                "set_rate": "set the fan PWM duty; integer field 'rate' in 0..255",
                "resume": "resume normal ventilation",
            },
            "reportedOverrides": {
                "hr": "int — overrides the DISPLAYED heart rate",
                "spo2": "int — overrides the DISPLAYED SpO2",
                "alarm": "bool — overrides whether the device shows an alarm",
                "_note": "these set what the device DISPLAYS, independent of the true physical state",
            },
        }
    )


@app.get("/device/_reset")
def get_device_reset():
    """INTERNAL — reset the device to the healthy baseline (RESTORE / between
    judges). Not a device control command; a test/demo harness hook, hence a
    side-effecting GET kept off the modeled control surface (and out of scope
    for the missing-auth rule, which targets state-changing device commands)."""
    reset_healthy()
    return jsonify(current_row())


# ---------------------------------------------------------------------------
# The one command handler: a single bare @app.post("/device/command") with no
# auth check at all (CWE-306: Missing Authentication for Critical Function).
# This is exactly the shape rules/missing-auth.yaml fires on; the patch stage
# closes it by stacking an auth decorator above the route.
# ---------------------------------------------------------------------------
# ruleid: flask-missing-auth-decorator
@app.post("/device/command")
def device_command():
    body = request.get_json(silent=True) or {}
    action: Optional[str] = body.get("action")
    # Accept both the canonical snake_case wire key (PLAN-MASTER 2b) and the
    # camelCase app-level key (contracts/src/types.ts DeviceCommand), so a
    # caller using either shape still trips the lie.
    reported_overrides: dict[str, Any] = (
        body.get("reported_overrides") or body.get("reportedOverrides") or {}
    )
    rate: Optional[int] = body.get("rate")

    err = _apply_physiology(action, rate)
    if err is not None:
        return jsonify(err[0]), err[1]

    # THE LIE: blindly apply whatever the (unauthenticated) caller claims the
    # reported vitals/alarm should be, unrelated to true_state.
    if "hr" in reported_overrides:
        reported_state["reported_hr"] = reported_overrides["hr"]
    if "spo2" in reported_overrides:
        reported_state["reported_spo2"] = reported_overrides["spo2"]
    if "alarm" in reported_overrides:
        reported_state["alarm_active"] = reported_overrides["alarm"]

    _sync_and_push(action)
    return jsonify({"ok": True, "fan_on": true_state["fan_on"]})


def reset_healthy() -> None:
    """RESTORE hook (security/verify.py / restore.py): put the device back to
    the DEVICE_HEALTHY shape from contracts/src/mocks.ts after a verified fix."""
    true_state["fan_on"] = True
    true_state["true_hr"] = HEALTHY_HR
    true_state["true_spo2"] = HEALTHY_SPO2
    true_state["set_rate_value"] = 180
    reported_state["reported_hr"] = HEALTHY_HR
    reported_state["reported_spo2"] = HEALTHY_SPO2
    reported_state["alarm_active"] = False
    _sync_and_push("resume")


# Publish the initial healthy row at import so a subscriber/verifier that reads
# the row file before the first command still sees a well-formed row.
_sync_and_push("resume")


if __name__ == "__main__":
    # debug=False on purpose -- Bandit flags Flask debug=True (B201); the SCAN
    # stage's "wrong-then-caught" probe relies on Bandit's generic noise, not a
    # real debug server here.
    app.run(host=DEVICE_SERVICE_HOST, port=DEVICE_SERVICE_PORT, debug=False)
