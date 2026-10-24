// Ventilator on a rolling cart. The hero animated prop: a vertical bellows
// cylinder riding inside a transparent glass column. The DeviceDriver (Stage 7)
// drives the bellows' position.y / scale.y sinusoidally while the fan is on and
// freezes it mid-stroke the instant it stops -- the physical tell. A status LED
// sphere flips green -> red on compromise/alarm.
//
// No device props: only stable animation refs flow in, so this stays memoized
// and never reconciles on a device tick.

import { memo } from 'react';
import type { RefObject } from 'react';
import type { Mesh } from 'three';
import { RoundedBox } from '@react-three/drei';

interface Props {
  position?: [number, number, number];
  /** Inner bellows cylinder -- DeviceDriver animates position.y / scale.y. */
  bellowsRef?: RefObject<Mesh | null>;
  /** Status LED sphere -- DeviceDriver recolors its emissive on alarm. */
  ledRef?: RefObject<Mesh | null>;
}

export const Ventilator = memo(function Ventilator({
  position = [1.4, 0, -0.2],
  bellowsRef,
  ledRef,
}: Props) {
  return (
    <group position={position}>
      {/* Body */}
      <RoundedBox
        args={[0.5, 1.0, 0.4]}
        radius={0.04}
        smoothness={3}
        position={[0, 0.95, 0]}
      >
        <meshStandardMaterial color="#2b2f36" metalness={0.2} roughness={0.6} />
      </RoundedBox>

      {/* Front emissive UI panel (static blue glow). */}
      <mesh position={[0, 1.05, 0.205]}>
        <planeGeometry args={[0.34, 0.28]} />
        <meshStandardMaterial
          color="#0097fe"
          emissive="#0097fe"
          emissiveIntensity={1.2}
          toneMapped={false}
          metalness={0}
          roughness={1}
        />
      </mesh>

      {/* Status LED (green healthy -> red compromised/alarm). */}
      <mesh ref={ledRef} position={[0.18, 1.4, 0.205]}>
        <sphereGeometry args={[0.025, 16, 16]} />
        <meshStandardMaterial
          color="#000000"
          emissive="#00ff9c"
          emissiveIntensity={3}
          toneMapped={false}
        />
      </mesh>

      {/* Glass column enclosing the bellows. */}
      <mesh position={[0, 1.75, 0.08]}>
        <cylinderGeometry args={[0.12, 0.12, 0.5, 24, 1, true]} />
        <meshStandardMaterial
          color="#bcd3e0"
          metalness={0}
          roughness={0.1}
          transparent
          opacity={0.15}
          depthWrite={false}
        />
      </mesh>

      {/* Bellows (animated). Base sits near the bottom of the glass column so a
          downward scale/translate reads as an exhale. */}
      <mesh ref={bellowsRef} position={[0, 1.62, 0.08]}>
        <cylinderGeometry args={[0.09, 0.09, 0.26, 24]} />
        <meshStandardMaterial color="#d7dde3" metalness={0.1} roughness={0.7} />
      </mesh>

      {/* Cart: four legs + four wheels. */}
      {(
        [
          [-0.18, 0.15],
          [0.18, 0.15],
          [-0.18, -0.15],
          [0.18, -0.15],
        ] as const
      ).map(([x, z], i) => (
        <mesh key={`leg-${i}`} position={[x, 0.22, z]}>
          <cylinderGeometry args={[0.02, 0.02, 0.44, 8]} />
          <meshStandardMaterial
            color="#8a929c"
            metalness={0.9}
            roughness={0.35}
            envMapIntensity={0.6}
          />
        </mesh>
      ))}
      {(
        [
          [-0.18, 0.15],
          [0.18, 0.15],
          [-0.18, -0.15],
          [0.18, -0.15],
        ] as const
      ).map(([x, z], i) => (
        <mesh
          key={`wheel-${i}`}
          position={[x, 0.035, z]}
          rotation={[0, 0, Math.PI / 2]}
        >
          <torusGeometry args={[0.035, 0.014, 8, 16]} />
          <meshStandardMaterial
            color="#8a929c"
            metalness={0.9}
            roughness={0.35}
          />
        </mesh>
      ))}
    </group>
  );
});
