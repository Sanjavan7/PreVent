// ROOM_LAYOUT -- the single source of truth for the bright cutaway ward (spec
// §4). Origin at ward centre, +Y up, floor on the XZ plane. Footprint 20 x 15 m,
// rooms 4 x 4 m on a 4.6 m pitch, THICK warm cutaway walls (h 1.3 m, NO ceiling)
// in TWO rows of four facing a central 2.6 m corridor, plus a short nurse-stroll
// waypoint loop that dips in and out of room doorways.
//
// Everything downstream (Ward / Room / JudgeRoom / Corridor / People) reads these
// coordinates so the geometry and the nurses share one map. Pure data -- no
// three, no react -- so it stays trivially importable anywhere.

import { C } from '../palette';

export type Vec3 = [number, number, number];

export interface RoomDef {
  /** Stable key. */
  id: string;
  /** Door/pin label, e.g. "202 · PATIENT". */
  label: string;
  /** World centre of the room (floor level, y = 0). */
  center: Vec3;
  /** Y rotation (rad). Front-row rooms rotate PI so their OPEN side (the missing
   *  front wall) faces the central corridor. Back-row rooms default to 0. */
  rotY?: number;
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
  /** Closed stroll loop for the nurses (People.tsx walks this; it dips toward a
   *  few room doorways then returns to the corridor centreline). */
  waypoints: Vec3[];
  /** Soft sage plant positions dotted around the ward. */
  plants: Vec3[];
}

// Two rows of four rooms (z = -4.6 back, z = +4.6 front) across x. Back-row
// rooms open toward +Z (corridor); front-row rooms are rotated PI so their open
// side faces -Z (corridor). The judge rests in a back-row room (R2).
const ROW_X = [-6.9, -2.3, 2.3, 6.9] as const;

export const ROOM_LAYOUT: WardLayout = {
  floor: { size: [20, 15], y: 0, color: C.floor },
  roomSize: 4,
  wallHeight: 1.3,
  // Thick warm dividers: noticeably more 3D depth than the old 0.12 sliver.
  wallThickness: 0.24,
  wallColor: C.wallWarm,
  corridor: { z: 0, depth: 2.6, color: C.trim, trim: C.brand },
  rooms: [
    // Back row (open side faces +Z toward the corridor).
    { id: 'R1', label: '201', center: [ROW_X[0], 0, -4.6] },
    { id: 'R2', label: '202 · PATIENT', center: [ROW_X[1], 0, -4.6], judge: true },
    { id: 'R3', label: '203', center: [ROW_X[2], 0, -4.6] },
    { id: 'R4', label: '204', center: [ROW_X[3], 0, -4.6] },
    // Front row (rotated PI so the open side faces -Z toward the corridor).
    { id: 'R5', label: '205', center: [ROW_X[0], 0, 4.6], rotY: Math.PI },
    { id: 'R6', label: '206', center: [ROW_X[1], 0, 4.6], rotY: Math.PI },
    { id: 'R7', label: '207', center: [ROW_X[2], 0, 4.6], rotY: Math.PI },
    { id: 'R8', label: '208', center: [ROW_X[3], 0, 4.6], rotY: Math.PI },
  ],
  // A short corridor loop: walk the centreline, then dip toward a doorway (z
  // past the ±1.3 corridor edge, toward a room's open face) and return.
  waypoints: [
    [-8.5, 0, 0],
    [-6.9, 0, -2.2], // dip toward room 201 doorway
    [-6.9, 0, 0],
    [-2.3, 0, 0.4],
    [2.3, 0, 2.2], // dip toward room 207 doorway
    [2.3, 0, 0],
    [6.9, 0, 0.3],
    [8.5, 0, 0],
    [6.9, 0, -2.2], // dip toward room 204 doorway
    [6.9, 0, 0],
    [2.3, 0, 0.4],
    [-2.3, 0, 2.2], // dip toward room 206 doorway
    [-2.3, 0, 0],
  ],
  plants: [
    [-9.4, 0, 0], // west end of the corridor
    [9.4, 0, 0], // east end of the corridor
  ],
};
