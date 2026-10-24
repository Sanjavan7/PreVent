// A station on the pipeline trace: a status gem in the rail column with the
// trace running down from it to the next station, and the phase's content
// beside it (optionally hosting a fan of spawned sub-agents). The active phase
// lifts onto a raised surface; completed and idle phases sit flat.

import type { ReactNode } from 'react';
import type { PhaseNode as PhaseNodeModel } from '../types';
import { nodeStyle, STATE_WORD } from './nodeStyles';

interface Props {
  phase: PhaseNodeModel;
  fan?: ReactNode;
  connectBelow: boolean;
  belowActive: boolean;
}

export function PhaseNode({ phase, fan, connectBelow, belowActive }: Props) {
  const s = nodeStyle(phase.state);
  const showMeter =
    typeof phase.confidence === 'number' && phase.state !== 'idle' && phase.state !== 'done';

  return (
    <div className="grid grid-cols-[18px_1fr] gap-x-3">
      {/* rail column: gem at the top, trace filling down to the next station */}
      <div className="flex flex-col items-center">
        <div className={`pt-3.5 ${s.gem}`}>
          <span className={`gem ${s.live ? 'gem--live' : ''}`} />
        </div>
        {connectBelow && (
          <div className={`mt-1.5 w-0.5 flex-1 trace ${belowActive ? 'trace--active' : ''}`} />
        )}
      </div>

      {/* content */}
      <div className="pb-5">
        <div className={`state-transition rounded-lg px-3.5 py-3 ${s.surface}`}>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="flex items-baseline gap-2">
              <span className="text-base font-semibold tracking-tight text-text">{phase.label}</span>
              <span className="text-meta text-text-muted">{phase.caption}</span>
            </h3>
            <span className={`shrink-0 text-meta ${s.text}`}>{STATE_WORD[phase.state]}</span>
          </div>

          {phase.agentName && (
            <div className="mt-1 flex items-center gap-2 font-mono text-meta">
              <span className={s.text}>{phase.agentName}</span>
              {phase.spawnCount ? <span className="text-text-muted">spawned {phase.spawnCount}</span> : null}
            </div>
          )}

          {phase.detail && (
            <p className="mt-1.5 max-w-prose text-sm leading-snug text-text-secondary">{phase.detail}</p>
          )}

          {showMeter && (
            <div className="mt-2.5 flex items-center gap-2.5">
              <div className="h-0.5 flex-1 overflow-hidden rounded-pill bg-surface-2">
                <div
                  className={`h-full rounded-pill ${phase.state === 'alert' ? 'bg-danger' : phase.state === 'waiting' ? 'bg-warn' : 'bg-accent'}`}
                  style={{
                    width: `${Math.round((phase.confidence ?? 0) * 100)}%`,
                    transition: 'width 280ms cubic-bezier(0.23,1,0.32,1)',
                  }}
                />
              </div>
              <span className="font-mono text-[11px] tabular-nums text-text-muted">
                {Math.round((phase.confidence ?? 0) * 100)}%
              </span>
            </div>
          )}
        </div>

        {fan}
      </div>
    </div>
  );
}
