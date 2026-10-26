# PreVent — Autonomous Medical-Device Security Pipeline

A pipeline of AI agents that finds a security vulnerability in a medical device's
software, **proves it by exploiting it in a sandbox**, writes and **verifies** a
fix, and restores the device — every step visible, with a human approving before
anything is final. Demonstrated live on a harmless Arduino-driven "ventilator"
(a desk fan) and a patient prop. Built at Cal Hacks 13.0.

> **Honest framing (held throughout).** This is a **pre-market / staging** tool —
> it never auto-patches live clinical devices. The hardware is a **desk fan that
> models a missing-authentication vulnerability class** (CWE-306), not a real
> ventilator. It models the *class* of the real advisory **CVE-2019-6538**
> (Medtronic Conexus), which is adjacent-radio, not a remote hack. Prevalence
> figures are industry **estimates**; there is **no confirmed patient death from a
> device hack** (documented deaths come from ransomware disrupting care). The
> enabling regulation is **FDA section 524B**.

> **⚠ The `device-service/` target is deliberately vulnerable by design** (CWE-306)
> so the pipeline has something real to find and fix. It binds to `127.0.0.1` and
> refuses a non-loopback bind unless you set `PREVENT_INSECURE_BIND=1`. Run it only
> on localhost; never deploy it or expose it to a network.

## The loop
`GROUND` a real CVE → `SCAN` the device code (SemGrep + Bandit; Claude reasons
which finding is real) → `GENERATE` an exploit (an open model via Bitdeer) →
`DELIVER` it (the device obeys an **unauthenticated** command — the fan stops
while the device keeps reporting normal vitals and never alarms, i.e. it **lies**)
→ `PATCH` (Factory Droid writes the fix) → **HUMAN GATE** → `VERIFY` (re-run the
exact exploit; it now returns 401) → `RESTORE`.

One shared `device_status` row drives **the physical hardware, the patient sim,
and the "no black box" dashboard** — nothing can drift or be faked.

## How each technology is used
- **Claude (Anthropic) — Agent SDK:** the reasoning core. Scan triage, outcome
  judging, verification triage, with **visible streamed reasoning, stated
  uncertainty, and a real safety refusal** on the dashboard.
- **Factory Droid:** the autonomous **patch engineer** — triggered by the
  orchestrator (not a human) on the confirmed vuln, it edits the device-service
  repo and streams its **plan + real diff** to the dashboard, scoped so it cannot
  commit/push/deploy, gated by a human click.
- **SpacetimeDB:** the real-time backbone — one reactive DB (tables + reducers +
  subscriptions) the device service and the panels subscribe to; separation of
  duties is enforced in reducers via `ctx.sender`. The `RealtimeBackend`
  abstraction also ships a keyless `mock` backend for offline development.
- **Bitdeer AI Model Studio:** hosts the open model
  (`deepseek-ai/DeepSeek-V4.1-Flash`) that writes the proof-of-concept exploit —
  isolating the offensive-code model from the trust/decision model (a real
  separation of duties). Featherless is a drop-in standby serving the same model.
- **NVD/CVE:** grounds the vulnerability in a real published advisory.

## What's real vs simulated
- **Real:** the agent pipeline (find → exploit → patch → verify), the Factory
  Droid diff, the SemGrep finding, the deterministic verifier, the Arduino
  actuation driven by live state, the chosen IR payload.
- **Simulated / visualized:** the hospital "fleet" of devices (a scale
  visualization — only one real device is in the loop) and the patient.

## Repo layout
| Dir | What |
|---|---|
| `contracts/` | Frozen shared types, serial-schema constant, model IDs, mock fixtures — **import, don't redefine** |
| `agents/` | Orchestrator, Agent SDK runner, human gate, Factory Droid patch stage |
| `device-service/` · `security/` | The deliberately-vulnerable service, SemGrep/Bandit scanners, exploit generation, deterministic verifier, NVD grounding |
| `realtime/` · `app/` | SpacetimeDB module + `RealtimeBackend` abstraction, the dashboard, and the patient sim |
| `firmware/` | UNO R4 firmware (the hardware target) |
| `fetch_agent/` | Optional Fetch.ai / ASI:One uAgent wrapper over the security loop (standalone) |
| `scripts/` | Demo helpers (`hardware-reporter.mjs`, `seed-demo.sh`) |

## Setup
```bash
# prerequisites: Node >=22.12, pnpm, Python 3.11-3.13 (for device-service/security), Arduino IDE 2.x
cp .env.example .env            # fill in keys (all OPTIONAL for the security loop — see below)
pnpm install
pnpm -r typecheck
```

## Realtime (SpacetimeDB)
The app defaults to a local SpacetimeDB on `ws://localhost:3000`. Install the CLI
(macOS: `curl -sSf https://install.spacetimedb.com | sh`, then
`spacetime install 2.13.0; spacetime version use 2.13.0`), then:

```bash
spacetime start                                                          # local server on :3000
spacetime publish --module-path realtime/spacetimedb --server local prevent
# .env: VITE_REALTIME_BACKEND=spacetimedb, VITE_SPACETIMEDB_URI=ws://localhost:3000, VITE_SPACETIMEDB_MODULE=prevent
```

When the module schema changes, republish and regenerate the TypeScript bindings
(these are committed so most contributors don't need the CLI):
```bash
spacetime generate --lang typescript --module-path realtime/spacetimedb --out-dir realtime/src/module_bindings
```

You can also point `VITE_SPACETIMEDB_URI` at a hosted
`wss://maincloud.spacetimedb.com` module instead of a local server. Set
`VITE_REALTIME_BACKEND=mock` for a fully offline, keyless dashboard.

## Security loop — runs headless, offline, with no API keys
```bash
python3.13 -m venv .venv
./.venv/bin/python -m pip install -r security/requirements.txt -r security/requirements-dev.txt
uv tool install --python 3.13 semgrep==1.182.1    # SemGrep + Bandit are standalone tools
uv tool install --python 3.13 bandit==1.9.4

./.venv/bin/python security/loop.py               # GROUND→SCAN→GENERATE→DELIVER→PATCH→VERIFY→RESTORE
./.venv/bin/python -m pytest security/tests        # 67 tests
```
The device-service listens on **port 8071** (not 5000 — on macOS, AirPlay owns
:5000 and answers 403, which would fake a VERIFY pass). Full guide:
[`security/README.md`](security/README.md).

**Keys are optional.** The loop uses a cached PoC and deterministic triage when
unset. Set `BITDEER_API_KEY` for live PoC generation (primary provider;
`FEATHERLESS_API_KEY` is the standby — both serve `DeepSeek-V4.1-Flash-1017`),
`ANTHROPIC_API_KEY` for live Claude triage narration, and `NVD_API_KEY` for a
higher NVD rate limit (the CVE JSON is already cached). `FACTORY_API_KEY` drives
the Factory Droid patch stage; without it, the patch stage replays a cached diff.

## Contributing
Work on a feature branch and open a PR into `main`; never commit directly to
`main`. `pnpm -r typecheck` and `pytest security/tests` should stay green.
