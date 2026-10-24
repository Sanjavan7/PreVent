// ROOM_LAYOUT -- the single source of truth for the bright cutaway ward (spec
// §4). Origin at ward centre, +Y up, floor on the XZ plane. Footprint 20 x 13 m,
// rooms 4 x 4 m on a 4.6 m pitch, low cutaway walls (h 1.3 m, NO ceiling) off a
// 2.6 m corridor, a nurse station at the front and a people-stroll waypoint loop.
//
// Everything downstream (Ward / Room / JudgeRoom / Corridor / NurseStation /
// People) reads these coordinates so the geometry and the crowd share one map.
// Pure data -- no three, no react -- so it stays trivially importable anywhere.

import { C } from '../palette';

export type Vec3 = [number, number, number];

export interface RoomDef {
  /** Stable key. */
  id: string;
  /** Door/pin label, e.g. "202 · PATIENT". */
  label: string;
  /** World centre of the room (floor level, y = 0). */
  center: Vec3;
  /** The one highlighted room the judge is resting in. */
  judge?: boolean;
}

export interface WardLayout {
  floor: { size: [number, number]; y: number; color: number };
  roomSize: number;
  wallHeight: number;
  wallThickness: number;
  wallColor: number;
  corridor: { z: number; depth: number; color: number; trim: number };
  rooms: RoomDef[];
  nurseStation: { center: Vec3; size: Vec3 };
  waiting: { center: Vec3 };
  /** Closed stroll loop through the corridor (People.tsx walks this). */
  waypoints: Vec3[];
  /** Soft sage plant positions dotted around the ward. */
  plants: Vec3[];
}

export const ROOM_LAYOUT: WardLayout = {
  floor: { size: [20, 13], y: 0, color: C.floor },
  roomSize: 4,
  wallHeight: 1.3,
  wallThickness: 0.12,
  wallColor: C.wall,
  corridor: { z: 0, depth: 2.6, color: C.trim, trim: C.brand },
  rooms: [
    { id: 'R1', label: '201', center: [-6.9, 0, -4.6] },
    { id: 'R2', label: '202 · PATIENT', center: [-2.3, 0, -4.6], judge: true },
    { id: 'R3', label: '203', center: [2.3, 0, -4.6] },
    { id: 'R4', label: '204', center: [6.9, 0, -4.6] },
  ],
  nurseStation: { center: [0, 0, 4.4], size: [6, 1.0, 2.0] },
  waiting: { center: [7.5, 0, 4.2] },
  waypoints: [
    [-9, 0, 0],
    [-4, 0, 0.5],
    [0, 0, -0.4],
    [4, 0, 0.4],
    [9, 0, 0],
    [6.9, 0, -2.0],
    [0, 0, 0.6],
    [-6.9, 0, -2.0],
  ],
  plants: [
    [-9.2, 0, 4.4],
    [9.2, 0, -4.4],
    [-9.2, 0, -5.6],
    [4.2, 0, 4.6],
  ],
};
