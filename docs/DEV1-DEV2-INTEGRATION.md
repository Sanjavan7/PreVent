# PreVent — Dev 1 ↔ Dev 2 integration (high-level)

_A plain-English map of what is built, how the pieces connect, and what actually
works today. Written for Christian to understand the whole picture at a glance._

Last verified: 2026-10-24 on the Windows dev box (branch `dev1-pipeline-agents`, local).

---

## 1. What PreVent is (one breath)

An autonomous loop of AI agents that **finds, exploits, patches, and verifies** a
real security flaw in a medical "Device Control Service" (a fan standing in for a
ventilator) — and does it with a **human-approval gate** and a **sandbox that
visibly refuses** to touch anything out of scope. The flaw is CWE-306 (missing
authentication): anyone can POST a command with no token, stop the fan, and make
the device keep reporting normal vitals — i.e. the device **lies** while the
patient crashes.

The loop:

```
GROUND → SCAN → GENERATE → DELIVER → (judge presses IR remote) → PATCH
       → [sandbox refusal beat] → HUMAN GATE → APPLY → VERIFY → RESTORE
```

---

## 2. Who owns what

| Role | Owns | Language |
|------|------|----------|
| **Dev 1 (you/me)** | The **orchestrator** — the conductor that runs the loop, streams agent reasoning, enforces the human gate + sandbox refusal, runs the Factory Droid patch stage, manages timing. | TypeScript (`agents/`) |
| **Dev 2 (Israel)** | The **real security logic** — scanners, triage, exploit generation, delivery, deterministic verification, and the Flask device-service itself. | Python (`security/`, `device-service/`) |
| **Dev 3** | Realtime + dashboard + hardware (SpacetimeDB, the physical fan/board). | (separate) |

**The whole point:** Dev 1 doesn't *reimplement* security in TypeScript. It
**drives** Dev 2's Python as a subprocess and narrates/gates/visualizes it.

---

## 3. The seam between Dev 1 and Dev 2 (the decision Israel asked about)

**Decision: subprocess CLI — and it's already built.** Israel built
`security/stage_api.py`. The orchestrator runs:

```
python -m security.stage_api <ground|scan|generate|deliver|verify|restore> [--base-url …] [--input …] [--payload …]
```

Each call prints **one JSON object** `{stage, ok, data, events}` on stdout. `data`
is a superset of the shape the orchestrator expects; `events` is the narration
trail (the triage reasoning, the observed device impact, the verify checklist)
which the orchestrator logs straight onto the dashboard.

On the Dev 1 side this lives in `agents/src/security/stages.ts`:
- `MockSecurityStages` — the **default**. Returns canned shapes so the whole loop
  runs with **zero Python, zero keys** (for quick dashboard/UI work).
- `PythonSecurityStages` — the **real path**, switched on with
  `PREVENT_SECURITY=python`. Shells out to `stage_api`. If Python is missing or a
  call fails, it **falls back to the mock** so a demo never hard-crashes.

This is the only contract the two sides share. Either can be rebuilt behind it.

---

## 4. What happens each stage (and who does it)

