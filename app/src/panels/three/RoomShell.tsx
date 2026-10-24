// The pitch-black ICU room: an inverted box (we see its inner faces) plus a
// faintly glossy floor so the monitor's blue glow smears across it as a cheap
// reflection. No device state -- it never animates, so it's memoized and takes
// no props.

import { memo } from 'react';
import { BackSide } from 'three';

export const RoomShell = memo(function RoomShell() {
  return (
    <group>
      {/* Walls + ceiling: a large box rendered from the inside (BackSide). */}
      <mesh position={[0.3, 2.5, -0.5]}>
        <boxGeometry args={[16, 8, 16]} />
        <meshStandardMaterial
          color="#04070b"
          side={BackSide}
          metalness={0}
          roughness={1}
        />
      </mesh>

      {/* Floor: slightly metallic so screen-blue reads as a wet-floor smear. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.3, 0, 0]}>
        <planeGeometry args={[18, 18]} />
        <meshStandardMaterial
          color="#05080c"
          metalness={0.3}
          roughness={0.55}
          envMapIntensity={0.4}
        />
      </mesh>
    </group>
  );
});
