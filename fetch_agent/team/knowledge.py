"""Fixed answers about CWE-306 and the PreVent evidence map. No model calls."""

from __future__ import annotations

FACTS: list[tuple[tuple[str, ...], str]] = [
    (
        ("cwe-306", "cwe 306", "missing authentication", "missing-authentication"),
        "CWE-306 is missing authentication for a critical function. In this demo that function is the device command route: an unauthenticated POST can be accepted while the device's own status still says healthy.",
    ),
    (
        ("cve-2019-6538", "2019-6538", "ground"),
        "The security loop's GROUND stage records CVE-2019-6538 as its missing-authentication example and pairs it with CWE-306. This agent does not fetch NVD itself.",
    ),
    (
        ("524", "524b", "fda"),
        "The signed record is evidence that can feed an FDA 524B packet: CVE, finding, exploit proof, vetted fix, and a byte-identical re-verify. It is not an FDA certification.",
    ),
    (
        ("stage", "artifact", "sbom", "what does"),
        "GROUND emits the CVE id. SCAN emits findings. GENERATE emits the proof request. DELIVER emits the live HTTP status. The human gate emits approve or reject. VERIFY emits the replay status (401 or 403 when the fix holds). The Evidence-Clerk signs the manifest and the CycloneDX SBOM/VEX.",
    ),
    (
        ("honest", "guardrail", "autonomous"),
        "Say 'applies a vetted fix', not 'autonomous patch'. Say the record feeds a 524B submission, not that the product is FDA-certified.",
    ),
]


def answer(text: str) -> str:
    low = text.lower()
    heard = "Received the patient-risk note. " if "prior from patient" in low else ""
    hits = [body for keys, body in FACTS if any(key in low for key in keys)]
    if not hits:
        return heard + (
            "I only answer from the PreVent evidence map. Ask about CWE-306, "
            "CVE-2019-6538, the stage artifacts, or what feeds a 524B packet."
        )
    return heard + "\n\n".join(hits)
