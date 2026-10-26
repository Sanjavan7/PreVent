"""Bedside sentinel.

Reads a status URL when asked. Accepts a reading the user types.
Never opens the serial port and never POSTs to the bench server.
"""

from __future__ import annotations

import os

import requests
from uagents import Context
from uagents_core.contrib.protocols.chat import ChatAcknowledgement, ChatMessage

from .chat import ack, chat_protocol, message, text_of
from .roster import _clean, peer
from .runtime import make_agent, run_agent

agent = make_agent("bench")
protocol = chat_protocol()

_STATUS_URL = _clean(os.environ.get("BENCH_STATUS_URL")) or "http://127.0.0.1:8000/api/status"


def _read_status() -> str:
    try:
        response = requests.get(_STATUS_URL, timeout=2)
    except requests.RequestException as exc:
        return f"Bench status page did not answer ({exc.__class__.__name__})."
    if response.status_code != 200:
        return f"Bench status page returned HTTP {response.status_code}."
    return f"Bench status (read-only GET {_STATUS_URL}): {response.text[:500]}"


@protocol.on_message(ChatMessage)
async def handle(ctx: Context, sender: str, msg: ChatMessage):
    await ack(ctx, sender, msg)
    text = text_of(msg)
    low = text.lower()

    if text.startswith("CASE-NOTE") or text.startswith("CASE-REPORT"):
        human = ctx.storage.get("case_human")
        body = text.split("\n", 1)[1] if "\n" in text else text
        if human:
            await ctx.send(human, message(body, end=text.startswith("CASE-REPORT")))
        if text.startswith("CASE-REPORT"):
            ctx.storage.remove("case_human")
        return

    if any(word in low for word in ("status", "read the bench", "read bench")):
        await ctx.send(sender, message(_read_status(), end=True))
        return

    fault = "simulate fault" in low or ("fan" in low and any(word in low for word in ("stop", "0", "off")))
    if not fault:
        await ctx.send(
            sender,
            message(
                "I'm the bench monitor. Say `read the bench` for a read-only status check, "
                "or `simulate fault` to pass a fan-stopped report to the ward. "
                "I do not open the serial port and I do not start an attack.",
                end=True,
            ),
        )
        return

    note = (
        "Simulated bedside report, not a live serial reading: fan stopped, monitor still reporting healthy."
    )
    target = peer("ward")
    if not target:
        await ctx.send(sender, message(note + "\n\nThe ward agent has no seed, so this report stayed here.", end=True))
        return
    ctx.storage.set("case_human", sender)
    await ctx.send(sender, message(note + "\n\nPassing this report to the ward. It will hand the note to patient-risk, then knowledge, then review."))
    await ctx.send(target, message("CASE-START\n" + note))


@protocol.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    return


if agent is not None:
    agent.include(protocol, publish_manifest=True)


if __name__ == "__main__":
    run_agent("bench", agent)
