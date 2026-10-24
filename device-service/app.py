"""
device-service — the PreVent "attack surface" (Dev 2 / security-verification).

Holds TWO separate state dicts on purpose:
  - true_state:     what is physically happening to the patient (fan, vitals).
  - reported_state:  what the device DISPLAYS / reports upstream (can be a lie).

The vulnerable POST /device/command handler (CWE-306, see rules/missing-auth.yaml)
has NO auth check and will blindly apply client-supplied `reported_overrides` onto
reported_state even when they contradict true_state. That true/reported desync
*is* the exploit: fan stops (true_state.fan_on=False) while reported vitals/alarm
stay "normal" (the silence beat).

A PATCHED reference implementation is included below, feature-flagged off by
default via DEVICE_SERVICE_PATCHED, as the target for the patch stage (Droid).

Field names in the wire payloads intentionally mirror contracts/src/types.ts:
  DeviceStatus.fanOn / trueHr / trueSpo2 / reportedHr / reportedSpo2 /
  alarmActive / compromised / lastCommand / updatedAt
(JSON over the wire here uses snake_case per plans/PLAN-DEV2-security-verification.md
 task 1; push_device_status() re-maps to the camelCase contracts shape before
 handing off to the realtime DB client.)
"""

from __future__ import annotations

import functools
import os
import time
from typing import Any, Optional

from flask import Flask, jsonify, request

app = Flask(__name__)

# TODO(dev): set DEVICE_SERVICE_TOKEN in the environment once the patched path
# is wired up for real (Droid's patch stage target). Never hardcode a token.
DEVICE_SERVICE_TOKEN = os.environ.get("DEVICE_SERVICE_TOKEN", "")

# Feature flag: default is the VULNERABLE handler (the demo needs the exploit
# to work). Flip to "1" only to exercise the patched reference path locally.
DEVICE_SERVICE_PATCHED = os.environ.get("DEVICE_SERVICE_PATCHED", "0") == "1"

# --- separate true vs. reported state (contracts/src/types.ts: DeviceStatus) ---
true_state: dict[str, Any] = {
    "fan_on": True,
    "true_hr": 72,
    "true_spo2": 98,
}

reported_state: dict[str, Any] = {
    "reported_hr": 72,
    "reported_spo2": 98,
    "alarm_active": False,
}

compromised: bool = False
last_command: str = "resume"
updated_at: int = 0


def _now_ms() -> int:
    return int(time.time() * 1000)


def push_device_status(
    fan_on: bool,
    true_hr: int,
    true_spo2: int,
    reported_hr: int,
    reported_spo2: int,
    alarm_active: bool,
    is_compromised: bool,
    command: str,
) -> None:
    """Push the single-source-of-truth DeviceStatus row to the realtime backend
    (SpacetimeDB / Convex — see .env.example VITE_REALTIME_BACKEND) so the
    dashboard + hardware bridge pick up the change.

    TODO(dev): wire this to the real realtime client. Expected shape matches
    contracts/src/types.ts DeviceStatus exactly (camelCase, id is always 1):
        { id: 1, fanOn, trueHr, trueSpo2, reportedHr, reportedSpo2,
          alarmActive, compromised, lastCommand, updatedAt }
    For now this is a stub that just logs the payload that WOULD be sent.
    """
    payload = {
        "id": 1,
        "fanOn": fan_on,
        "trueHr": true_hr,
        "trueSpo2": true_spo2,
        "reportedHr": reported_hr,
        "reportedSpo2": reported_spo2,
        "alarmActive": alarm_active,
        "compromised": is_compromised,
        "lastCommand": command,
        "updatedAt": _now_ms(),
    }
    # TODO(dev): replace with e.g. requests.post(f"{REALTIME_HTTP_URL}/updateDeviceStatus", json=payload)
    # or a SpacetimeDB/Convex client call. Keeping this a no-op-but-visible stub
    # so the mock/dev path (no realtime backend running) never crashes the demo.
    print(f"[push_device_status] (stub, not wired) {payload}")


def _recompute_compromised() -> bool:
    """A device is 'compromised' once reported state no longer matches the
    true physiological/mechanical state — i.e. the device is lying."""
    return (
        reported_state["reported_hr"] != true_state["true_hr"]
        or reported_state["reported_spo2"] != true_state["true_spo2"]
        or (not true_state["fan_on"] and not reported_state["alarm_active"])
    )


def require_token(fn):
    """Auth decorator for the PATCHED reference handler. SemGrep's
    rules/missing-auth.yaml rule treats a stacked `@require_token` (matched
    via its generic `$AUTH(...)` decorator pattern) as proof of an auth
    check, same as `@login_required` would be."""

    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any):
        auth_header = request.headers.get("Authorization", "")
        token = auth_header.removeprefix("Bearer ").strip() if auth_header else ""

        if not DEVICE_SERVICE_TOKEN:
            # Server misconfigured (no token set) -> fail closed, not open.
            return jsonify({"error": "server not configured for auth"}), 403
        if not token:
            return jsonify({"error": "missing bearer token"}), 401
        if token != DEVICE_SERVICE_TOKEN:
            return jsonify({"error": "invalid token"}), 403
        return fn(*args, **kwargs)

    return wrapper


