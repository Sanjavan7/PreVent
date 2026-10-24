// Minimal dark shell: a slim top bar (PreVent wordmark + source + the mock
// exploit toggle) over a two-column layout — the left 3D/2D patient monitor
// (SimPanel, untouched) and the right dashboard card. No glows, no gradients,
// no busy header animation; the calm comes from the restraint.

import { SimPanel } from './panels/SimPanel';
import { DashboardPanel } from './panels/DashboardPanel';
import { useRealtime } from './realtime/useRealtime';

export function App() {
  // One subscription source feeds both panels -> no desync.
  const rt = useRealtime();

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-base font-semibold tracking-tight">
          Pre<span className="text-accent-fg">Vent</span>
        </span>

        <div className="flex items-center gap-3 text-meta text-text-muted">
          <span>source: {rt.mode}</span>
          {rt.mode === 'mock' && (
            <button
              type="button"
              onClick={() => rt.setMockExploited(!rt.mockExploited)}
              className="state-transition rounded-sm border border-accent-border bg-accent-bg px-3 py-1 text-accent-fg hover:bg-surface-3"
            >
              {rt.mockExploited ? 'Reset to healthy' : 'Simulate exploit'}
            </button>
          )}
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-2">
        {/* Left: the patient monitor, rendered from the same device row. Untouched. */}
        <div className="min-h-0">
          <SimPanel device={rt.device} />
        </div>

        {/* Right: the dashboard reads as its own calm card. */}
        <div className="card min-h-0 overflow-hidden">
          <DashboardPanel
            device={rt.device}
            agents={rt.agents}
            findings={rt.findings}
            eventLog={rt.eventLog}
            exploitRuns={rt.exploitRuns}
            patchAttempts={rt.patchAttempts}
            live
          />
        </div>
      </main>
    </div>
  );
}
