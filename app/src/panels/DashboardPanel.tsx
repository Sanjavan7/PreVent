// Right panel: the "glass skull" dashboard.
// Left column: an agent timeline you can watch think.
// Right column: the evidence stack (findings, telemetry-vs-reality, diff, compliance, log).
//
// Everything here reads the SAME rows the Pixi monitor + Arduino see, so the two
// panels can never desync. The dashboard adds the signature "trust" surfaces that
// make the pipeline feel honest instead of magical:
//
//   - A 7-stage agent timeline with a drawn spine, a single traveling node
//     marker (layoutId) that walks ground -> restore, and the active node's
//     streaming reasoning + confidence gauge.
//   - Self-Correction / Guardrail Blocked / Awaiting Approval trust cards that
//     pop in/out as the moment is real (popLayout + blur-in/out).
//   - A Telemetry-vs-Reality card that SNAPS red when the device is lying, with
//     the true vital counting DOWN and the divergence charted as the lie.
//   - An AttackPath band (while compromised) that pays off with the 401 beat.
//
// motion/react is used for MEANING -- state changes, reveals, the honesty beats.
// Infinite decorative loops live in CSS. Everything respects Reduce Motion via
// the app-wide <MotionConfig reducedMotion="user"> plus hook-level guards.

import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AnimatePresence,
  LayoutGroup,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  type Variants,
} from 'motion/react';
import { Diff, Hunk, parseDiff } from 'react-diff-view';
import 'react-diff-view/style/index.css';
import type {
  AgentState,
  AgentStatus,
  DeviceStatus,
  EventLogRow,
  Finding,
  Stage,
} from '@prevent/contracts';

import { AnimatedNumber } from '../lib/AnimatedNumber';
import { CaretBlink } from '../lib/CaretBlink';
import { RevealOnView } from '../lib/RevealOnView';
import { StaggerGroup, StaggerItem } from '../lib/StaggerGroup';
import { TravelingComet } from '../lib/TravelingComet';
import { DUR, EASE_IN_OUT, EASE_SETTLE, SPRING } from '../lib/motion';
import { useVitalsHistory } from '../lib/useVitalsHistory';
import { AttackPath } from '../viz/AttackPath';
import { ConfidenceGauge270 } from '../viz/ConfidenceGauge270';
import { VitalsDivergenceChart } from '../viz/VitalsDivergenceChart';

interface Props {
  agents: AgentStatus[];
  findings: Finding[];
  eventLog: EventLogRow[];
  device: DeviceStatus;
}

// --- Stage order ---------------------------------------------------------
// The visible spine always shows every stage so judges see progress even
// before the orchestrator has emitted an agent_status row for it.
const STAGES: readonly Stage[] = [
  'ground',
  'scan',
  'generate',
  'deliver',
  'patch',
  'verify',
  'restore',
];

const STAGE_LABEL: Record<Stage, string> = {
  ground: 'Ground',
  scan: 'Scan',
  generate: 'Generate',
  deliver: 'Deliver',
  patch: 'Patch',
  verify: 'Verify',
  restore: 'Restore',
};

const STATE_PILL: Record<AgentState, string> = {
  idle: 'border-border bg-surface-2 text-text-muted',
  running: 'border-blue/40 bg-blue-15 text-blue',
  waiting_for_human: 'border-warn/40 bg-warn/15 text-warn',
  done: 'border-ok/40 bg-ok/15 text-ok',
  error: 'border-danger/40 bg-danger/15 text-danger',
};

// Node fill color per state (used by the SVG-free dot).
const DOT_COLOR: Record<AgentState, string> = {
  idle: 'var(--color-surface-4)',
  running: 'var(--color-blue)',
  waiting_for_human: 'var(--color-warn)',
  done: 'var(--color-ok)',
  error: 'var(--color-danger)',
};

// --- Small inline helpers ------------------------------------------------

/** Measure an element's live pixel height so the spine SVG can match it exactly
 *  (the active row expands/collapses, so a fixed height won't do). */
function useMeasuredHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    setH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  return [ref, h] as const;
}

// --- Timeline ------------------------------------------------------------

/** The node marker: the single glowing blue halo that walks the spine. It's the
 *  SAME element in the React tree (layoutId) so Motion FLIP-animates it between
 *  the nodes as `active` moves stage -> stage. */
