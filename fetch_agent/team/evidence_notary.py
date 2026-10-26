"""Evidence clerk. The signed export is the paid artifact. The fix is not for sale."""

from __future__ import annotations

import json
import os

from uagents import Context, Protocol
from uagents_core.contrib.protocols.chat import ChatAcknowledgement, ChatMessage
from uagents_core.contrib.protocols.payment import (
    CancelPayment,
    CommitPayment,
    CompletePayment,
    Funds,
    RejectPayment,
    RequestPayment,
    payment_protocol_spec,
)

from ..payment import settle
from .chat import ack, chat_protocol, message, text_of
from .notary_record import parse_record
from .runtime import make_agent, run_agent

agent = make_agent("evidence")
protocol = chat_protocol()
payments = Protocol(spec=payment_protocol_spec, role="seller")

_PRICE = os.environ.get("PREVENT_PRICE_USD", "9.00")
_PENDING = "pending_manifest"


def _request(recipient: str) -> RequestPayment:
    return RequestPayment(
        accepted_funds=[Funds(amount=_PRICE, currency="USD", payment_method="stripe")],
        recipient=recipient,
        deadline_seconds=3600,
        description="Signed evidence export. The security fix itself is not for sale.",
        metadata={"service": "evidence_export", "note": "demo" if not os.environ.get("STRIPE_SECRET_KEY") else "live"},
    )


@protocol.on_message(ChatMessage)
async def handle(ctx: Context, sender: str, msg: ChatMessage):
    await ack(ctx, sender, msg)
    text = text_of(msg)
    manifest, error = parse_record(text)
    if error:
        await ctx.send(sender, message(error, end=True))
        return
    ctx.storage.set(_PENDING, json.dumps(manifest))
    await ctx.send(
        sender,
        message(
            "Record accepted. The signed export is the paid artifact "
            f"(${_PRICE}). The fix is not part of this purchase. "
            "Sending a payment request."
        ),
    )
    await ctx.send(sender, _request(str(ctx.agent.address)))


@protocol.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    return


@payments.on_message(CommitPayment)
async def on_commit(ctx: Context, sender: str, msg: CommitPayment):
    method = getattr(getattr(msg, "funds", None), "payment_method", None)
    decision, reason = settle(msg.transaction_id, method)
    if decision != "complete":
        await ctx.send(sender, CancelPayment(transaction_id=msg.transaction_id, reason=reason))
        return
    await ctx.send(sender, CompletePayment(transaction_id=msg.transaction_id))
    raw = ctx.storage.get(_PENDING)
    if not raw:
        await ctx.send(sender, message("Payment settled, but there is no record waiting to sign. Paste the run fields first."))
        return
    manifest = json.loads(raw)
    ctx.storage.remove(_PENDING)
    await ctx.send(
        sender,
        message(
            "Signed export. This signature is PreVent's non-repudiation of the pasted record, "
            "not an independent lab certification.\n"
            f"root_hash={manifest.get('root_hash')}\n"
            f"public_key={manifest['signature']['public_key']}\n"
            f"signature={manifest['signature']['value']}",
            end=True,
        ),
    )


@payments.on_message(RejectPayment)
async def on_reject(ctx: Context, sender: str, msg: RejectPayment):
    ctx.logger.info(f"payment rejected by {sender}")


if agent is not None:
    agent.include(protocol, publish_manifest=True)
    agent.include(payments, publish_manifest=True)


if __name__ == "__main__":
    run_agent("evidence", agent)
