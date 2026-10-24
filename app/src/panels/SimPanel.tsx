import { Suspense, lazy, useState } from 'react';
import type { DeviceStatus } from '@prevent/contracts';
import { PatientMonitor } from './pixi/PatientMonitor';
import { ErrorBoundary } from './three/ErrorBoundary';
import { is3dCapable } from './three/capability';

// The whole three/r3f/drei/postprocessing island is code-split here so it never
// enters first paint; it loads only when the viewer is in 3D mode.
const ICUScene3D = lazy(() => import('./three/ICUScene3D'));

// Left panel: patient monitor. Renders from the same device_status row as the
// dashboard and the Arduino. The banner follows REPORTED (alarmActive) state, so
// it stays green during the lie while the true vitals crash.
//
// The monitor surface has two modes:
//   - 2D: the PixiJS v8 <PatientMonitor /> (three waveform lanes scrolling
//     right-to-left; ECG/SpO2 follow REPORTED values so the device can lie,
//     respiration follows TRUE fanOn and flatlines when the ventilator stops).
//   - 3D: the cinematic ICU bedside scene (lazy-loaded). Falls back to the 2D
//     monitor on any failure (WebGL2 missing, GL error) via Suspense +
//     ErrorBoundary, and the 2D monitor doubles as the Suspense loading state.
// The mode defaults to 3D on capable desktops and 2D otherwise, and the
// viewer's explicit choice is persisted.

interface Props {
  device: DeviceStatus;
}

type MonitorMode = '2d' | '3d';
const MODE_STORAGE_KEY = 'prevent:simPanelMode';

function initialMode(): MonitorMode {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (stored === '2d' || stored === '3d') return stored;
  } catch {
    // localStorage unavailable (private mode, blocked) -- fall through.
  }
  return is3dCapable() ? '3d' : '2d';
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: MonitorMode;
  onChange: (next: MonitorMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Monitor view mode"
      className="inline-flex overflow-hidden rounded-md border border-border font-mono text-xs"
    >
      {(['2d', '3d'] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
          className={`prevent-transition px-2 py-1 uppercase tracking-wider ${
            mode === m
              ? 'bg-accent/20 text-accent'
              : 'text-muted hover:text-text'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

export function SimPanel({ device }: Props) {
  const bannerOk = !device.alarmActive;

  const [mode, setMode] = useState<MonitorMode>(initialMode);
  const changeMode = (next: MonitorMode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // persistence is best-effort; the choice still applies this session.
    }
  };

  return (
    <section
      aria-label="Patient monitor simulation"
      className="flex min-h-0 flex-col gap-4 border-b border-border p-5 lg:border-r lg:border-b-0"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Bedside monitor
        </h2>
        <div className="flex items-center gap-3">
          <ModeToggle mode={mode} onChange={changeMode} />
          <span className="font-mono text-xs text-muted">
            fan: {device.fanOn ? 'ON' : 'OFF'}
          </span>
        </div>
      </div>

      <div
        className={`prevent-transition rounded-lg px-4 py-2 text-center font-mono text-sm font-semibold ${
          bannerOk ? 'bg-ok/15 text-ok' : 'pulse bg-danger/20 text-danger'
        }`}
      >
        {bannerOk ? 'NORMAL' : 'ALARM'}
      </div>

      {mode === '3d' ? (
        <ErrorBoundary fallback={<PatientMonitor device={device} />}>
          <Suspense fallback={<PatientMonitor device={device} />}>
            <ICUScene3D
              device={device}
              fallback={<PatientMonitor device={device} />}
            />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <PatientMonitor device={device} />
      )}
    </section>
  );
}
