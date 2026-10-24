// Hospital bed: a dark frame on four legs, a soft mattress, and two side rails.
// Long axis runs along Z (patient head toward -Z). Purely static -- memoized,
// no device props. (This + Patient is the pair worth a GLB swap later; the
// lighting/post code stays unchanged if it is.)

import { memo } from 'react';
import { RoundedBox } from '@react-three/drei';

interface Props {
  position?: [number, number, number];
}

export const Bed = memo(function Bed({ position = [0.3, 0, 0] }: Props) {
  return (
    <group position={position}>
      {/* Frame slab */}
      <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[0.95, 0.1, 2.05]} />
        <meshStandardMaterial color="#1b2026" metalness={0.6} roughness={0.5} />
      </mesh>

      {/* Four legs */}
      {(
        [
          [-0.42, 0.95],
          [0.42, 0.95],
          [-0.42, -0.95],
          [0.42, -0.95],
        ] as const
      ).map(([x, z], i) => (
        <mesh key={i} position={[x, 0.16, z]}>
          <cylinderGeometry args={[0.03, 0.03, 0.34, 8]} />
          <meshStandardMaterial
            color="#1b2026"
            metalness={0.6}
            roughness={0.5}
          />
        </mesh>
      ))}

      {/* Mattress */}
      <RoundedBox
        args={[0.9, 0.14, 2.0]}
        radius={0.05}
        smoothness={3}
        position={[0, 0.47, 0]}
      >
        <meshStandardMaterial color="#2a3139" metalness={0} roughness={0.95} />
      </RoundedBox>

      {/* Side rails: thin cylinders laid along Z (rotate the Y-axis cylinder). */}
      {([-0.5, 0.5] as const).map((x) => (
        <mesh key={x} position={[x, 0.62, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.018, 0.018, 1.6, 12]} />
          <meshStandardMaterial
            color="#8a929c"
            metalness={0.9}
            roughness={0.35}
            envMapIntensity={0.6}
          />
        </mesh>
      ))}
    </group>
  );
});
