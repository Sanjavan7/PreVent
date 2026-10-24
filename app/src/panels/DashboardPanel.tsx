// Right panel: the "glass skull" dashboard.
// Left column: an agent timeline you can watch think.
// Right column: the evidence stack (findings, telemetry-vs-reality, diff, compliance, log).
//
// Everything here reads the SAME rows the Pixi monitor + Arduino see, so the two
// panels can never desync. The dashboard adds three signature "trust" surfaces that
// make the pipeline feel honest instead of magical:
//
//   - Streaming reasoning card inside the active timeline node (typewriter-ish
//     autoscroll of the reasoning string + a visible confidence gauge).
//   - Self-Correction / Guardrail Blocked / Awaiting Approval banners that
//     surface conditionally based on agent state and the event log.
//   - A Telemetry-vs-Reality card that "snaps" red when the device is lying.
//
// motion/react is used sparingly -- motion is for meaning, not decoration.

import { useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
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
  idle: 'border-border bg-surface-2 text-muted',
  running: 'border-accent/40 bg-accent/15 text-accent',
  waiting_for_human: 'border-warn/40 bg-warn/15 text-warn',
  done: 'border-ok/40 bg-ok/15 text-ok',
  error: 'border-danger/40 bg-danger/15 text-danger',
};

const STATE_DOT: Record<AgentState, string> = {
  idle: 'bg-border',
  running: 'bg-accent shadow-[0_0_0_4px_rgba(56,189,248,0.15)]',
  waiting_for_human: 'bg-warn shadow-[0_0_0_4px_rgba(255,176,32,0.15)]',
  done: 'bg-ok',
  error: 'bg-danger shadow-[0_0_0_4px_rgba(255,77,79,0.15)]',
};

// --- Timeline ------------------------------------------------------------

function ConfidenceGauge({
  value,
  uncertainty,
}: {
  value: number;
  uncertainty?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  const tone =
    pct >= 80 ? 'bg-ok' : pct >= 55 ? 'bg-accent' : pct >= 30 ? 'bg-warn' : 'bg-danger';
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted">
        <span>Confidence</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <motion.div
          className={`h-full ${tone}`}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      {uncertainty ? (
        <p className="mt-1 font-mono text-[11px] leading-snug text-muted">
          <span className="text-warn">!</span> {uncertainty}
        </p>
      ) : null}
    </div>
  );
}

function ReasoningStream({ text }: { text: string }) {
  // Keep the newest token visible: on text change, scroll to bottom.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <div
      ref={ref}
      className="mt-2 max-h-28 overflow-y-auto rounded-md border border-border bg-bg/60 p-2 font-mono text-[11px] leading-relaxed text-muted"
    >
      {text || <span className="opacity-50">(waiting for the model to speak...)</span>}
    </div>
  );
}

