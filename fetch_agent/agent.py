"""PreVent - the ASI:One-discoverable security uAgent.

A user in ASI:One asks (in plain English) to audit a networked device service;
this agent runs the real find -> prove -> (human-approved) fix -> verify loop
and streams every stage back into the SAME chat thread, with a human APPROVE
gate before the fix is applied.

Run (from the repo root, with the project venv):
    ASI_ONE_API_KEY=... AGENT_SEED=... ./.venv/Scripts/python.exe -m fetch_agent.agent
Then open the Agent Inspector link in the logs -> connect -> Mailbox, and chat
with it from https://asi1.ai.

Design notes:
  * Discrete ChatMessage per stage (each renders on arrival in ASI:One) - the
    robust default; a dropped stream never collapses the narrative.
  * The HUMAN GATE splits the loop across two handler invocations: the user's
    APPROVE arrives as a LATER ChatMessage, so we persist a GateState in
    ctx.storage (keyed by session) and keep the warm device-service controller
    in a module-level map (a live process handle can't be serialized).
  * Ack EVERY inbound message first (ACP requirement).
  * Honesty: "applies a vetted fix" (never "autonomous patch"); the device
    "lie" is shown only from a real GET; no compromise claimed unless real.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from uuid import uuid4

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    StartSessionContent,
    TextContent,
    chat_protocol_spec,
)

from .cards import build_review_card, parse_approval
from .constants import AGENT_NAME, AGENT_PORT, AGENT_SEED, DEFAULT_PAYLOAD, DEVICE_BASE_URL, SEND_DELAY
from .payment import build_seller_protocol, make_subscription_request
from .pipeline import GateState, run_after_approval, run_gate_check, run_to_gate
from .service_control import DeviceServiceController

# ---- Agent ---------------------------------------------------------------
agent = Agent(
    name=AGENT_NAME,
    seed=AGENT_SEED or None,
    port=AGENT_PORT,
    mailbox=True,               # receive via Agentverse; no public endpoint needed
    publish_agent_details=True,  # publish profile for ASI:One discovery
)

protocol = Protocol(spec=chat_protocol_spec)

# Live device-service controllers keyed by session (process handles can't be
# serialized into ctx.storage, so they live here on the long-running process).
_controllers: dict[str, DeviceServiceController] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _msg(text: str, *, end: bool = False) -> ChatMessage:
    content: list = [TextContent(type="text", text=text)]
    if end:
        content.append(EndSessionContent(type="end-session"))
    return ChatMessage(timestamp=_now(), msg_id=uuid4(), content=content)


def _pending_key(session: str) -> str:
    return f"pending:{session}"


@protocol.on_message(ChatMessage)
async def handle_message(ctx: Context, sender: str, msg: ChatMessage):
    # 1) ACK first, always (ACP).
    await ctx.send(sender, ChatAcknowledgement(timestamp=_now(), acknowledged_msg_id=msg.msg_id))

    session = str(ctx.session)

    async def send(text: str) -> None:
        await ctx.send(sender, _msg(text))
        await asyncio.sleep(SEND_DELAY)  # stay under ASI:One's 429 burst limit

    # 2) Gather the user's text + note session lifecycle.
    text = ""
    for item in msg.content:
        if isinstance(item, StartSessionContent):
            ctx.logger.info(f"session start from {sender}")
        elif isinstance(item, TextContent):
            text += item.text
    text = text.strip()

    # 2b) MACHINE-to-MACHINE gate check (A2A): a peer agent (e.g. the Release
    #     Captain) asks for a GO/NO-GO with no human gate. Answer and end.
    if text.strip().upper() in ("SECURITY-GATE-CHECK", "GATE-CHECK") or '"action":"gate_check"' in text.replace(" ", ""):
        ctrl = DeviceServiceController(DEVICE_BASE_URL)
        try:
            res = await run_gate_check(send, base_url=DEVICE_BASE_URL, controller=ctrl)
        finally:
            ctrl.stop()
        await ctx.send(sender, _msg(f"GATE:{'GO' if res['go'] else 'NO-GO'}:{res['reason']}", end=True))
        return

    # 3) If this session is waiting at the human gate, interpret APPROVE/REJECT.
    pending_raw = ctx.storage.get(_pending_key(session))
    if pending_raw:
        decision = parse_approval(text)
        state: GateState = json.loads(pending_raw)
        if decision == "approve":
            ctx.storage.remove(_pending_key(session))
            ctrl = _controllers.pop(session, None) or DeviceServiceController(state.get("base_url", DEVICE_BASE_URL))
            try:
                result = await run_after_approval(send, state, controller=ctrl)
            finally:
                ctrl.stop()
            ctx.storage.set(f"applied:{state.get('run_id', '')}", "1")  # idempotency marker
            verdict = "closed and proven" if result.get("verified") else "NOT confirmed (reported honestly)"
            await ctx.send(sender, _msg(
                f"Loop complete - vulnerability {verdict}. "
                f"BEFORE HTTP {result.get('before')} -> AFTER HTTP {result.get('after')}. "
                f"This record (CVE -> finding -> exploit proof -> fix -> re-verify) is the evidence that feeds an FDA 524B submission.",
                end=True,
            ))
            return
        if decision == "reject":
            ctx.storage.remove(_pending_key(session))
            ctrl = _controllers.pop(session, None)
            if ctrl:
                ctrl.stop()
            await ctx.send(sender, _msg("Aborted at the human gate - no fix applied; device-service reverted. Nothing was changed without your approval.", end=True))
            return
        # Not a clear decision: re-prompt and keep waiting.
        await send("Awaiting your decision: reply **APPROVE** to apply the vetted fix, or **REJECT** to abort.")
        return

    # OPTIONAL upsell (OFF the mandatory path): the Payment Protocol only ever
    # appears here, after/independent of the free loop. Paid artifact = the
    # ongoing service / exportable bundle, never the safety fix.
    low = text.lower()
    if any(w in low for w in ("subscribe", "monitoring", "monitor", "bundle", "purchase", "upgrade")):
        await send(
            "Optional, and separate from the free audit: a continuous-monitoring subscription "
            "plus an exportable signed compliance bundle. Sending a payment request (demonstrated "
            "in the Agentverse Inspector) - the security loop itself is always free."
        )
        await ctx.send(sender, make_subscription_request(str(ctx.agent.address)))
        return

    # Idempotency: an APPROVE/REJECT arriving with no pending gate is a stale or
    # double tap (e.g. the review card tapped twice). Never double-apply.
    if parse_approval(text) in ("approve", "reject"):
        await ctx.send(sender, _msg(
            "That run is already complete (idempotent gate) - I won't double-apply a fix. "
            "Ask me to audit the device-service again to start a fresh run.",
            end=True,
        ))
        return

    # 4) Otherwise this is a NEW request. Run GROUND..DELIVER up to the gate.
    if not text:
        await ctx.send(sender, _msg(
            "I'm PreVent - I find, PROVE, and (with your approval) fix missing-authentication "
            "flaws on networked device services, then re-run the exact exploit to prove the fix. "
            "Ask me to audit the device-service and I'll show you the whole loop.",
            end=True,
        ))
        return

    run_id = f"r-{uuid4().hex[:8]}"
    await send(f"On it. Running the find->prove->fix->verify loop on the device-service (run `{run_id}`). I'll stream each stage.")

    ctrl = DeviceServiceController(DEVICE_BASE_URL)
    _controllers[session] = ctrl
    try:
        state = await run_to_gate(send, run_id=run_id, base_url=DEVICE_BASE_URL, payload=DEFAULT_PAYLOAD, controller=ctrl)
    except Exception as exc:  # never leave a half-open run silently
        ctx.logger.exception("run_to_gate failed")
        _controllers.pop(session, None)
        ctrl.stop()
        await ctx.send(sender, _msg(f"The run hit an error and was rolled back safely: {exc}", end=True))
        return

    if not state.get("exploit_worked"):
        _controllers.pop(session, None)
        ctrl.stop()
        await ctx.send(sender, _msg("No exploitable missing-auth flaw was landed on this target. Nothing to patch.", end=True))
        return

    # 5) HUMAN GATE - persist state, render the review card + a guaranteed text
    #    fallback, and WAIT for the user's next message.
    ctx.storage.set(_pending_key(session), json.dumps(state))
    card_msg = build_review_card(state)
    if card_msg is not None:
        await ctx.send(sender, card_msg)
        await asyncio.sleep(SEND_DELAY)
    await send(
        f"**HUMAN GATE** - exploit CONFIRMED (HTTP {state.get('deliver_status')}). "
        f"Reply **APPROVE** to apply the vetted fix and prove it closed, or **REJECT** to abort. (run `{run_id}`)"
    )


@protocol.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass  # read receipts unused


agent.include(protocol, publish_manifest=True)
agent.include(build_seller_protocol(), publish_manifest=True)  # off-path monetization


if __name__ == "__main__":
    agent.run()
