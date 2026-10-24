# PLAN — FOUNDATION (H0–H2, all 4 people together, before anyone splits)

> Project: **PreVent** — Autonomous Medical-Device Security Pipeline · Cal Hacks 13.0.
> Master plan (full context): `plans/PLAN-MASTER.md`.
> **Goal of this file:** stand up a working skeleton + the two frozen contracts + prove the 3 risky externals, so Dev 1 / Dev 2 / Dev 3 / Hardware can then work in parallel without blocking. All code is written **during** the event (eligibility); this file is ideation/reference.

## What we're building (1 paragraph)
A pipeline of AI agents that, on a real but harmless Arduino-driven "ventilator," runs one loop live on a split screen: **GROUND** a real CVE → **SCAN** the device code (SemGrep/Bandit, Claude picks the real flaw) → **GENERATE** an exploit (Bitdeer) → **DELIVER** it (judge presses an IR remote; device obeys an unauthenticated command — fan stops, device lies) → **PATCH** (Factory Droid writes the fix) → **HUMAN GATE** → **VERIFY** (re-run the exploit; now 401) → **RESTORE**. One shared `device_status` row drives the hardware, the left patient sim, and the right "no black box" dashboard. Honest framing: pre-market/staging tool, sandbox-only, human sign-off, a desk fan that **models** a missing-auth vuln class (not a real ventilator).

## Team split (who owns what after H2)
- **Dev 1 — Pipeline & Agents:** orchestrator, Claude Agent SDK stage runner, streaming, human gate, separation-of-duties, the Factory Droid patch stage. → `agents/`
- **Dev 2 — Security & Verification:** vulnerable+patched device-service, SemGrep/Bandit + scan triage, Bitdeer exploit + deliver, deterministic verifier, NVD grounding. → `device-service/`, `security/`
- **Dev 3 — Realtime, Dashboard & Sim:** SpacetimeDB module + reducers + `RealtimeBackend` abstraction (+ Convex fallback), the right dashboard, the left 2D sim (+ cuttable 3D hero). → `realtime/`, `app/`
- **Hardware — Actuation + Emulator:** Arduino firmware, Node serial bridge, software emulator. → `firmware/`, `serial-bridge/`, `emulator/`

## Tasks (do IN THIS ORDER)

### 1. Grab keys/accounts (parallelize across the 4 people)
- **Anthropic:** `console.anthropic.com` → `ANTHROPIC_API_KEY`.
- **Factory:** sign in `app.factory.ai` → `app.factory.ai/settings/api-keys` → `fk-...`. **Put a card on the plan NOW** (Pro $20/mo or prepaid Extra Usage $10 min) — the key does no real work unpaid.
- **Bitdeer:** `bitdeer.ai` → create account → **submit the credit-request form** → Model Studio → API Keys. Confirm credit amount/limits/model id at the booth ("Supercharging Your Hackathon Project with Bitdeer Model Studio").
- **NVD:** `nvd.nist.gov/developers/request-an-api-key` (email-verified; optional — keyless works for one CVE).
- **SpacetimeDB:** redeem **`CALHACKS13`** at `spacetimedb.com/redeem` (100k TeV free). Confirm **Armadin / Convex / Microsoft** track criteria at their booths.

### 2. Repo
- `git init` a **pnpm workspace monorepo**; pick the **project name** (default **PreVent**).
- Create `device-service/` as its **OWN git repo** (so RESTORE's git-revert never touches other devs' work).
- Write `.env.example` (below), `.gitignore` (`.env*`, `node_modules`, `/recordings`), `README.md` stub (7 sections: problem, solution, Droid usage, Claude/STDB/Bitdeer roles, real-vs-sim honesty, setup, demo video).
- Folder layout:
```
preveNT/
├─ contracts/        # FROZEN here in step 3
├─ realtime/   (Dev3)  spacetimedb/src/index.ts ; src/backend/{RealtimeBackend,spacetime,convex}.ts ; convex/
├─ agents/     (Dev1)  src/orchestrator.ts ; src/stages/runStage.ts ; src/tools/report_decision.ts ; src/factory/runDroid.ts ; src/humanGate.ts
├─ device-service/ (Dev2, own git)  app.py ; rules/missing-auth.yaml ; .factory/settings.json
├─ security/   (Dev2)  scan/ ; generate/ ; deliver.py ; verify.py ; ground/
├─ serial-bridge/ (HW, Node)
├─ firmware/   (HW)   uno_actuator.ino
├─ emulator/   (HW)
└─ app/        (Dev3)  Vite+React split-screen
```

### 3. FREEZE `contracts/` (the hard dependency for everyone)
Create `contracts/` with: shared TS types for every table (§ below), the **serial-schema constant** (incl. the true-vs-reported mapping), and **mock fixtures** for every table so each dev codes against mocks until the real producer exists.

