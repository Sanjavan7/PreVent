"""Ward front door. Forwards chat to a specialist and relays the reply.

Does not import the security pipeline and does not start the device service.
"""

from __future__ import annotations

from uagents import Context
from uagents_core.contrib.protocols.chat import ChatAcknowledgement, ChatMessage

from .chat import ack, chat_protocol, message, text_of
from .handoff import CHAIN, case_plan, dump_notes, final_report, load_notes, prompt_for
from .roster import peer
from .route import route
from .runtime import make_agent, run_agent

agent = make_agent("ward")
protocol = chat_protocol()

_DONE = (
    "loop complete",
    "aborted",
    "nothing to patch",
    "review:",
    "this is a description",
    "i only answer",
    "refusing",
    "need deliver",
    "pre-ship",
    "release **blocked**",
    "shipping the build",
    "mailbox",
)


def _clear_case(ctx: Context) -> None:
    for key in ("case_user", "case_step", "case_notes", "awaiting_user", "awaiting_peer"):
        ctx.storage.remove(key)


async def _tell(ctx: Context, user: str, text: str, *, end: bool = False) -> None:
    # The bench is holding a human chat. Label the relay so it can tell progress from the final report.
    if user and user == peer("bench"):
        label = "CASE-REPORT" if end else "CASE-NOTE"
        await ctx.send(user, message(f"{label}\n{text}"))
        return
    await ctx.send(user, message(text, end=end))


async def _ask(ctx: Context, user: str, index: int, prior: str) -> None:
    key = CHAIN[index]
    target = peer(key)
    if not target:
        await _tell(ctx, user, f"The {key} agent has no seed configured, so the case stopped.", end=True)
        _clear_case(ctx)
        return
    ctx.storage.set("case_user", user)
    ctx.storage.set("case_step", str(index))
    ctx.storage.set("awaiting_user", user)
    ctx.storage.set("awaiting_peer", target)
    if index == 0:
        await _tell(ctx, user, "Asking the bench for a reading.")
    else:
        await _tell(ctx, user, f"Passing that note to {key}.")
    await ctx.send(target, message(prompt_for(key, prior)))


@protocol.on_message(ChatMessage)
async def handle(ctx: Context, sender: str, msg: ChatMessage):
    await ack(ctx, sender, msg)
    text = text_of(msg)
    waiting = ctx.storage.get("awaiting_user")
    waiting_peer = ctx.storage.get("awaiting_peer")
    case_step = ctx.storage.get("case_step")

    if case_step is not None and waiting and sender == waiting_peer:
        user = ctx.storage.get("case_user") or waiting
        notes = load_notes(ctx.storage.get("case_notes"))
        notes.append(text)
        ctx.storage.set("case_notes", dump_notes(notes))
        nxt = int(case_step) + 1
        if nxt >= len(CHAIN):
            _clear_case(ctx)
            await _tell(ctx, user, final_report(notes), end=True)
            return
        await _ask(ctx, user, nxt, text)
        return

    if case_step is not None and sender == ctx.storage.get("case_user"):
        await ctx.send(sender, message("A ward case is already in progress."))
        return

    if waiting and sender == waiting_peer:
        finished = any(mark in text.lower() for mark in _DONE)
        await ctx.send(waiting, message(text, end=finished))
        if finished:
            ctx.storage.remove("awaiting_user")
            ctx.storage.remove("awaiting_peer")
        return

    kind, key, body = route(text)
    if kind == "case":
        index, prior = case_plan(text) or (0, "")
        ctx.storage.set("case_notes", dump_notes([prior] if prior else []))
        await _ask(ctx, sender, index, prior)
        return
    if kind == "reply":
        await ctx.send(sender, message(body, end=True))
        return
    target = peer(key)
    if not target:
        await ctx.send(sender, message(f"The {key} agent has no seed configured, so I did not forward this.", end=True))
        return
    ctx.storage.set("awaiting_user", sender)
    ctx.storage.set("awaiting_peer", target)
    await ctx.send(sender, message(f"Forwarding to {key}."))
    await ctx.send(target, message(body))


@protocol.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    return


if agent is not None:
    agent.include(protocol, publish_manifest=True)


if __name__ == "__main__":
    run_agent("ward", agent)
