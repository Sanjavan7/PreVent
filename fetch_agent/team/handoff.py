"""One ward case, passed agent to agent.

Bench note -> patient-risk -> CVE map -> patch review.
PreVent-Security and the Release Captain are not called from this chain.
"""

from __future__ import annotations

import json

CHAIN = ("bench", "patient", "knowledge", "review")

_CASE_WORDS = ("run the case", "case conference", "full picture")


def case_plan(text: str) -> tuple[int, str] | None:
    """Return (index of the next specialist, note already in hand), or None.

    Index 1 with a note means the bench already reported, so the chain starts
    at patient-risk. Index 0 means the ward still has to ask the bench.
    """
    if text.startswith("CASE-START"):
        body = text.split("\n", 1)[1].strip() if "\n" in text else ""
        return 1, body
    low = text.lower()
    if "simulate fault" in low:
        return 1, (
            "Simulated bedside report, not a live serial reading: "
            "fan stopped, monitor still reporting healthy."
        )
    if any(phrase in low for phrase in _CASE_WORDS):
        return 0, ""
    return None


def prompt_for(step: str, prior: str) -> str:
    """Question for this specialist, with the previous agent's note attached."""
    if step == "bench":
        return "read the bench"
    if step == "patient":
        return f"Prior from bench:\n{prior}\n\nExplain the patient risk."
    if step == "knowledge":
        return (
            f"Prior from patient:\n{prior}\n\n"
            "What is CWE-306 and which stage emits which artifact?"
        )
    if step == "review":
        return (
            f"Prior from knowledge:\n{prior}\n\n"
            "Review the vetted fix: require a bearer token and return 401 "
            "for the same unauthenticated request."
        )
    raise KeyError(step)


def load_notes(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        notes = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return [item for item in notes if isinstance(item, str)]


def dump_notes(notes: list[str]) -> str:
    return json.dumps(notes)


def final_report(notes: list[str]) -> str:
    body = "\n\n".join(notes)
    return (
        "Ward case, passed bench → patient-risk → CVE knowledge → patch review.\n\n"
        f"{body}\n\n"
        "PreVent-Security was not called, and nothing was shipped. "
        "Say `audit the device-service` to run the security loop, or `ship the build` "
        "to ask the Release Captain."
    )
