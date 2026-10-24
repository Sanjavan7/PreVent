# Cal Hacks 13.0 — Master Build Plan: Autonomous Medical-Device Security Pipeline

> **This plan file is the master.** On approval I will create **5 repo files** from it —
> `plans/PLAN-FOUNDATION.md`, `plans/PLAN-DEV1-pipeline-agents.md`, `plans/PLAN-DEV2-security-verification.md`,
> `plans/PLAN-DEV3-realtime-frontend.md`, `plans/PLAN-HW-arduino.md` — then (on your go) launch a foundation
> implementation workflow. Everything below is the content that goes into those files.

---

## 0. Context — why we are building this and what "done" looks like

**The problem.** Ransomware hits hospitals harder than any other critical-infrastructure sector (FBI/IC3: 460 US healthcare attacks in 2025), and the unpatchable surface it pivots through is the hospital's own medical devices (~10–15 connected devices/bed; ~53% carry a known critical vuln — vendor estimates). FDA **section 524B** (2023) now makes a repeatable find-and-fix process a *condition of clearing a cyber device*. That is a tooling market.

**What we build.** A pipeline of specialized AI agents that runs ONE loop end-to-end and shows its work on a live split screen: **GROUND** a real CVE → **SCAN** the device software (SemGrep/Bandit) and let Claude reason which finding is the real one → **GENERATE** a proof-of-concept exploit (Bitdeer open model) → **DELIVER** it so the device is genuinely compromised → **PATCH** with the Factory `droid` CLI (visible diff) → **HUMAN GATE** → **VERIFY** deterministically (re-run the exact exploit; it must now fail) → **RESTORE**. Framed as a **pre-market / staging** tool with a human sign-off — never auto-patching live clinical devices.

