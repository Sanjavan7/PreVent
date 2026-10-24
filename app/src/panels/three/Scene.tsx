// The bright cutaway-ward scene graph (Stage 2): the daylit light rig, the
// roofless dollhouse WARD auto-framed by <Bounds>/<Center>, a baked contact
// shadow, the dollhouse-isometric orbit controls, the strolling crowd, the
// minimal post stack, and the single DeviceDriver useFrame that animates
// everything.
//
// Perf contract (spec §3) -- UNCHANGED by this redesign: <Scene> is memoized and
// fed only a STABLE getDevice accessor + a reducedMotion flag, so SimPanel's
// per-tick re-renders never reconcile this subtree. Every animatable object
// exposes a ref (bundled by useSceneRefs); DeviceDriver reads the live device
// through the ref and mutates those handles in ONE useFrame. People run their
// OWN useFrame (crowd stroll, no setState). The only React state here is the
// perf `tier`, flipped rarely by <PerformanceMonitor> -- never per frame.
//
// This stage changes aesthetics / composition only: the dark bedside singletons
// (RoomShell/Bed/Patient/Ventilator/IVPole/MonitorScreen) are retired into
// ward/furniture.ts + ward/JudgeRoom.tsx and no longer mounted here.

import { memo, useState } from 'react';
import {
  AdaptiveDpr,
  Bounds,
  Center,
  ContactShadows,
  OrbitControls,
  PerformanceMonitor,
  Preload,
} from '@react-three/drei';
import type { DeviceStatus } from '@prevent/contracts';
import { Lighting } from './Lighting';
import { Effects } from './Effects';
import type { PerfTier } from './Effects';
import { DeviceDriver } from './DeviceDriver';
import { useSceneRefs } from './sceneRefs';
import { useMonitorTexture } from './useMonitorTexture';
import { ROOM_LAYOUT } from './ward/layout';
import { Ward } from './ward/Ward';
import { People } from './ward/People';

interface Props {
  /** Stable accessor for the latest device row (identity never changes). */
  getDevice: () => DeviceStatus;
  /** When true: static bellows, no camera orbit, frozen crowd. */
  reducedMotion: boolean;
}

export const Scene = memo(function Scene({ getDevice, reducedMotion }: Props) {
  // Headless Pixi waveform -> CanvasTexture for the judge-room monitor only.
  const screenTex = useMonitorTexture(getDevice);

  // Stable handles for DeviceDriver's single useFrame.
  const refs = useSceneRefs();

  // Rendering tier, dropped/raised by PerformanceMonitor. Changes are rare and
  // never happen in useFrame, so re-rendering <Scene> on a step is cheap.
  const [tier, setTier] = useState<PerfTier>('HIGH');

  return (
    <>
      <Lighting hemiRef={refs.hemi} sunRef={refs.sun} />

      {/* The ward, auto-framed to the panel from the iso orbit. */}
      <Bounds fit clip observe margin={1.15} maxDuration={0.8}>
        <Center disableY>
          <Ward layout={ROOM_LAYOUT} refs={refs} screenTex={screenTex} />
        </Center>
      </Bounds>

      {/* One baked soft shadow grounding the whole building (slate, not black). */}
      <ContactShadows
        position={[0, 0.01, 0]}
        scale={34}
        resolution={1024}
        blur={2.6}
        far={9}
        opacity={0.4}
        color="#43566b"
        frames={1}
        smooth
      />

      {/* Dollhouse-isometric orbit: always looking DOWN into the roofless rooms,
          gentle azimuth arc, clamped zoom. Idle auto-orbit lives in DeviceDriver
          and pauses while the viewer drags (interacting ref). */}
      <OrbitControls
        ref={refs.controls}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        enableZoom
        minDistance={18}
        maxDistance={30}
        minPolarAngle={0.78}
        maxPolarAngle={1.08}
        minAzimuthAngle={0.42}
        maxAzimuthAngle={1.02}
        target={[-1.5, 0.6, -1]}
        onStart={() => {
          refs.interacting.current = true;
        }}
        onEnd={() => {
          refs.interacting.current = false;
        }}
      />

      {/* The strolling crowd (2 InstancedMesh, its own useFrame). */}
      <People layout={ROOM_LAYOUT} reducedMotion={reducedMotion} tier={tier} />

      {/* The minimal bright post stack (Stage 1). */}
      <Effects tier={tier} bloomRef={refs.bloom} chromaRef={refs.chroma} />

      {/* Adaptive perf: drop dpr on regress, step the effect tier on decline. */}
      <AdaptiveDpr pixelated />
      <PerformanceMonitor
        onDecline={() => setTier((prev) => (prev === 'HIGH' ? 'MED' : 'LOW'))}
        onIncline={() => setTier((prev) => (prev === 'LOW' ? 'MED' : 'HIGH'))}
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