function StageRow({
  stage,
  agent,
  isLast,
}: {
  stage: Stage;
  agent?: AgentStatus;
  isLast: boolean;
}) {
  const state: AgentState = agent?.state ?? 'idle';
  const active = state === 'running' || state === 'waiting_for_human';
  return (
    <li className="relative pl-7">
      {/* Spine */}
      {!isLast && (
        <span className="absolute left-[11px] top-5 h-full w-px bg-border" aria-hidden />
      )}
      {/* Node dot */}
      <span
        className={`absolute left-[6px] top-[6px] inline-block h-3 w-3 rounded-full transition-shadow ${STATE_DOT[state]}`}
        aria-hidden
      />
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-wider text-text">
          {STAGE_LABEL[stage]}
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATE_PILL[state]}`}
        >
          {state.replace('_', ' ')}
        </span>
        {agent?.agentName ? (
          <span className="font-mono text-[10px] text-muted">{agent.agentName}</span>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {active && agent ? (
          <motion.div
            key="active"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <ReasoningStream text={agent.reasoning} />
            <ConfidenceGauge
              value={agent.confidence ?? 0}
              uncertainty={agent.uncertainty}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="h-4" />
    </li>
  );
}

function AgentTimeline({ agents }: { agents: AgentStatus[] }) {
  const byStage = useMemo(() => {
    const m = new Map<Stage, AgentStatus>();
    for (const a of agents) m.set(a.stage, a);
    return m;
  }, [agents]);
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
        Agent timeline
      </h3>
      <ol className="relative">
        {STAGES.map((s, i) => (
          <StageRow
            key={s}
            stage={s}
            agent={byStage.get(s)}
            isLast={i === STAGES.length - 1}
          />
        ))}
      </ol>
    </div>
  );
}

// --- Trust cards ---------------------------------------------------------

function SelfCorrectionCard({ agent }: { agent: AgentStatus }) {
  return (
    <motion.aside
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-lg border border-warn/40 bg-warn/10 p-3"
      role="status"
    >
      <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-warn">
        <span>↺ Self-correction</span>
        <span className="opacity-60">· {agent.agentName}</span>
      </div>
      <p className="mt-1 text-sm text-text">
        {agent.reasoning ||
          'Rejected my own output — the fix broke the emergency override. Revising.'}
      </p>
    </motion.aside>
  );
}

function GuardrailBlockedCard({ event }: { event: EventLogRow }) {
  return (
    <motion.aside
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-lg border border-danger/40 bg-danger/10 p-3"
      role="status"
    >
      <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-danger">
        <span>⛔ Action refused · sandbox</span>
      </div>
      <p className="mt-1 font-mono text-xs text-text">{event.text}</p>
    </motion.aside>
  );
}

function AwaitingApprovalCard({
  agent,
  onApprove,
}: {
  agent: AgentStatus;
  onApprove?: () => void;
}) {
  return (
    <motion.aside
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-lg border border-warn/50 bg-warn/10 p-3"
      role="dialog"
    >
      <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-warn">
        <span>⏸ Awaiting human approval</span>
        <span className="opacity-60">· {STAGE_LABEL[agent.stage]}</span>
      </div>
      <ul className="mt-2 space-y-1 font-mono text-xs text-muted">
        <li>· patch written by the model</li>
        <li>· unit tests ran green in the sandbox</li>
        <li>· exploit proof captured (pre-patch)</li>
      </ul>
      <button
        type="button"
        onClick={onApprove}
        className="prevent-transition pulse mt-3 w-full rounded-md bg-warn px-4 py-2 font-mono text-sm font-semibold uppercase tracking-wider text-bg hover:brightness-110"
      >
        Approve &amp; deploy
      </button>
    </motion.aside>
  );
}

// Simple heuristic: catch "self-correction" moments from the reasoning text so
// the dashboard can light up even before we have a dedicated DB field. The
// orchestrator can also force the beat by prefixing the text with "REJECTED".
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
    if (
      e.actor === 'guardrail' ||
      t.includes('action refused') ||
      t.includes('sandbox refused')
    ) {
      return e;
    }
  }
  return null;
}

// --- Evidence cards ------------------------------------------------------

function FindingsCard({ findings }: { findings: Finding[] }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <h4 className="mb-2 font-mono text-xs uppercase tracking-wider text-muted">
        Findings
      </h4>
      {findings.length === 0 ? (
        <p className="font-mono text-xs text-muted">
          No findings yet — scanner has not reported.
        </p>
      ) : (
        <ul className="space-y-2">
          {findings.map((f) => (
            <li
              key={f.id}
              className={`rounded-md border p-2 text-sm ${
                f.isTheRealOne
                  ? 'border-danger/50 bg-danger/10'
                  : 'border-border bg-surface-2'
              }`}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted">
                <span className="rounded bg-bg/60 px-1 py-0.5 text-text">
                  {f.scanner}
                </span>
                <span>
                  {f.file}:{f.line}
                </span>
                <span className="uppercase">{f.severity}</span>
                {f.cveRef ? <span className="text-accent">{f.cveRef}</span> : null}
                {f.isTheRealOne ? (
                  <span className="rounded bg-danger/20 px-1 py-0.5 text-danger">
                    REAL
                  </span>
                ) : null}
              </div>
              <p className="mt-1">{f.claudeVerdict}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TelemetryVsReality({ device }: { device: DeviceStatus }) {
  const hrLying = device.reportedHr !== device.trueHr;
  const spo2Lying = device.reportedSpo2 !== device.trueSpo2;
  const lying = hrLying || spo2Lying;
  return (
    <motion.section
      initial={false}
      animate={{
        borderColor: lying ? 'rgba(255,77,79,0.5)' : 'rgba(31,43,56,1)',
        backgroundColor: lying ? 'rgba(255,77,79,0.08)' : 'rgba(17,24,33,1)',
      }}
      transition={{ duration: 0.25 }}
      className="rounded-lg border p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <h4 className="font-mono text-xs uppercase tracking-wider text-muted">
          Telemetry vs reality
        </h4>
        <AnimatePresence initial={false}>
          {lying ? (
            <motion.span
              key="lying"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="rounded-full border border-danger/50 bg-danger/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-danger"
            >
              The device is lying
            </motion.span>
          ) : (
            <span className="rounded-full border border-ok/40 bg-ok/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ok">
              Match
            </span>
          )}
        </AnimatePresence>
      </div>
      <div className="grid grid-cols-3 gap-y-1 font-mono text-xs tabular-nums">
        <span />
        <span className="text-muted">reported</span>
        <span className="text-muted">actual</span>
        <span className="text-muted">HR</span>
        <span>{device.reportedHr}</span>
        <span className={hrLying ? 'text-danger' : 'text-ok'}>{device.trueHr}</span>
        <span className="text-muted">SpO₂</span>
        <span>{device.reportedSpo2}</span>
        <span className={spo2Lying ? 'text-danger' : 'text-ok'}>
          {device.trueSpo2}
        </span>
      </div>
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

function PatchDiffCard({ hasPatch }: { hasPatch: boolean }) {
  const files = useMemo(() => parseDiff(SAMPLE_DIFF, { nearbySequences: 'zip' }), []);
  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="font-mono text-xs uppercase tracking-wider text-muted">
          Patch — CWE-306 missing auth
        </h4>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
            hasPatch
              ? 'border-ok/40 bg-ok/15 text-ok'
              : 'border-border bg-surface-2 text-muted'
          }`}
        >
          {hasPatch ? 'ready for review' : 'pending'}
        </span>
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-bg text-[12px]">
        {files.map((f, i) => (
          <Diff
            key={i}
            viewType="unified"
            diffType={f.type}
            hunks={f.hunks}
            gutterType="none"
          >
            {(hunks) =>
              hunks.map((h) => <Hunk key={h.content} hunk={h} />)
            }
          </Diff>
        ))}
      </div>
    </section>
  );
}

