# PreVent — how the pieces (and the sponsor tech) actually fit together

_A high-level explanation of the architecture: what each sponsor technology does,
where it plugs in, and how they compose into one system. Not a demo script._

Last verified against the source: 2026-10-24.

---

## 1. The core idea: a separation-of-duties trust architecture

PreVent finds a real vulnerability in a medical "Device Control Service," exploits
it, patches it, and proves the patch holds — autonomously, but with a human
sign-off. The point that makes it more than a scripted demo is **who is allowed to
do what**. The sponsor technologies aren't bolted on for prize coverage; each one
is a *distinct role with distinct trust*, and the system only works because those
roles are kept apart:

- The model that **writes the exploit** is not the model that **makes decisions**.
- The agent that **writes the patch** cannot **ship** it.
- Every state change flows through a **named write-path** that can check *who* is
  writing — not a shared mutable blob anyone can fake.

So the integration story is really a *trust story*. Here is each role.

---

## 2. The sponsor technologies, by the job they do

### Anthropic — Claude (Agent SDK) · the reasoning + the guardrails
**Job:** the *trusted* reasoning/narration layer, and the two mechanisms that
actually enforce safety.

- One top-level `query()` per pipeline stage (`@anthropic-ai/claude-agent-sdk`),
  streaming **visible thinking** separately from its answer so the dashboard shows
  the agent reason, state uncertainty, and conclude.
- Each stage runs with a **scoped identity**: ambient machine config/permissions
  are stripped (`settingSources:[]`) and tools are granted per stage (most stages
  get none).
- Two stages do *real* work, not narration: the **PreToolUse guardrail** denies
  any tool call reaching a host outside the sandbox allowlist (the visible refusal),
  and the **`canUseTool` human gate** blocks the patch from being applied until a
  person clicks approve.
- **Deliberately not the exploit author, not the patcher, not the decider** — on
  the live path Claude *restates* decisions the security engine already made. Its
  prompts explicitly forbid writing exploit code (that both breaks separation of
  duties and trips server-side safety). The two security-triage stages run on
  **opus-4-8**, not opus-5-5, precisely because 5-5 blocks this security content.

_Status: implemented. With no API key it falls back to instant placeholder
narration, so the loop still runs keyless; the real reasoning lights up when
`ANTHROPIC_API_KEY` is set (verified live)._

### Featherless + Bitdeer — the offensive model · the exploit author
**Job:** host the *untrusted* open-weight model (`DeepSeek-V4.1-Flash-1017`) that
actually writes the proof-of-concept exploit.

- Lives entirely in Dev 2's Python (`security/generate/exploit.py`), called over an
  OpenAI-compatible API. **Featherless is primary; Bitdeer is the fallback** (both
  serve the same DeepSeek model); a hand-written cached PoC is the final fallback,
  so GENERATE never hard-fails on a rate-limit, refusal, or missing key.
- This is the sharp end of the trust split: *a model reading untrusted input and
  writing offensive code is a different trust domain from the model making
  decisions.* Claude never imports an exploit client; this model never makes a
  judgment call. They don't even run in the same process.

_Status: implemented (provider ordering, failover, cached fallback, and validation
of model-authored commands are real)._

### Factory — Droid (`@factory/droid-sdk`) · the patch engineer
**Job:** the autonomous engineer that writes the fix — triggered by the
orchestrator, **not** a human.

- `createSession().stream(...)` runs against the device-service directory,
  streaming Droid's **plan and real `git diff`** to the dashboard.
- **Scoped so it cannot commit, push, deploy, or run shell/network commands** —
  enforced in-process via `AutonomyLevel.Low` + a deny-by-default permission
  handler. (The repo's `.factory/settings.json` is *inert* for the SDK, so scoping
  had to be SDK-level — a verified gotcha.)
- The authority to actually touch the repo is **split into a separate tool**
  (`apply_patch`) that only runs after the human approve click. A finished Droid
  turn is explicitly **not** trusted as a fix — it must survive VERIFY.
- A recorded **cached-patch fallback** guarantees the loop closes if Droid is
  throttled or offline.

_Status: implemented; the cached fallback is the default in local runs, the live
Droid path runs with `FACTORY_API_KEY`._

### NVD/CVE + SemGrep + Bandit · ground truth and detection
**Job:** anchor the vuln in reality and detect it honestly.

- **NVD** grounds the run in a real advisory (CVE-2019-6538, missing-auth on a
  medical-device command interface) — fetched once and cached, so runs are offline.
- **SemGrep** (a custom CWE-306 rule) is the real detector = *signal*; **Bandit**
  is run as *noise/decoy*. The triage step then has to tell real from fake: a static
  match is **not accepted until a dynamic reproduce-probe** (an actual unauthenticated
  request) confirms it — keeping detection (static) and confirmation (dynamic) as
  separate authorities. This is the "starts on the scary Bandit hit, probes it,
  self-corrects to the SemGrep finding" behavior.

_Status: implemented (needs `semgrep`/`bandit` on PATH; otherwise the triage falls
back to its deterministic offline verdict)._

### SpacetimeDB (+ Convex fallback) + serial/Arduino · the realtime nervous system
**Job:** one source-of-truth `device_status` row plus pipeline tables that every
subsystem subscribes to, and the serial/firmware layer that turns that row into a
physical fan/LCD/RGB/servo.

- The design is one backend-agnostic `RealtimeBackend` interface with three
  adapters (Mock / SpacetimeDB / Convex) chosen by env. Writes only ever happen
  through **named reducers**, and the SpacetimeDB module checks `ctx.sender`
  identity on the write path — so "only the scan process may record a finding" is
  **DB-enforceable**, not just narrated. This is the third, strongest leg of the
  separation of duties.
