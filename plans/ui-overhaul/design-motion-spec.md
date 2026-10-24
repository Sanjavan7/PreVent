# PreVent — Design & Motion System (v1, implementation-ready)

> Verified via headless Playwright capture of framer.com + ctx7 (Motion v14) on 2026-10-24. Source of truth for the UI overhaul. Stack: React 19.3.1 · Vite 8.3.5 · Tailwind v4.3.3 (`@theme` in `app/src/index.css`) · `motion@14.6.0` (import from **`motion/react`**, NOT `framer-motion`) · PixiJS 8.22.0.

**Aesthetic:** framer.com — pitch-black `#000` elevation ladder + single accent **`#0097FE`**, white-alpha hairline borders, glass cards, purple+blue gradient charts, mono agent logs. **One brand accent only** (blue); purple/red/green are data-series/semantic, never chrome.

**Locked decisions:** true-black backgrounds (`#000`→`#242424` ladder); white-at-low-alpha borders (`rgba(255,255,255,0.07)`); danger `#FF4D4F`, success `#00DE68`, purple series `#8A58FF`; two easings `--ease-framer: cubic-bezier(.44,0,.56,1)` (hover/micro) + `--ease-settle: cubic-bezier(.22,1,.36,1)` (entrances/draws); one new dep `@number-flow/react@0.6.2` for hero odometer digits; charts hand-rolled SVG+Motion (no React Flow, no charting lib).

---

## 1. DESIGN TOKENS — replace the entire `@theme` block in `app/src/index.css`

The `--color-accent:#0097fe` alias keeps existing `accent` refs valid. The 3 hardcoded `rgba(56,189,248,…)` shadows in `DashboardPanel.tsx` `STATE_DOT` must change to `rgba(0,151,254,…)`.

