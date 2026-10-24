// The hero: the pipeline as a single connected trace of stations running top to
// bottom (mirrors the whiteboard sketch), with sub-agents fanning out beneath
// Scan and Generate as they spawn.

import { PHASE_ORDER } from '../types';
import type { PipelineModel } from '../types';
import { PhaseNode } from './PhaseNode';
import { FleetFan } from './FleetFan';

export function FlowCanvas({ model }: { model: PipelineModel }) {
  const byId = Object.fromEntries(model.phases.map((p) => [p.id, p]));

  return (
    <section className="panel panel--raised grid-field min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mx-auto max-w-xl">
        {PHASE_ORDER.map((id, i) => {
          const phase = byId[id];
          const next = PHASE_ORDER[i + 1];
          const connectBelow = i < PHASE_ORDER.length - 1;
          const belowActive = next ? byId[next].state !== 'idle' : false;

          const fan =
            id === 'scan' && phase.state !== 'idle' ? (
              <FleetFan agents={model.scanFleet} />
            ) : id === 'generate' && phase.state !== 'idle' ? (
              <FleetFan agents={model.authorFleet} />
            ) : undefined;

          return (
            <PhaseNode
              key={id}
              phase={phase}
              fan={fan}
              connectBelow={connectBelow}
              belowActive={belowActive}
            />
          );
        })}
      </div>
    </section>
  );
}
