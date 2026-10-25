// Pure, memoized primitive furniture builders for the bright ward (spec §4).
// Everything is daylit matte-ceramic (metalness 0, roughness ~0.9) near-white;
// the only metallic pieces are bed rails / poles / equipment (C.chrome) so the
// white softbox env gives them a clean sheen without hotspots. Screens are the
// lone emissive exception and are handled by MonitorBox.
//
// These retire the old dark bedside singletons (RoomShell / Bed / MonitorScreen
// -> MonitorBox / IVPole) into one reusable set shared across every room. None
// take a changing device prop, so each is React.memo and never reconciles on a
// device tick; only stable animation refs (drip / screen material) flow through.
//
// Authored as .ts (not .tsx) via React.createElement so the file stays a plain
// builder module; JSX rooms compose these.

import { createElement as h, memo, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { CanvasTexture, Group, Mesh, MeshStandardMaterial } from 'three';
import { hex, C } from '../palette';

type Vec3 = [number, number, number];

// Shared matte + chrome material prop bundles (one object identity each).
const matte = (color: number, roughness = 0.9) =>
  h('meshStandardMaterial', { color: hex(color), metalness: 0, roughness });
const chrome = () =>
  h('meshStandardMaterial', {
    color: hex(C.chrome),
    metalness: 0.9,
    roughness: 0.28,
    envMapIntensity: 0.8,
  });

interface Placed {
  position?: Vec3;
  rotation?: Vec3;
}

// --- RoomShell: floor tile + 3 LOW cutaway walls (front open to corridor) ----
// No ceiling, no front wall (+Z faces the corridor), so the orbit looks straight
// down into the room -- the "dollhouse" read.
export const RoomShell = memo(function RoomShell({
  size = 4,
  wallHeight = 1.3,
  // Thick warm dividers so every room reads as a solid 3D volume; floor stays
  // light (floorColor defaults near-white) for the bright dollhouse look.
  wallThickness = 0.24,
  wallColor = C.wallWarm,
  floorColor = C.wall,
  children,
}: {
  size?: number;
  wallHeight?: number;
  wallThickness?: number;
  wallColor?: number;
  floorColor?: number;
  children?: ReactNode;
}) {
  const half = size / 2;
  const hy = wallHeight / 2;
  return h('group', null, [
    // Floor tile (thin slab, sits just above the ward slab).
    h(
      'mesh',
      { key: 'floor', position: [0, 0.03, 0], receiveShadow: true },
      h('boxGeometry', { args: [size, 0.06, size] }),
      matte(floorColor, 0.95),
    ),
    // Back wall (-Z).
    h(
      'mesh',
      { key: 'back', position: [0, hy, -half], castShadow: true, receiveShadow: true },
      h('boxGeometry', { args: [size, wallHeight, wallThickness] }),
      matte(wallColor),
    ),
    // Left wall (-X).
    h(
      'mesh',
      { key: 'left', position: [-half, hy, 0], castShadow: true, receiveShadow: true },
      h('boxGeometry', { args: [wallThickness, wallHeight, size] }),
      matte(wallColor),
    ),
    // Right wall (+X).
    h(
      'mesh',
      { key: 'right', position: [half, hy, 0], castShadow: true, receiveShadow: true },
      h('boxGeometry', { args: [wallThickness, wallHeight, size] }),
      matte(wallColor),
    ),
    children,
  ]);
});

// --- Bed: white linen on a light frame, head toward -Z, two chrome rails ------
export const Bed = memo(function Bed({ position = [0, 0, 0], rotation }: Placed) {
  const legs: Vec3[] = [
    [-0.42, 0.16, 0.95],
    [0.42, 0.16, 0.95],
    [-0.42, 0.16, -0.95],
    [0.42, 0.16, -0.95],
  ];
  return h('group', { position, rotation }, [
    // Frame slab.
    h(
      'mesh',
      { key: 'frame', position: [0, 0.35, 0], castShadow: true },
      h('boxGeometry', { args: [0.95, 0.1, 2.05] }),
      matte(C.plastic, 0.6),
    ),
    // Legs.
    ...legs.map((p, i) =>
      h(
        'mesh',
        { key: `leg-${i}`, position: p },
        h('cylinderGeometry', { args: [0.03, 0.03, 0.34, 8] }),
        chrome(),
      ),
    ),
    // Mattress (bright linen). No castShadow -- a thin flat slab resting on the
    // frame; the frame below already casts the bed's grounding shadow.
    h(
      'mesh',
      { key: 'mat', position: [0, 0.47, 0.05] },
      h('boxGeometry', { args: [0.9, 0.14, 1.9] }),
      matte(C.linen, 0.95),
    ),
    // Pillow at the head (-Z).
    h(
      'mesh',
      { key: 'pillow', position: [0, 0.56, -0.78] },
      h('boxGeometry', { args: [0.62, 0.1, 0.34] }),
      matte(C.linen, 0.95),
    ),
    // Side rails (chrome cylinders laid along Z).
    ...([-0.5, 0.5] as const).map((x) =>
      h(
        'mesh',
        { key: `rail-${x}`, position: [x, 0.62, 0.1], rotation: [Math.PI / 2, 0, 0] },
        h('cylinderGeometry', { args: [0.018, 0.018, 1.5, 10] }),
        chrome(),
      ),
    ),
  ]);
});

// --- RestingPatient: a calm low-poly figure under a sheet, resting on a bed ----
// Matches the judge patient's silhouette (head toward -Z). Its torso breathes
// gently and ALWAYS (ambient life -- these are not the device, they just read as
// living people); the motion is deliberately subtler than the judge patient's.
// Each instance seeds a random phase so the ward's patients breathe out of sync,
// and under reduced motion the torso holds a static mid-inhale pose. The torso
// group scales/lifts about its y = 0.6 origin (head + blanket stay still), and
// the breath runs in its OWN lightweight useFrame subscriber (like the crowd),
// never setState -- so the room stays React.memo and never reconciles on a tick.
const AMB_BASE_Y = 0.6;
const AMB_RISE = 0.02; // ~2 cm lift -- subtle ambient life
const AMB_SCALE = 0.1; // up to 10% torso swell
const AMB_W = (Math.PI * 2) / 4.5; // ~13 breaths/min, calmer than the judge's

export const RestingPatient = memo(function RestingPatient({
  position = [0, 0, 0],
  rotation,
  reducedMotion = false,
}: Placed & { reducedMotion?: boolean }) {
  const torso = useRef<Group>(null);
  // Per-instance phase offset so the ward's patients breathe out of lockstep.
  const phase = useRef(Math.random() * Math.PI * 2);
  useFrame((state) => {
    const g = torso.current;
    if (!g) return;
    if (reducedMotion) {
      // Hold a gentle static mid-inhale pose (alive, but not moving).
      g.scale.y = 1 + AMB_SCALE * 0.5;
      g.position.y = AMB_BASE_Y + AMB_RISE * 0.5;
      return;
    }
    const stroke = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * AMB_W + phase.current);
    g.scale.y = 1 + stroke * AMB_SCALE;
    g.position.y = AMB_BASE_Y + stroke * AMB_RISE;
  });
  return h('group', { position, rotation }, [
    // Breathing torso mound under the sheet (bright linen). Wrapped in a group so
    // the breath scales/lifts about the y = 0.6 origin without moving head/blanket.
    h(
      'group',
      { key: 'torso', ref: torso, position: [0, AMB_BASE_Y, 0.0] },
      h(
        'mesh',
        { castShadow: true },
        h('boxGeometry', { args: [0.46, 0.16, 0.95] }),
        matte(C.linen, 0.95),
      ),
    ),
    // Blanket over the lower body.
    h(
      'mesh',
      { key: 'blanket', position: [0, 0.58, 0.45] },
      h('boxGeometry', { args: [0.6, 0.1, 1.0] }),
      matte(C.linen, 0.95),
    ),
    // Warm skin head on the pillow (head toward -Z).
    h(
      'mesh',
      { key: 'head', position: [0, 0.66, -0.74], castShadow: true },
      h('sphereGeometry', { args: [0.12, 20, 16] }),
      matte(C.skin, 0.8),
    ),
  ]);
});

