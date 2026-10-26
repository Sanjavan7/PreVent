"""device-service — HTTP control surface for a bedside ventilation unit.

A small Flask service that exposes the unit's status and command API. It tracks
two views of the device:
  - true_state:     the actual physical state (fan on/off, measured vitals).
  - reported_state: what the device displays / reports upstream.

POST /device/command is the state-changing control endpoint. By default this
service runs the VULNERABLE build — the command handler has no authentication
(CWE-306: Missing Authentication for a Critical Function; see
rules/missing-auth.yaml) and blindly trusts caller-supplied reported_overrides,
so the reported view can be desynced from reality. That is the flaw the PreVent
pipeline finds, exploits, patches, and verifies. Set DEVICE_SERVICE_PATCHED=1 to
swap in the fixed handler (bearer-token required; reported vitals forced to
mirror true_state) so the deterministic verifier can prove the re-run of the
byte-identical exploit now fails.

    ⚠  DELIBERATELY INSECURE BY DESIGN — a localhost teaching/demo target, not a
       real device. Bind to 127.0.0.1 only; never expose it to a network (the
       entrypoint refuses a non-loopback bind unless PREVENT_INSECURE_BIND=1).

Wire shapes mirror contracts/src/types.ts (DeviceStatus / DeviceCommand). The
public JSON here uses snake_case; push_device_status() re-maps to the camelCase
contracts shape before writing the shared status row.
"""

from __future__ import annotations

import hmac
import json
import os
import tempfile
import time
from functools import wraps
from pathlib import Path
from typing import Any, Optional

from flask import Flask, jsonify, request

from diagnostics import diagnostics_ok, request_checksum, safe_parse_int

app = Flask(__name__)

# --- configuration (all via env) -------------------------------------------
DEVICE_SERVICE_HOST = os.environ.get("DEVICE_SERVICE_HOST", "127.0.0.1")
# Default 8071, NOT 5000: on macOS :5000 is the AirPlay Receiver, which answers
# 403 and can masquerade as a patched service (a false VERIFY pass).
DEVICE_SERVICE_PORT = int(os.environ.get("DEVICE_SERVICE_PORT", "8071"))

# Shared secret for authenticated device-control requests, read from the env.
# Never hardcode a token; the patch stage / headless loop sets it when it brings
# up the patched build.
DEVICE_SERVICE_TOKEN = os.environ.get("DEVICE_SERVICE_TOKEN", "")

# Build selector. Default (unset / "0") is the VULNERABLE handler so the exploit
# works out of the box; "1" swaps in the patched handler (what the patch stage
# produces as a real diff, and what the verifier brings up to prove the fix).
# Both handler definitions live in this one file on purpose: SemGrep's static
# match fires on the bare (vulnerable) route and stays silent on the
# @require_token (patched) one, regardless of which branch runs.
DEVICE_SERVICE_PATCHED = os.environ.get("DEVICE_SERVICE_PATCHED", "0") == "1"

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
    """INTERNAL — the device's self-advertised command surface (read-only).
    Honestly reflects the running build: the vulnerable build enforces no auth
    and advertises the reported_overrides it (wrongly) trusts; the patched build
    requires a bearer token and drops them."""
    endpoint: dict[str, Any] = {
        "service": "device-control-service",
        "commandEndpoint": {
            "method": "POST",
            "path": "/device/command",
            "authRequired": DEVICE_SERVICE_PATCHED,
        },
        "actions": {
            "stop_fan": "stop the ventilator fan (patient stops being ventilated)",
            "set_rate": "set the fan PWM duty; integer field 'rate' in 0..255",
            "resume": "resume normal ventilation",
        },
    }
    if not DEVICE_SERVICE_PATCHED:
        endpoint["commandEndpoint"]["reportedOverrides"] = {
            "hr": "int — overrides the DISPLAYED heart rate",
            "spo2": "int — overrides the DISPLAYED SpO2",
            "alarm": "bool — overrides whether the device shows an alarm",
            "_note": "these set what the device DISPLAYS, independent of the true physical state",
        }
    return jsonify(endpoint)


