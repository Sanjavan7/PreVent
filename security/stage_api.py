"""stage_api — JSON-in / JSON-out stage CLI for the PreVent security loop (Dev 2).

A thin subprocess bridge so Dev 1's TypeScript orchestrator can invoke each
security stage as a child process and parse one JSON object off stdout. This
module REUSES the existing stage functions (ground/scan/generate/deliver/verify/
restore) exactly as `security/loop.py` imports them — it does not reimplement any
stage logic; it only adapts call signatures and shapes the result.

Contract: exactly one JSON object is written to stdout per call:

    {"stage": <name>, "ok": <bool>, "data": {...}, "events": [{"actor","text"}...]}

`data` is a SUPERSET of the matching orchestrator stub's return shape
(agents/src/orchestrator.ts: groundStub/scanStub/generateStub/deliverStub/
verifyStub), so swapping a stub for a `stage_api` subprocess call needs no shape
changes on the TS side.

Any stray stdout from the reused modules (e.g. GENERATE's "no key -> cached PoC"
notice) is redirected to stderr while a stage runs, so stdout carries ONLY the
final JSON object. Exit code is non-zero when `ok` is false.

Usage:
  python -m security.stage_api <stage> [--input '<json>'] \
      [--base-url http://127.0.0.1:8071] [--goal "<text>"] [--payload <id>]

Stages: ground | scan | generate | deliver | verify | restore
"""

from __future__ import annotations

import argparse
import contextlib
import json
import sys
import time
from pathlib import Path
from typing import Any

SECURITY_DIR = Path(__file__).resolve().parent
REPO_ROOT = SECURITY_DIR.parent

# Import the sibling stage modules exactly as loop.py does: insert the security
# dir on sys.path so `ground/`, `scan/`, `generate/`, deliver/verify/restore all
# resolve as top-level, regardless of how this file is launched.
if str(SECURITY_DIR) not in sys.path:
    sys.path.insert(0, str(SECURITY_DIR))

from ground.ground import ground  # noqa: E402
from scan.run_scanners import run_scanners  # noqa: E402
from scan.triage import deterministic_triage  # noqa: E402
from generate.exploit import PAYLOADS, generate_dynamic_payload, generate_poc  # noqa: E402
from deliver import deliver_payload, to_wire_body  # noqa: E402
from verify import fetch_device_status_row, verify_patch  # noqa: E402
from restore import restore  # noqa: E402

DEFAULT_BASE_URL = "http://127.0.0.1:8071"
DEFAULT_PAYLOAD = "stop-breathing"
STAGES = ("ground", "scan", "generate", "deliver", "verify", "restore")

# Used when GENERATE is invoked without a finding on --input (so the stage is
# runnable standalone); mirrors the mock finding in generate/exploit.py.
DEFAULT_FINDING: dict[str, Any] = {
    "scanner": "semgrep",
    "cveRef": "CVE-2019-6538",
    "file": "device-service/app.py",
    "line": 333,
    "severity": "ERROR",
    "ruleId": "flask-missing-auth-decorator",
    "claudeVerdict": "Missing authentication on POST /device/command (CWE-306)",
    "isTheRealOne": True,
}

# The contract Finding fields (contracts/src/types.ts `Finding`) we project a
# triage result onto so `data.chosen` is a clean contract-Finding subset.
_FINDING_KEYS = (
    "id",
    "scanner",
    "cveRef",
    "file",
    "line",
    "severity",
    "ruleId",
    "claudeVerdict",
    "isTheRealOne",
    "createdAt",
)


def _to_finding(raw: dict[str, Any]) -> dict[str, Any]:
    """Project a scanner/triage finding down to the contract `Finding` fields."""
    return {k: raw[k] for k in _FINDING_KEYS if k in raw}


