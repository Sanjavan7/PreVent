"""Shared chat-protocol helpers for the extra agents."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from uagents import Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    StartSessionContent,
    TextContent,
    chat_protocol_spec,
)


def now() -> datetime:
    return datetime.now(timezone.utc)


def message(text: str, *, end: bool = False) -> ChatMessage:
    content: list = [TextContent(type="text", text=text)]
    if end:
        content.append(EndSessionContent(type="end-session"))
    return ChatMessage(timestamp=now(), msg_id=uuid4(), content=content)


def text_of(msg: ChatMessage) -> str:
    parts: list[str] = []
    for item in msg.content:
        if isinstance(item, StartSessionContent):
            continue
        if isinstance(item, TextContent):
            parts.append(item.text)
    return "".join(parts).strip()


async def ack(ctx: Context, sender: str, msg: ChatMessage) -> None:
    await ctx.send(sender, ChatAcknowledgement(timestamp=now(), acknowledged_msg_id=msg.msg_id))


def chat_protocol() -> Protocol:
    return Protocol(spec=chat_protocol_spec)
