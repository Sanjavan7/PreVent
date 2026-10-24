// PreVent — mission-control portal. The autonomous security pipeline as a live,
// observable workflow: ground a CVE, spawn scanner agents, rank, fan out exploit
// authors, deliver, patch behind a human gate, verify. The spawning agent trace
// is the hero; the rail is quiet observability beside it.

import { usePortalRun } from './usePortalRun';
import { FlowCanvas } from './flow/FlowCanvas';
import { TruthStrip } from './rail/TruthStrip';
import { RankPanel } from './rail/RankPanel';
import { TelemetryRail } from './rail/TelemetryRail';

function status(resolved: boolean, compromised: boolean, running: boolean) {
  if (compromised && !resolved) return { word: 'compromised', gem: 'text-danger' };
  if (resolved) return { word: 'neutralized', gem: 'text-success' };
  if (running) return { word: 'running', gem: 'text-accent' };
  return { word: 'idle', gem: 'text-text-muted' };
}

export function PortalApp() {
  const { model, running, awaitingApproval, start, reset, approve } = usePortalRun();
  const st = status(model.resolved, model.truth.lying, running);

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      {/* ---- top bar ---- */}
      <header className="flex items-center justify-between gap-4 px-5 py-3">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold tracking-tight">
            Pre<span className="text-brand">Vent</span>
          </span>
          <span className="flex items-center gap-2">
            <span className={`gem ${st.gem} ${running || model.truth.lying ? 'gem--live' : ''}`} style={{ width: 7, height: 7 }} />
            <span className="text-meta text-text-secondary">{st.word}</span>
          </span>
          {model.ground && (
            <span className="hidden font-mono text-meta text-text-muted sm:inline">
              grounded in <span className="text-accent-fg">{model.ground.id}</span>
              <span className="text-text-muted"> — {model.ground.cwe}, CVSS {model.ground.cvss}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {awaitingApproval && (
            <button
              type="button"
              onClick={approve}
              className="press state-transition glow-amber rounded-md bg-warn-bg px-3 py-1.5 text-sm font-medium text-warn-fg hover:bg-surface-3"
            >
              Approve &amp; deploy patch
            </button>
          )}
          <button
            type="button"
            onClick={start}
            disabled={running}
            className="press state-transition rounded-md bg-accent-bg px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-surface-3 disabled:opacity-40"
          >
            {running ? 'Running…' : 'Run pipeline'}
          </button>
          <button
            type="button"
            onClick={reset}
            className="press state-transition rounded-md px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-2"
          >
            Reset
          </button>
        </div>
      </header>

      {/* ---- main: flow trace (hero) + observability rail ---- */}
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-3 pb-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
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