def _extract_finding(input_obj: Any) -> dict[str, Any]:
    """Resolve a finding from --input: accept the finding dict itself, or a
    wrapper carrying it under `chosen`/`finding`/`data.chosen`. Falls back to a
    sensible default so GENERATE runs even with no --input."""
    if isinstance(input_obj, dict):
        if isinstance(input_obj.get("chosen"), dict):
            return input_obj["chosen"]
        if isinstance(input_obj.get("finding"), dict):
            return input_obj["finding"]
        data = input_obj.get("data")
        if isinstance(data, dict) and isinstance(data.get("chosen"), dict):
            return data["chosen"]
        if "scanner" in input_obj or "file" in input_obj or "cveRef" in input_obj:
            return input_obj
    return dict(DEFAULT_FINDING)


def _resolve_command(input_obj: Any, *, goal: str | None, payload_id: str | None, base_url: str) -> dict[str, Any]:
    """Resolve the DeviceCommand DELIVER/VERIFY should fire. Priority: an
    explicit {command: ...} on --input, then --goal (dynamic authoring), then
    --payload (a preset)."""
    if isinstance(input_obj, dict) and isinstance(input_obj.get("command"), dict):
        return input_obj["command"]
    if goal:
        dyn = generate_dynamic_payload(goal, _extract_finding(input_obj), base_url=base_url)
        return dyn["command"]
    pid = payload_id or DEFAULT_PAYLOAD
    payload = next((p for p in PAYLOADS.values() if p["id"] == pid), None)
    if payload is None:
        raise ValueError(f"unknown payload id {pid!r}")
    return payload["command"]


# ------------------------------------------------------------------- stages ---

def _stage_ground() -> tuple[bool, dict[str, Any], list[dict[str, str]]]:
    card = ground()
    scores = ", ".join(f"{v['score']} {v['severity']} ({v['source']})" for v in card["cvss"].values())
    events = [{
        "actor": "ground",
        "text": f"Grounded in {card['cveId']} — CWE {', '.join(card['cwe'])}. CVSS: {scores}.",
    }]
    # The card already carries top-level cveId + summary (superset of groundStub).
    return True, dict(card), events


def _stage_scan(base_url: str) -> tuple[bool, dict[str, Any], list[dict[str, str]]]:
    scans = run_scanners()
    events: list[dict[str, str]] = [{
        "actor": "scan",
        "text": (
            f"SemGrep: {len(scans['semgrep'])} finding(s); Bandit: {len(scans['bandit'])} "
            f"finding(s) ({', '.join(sorted({f['ruleId'] for f in scans['bandit']}))})."
        ),
    }]
    triage = deterministic_triage(scans["semgrep"], scans["bandit"], base_url=base_url)
    events.extend({"actor": s["actor"], "text": s["text"]} for s in triage["trail"])

    chosen_raw = triage["chosen"]
    ok = chosen_raw is not None
    chosen = _to_finding(chosen_raw) if chosen_raw else None
    if chosen is not None:
        events.append({
            "actor": "scan",
            "text": f"recordFinding {chosen['file']}:{chosen['line']} "
                    f"({chosen.get('cveRef', '')}) real={chosen['isTheRealOne']}",
        })
    data = {
        "chosen": chosen,
        "considered": [_to_finding(c) for c in triage["considered"]],
        "selfCorrected": triage["selfCorrected"],
        "semgrepCount": len(scans["semgrep"]),
        "banditCount": len(scans["bandit"]),
    }
    return ok, data, events