**3a. Shared-state tables (SpacetimeDB TS module, package = unscoped `spacetimedb`):**
```
device_status  (SINGLE SOURCE OF TRUTH, one row id=1)
  id u64 pk | fan_on bool(TRUE→drives fan) | true_hr u32 | true_spo2 u32
  reported_hr u32 | reported_spo2 u32 (DISPLAYED — can be a lie) | alarm_active bool | compromised bool
  last_command string | updated_at timestamp
agent_status  id u64 pk | agent_name | stage(ground|scan|generate|deliver|patch|verify|restore)
  state(idle|running|waiting_for_human|done|error) | reasoning(streamed) | confidence f32 | uncertainty | updated_at
findings  id u64 pk | scanner(semgrep|bandit) | cve_ref | file | line u32 | severity | claude_verdict | is_the_real_one bool | created_at
exploit_runs  id u64 pk | finding_id | model_id | payload_ref | delivered_at | device_impact | success bool
patch_attempts  id u64 pk | finding_id | diff_ref | droid_session | proposed_at | human_approved bool | applied_at
event_log  id u64 pk(auto) | ts | actor | text        (append-only; every reducer also inserts here)
ir_events  id u64 pk(auto) | ts | code u32 | consumed bool
```
Reducers (each also inserts `event_log`): `updateDeviceStatus` (ONLY writer of the device row), `updateAgentStatus`, `recordFinding` (scan identity only — enforce via `ctx.sender`), `recordExploitRun`, `recordPatchAttempt`, `approvePatch`, `logEvent`, `pushIrEvent`, `resetHealthy`.

**3b. Device-service API + serial schema:**
```
GET  /device/status -> 200 { fan_on, reported:{hr,spo2}, alarm }
POST /device/command (VULNERABLE: no auth) { action:"stop_fan"|"set_rate"|"resume", reported_overrides:{hr,spo2,alarm} } -> 200
#  exploited: fan_on→false while reported stays normal, alarm:false (lies).  patched: no token -> 401/403; overrides ignored.

SERIAL 115200 baud, line-based \n, colon/comma, NO JSON, fixed buffer + strtok.
 OUT host→UNO:  STATE,fan=<0|1>,rate=<0-255>,hr=<int>,spo2=<int>,alarm=<0|1>,rgb=<0|1|2>\n   (rgb 0=green 1=red 2=amber)
                SRV,angle=<0-180>\n
 IN  UNO→host:  READY\n   IR,code=<uint32>\n   HB\n
Mapping constant: fan=true_state.fan_on, rate=true, hr/spo2=reported_*, alarm=alarm_active, rgb from compromised.
```

### 4. Smoke-test the 3 risky externals (any one wrong at H0 cascades)
1. **Claude model IDs:** `curl https://api.anthropic.com/v1/models?limit=100 -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2026-10-21"` → confirm `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` are Active; pin them in **ONE** `contracts/models.ts` constant (+ fallback `claude-opus-4-8`). Pin `@anthropic-ai/claude-agent-sdk@0.3.310`.
2. **SpacetimeDB:** Windows `irm https://windows.spacetimedb.com -useb | iex` → **open a NEW terminal** → `spacetime install 2.13.0; spacetime version use 2.13.0` → `spacetime dev --template react-ts` in a space-free dir (e.g. `C:\dev\stdb`) → confirm subscribe + reducer round-trip. Install the Claude Code plugin (`claude plugin marketplace add clockworklabs/SpacetimeDB` → `claude plugin install spacetimedb@spacetimedb-plugins`) + `spacetime mcp`.
3. **Factory:** `npm install -g droid` (PowerShell) → `droid --version` + `droid rules check`; `npm i @factory/droid-sdk`; run one real `createSession().stream()` and **save its message events** to design the UI parser.

### 5. Hello-world firmware
Flash a sketch that prints `READY` at 115200 and toggles the onboard LED when it receives a `STATE,...` line. Confirm the host can open the port and read `READY`.

### 6. Demo logistics agreed up front
- Define the **H-time budget** + the **<90s express path** for rushed judges; assign the **one-key reset** owner.
- Agree the **honesty/framing doc** (everyone pitches identically): no confirmed death from a *device* hack; stats are vendor estimates; it's a fan that **models** missing-auth; CVE-2019-6538 is adjacent-radio not remote; **§524B** not "PATCH Act"; separation-of-duties enforced by Agent-SDK scoping + separate processes + `ctx.sender` (all real).

## `.env.example`
```
ANTHROPIC_API_KEY=sk-ant-...
FACTORY_API_KEY=fk-...
BITDEER_API_KEY=...
BITDEER_BASE_URL=https://api-inference.bitdeer.ai/v1
NVD_API_KEY=                      # optional (header apiKey:)
DEVICE_SERVICE_URL=http://localhost:5000
SANDBOX_ALLOWLIST=127.0.0.1,localhost
ARDUINO_SERIAL_PORT=COM3
VITE_REALTIME_BACKEND=spacetimedb
VITE_SPACETIMEDB_URI=ws://localhost:3000
VITE_SPACETIMEDB_MODULE=prevent
VITE_CONVEX_URL=
```
`git status` must show no `.env*` staged before submit.

## Shared tooling
Node ≥22.12, pnpm, Python 3.11–3.13 venv (semgrep/bandit wheels stop at 3.14; the machine default 3.15 is too new — use `uv`/`pipx --python 3.13`), Arduino IDE 2.x + `IRremote` v4, `droid` CLI + `@factory/droid-sdk`, SpacetimeDB Claude Code plugin + `spacetime mcp`, OBS. Pin exact versions + commit the lockfile + warm `npm ci`.

## Acceptance (foundation is done when)
A dashboard tab shows a mock `device_status` row updating live; one `@factory/droid-sdk` run produced a real streamed diff; the board blinks from a typed serial line; `contracts/` is committed and imported by at least one mock on each of the four sides.
