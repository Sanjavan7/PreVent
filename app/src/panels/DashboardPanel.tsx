// Right dashboard — thin composition root (Stage 2).
//
// ONE calm 640px column: ① header strip, ② activity feed (steps appear as they
// happen; finished collapse to one quiet line; exactly one dim queued hint
// ahead; artifacts live INSIDE their step behind disclosures), ③ pinned Truth
// Strip. Neutrals + ONE blue; red only for lie/exploit, green only for the 401
// payoff. OWNER OVERRIDE: zero amber — the approval gate + needs-you marker are
// BLUE (handled in the gate/marker components).
//
// This root assembles the PipelineValue from the single realtime subscription
// so the feed, the gate and the truth strip can never desync, derives the
// activity entries with a MEMOIZED pure selector (never an effect), and injects
// each stage's sponsor-critical artifact via renderExtras so the feed stays
// generic.

import { useCallback, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type {
  AgentStatus,
  DeviceStatus,
  EventLogRow,
  ExploitRun,
  Finding,
  PatchAttempt,
} from '@prevent/contracts';

import { PipelineProvider, type PipelineValue } from '../components/pipeline/PipelineProvider';
import { deriveActivity, type ActivityEntry } from '../components/pipeline/deriveActivity';
import { ActivityFeed } from '../components/feed/ActivityFeed';
import { ApprovalGate } from '../components/gate/ApprovalGate';
import { CompactDiff } from '../components/primitives/CompactDiff';
import { Disclosure } from '../components/primitives/Disclosure';
import { TruthStrip } from '../components/truth/TruthStrip';
import { requestMockApprove } from '../realtime/useRealtimeMock';
import { SPRING } from '../lib/motion';

interface Props {
  device: DeviceStatus;
  agents: AgentStatus[];
  findings: Finding[];
  eventLog: EventLogRow[];
  exploitRuns: ExploitRun[];
  patchAttempts: PatchAttempt[];
  /** SpacetimeDB liveness for the header chip (true in the demo). */
  live?: boolean;
}

const DEVICE_LABEL = 'Ventilator · Lab unit #0001';
const FLEET_SIZE = 3412;
const TOTAL_STAGES = 7;

// Short fallback diff when no real patch_attempts row carries one yet.
const SAMPLE_DIFF = `--- a/device-service/app.py
+++ b/device-service/app.py
@@ -38,7 +38,12 @@ app = Flask(__name__)
 @app.route("/device/command", methods=["POST"])
 def device_command():
-    payload = request.get_json(force=True)
+    token = request.headers.get("X-Device-Token")
+    if not token or not constant_time_compare(token, DEVICE_TOKEN):
+        return jsonify({"error": "unauthorized"}), 401
+    payload = request.get_json(force=True)
+    payload.pop("reportedOverrides", None)
     action = payload.get("action")
     return apply_command(action, payload)`;

// ---------- Header strip (①) ------------------------------------------------

function StatusChip({ compromised, patched }: { compromised: boolean; patched: boolean }) {
  const label = compromised ? 'Compromised' : patched ? 'Patched' : 'Secure';
  const tone = compromised ? 'text-danger-fg' : 'text-text-secondary';
  const dot = compromised ? 'var(--color-danger)' : 'var(--color-text-muted)';
  return (
    <span className={`inline-flex items-center gap-1.5 text-meta ${tone}`}>
      <span aria-hidden className="block h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
      {label}
    </span>
  );
}

function LiveChip({ live }: { live: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-xs border border-border bg-surface-2 px-1.5 py-0.5 text-meta text-text-muted"
      title="One shared SpacetimeDB row drives this screen, the monitor, and the device."
    >
      <span
        aria-hidden
        className="block h-1.5 w-1.5 rounded-full"
        style={{ background: live ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
      />
      SpacetimeDB · {live ? 'live' : 'offline'}
    </span>
  );
}

function ProgressBars({ done }: { done: number }) {
  return (
    <div className="flex w-full items-center gap-2">
      <div className="flex flex-1 items-center gap-1" aria-hidden>
        {Array.from({ length: TOTAL_STAGES }, (_, i) => (
          <span
            key={i}
            className="h-1 flex-1 rounded-pill"
            style={{ background: i < done ? 'var(--color-accent)' : 'var(--color-border)' }}
          />
        ))}
      </div>
      <span className="shrink-0 text-meta tabular-nums text-text-muted">
        {done} / {TOTAL_STAGES}
      </span>
    </div>
  );
}

function HeaderStrip({
  compromised,
  patched,
  done,
  live,
}: {
  compromised: boolean;
  patched: boolean;
  done: number;
  live: boolean;
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
      <span className="text-base font-medium text-text">{DEVICE_LABEL}</span>
      <StatusChip compromised={compromised} patched={patched} />
      <LiveChip live={live} />
      <span className="ml-auto text-meta tabular-nums text-text-muted">
        1 of {FLEET_SIZE.toLocaleString()} devices
      </span>
      <ProgressBars done={done} />
    </header>
  );
}

// ---------- In-step artifacts (injected via renderExtras) -------------------

/** One-line inline sub-event: self-correction (muted) or guardrail refusal (danger). */
function StepSubEvent({ kind, text }: { kind: 'self-correct' | 'guardrail'; text: string }) {
  const danger = kind === 'guardrail';
  return (
    <p className={`flex items-start gap-1.5 text-meta ${danger ? 'text-danger-fg' : 'text-text-muted'}`}>
      <span aria-hidden className="shrink-0">
        {danger ? '⌀' : '↻'}
      </span>
      <span>{text}</span>
    </p>
  );
}

/** The attack, as one compact mono request card living in the deliver step. The
 *  status token is red while the device is compromised. */
function RequestCard({ compromised }: { compromised: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-meta">
      <span className="text-text-secondary">→ POST /device/command</span>
      <span className="text-text-muted">no auth · CWE-306</span>
      <span
        className="ml-auto rounded-xs px-1.5 py-0.5"
        style={
          compromised
            ? { background: 'var(--color-danger-bg)', color: 'var(--color-danger-fg)' }
            : { background: 'var(--color-surface-3)', color: 'var(--color-text-muted)' }
        }
      >
        {compromised ? '200 OK' : '—'}
      </span>
    </div>
  );
}

/** The 401 payoff — the ONLY green + the ONLY SPRING.snap overshoot, fired once
 *  when the verify step is reached. */
function Payoff401() {
  const reduce = useReducedMotion();
  return (
    <div className="space-y-1.5">
      <p className="text-sm text-text-secondary">Same request, replayed → 401 Unauthorized.</p>
      <motion.span
        className="inline-flex items-center rounded-xs px-2 py-0.5 font-mono text-meta font-medium"
        style={{
          background: 'var(--color-success-bg)',
          color: 'var(--color-success-fg)',
          boxShadow: 'inset 0 -2px 0 var(--color-success)',
        }}
        initial={reduce ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduce ? { duration: 0 } : SPRING.snap}
      >
        401 Unauthorized
      </motion.span>
    </div>
  );
}

/** The FDA §524B audit receipt behind a disclosure on the final (restore) step. */
function AuditReceipt({ device }: { device: DeviceStatus }) {
  const ts = new Date(device.updatedAt || Date.now()).toISOString();
  return (
    <Disclosure trigger="Audit receipt">
      <div className="rounded-sm border border-border bg-surface-2 p-3">
        <div className="mb-2 flex items-center gap-2 text-overline uppercase tracking-wide text-text-muted">
          <span>FDA §524B</span>
          <span style={{ color: 'var(--color-success-fg)' }}>✓</span>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-meta">
          <dt className="text-text-muted">Device</dt>
          <dd className="text-text-secondary">VENT-SIM · Lab unit #0001</dd>
          <dt className="text-text-muted">Finding</dt>
          <dd className="text-text-secondary">CWE-306 · CVE-2019-6538 (read-only ref)</dd>
          <dt className="text-text-muted">Patch</dt>
          <dd className="text-text-secondary">require X-Device-Token · ignore untrusted overrides</dd>
          <dt className="text-text-muted">Verify</dt>
          <dd className="text-text-secondary">same exploit replayed → 401 after fix</dd>
          <dt className="text-text-muted">Recorded</dt>
          <dd className="tabular-nums text-text-secondary">{ts}</dd>
        </dl>
      </div>
    </Disclosure>
  );
}

/** The one real finding in plain language; scanner / file:line / severity / CVE
 *  behind "Details" (spec B4 — keep it clean, no raw noise up front). */
function FindingDetails({ findings }: { findings: Finding[] }) {
  const real = findings.find((f) => f.isTheRealOne) ?? findings[0];
  if (!real) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-sm text-text-secondary">
        Missing auth on the device command endpoint (CWE-306).
      </p>
      <Disclosure trigger="Details">
        <div className="rounded-sm border border-border bg-surface-2 p-2.5 font-mono text-meta text-text-secondary">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="rounded-xs bg-surface-3 px-1.5 py-0.5 text-text">{real.scanner}</span>
            <span>
              {real.file}:{real.line}
            </span>
            <span className="uppercase">{real.severity}</span>
            {real.cveRef ? <span className="text-accent-fg">{real.cveRef}</span> : null}
          </div>
          <p className="mt-1.5 text-text-secondary">{real.claudeVerdict}</p>
        </div>
      </Disclosure>
    </div>
  );
}

// Heuristics for the inline trust sub-events (no new DB columns).
function selfCorrectionText(agents: AgentStatus[]): string | null {
  const a = agents.find((x) => {
    const t = (x.reasoning || '').toLowerCase();
    return t.includes('rejected') || t.includes('revis') || t.includes('self-correct');
  });
  return a ? 'Revised once — the first fix broke the emergency override.' : null;
}

function guardrailText(eventLog: EventLogRow[]): string | null {
  const e = eventLog.find((x) => {
    const t = (x.text || '').toLowerCase();
    return x.actor === 'guardrail' || t.includes('refused') || t.includes('sandbox refused');
  });
  return e ? e.text : null;
}

// ---------- Panel -----------------------------------------------------------

export function DashboardPanel({
  device,
  agents,
  findings,
  eventLog,
  exploitRuns,
  patchAttempts,
  live = true,
}: Props) {
  const [approved, setApproved] = useState(false);

  // Approving keeps the existing optimistic UI (local `approved` flips the gate
  // to "Deploying…") AND advances the scripted mock demo director past its
  // waiting_for_human hold. In live mode requestMockApprove is a no-op.
  const handleApprove = useCallback(() => {
    setApproved(true);
    requestMockApprove();
  }, []);

  // PURE selector, memoized in render (never in an effect).
  const entries = useMemo(() => deriveActivity(agents), [agents]);

  // Run origin = earliest non-idle agent timestamp, for the mm:ss elapsed stamps.
  const origin = useMemo(() => {
    const ts = agents.filter((a) => a.state !== 'idle').map((a) => a.updatedAt);
    return ts.length ? Math.min(...ts) : undefined;
  }, [agents]);

  const done = useMemo(() => agents.filter((a) => a.state === 'done').length, [agents]);
  const patched = useMemo(
    () => agents.some((a) => a.stage === 'restore' && a.state === 'done'),
    [agents],
  );

  const selfCorrect = useMemo(() => selfCorrectionText(agents), [agents]);
  const guardrail = useMemo(() => guardrailText(eventLog), [eventLog]);
  const diff = patchAttempts[0]?.diffRef || SAMPLE_DIFF;

  const value = useMemo<PipelineValue>(
    () => ({
      device,
      agents,
      findings,
      eventLog,
      exploitRuns,
      patchAttempts,
      approved,
      meta: { deviceLabel: DEVICE_LABEL, fleetSize: FLEET_SIZE, live },
      actions: { approve: handleApprove },
    }),
    [device, agents, findings, eventLog, exploitRuns, patchAttempts, approved, live, handleApprove],
  );

  // Per-stage artifacts injected into the generic feed.
  function renderExtras(entry: ActivityEntry) {
    switch (entry.stage) {
      case 'scan':
        return <FindingDetails findings={findings} />;
      case 'deliver':
        return <RequestCard compromised={device.compromised} />;
      case 'patch':
        return (
          <>
            {selfCorrect ? <StepSubEvent kind="self-correct" text={selfCorrect} /> : null}
            {guardrail ? <StepSubEvent kind="guardrail" text={guardrail} /> : null}
            <CompactDiff diff={diff} />
            <ApprovalGate
              show={entry.status === 'needs-approval'}
              approved={approved}
              onApprove={handleApprove}
            />
          </>
        );
      case 'verify':
        return <Payoff401 />;
      case 'restore':
        return <AuditReceipt device={device} />;
      default:
        return null;
    }
  }

  return (
    <PipelineProvider value={value}>
      <section
        aria-label="Security pipeline dashboard"
        className="mx-auto flex h-full min-h-0 w-full max-w-[640px] flex-col"
      >
        <HeaderStrip compromised={device.compromised} patched={patched} done={done} live={live} />

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {entries.length === 0 ? (
            <p className="text-sm text-text-muted">No active investigation. Monitoring 1 device.</p>
          ) : (
            <ActivityFeed entries={entries} origin={origin} renderExtras={renderExtras} />
          )}
        </div>

        <TruthStrip device={device} />
      </section>
    </PipelineProvider>
  );
}
