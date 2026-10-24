// IV pole: a thin pole on a weighted base, a hook, a translucent fluid bag with
// an emissive blue rim, and a single drip droplet. The DeviceDriver (Stage 7)
// animates the droplet falling. No device props -> memoized; only the stable
// drip ref flows in.

import { memo } from 'react';
import type { RefObject } from 'react';
import type { Mesh } from 'three';

interface Props {
  position?: [number, number, number];
  /** The falling droplet -- DeviceDriver animates its position.y. */
  dripRef?: RefObject<Mesh | null>;
}

export const IVPole = memo(function IVPole({
  position = [-0.5, 0, -0.3],
  dripRef,
}: Props) {
  return (
    <group position={position}>
      {/* Weighted base */}
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.18, 0.18, 0.03, 16]} />
        <meshStandardMaterial color="#8a929c" metalness={0.9} roughness={0.35} />
      </mesh>

      {/* Pole */}
      <mesh position={[0, 1.0, 0]}>
        <cylinderGeometry args={[0.018, 0.018, 2.0, 12]} />
        <meshStandardMaterial
          color="#8a929c"
          metalness={0.9}
          roughness={0.35}
          envMapIntensity={0.6}
        />
      </mesh>

      {/* Hook at the top */}
      <mesh position={[0, 1.95, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.05, 0.012, 8, 24]} />
        <meshStandardMaterial color="#8a929c" metalness={0.9} roughness={0.35} />
      </mesh>

      {/* Fluid bag: translucent with an emissive blue rim. */}
      <mesh position={[0, 1.72, 0]}>
        <boxGeometry args={[0.12, 0.22, 0.04]} />
        <meshStandardMaterial
          color="#0097fe"
          emissive="#0097fe"
          emissiveIntensity={0.45}
          toneMapped={false}
          transparent
          opacity={0.4}
          depthWrite={false}
        />
      </mesh>

      {/* Drip chamber droplet (animated). */}
      <mesh ref={dripRef} position={[0, 1.55, 0]}>
        <sphereGeometry args={[0.012, 10, 10]} />
        <meshStandardMaterial
          color="#8fd3ff"
          emissive="#0097fe"
          emissiveIntensity={0.6}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
});
