# Dev 3 (frontend / realtime) — handoff notes

Picking up Dev 3 UI? Read this first — then jump to the "What to do next"
section at the bottom.

Everything in this doc assumes you have the shared Maincloud env set in `.env`
(see README → "Realtime quick start") so you can run `pnpm --filter @prevent/app
dev` and see live rows. If you want local, see README's "Local fallback".

---

## 1. What's shipped and verified working

Both panels read the SAME `device_status` / `agent_status` / `findings` /
`event_log` rows via `useRealtime()` (SpacetimeDB `useTable`), so writes from
Dev 1's orchestrator or `scripts/seed-demo.sh` flow to both without any extra
wiring.

**App shell** (`app/src/App.tsx`, `app/src/main.tsx`)
- Two-column layout with header pills (`1 of 3,412 devices`, THREAT ACTIVE / NO THREATS, source: live / mock).
- `SpacetimeDBProvider` wraps `<App />` only when `VITE_REALTIME_BACKEND === 'spacetimedb'` — else the mock hook returns fixtures.
- Vite is pointed at the monorepo-root `.env` via `envDir: '..'`.

**Patient monitor** (`app/src/panels/pixi/PatientMonitor.tsx`)
- PixiJS v8 Application in a React ref. Three stacked waveform lanes (ECG, SpO₂ pleth, respiration) scroll right-to-left at ~90 px/sec.
- ECG + SpO₂ pleth driven by `reportedHr` / `reportedSpo2` so the device can lie.
- Respiration driven by TRUE `fanOn` — flatlines the moment the ventilator stops.
- Amplitude envelope smoothly collapses ECG + SpO₂ to flat on `alarmActive=true`, swells back ("exhale") on restore.
- Web Audio triple beep on the RISING edge of `alarmActive` (unlocks on first user gesture).
- Big `⚠ CODE` overlay fades in with the alarm; red vignette pulses behind it.

**Dashboard** (`app/src/panels/DashboardPanel.tsx`)
- Timeline (left ~38%): all 7 stages always visible; active node expands into a reasoning stream (autoscroll monospace box) + confidence gauge + optional uncertainty note.
- Trust cards (conditional):
  - `AwaitingApprovalCard` — appears when any agent is in `waiting_for_human`. Pulsing amber APPROVE & DEPLOY button.
  - `SelfCorrectionCard` — appears when any agent's `reasoning` contains REJECTED / revising / self-correct (case-insensitive).
  - `GuardrailBlockedCard` — appears when any `event_log` row has `actor = 'guardrail'` or text matching `action refused` / `sandbox refused`.
- Evidence stack (right ~62%): Telemetry-vs-Reality (snaps red when reported ≠ true), Findings (REAL badge on `isTheRealOne`), Patch diff (via `react-diff-view` with scoped dark-theme CSS vars), FDA §524B compliance, Event log.

**Realtime backbone**
- `realtime/spacetimedb/src/index.ts` — the server module (schema + reducers with `ctx.sender` role checks).
- `realtime/src/module_bindings/` — client bindings (COMMITTED; regenerate with `pnpm --filter @prevent/realtime gen` after a schema change).
- `realtime/src/backend/` — the `RealtimeBackend` abstraction (SpacetimeDB primary, Convex fallback stub, Mock for tests).
- `realtime/src/spacetime-client.ts` — the subpath export the app imports: `createSpacetimeBuilder`, `tables`, `DbConnection`, event-context types.

**Demo tooling**
- `scripts/seed-demo.sh` — named phases (`healthy | scanning | attack | mayday | self-correct | guardrail | patch-pending | verified`) that call reducers directly so you can rehearse without the real orchestrator.
- `plans/DEMO-FLOW.md` — beat-by-beat 3-min pitch script, express path, troubleshooting.

**Typecheck**
- `pnpm -r typecheck` is green across every workspace package (`contracts`, `agents`, `app`, `realtime`, `serial-bridge`, `emulator`).

---

## 2. What's stubbed (works, but swap when live data arrives)

| Surface | Current | Target |
|---|---|---|
| **Patch diff viewer** | Renders a canned CWE-306 diff from `SAMPLE_DIFF` constant in `DashboardPanel.tsx` | Subscribe to the `patch_attempts` table in `useRealtimeLive`, pass the newest row to `PatchDiffCard`. NOTE: on the live producer (`agents/src/orchestrator.ts`), `patch_attempts.diffRef` currently holds the **Droid session id**, not diff text, and the control server has **no `/diff` route** — so rendering a real diff needs a producer/route change first, not just a fetch. |
| **APPROVE button** | Click handler is a no-op (`onApprove` prop is optional and unused) | POST to Dev 1's control server `/approve` (`agents/src/controlServer.ts`). It takes **no `patchId`** — it settles whichever human gate is currently pending (optional `{approvedBy}` body); there is one in-flight patch per run. |
| **Agent-row names** | `seed-demo.sh` now passes the BARE stage name (`scan`/`deliver`/…) as `update_agent_status`'s `agentName` so it updates the init-seeded row instead of inserting a duplicate | Same convention from the real orchestrator's `update_agent_status` calls — no app change needed |
| **Event log pagination** | Renders all rows (max-height scroll) | Fine for the demo; if the loop runs long, cap to last 50 rows |
| **FDA receipt device id** | Hardcoded "Model VENT-SIM / Lab unit #0001" | Pull from `device_status.id` once we add a serial field |