// --- MonitorBox: bedside monitor on a pole. With a texture it shows the live ---
// Pixi waveform (judge room); without, a calm static blue face (generic rooms).
export const MonitorBox = memo(function MonitorBox({
  position = [0, 0, 0],
  rotation,
  texture = null,
  matRef,
}: Placed & {
  texture?: CanvasTexture | null;
  matRef?: RefObject<MeshStandardMaterial | null>;
}) {
  return h('group', { position, rotation }, [
    // Base.
    h(
      'mesh',
      { key: 'base', position: [0, 0.02, 0] },
      h('cylinderGeometry', { args: [0.16, 0.16, 0.04, 20] }),
      chrome(),
    ),
    // Pole.
    h(
      'mesh',
      { key: 'pole', position: [0, 0.48, 0] },
      h('cylinderGeometry', { args: [0.025, 0.025, 0.95, 10] }),
      chrome(),
    ),
    // Housing (ceramic white). No castShadow -- a small thin panel on the pole.
    h(
      'mesh',
      { key: 'housing', position: [0, 1.0, 0] },
      h('boxGeometry', { args: [0.56, 0.42, 0.08] }),
      matte(C.wall, 0.7),
    ),
    // Screen face (+Z). Emissive, toneMapped=false. With a texture it glows the
    // waveform at >1 so only it survives the bloom gate; static face stays <1.
    h(
      'mesh',
      { key: 'screen', position: [0, 1.0, 0.045] },
      h('planeGeometry', { args: [0.48, 0.3] }),
      h('meshStandardMaterial', {
        ref: matRef,
        map: texture ?? null,
        emissiveMap: texture ?? null,
        color: texture ? '#ffffff' : hex(C.brandTint),
        emissive: texture ? '#ffffff' : hex(C.brand),
        emissiveIntensity: texture ? 0.9 : 0.5,
        toneMapped: false,
        metalness: 0,
        roughness: 1,
      }),
    ),
  ]);
});

