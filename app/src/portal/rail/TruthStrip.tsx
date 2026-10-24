// Truth vs. reported — the lie made visible. When the device is compromised,
// true vitals (red) diverge from what it reports (still "healthy" green) while
// the alarm stays silent. Numbers animate so the divergence reads as it happens.

import NumberFlow from '@number-flow/react';
import type { TruthState } from '../types';

function Vital({ label, value, unit, tone }: { label: string; value: number; unit: string; tone: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-meta text-text-muted">{label}</span>
      <span className={`font-mono text-xl font-semibold tabular-nums ${tone}`}>
        <NumberFlow value={value} />
        <span className="ml-0.5 text-meta font-normal text-text-muted">{unit}</span>
      </span>
    </div>
  );
}

export function TruthStrip({ truth }: { truth: TruthState }) {
  const lying = truth.lying;
  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center justify-between px-3.5 py-2.5">
        <span className="text-sm font-medium text-text-secondary">Telemetry vs. reality</span>
        <span className={`state-transition text-meta font-medium ${lying ? 'text-danger-fg' : 'text-success-fg'}`}>
          {lying ? 'device is lying' : 'in sync'}
        </span>
      </header>

      <div className="grid grid-cols-2">
        <div className="flex flex-col gap-2.5 border-t border-border px-3.5 py-3">
          <span className="text-meta text-text-muted">True state</span>
          <div className="flex gap-5">
            <Vital label="HR" value={truth.trueHr} unit="bpm" tone={lying ? 'text-danger-fg' : 'text-text'} />
            <Vital label="SpO₂" value={truth.trueSpo2} unit="%" tone={lying ? 'text-danger-fg' : 'text-text'} />
          </div>
          <span className={`font-mono text-meta ${truth.fanOn ? 'text-success-fg' : 'text-danger-fg'}`}>
            fan {truth.fanOn ? 'running' : 'stopped'}
          </span>
        </div>

        <div className="flex flex-col gap-2.5 border-l border-t border-border px-3.5 py-3">
          <span className="text-meta text-text-muted">Reported to monitor</span>
          <div className="flex gap-5">
            <Vital label="HR" value={truth.reportedHr} unit="bpm" tone="text-success-fg" />
            <Vital label="SpO₂" value={truth.reportedSpo2} unit="%" tone="text-success-fg" />
          </div>
          <span className={`font-mono text-meta ${truth.alarmActive ? 'text-warn-fg' : lying ? 'text-danger-fg' : 'text-text-muted'}`}>
            alarm {truth.alarmActive ? 'sounding' : 'silent'}
          </span>
        </div>
      </div>
    </section>
  );
}