def _stage_generate(
    input_obj: Any, *, goal: str | None, payload_id: str | None, base_url: str
) -> tuple[bool, dict[str, Any], list[dict[str, str]]]:
    finding = _extract_finding(input_obj)
    if goal:
        dyn = generate_dynamic_payload(goal, finding, base_url=base_url)
        data = {
            "mode": "dynamic",
            "command": dyn["command"],
            "source": dyn["source"],
            "modelId": dyn["modelId"],
            "impact": dyn["impact"],
            "rationale": dyn["rationale"],
            "payloadRef": f"dynamic:{goal}",
        }
        events = [
            {"actor": "generate", "text": f"Payload AUTHORED by {dyn['source']} ({dyn['modelId']}) for goal: {goal!r}"},
            {"actor": "generate", "text": f"command: {json.dumps(dyn['command'])}  |  {dyn['rationale']}"},
        ]
        return True, data, events

    pid = payload_id or DEFAULT_PAYLOAD
    payload = next((p for p in PAYLOADS.values() if p["id"] == pid), None)
    if payload is None:
        raise ValueError(f"unknown payload id {pid!r}")
    poc = generate_poc(pid, finding)
    data = {
        "mode": "preset",
        "payloadRef": pid,
        "command": payload["command"],
        "source": poc["source"],
        "modelId": poc["modelId"],
        "pocText": poc["pocText"],
    }
    events = [{"actor": "generate", "text": f"PoC drafted via {poc['source']} (model={poc['modelId']})."}]
    return True, data, events


def _stage_deliver(
    input_obj: Any, *, goal: str | None, payload_id: str | None, base_url: str
) -> tuple[bool, dict[str, Any], list[dict[str, str]]]:
    command = _resolve_command(input_obj, goal=goal, payload_id=payload_id, base_url=base_url)
    before = fetch_device_status_row(base_url=base_url)
    result = deliver_payload(command, base_url=base_url)
    after = fetch_device_status_row(base_url=base_url)

    status = result["statusCode"]
    exploit_worked = status == 200
    fan_stopped = bool(before["fanOn"]) and not bool(after["fanOn"])
    lying = (
        after["reportedHr"] != after["trueHr"]
        or after["reportedSpo2"] != after["trueSpo2"]
        or (not after["fanOn"] and not after["alarmActive"])
    )
    action = command.get("action")
    if fan_stopped:
        impact = (
            f"fan STOPPED; true vitals {after['trueHr']}/{after['trueSpo2']} but device reports "
            f"{after['reportedHr']}/{after['reportedSpo2']} and alarm is "
            f"{'OFF (silent)' if not after['alarmActive'] else 'ON'} — the device is LYING."
        )
    elif action == "set_rate":
        impact = (
            f"unauthenticated set_rate accepted (rate={command.get('rate')}); no auth required — "
            "attacker drives the device (CWE-306 over-pressure)."
        )
    elif not exploit_worked:
        impact = f"command rejected (HTTP {status}) — the handler enforced auth; no compromise."
    else:
        impact = (
            f"unauthenticated {action} accepted; reported {after['reportedHr']}/{after['reportedSpo2']} "
            f"vs true {after['trueHr']}/{after['trueSpo2']}" + (" — LYING." if lying else ".")
        )

    data = {
        "httpStatus": status,
        "impact": impact,
        "exploitWorked": exploit_worked,
        "row": after,
        # superset of deliverStub's {deviceImpact, success}
        "deviceImpact": impact,
        "success": exploit_worked,
    }
    events = [
        {"actor": "deliver", "text": f"Unauthenticated POST /device/command {json.dumps(to_wire_body(command))} -> HTTP {status}."},
        {"actor": "device", "text": (
            f"after exploit: fan={'ON' if after['fanOn'] else 'OFF'} "
            f"true={after['trueHr']}/{after['trueSpo2']} reported={after['reportedHr']}/{after['reportedSpo2']} "
            f"alarm={'ON' if after['alarmActive'] else 'OFF'} compromised={after['compromised']}"
        )},
    ]
    return exploit_worked, data, events


