# PreVent — Right-Panel Redesign + Design Guide (v2, restrained)

> Opus-4.8 research synthesis. Supersedes design-motion-spec.md for the right panel. Verified against current index.css.

Research grounding confirmed. All five streams already executed the authoritative research (WIG fetched live, dataviz skill, AI Elements, ctx7 Geist + Tailwind v4, Radix React-19 compat) and Stream 2 confirmed direct access to `web-design-guidelines`, `vercel-react-best-practices`, `vercel-composition-patterns`, and `dataviz`. I verified the current `app/src/index.css` tokens and file inventory myself so the @theme replacement and delete-list below map to real code. Here is the final merged, conflict-resolved spec.

---

# PreVent Right-Panel Redesign — FINAL SPEC (synthesizer output)

Scope: the RIGHT dashboard panel (`app/src/panels/DashboardPanel.tsx` + `app/src/viz/*` + `app/src/index.css` tokens). The LEFT 3D hospital is redesigned separately; two hand-offs to it are flagged inline.

## Conflicts resolved (decisive rulings — read first)

1. **Palette = neutrals + 4 strictly-scoped hues.** Blue (now/active), amber (needs-you), red (lying/fail), green (resolved-one-beat). Purple + lime DELETED. At rest the panel is ~90% grayscale + blue; amber/red/green appear only at their one moment. (Resolves Stream2-vs-Stream1/3/5: amber is KEPT but scoped to the approval gate only — it is the one state that must read as "action required" and blue can't carry both "active" and "act now". Stream 2's kill-amber loses on comprehension; its hex values win everywhere else.)
2. **Hexes:** danger `#EF4444`, success `#34D399` (Stream 2, softer/modern — beats Stream 1/5 `#FF4D4F`/`#00DE68` which the owner called too hot). Amber softened to `#F5A623` (Stream 1, beats `#fd7702`).
3. **Dark dashboard, soft near-black `#0A0A0C`** — not pitch `#000`, no glows, no heavy shadows (Stream 2). The owner's "too dark / bad shadows" complaint was about the LEFT 3D scene, which goes bright/white separately.
4. **Layout = ONE column.** Kill the `xl:grid-cols-[38fr_62fr]` split entirely (the "wasted empty space"). NO separate tabbed Evidence panel (Stream 3's `EvidencePanel`/`Tabs` is DROPPED) — a second parallel column is exactly the two-narrative mess the owner hated. Everything folds into feed steps via in-step disclosures.
5. **Spinner:** 14px, 0.8s linear, gray (`--color-text-secondary` head on `--color-border-strong` track). One infinite loop in the whole panel.
6. **Confidence:** thin 4px bar + inline % via `@number-flow/react` (Stream 3/5), always blue, no threshold recolor. Drop Stream 1's 4-dot meter and `ConfidenceGauge270` entirely.
7. **Divergence chart placement:** the FULL crashing waveform moves to the LEFT 3D monitor (owner's "picture themselves in the room" goal). The right panel keeps only a compact pinned **Truth Strip** (numbers + tiny inline sparkline). (Resolves Stream1-vs-Stream2: neither full hero chart nor nothing — a 48px ledger.)
8. **Steps appear as they happen** + exactly ONE dim "queued" hint for the next stage (Stream 1), never the full 7-stage timeline.
9. **Spacing base = 16px (`p-4`)** on Tailwind's default 4px scale (Stream 2 beats Stream 1's 20px — snaps to scale, no arbitrary values).
10. **Component architecture = Stream 3** (PipelineProvider + pure `deriveActivity` selector + hand-rolled primitives, React 19 ref-as-prop, zero new deps) minus its EvidencePanel/Tabs.
11. **Attack path:** horizontal band CUT; replaced by Stream 5 Option A (one-line mono request card) living inside the Deliver/Verify step; the `200→401` flip is the money payoff there.

---

# DELIVERABLE A — PreVent Design Guide (single source of truth)

## A1. Final `@theme` block — paste-ready replacement for `app/src/index.css` lines 3–109

```css
@import "tailwindcss";

@theme {
  /* ===== NEUTRAL RAMP — the backbone (~90% of the UI) ===== */
  --color-bg:             #0A0A0C;  /* page plane                       */
  --color-surface:        #121214;  /* card / panel                     */
  --color-surface-2:      #1A1A1E;  /* nested block, input, inactive    */
  --color-surface-3:      #242429;  /* hover / pressed fill             */

  --color-border:         #26262B;  /* default 1px hairline             */
  --color-border-strong:  #33333A;  /* emphasis + spinner track         */

  --color-text:           #EDEDEF;  /* primary copy (not pure white)    */
  --color-text-secondary: #A1A1AC;  /* secondary copy, spinner head     */
  --color-text-muted:     #7E7E8A;  /* timestamps, axis, captions ≥12px */

  /* ===== ONE ACCENT: brand blue (now / active / interactive) ===== */
  --color-blue:           #0097FE;  /* alias kept: existing `blue`/`accent` refs */
  --color-accent:         #0097FE;
  --color-accent-fg:      #4DB5FF;  /* accent TEXT/icons on dark (AA)   */
  --color-accent-hover:   #0B7BFE;
  --color-accent-bg:      rgba(0,151,254,0.12);
  --color-accent-border:  rgba(0,151,254,0.32);

  /* ===== THREE RESERVED SEMANTICS (each appears only at its one beat) ===== */
  --color-warn:           #F5A623;  /* ONLY: human-approval marker + CTA (static) */
  --color-warn-fg:        #FFC65C;
  --color-warn-bg:        rgba(245,166,35,0.12);

  --color-danger:         #EF4444;  /* ONLY: device lying / error / guardrail     */
  --color-danger-fg:      #FF7A7A;
  --color-danger-bg:      rgba(239,68,68,0.12);

  --color-success:        #34D399;  /* ONLY: 401 chip + final restore (one beat)  */
  --color-success-fg:     #5FE3B0;
  --color-success-bg:     rgba(52,211,153,0.12);
  /* DELETED: --color-purple, --color-lime, --color-ok-soft, all *-50/300/600/700 ramps */

  /* ===== FONTS (one sans; display font dropped) ===== */
  --font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;

  /* ===== TYPE SCALE (compact dashboard scale — display scale deleted) ===== */
  --text-overline: 11px;  --text-overline--line-height: 16px;
  --text-overline--letter-spacing: 0.04em; --text-overline--font-weight: 600;
  --text-meta: 12px;      --text-meta--line-height: 16px;
  --text-sm: 13px;        --text-sm--line-height: 18px;
  --text-base: 14px;      --text-base--line-height: 20px; --text-base--letter-spacing: -0.006em;
  --text-lg: 16px;        --text-lg--line-height: 22px;  --text-lg--letter-spacing: -0.01em; --text-lg--font-weight: 500;
  --text-xl: 20px;        --text-xl--line-height: 26px;  --text-xl--letter-spacing: -0.02em; --text-xl--font-weight: 600;
  --text-stat: 28px;      --text-stat--line-height: 30px; --text-stat--letter-spacing: -0.02em; --text-stat--font-weight: 600;

  /* ===== RADIUS (7 steps → 4 + pill; 10px dominant) ===== */
  --radius-xs: 6px;   /* chips/badges        */
  --radius-sm: 8px;   /* buttons, inputs     */
  --radius-md: 10px;  /* DOMINANT: cards + feed items */
  --radius-lg: 12px;  /* outer panel         */
  --radius-pill: 999px;

  /* ===== MOTION ===== */
  --ease-out:   cubic-bezier(0.22, 1, 0.36, 1);  /* entrances, draw-in, number settle */
  --ease-state: cubic-bezier(0.4, 0, 0.2, 1);    /* color / opacity micro-states       */
  --dur-micro: 120ms;  /* hover / color state  */
  --dur-base:  220ms;  /* appear / collapse    */
  --dur-draw:  360ms;  /* chart line draw-in   */
  --dur-settle: 600ms; /* number settle        */

  /* ===== ELEVATION — one card shadow, minimal (no glows anywhere) ===== */
  --shadow-card: 0 1px 2px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.03);

  --animate-spin-slow: spin 0.8s linear infinite;
}

/* Keep Tailwind's 4px --spacing default (p-1=4 … p-4=16 … p-6=24). Do NOT override. */
:root { color-scheme: dark; }
html, body, #root { height: 100%; }
body {
  margin: 0; background: var(--color-bg); color: var(--color-text);
  font-family: var(--font-sans); font-size: 14px; line-height: 1.45;
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
}
```

## A2. Supporting CSS (replaces lines 129–281; deletes every glow/gradient/pulse)

```css
/* ----- The only two surface recipes ----- */
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
}
.card--active { border-color: var(--color-accent-border); }   /* active = border, NO glow */
.card--alert  { border-color: var(--color-danger); }          /* lying = border, NO glow */

/* ----- Focus ring (WIG: visible, :focus-visible, offset) ----- */
:where(a, button, [role="button"], input, [tabindex]):focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

/* ----- The gray spinner — the ONLY in-progress indicator ----- */
.spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 1.5px solid var(--color-border-strong);    /* gray track */
  border-top-color: var(--color-text-secondary);     /* gray head  */
  animation: var(--animate-spin-slow);
}
@media (prefers-reduced-motion: reduce) {
  .spinner { animation: none; border-top-color: var(--color-border-strong); }
}

/* ----- WIG fix: list properties, never `transition: all` ----- */
.state-transition { transition: color, background-color, border-color, opacity var(--dur-micro) var(--ease-state); }

/* ----- react-diff-view, de-animated, two-color, inside the on-demand disclosure only ----- */
.diff {
  --diff-background-color: transparent;
  --diff-text-color: var(--color-text);
  --diff-font-family: var(--font-mono);
  --diff-gutter-insert-background-color: var(--color-success-bg);
  --diff-gutter-insert-text-color: var(--color-success-fg);
  --diff-gutter-delete-background-color: var(--color-danger-bg);
  --diff-gutter-delete-text-color: var(--color-danger-fg);
  --diff-code-insert-background-color: rgba(52,211,153,0.07);
  --diff-code-insert-text-color: var(--color-success-fg);
  --diff-code-delete-background-color: rgba(239,68,68,0.07);
  --diff-code-delete-text-color: var(--color-danger-fg);
  font-size: 12px;
}
.diff-decoration-content { color: var(--color-text-secondary); }
```

**DELETE from current `index.css` (verified present):** `--color-bg-raised`, `--color-surface-4`, `--color-glass`, `--color-border-faint`, `--color-border-emphasis`, the whole `blue-50/300/600/700/10/15` ramp (keep only `--color-blue`), `--color-muted` alias, `--color-text-faint`, `--color-ok`/`--color-ok-soft` (→ `success`), `--color-purple`, `--color-lime`, `--font-display` + the `display-xl…caption` type scale, `--radius-2xl/xl` (renumbered), `--ease-framer/--ease-prevent`, ALL `--grad-*` and `--glow-*`, `.glass-card`, `.gradient-border`, `.cta-blue` (+ its glow hover), the `.status-dot` glow box-shadows, `@keyframes prevent-pulse` + `.pulse`, and `.prevent-transition { transition: all }` (WIG violation — replaced by `.state-transition`). Find-replace in `.tsx`: `text-ok`→`text-success`, `border-ok*`→`border-success*`, every `*-warn*` keeps only on the approval gate, delete all `text-purple`/`text-lime`, delete every hardcoded `rgba(0,151,254,…)`/`rgba(255,77,79,…)` glow string.

## A3. Usage rules (the iron laws)

- **Color:** neutral ramp carries all structure. Blue marks the ONE active/interactive thing. **Red/amber/green are EVENTS, not chrome** — red only while the device is lying or on error; amber only on the approval gate; green only on 401 + restore. Reaching for a color to label a category = wrong; use weight + position. Accent text must use `--color-accent-fg` (#4DB5FF), never raw `#0097FE` for small copy.
- **Backgrounds:** page `bg` → card `surface` → nested/input `surface-2` → hover `surface-3`. Never stack >3 surface levels.
- **Spacing (4px):** card padding `p-4` (16). Section gap `gap-4`. In-card stack `space-y-3` (12). Step label→body `gap-2` (8). Sub-events/tight meta `gap-1.5`/`gap-1` (6/4). NO arbitrary `p-5`, `gap-6`, `top-[9px]`.
- **Radius:** cards/feed items `rounded-md` (10). Buttons/inputs `rounded-sm` (8). Chips `rounded-xs`/`rounded-pill`. Nothing else.
- **Elevation:** `.card` only. No glows. "Active" = accent border; "alert" = danger border. Never a shadow for state.
- **Type:** row title `text-base` 500; status line `text-sm` secondary; meta/time `text-meta` mono muted; section caps `text-overline` uppercase muted; at most ONE `text-stat` on screen.
- **Numbers:** `tabular-nums` ONLY in aligned/table contexts (vitals grid, axis, confidence). Proportional figures for any standalone hero number (dataviz rule). Numbers settle once (600ms) and stop — no odometer, no lurch.
- **Motion:** appear = `y:8→0, opacity:0→1`, `--dur-base --ease-out`. State change = color/border `--dur-micro --ease-state`. Spinner = gray 0.8s. NO infinite pulse/radar/comet/shimmer. Everything off under `prefers-reduced-motion`. Compositor-only props (`transform`/`opacity`/`color`); never `transition: all`.
- **Copy:** in-progress labels end in a single `…` char. Title Case headings. Curly quotes, non-breaking space in units (`72 bpm`).

## A4. Motion tokens — final `app/src/lib/motion.ts`

```ts
export const DUR   = { micro: 0.12, base: 0.22, draw: 0.36, settle: 0.6 } as const;
export const EASE_OUT   = [0.22, 1, 0.36, 1] as const;  // entrances, draw-in, settle
export const EASE_STATE = [0.4, 0, 0.2, 1]   as const;  // color/opacity micro-states
export const SPRING = {
  move: { type: 'spring', stiffness: 300, damping: 30, mass: 0.9 }, // active-marker FLIP, layout
  snap: { type: 'spring', stiffness: 460, damping: 24, mass: 1 },   // the ONLY overshoot: lie beat + 401 pop
} as const;
// DELETED: dramatic, vital, soft, default, snappy, scroll, relay/count/reveal, EASE_FRAMER, EASE_IN_OUT
```

## A5. Do / Don't cheat-sheet

| ✗ Don't | ✓ Do |
|---|---|
| Add a new hue to distinguish a thing | Use weight + position |
| Big radial gauge / odometer | Inline `87% confident` + 4px bar |
| Glow to show importance | Accent border + ordering |
| Render future/idle steps | Render only what happened |
| `transition: all`, infinite pulses | List props; one gray spinner |
| Green on every "done" | Green only on 401 + restore |
| `tabular-nums` on a hero number | Proportional for hero; tabular in grids |
| Nested cards in the feed | One surface, in-step disclosures |

---

# DELIVERABLE B — Right-Panel Redesign Spec

## B1. Information architecture — one column, three stacked regions

```
┌─ RIGHT PANEL — single .card, rounded-lg, max-w-[640px] mx-auto ─┐
│ ① HEADER STRIP   device id · status chip · ST·live · scale pill │  ~56px fixed
│ ───────────────────────────────────────────────────────────── │
│ ② ACTIVITY FEED  steps appear as they happen, newest in focus, │  flex-1, scrolls
│                  finished collapse to one line; artifacts live  │
│                  INSIDE their step behind disclosures           │
│ ───────────────────────────────────────────────────────────── │
│ ③ TRUTH STRIP    reported ▸ actual + tiny sparkline; red only   │  ~48px pinned
│                  when the device is lying                       │
└─────────────────────────────────────────────────────────────────┘
```

**Dies (owner kill-list → code):** the `38fr/62fr` inner grid; the pre-laid 7-node SVG spine + `TravelingComet` + radar ping + spring progress line ("heartbeat bs" / "full timeline"); standalone Findings / PatchDiff / Compliance / EventLog cards and the "Evidence" `<h3>`; `ConfidenceGauge270`; the `AttackPath` horizontal band; the header odometer animation; raw `file:line`, scanner chips, `AnimatedNumber` "huge numbers"; `prevent-pulse`, `.pulse` on approve, every decorative infinite loop.

**Survives, relocated (track-critical — must NOT be lost):** Factory patch plan + unified diff + human approve gate → inside the `patch` step (diff behind "Review patch", collapsed). Anthropic reasoning + confidence + self-correction + guardrail → inside the active step (reasoning streams; self-correct/guardrail are inline sub-events). Bitdeer/Armadin exploit→401 → one-line request card in the deliver/verify step. SpacetimeDB "one shared row" → header chip + caption. Scale `1 of 3,412` → static header pill. FDA §524B receipt → final feed item's "Audit receipt" disclosure.

## B2. Component list + APIs (file tree under `app/src/`)

```
components/pipeline/
  PipelineProvider.tsx   // Context value {state, actions, meta}; React 19 <Context> as provider
  usePipeline.ts         // use(PipelineContext) + throw-if-null
  deriveActivity.ts      // PURE: AgentStatus[] -> ActivityEntry[]  (filter state!=='idle', sort by updatedAt)
  status.ts              // STATUS_TOKENS, STAGE TITLE map, ActivityStatus type (single color source)
components/feed/
  ActivityFeed.tsx       // <ol aria-live="polite"> + <AnimatePresence initial={false}>
  ActivityStep.tsx       // one row; renders expanded body ONLY when active/needs-approval
  StepReasoning.tsx      // streaming text, 2-line clamp + "View reasoning" disclosure, aria-live=polite
components/primitives/
  Spinner.tsx            // 14px gray, class .spinner, role=status + sr-only label
  StatusMarker.tsx       // spinner | amber-ring | neutral-check | red-dot | hollow-ring
  StatusPill.tsx         // text: running/needs approval/done/failed; neutral except warn+error
  ConfidenceMeter.tsx    // 4px bar, blue fill, <NumberFlow> %, role=meter (NOT a gauge)
  Disclosure.tsx         // <button aria-expanded> + region; children unmounted when closed
  CompactDiff.tsx        // one-line summary -> expands react-diff-view (static, de-animated)
components/gate/
  ApprovalGate.tsx       // Factory human gate; amber CTA, static; -> spinner "Deploying…" on click
components/truth/
  TruthStrip.tsx         // 48px pinned; reported▸actual + inline Sparkline; red only when lying
panels/
  DashboardPanel.tsx     // THIN composition root
```

**Key APIs:**

```tsx
// deriveActivity.ts — kills the pre-laid timeline AND the empty column in one move
export type ActivityStatus = 'running' | 'needs-approval' | 'done' | 'error' | 'queued';
export function deriveActivity(agents: AgentStatus[]): ActivityEntry[] {
  return agents.filter(a => a.state !== 'idle')
    .map(a => ({ id:`stage:${a.stage}`, stage:a.stage, title:TITLE[a.stage],
      status: a.state==='running'?'running':a.state==='waiting_for_human'?'needs-approval'
             :a.state==='done'?'done':'error',
      agentName:a.agentName, reasoning:a.reasoning, confidence:a.confidence,
      uncertainty:a.uncertainty, at:a.updatedAt }))
    .sort((x,y) => x.at - y.at);              // chronological, newest at bottom
}
// Feed appends exactly ONE queued hint: the next stage after the last non-idle one.

<ActivityStep status="running" | "needs-approval" | "done" | "error" | "queued"
  label="Writing the auth fix" agentName="Factory Droid"
  summary="Added device-token auth." timestamp={ms}>
  <StepReasoning text={agent.reasoning} streaming={status==='running'} />   // auto-collapse on done
  <ConfidenceMeter value={agent.confidence} uncertainty={agent.uncertainty} />
  <StepSubEvent kind="self-correct" | "guardrail" text="…" />               // inline, muted / red
  <Disclosure trigger="Details">…finding prose…</Disclosure>
  <Disclosure trigger="Review patch (diff)"><CompactDiff diff={diffRef}/></Disclosure>
  <ApprovalGate show={status==='needs-approval'} approved={approved} onApprove={fn} />
</ActivityStep>
```

**React-19 / Vercel rules:** `use(Context)` not `useContext`; `ref` as a plain prop (NO `forwardRef` — fixes the current `SelfCorrectionCard`/`AwaitingApprovalCard` motion cards); components at module scope; direct path imports (no barrel); `deriveActivity` memoized in render, never an effect; diff `parseDiff` runs only when its Disclosure opens; `content-visibility:auto` on collapsed done rows. Props are data-in only (`entry`), no boolean soup — the step derives its affordances from `entry.status`.

## B3. Step lifecycle & exact visual states

| data `state` | UI status | left-gutter marker (20px) | body |
|---|---|---|---|
| `running` | **active** | **14px gray spinner** | expanded: streaming reasoning + confidence |
| `waiting_for_human` | **needs you** | amber ring, static (the only amber) | expanded: approve CTA + plan |
| `done` | **complete** | neutral check `#BFBFBF` on `surface-2`, no green | collapsed to one summary line |
| `error` | **failed** | red dot, static (no shake) | expanded: error + retry note |
| next stage (`idle`) | **queued** | 6px hollow ring `rgba(255,255,255,.18)` | label only, 50% opacity |

- **Marker rail:** fixed 20px gutter; a 1px `--color-border` connector segment drawn between markers (CSS, grows with the stack — never a pre-drawn full spine); the segment above the active row is `--color-accent`.
- **Appear:** `opacity 0→1, y 8→0`, `--dur-base --ease-out`. No x-slide, no blur.
- **Complete:** spinner → check crossfade 120ms; reasoning auto-folds 180ms to the one-line summary; next step appears below.
- **Auto-scroll:** `scrollIntoView({block:'nearest', behavior: reduce?'auto':'smooth'})` (never `'center'`).
- **Confidence:** 4px full-width bar, track `rgba(255,255,255,.07)`, fill `scaleX 0→value` in `--color-blue` (never threshold-recolors), inline `87%` proportional via `@number-flow/react`. `uncertainty` on demand only.

## B4. Where each SPONSOR-CRITICAL element lives (clean / on-demand)

- **Factory (non-negotiable — "make Droid's work visible: plans, diffs, results"):** `patch` step while running shows Droid's plan/steps as its reasoning stream, labeled **"Factory Droid"**. Default = summary line `Auth check added · untrusted overrides ignored · 2 tests pass`. **"Review patch (diff)"** disclosure lazy-mounts `react-diff-view` (static, two-color). **Approval gate** = amber `Approve & deploy` CTA (static, no pulse) with a 3-item preflight (patch written / tests green / exploit proof captured) + the scope line "Droid scoped to `device-service/` · cannot commit, push, or deploy." On click → gray spinner + "Deploying…".
- **Anthropic:** reasoning streams in the active step (`aria-live="polite"`, 2-line clamp + expand); confidence = the bar+%; **self-correction** = inline sub-event `↻ Revised once — first fix broke the emergency override` (muted); **guardrail refusal** = inline sub-event `⌀ Sandbox refused the destructive call` (danger text). No floating cards.
- **Bitdeer:** `generate`/`deliver` step labeled **"DeepSeek-V4.1-Flash on Bitdeer"**; one-line result; PoC payload behind a disclosure.
- **Armadin:** ONE real finding in plain language `Missing auth on the device command endpoint (CWE-306)` + REAL badge; scanner/`file:line`/severity/CVE behind "Details". Verify step: exploit re-run FAILED (good).
- **SpacetimeDB (biggest *missing* keep — add it):** header chip `SpacetimeDB · live` + one caption "one shared row → this screen, the monitor, and the device"; hover expands the explanation. Row-driven content must keep the instant snap (no artificial loading states).
- **Microsoft / People-First:** FDA §524B receipt = final feed item behind "Audit receipt" (static `§524B ✓` stamp, plain `<dl>`); human gate doubles for both tracks; the "device lies while patient crashes" beat = the Truth Strip; audit log = one latest line + expand.
- **Scale:** static header pill `1 of 3,412 devices` (no odometer).
- **Hardware + Fetch.ai:** satisfied outside the right panel (physical board / ASI:One chat); add at most a small header badge only if the loop is Fetch-triggered. Do not spend dashboard space.

## B5. Attack / lie / 401 presentation

- **Attack = Stream 5 Option A:** a compact mono request card inside the deliver step:
  `→ POST /device/command    no auth · CWE-306    [ 200 OK ]` — the status token red while compromised.
- **401 payoff (the ONLY green + the ONLY `SPRING.snap` overshoot):** on verify, red label fades out (120ms) → 200ms hold → green `401 Unauthorized` chip pops `scale [0.6,1.08,1]` + thin green underline draws once, then nothing moves. Proportional figures. Verify summary: "Same request, replayed → 401 Unauthorized."
- **Lie beat (Truth Strip, the ONLY red surface besides error text):** on rising edge of `reportedHr !== trueHr`: strip bg → `--color-danger-bg`, left border 2px `--color-danger`, the **actual** number turns red and settles downward, label flips to "device is lying · alarm silenced", ONE 400ms shake (transform, once — not looping). No background bloom, no box-shadow glow. Recovers via `--ease-state` micro-fade. **Hand-off to LEFT 3D:** the full crashing `VitalsDivergenceChart` waveform belongs on the monitor there, not here.

## B6. What gets CUT (owner complaints → resolution)

Horizontal `AttackPath` band · `ConfidenceGauge270` · duplicated full vitals tiles (keep one reported-vs-true pair) · raw `file:line`/scanner noise (→ behind "Details") · always-open unified diff (→ "Review patch") · tall always-open event log (→ one latest line + expand) · the "Evidence" header + `38fr/62fr` split · radar ping / `TravelingComet` / `status-dot.live` glow / reasoning shimmer / attack halo breathing (keep ONE gray spinner) · purple + lime + the amber-everywhere usage · the header odometer · all glows/gradients.

## B7. ASCII wireframes

**IDLE** (no threat — where the current UI fails worst; here it is quiet):
```
┌───────────────────────────────────────────────────────────┐
│ Ventilator · Lab unit #0001   ● secure   ST·live   1/3,412 │ ① 56px
├───────────────────────────────────────────────────────────┤
│                                                             │
│   No active investigation. Monitoring 1 device.            │ ② one muted line
│                                                             │   (NOT 7 stages)
├───────────────────────────────────────────────────────────┤
│ Device truth   HR 72 ▸ 72   SpO₂ 98 ▸ 98        ● in sync  │ ③ 48px neutral
└───────────────────────────────────────────────────────────┘   zero motion
```

**MID-RUN** (patch awaiting approval):
```
┌───────────────────────────────────────────────────────────┐
│ Ventilator · #0001   ● compromised   ST·live   4/7 ▸▸▸▸░░░ │ ① header
├───────────────────────────────────────────────────────────┤
│ ✓  Grounded device context                        0:02     │ done, 1 line
│ ✓  Scanned firmware — 1 real vuln (missing auth)  0:09     │
│    ▸ Details                                               │ (collapsed)
│ ✓  Proved exploit in sandbox — device went silent 0:21     │
│    → POST /device/command  no auth · CWE-306  [200 OK]     │ request card (red)
│                                                             │
│ ◐  Writing the auth fix              Factory Droid         │ ← ACTIVE
│ │    Claude: require X-Device-Token, drop untrusted        │   gray spinner
│ │    overrides. Tests green in sandbox.                    │   reasoning streams
│ │    Confidence ▁▁▁▁▁▁▁▁░░  82%                            │   4px bar + %
│ │    ↻ Revised once — first fix broke emergency override   │   self-correct
│ │    Patch plan: • device-token auth on /command           │
│ │                • ignore reportedOverrides                │
│ │    ▸ Review patch (diff)                                 │   collapsed diff
│ │   ┌─────────────────────────────────────────────┐       │
│ │   │              Approve & deploy                 │       │   AMBER CTA, static
│ │   └─────────────────────────────────────────────┘       │
│ │    Droid scoped to device-service/ · cannot deploy       │
│ ○  Verify                                      queued      │   ONE dim hint
├───────────────────────────────────────────────────────────┤
│ ⚠ device is lying · alarm silenced  HR 72▸41↓ SpO₂ 98▸72↓  │ ③ RED strip
└───────────────────────────────────────────────────────────┘   (one shake, fired)
```

**DONE** (restored):
```
┌───────────────────────────────────────────────────────────┐
│ Ventilator · #0001   ● patched   ST·live   7/7 ▸▸▸▸▸▸▸     │ ①
├───────────────────────────────────────────────────────────┤
│ ✓  Grounded device context                        0:02     │ 7 collapsed
│ ✓  Scanned firmware — 1 real vuln                 0:09     │ one-liners,
│ ✓  Proved exploit in sandbox                      0:21     │ neutral checks
│ ✓  Wrote & approved the auth fix (Factory)        1:04     │
│ ✓  Verified — same request, replayed → [401]      1:11     │ green 401 chip
│ ✓  Restored — patient stable        ● stable  ▸ Audit receipt│ one green chip
├───────────────────────────────────────────────────────────┤
│ Device truth   HR 72 ▸ 72   SpO₂ 98 ▸ 98        ● in sync  │ ③ back to neutral
└───────────────────────────────────────────────────────────┘   no spinners, calm
```

## B8. Reduced-motion contract (WIG, non-negotiable)

`<MotionConfig reducedMotion="user">` + per-component `useReducedMotion()`: spinner → static ¾ arc; appear → instant opacity (no y); lie/401 → final state immediately (meaning preserved, transform dropped); numbers → `mv.set(value)`; charts → render pre-drawn (`initial={false}`). All motion on `transform`/`opacity`/`color` only.

---

## Verification notes & open items for sign-off

- Grounded against the **actual** `app/src/index.css` (read this session) — the delete-list maps to tokens that are really present; the @theme block is paste-ready.
- `@number-flow/react@0.6.2`, `react-diff-view@3.3.3`, `motion@14.6.0` are already installed per Stream 3 — **zero new dependencies**. Radix is only a fallback if hoverable tooltips become mandatory.
- **Decisions the owner should confirm before implementation:** (1) amber KEPT but scoped to the approval gate only — if the owner wants truly zero amber, the gate falls back to blue CTA; (2) the full crashing waveform moves to the LEFT 3D monitor, right panel keeps only the Truth Strip ledger; (3) dashboard stays dark `#0A0A0C` while the 3D hospital goes bright/white (the intentional "calm patient world vs. machine watching over it" split).
- Relevant files for the implementation workflow: `C:\Users\chris\orca\calhacks\app\src\index.css`, `C:\Users\chris\orca\calhacks\app\src\panels\DashboardPanel.tsx`, `C:\Users\chris\orca\calhacks\app\src\lib\motion.ts`, `C:\Users\chris\orca\calhacks\app\src\viz\ConfidenceGauge270.tsx` (delete), `C:\Users\chris\orca\calhacks\app\src\viz\AttackPath.tsx` (delete), `C:\Users\chris\orca\calhacks\app\src\viz\VitalsDivergenceChart.tsx` (move to left 3D), `C:\Users\chris\orca\calhacks\app\src\lib\TravelingComet.tsx` (delete), and `C:\Users\chris\orca\calhacks\contracts\src` (RealtimeState types the new components read).