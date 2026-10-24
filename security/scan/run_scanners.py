"""SCAN stage — scanner runner — PreVent security pipeline (Dev 2).

Runs SemGrep (custom CWE-306 rule) + Bandit over `device-service/`, parses
both JSON reports into `Finding`-shaped dicts (mirrors
contracts/src/types.ts `Finding`, minus `claudeVerdict`/`isTheRealOne`,
which the Claude triage stage fills in — see `triage_prompt.py`), and
exposes the deterministic "wrong-then-caught" probe: a non-AI check that
the Bandit-flagged issue does NOT actually reproduce as an exploit, so the
triage agent can self-correct onto the real SemGrep CWE-306 finding.

Scanner commands (plans/PLAN-DEV2-security-verification.md):
    semgrep scan --config <device-service>/rules --json --metrics off \
        --disable-version-check --quiet <device-service>
    bandit -r <device-service> -f json --exit-zero

Install (NOT via this package's requirements.txt — see security/requirements.txt):
    uv tool install --python 3.13 semgrep==1.182.1
    uv tool install --python 3.13 bandit==1.9.4

Run directly for a quick smoke test (needs device-service/ to exist + both
CLIs on PATH):
    python security/scan/run_scanners.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, TypedDict

SECURITY_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = SECURITY_DIR.parent
# TODO(dev): device-service/ is a SEPARATE package (its own git repo, owned
# by Dev 2's task #1) and is not created by this scaffold. These are the
# paths run_scanners() will look for once it exists.
DEVICE_SERVICE_DIR = REPO_ROOT / "device-service"
SEMGREP_RULES_DIR = DEVICE_SERVICE_DIR / "rules"
# SCAN target #2: the hardware firmware (its own custom Semgrep ruleset).
FIRMWARE_DIR = REPO_ROOT / "firmware"
FIRMWARE_RULES_DIR = FIRMWARE_DIR / "rules"

DEVICE_SERVICE_URL = __import__("os").environ.get("DEVICE_SERVICE_URL", "http://127.0.0.1:8071")


def _rel(p: str) -> str:
    """Make a scanner-reported path repo-root-relative (e.g. device-service/app.py)
    so recorded Finding.file values are stable and readable, not absolute."""
    if not p:
        return p
    try:
        return str(Path(p).resolve().relative_to(REPO_ROOT))
    except ValueError:
        return p


class ScannerFinding(TypedDict):
    id: int
    scanner: str  # 'semgrep' | 'bandit'
    cveRef: str
    file: str
    line: int
    severity: str
    ruleId: str  # semgrep check_id / bandit test_id (B105, B324, ...) — triage context
    message: str  # the scanner's own one-line description — triage context
    claudeVerdict: str  # filled by the triage stage, empty here
    isTheRealOne: bool  # filled by the triage stage, False here
    createdAt: int


def _run_json_cli(cmd: list[str], *, timeout: float = 120.0) -> dict[str, Any] | None:
    """Run a CLI that prints JSON to stdout and return the parsed object, or
    None if the tool isn't installed / the target dir doesn't exist yet."""
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        print(f"[run_scanners] {cmd[0]} not found on PATH — skipping", file=sys.stderr)
        return None
    except subprocess.TimeoutExpired:
        print(f"[run_scanners] {cmd[0]} timed out", file=sys.stderr)
        return None

    stdout = proc.stdout.strip()
    if not stdout:
        print(f"[run_scanners] {cmd[0]} produced no output (stderr: {proc.stderr[:400]!r})", file=sys.stderr)
        return None
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        print(f"[run_scanners] {cmd[0]} output was not JSON", file=sys.stderr)
        return None


def run_semgrep(device_service_dir: Path = DEVICE_SERVICE_DIR, rules_dir: Path = SEMGREP_RULES_DIR) -> list[ScannerFinding]:
    """Runs the custom CWE-306 rule over device-service. Fires only on the
    vulnerable handler (no auth decorator / no `Depends(...)`), silent on
    the patched variant — see rules/missing-auth.yaml (owned by task #1)."""
    if not device_service_dir.exists():
        print(f"[run_scanners] {device_service_dir} does not exist yet — returning []", file=sys.stderr)
        return []

    result = _run_json_cli(
        [
            "semgrep",
            "scan",
            "--config",
            str(rules_dir),
            "--json",
            "--metrics",
            "off",
            "--disable-version-check",
            "--quiet",
            str(device_service_dir),
        ]
    )
    if result is None:
        return []

    findings: list[ScannerFinding] = []
    for i, r in enumerate(result.get("results", [])):
        extra = r.get("extra", {})
        findings.append(
            {
                "id": i + 1,
                "scanner": "semgrep",
                "cveRef": "CVE-2019-6538",
                "file": _rel(r.get("path", "")),
                "line": int(r.get("start", {}).get("line", 0)),
                "severity": str(extra.get("severity", "")).upper() or "ERROR",
                "ruleId": str(r.get("check_id", "")).split(".")[-1],
                "message": " ".join(str(extra.get("message", "")).split())[:200],
                "claudeVerdict": "",
                "isTheRealOne": False,
                "createdAt": int(time.time() * 1000),
            }
        )
    return findings


def run_bandit(device_service_dir: Path = DEVICE_SERVICE_DIR) -> list[ScannerFinding]:
    """Bandit never flags the missing-auth issue (it isn't a Bandit check) —
    its output here is intentionally the noise the triage stage has to see
    through (B201/B105-107/B608 style findings)."""
    if not device_service_dir.exists():
        print(f"[run_scanners] {device_service_dir} does not exist yet — returning []", file=sys.stderr)
        return []

    result = _run_json_cli(["bandit", "-r", str(device_service_dir), "-f", "json", "--exit-zero"])
    if result is None:
        return []

    findings: list[ScannerFinding] = []
    for i, r in enumerate(result.get("results", [])):
        findings.append(
            {
                "id": i + 1,
                "scanner": "bandit",
                "cveRef": "",
                "file": _rel(r.get("filename", "")),
                "line": int(r.get("line_number", 0)),
                "severity": str(r.get("issue_severity", "")).upper() or "LOW",
                "ruleId": str(r.get("test_id", "")),
                "message": " ".join(str(r.get("issue_text", "")).split())[:200],
                "claudeVerdict": "",
                "isTheRealOne": False,
                "createdAt": int(time.time() * 1000),
            }
        )
    return findings


def run_scanners(device_service_dir: Path = DEVICE_SERVICE_DIR, rules_dir: Path = SEMGREP_RULES_DIR) -> dict[str, list[ScannerFinding]]:
    """Back-compat: the server-only, tool-aggregated view used by the classic
    single-vuln loop + the existing tests. The multi-agent pipeline uses
    run_scan_agents() instead."""
    return {
        "semgrep": run_semgrep(device_service_dir, rules_dir),
        "bandit": run_bandit(device_service_dir),
    }


class ScanAgent(TypedDict):
    id: int            # 1..N — stable spawn order (the "agents spawning" beat)
    agentId: str       # e.g. 'semgrep/device-service'
    tool: str          # 'semgrep' | 'bandit'
    target: str        # 'device-service' (server) | 'firmware' (hardware)
    language: str      # what the agent is competent to read
    findings: list[ScannerFinding]


# The scanner fleet: {semgrep, bandit} x {server, firmware} = 4 agents.
# agents != LLMs — each is a deterministic single-purpose recon agent. Bandit is
# a Python linter, so on the C/C++ firmware it is honestly empty (no jurisdiction);
# Semgrep is cross-language and covers both. Each entry is (tool, target, language,
# target_dir, rules_dir|None).
_SCAN_FLEET = [
    ("semgrep", "device-service", "python",         DEVICE_SERVICE_DIR, SEMGREP_RULES_DIR),
    ("bandit",  "device-service", "python",         DEVICE_SERVICE_DIR, None),
    ("semgrep", "firmware",       "generic (c/c++)", FIRMWARE_DIR,       FIRMWARE_RULES_DIR),
    ("bandit",  "firmware",       "python",          FIRMWARE_DIR,       None),
]


def run_scan_agents(*, include_firmware: bool = True) -> dict[str, Any]:
    """Run SCAN as a fleet of independent scanner agents (the "four agents
    spawn" beat). Returns the per-agent breakdown, a globally-id'd flat findings
    list, and tool-aggregated views (semgrep/bandit) for back-compat with
    run_scanners(). Every agent is a real scanner invocation over a real target."""
    fleet = _SCAN_FLEET if include_firmware else _SCAN_FLEET[:2]

    agents: list[ScanAgent] = []
    for i, (tool, target, language, target_dir, rules_dir) in enumerate(fleet, start=1):
        if tool == "semgrep":
            found = run_semgrep(target_dir, rules_dir) if rules_dir else []
        else:
            found = run_bandit(target_dir)
        for f in found:
            f["target"] = target  # tag provenance (server vs hardware)
        agents.append(
            {
                "id": i,
                "agentId": f"{tool}/{target}",
                "tool": tool,
                "target": target,
                "language": language,
                "findings": found,
            }
        )

    flat: list[ScannerFinding] = []
    for a in agents:
        flat.extend(a["findings"])
    for gid, f in enumerate(flat, start=1):
        f["id"] = gid  # globally unique id across all agents (for fan-out mapping)

    return {
        "agents": agents,
        "findings": flat,
        "semgrep": [f for f in flat if f["scanner"] == "semgrep"],
        "bandit": [f for f in flat if f["scanner"] == "bandit"],
    }


class ProbeResult(TypedDict):
    reproduced: bool
    detail: str
    live: bool  # True if an actual HTTP probe ran; False = offline/deterministic


def _live_missing_auth_probe(base_url: str) -> ProbeResult | None:
    """Fire a NON-DESTRUCTIVE unauthenticated command at POST /device/command
    and decide whether missing-auth reproduces. We send `{"action":"resume"}`
    (idempotent — keeps the fan on / vitals healthy) deliberately: SCAN must
    prove the handler accepts unauthenticated mutating commands WITHOUT crashing
    the patient (that dramatic beat belongs to DELIVER, on the judge's press).

      - 200  -> an unauthenticated caller successfully issued a device command
                => missing auth reproduces (the vuln is real).
      - 401/403 -> the handler is guarded (patched) => does NOT reproduce.

    Returns None if device-service is unreachable, so the caller can fall back
    to the deterministic offline verdict and SCAN never blocks.
    """
    try:
        import requests  # local import: SCAN works even if requests is absent offline

        resp = requests.post(
            f"{base_url}/device/command",
            json={"action": "resume"},  # harmless, restores healthy
            timeout=3.0,
        )
    except Exception as exc:  # noqa: BLE001 - unreachable device -> offline fallback
        print(f"[reproduce_probe] {base_url} unreachable ({exc}); using offline verdict", file=sys.stderr)
        return None

    if resp.status_code in (401, 403):
        return {
            "reproduced": False,
            "live": True,
            "detail": (
                f"Unauthenticated POST /device/command returned {resp.status_code} — "
                "the handler enforces auth, so missing-auth does NOT reproduce (patched)."
            ),
        }
    if 200 <= resp.status_code < 300:
        return {
            "reproduced": True,
            "live": True,
            "detail": (
                f"Unauthenticated POST /device/command returned {resp.status_code} with no "
                "Authorization header — an unauthenticated caller issued a device command. "
                "CWE-306 missing authentication confirmed (probed non-destructively with action=resume)."
            ),
        }
    return {
        "reproduced": False,
        "live": True,
        "detail": f"Unauthenticated POST /device/command returned an unexpected {resp.status_code}.",
    }


def reproduce_probe(finding: ScannerFinding, *, base_url: str = DEVICE_SERVICE_URL) -> ProbeResult:
    """The deterministic (non-AI) "reproduce-the-finding" check — the
    wrong-then-caught beat. The triage logic (triage.py) and the triage prompt
    (triage_prompt.py) both call this on a candidate BEFORE committing to it.

    Bandit's picks are generic static-analysis smells (hardcoded strings, weak
    hashes, broad excepts) that are not themselves a working unauthenticated
    exploit against this device, so they deterministically do NOT reproduce —
    the designed contradiction that makes triage self-correct onto the SemGrep
    CWE-306 finding.

    For the SemGrep CWE-306 finding we try a LIVE non-destructive probe against
    a running device-service; offline we fall back to the static verdict so
    SCAN is runnable before the service is up.
    """
    if finding["scanner"] == "bandit":
        return {
            "reproduced": False,
            "live": False,
            "detail": (
                f"Bandit finding {finding.get('severity', '')} at "
                f"{finding['file']}:{finding['line']} is a generic code smell, not a "
                "working unauthenticated exploit against POST /device/command — "
                "re-check SemGrep's CWE-306 finding instead."
            ),
        }

    if finding["scanner"] == "semgrep":
        live = _live_missing_auth_probe(base_url)
        if live is not None:
            return live
        # Offline fallback: trust the static SemGrep match on the command route.
        return {
            "reproduced": True,
            "live": False,
            "detail": (
                f"SemGrep finding at {finding['file']}:{finding['line']} matches the "
                "missing-auth handler (CWE-306). Device-service not reachable for a live "
                "probe; treating the static match as reproduced (offline mode)."
            ),
        }

    return {"reproduced": False, "live": False, "detail": "Unrecognized finding shape — treated as not reproduced."}


if __name__ == "__main__":
    report = run_scanners()
    print(json.dumps(report, indent=2))
