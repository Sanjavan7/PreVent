// Live telemetry — every agent action as it happens, newest first. Mono, dense,
// the "observability into what the agents are doing" the operator reads.

import type { EventLogRow } from '@prevent/contracts';

const ACTOR_TONE: Record<string, string> = {
  ground: 'text-text-secondary',
  scan: 'text-accent-fg',
  semgrep: 'text-accent-fg',
  bandit: 'text-accent-fg',
  rank: 'text-accent-fg',
  bitdeer: 'text-accent-fg',
  deliver: 'text-danger-fg',
  blueteam: 'text-warn-fg',
  operator: 'text-warn-fg',
  verify: 'text-success-fg',
};

function hhmmss(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

export function TelemetryRail({ rows }: { rows: EventLogRow[] }) {
  return (
    <section className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-overline uppercase text-text-muted">Telemetry</span>
        <span className="font-mono text-meta text-text-muted">{rows.length} events</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-meta leading-relaxed">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-text-muted">No activity yet. Run the pipeline.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((r) => (
              <li key={r.id} className="flex gap-2">
                <span className="shrink-0 tabular-nums text-text-muted">{hhmmss(r.ts)}</span>
                <span className={`shrink-0 ${ACTOR_TONE[r.actor] ?? 'text-text-secondary'}`}>
                  {r.actor}
                </span>
                <span className="text-text-secondary">{r.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
