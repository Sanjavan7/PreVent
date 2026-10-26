"""Shared constants for the PreVent Fetch.ai uAgent.

This package is the ASI:One-facing layer: a uAgent (uagents + the Agent Chat
Protocol) that is discoverable through ASI:One and drives the ALREADY-BUILT
Python security loop in `security/` (GROUND->SCAN->GENERATE->DELIVER->PATCH->
VERIFY->RESTORE). No cross-language bridge: the agent shells out to
`python -m security.stage_api <stage>` exactly as the TS orchestrator does, so
every stage is a non-blocking checkpoint we can stream into one ASI:One thread.

Everything here is import-light so the module loads with zero network/keys.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# ---- Paths ---------------------------------------------------------------
# Repo root = parent of this package. The security loop is invoked as
# `python -m security.stage_api ...` with cwd = REPO_ROOT so `import security`
# resolves (the stage_api bridge is the frozen Dev1<->Dev2 seam).
REPO_ROOT = Path(__file__).resolve().parent.parent
DEVICE_SERVICE_DIR = REPO_ROOT / "device-service"


def _load_dotenv() -> None:
    """Load REPO_ROOT/.env into os.environ (without overriding already-set vars),
    so `python -m fetch_agent.agent` picks up ASI_ONE_API_KEY / AGENT_SEED from
    .env. uAgents does NOT auto-load .env. Zero-dependency; silent if absent."""
    env_path = REPO_ROOT / ".env"
    try:
        if not env_path.is_file():
            return
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val
    except Exception:
        pass  # never let env parsing break startup


_load_dotenv()

# The interpreter running this agent IS the venv that has `security`'s deps
# (requests) + uagents installed, so reuse it to spawn the stage subprocesses.
PYTHON = sys.executable

# ---- Device-service ------------------------------------------------------
# Bind on 127.0.0.1:8071 (NOT :5000 - collides with macOS AirPlay, which
# answers 403 and would masquerade as our patched service -> false VERIFY pass).
DEVICE_HOST = os.environ.get("DEVICE_SERVICE_HOST", "127.0.0.1")
DEVICE_PORT = int(os.environ.get("DEVICE_SERVICE_PORT", "8071"))
DEVICE_BASE_URL = f"http://{DEVICE_HOST}:{DEVICE_PORT}"
# Bearer token the PATCHED handler requires. Set only in patched mode, so an
# unauthenticated exploit replay gets 401/403 at VERIFY.
DEVICE_TOKEN = os.environ.get("DEVICE_SERVICE_TOKEN", "prevent-demo-token")

# ---- The pipeline --------------------------------------------------------
STAGES = ("ground", "scan", "generate", "deliver", "verify", "restore")
# Default CWE-306 scenario: stop the ventilator while the device keeps
# reporting healthy vitals (the "lying device"). One of security's PAYLOADS.
DEFAULT_PAYLOAD = os.environ.get("PREVENT_PAYLOAD", "stop-breathing")

# ---- ASI:One / Agentverse discoverability --------------------------------
ASI_ONE_API_KEY = os.environ.get("ASI_ONE_API_KEY", "")
ASI_ONE_BASE_URL = os.environ.get("ASI_ONE_BASE_URL", "https://api.asi1.ai/v1")
AGENT_SEED = os.environ.get("AGENT_SEED", "")  # never commit; unique per agent
AGENT_NAME = os.environ.get("PREVENT_AGENT_NAME", "PreVent-Security")
AGENT_PORT = int(os.environ.get("PREVENT_AGENT_PORT", "8101"))
# ASI:One chat delivery rate-limits bursts (HTTP 429). Space out messages.
SEND_DELAY = float(os.environ.get("PREVENT_SEND_DELAY", "1.0"))

# ---- A2A peer (the Release Captain delegates a security gate to PreVent) ----
RC_AGENT_NAME = os.environ.get("RC_AGENT_NAME", "Release-Captain")
RC_AGENT_SEED = os.environ.get("RC_AGENT_SEED", "")
RC_AGENT_PORT = int(os.environ.get("RC_AGENT_PORT", "8102"))
# PreVent's agent1q... address, so the Release Captain can message it directly
# (bypasses the planner for a deterministic peer-to-peer hop).
PREVENT_PEER_ADDRESS = os.environ.get("PREVENT_PEER_ADDRESS", "")

# ASI:One routes by keyword + semantic match on the README/description. Front-
# load these verbatim in the Agentverse profile + README so a relevant query
# reliably reaches this agent.
ROUTING_KEYWORDS = (
    "medical device security",
    "CVE",
    "CWE-306",
    "missing authentication",
    "exploit",
    "patch",
    "vulnerability verification",
    "SBOM",
    "FDA 524B",
)

# ---- Honesty guardrails (used verbatim in narration) ---------------------
# Say "applies a vetted fix", never "autonomous patch" (the Python PATCH stage
# flips to a pre-written patched handler); say "evidence that feeds an FDA 524B
# submission", never "FDA-compliant / certified".