```css
@import "tailwindcss";

@theme {
  /* ---- Backgrounds: true-black elevation ladder (verified) ---- */
  --color-bg:        #000000;
  --color-bg-raised: #080808;
  --color-surface:   #0e0e0e;
  --color-surface-2: #141414;
  --color-surface-3: #1c1c1c;
  --color-surface-4: #242424;
  --color-glass:     rgba(255,255,255,0.03);

  /* ---- Borders: white-alpha hairlines ---- */
  --color-border-faint:    rgba(255,255,255,0.05);
  --color-border:          rgba(255,255,255,0.07);
  --color-border-strong:   rgba(255,255,255,0.10);
  --color-border-emphasis: rgba(255,255,255,0.15);
  --color-border-accent:   rgba(0,151,254,0.30);

  /* ---- Brand blue ramp ---- */
  --color-blue-50:  #e6f4ff;
  --color-blue-300: #5bc0ff;
  --color-blue:     #0097fe;
  --color-blue-600: #0066ff;
  --color-blue-700: #0047b3;
  --color-blue-10:  rgba(0,151,254,0.10);
  --color-blue-15:  rgba(0,151,254,0.15);
  --color-accent:   #0097fe;   /* alias — keeps existing refs valid */
  --accent-rgb:     0 151 254;

  /* ---- Text ---- */
  --color-text:           #ffffff;
  --color-text-strong:    #eeeeee;
  --color-text-secondary: #999999;
  --color-text-muted:     #666666;
  --color-text-faint:     #474747;

  /* ---- Semantic / data series ---- */
  --color-ok:      #00de68;
  --color-ok-soft: #4cd963;
  --color-warn:    #fd7702;
  --color-danger:  #ff4d4f;
  --color-purple:  #8a58ff;
  --color-lime:    #cbff00;

  /* ---- Fonts ---- */
  --font-display: "Inter Tight","Inter",ui-sans-serif,system-ui,sans-serif;
  --font-sans:    "Inter",ui-sans-serif,system-ui,-apple-system,sans-serif;
  --font-mono:    "JetBrains Mono",ui-monospace,"SFMono-Regular",Menlo,monospace;

  /* ---- Type scale ---- */
  --text-display-xl: clamp(48px,6vw,72px); --text-display-xl--line-height:1.0; --text-display-xl--letter-spacing:-0.04em;  --text-display-xl--font-weight:600;
  --text-display:    56px; --text-display--line-height:1.0;  --text-display--letter-spacing:-0.035em; --text-display--font-weight:600;
  --text-h1:         42px; --text-h1--line-height:1.05; --text-h1--letter-spacing:-0.03em;  --text-h1--font-weight:600;
  --text-h2:         36px; --text-h2--line-height:1.1;  --text-h2--letter-spacing:-0.025em; --text-h2--font-weight:600;
  --text-h3:         24px; --text-h3--line-height:1.2;  --text-h3--letter-spacing:-0.02em;  --text-h3--font-weight:600;
  --text-title:      20px; --text-title--line-height:1.25; --text-title--letter-spacing:-0.015em; --text-title--font-weight:600;
  --text-body-lg:    18px; --text-body-lg--line-height:1.5; --text-body-lg--letter-spacing:-0.01em;
  --text-body:       16px; --text-body--line-height:1.5;
  --text-label:      14px; --text-label--line-height:1.3; --text-label--font-weight:500;
  --text-caption:    13px; --text-caption--line-height:1.3;
  --text-overline:   11px; --text-overline--line-height:1.2; --text-overline--letter-spacing:0.08em; --text-overline--font-weight:600;
  --text-mono:       13px; --text-mono--line-height:1.5;
  --text-mono-sm:    12px; --text-mono-sm--line-height:1.45;

  /* ---- Radius (8px dominant) ---- */
  --radius-xs:4px; --radius-sm:8px; --radius-md:12px; --radius-lg:16px;
  --radius-xl:20px; --radius-2xl:24px; --radius-pill:999px;

  /* ---- Easing ---- */
  --ease-framer: cubic-bezier(0.44,0,0.56,1);
  --ease-settle: cubic-bezier(0.22,1,0.36,1);
}

/* ---------- Base ---------- */
html, body, #root { height:100%; }
body {
  margin:0; background:var(--color-bg); color:var(--color-text);
  font-family:var(--font-sans); font-size:16px; line-height:1.5;
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
}
h1,h2,h3,.font-display { font-family:var(--font-display); letter-spacing:-0.03em; }

/* ---------- Gradients / glows / masks ---------- */
:root {
  --grad-blue:         linear-gradient(90deg,#5bc0ff 0%,#0097fe 45%,#0066ff 100%);
  --grad-blue-wash:    linear-gradient(90deg, rgba(0,151,254,0.10) 0%, rgba(28,28,28,0.5) 61%);
  --grad-chart-blue:   linear-gradient(180deg, rgba(0,151,254,0.28) 0%, rgba(0,151,254,0.06) 55%, rgba(0,151,254,0) 100%);
  --grad-chart-purple: linear-gradient(180deg, rgba(138,88,255,0.28) 0%, rgba(138,88,255,0.06) 55%, rgba(138,88,255,0) 100%);
  --grad-chart-red:    linear-gradient(180deg, rgba(255,77,79,0.30) 0%, rgba(255,77,79,0.07) 55%, rgba(255,77,79,0) 100%);
  --glow-blue-spot:    radial-gradient(60% 60% at 50% 0%, rgba(0,151,254,0.22) 0%, rgba(0,151,254,0) 70%);
  --glow-danger-spot:  radial-gradient(50% 50% at 50% 50%, rgba(255,77,79,0.30) 0%, rgba(255,77,79,0) 70%);
  --mask-fade-y:       linear-gradient(180deg,#0000 0%,#000 12% 88%,#0000 100%);
  --glow-blue:    0 0 0 1px rgba(0,151,254,0.30), 0 8px 32px rgba(0,151,254,0.25);
  --glow-danger:  0 0 0 1px rgba(255,77,79,0.35), 0 8px 32px rgba(255,77,79,0.30);
  --glow-success: 0 0 0 1px rgba(0,222,104,0.30), 0 8px 32px rgba(0,222,104,0.25);
}

/* ---------- Surface recipes ---------- */
.glass-card {
  background: var(--color-glass);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  box-shadow:
    0 2px 4px rgba(0,0,0,0.25),
    0 24px 48px -24px rgba(0,0,0,0.6),
    inset 0 1px 0 rgba(255,255,255,0.06);
}
.solid-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 20px 40px -20px rgba(0,0,0,0.7);
}
.card-active { border-color: var(--color-border-accent); box-shadow: var(--glow-blue); }

.gradient-border { position:relative; border-radius:var(--radius-xl); background:var(--color-surface); }
.gradient-border::before {
  content:""; position:absolute; inset:0; border-radius:inherit; padding:1px; pointer-events:none;
  background: linear-gradient(135deg, rgba(0,151,254,0.6), rgba(255,255,255,0.04) 40%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
}

.cta-blue {
  background:var(--grad-blue); color:#fff; font-weight:600;
  border-radius:var(--radius-pill); padding:10px 20px; border:0;
  box-shadow:var(--glow-blue);
  transition: transform .2s var(--ease-framer), box-shadow .2s var(--ease-framer);
}
.cta-blue:hover { transform:translateY(-1px); box-shadow:0 0 0 1px rgba(0,151,254,.45), 0 12px 40px rgba(0,151,254,.35); }

.log-fade   { -webkit-mask:var(--mask-fade-y); mask:var(--mask-fade-y); }
.status-dot { width:7px;height:7px;border-radius:50%;background:var(--color-ok);
  box-shadow:0 0 8px rgba(0,222,104,0.8); display:inline-block; }
.status-dot.live { background:var(--color-blue); box-shadow:0 0 8px rgba(0,151,254,0.9); }

/* keep react-diff-view, retinted to brand */
.diff {
  --diff-background-color: transparent; --diff-text-color:#eeeeee;
  --diff-font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --diff-gutter-insert-background-color: rgba(0,222,104,0.14); --diff-gutter-insert-text-color:#4cd963;
  --diff-gutter-delete-background-color: rgba(255,77,79,0.16); --diff-gutter-delete-text-color:#ff8e8e;
  --diff-code-insert-background-color: rgba(0,222,104,0.08);  --diff-code-insert-text-color:#4cd963;
  --diff-code-delete-background-color: rgba(255,77,79,0.10);  --diff-code-delete-text-color:#ff8e8e;
  font-size:12px;
}
```

