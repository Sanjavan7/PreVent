// The strolling crowd (spec §5). Primitive peg-people as exactly TWO
// InstancedMesh -- bodies (capsules) + heads (spheres) -> 2 draw calls for the
// whole ward. They walk a shared waypoint loop in THIS component's OWN useFrame
// (separate from DeviceDriver by design, still frame-loop-only: no setState, no
// per-frame React work). Matrices are written through one shared Object3D dummy.
//
// The crowd is intentionally UNAFFECTED by the crash -- while the judge room
// warms and pulses, everyone keeps strolling calmly. That contrast ("one patient
// out of thousands, caught in time") is the narrative. Colours are calm scrubs
// in the brand/neutral/mint families only -- never raw red or green.
//
// Count scales with the perf tier; capped on low-core machines so the ward is
// never empty (the owner's vision is "people walking around"). Reduced motion
// freezes everyone mid-stroll (static positions, no bob).

import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, Object3D } from 'three';
import type { InstancedMesh } from 'three';
import { easing } from 'maath';
import type { WardLayout } from './layout';
import type { PerfTier } from '../Effects';
import { C } from '../palette';

interface Props {
  layout: WardLayout;
  reducedMotion: boolean;
  tier: PerfTier;
}

const COUNT_BY_TIER: Record<PerfTier, number> = { HIGH: 10, MED: 6, LOW: 4 };

// Calm scrub colours (brand / neutral-slate / soft-teal) -- no red/green.
const SCRUBS = [0xbfe4ff, 0x9fb0c3, 0x7fc8bf, 0xc7d0d9, 0x0097fe];

const BODY_Y = 0.43; // capsule centre so the feet sit near the floor
const HEAD_Y = 0.98;

interface Walker {
  seg: number; // current waypoint segment index
  t: number; // 0..1 progress along the segment
  speed: number; // m/s
  lane: number; // perpendicular offset across the corridor
  phase: number; // walk-bob phase offset
  yaw: number; // damped heading
}

export const People = memo(function People({ layout, reducedMotion, tier }: Props) {
  const cores =
    (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 8;
  const base = COUNT_BY_TIER[tier];
  // Keep a few walkers even on modest hardware (vision: a living ward).
  const count = cores < 6 ? Math.min(base, 4) : base;

  const bodies = useRef<InstancedMesh>(null);
  const heads = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);

  const wp = layout.waypoints;
  const nSeg = wp.length;

  // Segment lengths (XZ) for constant-speed interpolation.
  const segLen = useMemo(() => {
    return wp.map((p, i) => {
      const q = wp[(i + 1) % nSeg];
      const dx = q[0] - p[0];
      const dz = q[2] - p[2];
      return Math.hypot(dx, dz) || 1;
    });
  }, [wp, nSeg]);

  // Deterministic initial walker states, staggered around the loop.
  const walkers = useMemo<Walker[]>(() => {
    const out: Walker[] = [];
    for (let i = 0; i < count; i++) {
      const frac = i / Math.max(count, 1);
      out.push({
        seg: Math.floor(frac * nSeg) % nSeg,
        t: (frac * nSeg) % 1,
        speed: 0.55 + ((i * 37) % 10) / 40, // ~0.55..0.80 m/s
        lane: (((i * 53) % 100) / 100 - 0.5) * (layout.corridor.depth - 0.8),
        phase: (i * 1.7) % (Math.PI * 2),
        yaw: 0,
      });
    }
    return out;
  }, [count, nSeg, layout.corridor.depth]);

  // Place a walker's body+head matrices for the current state.
  const write = (w: Walker, i: number, bob: number) => {
    const a = wp[w.seg];
    const b = wp[(w.seg + 1) % nSeg];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dz) || 1;
    // Perpendicular (left) unit vector for the lane offset.
    const px = -dz / len;
    const pz = dx / len;
    const x = a[0] + dx * w.t + px * w.lane;
    const z = a[2] + dz * w.t + pz * w.lane;

    dummy.rotation.set(0, w.yaw, 0);
    dummy.position.set(x, BODY_Y + bob, z);
    dummy.updateMatrix();
    bodies.current?.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, HEAD_Y + bob, z);
    dummy.updateMatrix();
    heads.current?.setMatrixAt(i, dummy.matrix);
  };

  // Colours + initial matrices once the instanced meshes mount.
  useLayoutEffect(() => {
    const col = new Color();
    walkers.forEach((w, i) => {
      // Heading from the current segment.
      const a = wp[w.seg];
      const b = wp[(w.seg + 1) % nSeg];
      w.yaw = Math.atan2(b[0] - a[0], b[2] - a[2]);
      write(w, i, 0);
      if (bodies.current) bodies.current.setColorAt(i, col.set(SCRUBS[i % SCRUBS.length]));
      if (heads.current) heads.current.setColorAt(i, col.set(C.skin));
    });
    if (bodies.current) {
      bodies.current.instanceMatrix.needsUpdate = true;
      if (bodies.current.instanceColor) bodies.current.instanceColor.needsUpdate = true;
    }
    if (heads.current) {
      heads.current.instanceMatrix.needsUpdate = true;
      if (heads.current.instanceColor) heads.current.instanceColor.needsUpdate = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkers]);

  useFrame((state, delta) => {
    if (reducedMotion) return; // frozen; initial matrices already written
    const dt = Math.min(delta, 1 / 20);
    const t = state.clock.elapsedTime;
    for (let i = 0; i < walkers.length; i++) {
      const w = walkers[i];
      w.t += (dt * w.speed) / segLen[w.seg];
      while (w.t >= 1) {
        w.t -= 1;
        w.seg = (w.seg + 1) % nSeg;
      }
      const a = wp[w.seg];
      const b = wp[(w.seg + 1) % nSeg];
      const targetYaw = Math.atan2(b[0] - a[0], b[2] - a[2]);
      easing.dampAngle(w, 'yaw', targetYaw, 0.25, dt);
      const bob = Math.sin(t * 8 + w.phase) * 0.015;
      write(w, i, bob);
    }
    if (bodies.current) bodies.current.instanceMatrix.needsUpdate = true;
    if (heads.current) heads.current.instanceMatrix.needsUpdate = true;
  });

  if (count === 0) return null;

  return (
    <>
      <instancedMesh ref={bodies} args={[undefined, undefined, count]} castShadow frustumCulled={false}>
        <capsuleGeometry args={[0.18, 0.5, 4, 8]} />
        <meshStandardMaterial metalness={0} roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, count]} castShadow frustumCulled={false}>
        <sphereGeometry args={[0.13, 12, 10]} />
        <meshStandardMaterial metalness={0} roughness={0.8} />
      </instancedMesh>
    </>
  );
});
