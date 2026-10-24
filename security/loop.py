"""PreVent security loop — headless, offline, key-free end-to-end driver (Dev 2).

Runs the WHOLE security thesis against the team's own local toy device-service,
with no API keys and no board:

  GROUND  -> cite the real CVE (NVD, cached)                     (ground/)
  SCAN    -> SemGrep (1 real CWE-306) + Bandit (3 decoys), then
             deterministic triage that visibly self-corrects once (scan/)
  GENERATE-> draft the PoC (Bitdeer if keyed, else cached)       (generate/)
  DELIVER -> fire the UNAUTHENTICATED payload: fan stops, patient
             crashes, device keeps reporting normal + never alarms (deliver.py)
  PATCH   -> deploy the patched service (bearer-token required,
             overrides ignored) — stands in for Factory Droid's diff
  VERIFY  -> re-send the BYTE-IDENTICAL exploit; assert 401/403 +
             true_state unchanged + no lie (deterministic, verify.py)
  RESTORE -> flip back to the clean, pre-patch vulnerable state   (restore.py)

Every step is mapped to the contract reducers (recordFinding / recordExploitRun
/ recordPatchAttempt / updateDeviceStatus / logEvent) via a small EventSink so
the output lines up 1:1 with Dev 3's SpacetimeDB write-path — the live
orchestrator (Dev 1) swaps this EventSink for the real RealtimeBackend.

Usage:
  python security/loop.py                 # full loop, human-readable transcript
  python security/loop.py --json          # also print the machine report
  python security/loop.py --port 8071     # pick the device-service port
  python security/loop.py --payload max-pressure
Exit code 0 iff the loop closed (exploit worked, then VERIFY proved it fixed).
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SECURITY_DIR = Path(__file__).resolve().parent
REPO_ROOT = SECURITY_DIR.parent
DEVICE_SERVICE_APP = REPO_ROOT / "device-service" / "app.py"

# Make the sibling stage modules importable (ground/, scan/, deliver, verify,
# generate/, restore) regardless of CWD.
sys.path.insert(0, str(SECURITY_DIR))

from ground.ground import ground  # noqa: E402
from scan.run_scanners import run_scanners  # noqa: E402
from scan.triage import deterministic_triage  # noqa: E402
from generate.exploit import PAYLOADS, generate_dynamic_payload, generate_poc  # noqa: E402
from deliver import deliver_payload, to_wire_body  # noqa: E402
from verify import fetch_device_status_row, verify_patch  # noqa: E402
from restore import restore  # noqa: E402

DEMO_TOKEN = os.environ.get("DEVICE_SERVICE_TOKEN", "prevent-demo-token")


# --------------------------------------------------------------- event sink --

@dataclass
class EventSink:
    """Headless stand-in for Dev 3's RealtimeBackend / SpacetimeDB reducers.
    Each method mirrors a reducer and appends to an append-only log so the run
    maps 1:1 to the real write-path."""

    quiet: bool = False
    events: list[dict[str, Any]] = field(default_factory=list)
    findings: list[dict[str, Any]] = field(default_factory=list)
    exploit_runs: list[dict[str, Any]] = field(default_factory=list)
    patch_attempts: list[dict[str, Any]] = field(default_factory=list)
    device_snapshots: list[dict[str, Any]] = field(default_factory=list)

    def _emit(self, actor: str, text: str) -> None:
        self.events.append({"ts": int(time.time() * 1000), "actor": actor, "text": text})
        if not self.quiet:
            print(f"  [{actor:<9}] {text}")

    def log_event(self, actor: str, text: str) -> None:
        self._emit(actor, text)

    def record_finding(self, finding: dict[str, Any]) -> None:
        self.findings.append(finding)
        self._emit("scan", f"recordFinding {finding['file']}:{finding['line']} ({finding.get('cveRef','')}) real={finding['isTheRealOne']}")

    def record_exploit_run(self, run: dict[str, Any]) -> None:
        self.exploit_runs.append(run)
        self._emit("deliver", f"recordExploitRun success={run['success']} impact={run.get('deviceImpact','')!r}")

    def record_patch_attempt(self, attempt: dict[str, Any]) -> None:
        self.patch_attempts.append(attempt)
        self._emit("patch", f"recordPatchAttempt {attempt.get('diffRef','')}")

    def update_device_status(self, row: dict[str, Any], note: str) -> None:
        self.device_snapshots.append({"note": note, "row": row})
        self._emit(
            "device",
            f"{note}: fan={'ON' if row['fanOn'] else 'OFF'} "
            f"true={row['trueHr']}/{row['trueSpo2']} reported={row['reportedHr']}/{row['reportedSpo2']} "
            f"alarm={'ON' if row['alarmActive'] else 'OFF'} compromised={row['compromised']}",
        )


# ------------------------------------------------------------- service mgmt --

def _port_free(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((host, port)) != 0


class DeviceService:
    """Launch/stop the device-service subprocess in vulnerable or patched mode,
    sharing one source-of-truth row file so the verifier/sim read one row."""

    def __init__(self, *, port: int, row_file: Path, log_dir: Path, host: str = "127.0.0.1"):
        self.port = port
        self.host = host
        self.row_file = row_file
        self.log_dir = log_dir
        self.base_url = f"http://{host}:{port}"
        self.proc: subprocess.Popen[Any] | None = None
        self.mode: str | None = None

    def start(self, *, patched: bool) -> None:
        self.stop()
        env = dict(os.environ)
        env.update(
            {
                "DEVICE_SERVICE_HOST": self.host,
                "DEVICE_SERVICE_PORT": str(self.port),
                "PREVENT_DEVICE_ROW_FILE": str(self.row_file),
                "DEVICE_SERVICE_PATCHED": "1" if patched else "0",
                "DEVICE_SERVICE_TOKEN": DEMO_TOKEN if patched else "",
            }
        )
        self.mode = "patched" if patched else "vulnerable"
        log_path = self.log_dir / f"device-service.{self.mode}.log"
        logf = open(log_path, "w", encoding="utf-8")  # noqa: SIM115 - closed in stop()
        self._logf = logf
        self.proc = subprocess.Popen(
            [sys.executable, str(DEVICE_SERVICE_APP)],
            cwd=str(DEVICE_SERVICE_APP.parent),
            env=env,
            stdout=logf,
            stderr=subprocess.STDOUT,
        )
        self._wait_ready()

    def _wait_ready(self, timeout: float = 15.0) -> None:
        import requests

        deadline = time.time() + timeout
        last_exc: Exception | None = None
        while time.time() < deadline:
            if self.proc and self.proc.poll() is not None:
                raise RuntimeError(f"device-service ({self.mode}) exited early; see {self.log_dir}")
            try:
                requests.get(f"{self.base_url}/device/status", timeout=1.0).raise_for_status()
                return
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                time.sleep(0.15)
        raise RuntimeError(f"device-service ({self.mode}) not ready in {timeout}s: {last_exc}")

    def stop(self) -> None:
        if self.proc is not None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
            self.proc = None
        logf = getattr(self, "_logf", None)
        if logf is not None:
            logf.close()
            self._logf = None


# -------------------------------------------------------------------- loop ---

class LoopError(RuntimeError):
    pass


def run_loop(
    *,
    port: int = 8071,
    payload_id: str = "stop-breathing",
    goal: str | None = None,
    quiet: bool = False,
    run_dir: Path | None = None,
) -> dict[str, Any]:
    if not _port_free(port):
        raise LoopError(
            f"port {port} is already in use (on macOS, :5000 is AirPlay — use 8071). "
            "Pick a free --port."
        )
    run_dir = run_dir or (SECURITY_DIR / ".runs" / time.strftime("%Y%m%d-%H%M%S"))
    run_dir.mkdir(parents=True, exist_ok=True)
    row_file = run_dir / "device_row.json"

    sink = EventSink(quiet=quiet)
    svc = DeviceService(port=port, row_file=row_file, log_dir=run_dir)
    report: dict[str, Any] = {"ok": False, "stages": {}, "runDir": str(run_dir)}

    def banner(name: str) -> None:
        if not quiet:
            print(f"\n=== {name} ===")

    try:
        # --- GROUND -----------------------------------------------------------
        banner("GROUND")
        card = ground()
        scores = ", ".join(f"{v['score']} {v['severity']} ({v['source']})" for v in card["cvss"].values())
        sink.log_event("ground", f"Grounded in {card['cveId']} — CWE {', '.join(card['cwe'])}. CVSS: {scores}.")
        report["stages"]["ground"] = card

        # --- start the VULNERABLE service ------------------------------------
        svc.start(patched=False)
        sink.log_event("orchestrator", f"device-service up (vulnerable) at {svc.base_url}")
        sink.update_device_status(fetch_device_status_row(base_url=svc.base_url), "baseline (healthy)")

        # --- SCAN -------------------------------------------------------------
        banner("SCAN")
        scans = run_scanners()
        sink.log_event(
            "scan",
            f"SemGrep: {len(scans['semgrep'])} finding(s); Bandit: {len(scans['bandit'])} finding(s) "
            f"({', '.join(sorted({f['ruleId'] for f in scans['bandit']}))}).",
        )
        triage = deterministic_triage(scans["semgrep"], scans["bandit"], base_url=svc.base_url)
        for step in triage["trail"]:
            sink.log_event(step["actor"], step["text"])
        chosen = triage["chosen"]
        if chosen is None:
            raise LoopError("SCAN did not confirm an exploitable finding.")
        sink.record_finding(chosen)
        report["stages"]["scan"] = {
            "selfCorrected": triage["selfCorrected"],
            "chosen": chosen,
            "considered": triage["considered"],
            "semgrepCount": len(scans["semgrep"]),
            "banditCount": len(scans["bandit"]),
        }
        if not triage["selfCorrected"]:
            sink.log_event("scan", "WARNING: expected a self-correction beat but none occurred.")

        # --- GENERATE ---------------------------------------------------------
        banner("GENERATE")
        if goal:
            # DYNAMIC: the model AUTHORS the executable command for this goal.
            dyn = generate_dynamic_payload(goal, chosen, base_url=svc.base_url)
            command_to_fire = dyn["command"]
            payload_ref = f"dynamic:{goal[:48]}"
            poc_model = dyn["modelId"]
            sink.log_event("generate", f"Payload AUTHORED by {dyn['source']} ({dyn['modelId']}) for goal: {goal!r}")
            sink.log_event("generate", f"  command: {json.dumps(command_to_fire)}  |  {dyn['rationale']}")
            report["stages"]["generate"] = {"mode": "dynamic", "goal": goal, "dynamic": dyn}
        else:
            poc = generate_poc(payload_id, chosen)
            payload = PAYLOADS[next(c for c, p in PAYLOADS.items() if p["id"] == payload_id)]
            command_to_fire = payload["command"]
            payload_ref = payload_id
            poc_model = poc["modelId"]
            sink.log_event("generate", f"PoC drafted via {poc['source']} (model={poc['modelId']}).")
            if not quiet:
                print(f"      PoC: {poc['pocText'][:160]}{'...' if len(poc['pocText'])>160 else ''}")
            report["stages"]["generate"] = {"mode": "preset", "poc": poc, "payload": payload}

        # --- DELIVER (the kill) ----------------------------------------------
        banner("DELIVER")
        before = fetch_device_status_row(base_url=svc.base_url)
        result = deliver_payload(command_to_fire, base_url=svc.base_url)
        sink.log_event(
            "deliver",
            f"Unauthenticated POST /device/command {json.dumps(to_wire_body(command_to_fire))} "
            f"-> HTTP {result['statusCode']}.",
        )
        after = fetch_device_status_row(base_url=svc.base_url)
        sink.update_device_status(after, "after exploit")
        lying = (
            after["reportedHr"] != after["trueHr"]
            or after["reportedSpo2"] != after["trueSpo2"]
            or (not after["fanOn"] and not after["alarmActive"])
        )
        fan_stopped = before["fanOn"] and not after["fanOn"]
        action = command_to_fire["action"]
        if fan_stopped:
            impact = (
                f"fan STOPPED; true vitals {after['trueHr']}/{after['trueSpo2']} but device reports "
                f"{after['reportedHr']}/{after['reportedSpo2']} and alarm is "
                f"{'OFF (silent)' if not after['alarmActive'] else 'ON'} — the device is LYING."
            )
        elif action == "set_rate":
            impact = (
                f"unauthenticated set_rate accepted (rate={command_to_fire.get('rate')}); "
                "no auth required — attacker drives the device (CWE-306 over-pressure)."
            )
        else:
            impact = (
                f"unauthenticated {action} accepted; reported {after['reportedHr']}/{after['reportedSpo2']} "
                f"vs true {after['trueHr']}/{after['trueSpo2']}" + (" — LYING." if lying else ".")
            )
        # The CWE-306 compromise, invariant across payloads: an unauthenticated
        # state-changing command was ACCEPTED when it should have required auth.
        exploit_worked = result["statusCode"] == 200
        sink.record_exploit_run(
            {
                "findingId": chosen.get("id", 0),
                "modelId": poc_model,
                "payloadRef": payload_ref,
                "deliveredAt": int(time.time() * 1000),
                "deviceImpact": impact,
                "success": exploit_worked,
            }
        )
        report["stages"]["deliver"] = {"httpStatus": result["statusCode"], "impact": impact, "exploitWorked": exploit_worked, "row": after}
        if not exploit_worked:
            raise LoopError(f"exploit did not compromise the vulnerable service (HTTP {result['statusCode']}).")

        # --- PATCH (deploy the fix; stands in for Factory Droid's diff) -------
        banner("PATCH")
        sink.log_event("patch", "Deploying patched device-service: bearer-token required on POST /device/command; untrusted reported_overrides ignored.")
        svc.start(patched=True)
        sink.record_patch_attempt(
            {
                "findingId": chosen.get("id", 0),
                "diffRef": "patched-reference-handler (DEVICE_SERVICE_PATCHED=1)",
                "droidSession": "dev2-headless",
                "humanApproved": True,  # the live loop gates this on a real click (Dev 1)
                "appliedAt": int(time.time() * 1000),
            }
        )
        sink.log_event("human_gate", "APPROVE & DEPLOY (headless loop auto-approves; the live demo waits for a real click).")

        # --- VERIFY (re-send byte-identical exploit; must now fail) ----------
        banner("VERIFY")
        v_before = fetch_device_status_row(base_url=svc.base_url)
        outcome = verify_patch(command_to_fire, base_url=svc.base_url, status_before=v_before)
        for label, key in (
            ("status is 401/403", "statusCheckPassed"),
            ("true_state unchanged", "trueStateUnchangedPassed"),
            ("reported == true (no lie)", "reportedMatchesTruePassed"),
        ):
            sink.log_event("verify", f"[{'PASS' if outcome[key] else 'FAIL'}] {label}")
        sink.log_event("verify", f"re-ran byte-identical exploit -> HTTP {outcome['statusCode']}; {outcome['detail']}")
        report["stages"]["verify"] = outcome
        if not outcome["passed"]:
            raise LoopError("VERIFY failed — the patch did not close the hole.")
        # The exploit no longer works: record success=false on the original finding.
        sink.record_exploit_run(
            {
                "findingId": chosen.get("id", 0),
                "modelId": poc_model,
                "payloadRef": payload_ref,
                "deliveredAt": int(time.time() * 1000),
                "deviceImpact": "re-run blocked by auth; true_state intact; no lie applied",
                "success": False,
            }
        )
        sink.update_device_status(fetch_device_status_row(base_url=svc.base_url), "after verify (recovered, patched)")

        # --- RESTORE (back to clean, pre-patch state for the next judge) -----
        banner("RESTORE")
        svc.start(patched=False)  # pre-patch (vulnerable) state, reached by restart
        restore_result = restore(base_url=svc.base_url, revert_git=False, repo_root=REPO_ROOT)
        sink.log_event("restore", f"Reverted to pre-patch vulnerable state + reset healthy ({restore_result['device'].get('ok', False)}).")
        sink.update_device_status(fetch_device_status_row(base_url=svc.base_url), "restored (healthy, pre-patch)")
        report["stages"]["restore"] = restore_result

        report["ok"] = True
    finally:
        svc.stop()
        report["events"] = sink.events
        report["findings"] = sink.findings
        report["exploitRuns"] = sink.exploit_runs
        report["patchAttempts"] = sink.patch_attempts
        report["deviceSnapshots"] = sink.device_snapshots
        (run_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    return report


def _print_receipt(report: dict[str, Any]) -> None:
    g = report["stages"].get("ground", {})
    s = report["stages"].get("scan", {})
    d = report["stages"].get("deliver", {})
    v = report["stages"].get("verify", {})
    print("\n" + "=" * 64)
    print(" PreVent — FDA §524B-style run receipt")
    print("=" * 64)
    print(f" Grounding CVE : {g.get('cveId','?')}  (CWE {', '.join(g.get('cwe', []))})")
    if s.get("chosen"):
        c = s["chosen"]
        print(f" Finding       : {c['scanner']} {c.get('ruleId','')} {c['file']}:{c['line']} (CWE-306)")
    print(f" Self-correct  : {'yes (caught a wrong first pick)' if s.get('selfCorrected') else 'no'}")
    gen = report["stages"].get("generate", {})
    if gen.get("mode") == "dynamic":
        dyn = gen.get("dynamic", {})
        print(f" Payload       : AUTHORED live by {dyn.get('source','?')} for goal: {gen.get('goal','')!r}")
        print(f"                 -> {json.dumps(dyn.get('command', {}))}")
    elif gen.get("mode") == "preset":
        print(f" Payload       : preset ({gen.get('poc',{}).get('source','?')})")
    print(f" Exploit       : {'control+integrity compromise' if d.get('exploitWorked') else 'did not compromise'}")
    print(f" Verify        : {'PASS — re-run blocked (401/403), state intact, no lie' if v.get('passed') else 'FAIL'}")
    print(f" Loop closed   : {'YES' if report.get('ok') else 'NO'}")
    print(f" Artifacts     : {report.get('runDir','')}")
    print("=" * 64)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="PreVent headless security loop (Dev 2).")
    ap.add_argument("--port", type=int, default=int(os.environ.get("DEVICE_SERVICE_PORT", "8071")))
    ap.add_argument("--payload", default="stop-breathing", choices=[p["id"] for p in PAYLOADS.values()])
    ap.add_argument("--goal", help="attacker goal in plain English -> the model AUTHORS the payload dynamically "
                                    "(overrides --payload; falls back to a preset if no provider/key)")
    ap.add_argument("--json", action="store_true", help="print the machine-readable report too")
    ap.add_argument("--quiet", action="store_true", help="suppress the step-by-step transcript")
    args = ap.parse_args(argv)

    try:
        report = run_loop(port=args.port, payload_id=args.payload, goal=args.goal, quiet=args.quiet)
    except LoopError as exc:
        print(f"\n[loop] FAILED: {exc}", file=sys.stderr)
        return 1

    _print_receipt(report)
    if args.json:
        print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
