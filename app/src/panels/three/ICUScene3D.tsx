// Lazy entry point for the cinematic 3D ICU bedside scene (the LEFT panel).
//
// This module and everything it imports (three / r3f / drei / postprocessing)
// is code-split out of the first paint via React.lazy in SimPanel, so none of
// the ~500-700KB 3D bundle loads until the viewer opts into 3D.
//
// Owns the <Canvas>, the WebGL2 guard, the internal ErrorBoundary, and the
// reduced-motion policy. The live `device` prop is written into a ref every
// render and exposed to the (memoized) <Scene> through a STABLE getDevice
// accessor, so SimPanel's per-tick re-renders never reconcile the scene subtree
// -- the single DeviceDriver useFrame reads the device through that ref.
//
// Reduced motion: when the OS asks for it we switch the Canvas to frameloop
// "demand" and invalidate once per device change (so the scene still reflects
// the truth, just without continuous motion) and tell DeviceDriver to hold the
// bellows, stop the camera orbit and flatten the alarm strobe.
//
// Guards, innermost to outermost:
//   - WebGL2 capability check  -> render the 2D fallback (parent degrades).
//   - internal <ErrorBoundary> -> render the 2D fallback if the Canvas throws.
//   - <Suspense>               -> covers async scene assets (textures/models).
// SimPanel wraps this again in its own Suspense + ErrorBoundary (defense in
// depth): whichever catches first, the viewer lands on the 2D Pixi monitor.

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import type { DeviceStatus } from '@prevent/contracts';
import { hasWebGL2 } from './capability';
import { ErrorBoundary } from './ErrorBoundary';
import { Scene } from './Scene';

interface Props {
  device: DeviceStatus;
  /** Rendered instead of the Canvas if WebGL2 is unavailable or the GL throws. */
  fallback?: ReactNode;
}

// Fill the whole card; the bright scene is the frame's content, not a boxed inset.
const SURFACE_CLASS = 'h-full min-h-0 flex-1 overflow-hidden rounded-md';

/** Track `prefers-reduced-motion`, updating live if the viewer toggles it. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    try {
      return (
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      );
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * In frameloop="demand" (reduced motion), request a render whenever the device
 * row changes so the scene still tracks the truth. A no-op under "always".
 */
function FrameInvalidator({ device }: { device: DeviceStatus }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    invalidate();
  }, [device, invalidate]);
  return null;
}

export default function ICUScene3D({ device, fallback = null }: Props) {
  // Probe once; a failed WebGL2 context means we never mount the Canvas. Also
  // settable so a runtime context LOSS (projector hot-plug, display sleep, GPU
  // reset) flips us back to the 2D fallback instead of a blank ward.
  const [supported, setSupported] = useState(hasWebGL2);
  const reducedMotion = usePrefersReducedMotion();

  // Keep the latest device in a ref so the memoized <Scene> can read fresh
  // values each frame without re-rendering the scene subtree on every tick.
  const deviceRef = useRef(device);
  deviceRef.current = device;
  const getDevice = useCallback(() => deviceRef.current, []);

  if (!supported) return <>{fallback}</>;

  return (
    <ErrorBoundary fallback={fallback}>
      <div className={SURFACE_CLASS} style={{ position: 'relative' }}>
        <Canvas
          flat
          frameloop={reducedMotion ? 'demand' : 'always'}
          shadows="percentage"
          dpr={[1, 1.5]}
          performance={{ min: 0.5 }}
          gl={{
            antialias: false,
            alpha: false,
            stencil: false,
            powerPreference: 'high-performance',
          }}
          camera={{ position: [12, 17, 16], fov: 34, near: 0.5, far: 120 }}
          onCreated={({ gl }) => {
            gl.setClearColor('#EEF3F8', 1);
            // On context loss, preventDefault() (so the browser could restore)
            // and drop to the 2D PatientMonitor fallback rather than a blank ward.
            gl.domElement.addEventListener('webglcontextlost', (e) => {
              e.preventDefault();
              setSupported(false);
            });
          }}
        >
          <FrameInvalidator device={device} />
          <Suspense fallback={fallback}>
            <Scene getDevice={getDevice} reducedMotion={reducedMotion} />
          </Suspense>
        </Canvas>
      </div>
    </ErrorBoundary>
  );
}
