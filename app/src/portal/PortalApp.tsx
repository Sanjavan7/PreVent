// PreVent — the security console. It starts from real hardware, scans the
// device's actual code with real Semgrep/Bandit (honest timing), and lets you
// click any ranked finding straight into the vulnerable source. The spawning
// scanner fleet and the code are the two things worth watching.

import { useCallback, useEffect, useState } from 'react';
import type { ScanFinding } from './api';
import { usePipeline } from './usePipeline';
import { ConnectScreen } from './ConnectScreen';
import { ScanStrip } from './scan/ScanStrip';
import { FindingsList } from './review/FindingsList';
import { CodeViewer } from './review/CodeViewer';

export function PortalApp() {
  const pipeline = usePipeline();
  const { mode, phase, hardware, agents, findings, ranking, startScan, reset } = pipeline;
  const [selected, setSelected] = useState<ScanFinding | null>(null);

  // Open the top-ranked finding automatically once ranking lands.
  useEffect(() => {
    if (selected || findings.length === 0) return;
    const top = ranking.length ? findings.find((f) => f.id === ranking[0].findingId) : findings[0];
    if (top) setSelected(top);
  }, [findings, ranking, selected]);

  const onReset = useCallback(() => {
    setSelected(null);
    reset();
  }, [reset]);

  const working = phase === 'scanning' || phase === 'review';
  const statusWord = mode === 'connecting' ? 'connecting' : phase === 'scanning' ? 'scanning' : phase === 'review' ? 'review' : hardware.connected ? 'ready' : 'waiting';

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      {/* ---- top bar ---- */}
      <header className="flex items-center justify-between gap-4 px-5 py-3">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold tracking-tight">
            Pre<span className="text-brand">Vent</span>
          </span>
          <span className="flex items-center gap-2">
            <span className={`gem ${hardware.connected ? 'text-success' : 'text-text-muted'} ${phase === 'scanning' ? 'gem--live text-accent' : ''}`} style={{ width: 7, height: 7 }} />
            <span className="text-meta text-text-secondary">{statusWord}</span>
          </span>
          {hardware.connected && (
            <span className="hidden font-mono text-meta text-text-muted sm:inline">
              {hardware.board} <span className="text-text-muted">· {hardware.port}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {phase === 'review' && (
            <button type="button" onClick={startScan} className="press state-transition rounded-md bg-accent-bg px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-surface-3">
              Rescan
            </button>
          )}
          {working && (
            <button type="button" onClick={onReset} className="press state-transition rounded-md px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-2">
              Reset
            </button>
          )}
        </div>
      </header>

      {/* ---- body ---- */}
      {!working ? (
        <ConnectScreen pipeline={pipeline} onStart={startScan} />
      ) : (
        <main className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3">
          <ScanStrip agents={agents} mode={mode} />
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.6fr)]">
            <FindingsList
              findings={findings}
              ranking={ranking}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
              scanning={phase === 'scanning'}
            />
            {selected ? (
              <CodeViewer finding={selected} />
            ) : (
              <section className="panel grid-field flex min-h-0 flex-1 items-center justify-center">
                <p className="text-sm text-text-muted">
                  {phase === 'scanning' ? 'Findings open here as the agents report.' : 'Select a finding to view the vulnerable code.'}
                </p>
              </section>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