Keep the existing `.prevent-transition` / `.pulse` / `@keyframes prevent-pulse` utilities (referenced across panels) but update their easing to `--ease-framer`.

**Tailwind v4 wiring:** tokens auto-generate `bg-bg`, `bg-surface`, `text-text-secondary`, `border-border`, `text-blue`, `rounded-xl`, `text-h1` (carries size+lh+tracking+weight). Multi-layer shadows stay as the `.glass-card`/`.solid-card` classes.

---

## 2. TYPOGRAPHY

Load in `app/index.html` `<head>` (already loads Inter + JetBrains Mono — add Inter Tight):
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800;900&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
```
- **Inter Tight** — display/headlines (600, tracking −0.03…−0.04em).
- **Inter** — body/labels.
- **JetBrains Mono** — event log, telemetry, FDA receipt, diff.

**House rule:** big number white `#FFFFFF`, label `#999999` directly above with a tiny live-dot (framer.com Analytics stat treatment). Always `font-variant-numeric: tabular-nums` on animated/live numbers.

---

## 3. MOTION SYSTEM — `app/src/lib/motion.ts`

```ts
export const EASE_FRAMER = [0.44, 0, 0.56, 1] as const;  // hovers, color/state micro (0.2s)
export const EASE_SETTLE = [0.22, 1, 0.36, 1] as const;  // entrances, chart/arc draw-in
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;  // shakes, symmetric moves

export const SPRING = {
  snappy:   { type:"spring", stiffness:400, damping:32, mass:0.8 },
  default:  { type:"spring", stiffness:260, damping:28 },
  soft:     { type:"spring", stiffness:170, damping:26 },
  dramatic: { type:"spring", stiffness:520, damping:18, mass:1.1 },  // the LIE snap, restore
  vital:    { type:"spring", stiffness:90,  damping:18, mass:0.8 },  // crashing vitals lurch
  scroll:   { stiffness:100, damping:30, restDelta:0.001 },
} as const;

export const DUR = { micro:0.2, enter:0.4, reveal:0.6, draw:1.1, count:0.8, relay:0.75 } as const;
```

