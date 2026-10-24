// A generic patient room (spec §4): floor tile + 3 thick warm cutaway walls, a
// bed with ONE resting patient under a sheet, a calm (static, non-data-bound)
// bedside monitor, and a visitor chair. Purely static set-dressing for the
// non-judge rooms -- React.memo, no device props, so it never reconciles on a
// device tick. `rotY` turns the front-row rooms so their open side faces the
// corridor.

import { memo } from 'react';
import type { Vec3 } from './layout';
import { RoomShell, Bed, RestingPatient, MonitorBox, Chair } from './furniture';

interface Props {
  center: Vec3;
  rotY?: number;
}

const BED: Vec3 = [-0.35, 0, -0.1];

export const Room = memo(function Room({ center, rotY = 0 }: Props) {
  return (
    <group position={center} rotation={[0, rotY, 0]}>
      <RoomShell size={4}>
        {/* Bed against the back wall, head toward -Z. */}
        <Bed position={BED} />
        {/* One resting patient under a sheet (calm, stationary). */}
        <RestingPatient position={BED} />
        {/* Calm bedside monitor (static blue face). */}
        <MonitorBox position={[0.95, 0, -1.2]} rotation={[0, -0.5, 0]} />
        {/* Visitor chair near the open (corridor) side. */}
        <Chair position={[1.1, 0, 1.0]} rotation={[0, -0.8, 0]} />
      </RoomShell>
    </group>
  );
});