| Stage | What happens | Who |
|------|--------------|-----|
| **GROUND** | Pull the real CVE this is modeled on (CVE-2019-6538, a Medtronic CWE-306) with CVSS/CWE context. | Dev 2 (`ground.py`) |
| **SCAN** | Run SemGrep + Bandit, then **triage**: it deliberately starts on a tempting Bandit decoy (a HIGH "weak MD5" smell), *probes* it, finds it isn't exploitable, **self-corrects**, and lands on the real SemGrep CWE-306 finding. | Dev 2 (`run_scanners.py` + `triage.py`) |
| **GENERATE** | Author a proof-of-concept payload (a model writes it live via Featherless; falls back to a cached PoC with no key). | Dev 2 (`exploit.py`) |
| **DELIVER** | Fire the unauthenticated command at the live device-service → fan stops, true vitals crater (38/61) while the device still reports 72/98 and never alarms. | Dev 2 (`deliver.py`) → the orchestrator pushes the resulting device row to the dashboards/hardware. |
| **IR event** | A judge physically presses an IR remote to trigger the attack (injected via the control server's `/ir` route if no hardware). | Dev 3 / orchestrator |
| **PATCH** | **Factory Droid** proposes a scoped diff that adds auth. It streams its reasoning and **cannot commit, push, or deploy** (deny-by-default). | Dev 1 (`factory/runDroid.ts`) |
| **Sandbox refusal** | An agent reaches for a *second* ventilator outside the allowlist — the guardrail **denies it on screen**: `ACTION REFUSED — out of scope`. | Dev 1 (`guardrail.ts`) |
| **HUMAN GATE** | Nothing is applied until a human clicks **APPROVE & DEPLOY** on the dashboard (POST `/approve`). No auto-timer in a real run. | Dev 1 (`humanGate.ts` + `controlServer.ts`) |
| **APPLY** | The approved patch is applied to the device-service. | Dev 1 (`tools/apply_patch.ts`) |
| **VERIFY** | Re-run the exact exploit against the **patched** service → now rejected (HTTP 401), true state unchanged, no lie. A verifier that always passes is worthless, so this is deterministic. | Dev 2 (`verify.py`) |
| **RESTORE** | Revert the device-service to its clean vulnerable state so the whole thing can run again 10+ times for roving judges. | Dev 1 (git-scoped revert) + Dev 2 (healthy reset) |

**One subtlety Dev 1 handles for the real demo:** when Droid patches `app.py`, the
*running* Flask process still holds the old code. So before VERIFY the orchestrator
**restarts the device-service in patched mode** (`DeviceServiceController`). That's
why VERIFY actually sees the fix instead of a stale process.

---

## 5. What works **today** (verified, not aspirational)

Run on this Windows box, branch `dev1-pipeline-agents`:

- ✅ **Full loop, mock mode, zero keys** — completes in ~0.3s; the sandbox refusal
  fires with the exact `ACTION REFUSED — out of scope` wording.
- ✅ **Repeatability** — 10/10 runs, max ~0.35s (well under the 90s budget).
- ✅ **Full loop, REAL Python security** (`PREVENT_SECURITY=python`) — completes
  end-to-end in ~11s with the orchestrator managing the device-service:
  - GROUND real CVE card ✓
  - SCAN real (SemGrep 1 + Bandit 3) with the **self-correcting triage** visible ✓
  - GENERATE real cached PoC ✓
  - DELIVER real exploit → HTTP 200, fan off, device lying ✓
  - restart patched → VERIFY real → **HTTP 401, all checks pass** ✓
  - RESTORE clean ✓
- ✅ **Dev 2's full test suite: 49/49 passing** on this machine.
- ✅ **Droid patch path** — cached fallback diff applies cleanly; the gate blocks
  until approval; Droid is sandboxed from commit/push/deploy.
- ✅ TypeScript typechecks clean.

### What still needs doing (honest list)
- **Dev 3 realtime/hardware** — the dashboard + SpacetimeDB + physical fan.
  (`emulate_stream.py` already bridges the device row to serial frames with no board.)
- **Live Claude narration + live Droid** — verified by design but not exercised
  here (needs `ANTHROPIC_API_KEY` / `FACTORY_API_KEY`; narration is non-fatal and
  uses opus-4-8, not opus-5-5, because 5-5 blocks this security content).
- **Merge Israel's PR #2** (the `stage_api`/`emulate_stream` bridges) into `main`
  — currently integrated **locally** on this branch; GitHub says it merges cleanly.
- **A couple of Dev 2-side robustness nits** (worth telling Israel): the Windows
  cp1252 decode in `run_scanners.py` — worked around from our side with UTF-8 mode,
  but cleaner to fix at source; and a partial-row edge case in `verify.py`'s public
  fallback. Neither blocks the demo.

---

## 6. How to run it yourself

```bash
# Mock loop, no keys, instant:
cd agents
ANTHROPIC_API_KEY= FACTORY_API_KEY= pnpm dev

# Real security loop (needs the Python venv + semgrep/bandit on PATH):
ANTHROPIC_API_KEY= FACTORY_API_KEY= \
  PREVENT_SECURITY=python \
  PREVENT_PYTHON="<repo>/.venv/Scripts/python.exe" \
  pnpm dev

# Dev 2 tests:
PYTHONUTF8=1 <repo>/.venv/Scripts/python.exe -m pytest security/tests -q
```

The device-service runs on **port 8071** (not 5000 — macOS reserves that for AirPlay).
