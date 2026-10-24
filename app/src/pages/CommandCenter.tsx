// Command Center — the standalone technical portal (index.html, "/").
//
// Full-screen DashboardPanel: the command-center activity feed, the approval
// gate and the Truth Strip. Judges are highly technical, so this page stays
// deliberately restrained — a slim top bar (PreVent wordmark + "Command
// Center" + source + the mock Simulate toggle) over the dark surface; the feed
// keeps its own centered max-width column. In LIVE mode both pages subscribe to
// the same SpacetimeDB device row; here a teammate later expands the agent
// system to be multi-agentic.

import { DashboardPanel } from '../panels/DashboardPanel';
import { useRealtime } from '../realtime/useRealtime';

export function CommandCenter() {
  const rt = useRealtime();

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5 sm:px-6 lg:px-8">
        <div className="flex items-baseline gap-2.5">
          <span className="text-base font-semibold tracking-tight">
            Pre<span className="text-accent-fg">Vent</span>
          </span>
          <span className="text-meta uppercase tracking-wide text-text-muted">
            Command Center
          </span>
        </div>

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

      {/* The dashboard reads as one contained command-center card floating on
          the dark plane: centered, comfortable ~780px max width, generous
          gutters that tighten on narrow viewports. The card owns the width; the
          panel fills it edge to edge (header strip, scrolling feed, pinned
          Truth Strip), so there are no dead inner gutters. */}
      <main className="min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
        <div className="card mx-auto flex h-full min-h-0 w-full max-w-[780px] flex-col overflow-hidden">
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
