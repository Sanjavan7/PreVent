// Sub-agents that branch off the trace when a phase spawns them (4 scanners
// under Scan, N authors under Generate). Each chip is its own live agent; they
// enter staggered so the spawn reads as a fan-out, not a pop-in.

import type { FleetAgent } from '../types';
import { nodeStyle } from './nodeStyles';

function FleetChip({ agent, index }: { agent: FleetAgent; index: number }) {
  const s = nodeStyle(agent.state);
  return (
    <div
      className={`animate-enter state-transition rounded-md px-2.5 py-2 ${agent.state === 'idle' ? 'bg-surface-2' : 'panel panel--raised'}`}
      style={{ animationDelay: `${index * 55}ms` }}
    >
      <div className={`flex items-center gap-1.5 ${s.gem}`}>
        <span className={`gem ${s.live ? 'gem--live' : ''}`} style={{ width: 7, height: 7 }} />
        <span className="truncate font-mono text-[12px] font-medium text-text">{agent.label}</span>
      </div>
      <div className="mt-1 truncate font-mono text-[11px] leading-tight text-text-muted">{agent.engine}</div>
      {agent.metric && (
        <div className={`mt-0.5 truncate font-mono text-[11px] leading-tight ${agent.state === 'idle' ? 'text-text-muted' : s.text}`}>
          {agent.metric}
        </div>
      )}
    </div>
  );
}

export function FleetFan({ agents }: { agents: FleetAgent[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
      {agents.map((a, i) => (
        <FleetChip key={a.id} agent={a} index={i} />
      ))}
    </div>
  );
}
