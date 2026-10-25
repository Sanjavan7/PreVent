"""Read-only patch reviewer. Answers REVIEW:GO or REVIEW:NO-GO."""

from __future__ import annotations

from uagents import Context
from uagents_core.contrib.protocols.chat import ChatAcknowledgement, ChatMessage

from .chat import ack, chat_protocol, message, text_of
from .review import verdict
from .runtime import make_agent, run_agent

agent = make_agent("review")
protocol = chat_protocol()


@protocol.on_message(ChatMessage)
async def handle(ctx: Context, sender: str, msg: ChatMessage):
    await ack(ctx, sender, msg)
    await ctx.send(sender, message(verdict(text_of(msg)), end=True))


@protocol.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    return


if agent is not None:
    agent.include(protocol, publish_manifest=True)


if __name__ == "__main__":
    run_agent("review", agent)
