// Shared mutable handles for the ONE useFrame in DeviceDriver.
//
// Perf contract (spec §3): the scene subtree never reconciles on a device tick.
// Every animatable object therefore exposes a ref here; DeviceDriver reads the
// live device through getDevice() and mutates these refs in place each frame --
// the ward light rig, the judge-room focal materials/spot, the ventilator
// sub-meshes, the CODE HUD DOM node and the camera controls. Nothing in here is
// ever passed as a changing prop, so model components stay React.memo'd and
// static across ticks.
//
// The refs are created once (stable identity) in <Scene> via useSceneRefs() and
// handed down to Lighting / Effects / the ward / DeviceDriver. Effect refs can
// be null when a perf tier drops that effect, and mesh/material refs are null on
// the first frame before mount -- DeviceDriver null-checks all of them.

import { useRef } from 'react';
import type { RefObject } from 'react';
import type {
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  SpotLight,
} from 'three';
import type { ComponentRef } from 'react';
import type { BloomEffect, ChromaticAberrationEffect } from 'postprocessing';
import type { OrbitControls } from '@react-three/drei';

/** The imperative handle drei's <OrbitControls> forwards (three-stdlib impl). */
export type OrbitControlsHandle = ComponentRef<typeof OrbitControls>;

export interface SceneRefs {
  // --- animated sub-meshes (judge room) ------------------------------------
  /** Ventilator bellows cylinder (position.y / scale.y breathing + freeze). */
  bellows: RefObject<Mesh | null>;
  /** Ventilator status LED (emissive mint -> coral). */
  led: RefObject<Mesh | null>;
  /** Patient torso group (subtle breathing scale.y, frozen on crash). */
  breathing: RefObject<Group | null>;
  /** IV drip droplet (position.y fall). */
  drip: RefObject<Mesh | null>;
  /** Judge monitor screen material (emissive intensity ramp on alert). */
  screenMat: RefObject<MeshStandardMaterial | null>;

  // --- ward light rig (animated in place, never mounted/unmounted on alarm) -
  /** Sky/ground hemisphere -- the bright base; dims ~12% so the ward recedes. */
  hemi: RefObject<HemisphereLight | null>;
  /** Warm hero sun (only shadow caster); dims with the hemisphere. */
  sun: RefObject<DirectionalLight | null>;
  /** Judge-room focus spot; ramps up (0.15 -> ~0.95) on alert. */
  focusLight: RefObject<SpotLight | null>;

  // --- judge-room focal materials (warm-local money moment) ----------------
  /** Cove strip emissive (blue -> coral, 0.8 Hz breath on alert). */
  roomCove: RefObject<MeshStandardMaterial | null>;
  /** Floor halo ring color + opacity (always-on blue, warms + pulses). */
  focusRing: RefObject<MeshStandardMaterial | null>;
  /** Floor rug inlay accent color (blue -> soft amber). */
  inlayMat: RefObject<MeshStandardMaterial | null>;

  // --- post-processing effect instances ------------------------------------
  /** null when the current perf tier has dropped it. */
  bloom: RefObject<BloomEffect | null>;
  /** Kept for <Effects> prop compatibility; no longer wired to an effect. */
  chroma: RefObject<ChromaticAberrationEffect | null>;

  // --- HUD + camera --------------------------------------------------------
  /** Floating CODE banner wrapper; opacity driven directly on style. */
  codeHud: RefObject<HTMLDivElement | null>;
  /** Judge-room label chip; warms blue -> coral on admitted alarm. */
  pinEl: RefObject<HTMLDivElement | null>;
  /** Big floating judge-room STATUS chip ("STABLE" green / "NO AIR" red); its
   *  text + colour are driven imperatively by DeviceDriver on a device flip. */
  statusEl: RefObject<HTMLDivElement | null>;
  /** Crowd bodies InstancedMesh (ambient; driven in People.tsx, not here). */
  people: RefObject<InstancedMesh | null>;
  /** OrbitControls handle for the idle auto-orbit. */
  controls: RefObject<OrbitControlsHandle | null>;
  /** True while the viewer is actively dragging (pauses auto-orbit). */
  interacting: RefObject<boolean>;
}

/** Create the stable ref bundle. Call once, in <Scene>. */
export function useSceneRefs(): SceneRefs {
  return {
    bellows: useRef<Mesh | null>(null),
    led: useRef<Mesh | null>(null),
    breathing: useRef<Group | null>(null),
    drip: useRef<Mesh | null>(null),
    screenMat: useRef<MeshStandardMaterial | null>(null),
    hemi: useRef<HemisphereLight | null>(null),
    sun: useRef<DirectionalLight | null>(null),
    focusLight: useRef<SpotLight | null>(null),
    roomCove: useRef<MeshStandardMaterial | null>(null),
    focusRing: useRef<MeshStandardMaterial | null>(null),
    inlayMat: useRef<MeshStandardMaterial | null>(null),
    bloom: useRef<BloomEffect | null>(null),
    chroma: useRef<ChromaticAberrationEffect | null>(null),
    codeHud: useRef<HTMLDivElement | null>(null),
    pinEl: useRef<HTMLDivElement | null>(null),
    statusEl: useRef<HTMLDivElement | null>(null),
    people: useRef<InstancedMesh | null>(null),
    controls: useRef<OrbitControlsHandle | null>(null),
    interacting: useRef<boolean>(false),
  };
}
