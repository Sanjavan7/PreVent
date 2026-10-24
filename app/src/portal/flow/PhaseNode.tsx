// A single pipeline phase in the vertical flow. The node carries its live
// state color, the agent driving it, a confidence meter, and the latest line.

import type { PhaseNode as PhaseNodeModel } from '../types';
import { nodeStyle, STATE_LABEL } from './nodeStyles';

export function PhaseNode({ phase }: { phase: PhaseNodeModel }) {
  const s = nodeStyle(phase.state);
  const pulsing = phase.state === 'active';

  return (
    <div
      className={`panel state-transition relative w-full max-w-md border px-4 py-3 ${s.ring} ${s.glow}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${s.dot} ${pulsing ? 'animate-[pulseNode_1.6s_ease-in-out_infinite]' : ''}`}
          />
          <span className="text-base font-semibold tracking-tight">{phase.label}</span>
          <span className="text-meta text-text-muted">{phase.caption}</span>
        </div>
        <span className={`rounded-sm px-1.5 py-0.5 text-overline uppercase ${s.chip}`}>
          {STATE_LABEL[phase.state]}
        </span>
      </div>

      {(phase.agentName || phase.spawnCount) && (
        <div className="mt-1.5 flex items-center gap-2 font-mono text-meta text-text-secondary">
          {phase.agentName && <span className={s.text}>{phase.agentName}</span>}
          {phase.spawnCount ? (
            <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-text-muted">
              {phase.spawnCount} agents
            </span>
          ) : null}
        </div>
      )}

      {phase.detail && (
        <p className="mt-1.5 text-sm leading-snug text-text-secondary">{phase.detail}</p>
      )}

      {typeof phase.confidence === 'number' && phase.state !== 'idle' && (
        <div className="mt-2.5 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-pill bg-surface-2">
            <div
              className={`h-full rounded-pill ${phase.state === 'alert' ? 'bg-danger' : phase.state === 'waiting' ? 'bg-warn' : phase.state === 'done' ? 'bg-success' : 'bg-accent'}`}
              style={{ width: `${Math.round(phase.confidence * 100)}%`, transition: 'width 360ms cubic-bezier(0.22,1,0.36,1)' }}
            />
          </div>
          <span className="font-mono text-meta tabular-nums text-text-muted">
            {Math.round(phase.confidence * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}
