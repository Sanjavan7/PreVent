"""Keyword routing for the ward front door. Pure function, no network."""

from __future__ import annotations

from .handoff import case_plan


def route(text: str) -> tuple[str, str, str]:
    """Return (kind, peer_key, body).

    kind is 'reply' or 'delegate'. peer_key is empty for a direct reply.
    """
    low = text.lower().strip()
    if not low or low in {"help", "?", "hi", "hello"}:
        return "reply", "", (
            "I'm the Ward Orchestrator. I don't run the audit myself. Ask me to:\n"
            "- audit the device-service\n"
            "- ship the build\n"
            "- review the vetted fix\n"
            "- explain the patient risk\n"
            "- what is CWE-306\n"
            "- run the case (bench passes a note to patient-risk, then knowledge, then review)\n"
            "- read the bench\n"
            "- sign the evidence export"
        )
    if case_plan(text) is not None:
        return "case", "", text
    if any(word in low for word in ("notary", "evidence clerk", "sign the", "compliance export", "bundle")):
        return "delegate", "evidence", text
    if any(word in low for word in ("review", "second opinion", "patch reviewer")):
        return "delegate", "review", text
    if any(word in low for word in ("ship", "release", "deploy", "go live")):
        return "delegate", "release", text
    if any(word in low for word in ("patient", "vitals", "no air", "lying", "monitor")):
        return "delegate", "patient", text
    if any(word in low for word in ("cwe", "cve", "524", "sbom", "what evidence")):
        return "delegate", "knowledge", text
    if any(word in low for word in ("fan", "bedside", "bench", "telemetry", "sensor")):
        return "delegate", "bench", text
    if any(word in low for word in ("audit", "exploit", "device-service", "device service", "missing auth", "security")):
        return "delegate", "prevent", "Audit the device-service for missing-authentication flaws and prove whether it's exploitable."
    return "reply", "", "I don't have a specialist for that. Say 'help' to see the ward team."