// --- IVPole: chrome pole, translucent brand bag, a single drip droplet --------
export const IVPole = memo(function IVPole({
  position = [0, 0, 0],
  rotation,
  dripRef,
}: Placed & { dripRef?: RefObject<Mesh | null> }) {
  return h('group', { position, rotation }, [
    h(
      'mesh',
      { key: 'base', position: [0, 0.02, 0] },
      h('cylinderGeometry', { args: [0.17, 0.17, 0.03, 16] }),
      chrome(),
    ),
    h(
      'mesh',
      { key: 'pole', position: [0, 1.0, 0] },
      h('cylinderGeometry', { args: [0.018, 0.018, 2.0, 10] }),
      chrome(),
    ),
    h(
      'mesh',
      { key: 'hook', position: [0, 1.95, 0], rotation: [Math.PI / 2, 0, 0] },
      h('torusGeometry', { args: [0.05, 0.012, 8, 20] }),
      chrome(),
    ),
    // Fluid bag (translucent brand).
    h(
      'mesh',
      { key: 'bag', position: [0, 1.72, 0] },
      h('boxGeometry', { args: [0.12, 0.22, 0.04] }),
      h('meshStandardMaterial', {
        color: hex(C.brand),
        emissive: hex(C.brand),
        emissiveIntensity: 0.3,
        toneMapped: false,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    ),
    // Drip droplet (DeviceDriver animates position.y).
    h(
      'mesh',
      { key: 'drip', ref: dripRef, position: [0, 1.55, 0] },
      h('sphereGeometry', { args: [0.012, 10, 10] }),
      h('meshStandardMaterial', {
        color: '#8fd3ff',
        emissive: hex(C.brand),
        emissiveIntensity: 0.5,
        toneMapped: false,
      }),
    ),
  ]);
});

// --- Chair: a soft plastic visitor chair --------------------------------------
export const Chair = memo(function Chair({ position = [0, 0, 0], rotation }: Placed) {
  const legs: Vec3[] = [
    [-0.16, 0.12, 0.16],
    [0.16, 0.12, 0.16],
    [-0.16, 0.12, -0.16],
    [0.16, 0.12, -0.16],
  ];
  return h('group', { position, rotation }, [
    // Seat: a thin flat slab -- no castShadow (keeps the ground read clean).
    h(
      'mesh',
      { key: 'seat', position: [0, 0.26, 0] },
      h('boxGeometry', { args: [0.42, 0.06, 0.42] }),
      matte(C.plastic, 0.8),
    ),
    h(
      'mesh',
      { key: 'back', position: [0, 0.48, -0.18] },
      h('boxGeometry', { args: [0.42, 0.4, 0.06] }),
      matte(C.plastic, 0.8),
    ),
    ...legs.map((p, i) =>
      h(
        'mesh',
        { key: `leg-${i}`, position: p },
        h('cylinderGeometry', { args: [0.02, 0.02, 0.24, 8] }),
        chrome(),
      ),
    ),
  ]);
});

// --- Plant: a ceramic pot + soft sage foliage (mint hue family, desaturated) --
export const Plant = memo(function Plant({ position = [0, 0, 0] }: Placed) {
  const blobs: Vec3[] = [
    [0, 0.6, 0],
    [0.12, 0.52, 0.06],
    [-0.1, 0.5, -0.05],
    [0.04, 0.72, -0.02],
  ];
  return h('group', { position }, [
    h(
      'mesh',
      { key: 'pot', position: [0, 0.16, 0], castShadow: true },
      h('cylinderGeometry', { args: [0.17, 0.13, 0.32, 16] }),
      matte(C.linen, 0.85),
    ),
    // Foliage blobs: small and high up -- no castShadow (the pot grounds it).
    ...blobs.map((p, i) =>
      h(
        'mesh',
        { key: `leaf-${i}`, position: p },
        h('icosahedronGeometry', { args: [0.17, 0] }),
        matte(0x8fb9a3, 0.9),
      ),
    ),
  ]);
});

// --- Door: a slim trim frame with a brand threshold strip ---------------------
export const Door = memo(function Door({ position = [0, 0, 0], rotation }: Placed) {
  return h('group', { position, rotation }, [
    h(
      'mesh',
      { key: 'left', position: [-0.52, 0.65, 0] },
      h('boxGeometry', { args: [0.08, 1.3, 0.14] }),
      matte(C.trim, 0.8),
    ),
    h(
      'mesh',
      { key: 'right', position: [0.52, 0.65, 0] },
      h('boxGeometry', { args: [0.08, 1.3, 0.14] }),
      matte(C.trim, 0.8),
    ),
    // Brand threshold strip on the floor.
    h(
      'mesh',
      { key: 'sill', position: [0, 0.02, 0] },
      h('boxGeometry', { args: [1.0, 0.03, 0.12] }),
      h('meshStandardMaterial', {
        color: hex(C.brand),
        emissive: hex(C.brand),
        emissiveIntensity: 0.25,
        toneMapped: false,
        metalness: 0,
        roughness: 0.8,
      }),
    ),
  ]);
});
