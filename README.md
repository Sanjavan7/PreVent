# Hospital Device Security Agents _(working title)_

**Cal Hacks 13.0 · Oct 23–25, 2026**
Team: Israel Ogwu · Christian Ibarbia Ruiz · Saketh Poori · Sanjavan Ghodasara

> **One-liner:** A multi-agent system that helps hospitals find weaknesses in medical-device software, confirm them safely in a sandbox, apply a fix, and bring the device back online, with a human approving every step.

---

## The idea
Hospitals run thousands of connected devices, and many run old, rarely patched software. When something goes wrong, the hard parts are knowing **what's weak**, **whether it really matters**, and **how to fix it without taking care offline**.

Our agents work as a pipeline on a **simulated medical device** we build ourselves:

| Step | What happens |
|---|---|
| **1. Scan** | An agent reviews the device's software with static analysis tools and AI review to flag weaknesses |
| **2. Validate (sandbox only)** | An agent confirms whether each finding is real, inside an isolated container, never on live equipment |
| **3. Fix** | An agent proposes a patch or mitigation; a human approves it |
| **4. Restore** | The device is redeployed and verified, back online |
| **5. Report** | A plain-English report for hospital IT and clinical engineering |

Possible hardware angle: a Raspberry Pi or Arduino "mock device" on the table, so judges can watch it go down and come back up.

## Ground rules (non-negotiable)
- **Simulated devices only.** We build the vulnerable target ourselves. No real hospital equipment, no third-party systems.
- **Isolated environment.** Everything runs in local containers on our own machines.
- **Human in the loop.** No fix is applied without explicit approval.
- **Audit log** of every agent action.
- All code written during the event (Cal Hacks rule).

## Sponsor tracks we're targeting
| Track | Prize | Why we fit |
|---|---|---|
| **Armadin: Best Security Hack** | ~$996 | Core security product: find, confirm, fix, restore. **Primary target** |
| **Cal Hacks: People-First Social Impact** | Apple Watch each | Protects hospitals and patients |
| **Cal Hacks: Most Technically Advanced** | NuPhy keyboard each | A multi-agent pipeline + sandboxing + hardware |
| **Cal Hacks: Best Hardware Hack** | Bambu 3D printer each | Only if we build the physical mock device |
| **Factory: Best Use of the Droid SDK** | $2,000 | The **fix agent** that writes patches is a natural fit for coding agents |
| **Microsoft: Built for the Real World** | $3,800 + Surface each | A real hospital problem. *Ask whether Azure is required* |
| **Anthropic** (presenting sponsor) | No listed prize | Claude powers the agents. *Ask about an unlisted track* |
| **Elastic: Agent Builder on Serverless** | ~$1.2K / ~$1.4K | *Maybe:* an agent that searches findings and audit logs |
| **Fetch.ai** | $1.5K / $1K / $500 | *Maybe:* the agents could run on Agentverse |
| **MLH Commit Fellowship** + **GoDaddy domain** | Interview / gift card | Easy add-ons at submission |

**Ask the directors (#0-ask-directors):** how many tracks can one project enter?

## Working in this repo
- `main` is the shared, always-working branch. **Don't push half-finished work straight to `main`.**
- Create your own branch for each piece of work:
  ```
  git checkout main && git pull
  git checkout -b <your-name>/<feature>     # e.g. israel/sandbox, saketh/mock-device
  ```
- Push your branch and open a **pull request** into `main`; someone else gives it a quick look before merging.
- **Never commit secrets** (API keys go in `.env`, which git ignores).

## Key deadlines (PDT)
- **Sat 11 PM:** feature freeze + backup demo video
- **Sun 8:30 AM:** submit on Devpost (hard deadline 9:00 AM)
- **Before submitting:** make this repo public so judges can open it
