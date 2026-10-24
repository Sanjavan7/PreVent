# PLAN — DEV 1: Pipeline & Agents (the orchestration engine)

> Project **PreVent** · Cal Hacks 13.0. Master: `plans/PLAN-MASTER.md`. Foundation first: `plans/PLAN-FOUNDATION.md`.
> **You own:** the orchestrator, the Claude **Agent SDK** stage runner, live reasoning streaming, the **human-approval gate**, separation-of-duties enforcement, and the **Factory Droid patch stage**. Sponsors: **Anthropic** (the visible-Claude reasoning engine), **Factory** (the Droid patch engine), + Most-Technically-Advanced (orchestration).
> **Seam with Dev 2:** Dev 2 writes *what the agents do* (security stage modules, prompts, exploit, verifier, device-service). You own *how they run* (the runner, streaming, gate, Factory). You call Dev 2's stage functions from your orchestrator. Shared only via frozen `contracts/`.

## Verified pins / APIs (live 2026-10-24 — do not drift)
- `@anthropic-ai/claude-agent-sdk@0.3.310` (Node ≥18). Model IDs: **`claude-opus-5-5`** (deep reasoning; default effort `medium` — set explicitly; thinking can't be disabled, use low effort for cheap calls), **`claude-sonnet-5-5`**, **`claude-haiku-5-5`** (cheap/fast). Fallback `claude-opus-4-8`. Keep IDs in ONE `contracts/models.ts`.
- **Scope tools with `options.tools:[...]`** (availability; `tools:[]` removes built-ins) **+ `disallowedTools`**, NOT `allowedTools` (that only auto-approves). `permissionMode:'dontAsk'` for read-only stages.
- **Streaming:** `includePartialMessages:true` → handle `message.type==='stream_event'` → `event.type==='content_block_delta'` → `delta.type==='text_delta'`. Subagent deltas are NOT forwarded → **one top-level `query()` per stage, no nested subagents.** Stream thinking with `thinking:{type:'adaptive',display:'summarized'}`.
- **Always** `settingSources:[]` per stage (so this laptop's CLAUDE.md/hooks don't leak). Never send temperature/top_p/top_k. Use `maxTurns`/`maxBudgetUsd` to cap cost.
- **Factory:** `npm i @factory/droid-sdk`; `import { run, createSession, DroidMessageType } from '@factory/droid-sdk/node'`. The `droid` CLI must be on PATH (`npm i -g droid`, v0.249.0) + `$env:FACTORY_API_KEY`. No free tier (funded). Rate limits roll 5h/7d/30d → cached fallback required.

## Tasks

### 1. Agent SDK stage runner (`agents/src/stages/runStage.ts`) — H2–H10
`runStage(name, {systemPrompt, prompt, tools, disallowedTools, permissionMode, model, effort, schema})`:
- one top-level `query()` with `includePartialMessages:true`, `settingSources:[]`;
- accumulate `text_delta`s and push to `updateAgentStatus(name, stage, 'running', reasoning)`;
- expose a `report_decision` custom tool → writes `confidence`/`uncertainty` to `agent_status`;
- return the stage's structured result (via `schema`/outputFormat) to the orchestrator.
Dev 2's `scan`/`ground`/etc. modules supply the prompt + tools and consume the result.

### 2. Separation-of-duties + sandbox (`agents/src/orchestrator.ts`, hooks) — H2–H10
- Each stage runs with its own scoped `tools`/`disallowedTools` and its own process identity.
- A **PreToolUse hook** denies any network target not in `SANDBOX_ALLOWLIST` and emits a **visible refusal** event (`logEvent('guardrail','ACTION REFUSED — out of scope: …')` + an `agent_status` error) — this is a scripted, rehearsed beat for the demo.
- Document (for the pitch) that enforcement is real three ways: tool scoping + separate processes + `ctx.sender` in reducers (Dev 3 enforces the DB side).

### 3. Human-approval gate (`agents/src/humanGate.ts`) — H2–H10
- Use the `canUseTool(toolName,input,opts)=>Promise<PermissionResult>` callback; it may await indefinitely → resolve it when the dashboard POSTs/clicks APPROVE.
- The gated apply-patch tool must NOT be in `allowedTools`, and the stage runs `permissionMode:'default'`, or `canUseTool` is never called. On approve → `approvePatch(id, approved_by)`; set `agent_status(patch, waiting_for_human→done)`.

### 4. Factory Droid PATCH stage (`agents/src/factory/runDroid.ts`) — H10–H22
- `const s = await createSession(); for await (const m of s.stream("Fix CWE-306 on POST /device/command: require a valid token and ignore untrusted reported_overrides. Edit only app.py.")) { if (m.type===DroidMessageType.Assistant) stream m.text → updateAgentStatus(patch) }` with the session working dir = the **device-service repo**.
- After the run, capture the real `git -C device-service diff` → `recordPatchAttempt(diff_ref, droid_session)`; feed the diff to Dev 3's diff viewer.
- **Scope:** CLI autonomy + `permissionRules` in `device-service/.factory/settings.json` (block push/net/sudo; validate `droid rules check`). A finished run ≠ success → always hand off to Dev 2's verifier.
- **Cached-patch fallback:** capture one real Droid session's events + the resulting diff; if Droid 429s/offline, replay those events and apply the canned diff so the loop still closes.
- Daemon option (if the web app should drive Droid directly): `droid daemon --port N` + `connectToDaemon({url,auth})` — never put the key in public web code.

### 5. Orchestrator loop (`agents/src/orchestrator.ts`) — H10–H22
- Connect as a SpacetimeDB client (own identity). Sequence: GROUND→SCAN→GENERATE→DELIVER→(await `ir_events` for the judge payload)→PATCH→human gate→APPLY→VERIFY→RESTORE, calling Dev 2's stage functions and writing rows via Dev 3's reducers.
- **Time the full loop at ~H22**; build the `<90s` express path (cache GROUND + exploit-gen; skip the slow reasoning narration).

## Acceptance
Loop runs end-to-end invoking Dev 2's stages; Droid streams a real diff to the dashboard and cannot commit/push/deploy; the human gate blocks until the dashboard click; a visible sandbox refusal fires on cue; survives 10+ resets within the express budget. **Manual:** fund Factory (card on plan); confirm model IDs live at H0.
