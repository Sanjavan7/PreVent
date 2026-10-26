"""Construct one mailbox agent from the roster. Does not start it."""

from __future__ import annotations

from uagents import Agent

from .roster import SPECS, resolve


def make_agent(key: str) -> Agent | None:
    spec = next(item for item in SPECS if item["key"] == key)
    resolved = resolve(spec)
    if resolved is None:
        return None
    return Agent(
        name=resolved["name"],
        seed=resolved["seed"],
        port=resolved["port"],
        mailbox=True,
        publish_agent_details=True,
    )


def run_agent(key: str, agent: Agent | None = None) -> None:
    """Run the agent that already has protocols attached.

    `make_agent` again would start a blank process with the same seed and no handlers.
    """
    if agent is None:
        agent = make_agent(key)
    if agent is None:
        spec = next(item for item in SPECS if item["key"] == key)
        raise SystemExit(f"{spec['seed_env']} is not set, so {spec['default_name']} was not started.")
    agent.run()
