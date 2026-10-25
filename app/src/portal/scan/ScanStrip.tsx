// The scanner fleet at work — four real agents (Semgrep/Bandit × server/firmware)
// with honest, live timing. While an agent runs its timer ticks up; when it
// finishes it shows its real wall-clock duration and how many findings it
// returned. No millisecond fakery: this reflects what the scanners actually took.

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { ScanAgent } from '../usePipeline';
import { nodeStyle } from '../flow/nodeStyles';
import { staggerParent, revealChild, revealReduced } from '../../lib/motion';

function fmt(ms: number): string {
  return ms < 950 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function LiveTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 83);
    return () => clearInterval(id);
  }, []);
  return <span className="tabular-nums">{fmt(now - startedAt)}</span>;
}

function stateOf(a: ScanAgent) {
  if (a.state === 'running') return 'active' as const;
  if (a.state === 'done') return a.findingCount > 0 ? ('alert' as const) : ('done' as const);
  return 'idle' as const;
}

function AgentCard({ agent }: { agent: ScanAgent }) {
  const vstate = stateOf(agent);
  const s = nodeStyle(vstate);
  return (
    <div
      className={`state-transition flex-1 rounded-[var(--radius-lg)] border border-glass-border bg-glass-bg px-3.5 py-3 backdrop-blur-[14px] [box-shadow:var(--shadow-md)] ${
        vstate === 'active' ? 'glow-teal' : vstate === 'alert' ? 'glow-red' : vstate === 'done' ? 'ring-1 ring-success/30' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className={`flex items-center gap-1.5 ${s.gem}`}>
          <span className={`gem ${s.live ? 'gem--live' : ''}`} style={{ width: 7, height: 7 }} />
          <span className="font-mono text-sm font-medium capitalize text-text">{agent.tool}</span>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-text-muted">
          {agent.state === 'running' && agent.startedAt ? (
            <LiveTimer startedAt={agent.startedAt} />
          ) : agent.durationMs != null ? (
            fmt(agent.durationMs)
          ) : (
            '—'
          )}
        </span>
      </div>
      <div className="mt-1 font-mono text-[11px] text-text-muted">
        {agent.target} · {agent.language}
      </div>
      <div className={`mt-1.5 font-mono text-[11px] ${agent.state !== 'done' ? 'text-text-muted' : s.text}`}>
        {agent.state === 'idle'
          ? 'queued'
          : agent.state === 'running'
            ? 'reading source…'
            : agent.findingCount === 0
              ? 'clean'
              : `${agent.findingCount} finding${agent.findingCount > 1 ? 's' : ''}`}
      </div>
    </div>
  );
}

export function ScanStrip({ agents, mode }: { agents: ScanAgent[]; mode: 'live' | 'sim' | 'connecting' }) {
  const reduce = !!useReducedMotion();
  const child = reduce ? revealReduced : revealChild;
  const done = agents.filter((a) => a.state === 'done').length;
  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between px-1">
        <span className="flex items-baseline gap-2">
          <span className="font-display text-lg font-normal text-text">Scanner fleet</span>
          <span className="text-meta text-text-muted">{done}/{agents.length} complete</span>
        </span>
        <span className="rounded-pill bg-surface-2 px-2.5 py-1 font-mono text-meta text-text-muted">
          {mode === 'live' ? 'live scan' : 'simulated scan'}
        </span>
      </div>
      <motion.div
        className="flex flex-col gap-2.5 sm:flex-row"
        variants={staggerParent}
        initial="hidden"
        animate="show"
      >
        {agents.map((a) => (
          <motion.div key={a.id} variants={child} className="flex-1">
            <AgentCard agent={a} />
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
