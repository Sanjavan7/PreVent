// Hospital Simulation — the standalone "is the patient alive" page
// (sim.html, "/sim.html"). Full-bleed 3D ward for the second demo laptop.
//
// The whole page IS the scene: ICUScene3D fills the viewport (the bright
// cutaway ward owns its own state — the judge's room warms on compromise and
// the patient stops breathing on attack, resumes on fix). Chrome is minimal: a
// small corner "you are here" label, and — in MOCK mode only — a small
// Simulate/Reset toggle so this page can be driven standalone during testing.
// In LIVE mode both pages subscribe to the same SpacetimeDB device row, so the
// real mask hardware drives this ward and the Command Center in lockstep.
//
// Stream B is upgrading the scene internals (room focus, breathing patient,
// the 3D "you are here" arrow) in parallel; this page only mounts ICUScene3D —
// it never edits three/.

import { Suspense, lazy, useState } from 'react';
import { PatientMonitor } from '../panels/pixi/PatientMonitor';
import { ErrorBoundary } from '../panels/three/ErrorBoundary';
import { useRealtime } from '../realtime/useRealtime';

// The three/r3f/drei/postprocessing island is code-split out of the sim entry
// so the heavy 3D bundle (~1.5MB) streams in behind the instant 2D Pixi monitor
// instead of a blank viewport — same proven pattern as SimPanel. The Pixi
// monitor is the Suspense loading state, the WebGL-failure fallback (inside
// ICUScene3D) AND the ErrorBoundary fallback if the Canvas throws.
const ICUScene3D = lazy(() => import('../panels/three/ICUScene3D'));

export function HospitalSim() {
  const rt = useRealtime();
  // First pointer-down on the ward dismisses the "click a room" hint. The focus
  // selection itself lives inside the Canvas scene; this is the page-level signal
  // that the viewer has started interacting, which is all the hint needs.
  const [interacted, setInteracted] = useState(false);

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden bg-bg"
      onPointerDown={() => setInteracted(true)}
    >
      {/* Full-bleed bright ward. ICUScene3D owns its WebGL guard, internal
          ErrorBoundary and asset Suspense, and fills the flex-1 slot. The outer
          ErrorBoundary + Suspense (defense in depth, matching SimPanel) cover
          the lazy-chunk load and any Canvas throw; we pass the 2D Pixi monitor
          as every fallback so the viewer always lands on the waveform monitor
          instead of a blank page — no WebGL2, slow network, or a GL throw. */}
      <ErrorBoundary fallback={<PatientMonitor device={rt.device} />}>
        <Suspense fallback={<PatientMonitor device={rt.device} />}>
          <ICUScene3D
            device={rt.device}
            fallback={<PatientMonitor device={rt.device} />}
          />
        </Suspense>
      </ErrorBoundary>

      {/* "You are here" corner chrome — the only standing labels: the locator,
          a source caption (mock/live), and a one-time "click a room" hint that
          fades after the first interaction. */}
      <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-1.5">
        <div className="rounded-sm border border-border/60 bg-surface-2/80 px-3 py-1.5 text-meta text-text-secondary backdrop-blur-sm">
          Patient Ward · Room 202 · <span className="text-text">You</span>
          <span className="ml-2 text-text-muted">source: {rt.mode}</span>
        </div>
        <div
          className={`self-start rounded-sm px-3 py-1 text-meta text-text-muted transition-opacity duration-500 ${
            interacted ? 'opacity-0' : 'opacity-100'
          }`}
        >
          Click a room to focus
        </div>
      </div>

      {/* Mock-only standalone control: this page can drive its own pipeline. */}
      {rt.mode === 'mock' && (
        <button
          type="button"
          onClick={() => rt.setMockExploited(!rt.mockExploited)}
          className="state-transition absolute right-4 top-4 rounded-sm bg-accent px-3 py-1 text-meta font-medium text-white hover:bg-accent-hover"
        >
          {rt.mockExploited ? 'Reset to healthy' : 'Simulate exploit'}
        </button>
      )}
    </div>
  );
}
