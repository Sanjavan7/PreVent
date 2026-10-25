"""device-service — HTTP control surface for a bedside ventilation unit.

A small Flask service that exposes the unit's status and command API. It tracks
two views of the device:
  - true_state:     the actual physical state (fan on/off, measured vitals).
  - reported_state: what the device displays / reports upstream.

POST /device/command applies a command (stop_fan / set_rate / resume) to the
unit and lets the caller set the reported vitals/alarm shown on the display, so
the reported view can diverge from the true physical state. The public
GET /device/status exposes only the reported view; the full row (true +
reported) is available on the internal /device/_truth endpoint.

Wire shapes mirror contracts/src/types.ts (DeviceStatus / DeviceCommand). The
public JSON here uses snake_case; push_device_status() re-maps to the camelCase
contracts shape before writing the shared status row.
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

# --- configuration (all via env) -------------------------------------------
DEVICE_SERVICE_HOST = os.environ.get("DEVICE_SERVICE_HOST", "127.0.0.1")
DEVICE_SERVICE_PORT = int(os.environ.get("DEVICE_SERVICE_PORT", "5000"))

# Shared secret for authenticated device-control requests, read from the env.
DEVICE_SERVICE_TOKEN = os.environ.get("DEVICE_SERVICE_TOKEN", "")

# Where to write the single source-of-truth DeviceStatus row. In the real
# system this is the shared SpacetimeDB `device_status` row; for the headless
# loop it is a local JSON file that the status readers and the serial emulator
# can read. Unset
# -> only logged (no file written).
DEVICE_ROW_FILE = os.environ.get("PREVENT_DEVICE_ROW_FILE", "").strip()

# Healthy baseline vitals and the values the patient falls to when the fan
# (ventilator) stops. Mirrors contracts/src/mocks.ts DEVICE_HEALTHY / EXPLOITED.
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
    """The full DeviceStatus row (camelCase, id always 1), matching
    contracts/src/types.ts DeviceStatus."""
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

    In production this is the `updateDeviceStatus(...)` reducer. Here it writes
    the row atomically to PREVENT_DEVICE_ROW_FILE (if set) and always logs it,
    so the headless loop works with no realtime backend running.
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
    true physiological/mechanical state."""
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
        # safe_parse_int keeps a non-numeric rate from erroring the service.
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
    """Public device view -> { fan_on, reported:{hr,spo2}, alarm }. Exposes only
    the reported view (upstream telemetry); the true vitals are internal-only."""
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
    """INTERNAL — the full true+reported status row (camelCase DeviceStatus).
    Mirrors the shared `device_status` row read by the dashboard/sim; not part
    of the device's public API."""
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
    """INTERNAL — the device's self-advertised command surface (read-only)."""
    return jsonify(
        {
            "service": "device-control-service",
            "commandEndpoint": {
                "method": "POST",
                "path": "/device/command",
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
    """INTERNAL — reset the device to the healthy baseline. A maintenance hook,
    exposed as a GET and kept off the device control surface."""
    reset_healthy()
    return jsonify(current_row())


# Device command handler: applies a command to the unit and updates the
# reported vitals/alarm the display shows.
@app.post("/device/command")
def device_command():
    body = request.get_json(silent=True) or {}
    action: Optional[str] = body.get("action")
    # Accept both the snake_case wire key and the camelCase app-level key
    # (contracts/src/types.ts DeviceCommand) so either request shape works.
    reported_overrides: dict[str, Any] = (
        body.get("reported_overrides") or body.get("reportedOverrides") or {}
    )
    rate: Optional[int] = body.get("rate")

    err = _apply_physiology(action, rate)
    if err is not None:
        return jsonify(err[0]), err[1]

    # Apply the caller's reported vitals/alarm overrides to the displayed state.
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
    app.run(host=DEVICE_SERVICE_HOST, port=DEVICE_SERVICE_PORT, debug=False)
