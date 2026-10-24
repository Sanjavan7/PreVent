// The ICU scene graph (Stage 3 complete): light rig, primitive models, the hero
// monitor screen, contact shadows, the post-processing stack, the idle-orbit
// camera controls, the floating CODE HUD, and the single DeviceDriver useFrame
// that animates all of it.
//
// Perf contract (spec §3): <Scene> is memoized and fed only a STABLE getDevice
// accessor + a reducedMotion flag, so SimPanel's per-tick re-renders never
// reconcile this subtree. Every animatable object exposes a ref (bundled by
// useSceneRefs); DeviceDriver reads the live device through the ref and mutates
// those handles in ONE useFrame. The only React state here is the perf `tier`,
// flipped rarely by <PerformanceMonitor> -- never per frame.

import { memo, useState } from 'react';
import { ContactShadows, OrbitControls, AdaptiveDpr, PerformanceMonitor, Preload } from '@react-three/drei';
import type { DeviceStatus } from '@prevent/contracts';
import { RoomShell } from './RoomShell';
import { Bed } from './Bed';
import { Patient } from './Patient';
import { Ventilator } from './Ventilator';
import { IVPole } from './IVPole';
import { MonitorScreen } from './MonitorScreen';
import { Lighting } from './Lighting';
import { Effects } from './Effects';
import type { PerfTier } from './Effects';
import { CodeHud } from './CodeHud';
import { DeviceDriver } from './DeviceDriver';
import { useSceneRefs } from './sceneRefs';
import { useMonitorTexture } from './useMonitorTexture';

interface Props {
  /** Stable accessor for the latest device row (identity never changes). */
  getDevice: () => DeviceStatus;
  /** When true: static bellows, no camera orbit, flattened strobe. */
  reducedMotion: boolean;
}

export const Scene = memo(function Scene({ getDevice, reducedMotion }: Props) {
  // Headless Pixi waveform -> CanvasTexture for the monitor screen.
  const screenTex = useMonitorTexture(getDevice);

  // Stable handles for DeviceDriver's single useFrame.
  const refs = useSceneRefs();

  // Rendering tier, dropped/raised by PerformanceMonitor. Changes are rare and
  // never happen in useFrame, so re-rendering <Scene> on a step is cheap.
  const [tier, setTier] = useState<PerfTier>('HIGH');

  return (
    <>
      <Lighting
        ambientRef={refs.ambient}
        rimRef={refs.rim}
        keyRef={refs.key}
        fillRef={refs.fill}
      />

      {/* Room + furniture + devices. */}
      <RoomShell />
      <Bed position={[0.3, 0, 0]} />
      <Patient position={[0.3, 0, 0]} breathingRef={refs.breathing} />
      <Ventilator
        position={[1.4, 0, -0.2]}
        bellowsRef={refs.bellows}
        ledRef={refs.led}
      />
      <IVPole position={[-0.5, 0, -0.3]} dripRef={refs.drip} />
      <MonitorScreen
        texture={screenTex}
        position={[0.9, 0, 0.15]}
        matRef={refs.screenMat}
      />

      {/* Single contact shadow, rendered once. */}
      <ContactShadows
        position={[0.3, 0.001, 0]}
        scale={8}
        resolution={512}
        blur={2.4}
        far={3.5}
        opacity={0.75}
        color="#000306"
        frames={1}
      />

      {/* Crisp floating CODE banner; opacity ramped by DeviceDriver. */}
      <CodeHud hudRef={refs.codeHud} position={[0.3, 1.95, 0.1]} />

      {/* Tightly clamped controls + programmatic idle orbit in DeviceDriver.
          Azimuth clamps straddle the natural start angle (~0.59 rad for the
          spec camera) so the auto-orbit swings a tasteful front arc rather than
          pinning against a wall. */}
      <OrbitControls
        ref={refs.controls}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minDistance={2.6}
        maxDistance={4.5}
        minPolarAngle={Math.PI * 0.28}
        maxPolarAngle={Math.PI * 0.52}
        minAzimuthAngle={-0.2}
        maxAzimuthAngle={1.1}
        target={[0.3, 1.0, 0]}
        onStart={() => {
          refs.interacting.current = true;
        }}
        onEnd={() => {
          refs.interacting.current = false;
        }}
      />

      {/* The post-processing stack (Stage 6). */}
      <Effects tier={tier} bloomRef={refs.bloom} chromaRef={refs.chroma} />

      {/* Adaptive perf: drop dpr on regress, step the effect tier on decline. */}
      <AdaptiveDpr pixelated />
      <PerformanceMonitor
        onDecline={() =>
          setTier((prev) => (prev === 'HIGH' ? 'MED' : 'LOW'))
        }
        onIncline={() =>
          setTier((prev) => (prev === 'LOW' ? 'MED' : 'HIGH'))
        }
      />
      <Preload all />

      {/* The single animation loop. Renders nothing. */}
      <DeviceDriver
        getDevice={getDevice}
        refs={refs}
        reducedMotion={reducedMotion}
      />
    </>
  );
});
