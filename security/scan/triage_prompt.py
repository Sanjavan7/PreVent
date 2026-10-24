"""SCAN stage — Claude triage prompt — PreVent security pipeline (Dev 2).

Pure prompt-text module: no network calls, no state. Dev 1's stage runner
(`agents/src/stages/runStage.ts`) runs this as the SCAN stage (model:
CLAUDE_MODELS.reasoning / Opus, tools Read/Grep/Bash, with
`security/scan/run_scanners.py` invoked via the Bash tool and
`reproduce_probe()` as the deterministic check-your-work step).

This module supplies:
  - SYSTEM_PROMPT        — the triage agent's role + the rehearsed
                            "wrong-then-caught" self-correction behavior.
  - build_user_prompt()  — formats the two scanner JSON reports into the
                            per-run user turn.
  - TRIAGE_OUTPUT_SCHEMA — the JSON-schema `runStage(..., schema)` should
                            validate the final `recordFinding(...)` call
                            against (subset of contracts/src/types.ts `Finding`).

Run directly to preview the default prompt on sample data:
    python security/scan/triage_prompt.py
"""

from __future__ import annotations

import json
from typing import Any

SYSTEM_PROMPT = """You are the SCAN triage agent for PreVent, an autonomous \
medical-device security pipeline (Cal Hacks 13.0).

You are given two JSON scanner reports over `device-service/` — one from \
SemGrep (a custom CWE-306 "missing authentication on a route handler" rule) \
and one from Bandit (generic Python static analysis: hardcoded secrets, \
SQL-string concatenation, etc.). Exactly one of the candidate findings is \
the real, exploitable vulnerability; the rest are noise.

Work in this order, out loud, and do not skip steps:
1. Read both JSON reports (Read tool).
2. Pick an initial candidate finding. Bandit's output is deliberately \
   noisy here — it is reasonable to start by looking at its top-severity \
   hit, but it is NOT the real exploitable issue in this codebase.
3. Call `reproduce_probe(finding)` (security/scan/run_scanners.py, via the \
   Bash tool) on your candidate BEFORE concluding anything. This is a \
   deterministic, non-AI check — trust its `reproduced` result over your \
   own prior guess.
4. If `reproduced` is false: say so plainly (this is the point where you \
   are wrong and the probe catches it), discard that candidate, and move \
   to the SemGrep finding whose `cveRef` is `CVE-2019-6538` \
   (CWE-306 — missing authentication). Call `reproduce_probe()` on it too \
   and confirm it returns `reproduced: true`.
5. Only once a finding's probe returns `reproduced: true` do you call \
   `recordFinding(...)` with that finding's full shape, `isTheRealOne: \
   true`, and a one-paragraph `claudeVerdict` explaining why it is \
   real and exploitable (unauthenticated POST to a state-changing route).
6. For every other candidate you considered, you may also record it with \
   `isTheRealOne: false` so the trail of reasoning is visible.

Do not fabricate a probe result — always call the real `reproduce_probe()` \
function and quote its `detail` field in your reasoning. Never claim a \
finding is confirmed before its probe has actually returned \
`reproduced: true`.
"""


def build_user_prompt(semgrep_findings: list[dict[str, Any]], bandit_findings: list[dict[str, Any]]) -> str:
    return (
        "SemGrep report (device-service):\n"
        f"{json.dumps(semgrep_findings, indent=2)}\n\n"
        "Bandit report (device-service):\n"
        f"{json.dumps(bandit_findings, indent=2)}\n\n"
        "Triage these findings per your instructions. Run "
        "`python security/scan/run_scanners.py` first if you need to "
        "regenerate the reports, and call `reproduce_probe(...)` from the "
        "same module before recording any finding as real."
    )


# Subset of contracts/src/types.ts `Finding` that the triage agent's final
# `recordFinding(...)` tool call must match. `id`/`createdAt` are assigned by
# the DB layer (Dev 1/Dev 3), not by Claude.
TRIAGE_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["scanner", "cveRef", "file", "line", "severity", "claudeVerdict", "isTheRealOne"],
    "properties": {
        "scanner": {"type": "string", "enum": ["semgrep", "bandit"]},
        "cveRef": {"type": "string"},
        "file": {"type": "string"},
        "line": {"type": "integer"},
        "severity": {"type": "string"},
        "claudeVerdict": {"type": "string"},
        "isTheRealOne": {"type": "boolean"},
    },
}

# TODO(dev): Dev 1's runStage currently lives in TypeScript
# (agents/src/stages/runStage.ts). Until there is a cross-language prompt
# loader, either (a) port this literal text into the TS stage module, or
# (b) have the stage shell out to `python -c "from security.scan.triage_prompt
# import SYSTEM_PROMPT; print(SYSTEM_PROMPT)"`. Keeping the text here (not
# duplicated ad hoc in TS) is what makes this the single source of truth.

if __name__ == "__main__":
    sample_semgrep = [
        {
            "id": 1,
            "scanner": "semgrep",
            "cveRef": "CVE-2019-6538",
            "file": "app.py",
            "line": 42,
            "severity": "ERROR",
            "claudeVerdict": "",
            "isTheRealOne": False,
            "createdAt": 0,
        }
    ]
    sample_bandit = [
        {
            "id": 1,
            "scanner": "bandit",
            "cveRef": "",
            "file": "app.py",
            "line": 12,
            "severity": "LOW",
            "claudeVerdict": "",
            "isTheRealOne": False,
            "createdAt": 0,
        }
    ]
    print(SYSTEM_PROMPT)
    print("---")
    print(build_user_prompt(sample_semgrep, sample_bandit))
