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
import { WardInteractions } from './ward/WardInteractions';
import { People } from './ward/People';
import { CameraRig } from './CameraRig';

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

  // Click-to-focus selection + hover. DISCRETE state (set on pointer events in
  // WardInteractions, never per frame). Changing these re-renders only the cheap
  // WardInteractions layer -- the memoized <Ward> subtree bails out (its props
  // never depend on hover/selection). The smooth camera glide to the selected
  // room runs in CameraRig's useFrame; this state just names the target.
  // Default selection = the judge room (202), so the "You are here" arrow +
  // label and the focused framing land on load over the judge's bed.
  const [selectedId, setSelectedId] = useState<string | null>('R2');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <>
      <Lighting hemiRef={refs.hemi} sunRef={refs.sun} />

      {/* The (now larger, two-row) ward, auto-framed to the panel. */}
      <Bounds fit clip observe margin={1.2} maxDuration={0.8}>
        <Center disableY>
          <Ward layout={ROOM_LAYOUT} refs={refs} screenTex={screenTex} reducedMotion={reducedMotion} />
          {/* Click-to-focus hit areas, highlights + labels. Same local space as
              Ward so it rides the Center/Bounds transform and stays aligned. */}
          <WardInteractions
            selectedId={selectedId}
            hoveredId={hoveredId}
            onHover={setHoveredId}
            onSelect={setSelectedId}
            reducedMotion={reducedMotion}
          />
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

      {/* Dollhouse-isometric orbit: looking DOWN into the roofless rooms, but now
          free to swing most of the way around the ward and from near-top-down to
          a low angle (never under the floor). Smooth damping, clamped zoom, no
          pan. Idle auto-orbit lives in DeviceDriver and pauses while dragging. */}
      <OrbitControls
        ref={refs.controls}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        enableZoom
        minDistance={16}
        maxDistance={44}
        minPolarAngle={Math.PI * 0.18}
        maxPolarAngle={Math.PI * 0.46}
        minAzimuthAngle={-Math.PI * 0.6}
        maxAzimuthAngle={Math.PI * 0.6}
        target={[-1.5, 0.5, -1]}
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

      {/* The single device-animation loop. Renders nothing. */}
      <DeviceDriver
        getDevice={getDevice}
        refs={refs}
        reducedMotion={reducedMotion}
      />

      {/* Smooth click-to-focus camera glide (own useFrame; eases target +
          distance toward the selected room, or back to the overview). Mounted
          last so it has the final say on the camera each frame. */}
      <CameraRig
        controlsRef={refs.controls}
        selectedId={selectedId}
        reducedMotion={reducedMotion}
      />
    </>
  );
});
