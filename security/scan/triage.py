"""SCAN stage — deterministic triage — PreVent security pipeline (Dev 2).

The LLM path (triage_prompt.py, run via Dev 1's Agent-SDK `runStage`, Opus) is
the *visible-reasoning* version of this for the live demo. This module is the
deterministic, offline, key-free equivalent: it reproduces the SAME scripted
"wrong-then-caught" beat without an Anthropic key, so the headless security loop
and the test suite run anywhere.

The beat (rehearsed code path, not emergent):
  1. Start with the scariest-looking Bandit finding (its top-severity hit).
  2. Run the deterministic `reproduce_probe()` on it -> it does NOT reproduce
     as a working unauthenticated exploit.
  3. Record the contradiction (this is the point where we were wrong and the
     probe caught it), then move to the SemGrep CWE-306 finding.
  4. `reproduce_probe()` on the SemGrep finding -> reproduces -> that is the
     real one.

Returns the chosen finding plus a step-by-step `trail` (for event_log / the
dashboard) and a `selfCorrected` flag.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, TypedDict

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_scanners import ScannerFinding, reproduce_probe  # noqa: E402

_SEVERITY_RANK = {"HIGH": 3, "ERROR": 3, "MEDIUM": 2, "WARNING": 2, "LOW": 1, "INFO": 0}


class TriageStep(TypedDict):
    actor: str
    text: str


class TriageResult(TypedDict):
    chosen: ScannerFinding | None  # the real finding, isTheRealOne=True
    considered: list[ScannerFinding]  # every candidate, verdicts filled in
    selfCorrected: bool
    trail: list[TriageStep]


def _rank(finding: ScannerFinding) -> int:
    return _SEVERITY_RANK.get(str(finding.get("severity", "")).upper(), 0)


def deterministic_triage(
    semgrep_findings: list[ScannerFinding],
    bandit_findings: list[ScannerFinding],
    *,
    base_url: str,
) -> TriageResult:
    """Pick the one real exploitable finding, self-correcting through the
    Bandit noise exactly once. `base_url` lets the probe run live against a
    running device-service (falls back to the offline verdict if unreachable)."""
    trail: list[TriageStep] = []
    considered: list[ScannerFinding] = []
    self_corrected = False

    def note(text: str) -> None:
        trail.append({"actor": "scan", "text": text})

    note(
        f"Two scanners reported: SemGrep {len(semgrep_findings)} finding(s), "
        f"Bandit {len(bandit_findings)} finding(s). Exactly one is the real "
        "exploitable flaw; the rest are noise."
    )

    # 1) Tempting first candidate: Bandit's highest-severity hit.
    bandit_sorted = sorted(bandit_findings, key=_rank, reverse=True)
    if bandit_sorted:
        candidate = bandit_sorted[0]
        note(
            f"Initial candidate: Bandit {candidate.get('ruleId', '?')} "
            f"({candidate.get('severity', '?')}) at {candidate['file']}:{candidate['line']} — "
            f"\"{candidate.get('message', '')}\". Highest severity, so start here."
        )
        probe = reproduce_probe(candidate, base_url=base_url)
        candidate["claudeVerdict"] = f"Probed first; reproduce_probe: {probe['detail']}"
        candidate["isTheRealOne"] = False
        considered.append(candidate)
        if not probe["reproduced"]:
            self_corrected = True
            note(
                f"reproduce_probe on the Bandit {candidate.get('ruleId', '?')} finding "
                f"returned reproduced=false. {probe['detail']} I was wrong to start here — "
                "discarding it and re-checking the SemGrep CWE-306 finding."
            )
        else:  # pragma: no cover - the designed decoy never reproduces
            note("Unexpected: Bandit candidate reproduced. Still cross-checking SemGrep.")

    # 2) The real one: the SemGrep CWE-306 finding (cveRef == CVE-2019-6538).
    semgrep_cwe306 = next(
        (f for f in semgrep_findings if f.get("cveRef") == "CVE-2019-6538"),
        semgrep_findings[0] if semgrep_findings else None,
    )

    if semgrep_cwe306 is None:
        note("No SemGrep CWE-306 finding present — cannot confirm a real exploitable flaw.")
        return {"chosen": None, "considered": considered, "selfCorrected": self_corrected, "trail": trail}

    probe = reproduce_probe(semgrep_cwe306, base_url=base_url)
    note(
        f"reproduce_probe on SemGrep {semgrep_cwe306.get('ruleId', 'flask-missing-auth-decorator')} "
        f"at {semgrep_cwe306['file']}:{semgrep_cwe306['line']}: {probe['detail']}"
    )

    if not probe["reproduced"]:
        semgrep_cwe306["isTheRealOne"] = False
        semgrep_cwe306["claudeVerdict"] = f"Did not reproduce: {probe['detail']}"
        considered.append(semgrep_cwe306)
        note("SemGrep finding did not reproduce either — nothing confirmed exploitable right now.")
        return {"chosen": None, "considered": considered, "selfCorrected": self_corrected, "trail": trail}

    semgrep_cwe306["isTheRealOne"] = True
    semgrep_cwe306["claudeVerdict"] = (
        "Missing authentication on the state-changing POST /device/command handler "
        "(CWE-306). An unauthenticated caller can issue device commands directly, and "
        f"a live reproduce probe confirmed it{'' if probe['live'] else ' (static, offline)'}. "
        "Grounded by CVE-2019-6538. This is the real, exploitable flaw — not the Bandit "
        "code-smell noise."
    )
    considered.append(semgrep_cwe306)
    note(
        "Confirmed: SemGrep CWE-306 missing-auth on POST /device/command is the real "
        "exploitable finding. Recording it as the real one."
    )
    return {
        "chosen": semgrep_cwe306,
        "considered": considered,
        "selfCorrected": self_corrected,
        "trail": trail,
    }


if __name__ == "__main__":
    # Offline preview against the scaffold's sample shapes.
    sample_semgrep: list[ScannerFinding] = [
        {
            "id": 1, "scanner": "semgrep", "cveRef": "CVE-2019-6538", "file": "app.py",
            "line": 301, "severity": "ERROR", "ruleId": "flask-missing-auth-decorator",
            "message": "missing auth on state-changing route", "claudeVerdict": "",
            "isTheRealOne": False, "createdAt": 0,
        }
    ]
    sample_bandit: list[ScannerFinding] = [
        {
            "id": 1, "scanner": "bandit", "cveRef": "", "file": "diagnostics.py",
            "line": 26, "severity": "HIGH", "ruleId": "B324", "message": "Use of weak MD5 hash",
            "claudeVerdict": "", "isTheRealOne": False, "createdAt": 0,
        }
    ]
    result = deterministic_triage(sample_semgrep, sample_bandit, base_url="http://127.0.0.1:1")  # unreachable -> offline
    print(json.dumps(result, indent=2))