- The physical path is a frozen serial contract (`device_status` row →
  `STATE,fan,rate,hr,spo2,alarm,rgb` frames at 115200 baud) that the Arduino
  firmware and the Python `emulate_stream` bridge both consume.

_Status: **partial — strong code, not yet running live.** The SpacetimeDB module
(9 tables + reducers + role checks), the firmware, the serial contract/bridge, and
the Python emulator bridge are all written and ready. But the live SpacetimeDB
adapter needs generated `module_bindings` (publish + `spacetime generate`), the
Convex adapter is a stub, and today **every consumer — the orchestrator, the
dashboard, the serial bridge — defaults to the Mock backend.** So the loop runs
end-to-end on an in-memory `MockRealtimeBackend` whose method shapes are identical
to the reducers; swapping in SpacetimeDB is a one-adapter change, no orchestrator
edits._

### Armadin / Microsoft / (Fetch.ai)
- **Armadin:** the verified find→exploit→fix→verify loop *is* their thesis — it's
  the whole system, not a separate integration.
- **Microsoft "Built for the Real World":** framing (pre-market/staging security
  tool with human sign-off).
- **Fetch.ai / ASI:One:** present as hackathon context but **not currently wired**
  into PreVent — no Agentverse agent / ACP integration exists in the codebase.

---

## 3. Separation of duties, enforced three ways (all real where running)

This is the claim that holds the architecture together:

1. **Agent-SDK per-stage scoping** — each Claude stage strips ambient permissions,
   gets only the tools it needs, the human gate (`canUseTool`) guards APPLY, and the
   PreToolUse guardrail denies out-of-allowlist targets. *(live)*
2. **Separate OS processes** — the decision model (Claude, TypeScript), the
   offensive model (DeepSeek via Python), and the patcher (Droid via its own SDK)
   are different processes with different credentials. *(live)*
3. **SpacetimeDB reducer identities** — the write path checks `ctx.sender`, so each
   agent can only write its own tables. *(coded in the module; live once the module
   is published — today the Mock backend stands in.)*

---

## 4. How the pieces connect (the seams)

- **Dev 1 (orchestrator, TypeScript)** is the conductor. It runs the Claude stages
  and the Factory Droid patch stage directly, and drives **Dev 2's security engine
  through one subprocess seam**: `python -m security.stage_api <stage>` returns a
  single JSON envelope (`{stage, ok, data, events}`). No security logic is
  re-implemented in TypeScript; no AI-provider client is imported there except
  Claude.
- **Dev 2 (security, Python)** owns the real work behind that seam — scanners,
  triage, the offensive model, delivery, the deterministic verifier, NVD grounding —
  reusing the exact stage functions its own headless loop uses.
- **Dev 3 (realtime)** owns the `RealtimeBackend` the orchestrator writes every row
  and event through. The **shared `device_status` row** (contract camelCase shape)
  is the single source of truth that drives the hardware, the patient sim, and the
  dashboard — so nothing can drift or be faked.
- The **human gate** closes the loop between software and people: the orchestrator's
  control server exposes an approve endpoint; the dashboard's click is what lets the
  patch apply.

```
            ┌─────────────── Dev 1 orchestrator (TS, the conductor) ───────────────┐
  Claude ───┤ narration + PreToolUse guardrail + canUseTool human gate             │
  (Agent SDK)│                                                                      │
  Factory ──┤ Droid patch stage (scoped, streamed) → apply_patch (human-gated)     │
   Droid    │                                                                      │
            │   │ subprocess seam: python -m security.stage_api <stage> → JSON      │
            └───┼──────────────────────────────────────────────────────────────────┘
                ▼
        Dev 2 security engine (Python): NVD ground · SemGrep/Bandit + triage ·
        DeepSeek exploit (Featherless→Bitdeer→cached) · deliver · deterministic verify
                │
                ▼ writes every row/event through
        RealtimeBackend  →  [ Mock (live today) | SpacetimeDB (ready) | Convex (stub) ]
                │  one shared device_status row
                ▼
        serial bridge → Arduino firmware (fan/LCD/RGB/servo)  ·  patient sim  ·  dashboard
```

---

## 5. What's live vs. coded-but-not-running (honest status)

| Piece | Status |
|------|--------|
| Full loop GROUND..RESTORE on the Mock backend | ✅ live, ~0.3s mock / ~11s real security |
| Claude narration + guardrail + human gate | ✅ live (keyless → placeholder; real with key) |
| Offensive model (Featherless→Bitdeer→cached) | ✅ live (cached without keys) |
| Factory Droid patch (cached fallback / live) | ✅ cached live; real Droid with key |
| NVD grounding + SemGrep/Bandit + triage | ✅ live (scanners on PATH) |
| SpacetimeDB module + reducers + firmware + serial | 🟡 written & ready, **not running** (needs publish/`generate`; Mock stands in) |
| Convex adapter | 🟡 stub |
| Fetch.ai / ASI:One | ⬜ not integrated |

---

## 6. Run it

```bash
cd agents
# Mock loop, no keys:
ANTHROPIC_API_KEY= FACTORY_API_KEY= pnpm dev
# Real security engine (needs the 3.13 venv + semgrep/bandit on PATH):
PREVENT_SECURITY=python PREVENT_PYTHON="<repo>/.venv/Scripts/python.exe" pnpm dev
# Dev 2 tests:  PYTHONUTF8=1 <repo>/.venv/Scripts/python.exe -m pytest security/tests -q
```

Device-service runs on **port 8071** (macOS reserves 5000 for AirPlay).
