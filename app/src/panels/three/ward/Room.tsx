// A generic patient room (spec §4): floor tile + 3 low cutaway walls, a bed with
// a calm (static, non-data-bound) bedside monitor, and a visitor chair. Purely
// static set-dressing for the three non-judge rooms -- React.memo, no device
// props, so it never reconciles on a device tick.

import { memo } from 'react';
import type { Vec3 } from './layout';
import { RoomShell, Bed, MonitorBox, Chair } from './furniture';

interface Props {
  center: Vec3;
}

export const Room = memo(function Room({ center }: Props) {
  return (
    <group position={center}>
      <RoomShell size={4}>
        {/* Bed against the back wall, head toward -Z. */}
        <Bed position={[-0.35, 0, -0.1]} />
        {/* Calm bedside monitor (static blue face). */}
        <MonitorBox position={[0.95, 0, -1.2]} rotation={[0, -0.5, 0]} />
        {/* Visitor chair near the open (corridor) side. */}
        <Chair position={[1.1, 0, 1.0]} rotation={[0, -0.8, 0]} />
      </RoomShell>
    </group>
  );
});
