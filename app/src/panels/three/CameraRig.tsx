// Smooth click-to-focus camera glide for the bright cutaway ward.
//
// Selection is DISCRETE React state (set on pointer events in WardInteractions);
// this component owns the ONLY extra per-frame camera work. In one useFrame it
// eases the OrbitControls target and the camera distance toward the selected
// room's centre (read from ROOM_LAYOUT) -- or back to the overview framing when
// nothing is selected -- with maath/easing damps. It NEVER calls setState per
// frame and NEVER remounts OrbitControls.
//
// It is deliberately cooperative with the two things that already touch the
// camera: DeviceDriver's idle azimuth sway and the viewer's own orbiting. It
// only drives the camera WHILE a glide is in progress (a selection just changed
// and the damps have not yet settled); once settled it releases control back to
// OrbitControls, so the viewer can freely orbit/zoom and the idle sway keeps
// swinging around the newly-focused pivot. Distance is re-applied along the
// CURRENT view direction each frame, so the azimuth/polar the sway or the user
// set is always preserved -- selecting a room only re-targets the orbit pivot.
//
// Reduced motion: the Canvas runs frameloop="demand", so the per-frame damp
// never ticks. Instead an effect SNAPS the target + distance on each selection
// change and invalidates once -- the focus lands instantly, no glide.

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { easing } from 'maath';
import { ROOM_LAYOUT } from './ward/layout';
import type { OrbitControlsHandle } from './sceneRefs';

// The default overview pivot -- mirrors <OrbitControls target> in Scene.tsx.
const OVERVIEW_TARGET: [number, number, number] = [-1.5, 0.5, -1];
// Look slightly above the floor (bed height) when a room is focused.
const FOCUS_Y = 0.55;
// Pull the camera in to this fraction of the overview distance on focus.
const FOCUS_DIST_FACTOR = 0.62;
// Tighter pull on a crash -- a cinematic push-in on the judge room during the
// attack, released back to FOCUS_DIST_FACTOR on restore.
const CRASH_DIST_FACTOR = 0.42;
// maath smoothTime -> ~0.6-0.9s to settle. Smaller = snappier.
const GLIDE_SMOOTH = 0.32;
// Clamp to the OrbitControls min/max distance (Scene.tsx: 16 / 44).
const MIN_DIST = 16;
const MAX_DIST = 44;
// Fallback until the fitted overview distance is measured live.
const FALLBACK_OVERVIEW_DIST = 27;

interface Props {
  controlsRef: RefObject<OrbitControlsHandle | null>;
  selectedId: string | null;
  reducedMotion: boolean;
  /** Live physical-crash signal (written by DeviceDriver). On its rising edge the
   *  rig dollies IN on the focused room; on the falling edge it eases back out. */
  crashedRef: RefObject<boolean>;
  /** True while the viewer is actively dragging -- we don't engage the crash
   *  push-in mid-orbit so we never fight the user's camera. */
  interactingRef: RefObject<boolean>;
}

function roomCenter(id: string | null): [number, number, number] | null {
  if (!id) return null;
  const room = ROOM_LAYOUT.rooms.find((r) => r.id === id);
  return room ? room.center : null;
}

export function CameraRig({
  controlsRef,
  selectedId,
  reducedMotion,
  crashedRef,
  interactingRef,
}: Props) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);

  // The canonical overview distance, measured live from the fitted framing
  // before the first selection (pan is disabled, so it never drifts after).
  const overviewDist = useRef(FALLBACK_OVERVIEW_DIST);
  const everSelected = useRef(false);
  // The eased distance scalar (re-seeded from reality at each glide start).
  const dist = useRef({ d: FALLBACK_OVERVIEW_DIST });
  const lastSelected = useRef<string | null>(null);
  const animating = useRef(false);
  const offset = useRef(new Vector3());
  const goal = useRef(new Vector3());
  // Whether we're currently dollied IN for a crash (drives the distance factor).
  const pushIn = useRef(false);
  const lastCrashed = useRef(false);

  // Write the desired target into `goal` and return the desired distance.
  const desired = (): number => {
    const c = roomCenter(selectedId);
    if (c) {
      goal.current.set(c[0], FOCUS_Y, c[2]);
      const factor = pushIn.current ? CRASH_DIST_FACTOR : FOCUS_DIST_FACTOR;
      return Math.max(MIN_DIST, Math.min(MAX_DIST, overviewDist.current * factor));
    }
    goal.current.set(OVERVIEW_TARGET[0], OVERVIEW_TARGET[1], OVERVIEW_TARGET[2]);
    return overviewDist.current;
  };

  // Reduced motion: snap (there is no continuous frameloop to glide with).
  useEffect(() => {
    if (!reducedMotion) return;
    const controls = controlsRef.current;
    if (!controls) return;
    // Leave the initial Bounds framing untouched; just remember its distance.
    if (!selectedId && !everSelected.current) {
      overviewDist.current = camera.position.distanceTo(controls.target);
      lastSelected.current = selectedId;
      return;
    }
    if (selectedId) everSelected.current = true;
    const d = desired();
    controls.target.copy(goal.current);
    offset.current.copy(camera.position).sub(controls.target);
    if (offset.current.lengthSq() < 1e-6) offset.current.set(0, 1, 1);
    offset.current.setLength(d);
    camera.position.copy(controls.target).add(offset.current);
    dist.current.d = d;
    lastSelected.current = selectedId;
    controls.update();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, reducedMotion]);

  useFrame((_, delta) => {
    if (reducedMotion) return;
    const controls = controlsRef.current;
    if (!controls) return;
    const dt = Math.min(delta, 1 / 20);

    if (selectedId) everSelected.current = true;
    // Track the fitted overview distance until the first selection ever.
    if (!selectedId && !everSelected.current) {
      const d0 = camera.position.distanceTo(controls.target);
      overviewDist.current = d0;
      dist.current.d = d0;
    }

    // A selection change (re)starts a glide, seeding the distance from reality
    // so we ease from wherever the camera actually is (incl. user zoom).
    if (selectedId !== lastSelected.current) {
      animating.current = true;
      dist.current.d = camera.position.distanceTo(controls.target);
      lastSelected.current = selectedId;
    }

    // A crash edge (re)starts a glide too, so the camera dollies IN on the
    // focused room during the attack (and eases back out on restore) even though
    // the selection never changes. We don't engage mid-drag, so we never yank the
    // camera out from under a viewer who's actively orbiting. (reducedMotion
    // already returned above -- no push-in there.)
    const crashed = !!crashedRef.current;
    if (crashed !== lastCrashed.current) {
      lastCrashed.current = crashed;
      if (!interactingRef.current) {
        pushIn.current = crashed;
        animating.current = true;
        dist.current.d = camera.position.distanceTo(controls.target);
      }
    }
    if (!animating.current) return;

    const d = desired();
    const tRunning = easing.damp3(
      controls.target,
      [goal.current.x, goal.current.y, goal.current.z],
      GLIDE_SMOOTH,
      dt,
    );
    const dRunning = easing.damp(dist.current, 'd', d, GLIDE_SMOOTH, dt);

    // Re-apply the eased distance along the CURRENT view direction, preserving
    // the azimuth/polar that the idle sway and the user set.
    offset.current.copy(camera.position).sub(controls.target);
    if (offset.current.lengthSq() < 1e-6) offset.current.set(0, 1, 1);
    offset.current.setLength(dist.current.d);
    camera.position.copy(controls.target).add(offset.current);
    controls.update();

    // Settled on both axes -> hand the camera back to OrbitControls.
    if (!tRunning && !dRunning) animating.current = false;
  });

  return null;
}
