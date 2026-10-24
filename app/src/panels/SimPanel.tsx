import type { DeviceStatus } from '@prevent/contracts';
import { PatientMonitor } from './pixi/PatientMonitor';

// Left panel: patient monitor. Renders from the same device_status row as the
// dashboard and the Arduino. The banner follows REPORTED (alarmActive) state, so
// it stays green during the lie while the true vitals crash.
//
// The <PatientMonitor /> below is a PixiJS v8 canvas: three waveform lanes
// (ECG, SpO2 pleth, respiration) scrolling right-to-left. ECG/SpO2 follow
// REPORTED values so the device can lie; respiration follows TRUE fanOn and
// flatlines when the ventilator stops.

interface Props {
  device: DeviceStatus;
}

function Vital({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: number;
  unit: string;
  tone: 'ok' | 'danger';
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="font-mono text-xs uppercase tracking-wider text-muted">
        {label}
      </div>
      <div
        className={`prevent-transition mt-1 font-mono text-5xl font-semibold ${
          tone === 'ok' ? 'text-ok' : 'text-danger'
        }`}
      >
        {value}
        <span className="ml-1 text-lg text-muted">{unit}</span>
      </div>
    </div>
  );
}

export function SimPanel({ device }: Props) {
  const lying =
    device.reportedHr !== device.trueHr ||
    device.reportedSpo2 !== device.trueSpo2;
  const bannerOk = !device.alarmActive;

  return (
    <section
      aria-label="Patient monitor simulation"
      className="flex min-h-0 flex-col gap-4 border-b border-border p-5 lg:border-r lg:border-b-0"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Bedside monitor
        </h2>
        <span className="font-mono text-xs text-muted">
          fan: {device.fanOn ? 'ON' : 'OFF'}
        </span>
      </div>

      <div
        className={`prevent-transition rounded-lg px-4 py-2 text-center font-mono text-sm font-semibold ${
          bannerOk ? 'bg-ok/15 text-ok' : 'pulse bg-danger/20 text-danger'
        }`}
      >
        {bannerOk ? 'NORMAL' : 'ALARM'}
      </div>

      <PatientMonitor device={device} />

      <div>
        <div className="mb-2 font-mono text-xs uppercase tracking-wider text-muted">
          Displayed (reported)
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Vital label="HR" value={device.reportedHr} unit="bpm" tone="ok" />
          <Vital label="SpO2" value={device.reportedSpo2} unit="%" tone="ok" />
        </div>
      </div>

      <div>
        <div className="mb-2 font-mono text-xs uppercase tracking-wider text-muted">
          Patient (true)
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Vital
            label="HR"
            value={device.trueHr}
            unit="bpm"
            tone={lying ? 'danger' : 'ok'}
          />
          <Vital
            label="SpO2"
            value={device.trueSpo2}
            unit="%"
            tone={lying ? 'danger' : 'ok'}
          />
        </div>
      </div>
    </section>
  );
}
