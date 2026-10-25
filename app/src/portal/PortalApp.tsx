// PreVent — the security console. Real hardware → real scan → ranked findings
// that open the vulnerable code → a TWO-STAGE attack shown as a clickable graph:
// DeepSeek curates the server exploit (live reasoning) → breach the server over
// HTTP → curate the fan exploit → flash the real board. Click any agent to watch.

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

const STAGE_WORD: Record<string, string> = {
  curating_server: 'curating server exploit',
  server_ready: 'server exploit ready',
  breaching_server: 'breaching server',
  server_breached: 'server breached',
  curating_fan: 'curating fan exploit',
  fan_ready: 'fan exploit ready',
  flashing_fan: 'flashing the board',
  fan_breached: 'fan stopped',
  patching: 'Droid writing the fix',
  reviewing: 'reviewer auditing the diff',
  awaiting_approval: 'awaiting your approval',
  applying: 'deploying the fix',
  verifying: 're-running the exploit',
  verified: 'exploit blocked — 401',
  patch_failed: 'patch did not hold',
  patch_rejected: 'patch rejected',
};

export function PortalApp() {
  const pipeline = usePipeline();
  const { mode, phase, hardware, agents, findings, ranking, authorAgents, exploitStage, serverBreach, fanBreach, patchAgent, reviewAgent, approved, verifyResult, startScan, startExploit, sendToServer, sendToFan, startPatch, approve, reject, reset } = pipeline;

  const [selected, setSelected] = useState<ScanFinding | null>(null);
  const [selectedNode, setSelectedNode] = useState<string>('author-server');

  useEffect(() => {
    if (selected || findings.length === 0) return;
    const top = ranking.length ? findings.find((f) => f.id === ranking[0].findingId) : findings[0];
    if (top) setSelected(top);
  }, [findings, ranking, selected]);

  // Follow the two-stage attack, then the remediation beats.
  useEffect(() => {
    if (exploitStage === 'curating_server') setSelectedNode('author-server');
    else if (exploitStage === 'server_breached') setSelectedNode('server');
    else if (exploitStage === 'curating_fan') setSelectedNode('author-fan');
    else if (exploitStage === 'fan_breached') setSelectedNode('fan');
    else if (exploitStage === 'patching') setSelectedNode('writer');
    else if (exploitStage === 'reviewing' || exploitStage === 'awaiting_approval') setSelectedNode('reviewer');
    else if (exploitStage === 'verifying' || exploitStage === 'verified' || exploitStage === 'patch_failed') setSelectedNode('verify');
  }, [exploitStage]);

  const onReset = useCallback(() => {
    setSelected(null);
    setSelectedNode('author-server');
    reset();
  }, [reset]);

  const working = phase !== 'connect' && phase !== 'ready';
  const statusWord =
    mode === 'connecting' ? 'connecting'
      : phase === 'exploit' ? (STAGE_WORD[exploitStage] ?? 'exploiting')
        : phase === 'scanning' ? 'scanning'
          : phase === 'review' ? 'review'
            : hardware.connected ? 'ready' : 'waiting';

  const selNode = buildGraph(authorAgents, exploitStage, serverBreach, fanBreach, { writer: patchAgent, reviewer: reviewAgent, verify: verifyResult }).nodes.find((n) => n.id === selectedNode) ?? null;
  const live = exploitStage === 'curating_server' || exploitStage === 'curating_fan' || exploitStage === 'breaching_server' || exploitStage === 'flashing_fan' || exploitStage === 'patching' || exploitStage === 'reviewing' || exploitStage === 'verifying';

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      {working && (
      <header className="flex items-center justify-between gap-4 px-5 py-3">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold tracking-tight">Pre<span className="text-accent">Vent</span></span>
          <span className="flex items-center gap-2">
            <span className={`gem ${hardware.connected ? 'text-success' : 'text-text-muted'} ${phase === 'scanning' || live ? 'gem--live text-accent' : ''}`} style={{ width: 7, height: 7 }} />
            <span className="text-meta text-text-secondary">{statusWord}</span>
          </span>
          {hardware.connected && (
            <span className="hidden font-mono text-meta text-text-muted sm:inline">
              {hardware.board} <span className="text-text-muted">· {hardware.port}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {exploitStage === 'server_ready' && (
            <button type="button" onClick={sendToServer} className="press state-transition rounded-md bg-accent-bg px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-surface-3">
              Send to server
            </button>
          )}
          {exploitStage === 'fan_ready' && (
            <button type="button" onClick={sendToFan} className="press state-transition glow-red rounded-md bg-danger-bg px-3 py-1.5 text-sm font-medium text-danger-fg hover:bg-surface-3">
              Send to fan — flash board
            </button>
          )}
          {exploitStage === 'fan_breached' && (
            <button type="button" onClick={startPatch} className="press state-transition rounded-md bg-accent-bg px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-surface-3">
              Generate fix (Droid)
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
      )}

      {!working ? (
        <ConnectScreen pipeline={pipeline} onStart={startScan} />
      ) : phase === 'exploit' ? (
        <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-3 pb-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(340px,1fr)]">
          <AgentGraph authors={authorAgents} stage={exploitStage} serverBreach={serverBreach} fanBreach={fanBreach} patchAgent={patchAgent} reviewAgent={reviewAgent} verifyResult={verifyResult} selectedId={selectedNode} onSelect={setSelectedNode} />
          <AgentDetail node={selNode} findings={findings} serverBreach={serverBreach} fanBreach={fanBreach} stage={exploitStage} approved={approved} onApprove={approve} onReject={reject} />
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
                <p className="text-sm text-text-muted">{phase === 'scanning' ? 'Findings open here as the agents report.' : 'Select a finding to view the vulnerable code.'}</p>
              </section>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
