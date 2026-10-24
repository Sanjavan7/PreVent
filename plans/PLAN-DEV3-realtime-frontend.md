# PLAN — DEV 3: Realtime Backbone, Dashboard & Sim

> Project **PreVent** · Cal Hacks 13.0. Master: `plans/PLAN-MASTER.md`. Foundation first: `plans/PLAN-FOUNDATION.md`.
> **You own:** the SpacetimeDB module (tables+reducers) + the `RealtimeBackend` abstraction (+ Convex fallback), the **right-panel "glass skull" dashboard**, and the **left-panel 2D sim** + app shell (with a **cuttable 3D hero**). Sponsors: **SpacetimeDB** (anchor), Best People-First, First-Overall polish, Microsoft demo framing.
> **Use coding agents heavily** for both UIs from the design spec below — you own the realtime data layer (the human-judgment part) and integrate/direct the agent-built UI. Everything subscribes to the same rows → zero desync across dashboard, sim, and the Arduino.

## Verified pins / APIs (live 2026-10-24)
- **SpacetimeDB:** pin `spacetimedb@2.13.0` (server module + React client, same unscoped package; old `@clockworklabs/spacetimedb-sdk` is deprecated). CLI Windows: `irm https://windows.spacetimedb.com -useb | iex` → new terminal → `spacetime install 2.13.0; spacetime version use 2.13.0`. Scaffold: `spacetime dev --template react-ts` (space-free dir). Server imports `spacetimedb/server` (`schema,table,t`); **React hooks ship** at `spacetimedb/react`: `SpacetimeDBProvider` (pass the `DbConnection.builder()...` builder, don't call `.build()`), `useTable(tables.x)`→`[rows,isReady]`, `useReducer(reducers.x)`→async fn, `useSpacetimeDB()`. **No hand-rolled useSyncExternalStore.** Avoid HS256 JWTs. Enforce separation of duties in reducers via `ctx.sender`.
- **Frontend:** Node ≥22.12. `npm i react@19.3.1 react-dom@19.3.1 pixi.js@8.22.0 shiki@4.5.0 react-diff-view@3.3.3 motion@14.6.0 convex@1.48.0 tailwindcss@4.3.3 @tailwindcss/vite@4.3.3 && npm i -D vite@8.3.5 @vitejs/plugin-react@6.1.2 typescript@7.0.2 @types/react@19.3.0 @types/react-dom@19.3.0 @types/node@26.6.5`. `motion` from `motion/react`; Pixi `await app.init()` then append `app.canvas`; `shiki` async ESM (prefer `shiki/core`+`shiki/engine/javascript`); `react-diff-view` needs `import 'react-diff-view/style/index.css'`; TS7 native — fall back `typescript@5.9` if tooling chokes.
- **Convex fallback extras** (if we switch): alpha ESP32 client, AI Gateway (any model, no keys), HIPAA. Map Query→view+subscription, Mutation→reducer, Action→procedure.

## Tasks

### 1. STDB smoke + pins — H0–H2
Run `spacetime dev --template react-ts`; confirm the subscribe+reducer round-trip; pin 2.13.0; confirm Node ≥22.12; install the SpacetimeDB Claude Code plugin + `spacetime mcp` so your coding agents use correct APIs.

### 2. Module + abstraction (`realtime/`) — H2–H10
- Implement all tables + reducers per the frozen contract; seed the single `device_status` row; enforce `recordFinding` etc. with `ctx.sender`.
- `RealtimeBackend` interface + `spacetime.ts` and `convex.ts` adapters (identical table shapes) so panels don't care which backend is live.
- **Own the ~1/3 Convex gate (~H13):** if the STDB TS loop isn't reliable, swap the adapter to Convex (one-file; forfeits the STDB prize — last resort).

### 3. Right dashboard — the "glass skull" (`app/`, agent-built from spec) — H2–H22
3-zone command center: top status bar (fleet pill "1 of 3,412" + threat chip), left **Agent Timeline** (38%), right **Evidence Stack** (62%).
- **Timeline:** vertical spine `FIND→EXPLOIT→PATCH→VERIFY→RESTORE` with a pulse traveling it; active node expands into a **streaming reasoning card** (JetBrains Mono, dimmed, typewriter autoscroll), a **confidence gauge** (dips visible = honesty), **tool-call chips** (spinner→check), and a **provenance line** to evidence.
- **Three trust cards** (unique signatures): **Self-Correction** (amber, flips v1→"REJECTED — broke emergency override, revising" — the single most persuasive pixel), **Guardrail Blocked** (red/lock refusal), **Awaiting Approval** (diff + test checklist + pulsing APPROVE button that resolves Dev 1's `canUseTool`).
- **Evidence Stack:** Shiki code view, `react-diff-view` unified diff (real Droid output), exploit terminal (200→401), verification matrix, **Telemetry-vs-Reality** card (reported vs actual — makes "the lie" legible), compliance card (FDA §524B).
- Palette near-black `#0B0F14` + one cyan `#38BDF8`; semantic-only R/A/G; Inter UI + mono for machine output; one ~450ms ease; motion = meaning only.

### 4. Left 2D sim (`app/`, PixiJS, agent-built from spec) — H2–H22
- Macro ward: grid of ~40 beds ("1 of 3,412"), yours pulses red while others stay green.
- Micro bedside **patient monitor**: three live polyline waveforms (ECG green / SpO₂ pleth cyan + big % / respiration yellow synced to the real fan), big HR/SpO₂/RR/BP, a **green "NORMAL" banner that stays green during the lie** then flips to flashing red. Crash = flatline + SpO₂ countdown + Web-Audio triple-beep + red vignette + cyanotic tint; restore feels like exhaling.
- Drive EVERYTHING from the same `device_status` subscription (true-vs-reported) as the dashboard + Arduino.
- **Stretch:** MEDJACK red-spread then green heal-wave (~30 lines of grid state + tween).

### 5. 3D hero (upside, cuttable) — H30+
Only after the core + 2D are solid: coding agents add a 3D establishing shot or one 3D element (R3F; Spline optional for fast assets). The **live monitor stays 2D**. Must be cleanly removable if risky.

### 6. Backup recording — H30–H36
OBS **Window Capture** (not Display) of a full dry-run, opening on THE MOMENT.

## Acceptance
Both panels + the serial bridge subscribe to the same rows; the dashboard renders the real Droid stream + diff; "patient crashes while the device lies" is unmistakable on the left; the Convex adapter swap is proven; a clean full-run recording exists; the 3D hero is present or cleanly cut.