---

## 3. What's missing (optional, cuttable)

Listed in order of pitch impact:

1. **3D fleet view** — the "1 of 3,412 devices" header line turned into an isometric ward grid where yours pulses red while 39 others stay green. Spec: `react-three-fiber` or vanilla three.js; must be cleanly removable in one line of JSX. ~1 hr. Hooks for a MEDJACK red-spread → green-heal-wave animation already fit `device_status.compromised`.
2. **Tool-call chips** on active timeline nodes — small pills showing "SemGrep ✓ Bandit ✓ Claude ⏳" per stage. Needs a new column or event-log convention.
3. **Shiki syntax-highlighted code view** of the vulnerable `app.py` line next to the finding. Use `shiki/core` + `shiki/engine/javascript` (async) so bundle stays small; the dep is already in `app/package.json`.
4. **Exploit terminal** card — mocked terminal showing `POST /device/command → 200 OK` pre-patch and `→ 401 Unauthorized` post-patch.
5. **Verification matrix** card — table of unit tests, with the exploit replay as one row.
6. **Ward grid in 2D** — fallback if 3D is risky; same story, less wow.

---

## 4. Known issues / sharp edges

- **AudioContext unlock**: the alarm beep will NOT fire on the very first alarm unless the user clicked / typed on the page first. The demo rig MUST have a prior click. (The 3D hero stretch would double as the unlock gesture.)
- **Diff view styling**: react-diff-view's CSS imports after our overrides, so we scope the CSS variables to `.diff` (see `app/src/index.css`). If you add a second diff component, re-use the same `.diff` wrapper or move the overrides to `html:has(.diff)`.
- **Reducer context typing**: `realtime/spacetimedb/src/index.ts` uses `type Ctx = any` for helpers (`requireRole`, `log`, `nowMs`) because the SDK's inferred ctx shape didn't line up with `ReducerCtx<typeof spacetimedb>` under TS 7. Reducer bodies still get the SDK's precise ctx. Server compiles to WASM — runtime is fine.
- **Mock backend generic**: `realtime/src/backend/mock.ts` casts a `Store[K]` spread through `unknown` because TS can't narrow the per-table union. Not worth plumbing a proper generic.
- **Pixi monitor on StrictMode double-mount**: the `cancelled` flag + try/catch destroy handle it. If you refactor, keep both.

---

## 5. Env + commands cheat sheet

```
VITE_REALTIME_BACKEND=spacetimedb
VITE_SPACETIMEDB_URI=wss://maincloud.spacetimedb.com   # or ws://localhost:3000 for solo dev
VITE_SPACETIMEDB_MODULE=prevent
VITE_CONVEX_URL=https://spotted-kudu-58.convex.cloud   # placeholder only; convex is UNBUILT — the app fails loud on VITE_REALTIME_BACKEND=convex (see README)
```

```bash
# Run the app
pnpm --filter @prevent/app dev

# Typecheck everything
pnpm -r typecheck

# Rehearse demo phases (writes to whichever module the frontend is pointed at)
./scripts/seed-demo.sh healthy
./scripts/seed-demo.sh attack
./scripts/seed-demo.sh mayday
./scripts/seed-demo.sh patch-pending
./scripts/seed-demo.sh verified

# Regenerate client bindings after a module schema change (OWNER only)
pnpm --filter @prevent/realtime gen
spacetime publish --module-path realtime/spacetimedb --server maincloud prevent
```

---

## 6. What to do next (recommended order)

1. **Verify the live chain**: start the app, run Dev 1's orchestrator against the live Maincloud module (`pnpm --filter @prevent/agents <bench or run>`), and watch the dashboard react in real time. First end-to-end test exposes any contract drift fast.
2. **Wire APPROVE** to Dev 1's HTTP control server so the human gate becomes a real approval, not a cosmetic click.
3. **Swap the canned patch diff** for a live one — but first coordinate with Dev 1: `patch_attempts.diffRef` currently holds the Droid session id (not diff text) and there's no `/diff` route to fetch it by, so this needs a producer/route change, not just a subscription.
4. **(Stretch) 3D fleet view** — only after 1–3 are solid; it is the single highest-wow stretch and the plan calls it out as cuttable.
5. **Backup demo video** (OBS Window Capture) — Sat night, before anyone sleeps.
6. **Make the repo PUBLIC** right before Devpost submission (hard deadline Sun 9:00 AM PDT).