**App-wide (`main.tsx`):**
```tsx
import { MotionConfig } from "motion/react";
<MotionConfig reducedMotion="user" transition={{ type:"spring", stiffness:260, damping:28 }}>
  <App />
</MotionConfig>
```

**Reduced-motion:** `MotionConfig reducedMotion="user"` covers declarative `motion.*`. Gate hook-driven animations (`animate()`, `useSpring`, counters, scroll, loops) with `useReducedMotion()`: counters jump to final value, parallax/comet/radar-ping skipped (show end state), charts rendered fully drawn. NEVER drop meaning-bearing crossfades (the LIE snap, trust-card opacity) — only their transforms. Keep CSS `@media (prefers-reduced-motion:reduce)` stops for raw `@keyframes` loops.

**Reusable primitives to build (`app/src/lib/` + `app/src/viz/`):**
1. `<AnimatedNumber value>` — `@number-flow/react` odometer for hero numbers; a `<MotionNumber>` fallback (`useMotionValue`+`useTransform` as child, zero re-render) for low-stakes counts.
2. `useVitalsHistory(device, cap=80, every=500ms)` — ring buffer. **LOAD-BEARING; build first.** Feeds every chart. `DeviceStatus` is scalars only.
3. `<RevealOnView>` — `whileInView` + `viewport={{root, once:true, amount:0.3, margin:"0px 0px -10% 0px"}}`.
4. `<StaggerGroup>` — parent `variants` + `delayChildren: stagger(0.06–0.08)`.
5. `<SignalPulse>` — `ghostFlow` relay (`opacity:[0.3,1,0.6,0.3]`, `DUR.relay` linear infinite, per-node `delay:i*0.08`).
6. `<TravelingComet pathD>` — native SVG `<animateMotion>` + `drop-shadow` glow.
7. `useReduced()` + `<CaretBlink>` (pure CSS `@keyframes`).

**Doctrine:** motion = meaning. Infinite decorative loops stay in CSS `@keyframes`. Only the **active** timeline node runs a loop at a time (frame budget shared with the left panel). The demo must read as serious medical software that happens to be gorgeous.

---

## 4. COMPONENT-BY-COMPONENT (all `DashboardPanel.tsx` unless noted)

