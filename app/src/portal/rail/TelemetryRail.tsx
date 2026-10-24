// Live telemetry — every agent action as it happens, newest first. Mono and
// dense: the observability into what the agents are doing, for the operator.

import type { EventLogRow } from '@prevent/contracts';

const ACTOR_TONE: Record<string, string> = {
  deliver: 'text-danger-fg',
  blueteam: 'text-warn-fg',
  operator: 'text-warn-fg',
  verify: 'text-success-fg',
  ground: 'text-text-secondary',
};

function hhmmss(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-GB', { hour12: false });
}

export function TelemetryRail({ rows }: { rows: EventLogRow[] }) {
  return (
    <section className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between px-3.5 py-2.5">
        <span className="text-sm font-medium text-text-secondary">Telemetry</span>
        <span className="font-mono text-meta text-text-muted">{rows.length} events</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border px-3.5 py-2.5 font-mono text-meta leading-relaxed [overscroll-behavior:contain]">
        {rows.length === 0 ? (
          <p className="py-4 text-text-muted">Idle. Run the pipeline to stream agent activity.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((r) => (
              <li key={r.id} className="flex gap-2.5">
                <span className="shrink-0 tabular-nums text-text-muted">{hhmmss(r.ts)}</span>
                <span className={`shrink-0 ${ACTOR_TONE[r.actor] ?? 'text-accent-fg'}`}>{r.actor}</span>
                <span className="text-text-secondary">{r.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