**The emotional anchor.** A deliberately vulnerable **"Device Control Service"** (host laptop) is the network attack surface; an **Arduino UNO R3** is its physical body — a relay/L293D **fan = ventilator**, LCD + 7-seg vitals, buzzer alarm, RGB status light, on a **mask-and-tube prop the judge holds**. Split screen: **LEFT** = immersive hospital/patient view (the judge is the patient, ground truth of what's really happening); **RIGHT** = the "no black box" agent + security dashboard. One shared-state row drives the hardware **and** both panels, so nothing can be faked or drift.

**The one moment that wins the room.** The judge presses an **IR remote** button to pick the payload → the exploit fires → the **fan stops (the patient truly crashes) while the device keeps reporting normal vitals and never alarms (it lies)** → the agent surfaces its uncertainty and waits for a human OK → the **same exploit is re-run and now fails** → the device recovers.

**"Done" =** the full loop runs live on real hardware, repeatably (~10+ times over the 2h roving window), on a judge-chosen input; the exploit achieves a real **control+integrity** effect (not a crash) and the verifier proves it's closed; the right panel shows every agent's reasoning + the real artifacts including **one caught mistake**; the framing (pre-market, sandbox, human sign-off, honest claims) holds throughout; and we have a backup recording.

**Target prizes (one build, many tracks):** First Overall, Most Technically Advanced, Best Hardware, Best People-First Social Impact + sponsor tracks **Anthropic, Factory, SpacetimeDB, Armadin, Bitdeer, Microsoft "Built for the Real World."**

**Decisions you confirmed:** Fund Factory before the event (+ cached-patch fallback). Output = Foundation + 3 dev + 1 hardware plan files.

**Project name — pick one at H0** (needed for README/Devpost/module name): **PreVent** (pre-market + ventilator — leading suggestion), or Aegis, Verdict, CleanRoom, Immunize, Patch-Zero. Placeholder below: **PreVent**.

---

## 1. Stack decisions (final — override any at approval)

| Decision | Choice | Why |
|---|---|---|
| Exploit-gen model | **Bitdeer** open model writes the PoC; **Claude** is the scan/triage/verify reasoning core | Wins Bitdeer track; avoids Claude hedging on PoC text; makes "model reading untrusted input ≠ model writing exploit" a *real* separation-of-duties beat |
| Realtime DB | **SpacetimeDB 2.x TypeScript module** behind a `RealtimeBackend` interface; **Convex** adapter kept warm; hard gate at ~1/3 | Anchor sponsor; runs fully local (no venue-WiFi dependency); reducer model gives a write-path audit trail for free |
| Serial bridge language | **Node/TypeScript** (`serialport` + SpacetimeDB TS client) | SpacetimeDB has **no Python client**; Node keeps SpacetimeDB primary |
| Agent framework | **Claude Agent SDK** (TS), **one `query()` per stage**, code-orchestrated, no nested subagents | SDK ships the loop, per-stage tool scoping, the human-gate callback, hooks; nested subagents can't stream token deltas (would break the live-reasoning dashboard) |
| Frontend sim | **2D-first** (Vite+React 19, PixiJS, Canvas/SVG waveforms) as the reliable baseline; **cuttable 3D "hero" shot added by coding agents** (R3F; Spline optional) | 2D ≈90% of the wow at ~30% effort/risk; the live monitor stays 2D for legibility; 3D is upside that never gates the demo |
| Fan actuation | **L293D PWM** | Breathing *rhythm* not flat on/off; internal flyback diodes (no external diode); same 1-pin cost as relay |
| Board | **UNO R3 over USB serial**; ESP32 is stretch-only | Wired serial is deterministic — removes the WiFi-drop risk that killed the Pico plan |
| Exploit target framing | **Generic `Device Control Service` demonstrating CWE-306**; CVE-2019-6538 cited read-only as grounding | Keeps 100% technical/demo value; avoids a safety classifier stopping on real-product-named exploit code; pitch still says "modeled on real missing-auth medical-device vulns" |
| Patch agent | **Factory `@factory/droid-sdk`** (`createSession().stream()`, funded) + **cached-patch fallback** | Official hackathon SDK: streams Droid's plan/diff live to the dashboard, real autonomous repo work, scoped; fallback guarantees the loop closes under a rate-limit |
| Buzzer / display | **Passive buzzer** (`tone()`, rising-urgency alarm — silence *is* the point when it lies); **LCD1602 text + 4-digit 7-seg hero number** | Variable-pitch alarm; LCD shows labels, 7-seg reads the crash from across the room |

---

## 2. The two foundation contracts (FROZEN at H0–H2, before anyone splits)

Live in `contracts/`. Everyone codes against these with mocks until the real producers exist. **Table/field shapes are identical on SpacetimeDB and Convex so `RealtimeBackend` stays one adapter file.** Writes only ever happen through named reducers.

### 2a. Shared-state tables (SpacetimeDB TS module — package is the **unscoped `spacetimedb`**)

```
device_status   // SINGLE SOURCE OF TRUTH — exactly one row, id = 1
  id u64 pk(=1) | fan_on bool (TRUE state → drives physical fan) | true_hr u32 | true_spo2 u32
  reported_hr u32 | reported_spo2 u32 (what the device DISPLAYS — can be a lie)
  alarm_active bool (false during exploit = the silence beat) | compromised bool
  last_command string | updated_at timestamp

agent_status    // one row per pipeline agent
  id u64 pk | agent_name string | stage string (ground|scan|generate|deliver|patch|verify|restore)
  state string (idle|running|waiting_for_human|done|error) | reasoning string (streamed, accumulated text_delta)
  confidence f32 (from report_decision tool) | uncertainty string | updated_at timestamp

findings        // written ONLY by scan/triage agent, NEVER the patch agent
  id u64 pk | scanner string (semgrep|bandit) | cve_ref string (display-only) | file string | line u32
  severity string | claude_verdict string | is_the_real_one bool | created_at timestamp

exploit_runs    id u64 pk | finding_id u64 | model_id string | payload_ref string | delivered_at ts | device_impact string | success bool
patch_attempts  id u64 pk | finding_id u64 | diff_ref string | droid_session string | proposed_at ts | human_approved bool | applied_at ts
event_log       id u64 pk(auto) | ts timestamp | actor string | text string   // append-only; every reducer also inserts here
ir_events       id u64 pk(auto) | ts timestamp | code u32 | consumed bool      // judge IR-remote payload picks (bridge → orchestrator)
```

**Reducers (each also inserts into `event_log`):** `updateDeviceStatus(...)` (ONLY writer to the device row — called by the host service), `updateAgentStatus(...)`, `recordFinding(...)` (scan process only), `recordExploitRun(...)`, `recordPatchAttempt(...)`, `approvePatch(id, approved_by)`, `logEvent(actor, text)`, `pushIrEvent(code)` (serial bridge → orchestrator), `resetHealthy()` (one-key reset between judges). **Separation of duties is DB-enforceable:** each agent process connects with its own SpacetimeDB identity and reducers check `ctx.sender` (e.g. `recordFinding` rejects any caller that isn't the scan identity) — so the write-path restriction is real, not just narrated. External calls (Claude/Bitdeer/NVD) can also run server-side as **procedures** (`ctx.http.fetch`, ≤180s) if we want them transactional, though the Agent-SDK stages stay in the Node orchestrator (the "agent as client" pattern from the SpacetimeDB deck).

**Client (VERIFIED 2026-10-24):** the browser/React client is the **same unscoped `spacetimedb@2.13.0`** package (old `@clockworklabs/spacetimedb-sdk` is deprecated). Server module imports come from `spacetimedb/server`; the **React hooks subpath `spacetimedb/react` DOES ship** — use `SpacetimeDBProvider` (pass the `DbConnection.builder()...` builder, do **not** call `.build()` yourself), `useTable(tables.x)` → `[rows, isReady]`, `useReducer(reducers.x)` → async fn, `useSpacetimeDB()`. **No hand-rolled `useSyncExternalStore` needed.** React peer ^18||^19. Avoid HS256 JWTs (rejected since 2.12).

### 2b. Device-service HTTP API + host↔Arduino serial schema

Vulnerable **Device Control Service** = Flask/FastAPI on the host. Holds `true_state` and `reported_state` separately.

```
GET  /device/status  -> 200 { fan_on, reported:{hr,spo2}, alarm }
POST /device/command  (VULNERABLE: no auth check)
     { action: "stop_fan"|"set_rate"|"resume", reported_overrides:{hr,spo2,alarm} }  -> 200 {ok:true}
# EXPLOITED (unauthenticated POST): fan_on→false (patient crashes) while reported stays {72,98}, alarm:false (lies)
# PATCHED: POST without a valid token -> 401/403; reported_overrides from untrusted callers -> ignored
```

**Serial (115200 baud, line-based `\n`-terminated, colon/comma — NO JSON, NO Arduino String class; fixed buffer + `strtok`).** Shared by exploit, verifier, host service, firmware, AND the emulator. **Freeze the true-vs-reported mapping as a shared constant:** `fan=true_state.fan_on`, `rate` from true state, `hr/spo2=reported_*`, `alarm=alarm_active`, `rgb` from `compromised`.

```
OUTBOUND host→Arduino:  STATE,fan=<0|1>,rate=<0-255>,hr=<int>,spo2=<int>,alarm=<0|1>,rgb=<0|1|2>\n   (rgb 0=green 1=red 2=amber)
                        SRV,angle=<0-180>\n            # optional bellows servo
INBOUND  Arduino→host:  READY\n (once after setup)   IR,code=<uint32>\n (judge payload pick)   HB\n (~1/s heartbeat)
```
Bridge **opens the port once, waits for `READY` before sending** (opening the port pulses DTR and resets the UNO).

---

## 3. Repo structure + shared tooling (built at H0–H2, all 4 together)

```
preveNT/                          # pnpm workspace monorepo, git-initialized (Droid needs git)
├─ package.json / pnpm-workspace.yaml / .env.example / .gitignore(.env*,node_modules,/recordings) / README.md
├─ contracts/                     # 2a + 2b FROZEN — shared TS types, serial-schema constant, mock fixtures
├─ realtime/        (DEV 3)       spacetimedb/src/index.ts ; src/backend/{RealtimeBackend.ts,spacetime.ts,convex.ts} ; convex/
├─ agents/          (DEV 1, TS)   src/orchestrator.ts ; src/stages/runStage.ts ; src/tools/report_decision.ts ; src/factory/runDroid.ts ; src/humanGate.ts
├─ device-service/  (DEV 2, Py)   app.py ; rules/missing-auth.yaml ; .factory/settings.json   ← OWN GIT REPO (safe RESTORE)
├─ security/        (DEV 2)       scan(semgrep+bandit+triage) ; generate(bitdeer) ; deliver.py ; verify.py (deterministic) ; ground(nvd cache)
├─ serial-bridge/   (HW, Node)    subscribes device_status → serialport ; pushes ir_events
├─ firmware/        (HW)          uno_actuator.ino
├─ emulator/        (HW)          software device emulator (same serial schema, no board)
└─ app/             (DEV 3)       Vite+React split-screen (left sim + right dashboard)
```

**Shared tooling:** Node ≥22.12 (avoids `undici` peer-dep; confirm laptop version), pnpm, **Python 3.11–3.13 venv** for device-service/security (semgrep/bandit wheels stop at 3.14; the machine default 3.15 is too new — use `uv`/`pipx --python 3.13`), Arduino IDE 2.x + `IRremote` v4.x, the `droid` CLI + `@factory/droid-sdk`, the **SpacetimeDB Claude Code plugin + `spacetime mcp`** (so coding agents know the API), OBS. **Pin exact versions at install (see §11) + commit the lockfile + warm `npm ci` (venue WiFi).** Prettier + a trivial GitHub Actions typecheck. One-key **reset-to-healthy** script.

**`.env.example`:** `ANTHROPIC_API_KEY`, `FACTORY_API_KEY`, `BITDEER_API_KEY`, `BITDEER_BASE_URL`, `NVD_API_KEY`(optional), `DEVICE_SERVICE_URL`, `SANDBOX_ALLOWLIST=127.0.0.1,localhost`, `ARDUINO_SERIAL_PORT=COM3`, `VITE_REALTIME_BACKEND=spacetimedb`, `VITE_SPACETIMEDB_URI=ws://localhost:3000`, `VITE_SPACETIMEDB_MODULE=prevent`, `VITE_CONVEX_URL=`. `git status` must show no `.env*` staged before submit.

**⚠️ Three externals to smoke-test in H0–H2 before anyone splits (any one wrong cascades):** (1) exact **Claude model IDs** — run `GET /v1/models` on the demo laptop, pin real IDs in ONE config constant, keep a fallback string; (2) **SpacetimeDB** version + `spacetime init --lang typescript` → publish → subscribe → reducer loop; (3) **funded + unthrottled Factory** — `droid --version`, install `@factory/droid-sdk`, one real `createSession().stream()` run to capture the message-event shape (+ `droid rules check`).

---

## 4. End-to-end sequence (owner · rows changed · hardware path)

*(Security stages GROUND/SCAN/GENERATE/DELIVER/VERIFY/RESTORE are authored by DEV 2 and run through DEV 1's orchestrator/`runStage`; PATCH + the human gate are DEV 1; rows/reducers are DEV 3's.)*
1. **GROUND** (DEV2, Claude Haiku via runStage, WebFetch NVD 2.0, **cached locally** after first fetch) → `agent_status(ground,done)`, grounding card.
2. **SCAN** (DEV2, Claude Opus, tools Read/Grep/Bash) runs **Bandit** (noise) + **SemGrep `missing_auth.yml`** (the one true CWE-306 signal), `--json`. Claude reasons which is real → `recordFinding(...)`. **This is the scripted wrong-then-caught beat:** a deterministic *reproduce-the-finding probe* shows the Bandit pick does NOT reproduce → contradiction written to `event_log` → self-correct to the SemGrep finding. (Rehearsed code path, not emergent.)
3. **GENERATE** (DEV2, separate process → **Bitdeer** `POST /v1/chat/completions`) drafts the PoC: unauthenticated `POST /device/command {action:"stop_fan", reported_overrides:{hr:72,spo2:98,alarm:false}}`. Auto-failover to a **cached known-good PoC** on any error/refusal → `recordExploitRun(...)`.
4. **DELIVER** (DEV2 `deliver.py`, optionally fired by judge `IR,code=` via `ir_events`) hits `/device/command`; service flips `true_state.fan_on=false`, overwrites `reported_state` with the lie, calls `updateDeviceStatus(...)`. **Propagation:** service → `serial-bridge` (subscribed) → `STATE,fan=0,...,alarm=0,rgb=1` → Arduino stops fan, LCD still shows normal, buzzer silent, RGB red. Both panels + hardware react from one row.
5. **PATCH-PROPOSE** (DEV1) calls `@factory/droid-sdk` `createSession().stream("<fix CWE-306 on /device/command>")` on `cwd=device-service`, streaming Droid's plan/steps/diff live → `agent_status(patch)`; scoped (autonomy/`permissionRules`) so it can't commit/push/deploy; the real `git diff` → `patch_attempts(...)`. **Fallback:** cached patch diff + replayable Droid session if Droid is down/throttled.
6. **HUMAN GATE** — real click; `approvePatch(...)`; `agent_status(patch, waiting_for_human→done)`.
7. **APPLY** — orchestrator applies/commits the approved patch, restarts the patched service.
8. **VERIFY** (DEV2 `verify.py`, deterministic, non-AI) — re-sends the **byte-identical** exploit; asserts (a) status 401/403 not 200, (b) `true_state` unchanged, (c) `reported==true`. All pass = PASS → `exploit_runs(success=false)`. Row flips back → fan resumes, vitals true, alarm armed, rgb green.
9. **RESTORE** — revert the **device-service git repo** to clean pre-patch state + `resetHealthy()` for the next judge. (Scoped to device-service so it never touches other devs' work.)

---

## 5. THE FIVE PLAN FILES (full content)

### 5.1 `plans/PLAN-FOUNDATION.md` — H0–H2, all 4 together (nobody splits yet)

**Goal:** a working skeleton + frozen contracts + the 3 risky externals proven, so the 3 software devs + HW can work in parallel without blocking.

Tasks (do in this order):
1. **Keys at booths/workshops** (parallelize across people): Anthropic (`console.anthropic.com` → `ANTHROPIC_API_KEY`); **Factory** (`app.factory.ai/settings/api-keys` → `fk-...`; **put the card on the plan now** so the key does real work); Bitdeer (`bitdeer.ai` console → API Keys; confirm credit/rate-limit/model id at booth); NVD key (email-verified; ideally before event); SpacetimeDB starter pack. Confirm **Armadin/Convex/Microsoft** criteria at their booths ("coming soon").
2. **Repo**: `git init` monorepo + pnpm workspace; pick the **project name**; create `device-service/` as its **own git repo**; `.env.example` + `.gitignore`.
3. **FREEZE contracts/** (§2a+2b): shared TS types, the serial-schema constant (incl. the true-vs-reported mapping), mock fixtures for every table. This is the hard dependency for everyone.
4. **Smoke-test the 3 externals** (§3 warning): pin real Claude model IDs in `contracts/models.ts`; `spacetime dev --template react-ts` → subscribe → reducer round-trip (redeem Maincloud `CALHACKS13`; install the SpacetimeDB Claude Code plugin + `spacetime mcp`); `droid --version` + install `@factory/droid-sdk` + one real `createSession().stream()` run (save its message events to build the UI parser).
5. **Hello-world firmware**: flash a sketch that prints `READY` and blinks on a `STATE,...` line at 115200.
6. **Define the H-time budget + the "express" <90s narration path** (wall-clock risk) and assign the one-key reset owner.
7. **Agree the honesty/framing doc** (§7) — everyone must pitch it the same way.

Acceptance: a dashboard tab shows a mock `device_status` row updating live; one `@factory/droid-sdk` run produced a real streamed diff; the board blinks from a typed serial line; contracts are committed and imported by at least one mock on each side.

> **REVISED SPLIT (your call):** Dev 2 takes the **security** role; Dev 1 is de-loaded to the **orchestration engine + model integrations**; Dev 3 takes **realtime + dashboard + the 2D sim (agent-built) with a cuttable 3D hero**; the hardware dev also owns the **software emulator**. Dev 1 ↔ Dev 2 seam: Dev 2 authors *what the agents do* (security stage logic, prompts, exploit, verifier, device-service); Dev 1 owns *how they run* (the Agent-SDK runner, streaming, human gate, the Factory patch engine). They share only the frozen `contracts/`.

### 5.2 `plans/PLAN-DEV1-pipeline-agents.md` — Pipeline & Agents (orchestration engine)

**Owns:** Anthropic (the visible-Claude reasoning engine + prize framing), **Factory** (the Droid patch engine), Most-Technically-Advanced (orchestration). **Components:** the orchestrator, the Claude **Agent SDK** stage runner, live reasoning streaming, the **human-approval gate**, separation-of-duties enforcement, the **Factory Droid patch stage**, model config, the express-path/loop-timing harness.

Tasks:
1. **Agent SDK runner (H2–H10):** a `runStage(name, {systemPrompt, prompt, tools, disallowedTools, permissionMode, model, effort, schema})` helper wrapping one top-level `query()` per stage with `includePartialMessages:true` and `settingSources:[]`; stream `text_delta`s → `updateAgentStatus(reasoning)`; a `report_decision` custom tool → confidence/uncertainty. Dev 2's stage modules plug into this. (See §11 for the SDK corrections: scope with `tools`/`disallowedTools`, not `allowedTools`.)
2. **Separation-of-duties + sandbox (H2–H10):** per-stage tool scoping + a PreToolUse hook that denies any network target not in `SANDBOX_ALLOWLIST` and surfaces the **visible refusal** event. (This + separate processes is the REAL enforcement — narrate this, not a DB claim.)
3. **HUMAN GATE:** the `canUseTool` callback that awaits a real dashboard click before the patch is applied (gated tool must NOT be in `allowedTools`; `permissionMode:'default'`). Emits `approvePatch`.
4. **PATCH stage via `@factory/droid-sdk` (H10–H22):** `createSession()` + `session.stream(prompt)` on `cwd=device-service`, streaming Droid's plan/steps/diff live → `agent_status`/`patch_attempts`; capture the real diff; scope with the CLI autonomy/`permissionRules` (confirm SDK scoping options in `docs.factory.ai/sdk/typescript`). **Build the cached-patch fallback** (replay a captured Droid session + canned diff if throttled/offline — Factory rate-limits on 5h/7d/30d windows).
5. **Orchestrator loop:** sequences GROUND→SCAN→GENERATE→DELIVER→PATCH→gate→VERIFY→RESTORE by calling Dev 2's stage functions; writes rows via Dev 3's reducers; **times the full loop at ~H22** and builds the <90s express path.

Acceptance: the loop runs end-to-end invoking Dev 2's stages; Droid streams a real diff to the dashboard and cannot deploy; the human gate blocks until clicked; a visible sandbox refusal fires; survives 10+ runs. Manual: **fund Factory** (card on plan); confirm Claude model IDs live (§11).

### 5.3 `plans/PLAN-DEV2-security-verification.md` — Security & Verification (the security role)

**Owns:** **Armadin** (the verified find→exploit→fix loop is their thesis), **Bitdeer** (the exploit-gen model), the security substance of Most-Technically-Advanced. **Components:** the vulnerable + patched **`device-service/`** (the attack surface), the **SemGrep custom rule + Bandit**, the **SCAN reasoning** (prompt + the wrong-then-caught probe), the **Bitdeer GENERATE** + the **exploit payloads + `deliver.py`**, the **deterministic verifier**, **NVD grounding**, and the device-service `.factory` scoping.

Tasks:
1. **device-service (H2–H10):** Flask/FastAPI with `/device/status` + vulnerable `/device/command` (separate `true_state` vs `reported_state`); it calls Dev 3's `updateDeviceStatus` reducer. Commit `.factory/settings.json` `permissionRules` (block push/net/sudo; §11). Make it its **own git repo** (safe RESTORE).
2. **SCAN signal (H2–H10):** write `rules/missing-auth.yaml` (CWE-306) **with** the vulnerable handler and assert it **fires on the vuln, silent on the patched** (`semgrep --validate` + `--test` fixtures); add Bandit as noise. Author the **SCAN stage module** (the Claude triage prompt + the deterministic **reproduce-the-finding probe** that makes the Bandit pick fail → self-correct to the SemGrep finding) — run through Dev 1's `runStage`. Install semgrep/bandit under **Python 3.10–3.14** (§11).
3. **GROUND:** fetch CVE-2019-6538 from NVD **once, cache locally** (header `apiKey:`, keyless works; §11); produce the grounding card data (CWE-306/862; name the CVSS source).
4. **GENERATE (Bitdeer):** client to `api-inference.bitdeer.ai/v1` with `deepseek-ai/DeepSeek-V4.1-Flash`; author the 3 exploit payloads (map to IR ① stop-breathing ② max-pressure ③ falsify-vitals); **pre-cache a known-good PoC + auto-failover** on any 429/refusal (refusal behavior untested — test on first key).
5. **DELIVER:** `deliver.py` subscribes to `ir_events` → fires the chosen unauthenticated payload at `/device/command` → device obeys + lies.
6. **VERIFY (deterministic, non-AI):** re-send the byte-identical exploit; assert (a) 401/403, (b) `true_state` unchanged, (c) `reported==true`. **RESTORE:** git-revert the device-service repo + `resetHealthy()`.

Acceptance: SemGrep fires only on the vuln; Claude picks the real finding out of Bandit noise and visibly self-corrects once; the exploit achieves control+integrity (fan stops + lie); the verifier proves the re-run fails; the whole security loop runs headless on the emulator. Manual: pin semgrep 1.182.1/bandit 1.9.4; get the Bitdeer key (credit-request form) + smoke-test a PoC prompt.

### 5.4 `plans/PLAN-DEV3-realtime-frontend.md` — Realtime Backbone, Dashboard & Sim

**Owns:** **SpacetimeDB** (anchor), Best People-First, First-Overall polish, Microsoft demo framing. **Components:** the SpacetimeDB TS module (tables+reducers) + `RealtimeBackend` abstraction + **Convex fallback**; the **right-panel dashboard** (§12); the **left-panel 2D sim + app shell** (§12), with a **cuttable 3D hero** built by coding agents. **Leverage coding agents heavily** for both UIs from the §12 design spec — Dev 3 owns the realtime data layer (the human-judgment part) and integrates/ directs the agent-built UI.

Tasks:
1. **H0–H2:** STDB smoke test (`spacetime dev --template react-ts`); pin `spacetimedb@2.13.0` CLI+pkg (§11); confirm Node ≥22.12.
2. **Module + abstraction (H2–H10):** tables + reducers per §2a; seed the single `device_status` row; the `RealtimeBackend` interface + spacetime & convex adapters (identical shapes); use the shipped `spacetimedb/react` hooks. Own the **~1/3 Convex gate (~H13)** — one-file swap if the STDB TS loop is unreliable (forfeits STDB prize; last resort). *(Convex extras if we switch: alpha ESP32 client, AI Gateway, HIPAA — see §11/§5.5 note.)*
3. **Right dashboard (H2–H22, agent-built from §12):** agent timeline + streaming reasoning + confidence, the three trust cards (self-correction / refusal / approval), Shiki code + `react-diff-view` diff, verification matrix, Telemetry-vs-Reality card, scrolling `event_log`.
4. **Left 2D sim (H2–H22, agent-built from §12):** PixiJS ward grid ("1 of 3,412"), the bedside monitor with live ECG/SpO₂/respiration waveforms driven by `device_status` true-vs-reported, crash/recover, Web-Audio alarm; **MEDJACK spread+heal** as stretch.
5. **3D hero (H30+, upside, cuttable):** coding agents add a 3D establishing shot / one 3D element (R3F; Spline optional) — only if the core + 2D are solid; the live monitor stays 2D.
6. **OBS Window-Capture backup recording** (H30–H36) opening on THE MOMENT; Tailwind for polish.

Acceptance: both panels + the serial bridge subscribe to the same rows; dashboard renders real Droid stream + diff; "patient crashes while device lies" is unmistakable; adapter swap works; a clean full-run recording exists; (3D hero present or cleanly cut).

### 5.5 `plans/PLAN-HW-arduino.md` — Physical Actuation + Emulator (hardware dev)

**Owns:** Best Hardware. **Components:** `firmware/uno_actuator.ino`, the **Node `serial-bridge/`** (subscribes `device_status` → `STATE,...`; pushes `IR,code=` → `pushIrEvent`), and the **software emulator** (`emulator/` — honors the same serial schema so the whole demo runs with no board).

Tasks:
1. **H0–H2 bench-test** (burns time if wrong): RGB common-anode vs cathode, IR module pin order (silkscreen + multimeter), 4-digit 7-seg multiplexing — all unconfirmed for this SKU.
2. **Wiring:** power rails first (board off); **fan off the PSU 5V rail / 9V, NEVER an Arduino pin**; common ground; **conflict-free pin map** (avoid Servo-Timer1 / `tone()`-Timer2 clashes): fan PWM via L293D 1,2EN→D6; LCD RS/EN=D12/D13, D4–D7=A0–A3; 74HC595 DS/SH_CP/ST_CP=D7/D5/D3; passive buzzer=D4; RGB=D8/D10/D11; servo=D9; IR OUT=D2. **No soldering (venue rule).**
3. **Firmware:** LiquidCrystal, Servo, IRremote v4, `tone()`, raw L293D PWM; parse `STATE,...` with fixed buffer + `strtok`; emit `READY`/`HB`/`IR,code=`.
4. **Serial bridge (Node):** `serialport@13.0.0` (dry-run the native prebuild pre-event, §11) + `spacetimedb` client → open port once, wait for `READY`, send `STATE` on every `device_status` update; on `IR,code=` call `pushIrEvent`; **auto-reconnect + heartbeat**.
5. **Software emulator:** a drop-in that consumes `device_status` and logs/visualizes the same `STATE,...` stream (and can inject `IR` events) so Dev 1/2/3 integrate without the board and the demo survives a dead board.
6. **Bench airflow test at the mask** early — if a 3-6V fan through CPAP tubing can't be felt, lead the moment with the visual/audible cues.

Acceptance: a `device_status` change drives fan/LCD/7-seg/buzzer/RGB correctly; true-vs-reported mapping right (fan=true, vitals=reported); IR press reaches the orchestrator; survives a USB unplug/replug; the emulator is a true drop-in.

---

## 6. Build timeline (Fri 6pm → Sun 9am, ~39h)

| Window | Milestone |
|---|---|
| **H0–H2** Fri 6–8pm | Foundation (all 4): keys, repo, **freeze contracts**, smoke-test the 3 externals, hello-world firmware, name, framing doc |
| **H2–H10** Fri 8pm–Sat 4am | Parallel sprint 1 against mocks (each dev's steps above) |
| **~H13** Sat ~7am | 🚪 **SpacetimeDB→Convex gate** (one-file swap if STDB TS loop is unreliable) |
| **H10–H22** Sat 4am–4pm | Integration: real rows end-to-end; serial bridge drives the board; dashboard renders real Droid output |
| **🎯 ~H22** Sat ~4pm | **CORE LOOP DEMO-READY** (before any sim polish) — the one thing that must never break |
| **H22–H30** Sat 4pm–midnight | Harden: one-key reset, 10+ run survival, the wrong-then-caught + IR payload-pick + sandbox-refusal beats; **time the loop + express path** |
| **H30–H36** Sat midnight–Sun 6am | Sim polish (optional MEDJACK), README (7 sections), **OBS backup recording** |
| **H36–H39** Sun 6–9am | Buffer + Devpost submit (draft Sat night; opt into every target track; **submit before 9:00am PDT**). Table by 10:30am, all 4 present, judging 10:30–12:30 |

---

## 7. Risk register & framing (from the adversarial critique)

**Must-hold honest framing (whole team, identical):** no confirmed patient death from a *device* hack (deaths are from ransomware disrupting care); prevalence stats are vendor **estimates**; the device is a **desk fan that MODELS the missing-auth vuln class**, not a real ventilator; **CVE-2019-6538 is adjacent-radio, not a remote hack** — we model the *class* (missing auth on a control interface); **section 524B**, not "PATCH Act"; separation-of-duties is enforced **three ways, all real**: Agent-SDK per-stage tool scoping, separate OS processes, AND SpacetimeDB reducers checking `ctx.sender` identity on the write path — so we can claim DB-level enforcement honestly.

**Top risks → mitigations:**
- *3 unverified externals cascade* → smoke-test all three in H0–H2 before splitting.
- *Loop wall-clock may not fit roving judges (10+ runs)* → time it at H22; cache slow stages; <90s express path; backup video.
- *"Agent caught being wrong" is emergent* → scripted reproduce-the-finding probe in SCAN.
- *Factory throttle/outage mid-demo* → funded plan + cached-patch fallback + replayable stream-json.
- *Bitdeer refusal/429* → cached-PoC auto-failover.
- *NVD 403 on repeated runs* → fetch once, cache, render from cache.
- *RESTORE wipes other devs' work* → device-service is its own git repo.
- *SemGrep rule doesn't fire* → author rule+handler together, assert fires-on-vuln/silent-on-patch.
- *Felt-airflow beat falls flat* → bench-test; fall back to visual/audible cues.
- *Hardware SKU unknowns (RGB polarity, IR pins, 7-seg mux)* → bench-test at H0–H2.
- *Eligibility* → dossiers are **ideation only**; write all code during the event; organic commit history; commit nothing before check-in.

**Confirm on-site (not facts yet):** whether general + sponsor tracks stack (hinges the breadth strategy); Microsoft "no Azure required"; Armadin/Convex/SpacetimeDB/Anthropic/Bitdeer exact rubrics; Factory `droid exec` per-event field schema (log a real run); native-Windows `droid` reliability (fall back to WSL if flaky).

---

## 8. Manual human steps (consolidated)

Keys/accounts: Anthropic, **Factory (+ card on plan)**, Bitdeer (+ confirm credits/limits/model id at booth), NVD (email-verified, before event), SpacetimeDB pack. Confirm Armadin/Convex/Microsoft criteria at booths.
Hardware/software: Arduino IDE 2.x + IRremote v4; wire power→ICs→peripherals, common ground, fan off PSU rail; bench-test RGB polarity + IR pin order; upload firmware, confirm `READY`@115200; install `droid` (`droid --version`+`droid rules check`); pin semgrep/bandit/JS versions; OBS Window-Capture dry-run; borrow a spare UNO (+optional ESP32) from the Rental Booth; **no soldering**.
Prop/logistics: source mask+tube (cheap CPAP/oxygen mask, held loosely toward the judge, never sealed on a person — you are handling this); all 4 register+link on Devpost; check in Sun 8am with ID+Hacker Pass; README (7 sections); repo PUBLIC; `.env*` not staged; **all code during event**.

---

## 9. Verification (how we prove it works)

- **Per-dev acceptance tests** as listed in each 5.x section.
- **Integration (H22):** run the full loop headless once with the **emulator** (no board) and once with the **real board**; assert the deterministic verifier's 3 checks pass post-patch and the row flips the hardware both ways.
- **Repeatability:** run the one-key reset + full loop 10 times; confirm no state leak and wall-clock < the express budget.
- **Demo dry-run:** record the full sequence in OBS on a judge-chosen IR payload; confirm the "device lies while patient crashes" and the verified-fix beats read on both panels + hardware.
- **Honesty Q&A drill:** rehearse answers to "is this a real ventilator / remote hack / is the separation real?" against §7.

---

## 10. On approval

I will: (1) create the 5 plan files above in `plans/`; (2) on your go, launch a **foundation implementation workflow** (H0–H2 scaffold: monorepo, frozen `contracts/`, the 3 external smoke-tests, hello-world firmware) so you start the event with the skeleton already proven. Then each dev plan is ready for its own Claude Code session to execute in parallel.

---

## 11. Verified pins & corrected facts (live-checked 2026-10-24 — these SUPERSEDE any earlier tentative value)

**Claude (Agent SDK):** pin `@anthropic-ai/claude-agent-sdk@0.3.310` (Node ≥18). Model IDs are confirmed GA — pin the **dateless** strings, never add a date suffix: **`claude-opus-5-5`** (deep reasoning/scan/triage; default effort `medium`, set explicitly; thinking can't be disabled — use low effort for cheap calls), **`claude-sonnet-5-5`** (mid), **`claude-haiku-5-5`** (cheap/fast e.g. GROUND; avoid retiring `claude-haiku-4-5-20251001`). Fallback string: `claude-opus-4-8` (legacy but Active). Still verify with `GET /v1/models` on the demo laptop at H0 and keep IDs in ONE `contracts/models.ts` constant.
- **API correction:** `allowedTools` only AUTO-APPROVES tools — it does **not** restrict the set. To scope a stage use `options.tools:[...]` (availability; `tools:[]` removes built-ins) + `disallowedTools` + `permissionMode:'dontAsk'` for read-only stages.
- **Human gate:** use the `canUseTool(toolName,input,opts)=>Promise<PermissionResult>` callback — it can await a web-button click indefinitely → perfect for the approval gate. BUT it's only called when the flow falls through to a prompt, so the gated tool must **not** be in `allowedTools` and the stage must run `permissionMode:'default'`. For an unconditional gate use a PreToolUse hook.
- **Streaming reasoning:** `includePartialMessages:true`; handle `message.type==='stream_event'` → `event.type==='content_block_delta'` → `delta.type==='text_delta'`. Subagent deltas are NOT forwarded → confirms "one top-level `query()` per stage, no nested subagents." To stream *thinking*, set `thinking:{type:'adaptive',display:'summarized'}`.
- **Always** set `settingSources:[]` per stage so this laptop's global CLAUDE.md/AGENTS.md/hooks don't leak in. Never send `temperature/top_p/top_k` (400 on anthropic-version 2026-10-21; the SDK omits them anyway). `maxTurns`/`maxBudgetUsd` per query to cap cost.

**SpacetimeDB:** pin `spacetimedb@2.13.0` (server module + React client, same package). CLI on Windows: `irm https://windows.spacetimedb.com -useb | iex`, open a NEW terminal (PATH is user-level), then `spacetime install 2.13.0; spacetime version use 2.13.0`. Fastest proof: `spacetime dev --template react-ts` in a space-free dir (e.g. `C:\dev\stdb`). Server imports `spacetimedb/server` (`schema,table,t`), reducers via `spacetimedb.reducer({...},(ctx,args)=>...)`. HTTP calls 504 after 5s without durability; scheduled reducers ~15ms late on Windows (irrelevant here). **From the Cal Hacks deck:** redeem **`CALHACKS13`** at spacetimedb.com/redeem for 100k TeV (a month of Maincloud Pro, free) — keep **local** primary for the demo (no venue-WiFi dependency), Maincloud as optional cloud backup + the fleet-scale story. `spacetime init --template react-ts` ships CLAUDE.md/AGENTS.md agent rules; add the Claude Code plugin (`claude plugin marketplace add clockworklabs/SpacetimeDB` → `claude plugin install spacetimedb@spacetimedb-plugins`) + `spacetime mcp` so coding agents use correct APIs. **procedures** (`ctx.http.fetch` ≤180s) call external APIs transactionally; **views** + `ctx.sender` give per-identity permissions (our DB-enforced separation of duties); **scheduled tables** = cron/jobs as rows (handy for the MEDJACK-spread timer/heartbeat). Pitch ammo: their benchmark = 303,920 TPS (TS) vs Convex 127. **Convex fallback extras** (if we switch): alpha **ESP32 client** (a device could subscribe directly), **AI Gateway** (any model, no keys), HIPAA-compliant; map Query→view+subscription, Mutation→reducer, Action→procedure.

**Factory (patch engine) — use the official SDK `@factory/droid-sdk` (confirmed in their Cal Hacks deck, this supersedes the earlier `droid exec` plan):** `npm install @factory/droid-sdk`; `import { run, createSession, DroidMessageType } from '@factory/droid-sdk/node'`. The `droid` CLI (npm `droid@0.249.0`, Windows PowerShell installer or `npm i -g droid`) must also be on PATH (the SDK starts it) + `$env:FACTORY_API_KEY="fk-..."`. Node 20+. **No free tier** (Pro $20/mo or prepaid $10; funded per your decision); rate limits roll on 5h/7d/30d → keep a cached-patch fallback.
- **Patch stage:** `const s = await createSession(); for await (const m of s.stream("<fix CWE-306 on /device/command; edit only app.py>")) { if (m.type===DroidMessageType.Assistant) stream m.text → agent_status }` with the session's working dir = the device-service repo; then capture `git diff`. One-shot alt: `run(prompt,{outputFormat:{type:OutputFormatType.JsonSchema,schema}})` for a typed result. **Daemon option:** `droid daemon --port N` + `connectToDaemon({url,auth})` lets the web app drive Droid over WebSocket (never put the key in public web code).
- Scope what Droid may touch via CLI autonomy + `permissionRules` in `~/.factory/settings.json` (shell-command rules; validate `droid rules check`); confirm the SDK's own run options at `docs.factory.ai/sdk/typescript` (examples: `github.com/Factory-AI/droid-sdk-typescript`). **A finished run ≠ task success** → always re-run the deterministic verifier. CLI fallback if the SDK misbehaves on Windows: `droid exec -o stream-json --auto low --cwd <abs> -w demo-fix "<task>" | Tee-Object events.jsonl`.

**Bitdeer:** base URL `https://api-inference.bitdeer.ai/v1`, `Authorization: Bearer $BITDEER_API_KEY`, `POST /v1/chat/completions` (OpenAI-compatible). **Model id correction: `deepseek-ai/DeepSeek-V4-Pro` does NOT exist → use `deepseek-ai/DeepSeek-V4.1-Flash`** (reasoning variant); strong alt `zai-org/GLM-5.3`. Rate limit 100 RPM (429 `RATE_LIMIT_EXCEEDED`); 403 `NOT_ENOUGH_BALANCE`. Refusal behavior on PoC prompts is **undocumented** → smoke-test a representative prompt the moment you get a key + keep the cached-PoC failover. No confirmed CalHacks free credit — confirm at the booth.

**Security tooling:** `semgrep==1.182.1`, `bandit==1.9.4` — install under **Python 3.10–3.14** (NOT the 3.15 on this machine): `uv tool install --python 3.13 semgrep==1.182.1`. No stock CWE-306 rule exists → ship the custom `rules/missing-auth.yaml` (Flask `@$APP.$M(...)` + `metavariable-regex` on get/post/... with `pattern-not` for auth decorators / `Depends(...)`), validate with `semgrep scan --validate` + `semgrep --test` fixtures. Scan: `semgrep scan --config rules/ --json --metrics off --disable-version-check --quiet <target>`. Bandit: `bandit -r <target> -f json -o bandit.json --exit-zero` (never flags missing-auth → it's our noise: B201/B105-107/B608). **NVD:** `GET https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2019-6538` works **keyless** (verified live 200); key goes in HTTP header **`apiKey:`** (NOT query param; bad key → 404). Rate 5/30s keyless, 50/30s keyed → **cache the JSON locally**. Ground truth: CWE-306 + CWE-862 (NVD), CWE-284 (CISA); CVSS 9.3 CRITICAL (CISA) vs 6.5 MEDIUM (NVD) — name the source.

**Frontend pins (all live-confirmed):** Node ≥22.12 (floor 20.19). `npm i react@19.3.1 react-dom@19.3.1 pixi.js@8.22.0 shiki@4.5.0 react-diff-view@3.3.3 motion@14.6.0 convex@1.48.0 tailwindcss@4.3.3 @tailwindcss/vite@4.3.3 && npm i -D vite@8.3.5 @vitejs/plugin-react@6.1.2 typescript@7.0.2 @types/react@19.3.0 @types/react-dom@19.3.0 @types/node@26.6.5`. Serial bridge (separate Node proc): `npm i serialport@13.0.0` — **dry-run `node -e "require('serialport')"` pre-event** to confirm the native prebuild loads on Node 26/Windows. Notes: import `motion` from `motion/react` (not framer-motion); Pixi `await app.init()` then append `app.canvas`; `shiki` is async ESM (prefer `shiki/core`+`shiki/engine/javascript` to skip wasm); `react-diff-view` needs `import 'react-diff-view/style/index.css'`; TS7 is the native port — fall back to `typescript@5.9` if tooling chokes. Pin exact versions + commit the lockfile + `npm ci` from a warmed cache (venue WiFi).

---

## 12. Presentation layer — the win (pitch · dashboard · sim · flourishes)

**Honesty reconciliation (read first):** the **live loop on a judge-chosen IR payload is the PRIMARY, rehearsed path** — it is the whole thesis and Cal Hacks requires a live demo, so we make the *real* loop reliable, not a replay. The captured recording (OBS) is the **backup only**, shown transparently if hardware fails. The **fleet of ~3,412 devices is a clearly-labeled visualization** of the scale story — only ONE real device is in the loop; say so plainly if asked. The Bitdeer/Armadin "fleet/edge/compute at scale" angles are *architecture* framing ("each device fans out as parallel jobs"), not a claim we ran thousands live.

### The 3-minute pitch (Teammate A narrates, B drives, the JUDGE performs the kill)
Pre-roll: hand the judge the IR remote, point at the LEFT screen — "You're this patient. That remote is the only prop you need." Fan spinning, mask puffing, dashboard green.
- **0:00 HOOK (exact words):** *"The machine in your hand is breathing for you. I'm a stranger — you never gave me access. In a second I'm going to turn it off, and the scary part isn't that I can. It's that the device will tell your doctor everything's fine."*
- **0:22 THE KILL:** judge presses ① → red packet animates to device → **fan stops, mask stills** → LEFT SpO₂ collapses, alarm, patient blue. (Protect the silence — don't talk over the dying fan.)
- **0:40 THE LIE:** telemetry still reads **"NORMAL · 14 bpm"** green while LEFT flatlines; "TELEMETRY vs REALITY" card snaps red. *"The device is lying to the hospital while the patient codes. That's why these attacks kill — nobody sees them."*
- **0:52 AGENTS WAKE → EXPLOIT (proof) → 1:20 THE CAUGHT MISTAKE** (self-correction card: "Rejected my own patch — it broke emergency override. Revising.") **→ 1:32 THE REFUSAL** (sandbox blocks a reach at a second device: "ACTION REFUSED — out of scope").
- **1:45 HUMAN GATE:** diff + 41/41 tests + exploit-proof badge → glowing **APPROVE & DEPLOY**, B clicks deliberately.
- **1:58 RE-RUN = FAILURE (payoff):** judge presses the SAME button → bounces off a **401** → **fan spins back up, vitals recover.** *"Same attack. Press it. … Now it fails. Your patient is breathing again."*
- **2:18 SCALE** (green heal ripples the fleet) **→ 2:30 THE RECEIPT** (hold up the printed FDA §524B report the agent just generated).
- **2:42 CLOSE (exact words):** *"Every hospital runs thousands of these devices, and today each one is a box a stranger can switch off without a sound. PreVent makes the devices watch themselves — find the hole, prove the kill, close it, and show every receipt. The difference between a patient and a statistic was one button that stopped working. Thank you."*
- **<90s express path** (rushed judge): hook+kill → the lie → narrate the live timeline (find→prove→**catch own bad patch**→human approve) → re-run fails, recover → one-line close holding the report.

### Right panel — the "glass skull" dashboard (React + Tailwind + `spacetimedb/react` + Shiki/`react-diff-view` + motion)
3-zone command-center: top status bar (fleet pill + threat chip), left **Agent Timeline** (38%), right **Evidence Stack** (62%). Timeline = vertical spine `FIND→EXPLOIT→PATCH→VERIFY→RESTORE` with a pulse traveling it; each active node expands to a **streaming reasoning card** (mono, dimmed, typewriter autoscroll), a **confidence gauge** (dips are visible = honesty), **tool-call chips** (spinner→check), and a **provenance line** to evidence. Three signature "trust" cards: **Self-Correction** (amber, flips v1→"REJECTED, revising" — the single most persuasive pixel), **Guardrail Blocked** (red/lock refusal), **Awaiting Approval** (diff + test checklist + pulsing APPROVE). Evidence Stack: real diff viewer, exploit terminal (200→401), verification matrix, **Telemetry-vs-Reality** card (makes "the lie" legible), compliance card. Palette: near-black `#0B0F14`, one cyan accent `#38BDF8`, semantic-only R/A/G; Inter for UI + JetBrains Mono for machine output (the font switch itself signals "real model output"); one ~450ms ease, motion = meaning only.

### Left panel — the sim (PixiJS v8, all code-drawn, ~hours)
Macro ward: grid of ~40 beds ("1 of 3,412"), yours pulses red while others stay green. Micro: bedside **patient monitor** with three live polyline waveforms (ECG green / SpO₂ pleth cyan + big % / respiration yellow synced to the real fan), big HR/SpO₂/RR/BP, a **green "NORMAL" banner that stays green during the lie** then flips to flashing red. Crash = flatline + SpO₂ countdown + Web-Audio triple-beep + red vignette + cyanotic tint; restore feels like exhaling. Optional MEDJACK red-spread then green heal-wave (~30 lines) sells the fleet payoff. Drive EVERYTHING from the same `device_status` subscription as the dashboard + Arduino → zero desync.

### Per-judge emphasis (one line each) + pre-empted Q&A
- **Overall:** the complete visceral loop (judge crashes + revives a patient) that's deep, emotional, AND real. Trap "is it scripted?" → "pipeline is real agents; we only control timing — here's live mode."
- **Most Technically Advanced:** multi-agent orchestration with verifiable self-correction + sandbox enforcement; VERIFY re-runs the proven exploit → "proof, not prose."
- **Best Hardware:** software defense with a physical, audible life-or-death consequence; pick up the board live to prove it's in the loop.
- **People-First:** the victim is a person, human-in-the-loop, and it exposes the device lying to clinicians. Trap "isn't auto-patching dangerous?" → mandatory human gate + sandbox refusal + full transparency = co-pilot not autopilot.
- **Anthropic:** Claude's *visible* reasoning, self-critique, and refusal ARE the product; the Self-Correction card is a real rejection event. (Name the model here, not in the pitch.)
- **Factory:** end-to-end agentic delivery — find→exploit→real diff→tests→human approval→ship; show the Monaco/`react-diff-view` diff + test matrix.
- **SpacetimeDB:** fleet + timeline + both panels + Arduino are ONE subscription; the fleet-wide heal is literally state replication → "why our panels never desync."
- **Armadin (confirm exact prompt at booth):** fleet-scale per-device edge detect-and-patch; keep the fleet-scale spine, swap the noun if the track differs.
- **Bitdeer:** scaling 1→thousands of concurrent find/exploit/verify agent jobs is an elastic GPU/AI-cloud workload (architecture framing, not a live claim).
- **Microsoft "Built for the Real World":** audit trail of every reasoning step + least-privilege sandbox + human sign-off + auto-generated FDA §524B + SBOM = governable, production-minded, responsible (no Azure needed — confirm at booth).

### Three unfair-advantage flourishes (cheap, high-wow — participation / emotion / credibility)
1. **Judge chooses the payload** via the IR remote (taped labels: ① Stop Breathing ② Max Pressure ③ Falsify Vitals → map to `/device/command` actions; default ① for the clean beat). They become the adversary → kills "is it scripted?" because they chose.
2. **The device visibly LIES** — keep "reported" vitals green during the attack window (~20 lines), then snap the Telemetry-vs-Reality card red. The most chilling, clearest "why this kills."
3. **Auto-generated printed FDA §524B report** on RESTORE (device id, CWE-306, exploit proof, patch-diff hash, test results, short SBOM) → hand the physical page to the judge. Real statute in force since 2023 → reads as credibility, not gimmick.