function ComplianceCard({ device }: { device: DeviceStatus }) {
  const ts = new Date(device.updatedAt || Date.now()).toISOString();
  return (
    <section className="rounded-lg border border-accent/30 bg-accent/5 p-3">
      <h4 className="mb-2 font-mono text-xs uppercase tracking-wider text-accent">
        FDA §524B · auditable receipt
      </h4>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
        <dt className="text-muted">Device</dt>
        <dd>Model VENT-SIM / Lab unit #0001</dd>
        <dt className="text-muted">Finding</dt>
        <dd>
          CWE-306 · <span className="text-accent">CVE-2019-6538</span>
        </dd>
        <dt className="text-muted">Patch</dt>
        <dd>require X-Device-Token · ignore untrusted overrides</dd>
        <dt className="text-muted">Verify</dt>
        <dd>same exploit → <span className="text-ok">401</span> after fix</dd>
        <dt className="text-muted">Last update</dt>
        <dd className="tabular-nums">{ts}</dd>
      </dl>
    </section>
  );
}

function EventLogCard({ log }: { log: EventLogRow[] }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <h4 className="mb-2 font-mono text-xs uppercase tracking-wider text-muted">
        Event log
      </h4>
      {log.length === 0 ? (
        <p className="font-mono text-xs text-muted">
          Pipeline idle. Device healthy.
        </p>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-y-auto font-mono text-xs">
          {log.map((e) => (
            <li key={e.id} className="flex gap-2">
              <span className="shrink-0 text-accent">{e.actor}</span>
              <span className="text-muted">{e.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// --- Panel ---------------------------------------------------------------

export function DashboardPanel({ agents, findings, eventLog, device }: Props) {
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

  return (
    <section
      aria-label="Security pipeline dashboard"
      className="grid min-h-0 grid-cols-1 gap-6 overflow-y-auto p-5 xl:grid-cols-[38fr_62fr]"
    >
      <div className="space-y-4">
        <AgentTimeline agents={agents} />

        {/* Trust cards: appear only when the moment is real. */}
        <AnimatePresence>
          {awaiting ? (
            <AwaitingApprovalCard key="await" agent={awaiting} />
          ) : null}
          {selfCorrection ? (
            <SelfCorrectionCard key="self" agent={selfCorrection} />
          ) : null}
          {guardrailEvent ? (
            <GuardrailBlockedCard key="guard" event={guardrailEvent} />
          ) : null}
        </AnimatePresence>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Evidence
        </h3>
        <TelemetryVsReality device={device} />
        <FindingsCard findings={findings} />
        <PatchDiffCard hasPatch={hasPatch} />
        <ComplianceCard device={device} />
        <EventLogCard log={eventLog} />
      </div>
    </section>
  );
}
