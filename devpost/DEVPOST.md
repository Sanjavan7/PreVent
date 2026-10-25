## Inspiration

PreVent is an autonomous security pipeline for the medical devices a hospital cannot patch fast enough. It finds a real vulnerability in a device's software, proves it by exploiting it on real hardware, patches the code with a human in the loop, and re-runs the exact attack to prove the hole is closed.

This matters because a connected medical device can be compromised and told to stop while it keeps reporting that the patient is fine, so the patient crashes and no alarm ever sounds. These devices keep people alive, they ship with known exploitable flaws, and the fix is usually public long before a hospital can deploy it. Cynerio estimated in 2022 that 53% of connected hospital devices carry a known critical vulnerability, often a missing check that lets an unauthenticated caller send a command the device obeys. PreVent closes the gap between a vulnerability being known and the fix being live, which is exactly where patients get hurt.

![PreVent's 3D hospital ward: stable and breathing, then compromised and flatlining the moment the attack fires, then healthy again once the patch ships.](https://raw.githubusercontent.com/Sanjavan7/PreVent/main/devpost/media/ward.gif)

## What it does

You point PreVent at a device's code and plug in the device. One run has five stages.

1. **Find.** SemGrep and Bandit scan the code. Claude reads the raw output and picks the one real missing-authentication flaw (CWE-306) out of a pile of decoys.
2. **Prove.** A DeepSeek model running on Bitdeer writes a working exploit live, then fires an unauthenticated command at the device. A real Arduino-driven fan stops. When it spins the patient is breathing; when it stops, they are not. But the monitor still reports normal vitals, still green. The device is lying to the doctor, and no alarm fires.
3. **Patch.** A writer Droid edits the real code to add the missing auth guard. A second, read-only Droid reviews the diff. Then a human clicks approve.
4. **Verify.** We replay the exact same exploit bytes and assert the response flips from 200 to 401. No model gets a vote in that check.
5. **Sync.** One SpacetimeDB row keeps the dashboard, the 3D hospital ward, and the physical fan in step, and the run leaves an auditable receipt.

We ran the whole loop ten times back to back in under ninety seconds.

![The Command Center running the loop: Claude triages the real flaw, DeepSeek writes the exploit, the device is breached, then a writer Droid and a read-only reviewer Droid patch it and the exploit is re-fired.](https://raw.githubusercontent.com/Sanjavan7/PreVent/main/devpost/media/agents.gif)

## How we built it

PreVent is one loop across five systems that all agree on a single database row.

Claude, through the Anthropic Agent SDK, is the judgment layer. It triages the scanner output with its reasoning streamed on screen, so you watch it reject decoys and lock onto the real flaw instead of just handing you a verdict.

The exploit is written by a DeepSeek model on Bitdeer. We keep the model that writes offensive code separate from the model we trust to approve a fix, so no single model is both attacker and defender in the same loop. Featherless is an interchangeable fallback for the same open model.

Factory Droids do the patch. The writer runs behind a deny-by-default permission handler we call the Droid Shield, so the agent that can edit code cannot run git, push, or deploy. The reviewer runs read-only and returns a typed JSON verdict. You can tell a live run from our cached-replay fallback, because a live run burns Factory credits on screen.

SpacetimeDB holds the shared state and the audit trail. The orchestrator and the hardware bridge write through reducers, and the dashboard, the 3D ward, and the Arduino all subscribe. The approve reducer checks the caller's identity and refuses to let the agent that proposed a patch also approve it. The live reasoning timeline streams separately over SSE from a small local control plane.

Fetch.ai wraps the whole loop as the PreVent-Security agent on Agentverse, so the full loop, human gate included, runs inside one ASI:One chat.

The thing you watch is the ward: eight rooms of vitals streaming green at 60fps until one flatlines mid-attack, then recovers the instant the patch lands, all driven by the same database row as the physical fan. The frontend is React, Vite and Tailwind, with PixiJS for the vitals waveforms and three.js for the ward. The hardware is an Arduino driving a fan through a motor driver, with a pressure sensor, an LCD, status LEDs and a buzzer; the fan stands in for a ventilator and the printed mask is the patient side of the circuit. We planned and sketched parts of this in Mana, including the hardware wiring graphic and our build playbook.

## Challenges we ran into

Making the lie visible was harder than making the attack work. The display reads the reported vitals and the sim reads the true state, and when the attack fires the two have to split on screen without it looking like a glitch.

Keeping the proof honest meant taking every model out of the verify step. It was tempting to ask Claude whether the fix held, but we wanted the result to be a plain byte comparison, not a judgment call.

The Droid permission config was a trap. A settings file allowlist is ignored on a cloned repo, so we had to enforce scope in process, where it fails closed even if our own handler throws.

Getting one row, three clients, and two laptops to agree in about a second over the cloud was the integration that finally made the whole thing feel like one system.

## Accomplishments that we're proud of

Four of us built all of it in 36 hours, and the full loop runs end to end on real hardware. The fan actually stops when the attack fires and starts again when the patch ships, not in a recording.

The verifier re-fires the exact exploit bytes and asserts the wire response flips from 200 to 401.

The human gate is real, backed by a database identity check that will not let a patch be approved by whoever proposed it, inside a least-privilege design: the Droid Shield keeps the writer from running git, push or deploy, and the attacker and approver models run as separate processes.

The whole security loop is a live agent anyone can call from ASI:One.

## What we learned

A proof of fix that calls a model is not a proof. Removing the model from the verify step is the single decision that makes the result credible.

Trust nothing the device reports. Only a byte-for-byte replay of the attack shows a hole is actually closed.

In healthcare, a human gate is not a weakness. It is the thing that makes autonomy adoptable, and it is the honest answer to whether an AI should be allowed to patch a medical device on its own.

## What's next for PreVent

First, hunt mode. Today we re-prove the flaw we already found. Next, Claude looks for sibling flaws on nearby endpoints before it signs the receipt. Then more device types, and a fleet mode that patches one device and rolls the verified fix across a ward.

The larger goal is a security layer for Anthropic's Model Hardware Standard. Anthropic opened MHS as a research preview that lets agents operate physical devices, and left the security model for later. We think PreVent's find, prove, patch, verify loop, with its human gate and audit receipt, is the piece MHS is missing, and we would use the Office Hours to help build it.

One honest note we hold throughout. This is a pre-market, staging tool with a mandatory human sign-off, and it never patches live clinical devices. The hardware is a desk fan modelling the missing-authentication class, not a real ventilator, and we model the class of real advisories like CVE-2019-6538. The receipt follows the shape of FDA 524B, it is not an FDA clearance.
