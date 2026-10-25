// The BRIGHT ward light rig (spec §6). A daylit, peaceful "dollhouse" base:
// a soft sky/ground hemisphere + a flat ambient lift + one warm directional
// sun (the only shadow caster), over a fully OFFLINE white softbox environment
// (drei <Environment> with <Lightformer> children -- NO HDR fetch, demo-safe
// with no network).
//
// Mounted ONCE. The ambient + env are static and always carry a bright floor so
// a crash NEVER darkens the hospital. The hemisphere and sun expose refs: on a
// crash DeviceDriver dims them only ~12% so the rest of the ward gently recedes
// while the judge focus spot rises -- the money moment reads by WARMTH + FOCUS,
// never by going dark. The judge-room focus spotlight itself lives in JudgeRoom.

import { memo } from 'react';
import type { RefObject } from 'react';
import type { DirectionalLight, HemisphereLight } from 'three';
import { Environment, Lightformer } from '@react-three/drei';
import { C } from './palette';

interface Props {
  hemiRef: RefObject<HemisphereLight | null>;
  sunRef: RefObject<DirectionalLight | null>;
}

export const Lighting = memo(function Lighting({ hemiRef, sunRef }: Props) {
  return (
    <>
      {/* Sky/ground hemispheric fill -- the bright, peaceful base (dims ~12%). */}
      <hemisphereLight ref={hemiRef} intensity={0.9} color={C.sky} groundColor={C.ground} />

      {/* Flat ambient lift so no near face is crushed (static, never dimmed). */}
      <ambientLight intensity={0.35} color={C.linen} />

      {/* Warm hero sun (~4000K) -- the ONLY shadow caster. */}
      <directionalLight
        ref={sunRef}
        position={[6, 11, 4]}
        intensity={1.8}
        color={C.sun}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      >
        <orthographicCamera attach="shadow-camera" args={[-14, 14, 9, -9, 1, 40]} />
      </directionalLight>

      {/* Offline white softbox env -- no HDR/CDN. Baked once; soft reflections. */}
      <Environment frames={1} resolution={256} environmentIntensity={0.85}>
        <color attach="background" args={['#eef3f8']} />
        <Lightformer
          form="rect"
          intensity={1.0}
          color="#ffffff"
          scale={[10, 10, 1]}
          position={[0, 8, 0]}
          target={[0, 0, 0]}
        />
        <Lightformer
          form="rect"
          intensity={0.5}
          color="#eaf4ff"
          scale={[8, 4, 1]}
          position={[-6, 5, -4]}
          target={[0, 1, 0]}
        />
        <Lightformer
          form="rect"
          intensity={0.4}
          color="#ffffff"
          scale={[8, 4, 1]}
          position={[6, 5, 4]}
          target={[0, 1, 0]}
        />
        <Lightformer
          form="ring"
          intensity={0.3}
          color="#bfe4ff"
          scale={[3, 3, 1]}
          position={[0, 6, 0]}
          target={[0, 0, 0]}
        />
      </Environment>
    </>
  );
});
