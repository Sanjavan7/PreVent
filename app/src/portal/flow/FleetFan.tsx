// The spawned sub-agents that fan out beneath a phase (4 scanners under Scan,
// N authors under Generate). Each chip is its own agent with its own live state.

import type { FleetAgent } from '../types';
import { nodeStyle } from './nodeStyles';

function FleetChip({ agent }: { agent: FleetAgent }) {
  const s = nodeStyle(agent.state);
  const pulsing = agent.state === 'active';
  return (
    <div className={`panel state-transition border px-2.5 py-2 ${s.ring} ${s.glow}`}>
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot} ${pulsing ? 'animate-[pulseNode_1.6s_ease-in-out_infinite]' : ''}`}
        />
        <span className="font-mono text-meta font-medium text-text">{agent.label}</span>
      </div>
      <div className="mt-1 font-mono text-[11px] leading-tight text-text-muted">{agent.engine}</div>
      {agent.metric && (
        <div className={`mt-1 font-mono text-[11px] leading-tight ${agent.state === 'idle' ? 'text-text-muted' : s.text}`}>
          {agent.metric}
        </div>
      )}
    </div>
  );
}

export function FleetFan({ agents, active }: { agents: FleetAgent[]; active: boolean }) {
  return (
    <div className="flex w-full max-w-md flex-col items-center">
      {/* fan connector: a short stem that splits toward the chips */}
      <div
        className={`h-5 w-px state-transition ${active ? 'bg-wire-active' : 'bg-wire'}`}
        style={active ? { boxShadow: '0 0 8px -1px var(--color-wire-active)' } : undefined}
      />
      <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
        {agents.map((a) => (
          <FleetChip key={a.id} agent={a} />
        ))}
      </div>
    </div>
  );
}