def _sync_and_push(command: str) -> None:
    global compromised, last_command, updated_at
    compromised = _recompute_compromised()
    last_command = command
    updated_at = _now_ms()
    push_device_status(
        fan_on=true_state["fan_on"],
        true_hr=true_state["true_hr"],
        true_spo2=true_state["true_spo2"],
        reported_hr=reported_state["reported_hr"],
        reported_spo2=reported_state["reported_spo2"],
        alarm_active=reported_state["alarm_active"],
        is_compromised=compromised,
        command=command,
    )


@app.route("/device/status", methods=["GET"])
def get_device_status():
    """GET /device/status -> { fan_on, reported: { hr, spo2 }, alarm }
    (deliberately exposes only the REPORTED view, same as a real device UI)."""
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


# ---------------------------------------------------------------------------
# Route registration: vulnerable by default (the demo depends on the exploit
# working out of the box). DEVICE_SERVICE_PATCHED=1 swaps in the patched
# reference handler instead. Both branches below use the literal
# `@app.route(...)` decorator form (not add_url_rule) on purpose: that is
# exactly the shape rules/missing-auth.yaml's SemGrep rule is written
# against — `ruleid` on the vulnerable (no-auth-decorator) branch, `ok` on
# the patched (`@require_token`-decorated) branch. Only one branch's `def
# device_command` actually executes at import time (Flask only ever sees one
# live route), but SemGrep's static AST match sees both branches regardless
# of DEVICE_SERVICE_PATCHED, which is exactly what "fires on the vuln, silent
# on the patched" needs.
# ---------------------------------------------------------------------------
if DEVICE_SERVICE_PATCHED:
    # PATCHED reference handler — the target for the patch stage (Droid).
    # Requires a bearer token (401/403 on missing/invalid) and IGNORES
    # untrusted reported_overrides entirely so true/reported can never desync.
    # ok: flask-missing-auth-decorator
    @app.route("/device/command", methods=["POST"])
    @require_token
    def device_command():
        body = request.get_json(silent=True) or {}
        action: Optional[str] = body.get("action")
        rate: Optional[int] = body.get("rate")
        # reported_overrides is intentionally read-and-discarded: the patched
        # device never lets a caller set its own "reported" view.
        _ = body.get("reported_overrides")

        if action == "stop_fan":
            true_state["fan_on"] = False
        elif action == "set_rate":
            true_state["set_rate_value"] = rate
        elif action == "resume":
            true_state["fan_on"] = True
        else:
            return jsonify({"error": "unknown action"}), 400

        # reported_state always mirrors true_state here — no overrides accepted.
        reported_state["reported_hr"] = true_state["true_hr"]
        reported_state["reported_spo2"] = true_state["true_spo2"]
        reported_state["alarm_active"] = not true_state["fan_on"]

        _sync_and_push(action)
        return jsonify({"ok": True, "fan_on": true_state["fan_on"]})

else:
    # VULNERABLE handler — CWE-306: Missing Authentication for Critical
    # Function. No auth decorator / token check at all. This is the function
    # rules/missing-auth.yaml is written to fire on.
    # ruleid: flask-missing-auth-decorator
    @app.route("/device/command", methods=["POST"])
    def device_command():
        body = request.get_json(silent=True) or {}
        action: Optional[str] = body.get("action")
        reported_overrides: dict[str, Any] = body.get("reported_overrides") or {}
        rate: Optional[int] = body.get("rate")

        if action == "stop_fan":
            true_state["fan_on"] = False
        elif action == "set_rate":
            # NOTE: no bound/validation on `rate` either — part of the same
            # "trust everything the client sends" vulnerability class.
            true_state["set_rate_value"] = rate
        elif action == "resume":
            true_state["fan_on"] = True
        else:
            return jsonify({"error": "unknown action"}), 400

        # THE LIE: blindly apply whatever the (unauthenticated) caller claims
        # the reported vitals/alarm should be, unrelated to true_state.
        if "hr" in reported_overrides:
            reported_state["reported_hr"] = reported_overrides["hr"]
        if "spo2" in reported_overrides:
            reported_state["reported_spo2"] = reported_overrides["spo2"]
        if "alarm" in reported_overrides:
            reported_state["alarm_active"] = reported_overrides["alarm"]

        _sync_and_push(action)
        return jsonify({"ok": True, "fan_on": true_state["fan_on"]})


def reset_healthy() -> None:
    """Used by RESTORE (security/verify.py) to put the device back to the
    DEVICE_HEALTHY shape from contracts/src/mocks.ts after a verified fix."""
    true_state["fan_on"] = True
    true_state["true_hr"] = 72
    true_state["true_spo2"] = 98
    reported_state["reported_hr"] = 72
    reported_state["reported_spo2"] = 98
    reported_state["alarm_active"] = False
    _sync_and_push("resume")


if __name__ == "__main__":
    # TODO(dev): bind host/port from env (DEVICE_SERVICE_URL in .env.example
    # implies host.docker.internal/localhost:5000 in dev). debug=False on
    # purpose -- Bandit flags Flask debug=True (B201); that's deliberate noise
    # for the SCAN stage's "wrong-then-caught" probe, not this real server.
    app.run(host="127.0.0.1", port=5000, debug=False)
