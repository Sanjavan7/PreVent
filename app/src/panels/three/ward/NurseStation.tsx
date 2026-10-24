// The nurse station at the front of the ward (spec §4): a curved ceramic desk
// with a low counter and two ambient flat screens that are NOT data-bound (calm
// blue, below the bloom gate) -- pure set-dressing that signals a staffed,
// peaceful ward. React.memo, no props; reads its anchor from ROOM_LAYOUT.

import { memo } from 'react';
import { ROOM_LAYOUT } from './layout';
import { hex, C } from '../palette';

const { center, size } = ROOM_LAYOUT.nurseStation;
const RADIUS = size[0] / 2;

export const NurseStation = memo(function NurseStation() {
  return (
    <group position={center}>
      {/* Curved desk body (half-cylinder shell, open to the back). */}
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[RADIUS, RADIUS, 1.0, 28, 1, true, Math.PI, Math.PI]} />
        <meshStandardMaterial color={hex(C.wall)} metalness={0} roughness={0.85} side={2} />
      </mesh>

      {/* Counter top (thin curved ring cap). */}
      <mesh position={[0, 1.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[RADIUS - 0.26, RADIUS + 0.02, 28, 1, Math.PI, Math.PI]} />
        <meshStandardMaterial color={hex(C.trim)} metalness={0} roughness={0.7} side={2} />
      </mesh>

      {/* Two ambient flat screens on the counter (calm blue, static). */}
      {(
        [
          { k: 'l', pos: [-1.1, 1.32, -0.7] as [number, number, number], rot: [0, 0.5, 0] as [number, number, number] },
          { k: 'r', pos: [1.1, 1.32, -0.7] as [number, number, number], rot: [0, -0.5, 0] as [number, number, number] },
        ] as const
      ).map((s) => (
        <mesh key={s.k} position={s.pos} rotation={s.rot}>
          <planeGeometry args={[0.5, 0.34]} />
          <meshStandardMaterial
            color={hex(C.brandTint)}
            emissive={hex(C.brand)}
            emissiveIntensity={0.45}
            toneMapped={false}
            metalness={0}
            roughness={1}
          />
        </mesh>
      ))}
    </group>
  );
});
