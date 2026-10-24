// The hero: the pipeline as a vertical flow of phases (mirrors the whiteboard
// sketch), with sub-agents fanning out beneath Scan and Generate as they spawn.

import type { PipelineModel } from '../types';
import { PhaseNode } from './PhaseNode';
import { FleetFan } from './FleetFan';

function Wire({ active }: { active: boolean }) {
  return (
    <div
      className={`h-6 w-px state-transition ${active ? 'bg-wire-active' : 'bg-wire'}`}
      style={active ? { boxShadow: '0 0 8px -1px var(--color-wire-active)' } : undefined}
      aria-hidden
    />
  );
}

export function FlowCanvas({ model }: { model: PipelineModel }) {
  const byId = Object.fromEntries(model.phases.map((p) => [p.id, p]));
  const scanOn = byId.scan.state !== 'idle';
  const genOn = byId.generate.state !== 'idle';

  return (
    <div className="grid-field flex min-h-0 flex-1 flex-col items-center gap-0 overflow-y-auto rounded-md border border-border p-6">
      {/* ground */}
      <PhaseNode phase={byId.ground} />
      <Wire active={byId.scan.state !== 'idle'} />

      {/* scan + its 4-agent fan */}
      <PhaseNode phase={byId.scan} />
      {scanOn && <FleetFan agents={model.scanFleet} active={byId.scan.state === 'active'} />}
      <Wire active={byId.rank.state !== 'idle'} />

      {/* rank */}
      <PhaseNode phase={byId.rank} />
      <Wire active={byId.generate.state !== 'idle'} />

      {/* generate + its N-agent fan */}
      <PhaseNode phase={byId.generate} />
      {genOn && <FleetFan agents={model.authorFleet} active={byId.generate.state === 'active'} />}
      <Wire active={byId.deliver.state !== 'idle'} />

      {/* deliver (the compromise beat) */}
      <PhaseNode phase={byId.deliver} />
      <Wire active={byId.blueteam.state !== 'idle'} />

      {/* blue team (human gate) */}
      <PhaseNode phase={byId.blueteam} />
      <Wire active={byId.verify.state !== 'idle'} />

      {/* verify (the payoff) */}
      <PhaseNode phase={byId.verify} />
    </div>
  );
}
