import type {
  AgentState,
  AgentStatus,
  DeviceStatus,
  EventLogRow,
  Finding,
} from '@prevent/contracts';

// Right panel: "glass skull" dashboard. Agent timeline (left) + evidence stack (right).
//
// TODO(dev): replace placeholders with the real components from the spec:
//   - Timeline: streaming reasoning card (mono, typewriter), confidence gauge,
//     tool-call chips, Self-Correction / Guardrail Blocked / Awaiting Approval cards.
//   - Evidence: Shiki code view (shiki/core + shiki/engine/javascript), react-diff-view
//     unified diff (import 'react-diff-view/style/index.css'), exploit terminal,
//     verification matrix, Telemetry-vs-Reality card, FDA 524B compliance card.
//   - Animate with `motion/react`.

interface Props {
  agents: AgentStatus[];
  findings: Finding[];
  eventLog: EventLogRow[];
  device: DeviceStatus;
}

const STATE_STYLE: Record<AgentState, string> = {
  idle: 'bg-border text-muted',
  running: 'pulse bg-accent/20 text-accent',
  waiting_for_human: 'pulse bg-warn/20 text-warn',
  done: 'bg-ok/15 text-ok',
  error: 'bg-danger/15 text-danger',
};

function AgentTimeline({ agents }: { agents: AgentStatus[] }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
        Agent timeline
      </h3>
      <ol className="relative ml-2 border-l border-border">
        {agents.map((a) => (
          <li key={a.id} className="mb-4 ml-4">
            <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-border bg-surface-2" />
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm uppercase">{a.stage}</span>
              <span
                className={`prevent-transition rounded-full px-2 py-0.5 font-mono text-[10px] ${STATE_STYLE[a.state]}`}
              >
                {a.state}
              </span>
            </div>
            {/* TODO(dev): streaming reasoning card + confidence gauge for active node. */}
            {a.reasoning && (
              <p className="mt-1 font-mono text-xs text-muted">{a.reasoning}</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function EvidenceStack({
  findings,
  eventLog,
  device,
}: Pick<Props, 'findings' | 'eventLog' | 'device'>) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
        Evidence
      </h3>

      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="mb-2 font-mono text-xs uppercase tracking-wider text-muted">
          Findings
        </div>
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
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted">
                <span>{f.scanner}</span>
                <span>
                  {f.file}:{f.line}
                </span>
                <span>{f.severity}</span>
                {f.cveRef && <span className="text-accent">{f.cveRef}</span>}
              </div>
              <p className="mt-1">{f.claudeVerdict}</p>
            </li>
          ))}
        </ul>
        {/* TODO(dev): Shiki code view of the vulnerable lines + react-diff-view patch. */}
      </div>

      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="mb-2 font-mono text-xs uppercase tracking-wider text-muted">
          Telemetry vs reality
        </div>
        <div className="grid grid-cols-3 gap-2 font-mono text-xs">
          <span />
          <span className="text-muted">reported</span>
          <span className="text-muted">actual</span>
          <span className="text-muted">HR</span>
          <span>{device.reportedHr}</span>
          <span className={device.reportedHr !== device.trueHr ? 'text-danger' : ''}>
            {device.trueHr}
          </span>
          <span className="text-muted">SpO2</span>
          <span>{device.reportedSpo2}</span>
          <span
            className={device.reportedSpo2 !== device.trueSpo2 ? 'text-danger' : ''}
          >
            {device.trueSpo2}
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="mb-2 font-mono text-xs uppercase tracking-wider text-muted">
          Event log
        </div>
        <ul className="space-y-1 font-mono text-xs">
          {eventLog.map((e) => (
            <li key={e.id}>
              <span className="text-accent">{e.actor}</span>{' '}
              <span className="text-muted">{e.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function DashboardPanel({ agents, findings, eventLog, device }: Props) {
  return (
    <section
      aria-label="Security pipeline dashboard"
      className="grid min-h-0 grid-cols-1 gap-6 overflow-y-auto p-5 xl:grid-cols-[38fr_62fr]"
    >
      <AgentTimeline agents={agents} />
      <EvidenceStack findings={findings} eventLog={eventLog} device={device} />
    </section>
  );
}
