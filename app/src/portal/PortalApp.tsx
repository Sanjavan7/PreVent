// PreVent — mission-control portal. The full agent pipeline as a live,
// observable workflow: ground a CVE, spawn scanner agents, rank, fan out
// exploit authors, deliver, patch behind a human gate, verify. One screen,
// no clutter — the spawning agent graph is the hero; everything else is quiet.

import { usePortalRun } from './usePortalRun';
import { FlowCanvas } from './flow/FlowCanvas';
import { TruthStrip } from './rail/TruthStrip';
import { RankPanel } from './rail/RankPanel';
import { TelemetryRail } from './rail/TelemetryRail';

function statusTone(resolved: boolean, compromised: boolean, running: boolean) {
  if (compromised && !resolved) return { label: 'compromised', cls: 'bg-danger-bg text-danger-fg' };
  if (resolved) return { label: 'neutralized', cls: 'bg-success-bg text-success-fg' };
  if (running) return { label: 'running', cls: 'bg-accent-bg text-accent-fg' };
  return { label: 'idle', cls: 'bg-surface-2 text-text-muted' };
}

export function PortalApp() {
  const { model, running, awaitingApproval, start, reset, approve } = usePortalRun();
  const compromised = model.truth.lying;
  const status = statusTone(model.resolved, compromised, running);

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      {/* ---- top bar ---- */}
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold tracking-tight">
            Pre<span className="text-brand">Vent</span>
          </span>
          <span className={`rounded-sm px-2 py-0.5 text-overline uppercase ${status.cls}`}>
            pipeline · {status.label}
          </span>
          {model.ground && (
            <span className="hidden items-center gap-2 font-mono text-meta text-text-secondary sm:flex">
              <span className="text-text-muted">grounded</span>
              <span className="text-accent-fg">{model.ground.id}</span>
              <span className="text-text-muted">{model.ground.cwe} · CVSS {model.ground.cvss}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {awaitingApproval && (
            <button
              type="button"
              onClick={approve}
              className="state-transition glow-amber rounded-sm border border-warn bg-warn-bg px-3 py-1.5 text-sm font-medium text-warn-fg hover:bg-surface-3"
            >
              Approve &amp; deploy patch
            </button>
          )}
          <button
            type="button"
            onClick={start}
            disabled={running}
            className="state-transition rounded-sm border border-accent-border bg-accent-bg px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-surface-3 disabled:opacity-40"
          >
            {running ? 'Running…' : 'Run pipeline'}
          </button>
          <button
            type="button"
            onClick={reset}
            className="state-transition rounded-sm border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-2"
          >
            Reset
          </button>
        </div>
      </header>

      {/* ---- main: flow canvas (hero) + observability rail ---- */}
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <FlowCanvas model={model} />

        <div className="flex min-h-0 flex-col gap-3">
          <TruthStrip truth={model.truth} />
          <RankPanel ranking={model.ranking} />
          <TelemetryRail rows={model.telemetry} />
        </div>
      </main>
    </div>
  );
}
