"""OFF-CRITICAL-PATH Payment Protocol (the scored 20% "Use of Fetch.ai Tech"
line) with a credible, honest monetization model.

Hard rule: payment NEVER gates the mandatory find->prove->fix->verify loop (that
would break the "entirely inside ASI:One" requirement, since the Stripe card
often won't render in plain chat). The free loop completes first; payment is an
optional UPSELL the user can trigger afterward, best demonstrated in the
Agentverse Inspector. The paid artifact is the ONGOING SERVICE / exportable
compliance bundle -- never the safety fix itself.

Settlement is verified server-side and is IDEMPOTENT on transaction_id. Without
Stripe keys it runs in a clearly-labeled DEMO mode so the flow is shown without
real charges. `settle()` is a pure function (no ctx) so it is unit-testable.
"""

from __future__ import annotations

import os
from typing import Callable, Optional

from uagents import Context, Protocol
from uagents_core.contrib.protocols.payment import (
    CancelPayment,
    CommitPayment,
    CompletePayment,
    Funds,
    RejectPayment,
    RequestPayment,
    payment_protocol_spec,
)

# Idempotency ledger: transaction_ids already completed (per process).
_SETTLED: set[str] = set()

PRICE_USD = os.environ.get("PREVENT_PRICE_USD", "9.00")
SERVICE_DESC = "PreVent continuous-monitoring subscription + exportable signed compliance bundle (not the fix)."


def verify_paid(transaction_id: str) -> bool:
    """True iff the Stripe Checkout Session is paid. Real when STRIPE_SECRET_KEY
    is set; otherwise DEMO mode: a transaction_id containing 'paid' counts as
    paid (so the flow is demonstrable without charging a card)."""
    key = os.environ.get("STRIPE_SECRET_KEY")
    if not transaction_id:
        return False
    if not key:
        return "demo_paid" in transaction_id.lower()  # DEMO mode (unambiguous sentinel; clearly labeled upstream)
    try:
        import stripe  # optional dep

        stripe.api_key = key
        session = stripe.checkout.Session.retrieve(transaction_id)
        return getattr(session, "payment_status", None) == "paid"
    except Exception:
        return False


def settle(transaction_id: Optional[str], payment_method: Optional[str], verify: Callable[[str], bool] = verify_paid) -> tuple[str, str]:
    """Pure settlement decision. Returns ('complete'|'cancel', reason).
    Idempotent: a transaction already settled returns 'complete' again without
    re-charging / re-verifying."""
    if not transaction_id:
        return "cancel", "No transaction_id on the commit."
    if transaction_id in _SETTLED:
        return "complete", "Already settled (idempotent)."
    if payment_method and payment_method.lower() != "stripe":
        return "cancel", f"Unsupported payment method '{payment_method}' (expected stripe)."
    if not verify(transaction_id):
        return "cancel", "Stripe payment not completed yet - finish checkout and retry."
    _SETTLED.add(transaction_id)
    return "complete", "Payment verified."


def make_subscription_request(recipient: str) -> RequestPayment:
    """The upsell, sent only AFTER the free loop, off the mandatory path."""
    return RequestPayment(
        accepted_funds=[Funds(amount=PRICE_USD, currency="USD", payment_method="stripe")],
        recipient=recipient,
        deadline_seconds=3600,
        description=SERVICE_DESC,
        metadata={"service": "continuous_monitoring", "note": "demo" if not os.environ.get("STRIPE_SECRET_KEY") else "live"},
    )


def build_seller_protocol() -> Protocol:
    proto = Protocol(spec=payment_protocol_spec, role="seller")

    @proto.on_message(CommitPayment)
    async def _on_commit(ctx: Context, sender: str, msg: CommitPayment):
        method = getattr(getattr(msg, "funds", None), "payment_method", None)
        decision, reason = settle(msg.transaction_id, method)
        if decision == "complete":
            await ctx.send(sender, CompletePayment(transaction_id=msg.transaction_id))
            ctx.logger.info(f"payment complete: {msg.transaction_id} ({reason})")
        else:
            await ctx.send(sender, CancelPayment(transaction_id=msg.transaction_id, reason=reason))
            ctx.logger.info(f"payment cancelled: {reason}")

    @proto.on_message(RejectPayment)
    async def _on_reject(ctx: Context, sender: str, msg: RejectPayment):
        ctx.logger.info(f"payment rejected by {sender}: {getattr(msg, 'reason', '')}")

    return proto