def _stage_verify(
    input_obj: Any, *, goal: str | None, payload_id: str | None, base_url: str
) -> tuple[bool, dict[str, Any], list[dict[str, str]]]:
    command = _resolve_command(input_obj, goal=goal, payload_id=payload_id, base_url=base_url)
    outcome = verify_patch(command, base_url=base_url)
    data = dict(outcome)
    # superset of verifyStub's {success, detail}; `detail` is already present.
    data["success"] = bool(outcome["passed"])
    events = [
        {"actor": "verify", "text": f"[{'PASS' if outcome['statusCheckPassed'] else 'FAIL'}] status is 401/403"},
        {"actor": "verify", "text": f"[{'PASS' if outcome['trueStateUnchangedPassed'] else 'FAIL'}] true_state unchanged"},
        {"actor": "verify", "text": f"[{'PASS' if outcome['reportedMatchesTruePassed'] else 'FAIL'}] reported == true (no lie)"},
        {"actor": "verify", "text": f"re-ran byte-identical exploit -> HTTP {outcome['statusCode']}; {outcome['detail']}"},
    ]
    return bool(outcome["passed"]), data, events


def _stage_restore(base_url: str) -> tuple[bool, dict[str, Any], list[dict[str, str]]]:
    result = restore(base_url=base_url, revert_git=False)
    ok = bool(result.get("device", {}).get("ok", False))
    events = [{"actor": "restore", "text": f"Reverted to pre-patch vulnerable state + reset healthy (ok={ok})."}]
    return ok, result, events


# -------------------------------------------------------------------- driver --

def run_stage(
    stage: str,
    *,
    input_obj: Any = None,
    base_url: str = DEFAULT_BASE_URL,
    goal: str | None = None,
    payload: str | None = None,
) -> dict[str, Any]:
    """Run one stage and return {stage, ok, data, events}. Never raises: any
    exception is captured into ok=False + data.error so the caller always gets a
    well-formed JSON object. Stray stdout from the reused modules is routed to
    stderr so the returned object is the only thing on real stdout."""
    if stage not in STAGES:
        return {"stage": stage, "ok": False, "data": {"error": f"unknown stage {stage!r}"}, "events": []}

    started = int(time.time() * 1000)
    try:
        with contextlib.redirect_stdout(sys.stderr):
            if stage == "ground":
                ok, data, events = _stage_ground()
            elif stage == "scan":
                ok, data, events = _stage_scan(base_url)
            elif stage == "generate":
                ok, data, events = _stage_generate(input_obj, goal=goal, payload_id=payload, base_url=base_url)
            elif stage == "deliver":
                ok, data, events = _stage_deliver(input_obj, goal=goal, payload_id=payload, base_url=base_url)
            elif stage == "verify":
                ok, data, events = _stage_verify(input_obj, goal=goal, payload_id=payload, base_url=base_url)
            else:  # restore
                ok, data, events = _stage_restore(base_url)
    except Exception as exc:  # noqa: BLE001 - always return a well-formed object
        return {
            "stage": stage,
            "ok": False,
            "data": {"error": f"{type(exc).__name__}: {exc}"},
            "events": [{"actor": stage, "text": f"stage raised {type(exc).__name__}: {exc}"}],
        }

    return {"stage": stage, "ok": bool(ok), "data": data, "events": events, "startedAt": started}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="python -m security.stage_api",
        description="Run one PreVent security stage; emit one JSON object on stdout.",
    )
    ap.add_argument("stage", choices=STAGES, help="which stage to run")
    ap.add_argument("--input", help="JSON passed to the stage (a finding for generate; {command:...} for deliver/verify)")
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL, help="device-service base URL (default %(default)s)")
    ap.add_argument("--goal", help="attacker goal in plain English -> author the payload dynamically (generate/deliver/verify)")
    ap.add_argument("--payload", choices=[p["id"] for p in PAYLOADS.values()],
                    help=f"preset payload id (default {DEFAULT_PAYLOAD} for generate/deliver/verify)")
    args = ap.parse_args(argv)

    input_obj: Any = None
    if args.input:
        try:
            input_obj = json.loads(args.input)
        except json.JSONDecodeError as exc:
            print(json.dumps({"stage": args.stage, "ok": False,
                              "data": {"error": f"invalid --input JSON: {exc}"}, "events": []}))
            return 1

    result = run_stage(
        args.stage,
        input_obj=input_obj,
        base_url=args.base_url,
        goal=args.goal,
        payload=args.payload,
    )
    print(json.dumps(result))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