function ActiveMarker() {
  return (
    <motion.span
      layoutId="active-node"
      aria-hidden
      className="absolute left-[14px] top-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{
        width: 22,
        height: 22,
        background: 'rgba(0,151,254,0.18)',
        boxShadow: '0 0 0 1px rgba(0,151,254,0.5), 0 0 16px rgba(0,151,254,0.6)',
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={SPRING.default}
    />
  );
}

/** The dot + per-state flourish that sits on the spine at x=14. */
function NodeDot({ state, active }: { state: AgentState; active: boolean }) {
  const reduce = useReducedMotion();
  const size = state === 'running' ? 12 : state === 'idle' ? 10 : 11;
  return (
    <span
      className="absolute left-[14px] top-[9px] -translate-x-1/2 -translate-y-1/2"
      aria-hidden
      style={{ width: 16, height: 16 }}
    >
      {/* radar ping -- running only, and only the active node loops */}
      {state === 'running' && active && !reduce ? (
        <motion.span
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ width: 12, height: 12, border: '1.5px solid var(--color-blue)' }}
          animate={{ scale: [1, 2.6], opacity: [0.5, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
        />
      ) : null}
      {/* waiting -- amber pulse */}
      {state === 'waiting_for_human' && active && !reduce ? (
        <motion.span
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ width: 14, height: 14, background: 'rgba(253,119,2,0.35)' }}
          animate={{ scale: [1, 1.5, 1], opacity: [0.6, 0.2, 0.6] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
        />
      ) : null}
      {/* the dot itself; error shakes */}
      <motion.span
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: size,
          height: size,
          background: DOT_COLOR[state],
          boxShadow:
            state === 'running'
              ? '0 0 10px rgba(0,151,254,0.8)'
              : state === 'done'
                ? '0 0 8px rgba(0,222,104,0.6)'
                : state === 'error'
                  ? '0 0 8px rgba(255,77,79,0.7)'
                  : 'none',
        }}
        animate={
          state === 'error' && !reduce ? { x: [0, -2, 2, -1, 1, 0] } : { x: 0 }
        }
        transition={
          state === 'error'
            ? { duration: 0.4, ease: EASE_IN_OUT, repeat: Infinity, repeatDelay: 1.2 }
            : { duration: DUR.micro }
        }
      />
      {/* done -- a drawn check inside the dot */}
      {state === 'done' ? (
        <svg
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          width={10}
          height={10}
          viewBox="0 0 10 10"
        >
          <motion.path
            d="M2 5.2 L4.2 7.4 L8 3"
            fill="none"
            stroke="var(--color-bg)"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduce ? false : { pathLength: 0 }}
            animate={reduce ? undefined : { pathLength: 1 }}
            transition={{ duration: 0.3, ease: EASE_SETTLE }}
          />
        </svg>
      ) : null}
    </span>
  );
}

/** Thinking skeleton: 3 shimmer lines while the model is running but hasn't
 *  emitted any reasoning tokens yet. */
