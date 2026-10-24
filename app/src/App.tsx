import { SimPanel } from './panels/SimPanel';
import { DashboardPanel } from './panels/DashboardPanel';
import { useRealtime } from './realtime/useRealtime';

export function App() {
  // One subscription source feeds both panels -> no desync.
  const rt = useRealtime();

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold tracking-tight">
            Pre<span className="text-accent">Vent</span>
          </span>
          <span className="rounded-full border border-border bg-surface px-3 py-0.5 font-mono text-xs text-muted">
            1 of 3,412 devices
          </span>
          <span
            className={`prevent-transition rounded-full px-3 py-0.5 font-mono text-xs ${
              rt.device.compromised
                ? 'bg-danger/15 text-danger'
                : 'bg-ok/15 text-ok'
            }`}
          >
            {rt.device.compromised ? 'THREAT ACTIVE' : 'NO THREATS'}
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs text-muted">
          <span>source: {rt.mode}</span>
          {rt.mode === 'mock' && (
            <button
              type="button"
              onClick={() => rt.setMockExploited(!rt.mockExploited)}
              className="rounded-md border border-accent/40 px-3 py-1 text-accent hover:bg-accent/10"
            >
              {rt.mockExploited ? 'Reset to healthy' : 'Simulate exploit'}
            </button>
          )}
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <SimPanel device={rt.device} />
        <DashboardPanel
          agents={rt.agents}
          findings={rt.findings}
          eventLog={rt.eventLog}
          device={rt.device}
        />
      </main>
    </div>
  );
}