- **App shell/header (`App.tsx`):** `body`+both roots `bg` (`#000`); right dashboard `.solid-card`; wordmark `Pre**Vent**` in `font-display text-h3`; device chip "1 of 3,412 devices" (`caption`,`#999`,live-dot); threat badge pill. On load headline/chip/badge rise+fade (`opacity0→1, y24→0`, optional `blur(8px)→0`, `DUR.reveal EASE_SETTLE`, stagger 0.08); "3,412" counts up (`<AnimatedNumber>`). Buttons `whileHover{y:-1} whileTap{scale:0.97}` `SPRING.snappy`.
- **LEFT panel frame (3D, separate workflow):** bezel `bg-raised radius-xl border` + inner sheen; `--glow-blue-spot` behind monitor at rest, swap to `--glow-danger-spot` on compromise. Vitals readouts: 40px Inter 600 tabular; value via `useSpring(value, SPRING.vital)` written to `ref.textContent`; `crashing` → ±2px shake + red textShadow.
- **Agent timeline (`AgentTimeline`/`StageRow` :129):** vertical spine, two SVG paths at `x=14` (dim rail `#1c1c1c` 2px + bright `#0097fe` progress). Spine fill `motion.path pathLength 0→completedStages/7` `{stiffness:60,damping:18}`. Node states: idle r5; running r6 `#0097fe` + radar-ping circle `r:[6,16] opacity:[0.5,0]` 1.6s; waiting amber 1.1s pulse; done `#00de68` drawn check 300ms; error red shake. **Traveling marker:** ONE `motion.span layoutId="active-node"` blue halo inside `<LayoutGroup>`, `SPRING.default`. Data-flow comet: native `<animateMotion dur=1.4s>` on active segment. Rows stagger `stagger(0.06)` `x-12→0`; `layout` on each row; running stage `scrollIntoView({block:"center"})`.
- **Streaming reasoning (`ReasoningStream` :111):** glass card `mono-sm max-h-28` top fade mask; keep imperative autoscroll; `aria-live="polite"`. Thinking (running,no tokens): 3-line shimmer skeleton + 3 dots. Streaming: render growing string (never re-type) + CSS caret while running; optional last-word `motion.span opacity0→1 0.12s`.
- **Confidence gauge (`ConfidenceGauge` :78/:176):** upgrade to 270° radial arc (START=135 SWEEP=270, strokeWidth 9 on 112px, round caps, track `rgba(255,255,255,0.07)`); `pathLength` via `useSpring(value, SPRING.soft)`; blurred underlay (`feGaussianBlur 2.5` opacity 0.5) glow; center % `<AnimatedNumber>` locked to the spring. Thresholds ≥0.8 `#00de68`, ≥0.55 `#0097fe`, ≥0.3 `#fd7702`, else `#ff4d4f`. Keep 6px bar as compact fallback (`scaleX` + leading glow cap).
- **Telemetry-vs-Reality snap (`TelemetryVsReality` :363) — the money moment:** trigger `reportedHr!==trueHr`. `borderColor` on `SPRING.dramatic` + `backgroundColor` tween 0.2s to `rgba(255,77,79,0.08)` + one-shot shake `x:[0,-6,5,-3,0]` 0.4s. Reported stays calm blue; true **counts DOWN** (72→38, 98→84) via `<AnimatedNumber crashing>`. Embed `VitalsDivergenceChart`; dashed red divider draws (`pathLength0→1 400ms`); "ALARM SILENCED" struck chip when `alarmActive:false`. "The device is lying" pill `AnimatePresence SPRING.snappy`, exit `{opacity0,scale0.9,y-4}`.
- **Attack path (new `AttackPath`, renders while `compromised`):** `[Attacker]→[POST /device/command]→[Ventilator]` 3 glass nodes on SVG path (`useAnimate` scope). Exploit packet red capsule `<animateMotion dur=0.9s>` attacker→device; device flashes `boxShadow`. **Verification beat (~1.2s):** replay packet → green shield → `<AnimatedNumber value={401}>` pops `{stiffness:400,damping:15}` → connector `#00de68`. Restore red→amber→green, fan halo resumes.
- **Findings / patch diff / compliance / event log:** findings `<li>` stagger `y12→0 stagger(0.06)` on view. Patch diff on `hasPatch`: per-line `opacity0→1, x-6→0 stagger(0.03)`, `+` lines green left-border wipe (`scaleX0→1 origin:left`) + bg flash. Compliance seal on verify `scale1.4→1 rotate-8→0 SPRING.snappy` "APPROVED · §524B". Event log `mono .log-fade` mask, newest pinned, `x-8→0`, status dots.
- **Trust cards (:544):** `<AnimatePresence mode="popLayout">` stable keys + `layout`; **add missing `exit`** `{opacity0,y-8,filter:blur(4px),dur0.2}` + blur-in entrance `{opacity0,y12,scale0.98,blur4}→blur0 SPRING.snappy`. Self-correction ↺ 360° rotate 0.6s; guardrail ⛔ red border flash; awaiting pulsing CTA + top shimmer. Keep `role` attrs.

---

## 5. CHARTS — hand-roll inline SVG + Motion (NO lib)

