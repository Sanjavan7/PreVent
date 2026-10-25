"""Offline verification suite for the whole fetch_agent package (no ASI:One).
Run from repo root:  ./.venv/Scripts/python.exe -m fetch_agent._verify
"""

from __future__ import annotations

import asyncio
import json
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from .cards import parse_approval
from .evidence import build_sbom_vex, build_signed_manifest, verify_signed_manifest
from .payment import make_subscription_request, settle
from .pipeline import run_gate_check
from .service_control import DeviceServiceController

_results: list[tuple[str, bool]] = []


def check(name: str, cond: bool) -> None:
    _results.append((name, bool(cond)))
    print(("PASS" if cond else "FAIL"), "-", name, flush=True)


async def main() -> None:
    # --- imports (catches wiring errors in both agents) ---
    import fetch_agent.agent  # noqa: F401
    import fetch_agent.release_captain  # noqa: F401
    check("import: agent + release_captain", True)

    # --- approval parser ---
    check("parse: APPROVE", parse_approval("APPROVE") == "approve")
    check("parse: json reject", parse_approval('{"action":"reject"}') == "reject")
    check("parse: ambiguous -> None", parse_approval("hmm not sure") is None)

    # --- payment (off-path, idempotent, demo mode) ---
    check("pay: demo paid -> complete", settle("cs_demo_paid_1", "stripe")[0] == "complete")
    check("pay: idempotent replay -> complete", settle("cs_demo_paid_1", "stripe")[0] == "complete")
    check("pay: unpaid -> cancel", settle("cs_unpaid_2", "stripe")[0] == "cancel")
    check("pay: wrong method -> cancel", settle("cs_demo_paid_3", "paypal")[0] == "cancel")
    check("pay: no txn -> cancel", settle(None, "stripe")[0] == "cancel")
    req = make_subscription_request("agent1qexample")
    check("pay: request is stripe/USD", req.accepted_funds[0].payment_method == "stripe" and req.accepted_funds[0].currency == "USD")

    # --- evidence (signed + tamper-evident) ---
    sb = build_sbom_vex(cve_id="CVE-2019-6538", exploitable=False, deliver_status=200, verify_status=401, ts="t")
    check("sbom: cyclonedx 1.5 resolved cwe306", sb["specVersion"] == "1.5" and sb["vulnerabilities"][0]["analysis"]["state"] == "resolved" and sb["vulnerabilities"][0]["cwes"] == [306])
    man = build_signed_manifest(run_id="r", cve_id="CVE-2019-6538", canonical_request="POST ...", request_sha256="abc", deliver_status=200, verify_status=401, pre_patch_row={"fan_on": False}, post_patch_row={"fan_on": True}, sbom=sb)
    check("evidence: signature valid", verify_signed_manifest(man) is True)
    tampered = json.loads(json.dumps(man))
    tampered["verify_status"] = 200  # edit a field without re-signing
    check("evidence: tamper detected", verify_signed_manifest(tampered) is False)

    # --- A2A machine gate check (real stages, warm service) ---
    msgs: list[str] = []

    async def cap(t: str) -> None:
        msgs.append(t)

    ctrl = DeviceServiceController()
    try:
        res = await run_gate_check(cap, controller=ctrl)
    finally:
        ctrl.stop()
    check("gate_check: NO-GO on vulnerable target", res["go"] is False and "CWE-306" in res["reason"])

    # --- summary ---
    passed = sum(1 for _, ok in _results if ok)
    total = len(_results)
    print(f"\n========== VERIFY {passed}/{total} {'PASS' if passed == total else 'FAIL'} ==========", flush=True)
    if passed != total:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