@app.get("/device/_reset")
def get_device_reset():
    """INTERNAL — reset the device to the healthy baseline. A maintenance hook,
    exposed as a GET and kept off the device control surface."""
    reset_healthy()
    return jsonify(current_row())


def require_token(handler):
    @wraps(handler)
    def authenticated(*args, **kwargs):
        scheme, _, token = request.headers.get("Authorization", "").partition(" ")
        token = token.strip()
        if scheme.lower() != "bearer" or not token:
            return jsonify({"error": "bearer token required"}), 401
        # CWE-306: Require a valid token and fail closed if none is configured.
        if not DEVICE_SERVICE_TOKEN or not hmac.compare_digest(
            token.encode("utf-8"), DEVICE_SERVICE_TOKEN.encode("utf-8")
        ):
            return jsonify({"error": "invalid bearer token"}), 403
        return handler(*args, **kwargs)

    return authenticated


# ---------------------------------------------------------------------------
# The command handler. Vulnerable by default; DEVICE_SERVICE_PATCHED=1 swaps in
# the patched one. Both use the literal @app.post(...) decorator form on purpose:
# that is exactly the shape rules/missing-auth.yaml matches — it fires on the
# bare (no-auth) route and is silenced by the stacked @require_token above the
# patched route.
# ---------------------------------------------------------------------------
if DEVICE_SERVICE_PATCHED:
    # PATCHED handler: requires a valid bearer token (401/403 otherwise) and
    # forces the reported view to mirror true_state, so an untrusted caller can
    # neither drive the device nor make it lie.
    @app.post("/device/command")
    @require_token
    def device_command():
        body = request.get_json(silent=True) or {}
        action: Optional[str] = body.get("action")
        rate: Optional[int] = body.get("rate")
        # reported_overrides is read-and-discarded: the patched device never lets
        # a caller set its own displayed view.
        _ = body.get("reported_overrides") or body.get("reportedOverrides")

        err = _apply_physiology(action, rate)
        if err is not None:
            return jsonify(err[0]), err[1]

        reported_state["reported_hr"] = true_state["true_hr"]
        reported_state["reported_spo2"] = true_state["true_spo2"]
        reported_state["alarm_active"] = not true_state["fan_on"]

        _sync_and_push(action)
        return jsonify({"ok": True, "fan_on": true_state["fan_on"]})

else:
    # VULNERABLE handler — CWE-306: Missing Authentication for a Critical
    # Function. No auth check at all, and it blindly applies caller-supplied
    # reported_overrides so the reported view can diverge from true_state (the
    # "lie"). This is the function rules/missing-auth.yaml is written to fire on.
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

        # THE LIE: trust whatever the (unauthenticated) caller claims the reported
        # vitals/alarm should be, independent of the true physical state.
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


def _guard_bind() -> None:
    """Keep the deliberately-insecure build on loopback. Refuses a non-loopback
    bind unless the operator explicitly acknowledges the risk, and prints a loud
    banner when running the vulnerable build."""
    import sys

    if not DEVICE_SERVICE_PATCHED:
        print(
            "⚠  device-service is running the DELIBERATELY VULNERABLE build "
            "(CWE-306, no authentication) for the PreVent security demo. It is a "
            "localhost teaching target, not a real device — never expose it "
            "to a network.",
            file=sys.stderr,
            flush=True,
        )
    loopback = DEVICE_SERVICE_HOST in ("127.0.0.1", "localhost", "::1")
    if not loopback and os.environ.get("PREVENT_INSECURE_BIND") != "1":
        print(
            f"refusing to bind device-service to non-loopback host "
            f"{DEVICE_SERVICE_HOST!r}: this service is intentionally insecure. "
            "Set PREVENT_INSECURE_BIND=1 to override (NOT recommended).",
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(2)


if __name__ == "__main__":
    _guard_bind()
    app.run(host=DEVICE_SERVICE_HOST, port=DEVICE_SERVICE_PORT, debug=False)
