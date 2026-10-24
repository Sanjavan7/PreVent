"""DELIVER stage — PreVent security pipeline (Dev 2).

Fires the chosen unauthenticated payload at device-service's
`POST /device/command`. Deliberately sends NO Authorization header -- that
absence is the vulnerability under test (CWE-306). The device "obeys and
lies": true_state flips per the command, and any `reportedOverrides` in the
payload are applied verbatim to reported_state.

In the live demo this is triggered by a judge pressing the IR remote: the
UNO emits `IR,code=<uint32>`, the serial bridge pushes an `ir_events` row,
and the orchestrator (Dev 1) calls `on_ir_event(code)` here.

Run directly for a quick dev/mock smoke test (no running device-service
required):
    python security/deliver.py
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, TypedDict

import requests

# Import the payload map from the sibling GENERATE module without requiring
# `security/` to be installed as a package.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate.exploit import PAYLOADS, DeviceCommand, Payload  # noqa: E402

DEVICE_SERVICE_URL = os.environ.get("DEVICE_SERVICE_URL", "http://localhost:5000")
COMMAND_PATH = "/device/command"


class DeliverResult(TypedDict):
    requested: DeviceCommand
    statusCode: int | None
    body: dict[str, Any] | str | None
    mocked: bool


# Mirrors contracts/src/mocks.ts `DEVICE_EXPLOITED` -- used as the dev-mode
# stand-in response when device-service isn't running yet, so this module
# has a working path before task #1 exists.
DEVICE_EXPLOITED_MOCK = {
    "id": 1,
    "fanOn": False,
    "trueHr": 38,
    "trueSpo2": 61,
    "reportedHr": 72,
    "reportedSpo2": 98,
    "alarmActive": False,
    "compromised": True,
    "lastCommand": "stop_fan",
    "updatedAt": 1,
}


def deliver_payload(command: DeviceCommand, *, base_url: str = DEVICE_SERVICE_URL, timeout: float = 5.0) -> DeliverResult:
    """POST `command` to `{base_url}/device/command` with NO auth header.
    Falls back to a mock result (DEVICE_EXPLOITED-shaped) if device-service
    isn't reachable yet, so DELIVER never hard-blocks the rest of the demo
    pipeline during development."""
    url = f"{base_url}{COMMAND_PATH}"
    try:
        # Intentionally no Authorization header -- this IS the exploit.
        resp = requests.post(url, json=command, timeout=timeout)
        try:
            body: dict[str, Any] | str = resp.json()
        except ValueError:
            body = resp.text
        return {"requested": command, "statusCode": resp.status_code, "body": body, "mocked": False}
    except requests.RequestException as exc:
        # TODO(dev): remove this fallback once device-service (task #1) is
        # live end-to-end; keep it until then so DELIVER is runnable standalone.
        print(f"[deliver] {url} unreachable ({exc}); returning mock DEVICE_EXPLOITED result", file=sys.stderr)
        return {"requested": command, "statusCode": None, "body": dict(DEVICE_EXPLOITED_MOCK), "mocked": True}


def payload_for_ir_code(code: int) -> Payload:
    payload = PAYLOADS.get(code)
    if payload is None:
        raise ValueError(f"no payload mapped to IR code {code}")
    return payload


def on_ir_event(code: int, *, base_url: str = DEVICE_SERVICE_URL) -> DeliverResult:
    """Handler for an `ir_events` row pushed by the serial bridge
    (judge pressed the remote). TODO(dev): wire this up to the real
    `ir_events` subscription (SpacetimeDB/Convex, owned by Dev 1/Dev 3) --
    right now it's just the pure code -> payload -> delivery path, called
    directly with a code for dev/testing."""
    payload = payload_for_ir_code(code)
    return deliver_payload(payload["command"], base_url=base_url)


if __name__ == "__main__":
    for code, payload in PAYLOADS.items():
        result = on_ir_event(code)
        print(json.dumps({"irCode": code, "payloadId": payload["id"], "result": result}, indent=2))
        time.sleep(0)  # placeholder for pacing between demo beats if ever run live
