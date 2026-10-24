# PreVent — Autonomous Medical-Device Security Pipeline

**Cal Hacks 13.0.** A pipeline of AI agents that finds a security vulnerability in a medical device's software, **proves it by exploiting it in a sandbox**, writes and **verifies** a fix, and restores the device — every step visible, with a human approving before anything is final. Demonstrated live on a harmless Arduino-driven "ventilator" + patient prop, on a split screen where the judge is the patient.

> **Honest framing (we hold this throughout).** This is a **pre-market / staging** tool — it never auto-patches live clinical devices. The hardware is a **desk fan that models a missing-authentication vulnerability class** (CWE-306), not a real ventilator. We model the *class* of the real advisory **CVE-2019-6538** (Medtronic Conexus), which is adjacent-radio, not a remote hack. Prevalence figures are industry **estimates**; there is **no confirmed patient death from a device hack** (documented deaths come from ransomware disrupting care). The enabling regulation is **FDA section 524B**.

## The loop
`GROUND` a real CVE → `SCAN` the device code (SemGrep + Bandit; Claude reasons which finding is real) → `GENERATE` an exploit (Bitdeer open model) → `DELIVER` it (a judge presses an IR remote; the device obeys an **unauthenticated** command — the fan stops while the device keeps reporting normal vitals and never alarms, i.e. it **lies**) → `PATCH` (Factory Droid writes the fix) → **HUMAN GATE** → `VERIFY` (re-run the exact exploit; it now returns 401) → `RESTORE`.

One shared `device_status` row drives **the physical hardware, the left patient sim, and the right "no black box" dashboard** — nothing can drift or be faked.

## How each sponsor tech is used
- **Claude (Anthropic) — Agent SDK:** the reasoning core. Scan triage, outcome judging, verification triage, with **visible streamed reasoning, stated uncertainty, and a real safety refusal** on the dashboard.
- **Factory Droid (`@factory/droid-sdk`):** the autonomous **patch engineer** — triggered by the orchestrator (not a human) on the confirmed vuln, it edits the device-service repo and streams its **plan + real diff** to the dashboard, scoped so it cannot commit/push/deploy, gated by a human click.
- **SpacetimeDB:** the real-time backbone — one reactive DB (tables + reducers + subscriptions) that the device service, both panels, and the serial bridge subscribe to; separation of duties is enforced in reducers via `ctx.sender`. (**Convex** is the warm fallback behind a `RealtimeBackend` abstraction.)
- **Bitdeer AI Model Studio:** hosts the open model (`deepseek-ai/DeepSeek-V4.1-Flash`) that writes the proof-of-concept exploit — isolating the offensive-code model from the trust/decision model (a real separation of duties).
- **NVD/CVE:** grounds the vulnerability in a real published advisory.

## What's real vs simulated
- **Real:** the agent pipeline (find → exploit → patch → verify), the Factory Droid diff, the SemGrep finding, the deterministic verifier, the Arduino actuation driven by live state, the judge-chosen IR payload.
- **Simulated / visualized:** the hospital "fleet of ~3,412 devices" (a scale visualization — only one real device is in the loop) and the patient (the judge).

## Repo layout
| Dir | Owner | What |
|---|---|---|
| `contracts/` | shared | Frozen types, serial-schema constant, model IDs, mock fixtures — **import, don't redefine** |
| `agents/` | Dev 1 | Orchestrator, Agent SDK runner, human gate, Factory Droid patch stage |
| `device-service/` · `security/` | Dev 2 | Vulnerable+patched service, SemGrep/Bandit, Bitdeer exploit, verifier, NVD |
| `realtime/` · `app/` | Dev 3 | SpacetimeDB module + abstraction, dashboard, 2D sim |
| `firmware/` · `serial-bridge/` · `emulator/` | Hardware | UNO firmware, serial bridge, software emulator |

Per-person task plans are in **`plans/`** (`PLAN-FOUNDATION.md`, `PLAN-DEV1…`, `PLAN-DEV2…`, `PLAN-DEV3…`, `PLAN-HW-arduino.md`).

## Setup
```bash
# prerequisites: Node >=22.12, pnpm, Python 3.11-3.13 (for device-service/security), Arduino IDE 2.x
cp .env.example .env            # fill in keys (all OPTIONAL for the security loop — see below)
pnpm install
pnpm -r typecheck
# SpacetimeDB (Windows): irm https://windows.spacetimedb.com -useb | iex ; then: spacetime install 2.13.0
# redeem free Maincloud credits: spacetimedb.com/redeem  code: CALHACKS13
```

### Security loop (Dev 2) — runs headless, offline, with no API keys
```bash
python3.13 -m venv .venv
./.venv/bin/python -m pip install -r security/requirements.txt -r security/requirements-dev.txt
uv tool install --python 3.13 semgrep==1.182.1    # SemGrep + Bandit are standalone tools
uv tool install --python 3.13 bandit==1.9.4

./.venv/bin/python security/loop.py               # GROUND→SCAN→GENERATE→DELIVER→PATCH→VERIFY→RESTORE
./.venv/bin/python -m pytest security/tests        # 24 tests (~16s)
```
The device-service listens on **port 8071** (not 5000 — on macOS, AirPlay owns
:5000 and answers 403, which would fake a VERIFY pass). Full guide:
[`security/README.md`](security/README.md); design rationale + integration
seams: [`docs/DEV2-SECURITY-DECISIONS.md`](docs/DEV2-SECURITY-DECISIONS.md).

**Keys are optional.** The loop uses a cached PoC and deterministic triage when
unset. Set `BITDEER_API_KEY` for live PoC generation, `ANTHROPIC_API_KEY` for
live Claude triage narration (via Dev 1), `NVD_API_KEY` for a higher NVD rate
limit (the CVE JSON is already cached). `FACTORY_API_KEY` is used by Dev 1's
Droid patch stage, not the Dev 2 loop.

## Team workflow
Shared `main` is the integration branch. Each dev works on a branch (`dev1/…`, `dev2/…`, `dev3/…`, `hw/…`) and opens a PR into `main`. **All code is written during the event.**