function ReasoningSkeleton() {
  const reduce = useReducedMotion();
  return (
    <div className="mt-2 space-y-1.5" aria-hidden>
      {[86, 70, 48].map((w, i) => (
        <motion.div
          key={w}
          className="h-2 rounded-pill bg-surface-3"
          style={{ width: `${w}%` }}
          animate={reduce ? undefined : { opacity: [0.35, 0.8, 0.35] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut', delay: i * 0.12 }}
        />
      ))}
    </div>
  );
}

/** The streaming reasoning line. The reasoning string only ever GROWS (never
 *  re-typed), so we render it directly and keep the newest token in view. A CSS
 *  caret blinks while the model is live. aria-live announces updates politely. */
function ReasoningStream({ text, running }: { text: string; running: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [text]);

  if (running && !text) return <ReasoningSkeleton />;

  return (
    <div
      ref={ref}
      aria-live="polite"
      className="mt-2 max-h-28 overflow-y-auto rounded-md border border-border bg-bg/60 p-2 font-mono text-mono-sm leading-relaxed text-text-secondary log-fade"
    >
      {text ? (
        <span>
          {text}
          {running ? <CaretBlink /> : null}
        </span>
      ) : (
        <span className="opacity-50">(waiting for the model to speak&hellip;)</span>
      )}
    </div>
  );
}

const rowVariants: Variants = {
  hidden: { opacity: 0, x: -12 },
  show: { opacity: 1, x: 0, transition: { duration: 0.4, ease: EASE_SETTLE } },
};

function StageRow({
  stage,
  agent,
  active,
}: {
  stage: Stage;
  agent?: AgentStatus;
  active: boolean;
}) {
  const state: AgentState = agent?.state ?? 'idle';
  const running = state === 'running';
  const showReasoning = (running || state === 'waiting_for_human') && !!agent;
  const reduce = useReducedMotion();

  // Keep the active stage scrolled into view as the pipeline advances.
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (active && rowRef.current) {
      rowRef.current.scrollIntoView({
        block: 'center',
        behavior: reduce ? 'auto' : 'smooth',
      });
    }
  }, [active, reduce]);

  return (
    <motion.li ref={rowRef} layout variants={rowVariants} className="relative pl-9">
      {active ? <ActiveMarker /> : null}
      <NodeDot state={state} active={active} />

      {/* data-flow comet feeding the active (running) node from above */}
      {running && !reduce ? (
        <svg className="pointer-events-none absolute left-0 top-[-14px]" width={28} height={24} aria-hidden>
          <TravelingComet path="M14 0 L14 20" dur={1.4} r={3} color="var(--color-blue)" />
        </svg>
      ) : null}

      <div className="flex items-center gap-2">
        <span className="font-mono text-caption uppercase tracking-wider text-text">
          {STAGE_LABEL[stage]}
        </span>
        <span
          className={`rounded-pill border px-2 py-0.5 font-mono text-overline uppercase tracking-wider ${STATE_PILL[state]}`}
        >
          {state.replace(/_/g, ' ')}
        </span>
        {agent?.agentName ? (
          <span className="truncate font-mono text-overline text-text-muted">{agent.agentName}</span>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {showReasoning ? (
          <motion.div
            key="active"
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: EASE_SETTLE }}
            className="overflow-hidden"
          >
            <ReasoningStream text={agent?.reasoning ?? ''} running={running} />
            <div className="mt-3 flex justify-center">
              <ConfidenceGauge270
                value={agent?.confidence ?? 0}
                uncertainty={agent?.uncertainty || undefined}
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="h-4" />
    </motion.li>
  );
}

function AgentTimeline({ agents }: { agents: AgentStatus[] }) {
  const reduce = useReducedMotion();
  const byStage = useMemo(() => {
    const m = new Map<Stage, AgentStatus>();
    for (const a of agents) m.set(a.stage, a);
    return m;
  }, [agents]);

  // The one active stage: running wins, else waiting, else none.
  const activeStage = useMemo(() => {
    const running = agents.find((a) => a.state === 'running');
    if (running) return running.stage;
    const waiting = agents.find((a) => a.state === 'waiting_for_human');
    return waiting?.stage;
  }, [agents]);

  // Spine fill fraction: completed stages / 7.
  const completed = useMemo(
    () => agents.filter((a) => a.state === 'done').length,
    [agents],
  );
  const fraction = completed / STAGES.length;

  const spineLength = useSpring(0, { stiffness: 60, damping: 18 });
  useEffect(() => {
    if (reduce) spineLength.jump(fraction);
    else spineLength.set(fraction);
  }, [fraction, reduce, spineLength]);

  const [olRef, olH] = useMeasuredHeight<HTMLOListElement>();

  return (
    <div>
      <h3 className="mb-3 font-mono text-overline uppercase tracking-wider text-text-secondary">
        Agent timeline
      </h3>
      <LayoutGroup>
        <div className="relative">
          {/* Spine: dim rail + bright progress drawn to completed/7. */}
          <svg
            className="pointer-events-none absolute left-0 top-0"
            width={28}
            height={olH || 1}
            aria-hidden
          >
            <line x1={14} y1={10} x2={14} y2={Math.max(10, olH - 10)} stroke="var(--color-surface-3)" strokeWidth={2} strokeLinecap="round" />
            <motion.line
              x1={14}
              y1={10}
              x2={14}
              y2={Math.max(10, olH - 10)}
              stroke="var(--color-blue)"
              strokeWidth={2}
              strokeLinecap="round"
              style={{ pathLength: spineLength, filter: 'drop-shadow(0 0 4px rgba(0,151,254,0.6))' }}
            />
          </svg>

          <motion.ol
            ref={olRef}
            className="relative"
            variants={{ hidden: {}, show: { transition: { delayChildren: 0.06, staggerChildren: 0.06 } } }}
            initial="hidden"
            animate="show"
          >
            {STAGES.map((s) => (
              <StageRow key={s} stage={s} agent={byStage.get(s)} active={activeStage === s} />
            ))}
          </motion.ol>
        </div>
      </LayoutGroup>
    </div>
  );
}

// --- Trust cards ---------------------------------------------------------
// popLayout requires custom children to forwardRef the popped DOM node.

const TRUST_ENTER = {
  initial: { opacity: 0, y: 12, scale: 0.98, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -8, filter: 'blur(4px)', transition: { duration: 0.2 } },
  transition: SPRING.snappy,
} as const;

const SelfCorrectionCard = forwardRef<HTMLElement, { agent: AgentStatus }>(
  function SelfCorrectionCard({ agent }, ref) {
    const reduce = useReducedMotion();
    return (
      <motion.aside
        ref={ref}
        layout
        {...TRUST_ENTER}
        className="rounded-lg border border-warn/40 bg-warn/10 p-3"
        role="status"
      >
        <div className="flex items-center gap-2 font-mono text-caption uppercase tracking-wider text-warn">
          <motion.span
            aria-hidden
            animate={reduce ? undefined : { rotate: 360 }}
            transition={{ duration: 0.6, ease: EASE_SETTLE }}
            style={{ display: 'inline-block' }}
          >
            &#8634;
          </motion.span>
          <span>Self-correction</span>
          <span className="opacity-60">&middot; {agent.agentName}</span>
        </div>
        <p className="mt-1 text-body text-text">
          {agent.reasoning ||
            'Rejected my own output — the fix broke the emergency override. Revising.'}
        </p>
      </motion.aside>
    );
  },
);

const GuardrailBlockedCard = forwardRef<HTMLElement, { event: EventLogRow }>(
  function GuardrailBlockedCard({ event }, ref) {
    const reduce = useReducedMotion();
    return (
      <motion.aside
        ref={ref}
        layout
        initial={{ opacity: 0, y: 12, scale: 0.98, filter: 'blur(4px)' }}
        animate={
          reduce
            ? { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }
            : {
                opacity: 1,
                y: 0,
                scale: 1,
                filter: 'blur(0px)',
                borderColor: [
                  'rgba(255,77,79,0.4)',
                  'rgba(255,77,79,0.9)',
                  'rgba(255,77,79,0.4)',
                ],
              }
        }
        exit={{ opacity: 0, y: -8, filter: 'blur(4px)', transition: { duration: 0.2 } }}
        transition={SPRING.snappy}
        className="rounded-lg border border-danger/40 bg-danger/10 p-3"
        role="status"
      >
        <div className="flex items-center gap-2 font-mono text-caption uppercase tracking-wider text-danger">
          <span aria-hidden>&#9940;</span>
          <span>Action refused &middot; sandbox</span>
        </div>
        <p className="mt-1 font-mono text-mono-sm text-text">{event.text}</p>
      </motion.aside>
    );
  },
);

const AwaitingApprovalCard = forwardRef<
  HTMLElement,
  { agent: AgentStatus; approved: boolean; onApprove: () => void }
>(function AwaitingApprovalCard({ agent, approved, onApprove }, ref) {
  return (
    <motion.aside
      ref={ref}
      layout
      {...TRUST_ENTER}
      className="relative overflow-hidden rounded-lg border border-warn/50 bg-warn/10 p-3"
      role="dialog"
      aria-label="Awaiting human approval"
    >
      {/* top shimmer line while awaiting */}
      {!approved ? (
        <motion.span
          aria-hidden
          className="absolute left-0 top-0 h-px w-1/3"
          style={{ background: 'linear-gradient(90deg, transparent, var(--color-warn), transparent)' }}
          animate={{ x: ['-100%', '400%'] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
        />
      ) : null}
      <div className="flex items-center gap-2 font-mono text-caption uppercase tracking-wider text-warn">
        <span aria-hidden>&#9208;</span>
        <span>Awaiting human approval</span>
        <span className="opacity-60">&middot; {STAGE_LABEL[agent.stage]}</span>
      </div>
      <ul className="mt-2 space-y-1 font-mono text-mono-sm text-text-secondary">
        <li>&middot; patch written by the model</li>
        <li>&middot; unit tests ran green in the sandbox</li>
        <li>&middot; exploit proof captured (pre-patch)</li>
      </ul>
      <AnimatePresence mode="wait" initial={false}>
        {approved ? (
          <motion.div
            key="approved"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING.snappy}
            className="mt-3 flex items-center justify-center gap-2 rounded-md border border-ok/40 bg-ok/15 px-4 py-2 font-mono text-label uppercase tracking-wider text-ok"
          >
            <span aria-hidden>&#10003;</span> Approved — deploying&hellip;
          </motion.div>
        ) : (
          <motion.button
            key="button"
            type="button"
            onClick={onApprove}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={SPRING.snappy}
            exit={{ opacity: 0 }}
            className="prevent-transition pulse mt-3 w-full rounded-md bg-blue px-4 py-2 font-mono text-label font-semibold uppercase tracking-wider text-bg hover:brightness-110"
          >
            Approve &amp; deploy
          </motion.button>
        )}
      </AnimatePresence>
    </motion.aside>
  );
});

// Heuristics that light the trust beats from existing fields (no new DB columns).
function detectSelfCorrection(agents: AgentStatus[]): AgentStatus | null {
  for (const a of agents) {
    const t = (a.reasoning || '').toLowerCase();
    if (t.includes('rejected') || t.includes('revising') || t.includes('self-correct')) {
      return a;
    }
  }
  return null;
}

function detectGuardrailRefusal(log: EventLogRow[]): EventLogRow | null {
  for (const e of log) {
    const t = (e.text || '').toLowerCase();
    if (e.actor === 'guardrail' || t.includes('action refused') || t.includes('sandbox refused')) {
      return e;
    }
  }
  return null;
}

// --- Evidence cards ------------------------------------------------------

function FindingsCard({ findings, root }: { findings: Finding[]; root: React.RefObject<Element | null> }) {
  return (
    <section className="solid-card p-4">
      <h4 className="mb-2 font-mono text-overline uppercase tracking-wider text-text-secondary">
        Findings
      </h4>
      {findings.length === 0 ? (
        <p className="font-mono text-mono-sm text-text-muted">
          No findings yet — scanner has not reported.
        </p>
      ) : (
        <StaggerGroup root={root} step={0.07} className="space-y-2">
          {findings.map((f) => (
            <StaggerItem
              key={f.id}
              className={`rounded-md border p-2 text-body ${
                f.isTheRealOne ? 'border-danger/50 bg-danger/10' : 'border-border bg-surface-2'
              }`}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-overline text-text-secondary">
                <span className="rounded bg-bg/60 px-1 py-0.5 text-text">{f.scanner}</span>
                <span>
                  {f.file}:{f.line}
                </span>
                <span className="uppercase">{f.severity}</span>
                {f.cveRef ? <span className="text-blue">{f.cveRef}</span> : null}
                {f.isTheRealOne ? (
                  <span className="rounded bg-danger/20 px-1 py-0.5 text-danger">REAL</span>
                ) : null}
              </div>
              <p className="mt-1 text-text-strong">{f.claudeVerdict}</p>
            </StaggerItem>
          ))}
        </StaggerGroup>
      )}
    </section>
  );
}

function TelemetryVsReality({ device }: { device: DeviceStatus }) {
  const reduce = useReducedMotion();
  const { samples, ready } = useVitalsHistory(device);
  const hrLying = device.reportedHr !== device.trueHr;
  const spo2Lying = device.reportedSpo2 !== device.trueSpo2;
  const lying = hrLying || spo2Lying;

  // One-shot shake on the rising edge of the lie (reuses the foundation's
  // `animate()`; stays off the declarative border/bg animation to avoid clash).
  const shakeX = useMotionValue(0);
  const wasLying = useRef(lying);
  useEffect(() => {
    const rising = lying && !wasLying.current;
    wasLying.current = lying;
    if (rising && !reduce) {
      const controls = animate(shakeX, [0, -6, 5, -3, 0], {
        duration: 0.4,
        ease: EASE_IN_OUT,
      });
      return () => controls.stop();
    }
  }, [lying, reduce, shakeX]);

  return (
    <motion.section
      initial={false}
      animate={{
        borderColor: lying ? 'rgba(255,77,79,0.55)' : 'rgba(255,255,255,0.07)',
        backgroundColor: lying ? 'rgba(255,77,79,0.08)' : 'rgba(14,14,14,1)',
        boxShadow: lying
          ? '0 0 0 1px rgba(255,77,79,0.35), 0 8px 32px rgba(255,77,79,0.3)'
          : '0 0 0 0 rgba(0,0,0,0)',
      }}
      transition={lying ? SPRING.dramatic : { duration: DUR.micro }}
      className="rounded-xl border p-4"
    >
      <motion.div style={{ x: shakeX }}>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="font-mono text-overline uppercase tracking-wider text-text-secondary">
            Telemetry vs reality
          </h4>
          <AnimatePresence mode="wait" initial={false}>
            {lying ? (
              <motion.span
                key="lying"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, y: -4 }}
                transition={SPRING.snappy}
                className="rounded-pill border border-danger/50 bg-danger/15 px-2 py-0.5 font-mono text-overline uppercase tracking-wider text-danger"
              >
                The device is lying
              </motion.span>
            ) : (
              <motion.span
                key="match"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={SPRING.snappy}
                className="rounded-pill border border-ok/40 bg-ok/15 px-2 py-0.5 font-mono text-overline uppercase tracking-wider text-ok"
              >
                Match
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* Reported stays calm blue; the true vital counts DOWN in crashing red. */}
        <div className="grid grid-cols-3 items-baseline gap-y-1 font-mono text-body tabular-nums">
          <span />
          <span className="text-overline uppercase tracking-wider text-text-secondary">reported</span>
          <span className="text-overline uppercase tracking-wider text-text-secondary">actual</span>

          <span className="text-text-secondary">HR</span>
          <AnimatedNumber value={device.reportedHr} className="text-blue" />
          <AnimatedNumber value={device.trueHr} crashing={hrLying} className={hrLying ? '' : 'text-ok'} />

          <span className="text-text-secondary">SpO&#8322;</span>
          <AnimatedNumber value={device.reportedSpo2} className="text-blue" />
          <AnimatedNumber value={device.trueSpo2} crashing={spo2Lying} className={spo2Lying ? '' : 'text-ok'} />
        </div>

        {/* The dashed red divider draws in when the device is lying. */}
        <div className="relative my-3 h-px">
          <svg className="absolute inset-0 h-px w-full" preserveAspectRatio="none" viewBox="0 0 100 1" aria-hidden>
            <motion.line
              x1={0}
              y1={0.5}
              x2={100}
              y2={0.5}
              stroke="var(--color-danger)"
              strokeWidth={1}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
              initial={false}
              animate={{ pathLength: lying ? 1 : 0, opacity: lying ? 1 : 0 }}
              transition={{ duration: 0.4, ease: EASE_SETTLE }}
            />
          </svg>
        </div>

        {/* The lie, charted: reported (blue) holds while true (red) crashes. */}
        {ready ? (
          <VitalsDivergenceChart samples={samples} metric="hr" height={150} />
        ) : (
          <div className="flex h-[150px] items-center justify-center font-mono text-caption text-text-muted">
            gathering telemetry&hellip;
          </div>
        )}

        {/* ALARM SILENCED: the quiet, struck-through beat. */}
        <AnimatePresence>
          {lying && !device.alarmActive ? (
            <motion.div
              key="silenced"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={SPRING.snappy}
              className="mt-3 inline-flex items-center gap-2 rounded-pill border border-danger/40 bg-danger/10 px-2.5 py-0.5 font-mono text-overline uppercase tracking-wider text-danger"
            >
              <span className="line-through decoration-danger">Alarm silenced</span>
              <span className="opacity-70">no audible warning</span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
    </motion.section>
  );
}

// Short canned diff shown when no real patch exists yet. The orchestrator will
// stream a real unified diff into the module (we'll upgrade this to render that
// diff when the patch_attempts row carries it).
const SAMPLE_DIFF = `diff --git a/device-service/app.py b/device-service/app.py
--- a/device-service/app.py
+++ b/device-service/app.py
@@ -40,7 +40,12 @@ def command():
-    body = request.get_json(silent=True) or {}
-    action = body.get('action')
-    return _apply(action, body)
+    token = request.headers.get('X-Device-Token')
+    if not token or not _valid_token(token):
+        return jsonify({'error': 'missing_auth'}), 401
+    body = request.get_json(silent=True) or {}
+    action = body.get('action')
+    body.pop('reportedOverrides', None)  # ignore untrusted overrides
+    return _apply(action, body)
`;

// Per-line diff stagger + green left-border wipe on `+` lines. index.css is owned
// by another worktree, so (like CaretBlink) the rules are injected into <head>
// once, scoped to `.prevent-diff`, and disabled under Reduce Motion.
const DIFF_CSS = `
.prevent-diff td.diff-code { position: relative; }
.prevent-diff tr.diff-line { animation: prevent-diffline 0.4s var(--ease-settle) both; }
.prevent-diff tr.diff-line:nth-child(1) { animation-delay: 0.00s }
.prevent-diff tr.diff-line:nth-child(2) { animation-delay: 0.03s }
.prevent-diff tr.diff-line:nth-child(3) { animation-delay: 0.06s }
.prevent-diff tr.diff-line:nth-child(4) { animation-delay: 0.09s }
.prevent-diff tr.diff-line:nth-child(5) { animation-delay: 0.12s }
.prevent-diff tr.diff-line:nth-child(6) { animation-delay: 0.15s }
.prevent-diff tr.diff-line:nth-child(7) { animation-delay: 0.18s }
.prevent-diff tr.diff-line:nth-child(8) { animation-delay: 0.21s }
.prevent-diff tr.diff-line:nth-child(9) { animation-delay: 0.24s }
.prevent-diff tr.diff-line:nth-child(10) { animation-delay: 0.27s }
.prevent-diff tr.diff-line:nth-child(n+11) { animation-delay: 0.30s }
.prevent-diff td.diff-code-insert::before {
  content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
  background: var(--color-ok-soft); transform: scaleX(0); transform-origin: left;
  animation: prevent-diffwipe 0.5s var(--ease-settle) 0.25s forwards;
}
@keyframes prevent-diffline { from { opacity: 0; transform: translateX(-6px) } to { opacity: 1; transform: none } }
@keyframes prevent-diffwipe { to { transform: scaleX(1) } }
@media (prefers-reduced-motion: reduce) {
  .prevent-diff tr.diff-line { animation: none }
  .prevent-diff td.diff-code-insert::before { animation: none; transform: scaleX(1) }
}
`;
let diffInjected = false;
function ensureDiffStyles(): void {
  if (diffInjected || typeof document === 'undefined') return;
  diffInjected = true;
  const el = document.createElement('style');
  el.setAttribute('data-prevent-diff', '');
  el.textContent = DIFF_CSS;
  document.head.appendChild(el);
}

function PatchDiffCard({ hasPatch, root }: { hasPatch: boolean; root: React.RefObject<Element | null> }) {
  const files = useMemo(() => parseDiff(SAMPLE_DIFF, { nearbySequences: 'zip' }), []);
  useEffect(() => {
    ensureDiffStyles();
  }, []);
  return (
    <RevealOnView root={root} className="solid-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="font-mono text-overline uppercase tracking-wider text-text-secondary">
          Patch — CWE-306 missing auth
        </h4>
        <span
          className={`rounded-pill border px-2 py-0.5 font-mono text-overline uppercase tracking-wider ${
            hasPatch ? 'border-ok/40 bg-ok/15 text-ok' : 'border-border bg-surface-2 text-text-muted'
          }`}
        >
          {hasPatch ? 'ready for review' : 'pending'}
        </span>
      </div>
      <div className="prevent-diff overflow-hidden rounded-md border border-border bg-bg text-mono-sm">
        {files.map((f, i) => (
          <Diff key={i} viewType="unified" diffType={f.type} hunks={f.hunks} gutterType="none">
            {(hunks) => hunks.map((h) => <Hunk key={h.content} hunk={h} />)}
          </Diff>
        ))}
      </div>
    </RevealOnView>
  );
}

function ComplianceCard({
  device,
  verified,
  root,
}: {
  device: DeviceStatus;
  verified: boolean;
  root: React.RefObject<Element | null>;
}) {
  const ts = new Date(device.updatedAt || Date.now()).toISOString();
  return (
    <RevealOnView root={root} className="relative rounded-xl border border-border-accent bg-blue-10 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="font-mono text-overline uppercase tracking-wider text-blue">
          FDA §524B · auditable receipt
        </h4>
        {/* The seal stamps in when the fix is verified. */}
        <AnimatePresence>
          {verified ? (
            <motion.span
              key="seal"
              initial={{ opacity: 0, scale: 1.4, rotate: -8 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={SPRING.snappy}
              className="rounded-pill border border-ok/50 bg-ok/15 px-2.5 py-0.5 font-mono text-overline font-semibold uppercase tracking-wider text-ok"
            >
              Approved · §524B
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-mono-sm">
        <dt className="text-text-secondary">Device</dt>
        <dd>Model VENT-SIM / Lab unit #0001</dd>
        <dt className="text-text-secondary">Finding</dt>
        <dd>
          CWE-306 · <span className="text-blue">CVE-2019-6538</span>
        </dd>
        <dt className="text-text-secondary">Patch</dt>
        <dd>require X-Device-Token · ignore untrusted overrides</dd>
        <dt className="text-text-secondary">Verify</dt>
        <dd>
          same exploit → <span className="text-ok">401</span> after fix
        </dd>
        <dt className="text-text-secondary">Last update</dt>
        <dd className="tabular-nums">{ts}</dd>
      </dl>
    </RevealOnView>
  );
}

function EventLogCard({ log }: { log: EventLogRow[] }) {
  // Newest pinned to the top.
  const rows = useMemo(() => [...log].reverse(), [log]);
  return (
    <section className="solid-card p-4">
      <h4 className="mb-2 font-mono text-overline uppercase tracking-wider text-text-secondary">
        Event log
      </h4>
      {rows.length === 0 ? (
        <p className="font-mono text-mono-sm text-text-muted">Pipeline idle. Device healthy.</p>
      ) : (
        <ul className="log-fade max-h-48 space-y-1.5 overflow-y-auto font-mono text-mono-sm">
          <AnimatePresence initial={false}>
            {rows.map((e, i) => (
              <motion.li
                key={e.id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: EASE_SETTLE }}
                className="flex items-center gap-2"
              >
                <span className={`status-dot ${i === 0 ? 'live' : ''}`} aria-hidden />
                <span className="shrink-0 text-blue">{e.actor}</span>
                <span className="text-text-secondary">{e.text}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

// --- Panel ---------------------------------------------------------------

export function DashboardPanel({ agents, findings, eventLog, device }: Props) {
  const scrollRef = useRef<HTMLElement>(null);
  const [approved, setApproved] = useState(false);

  const selfCorrection = useMemo(() => detectSelfCorrection(agents), [agents]);
  const guardrailEvent = useMemo(() => detectGuardrailRefusal(eventLog), [eventLog]);
  const awaiting = useMemo(
    () => agents.find((a) => a.state === 'waiting_for_human'),
    [agents],
  );
  const hasPatch = useMemo(
    () => agents.some((a) => a.stage === 'patch' && a.state !== 'idle'),
    [agents],
  );
  const verified = useMemo(
    () => agents.some((a) => a.stage === 'verify' && a.state === 'done'),
    [agents],
  );

  return (
    <section
      ref={scrollRef}
      aria-label="Security pipeline dashboard"
      className="grid h-full min-h-0 grid-cols-1 content-start gap-6 overflow-y-auto p-5 xl:grid-cols-[38fr_62fr]"
    >
      {/* Attack band spans both columns while the device is compromised / verifying. */}
      <AttackPath device={device} />

      <div className="space-y-4">
        <AgentTimeline agents={agents} />

        {/* Trust cards: appear only when the moment is real. */}
        <AnimatePresence mode="popLayout">
          {awaiting ? (
            <AwaitingApprovalCard
              key="await"
              agent={awaiting}
              approved={approved}
              onApprove={() => setApproved(true)}
            />
          ) : null}
          {selfCorrection ? <SelfCorrectionCard key="self" agent={selfCorrection} /> : null}
          {guardrailEvent ? <GuardrailBlockedCard key="guard" event={guardrailEvent} /> : null}
        </AnimatePresence>
      </div>

      <div className="space-y-4">
        <h3 className="font-mono text-overline uppercase tracking-wider text-text-secondary">
          Evidence
        </h3>
        <TelemetryVsReality device={device} />
        <FindingsCard findings={findings} root={scrollRef} />
        <PatchDiffCard hasPatch={hasPatch} root={scrollRef} />
        <ComplianceCard device={device} verified={verified} root={scrollRef} />
        <EventLogCard log={eventLog} />
      </div>
    </section>
  );
}
