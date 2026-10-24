// The bedside monitor -- the scene's key light. A light housing on a pole/base,
// with a Plane whose map + emissiveMap is the live Pixi waveform CanvasTexture.
// Because it's emissive and toneMapped={false}, the #0097FE glow survives to the
// bloom pass (Stage 6) and reads as the room's dominant light source.
//
// It shows REPORTED vitals (the texture reuses the Pixi sim verbatim), so it
// stays calmly normal during the lie. No device props -> memoized; the texture
// object identity is stable once ready (it flips from null -> tex exactly once).

import { memo } from 'react';
import type { RefObject } from 'react';
import type { CanvasTexture, MeshStandardMaterial } from 'three';

interface Props {
  /** Live Pixi waveform texture; null on the very first frame before ready. */
  texture: CanvasTexture | null;
  position?: [number, number, number];
  /** Screen material -- DeviceDriver ramps emissiveIntensity on alarm. */
  matRef?: RefObject<MeshStandardMaterial | null>;
}

export const MonitorScreen = memo(function MonitorScreen({
  texture,
  position = [0.9, 0, -0.05],
  matRef,
}: Props) {
  return (
    <group position={position}>
      {/* Base */}
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.22, 0.22, 0.04, 24]} />
        <meshStandardMaterial color="#8a929c" metalness={0.9} roughness={0.35} />
      </mesh>

      {/* Pole */}
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 1.15, 12]} />
        <meshStandardMaterial
          color="#8a929c"
          metalness={0.9}
          roughness={0.35}
          envMapIntensity={0.6}
        />
      </mesh>

      {/* Housing */}
      <mesh position={[0, 1.2, 0]}>
        <boxGeometry args={[0.62, 0.46, 0.08]} />
        <meshStandardMaterial color="#c7ced6" metalness={0.1} roughness={0.75} />
      </mesh>

      {/* Screen: the hero. Faces +Z (toward the camera). */}
      <mesh position={[0, 1.2, 0.045]}>
        <planeGeometry args={[0.54, 0.34]} />
        {/* One material whose ref DeviceDriver ramps. map/emissiveMap are the
            live waveform once ready; until then it glows a flat blue so the
            screen never flashes black. */}
        <meshStandardMaterial
          ref={matRef}
          map={texture ?? null}
          color={texture ? '#ffffff' : '#06202f'}
          emissive={texture ? '#ffffff' : '#0097fe'}
          emissiveMap={texture ?? null}
          emissiveIntensity={texture ? 1.4 : 0.6}
          toneMapped={false}
          metalness={0}
          roughness={1}
        />
      </mesh>
    </group>
  );
});
