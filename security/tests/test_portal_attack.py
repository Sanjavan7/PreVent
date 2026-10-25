"""Portal exploit DELIVER -> PATCH -> VERIFY -> RESTORE tail, end-to-end (Dev 2).

Drives the four REST endpoints through Flask's test client. Unlike the other
portal tests (which are offline and hermetic), this spins up the REAL
device-service subprocess via portal_server._device() — exactly as the headless
loop does — so the attack runs against a live target over HTTP. Teardown stops
the subprocess and resets the module singleton, so no orphan python is left on
the device port.
"""

from __future__ import annotations

import json

import pytest

import portal_server
from portal_server import app

# The exact exploit the portal demo fires: stop the fan while spoofing healthy
# reported vitals and silencing the alarm.
DELIVER_CMD = {
    "action": "stop_fan",
    "reportedOverrides": {"hr": 72, "spo2": 98, "alarm": False},
}
# VERIFY re-sends the same action (byte-identical to_wire_body) at the patch.
VERIFY_CMD = {"action": "stop_fan"}


@pytest.fixture
def portal_client():
    """Flask test client that guarantees the device-service singleton is stopped
    (and the module global cleared) after the test — no orphan subprocess, no
    port left held for the next test."""
    client = app.test_client()
    try:
        yield client
    finally:
        if portal_server._SVC is not None:
            portal_server._SVC.stop()
            portal_server._SVC = None


def _post(client, path: str, payload: dict | None = None) -> dict:
    if payload is None:
        resp = client.post(path)
    else:
        resp = client.post(
            path, data=json.dumps(payload), content_type="application/json"
        )
    assert resp.status_code == 200, (path, resp.status_code, resp.get_data(as_text=True))
    return resp.get_json()


def test_attack_tail_end_to_end(portal_client):
    # 1) DELIVER against the VULNERABLE service — the unauthenticated exploit
    #    lands: fan truly stops, device keeps lying healthy.
    delivered = _post(portal_client, "/api/deliver", {"command": DELIVER_CMD})
    assert delivered["statusCode"] == 200
    assert delivered["compromised"] is True
    assert delivered["true"]["fanOn"] is False
    # The lie: reported HR diverges from the (crashed) true HR.
    assert delivered["reported"]["hr"] != delivered["true"]["hr"]
    assert isinstance(delivered["impact"], str) and delivered["impact"]

    # 2) PATCH — deploy the bearer-auth reference handler (Factory Droid stand-in).
    patched = _post(portal_client, "/api/patch")
    assert patched["applied"] is True
    assert patched["diffRef"]
    assert patched["droid"]

    # 3) VERIFY — re-send the byte-identical exploit at the patched service; it
    #    must now be blocked (401/403) with true_state intact and no lie applied.
    verified = _post(portal_client, "/api/verify", {"command": VERIFY_CMD})
    assert verified["statusCode"] in (401, 403)
    assert verified["passed"] is True
    assert verified["true"]["fanOn"] is True

    # 4) RESTORE — flip back to the clean, pre-patch vulnerable + healthy state.
    restored = _post(portal_client, "/api/restore")
    assert restored["ok"] is True
