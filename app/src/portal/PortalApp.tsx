// PreVent — the security console. Real hardware -> real scan -> ranked findings
// that open the vulnerable code -> spawn one DeepSeek author agent per
// exploitable finding, shown as a clickable spatial graph.

import { useCallback, useEffect, useState } from 'react';
import type { ScanFinding } from './api';
import { usePipeline } from './usePipeline';
import { ConnectScreen } from './ConnectScreen';
import { ScanStrip } from './scan/ScanStrip';
import { FindingsList } from './review/FindingsList';
import { CodeViewer } from './review/CodeViewer';
import { AgentGraph } from './exploit/AgentGraph';
import { AgentDetail } from './exploit/AgentDetail';
import { buildGraph } from './exploit/graphModel';

export function PortalApp() {
  const pipeline = usePipeline();
  const { mode, phase, hardware, agents, findings, ranking, authorAgents, attack, startScan, startExploit, approveAndPatch, reset } = pipeline;

  const [selected, setSelected] = useState<ScanFinding | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Let the detail panel follow the key beats as the attack unfolds.
  useEffect(() => {
    if (attack.device === 'compromised') setSelectedNode('device');
    else if (attack.phase === 'awaiting_approval') setSelectedNode('factory');
    else if (attack.phase === 'verified') setSelectedNode('verify');
  }, [attack.device, attack.phase]);

  // Open the top-ranked finding automatically once ranking lands.
  useEffect(() => {
    if (selected || findings.length === 0) return;
    const top = ranking.length ? findings.find((f) => f.id === ranking[0].findingId) : findings[0];
    if (top) setSelected(top);
  }, [findings, ranking, selected]);

  // On entering the exploit phase, select the first author node by default.
  useEffect(() => {
    if (phase !== 'exploit') return;
    if (selectedNode) return;
    const first = buildGraph(authorAgents, attack).nodes.find((n) => n.kind === 'author');
    setSelectedNode(first?.id ?? 'deepseek');
  }, [phase, authorAgents, attack, selectedNode]);

  const onReset = useCallback(() => {
    setSelected(null);
    setSelectedNode(null);
    reset();
  }, [reset]);

  const working = phase !== 'connect' && phase !== 'ready';
  const statusWord =
    mode === 'connecting' ? 'connecting'
      : phase === 'scanning' ? 'scanning'
        : phase === 'review' ? 'review'
          : phase === 'exploit' ? 'exploiting'
            : hardware.connected ? 'ready' : 'waiting';

  const selNode = buildGraph(authorAgents, attack).nodes.find((n) => n.id === selectedNode) ?? null;

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      {/* ---- top bar ---- */}
      <header className="flex items-center justify-between gap-4 px-5 py-3">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold tracking-tight">
            Pre<span className="text-success">Vent</span>
          </span>
          <span className="flex items-center gap-2">
            <span className={`gem ${hardware.connected ? 'text-success' : 'text-text-muted'} ${phase === 'scanning' || phase === 'exploit' ? 'gem--live text-accent' : ''}`} style={{ width: 7, height: 7 }} />
            <span className="text-meta text-text-secondary">{statusWord}</span>
          </span>
          {hardware.connected && (
            <span className="hidden font-mono text-meta text-text-muted sm:inline">
              {hardware.board} <span className="text-text-muted">· {hardware.port}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {attack.phase === 'awaiting_approval' && (
            <button type="button" onClick={approveAndPatch} className="press state-transition glow-amber rounded-md bg-warn-bg px-3 py-1.5 text-sm font-medium text-warn-fg hover:bg-surface-3">
              Approve &amp; deploy patch
            </button>
          )}
          {phase === 'review' && (
            <button type="button" onClick={startExploit} className="press state-transition rounded-md bg-accent-bg px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-surface-3">
              Generate exploits
            </button>
          )}
          {phase === 'review' && (
            <button type="button" onClick={startScan} className="press state-transition rounded-md px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-2">
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
      ) : phase === 'exploit' ? (
        <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-3 pb-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
          <AgentGraph authors={authorAgents} attack={attack} selectedId={selectedNode} onSelect={setSelectedNode} />
          <AgentDetail node={selNode} findings={findings} attack={attack} />
        </main>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3">
          <ScanStrip agents={agents} mode={mode} />
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.6fr)]">
            <FindingsList findings={findings} ranking={ranking} selectedId={selected?.id ?? null} onSelect={setSelected} scanning={phase === 'scanning'} />
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
