"""VERIFY (deterministic re-run) and the full headless loop end-to-end."""

from __future__ import annotations

import socket

from generate.exploit import PAYLOADS, IR_CODE_STOP_BREATHING
from verify import verify_patch
from loop import run_loop

STOP_CMD = PAYLOADS[IR_CODE_STOP_BREATHING]["command"]


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_verify_passes_on_patched(patched_url):
    outcome = verify_patch(STOP_CMD, base_url=patched_url)
    assert outcome["passed"] is True
    assert outcome["statusCheckPassed"] and outcome["trueStateUnchangedPassed"]
    assert outcome["reportedMatchesTruePassed"]
    assert outcome["statusCode"] in (401, 403)


def test_verify_fails_on_vulnerable(vulnerable_url):
    """Sanity: on the UNPATCHED service the 'verify' must NOT pass — the re-run
    still has an effect. A verifier that always passes would be worthless."""
    outcome = verify_patch(STOP_CMD, base_url=vulnerable_url)
    assert outcome["passed"] is False


def test_deliver_is_byte_identical_each_time():
    from deliver import to_wire_body

    assert to_wire_body(STOP_CMD) == to_wire_body(STOP_CMD)


def test_full_loop_closes(tmp_path):
    report = run_loop(port=free_port(), payload_id="stop-breathing", quiet=True, run_dir=tmp_path / "run")
    assert report["ok"] is True
    scan = report["stages"]["scan"]
    assert scan["selfCorrected"] is True
    assert scan["chosen"]["cveRef"] == "CVE-2019-6538"
    assert report["stages"]["deliver"]["exploitWorked"] is True
    assert report["stages"]["verify"]["passed"] is True
    # The exploit was recorded as working, then (post-patch) as no-longer-working.
    successes = [r["success"] for r in report["exploitRuns"]]
    assert True in successes and False in successes
    # A receipt was written.
    assert (tmp_path / "run" / "report.json").exists()


def test_full_loop_max_pressure_payload(tmp_path):
    report = run_loop(port=free_port(), payload_id="max-pressure", quiet=True, run_dir=tmp_path / "run")
    assert report["ok"] is True
