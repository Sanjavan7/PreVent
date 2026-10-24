// Draped patient: a torso + head under a low-opacity sheet, lying head-to -Z.
// The torso lives in its own group whose ref is lifted to the DeviceDriver
// (Stage 7), which drives a subtle breathing scale.y synced to the ventilator
// and freezes it on crash. No device props here -> memoized; only the stable
// ref object flows in.

import { memo } from 'react';
import type { RefObject } from 'react';
import type { Group } from 'three';
import { RoundedBox } from '@react-three/drei';

interface Props {
  position?: [number, number, number];
  /** Torso group -- DeviceDriver animates its scale.y for breathing. */
  breathingRef?: RefObject<Group | null>;
}

export const Patient = memo(function Patient({
  position = [0.3, 0, 0],
  breathingRef,
}: Props) {
  return (
    <group position={position}>
      {/* Breathing torso (animated later via breathingRef). */}
      <group ref={breathingRef} position={[0, 0.62, 0.15]}>
        <RoundedBox args={[0.46, 0.16, 1.0]} radius={0.08} smoothness={3}>
          <meshStandardMaterial
            color="#2a3139"
            metalness={0}
            roughness={0.95}
          />
        </RoundedBox>
      </group>

      {/* Head */}
      <mesh position={[0, 0.66, -0.72]}>
        <sphereGeometry args={[0.12, 24, 24]} />
        <meshStandardMaterial color="#2a3139" metalness={0} roughness={0.95} />
      </mesh>

      {/* Sheet draped over the lower body (translucent). */}
      <RoundedBox
        args={[0.56, 0.1, 1.3]}
        radius={0.05}
        smoothness={3}
        position={[0, 0.6, 0.35]}
      >
        <meshStandardMaterial
          color="#2a3139"
          metalness={0}
          roughness={0.95}
          transparent
          opacity={0.55}
        />
      </RoundedBox>
    </group>
  );
});
