// Truth vs. reported — the lie, made visible. When the device is compromised,
// true vitals (red) diverge from what it reports (still "healthy" green) and the
// alarm stays silent. This is the whole point of the attack in one strip.

import type { TruthState } from '../types';

function Vital({ label, value, unit, tone }: { label: string; value: number; unit: string; tone: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-overline uppercase text-text-muted">{label}</span>
      <span className={`font-mono text-xl font-semibold tabular-nums ${tone}`}>
        {value}
        <span className="ml-0.5 text-meta font-normal text-text-muted">{unit}</span>
      </span>
    </div>
  );
}

export function TruthStrip({ truth }: { truth: TruthState }) {
  const lying = truth.lying;
  return (
    <section className={`panel overflow-hidden ${lying ? 'border-danger' : truth.compromised ? '' : 'border-success'}`}>
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-overline uppercase text-text-muted">Telemetry vs. reality</span>
        <span
          className={`rounded-sm px-1.5 py-0.5 text-overline uppercase ${lying ? 'bg-danger-bg text-danger-fg' : 'bg-success-bg text-success-fg'}`}
        >
          {lying ? 'device is lying' : 'match'}
        </span>
      </header>

      <div className="grid grid-cols-2 divide-x divide-border">
        <div className="flex flex-col gap-2 px-3 py-3">
          <span className="text-overline uppercase text-text-muted">True state</span>
          <div className="flex gap-5">
            <Vital label="HR" value={truth.trueHr} unit="bpm" tone={lying ? 'text-danger-fg' : 'text-text'} />
            <Vital label="SpO₂" value={truth.trueSpo2} unit="%" tone={lying ? 'text-danger-fg' : 'text-text'} />
          </div>
          <span className={`font-mono text-meta ${truth.fanOn ? 'text-success-fg' : 'text-danger-fg'}`}>
            fan {truth.fanOn ? 'ON' : 'OFF'}
          </span>
        </div>

        <div className="flex flex-col gap-2 px-3 py-3">
          <span className="text-overline uppercase text-text-muted">Reported</span>
          <div className="flex gap-5">
            <Vital label="HR" value={truth.reportedHr} unit="bpm" tone="text-success-fg" />
            <Vital label="SpO₂" value={truth.reportedSpo2} unit="%" tone="text-success-fg" />
          </div>
          <span className={`font-mono text-meta ${truth.alarmActive ? 'text-warn-fg' : lying ? 'text-danger-fg' : 'text-text-muted'}`}>
            alarm {truth.alarmActive ? 'ON' : 'SILENT'}
          </span>
        </div>
      </div>
    </section>
  );
}
