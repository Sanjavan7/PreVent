"""Names, seeds, and Agentverse blurbs for every Fetch agent.

Importing this module does not start an agent and does not touch the security loop.
Peer addresses are taken from the environment when they look like agent addresses,
otherwise they are derived from that agent's seed.
"""

from __future__ import annotations

import os

from uagents_core.identity import Identity

# Load the repo .env the same way the existing agent does, without editing it.
from .. import constants as _constants  # noqa: F401

BADGE = (
    "![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)\n"
    "![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)\n\n"
)


def _clean(value: str | None) -> str:
    text = (value or "").strip().strip('"').strip("'")
    if not text or text.startswith("#"):
        return ""
    return text


def address_for_seed(seed: str) -> str:
    return Identity.from_seed(seed, 0).address


SPECS: list[dict] = [
    {
        "key": "prevent",
        "name_env": "PREVENT_AGENT_NAME",
        "default_name": "PreVent-Security",
        "seed_env": "AGENT_SEED",
        "port_env": "PREVENT_AGENT_PORT",
        "default_port": 8101,
        "address_env": "PREVENT_PEER_ADDRESS",
        "description": "Finds, proves, and with human approval fixes missing-authentication flaws on a networked device service, then re-verifies the same request.",
        "readme": BADGE
        + "# PreVent-Security\n\n"
        "Chat agent for the find → prove → human APPROVE → vetted fix → re-verify loop. "
        "The fix is not sold. Ask it to audit the device-service.\n",
    },
    {
        "key": "release",
        "name_env": "RC_AGENT_NAME",
        "default_name": "Release-Captain",
        "seed_env": "RC_AGENT_SEED",
        "port_env": "RC_AGENT_PORT",
        "default_port": 8102,
        "address_env": "RC_PEER_ADDRESS",
        "description": "Decides ship or block by asking PreVent-Security for a pre-ship gate over the chat protocol.",
        "readme": BADGE
        + "# Release-Captain\n\n"
        "Tell it to ship a build. It delegates the security gate to PreVent and blocks the release when the gate is NO-GO.\n",
    },
    {
        "key": "ward",
        "name_env": "WARD_AGENT_NAME",
        "default_name": "Ward-Orchestrator",
        "seed_env": "WARD_AGENT_SEED",
        "port_env": "WARD_AGENT_PORT",
        "default_port": 8100,
        "address_env": "WARD_PEER_ADDRESS",
        "description": "Front door that routes a ward question to the security, release, review, patient-risk, knowledge, bench, or evidence agent.",
        "readme": BADGE
        + "# Ward-Orchestrator\n\n"
        "One ASI:One conversation for the ward. It forwards the request to the specialist agent and relays the reply. "
        "It does not run the exploit itself.\n",
    },
    {
        "key": "bench",
        "name_env": "BENCH_AGENT_NAME",
        "default_name": "Bench-Monitor",
        "seed_env": "BENCH_AGENT_SEED",
        "port_env": "BENCH_AGENT_PORT",
        "default_port": 8103,
        "address_env": "BENCH_PEER_ADDRESS",
        "description": "Read-only bedside sentinel. Reports fan and monitor disagreement and can ask PreVent to audit. It never opens the serial port.",
        "readme": BADGE
        + "# Bench-Monitor\n\n"
        "Tell it a bedside reading, ask it to read the bench status page, or say `simulate fault`. "
        "A fault report can be forwarded to PreVent-Security. It does not flash hardware or start an attack on the bench server.\n",
    },
    {
        "key": "evidence",
        "name_env": "EVIDENCE_AGENT_NAME",
        "default_name": "Evidence-Clerk",
        "seed_env": "EVIDENCE_AGENT_SEED",
        "port_env": "EVIDENCE_AGENT_PORT",
        "default_port": 8104,
        "address_env": "EVIDENCE_PEER_ADDRESS",
        "description": "Sells the signed evidence export. It signs only a record you paste with a real 401 or 403 re-verify. The safety fix is not for sale.",
        "readme": BADGE
        + "# Evidence-Clerk\n\n"
        "Paste `deliver=200 verify=401 sha256=<hash> run=<id> cve=<id> request=<text>`, then complete the payment request. "
        "The signed manifest is the paid export. This does not apply a fix.\n",
    },
    {
        "key": "patient",
        "name_env": "PATIENT_AGENT_NAME",
        "default_name": "Patient-Risk",
        "seed_env": "PATIENT_AGENT_SEED",
        "port_env": "PATIENT_AGENT_PORT",
        "default_port": 8105,
        "address_env": "PATIENT_PEER_ADDRESS",
        "description": "Explains the demo fact that the ventilator stopped while the monitor still says healthy. Not medical advice.",
        "readme": BADGE
        + "# Patient-Risk\n\n"
        "Restates the instrumented-demo outcome in plain language and stops there. "
        "It does not diagnose, prescribe, or recommend treatment.\n",
    },
    {
        "key": "review",
        "name_env": "REVIEW_AGENT_NAME",
        "default_name": "Patch-Reviewer",
        "seed_env": "REVIEW_AGENT_SEED",
        "port_env": "REVIEW_AGENT_PORT",
        "default_port": 8106,
        "address_env": "REVIEW_PEER_ADDRESS",
        "description": "Read-only review of a proposed device-service fix. Answers REVIEW:GO or REVIEW:NO-GO. It never applies a patch.",
        "readme": BADGE
        + "# Patch-Reviewer\n\n"
        "Send the fix description. GO requires an authentication check that makes the same unauthenticated request return 401 or 403. "
        "Anything that leaves the command route open is NO-GO.\n",
    },
    {
        "key": "knowledge",
        "name_env": "KNOWLEDGE_AGENT_NAME",
        "default_name": "CVE-Knowledge",
        "seed_env": "KNOWLEDGE_AGENT_SEED",
        "port_env": "KNOWLEDGE_AGENT_PORT",
        "default_port": 8107,
        "address_env": "KNOWLEDGE_PEER_ADDRESS",
        "description": "Answers from a fixed map of CWE-306, the pipeline stages, and which artifact each stage emits.",
        "readme": BADGE
        + "# CVE-Knowledge\n\n"
        "Ask what CWE-306 is, which stage emits which artifact, or what feeds a 524B packet. "
        "Unknown questions are refused instead of guessed.\n",
    },
]


def resolve(spec: dict) -> dict | None:
    seed = _clean(os.environ.get(spec["seed_env"]))
    if not seed:
        return None
    port_raw = _clean(os.environ.get(spec["port_env"]))
    port = int(port_raw) if port_raw else int(spec["default_port"])
    name = _clean(os.environ.get(spec["name_env"])) or spec["default_name"]
    explicit = _clean(os.environ.get(spec["address_env"]))
    address = explicit if explicit.startswith("agent") else address_for_seed(seed)
    return {**spec, "seed": seed, "name": name, "port": port, "address": address}


def resolved_by_key() -> dict[str, dict]:
    found: dict[str, dict] = {}
    for spec in SPECS:
        item = resolve(spec)
        if item:
            found[item["key"]] = item
    return found


def peer(key: str) -> str:
    item = resolved_by_key().get(key)
    return item["address"] if item else ""
