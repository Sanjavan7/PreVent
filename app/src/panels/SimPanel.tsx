import { Suspense, lazy, useState } from 'react';
import type { DeviceStatus } from '@prevent/contracts';
import { PatientMonitor } from './pixi/PatientMonitor';
import { ErrorBoundary } from './three/ErrorBoundary';
import { is3dCapable } from './three/capability';

// The whole three/r3f/drei/postprocessing island is code-split here so it never
// enters first paint; it loads only when the viewer is in 3D mode.
const ICUScene3D = lazy(() => import('./three/ICUScene3D'));

// Left panel: the ward view. Renders from the same device_status row as the
// dashboard and the Arduino -> the three surfaces can never desync.
//   - 3D (default on capable desktops): the bright cutaway ICU ward — rooms,
//     people, and the judge as the patient in one gently-lit room.
//   - 2D fallback: the PixiJS waveform monitor (also the Suspense loading state
//     and the WebGL-failure fallback).
// The scene itself carries the state (the judge's room warms on compromise), so
// this frame stays calm: a slim label + the 2D/3D toggle, then the scene fills
// the rest of the card.

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
      className="inline-flex overflow-hidden rounded-sm border border-border text-meta"
    >
      {(['3d', '2d'] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
          className={`state-transition px-2.5 py-1 uppercase tracking-wide ${
            mode === m
              ? 'bg-accent-bg text-accent-fg'
              : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

export function SimPanel({ device }: Props) {
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
      aria-label="Patient ward"
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-overline uppercase text-text-muted">Patient ward</h2>
          <span className="text-meta text-text-muted">· room 2 · you</span>
        </div>
        <ModeToggle mode={mode} onChange={changeMode} />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col p-3">
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
      </div>
    </section>
  );
}
