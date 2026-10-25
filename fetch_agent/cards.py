"""ASI:One Interactive Cards + approval parsing for the human gate.

The approval gate is rendered as a `review` card (the docs call it "a natural
final gate before irreversible actions"). Critical reliability rule: ASI:One
SILENTLY falls back to plain text on any card-validation error, and a card tap
comes back as a follow-up message that is EITHER JSON (direct @mention) OR
planner-authored prose. So:
  * the card is progressive enhancement - the agent always also sends a plain
    "reply APPROVE / REJECT" text gate that works with zero card support;
  * `parse_approval` tries JSON-first (card tap / @mention) then prose.

MetadataContent.metadata is string-only on the wire; nested structures MUST be
JSON-stringified. Never set is_terminal on an input card (the drawer won't open).
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from uagents_core.contrib.protocols.chat import ChatMessage, MetadataContent, TextContent

from .pipeline import GateState

_APPROVE_WORDS = {"approve", "apply", "deploy", "ship", "confirm", "yes", "proceed", "ok", "okay"}
_REJECT_WORDS = {"reject", "cancel", "abort", "deny", "no", "nope", "stop", "decline"}


def parse_approval(text: str) -> Optional[str]:
    """Return 'approve' | 'reject' | None from a card tap (JSON) or prose."""
    if not text:
        return None
    t = text.strip()
    # A direct @mention tap may arrive as "@agent {json}" - keep the JSON tail.
    if t.startswith("@") and "{" in t:
        t = t[t.index("{"):]
    # JSON-first (card selection payload).
    try:
        obj = json.loads(t)
        if isinstance(obj, dict):
            action = obj.get("action")
            if not action and isinstance(obj.get("selection"), dict):
                action = obj["selection"].get("action")
            if isinstance(action, str):
                a = action.lower()
                if a in ("approve", "apply", "confirm"):
                    return "approve"
                if a in ("reject", "cancel", "abort"):
                    return "reject"
    except (json.JSONDecodeError, ValueError):
        pass
    # Prose fallback - whole-word match (so "no" doesn't match inside "not"),
    # reject wins ties so an explicit "do not approve" is treated as reject.
    tokens = set(re.findall(r"[a-z]+", text.lower()))
    if tokens & _REJECT_WORDS:
        return "reject"
    if tokens & _APPROVE_WORDS:
        return "approve"
    return None


def build_review_card(state: GateState) -> Optional[ChatMessage]:
    """A `review` card for the patch-approval gate, paired with a text fallback.
    Returns None on any construction error so the caller's text gate still runs."""
    try:
        run_id = state.get("run_id", "")
        payload = {
            "title": "Approve the vetted fix for a CONFIRMED live exploit",
            "summary_rows": [
                {"label": "Finding", "value": "CWE-306 missing authentication on POST /device/command"},
                {"label": "Exploit", "value": f"HTTP {state.get('deliver_status')} - device obeyed and kept reporting healthy vitals (the lie)"},
                {"label": "Fix", "value": "Require a bearer token; ignore untrusted telemetry overrides"},
                {"label": "Then", "value": "Re-fire the byte-identical request to prove it now returns 401/403"},
            ],
            "approve_cta": {"label": "Approve & apply fix", "primary": True, "selection": {"action": "approve", "run_id": run_id}},
            "reject_cta": {"label": "Reject", "selection": {"action": "reject", "run_id": run_id}},
        }
        card = MetadataContent(
            type="metadata",
            metadata={
                "card_protocol_version": "1",
                "requires_card_interaction": "true",
                "card_kind": "review",
                "card_payload": json.dumps(payload),
            },
        )
        fallback = TextContent(
            type="text",
            text="Review the confirmed exploit and approve the vetted fix (or reply APPROVE / REJECT).",
        )
        return ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=[fallback, card])
    except Exception:
        return None
