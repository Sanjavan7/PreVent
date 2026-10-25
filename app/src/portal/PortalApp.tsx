// PreVent — the security console. Real hardware → real scan → ranked findings
// that open the vulnerable code → a PARALLEL attack shown as a clickable graph:
// DeepSeek opens ONE conversation per finding (all at once), each reaching its
// own exploitable-or-not verdict. The operator then picks an exploitable finding
// and a route (breach the server over HTTP, or flash the real board), then runs
// the Factory patch → approval → verify. Click any agent to watch it work.

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
import { ArrowCircle } from './icons/ArrowCircle';

const STAGE_WORD: Record<string, string> = {
  curating: 'DeepSeek curating (parallel)',
  ready: 'exploits ready — pick one',
  breaching: 'running the exploit',
  breached: 'target breached',
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
  const {
    mode, phase, hardware, agents, scanSource, activeRepo, findings, ranking,
    authorAgents, exploitStage, chosenFindingId, chosenRoute, patchParentFindingId,
    serverBreach, fanBreach, patchAgent, reviewAgent, approved, verifyResult,
    startScan, startExploit, chooseFinding, chooseRoute, runExploit, startPatch, approve, reject, reset,
  } = pipeline;

  const [selected, setSelected] = useState<ScanFinding | null>(null);
  const [selectedNode, setSelectedNode] = useState<string>('deepseek');

  useEffect(() => {
    if (selected || findings.length === 0) return;
    const top = ranking.length ? findings.find((f) => f.id === ranking[0].findingId) : findings[0];
    if (top) setSelected(top);
  }, [findings, ranking, selected]);

  // The exploitable findings the operator can run (the ones DeepSeek proved out).
  const exploitableAuthors = authorAgents.filter((a) => a.verdict?.exploitable || a.command);

  // Follow the parallel attack, then the remediation beats.
  useEffect(() => {
    if (exploitStage === 'curating') setSelectedNode((prev) => (prev.startsWith('author-') ? prev : `author-${authorAgents[0]?.findingId ?? ''}`));
    else if (exploitStage === 'ready') setSelectedNode(chosenFindingId != null ? `author-${chosenFindingId}` : `author-${exploitableAuthors[0]?.findingId ?? authorAgents[0]?.findingId ?? ''}`);
    else if (exploitStage === 'breaching' || exploitStage === 'breached') setSelectedNode(chosenRoute === 'fan' ? 'fan' : 'server');
    else if (exploitStage === 'patching') setSelectedNode('writer');
    else if (exploitStage === 'reviewing' || exploitStage === 'awaiting_approval') setSelectedNode('reviewer');
    else if (exploitStage === 'verifying' || exploitStage === 'verified' || exploitStage === 'patch_failed') setSelectedNode('verify');
  }, [exploitStage, chosenFindingId, chosenRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  const onReset = useCallback(() => {
    setSelected(null);
    setSelectedNode('deepseek');
    reset();
  }, [reset]);

  const working = phase !== 'connect' && phase !== 'ready';
  const statusWord =
    mode === 'connecting' ? 'connecting'
      : phase === 'exploit' ? (STAGE_WORD[exploitStage] ?? 'exploiting')
        : phase === 'scanning' ? 'scanning'
          : phase === 'review' ? 'review'
            : hardware.connected ? 'ready' : 'waiting';

  const selNode = buildGraph(authorAgents, exploitStage, serverBreach, fanBreach, {
    chosenFindingId, chosenRoute, patchParentFindingId,
    writer: patchAgent, reviewer: reviewAgent, verify: verifyResult,
  }).nodes.find((n) => n.id === selectedNode) ?? null;
  const live = exploitStage === 'curating' || exploitStage === 'breaching' || exploitStage === 'patching' || exploitStage === 'reviewing' || exploitStage === 'verifying';

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-glass-border bg-glass-bg px-5 py-2.5 backdrop-blur-[14px] [box-shadow:0_1px_0_0_rgba(255,255,255,0.7),0_1px_12px_-6px_rgba(10,40,38,0.12)]">
        <div className="flex items-center gap-3">
          <span className="font-display text-[19px] font-normal tracking-[-0.01em] text-text">Pre<span className="text-accent">Vent</span></span>
          <span className="flex items-center gap-2 rounded-pill border border-glass-border bg-glass-bg px-2.5 py-1 backdrop-blur-[14px]">
            <span className={`gem ${hardware.connected ? 'text-success' : 'text-text-muted'} ${phase === 'scanning' || live ? 'gem--live text-accent' : ''}`} style={{ width: 7, height: 7 }} />
            <span className="text-meta capitalize text-text-secondary">{statusWord}</span>
          </span>
          {hardware.connected && (
            <span className="hidden rounded-pill bg-surface-2 px-2.5 py-1 font-mono text-meta text-text-muted sm:inline">
              {hardware.board} <span className="opacity-60">· {hardware.port}</span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {phase === 'review' && scanSource !== 'repo' && (
            <button type="button" onClick={startExploit} className="btn btn--primary animate-enter group px-4 py-1.5 text-sm">
              Generate exploits
              <ArrowCircle size={16} className="transition-transform group-hover:translate-x-0.5" />
            </button>
          )}

          {/* Ready: pick an exploitable finding + a route, then run it. */}
          {exploitStage === 'ready' && (
            exploitableAuthors.length === 0 ? (
              <span className="animate-enter font-mono text-meta text-text-muted">no exploitable findings — DeepSeek cleared them all</span>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5 animate-enter">
                <span className="font-mono text-meta text-text-muted">exploit</span>
                {exploitableAuthors.map((a) => (
                  <button
                    key={a.findingId}
                    type="button"
                    onClick={() => chooseFinding(a.findingId)}
                    className={`press rounded-pill border px-2.5 py-1 font-mono text-meta state-transition ${chosenFindingId === a.findingId ? 'border-accent bg-surface-2 text-accent-fg' : 'border-glass-border text-text-secondary hover:bg-surface-2'}`}
                  >
                    {a.file.split('/').pop()}
                  </button>
                ))}
                <span className="mx-1 h-4 w-px bg-border" />
                <span className="font-mono text-meta text-text-muted">via</span>
                {(['server', 'fan'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => chooseRoute(r)}
                    className={`press rounded-pill border px-2.5 py-1 font-mono text-meta state-transition ${chosenRoute === r ? 'border-accent bg-surface-2 text-accent-fg' : 'border-glass-border text-text-secondary hover:bg-surface-2'}`}
                  >
                    {r === 'server' ? 'server · HTTP' : 'fan · flash'}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={runExploit}
                  disabled={chosenFindingId == null}
                  className="btn btn--danger group ml-1 px-4 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Run exploit
                  <ArrowCircle size={16} className="transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>
            )
          )}

          {exploitStage === 'breached' && (
            <button type="button" onClick={startPatch} className="btn btn--primary animate-enter group px-4 py-1.5 text-sm">
              Push patch (Factory)
              <ArrowCircle size={16} className="transition-transform group-hover:translate-x-0.5" />
            </button>
          )}

          {phase === 'review' && (
            <button type="button" onClick={() => startScan(scanSource === 'repo' ? activeRepo ?? undefined : undefined)} className="btn btn--ghost px-4 py-1.5 text-sm">
              Rescan
            </button>
          )}
          {working && (
            <button type="button" onClick={onReset} className="btn btn--ghost px-4 py-1.5 text-sm">
              Reset
            </button>
          )}
        </div>
      </header>

      {!working ? (
        <ConnectScreen pipeline={pipeline} onStart={startScan} />
      ) : phase === 'exploit' ? (
        <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-3 pb-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(340px,1fr)]">
          <AgentGraph
            authors={authorAgents}
            stage={exploitStage}
            chosenFindingId={chosenFindingId}
            chosenRoute={chosenRoute}
            patchParentFindingId={patchParentFindingId}
            serverBreach={serverBreach}
            fanBreach={fanBreach}
            patchAgent={patchAgent}
            reviewAgent={reviewAgent}
            verifyResult={verifyResult}
            selectedId={selectedNode}
            onSelect={setSelectedNode}
          />
          <AgentDetail node={selNode} findings={findings} serverBreach={serverBreach} fanBreach={fanBreach} stage={exploitStage} approved={approved} onApprove={approve} onReject={reject} />
        </main>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3">
          <ScanStrip agents={agents} mode={mode} />
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.6fr)]">
            <FindingsList findings={findings} ranking={ranking} selectedId={selected?.id ?? null} onSelect={setSelected} scanning={phase === 'scanning'} />
            {selected ? (
              <CodeViewer finding={selected} repo={scanSource === 'repo'} />
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
