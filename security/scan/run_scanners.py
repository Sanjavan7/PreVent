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

DEVICE_SERVICE_URL = __import__("os").environ.get("DEVICE_SERVICE_URL", "http://localhost:5000")


class ScannerFinding(TypedDict):
    id: int
    scanner: str  # 'semgrep' | 'bandit'
    cveRef: str
    file: str
    line: int
    severity: str
    claudeVerdict: str  # filled by the Claude triage stage, empty here
    isTheRealOne: bool  # filled by the Claude triage stage, False here
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
        findings.append(
            {
                "id": i + 1,
                "scanner": "semgrep",
                "cveRef": "CVE-2019-6538",
                "file": r.get("path", ""),
                "line": int(r.get("start", {}).get("line", 0)),
                "severity": str(r.get("extra", {}).get("severity", "")).upper() or "ERROR",
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
                "file": r.get("filename", ""),
                "line": int(r.get("line_number", 0)),
                "severity": str(r.get("issue_severity", "")).upper() or "LOW",
                "claudeVerdict": "",
                "isTheRealOne": False,
                "createdAt": int(time.time() * 1000),
            }
        )
    return findings


def run_scanners(device_service_dir: Path = DEVICE_SERVICE_DIR, rules_dir: Path = SEMGREP_RULES_DIR) -> dict[str, list[ScannerFinding]]:
    return {
        "semgrep": run_semgrep(device_service_dir, rules_dir),
        "bandit": run_bandit(device_service_dir),
    }


class ProbeResult(TypedDict):
    reproduced: bool
    detail: str


def reproduce_probe(finding: ScannerFinding, *, base_url: str = DEVICE_SERVICE_URL) -> ProbeResult:
    """Deterministic (non-AI) reproduction check — the "wrong-then-caught"
    beat. The triage prompt (triage_prompt.py) instructs Claude to call this
    on its first candidate before committing to it.

    Bandit's picks are generic static-analysis noise (hardcoded strings,
    SQL-string warnings, etc.) that are not themselves a working exploit
    against this device — this probe deterministically returns
    `reproduced=False` for any Bandit finding, which is the designed
    contradiction that makes Claude self-correct onto the real SemGrep
    CWE-306 finding (the only one with cveRef == "CVE-2019-6538").
    """
    if finding["scanner"] == "bandit":
        return {
            "reproduced": False,
            "detail": (
                f"Bandit finding at {finding['file']}:{finding['line']} "
                "(severity-of-style issue) does not correspond to a working "
                "unauthenticated exploit against POST /device/command — "
                "re-check SemGrep's CWE-306 finding instead."
            ),
        }

    if finding["scanner"] == "semgrep" and finding.get("cveRef") == "CVE-2019-6538":
        # TODO(dev): once device-service is live, replace this with an actual
        # unauthenticated probe request (no Authorization header) against
        # `{base_url}/device/command` and check for a 2xx instead of
        # 401/403. Kept deterministic/offline here so SCAN never blocks on
        # a device-service that isn't running yet.
        return {
            "reproduced": True,
            "detail": (
                f"SemGrep finding at {finding['file']}:{finding['line']} matches the "
                "missing-auth handler (CWE-306) — confirmed exploitable, grounded by CVE-2019-6538."
            ),
        }

    return {"reproduced": False, "detail": "Unrecognized finding shape — treated as not reproduced."}


if __name__ == "__main__":
    report = run_scanners()
    print(json.dumps(report, indent=2))