Prerequisite: `useVitalsHistory(device,80,500ms)` ring buffer (build first).
- **Line/area draw-in:** `pathLength 0→1` `DUR.draw` (1.1s charts/0.8s gauge/0.7s spark) `EASE_SETTLE`; area fill fades `opacity0→1 delay0.2/dur0.6`.
- **Curves:** Catmull-Rom→cubic Bézier (`smoothPath`), never jagged.
- **Fill gradient:** vertical stops `top 0.28 → 55% 0.06 → bottom 0` (spark `0.22→0`).
- **Series colors:** reported/lie `#0097FE`, true/reality `#FF4D4F`, restored `#00DE68`, 2nd `#8A58FF`. Lines 2px (spark 1.5px) round caps.
- **Live leading dot:** `<animate r="3.5;6;3.5" dur=1.6s/>` + opacity pulse on reported head.
- **Tooltip (Framer-exact):** `foreignObject` dark glass (`rgba(10,10,11,0.92)`, border `rgba(255,255,255,0.08)`, radius10, blur8, mono11), date header `#8b9aab`, `● label …… right-aligned tabular value` rows + crosshair.
- **Build:** `VitalsDivergenceChart` (hero), `ConfidenceGauge` (270° arc), `Sparkline` (auto-scaled, no axes), `VitalReadout` (big counter), A/B gradient bar (`<div>` `--grad-blue` + Motion `scaleX`). `useMemo` all path geometry; counters bypass React via `ref.textContent`/MotionValue.

---

## 6. LIBRARIES

| Need | Use | Version | Import |
|---|---|---|---|
| All animation | **motion** (installed) | 14.6.0 | `motion/react` (NOT framer-motion) |
| Odometer hero numbers | **@number-flow/react** | 0.6.2 | `@number-flow/react` — the ONE new dep |
| "Data flowing" packet | native SVG `<animateMotion>` | — | inline |
| Low-stakes counters | motion `MotionValue`-as-child | 14.6.0 | `motion/react` |
| Fonts | Inter Tight · Inter · JetBrains Mono | Google Fonts | `<link>` |
| Charts/gauge/spark/attack path/spine | hand-rolled SVG+Motion | — | — |

**Rejected:** `@xyflow/react`, Recharts, visx, uPlot, lightweight-charts, TypeIt/flowtoken/llm-ui.

---

## 7. TOP 10 WOW MOVES (impact ÷ effort)
1. Traveling active node (`layoutId` on spine) ★★★★★/trivial
2. Telemetry snap-red + the LIE ★★★★★/low
3. Signal-flow relay on the 7-stage pipeline ★★★★★/low
4. VitalsDivergenceChart ★★★★★/medium
5. Attack-path verification beat (→401) ★★★★★/medium
6. Trust-card exit + popLayout + blur-in ★★★★/low
7. 270° radial confidence gauge ★★★★/medium
8. **Token swap → pitch black + #0097FE + Inter Tight ★★★★/trivial — do first**
9. Evidence-stack staggered scroll reveal ★★★/low
10. Compliance receipt stamp + one-card cursor-follow spotlight ★★★/low

*(Stretch: 3D device-fleet wheel — `perspective:1200px rotateY` spread, center unit red.)*

## 8. RISKS / PERF
- Ring buffer load-bearing & unbuilt — build first, 500ms cadence, cap 80.
- Frame budget shared with Pixi/3D — only active node's loop runs; never 7 simultaneous box-shadow pulses.
- Animate only transform/opacity/filter/pathLength/offsetDistance; switch bars to `scaleX`; avoid animating box-shadow/width/height on many elements.
- Render MotionValues as children for per-frame numbers; `useMotionValueEvent` to branch, never `.get()` in render.
- `AnimatePresence`: stable keys + real `exit`; `mode="popLayout"` needs `layout` on siblings; wrap animated lists in one `<LayoutGroup>`.
- Reduced motion is a rubric item.
- `backdrop-filter: blur()` only on glass cards over the live monitor; cap 12–16px.
- Verify `@number-flow/react@0.6.2` installs clean against React 19; MotionValue fallback covers every number if not.

**Build order:** (1) token swap + fonts + MotionConfig/springs → (2) `useVitalsHistory` → (3) `lib/motion.ts` + `<AnimatedNumber>` → (4) timeline spine + traveling node → (5) telemetry snap + divergence chart → (6) attack path + verification beat → (7) gauge, reasoning, trust cards, evidence micro-interactions. Steps 1–3 are the shared FOUNDATION; 4–7 split across worktrees.
