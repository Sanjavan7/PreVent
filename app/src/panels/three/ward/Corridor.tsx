// The corridor strip the crowd strolls down (spec §4): a wide neutral floor band
// at z = 0 with a thin #0097FE baseboard trim line along each edge -- the one
// deliberate accent on the open floor. Purely static -- React.memo, no props;
// reads its dimensions straight from ROOM_LAYOUT so it can never drift from the
// rooms or the people waypoints.

import { memo } from 'react';
import { ROOM_LAYOUT } from './layout';
import { hex } from '../palette';

const { floor, corridor } = ROOM_LAYOUT;
const LENGTH = floor.size[0] - 2; // inset from the ward edges
const HALF_DEPTH = corridor.depth / 2;

export const Corridor = memo(function Corridor() {
  return (
    <group position={[0, 0, corridor.z]}>
      {/* Corridor floor band (sits just above the ward slab). */}
      <mesh position={[0, 0.04, 0]} receiveShadow>
        <boxGeometry args={[LENGTH, 0.02, corridor.depth]} />
        <meshStandardMaterial color={hex(corridor.color)} metalness={0} roughness={0.9} />
      </mesh>

      {/* Brand baseboard trim lines along each edge. */}
      {([-HALF_DEPTH, HALF_DEPTH] as const).map((z) => (
        <mesh key={z} position={[0, 0.06, z]}>
          <boxGeometry args={[LENGTH, 0.04, 0.05]} />
          <meshStandardMaterial
            color={hex(corridor.trim)}
            emissive={hex(corridor.trim)}
            emissiveIntensity={0.25}
            toneMapped={false}
            metalness={0}
            roughness={0.8}
          />
        </mesh>
      ))}
    </group>
  );
});
