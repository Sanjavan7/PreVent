"""VERIFY stage — deterministic, non-AI — PreVent security pipeline (Dev 2).

Re-sends the byte-identical exploit payload and asserts all three of:
  (a) the response is 401/403 (patched service now requires auth)
  (b) true_state is unchanged (the fan didn't actually stop)
  (c) reported == true (no lie -- the patched service doesn't apply
      untrusted `reportedOverrides`)

All three pass => PASS => the exploit no longer works => RESTORE flips the
device_status row back to healthy (fan resumes, vitals true, alarm armed,
rgb green).

This module is intentionally NOT an LLM call -- it's the deterministic
check that proves the patch, independent of whatever Droid/Claude produced.

Run directly for a quick dev/mock smoke test:
    python security/verify.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, TypedDict

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from deliver import DEVICE_EXPLOITED_MOCK, DEVICE_SERVICE_URL, deliver_payload  # noqa: E402
from generate.exploit import DeviceCommand  # noqa: E402

STATUS_PATH = "/device/status"

# Mirrors contracts/src/mocks.ts `DEVICE_HEALTHY` -- the dev-mode stand-in
# "source of truth" row used until the real shared `device_status`
# table/reducer (Dev 1/Dev 3, SpacetimeDB or Convex) is wired up.
DEVICE_HEALTHY_MOCK = {
    "id": 1,
    "fanOn": True,
    "trueHr": 72,
    "trueSpo2": 98,
    "reportedHr": 72,
    "reportedSpo2": 98,
    "alarmActive": False,
    "compromised": False,
    "lastCommand": "resume",
    "updatedAt": 0,
}


class VerifyResult(TypedDict):
    statusCheckPassed: bool  # (a) 401/403
    trueStateUnchangedPassed: bool  # (b)
    reportedMatchesTruePassed: bool  # (c)
    passed: bool
    statusCode: int | None
    detail: str


def fetch_device_status_row(*, base_url: str = DEVICE_SERVICE_URL) -> dict[str, Any]:
    """Returns a contracts/src/types.ts `DeviceStatus`-shaped dict -- the
    full true+reported row. TODO(dev): wire this to the real shared
    `device_status` row (SpacetimeDB/Convex, owned by Dev 1/Dev 3) once it
    exists; GET /device/status on device-service itself only exposes
    `{fan_on, reported:{hr,spo2}, alarm}` (true vitals are deliberately not
    on the public API -- that's the point of the lie), so a full
    true-vs-reported compare needs the shared row, not just this endpoint.
    Falls back to the DEVICE_HEALTHY mock when unreachable so this module
    is runnable standalone before that wiring exists."""
    try:
        resp = requests.get(f"{base_url}{STATUS_PATH}", timeout=5.0)
        resp.raise_for_status()
        body = resp.json()
        # Partial shape from the public endpoint -- merge onto the mock so
        # callers still get a full DeviceStatus-shaped dict in dev mode.
        merged = dict(DEVICE_HEALTHY_MOCK)
        merged["fanOn"] = bool(body.get("fan_on", merged["fanOn"]))
        merged["reportedHr"] = body.get("reported", {}).get("hr", merged["reportedHr"])
        merged["reportedSpo2"] = body.get("reported", {}).get("spo2", merged["reportedSpo2"])
        merged["alarmActive"] = bool(body.get("alarm", merged["alarmActive"]))
        return merged
    except requests.RequestException as exc:
        print(f"[verify] {base_url}{STATUS_PATH} unreachable ({exc}); using DEVICE_HEALTHY mock", file=sys.stderr)
        return dict(DEVICE_HEALTHY_MOCK)


def verify_patch(
    command: DeviceCommand,
    *,
    base_url: str = DEVICE_SERVICE_URL,
    status_before: dict[str, Any] | None = None,
) -> VerifyResult:
    """Re-sends `command` (the exact same exploit payload DELIVER used) and
    runs the 3 deterministic asserts against the patched service."""
    before = status_before if status_before is not None else fetch_device_status_row(base_url=base_url)

    result = deliver_payload(command, base_url=base_url)
    status_code = result["statusCode"]

    # (a) status 401/403
    status_check_passed = status_code in (401, 403)

    after = fetch_device_status_row(base_url=base_url)

    # (b) true_state unchanged -- fan didn't actually stop
    true_state_unchanged_passed = after["fanOn"] == before["fanOn"]

    # (c) reported == true -- no lie got applied
    reported_matches_true_passed = (
        after["reportedHr"] == after["trueHr"] and after["reportedSpo2"] == after["trueSpo2"]
    )

    passed = status_check_passed and true_state_unchanged_passed and reported_matches_true_passed

    return {
        "statusCheckPassed": status_check_passed,
        "trueStateUnchangedPassed": true_state_unchanged_passed,
        "reportedMatchesTruePassed": reported_matches_true_passed,
        "passed": passed,
        "statusCode": status_code,
        "detail": (
            "PASS: patch holds (401/403, true_state unchanged, no lie)."
            if passed
            else "FAIL: re-run of the byte-identical exploit still had an effect -- patch did not hold."
        ),
    }


def build_exploit_run_update(finding_id: int, *, success: bool) -> dict[str, Any]:
    """Shapes the post-VERIFY update to the original `ExploitRun` row
    (contracts/src/types.ts `ExploitRun`) -- `success=false` here means the
    exploit no longer works (the patch held), matching the plan's
    `recordExploitRun(success=false)` on a PASS.
    TODO(dev): wire to the real recordExploitRun reducer (Dev 1/Dev 3)."""
    return {"findingId": finding_id, "success": success}


if __name__ == "__main__":
    # Dev/mock smoke test against the same mock exploit payload DELIVER uses.
    from generate.exploit import PAYLOADS, IR_CODE_STOP_BREATHING

    command = PAYLOADS[IR_CODE_STOP_BREATHING]["command"]
    outcome = verify_patch(command, status_before=dict(DEVICE_HEALTHY_MOCK))
    print(json.dumps(outcome, indent=2))
