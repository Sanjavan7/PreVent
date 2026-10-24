// The ICU light rig (spec §4). Mounted ONCE with the HEALTHY values; the alarm
// transition is a per-frame lerp of these same four light objects in
// DeviceDriver (never a mount/unmount), so a crash never pops geometry or
// reallocates shadow maps.
//
// Environment: a fully offline, programmatic env map (drei <Environment> with
// <Lightformer> children -- NO HDR fetch, demo-safe with no network) that gives
// the chrome rails / IV pole / floor a faint blue reflection. Baked once
// (frames={1}) and kept dim (environmentIntensity <= 0.6) so it never lifts the
// pitch-black room.
//
// No device props -> memoized. Only the stable light refs flow in; DeviceDriver
// owns every value after mount.

import { memo } from 'react';
import type { RefObject } from 'react';
import type { AmbientLight, DirectionalLight, PointLight } from 'three';
import { Environment, Lightformer } from '@react-three/drei';

interface Props {
  ambientRef: RefObject<AmbientLight | null>;
  rimRef: RefObject<DirectionalLight | null>;
  keyRef: RefObject<PointLight | null>;
  fillRef: RefObject<PointLight | null>;
}

export const Lighting = memo(function Lighting({
  ambientRef,
  rimRef,
  keyRef,
  fillRef,
}: Props) {
  return (
    <>
      {/* Near-black ambient so the room reads as pitch dark. */}
      <ambientLight ref={ambientRef} intensity={0.06} color="#0a1420" />

      {/* Cold blue directional rim from behind the bed. */}
      <directionalLight
        ref={rimRef}
        position={[-3, 2.4, -2.5]}
        intensity={0.9}
        color="#0097fe"
      />

      {/* Monitor key light -- the hero. Co-located with the screen so the glow
          reads as the room's dominant source. */}
      <pointLight
        ref={keyRef}
        position={[0.9, 1.35, 0.15]}
        intensity={2.4}
        distance={4.5}
        decay={2}
        color="#0097fe"
      />

      {/* Faint camera-side fill so the near faces aren't fully crushed. */}
      <pointLight
        ref={fillRef}
        position={[2.2, 1.6, 2.6]}
        intensity={0.35}
        distance={8}
        decay={2}
        color="#2b5f8a"
      />

      {/* Offline env map (no HDR fetch). Baked once; dim blue reflections. */}
      <Environment frames={1} resolution={256} environmentIntensity={0.5}>
        <color attach="background" args={['#02040a']} />
        <Lightformer
          form="rect"
          intensity={1.2}
          color="#0097fe"
          scale={[6, 6, 1]}
          position={[-3, 3, -4]}
          target={[0, 1, 0]}
        />
        <Lightformer
          form="rect"
          intensity={0.4}
          color="#2b5f8a"
          scale={[5, 5, 1]}
          position={[4, 2.5, 4]}
          target={[0, 1, 0]}
        />
        <Lightformer
          form="ring"
          intensity={0.3}
          color="#0097fe"
          scale={[2, 2, 1]}
          position={[0, 4, 0]}
          target={[0, 0, 0]}
        />
      </Environment>
    </>
  );
});
