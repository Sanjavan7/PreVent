"""Register every configured Fetch agent on Agentverse.

Almanac registration uses the agent seed. Listing the agent on your Agentverse
account also needs ILABS_AGENTVERSE_API_KEY (or AGENTVERSE_API_KEY). This script
does not start the security loop.
"""

from __future__ import annotations

import os

from uagents_core.config import AgentverseConfig
from uagents_core.contrib.protocols.chat import chat_protocol_spec
from uagents_core.contrib.protocols.payment import payment_protocol_spec
from uagents_core.identity import Identity
from uagents_core.protocol import ProtocolSpecification
from uagents_core.utils.registration import (
    AgentverseRegistrationRequest,
    RegistrationRequestCredentials,
    register_agent,
    register_in_almanac,
)

from .roster import SPECS, resolve


def _digests(agent_key: str) -> list[str]:
    digests = [ProtocolSpecification.compute_digest(chat_protocol_spec.manifest())]
    if agent_key == "evidence":
        digests.append(ProtocolSpecification.compute_digest(payment_protocol_spec.manifest()))
    return digests


def main() -> None:
    key = (
        os.environ.get("ILABS_AGENTVERSE_API_KEY")
        or os.environ.get("AGENTVERSE_API_KEY")
        or ""
    ).strip()
    config = AgentverseConfig()
    endpoint = config.mailbox_endpoint
    if not key:
        print("No ILABS_AGENTVERSE_API_KEY set. Almanac registration still runs. The Agentverse account listing does not.")
    for spec in SPECS:
        item = resolve(spec)
        if item is None:
            print(f"skip {spec['default_name']}: {spec['seed_env']} is empty")
            continue
        digests = _digests(item["key"])
        print(f"{item['name']} {item['address']}")
        listed = register_in_almanac(
            Identity.from_seed(item["seed"], 0),
            [endpoint],
            digests,
            agentverse_config=config,
        )
        print(f"  almanac: {'ok' if listed else 'failed'}")
        if not key:
            continue
        try:
            register_agent(
                AgentverseRegistrationRequest(
                    name=item["name"],
                    endpoint=endpoint,
                    protocols=digests,
                    type="mailbox",
                    active=True,
                    description=item["description"],
                    readme=item["readme"],
                ),
                config,
                RegistrationRequestCredentials(
                    agentverse_api_key=key,
                    agent_seed_phrase=item["seed"],
                ),
            )
            print("  agentverse account: submitted")
        except Exception as exc:
            print(f"  agentverse account: {exc.__class__.__name__}: {exc}")


if __name__ == "__main__":
    main()
