// Shared mutable handles for the ONE useFrame in DeviceDriver.
//
// Perf contract (spec §3): the scene subtree never reconciles on a device tick.
// Every animatable object therefore exposes a ref here; DeviceDriver reads the
// live device through getDevice() and mutates these refs in place each frame --
// lights, effect uniforms, sub-meshes, the CODE HUD DOM node and the camera
// controls. Nothing in here is ever passed as a changing prop, so model
// components stay React.memo'd and static across ticks.
//
// The refs are created once (stable identity) in <Scene> via useSceneRefs() and
// handed down to Lighting / Effects / the models / DeviceDriver. Effect refs can
// be null when a perf tier drops that effect, and mesh/material refs are null on
// the first frame before mount -- DeviceDriver null-checks all of them.

import { useRef } from 'react';
import type { RefObject } from 'react';
import type {
  AmbientLight,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
} from 'three';
import type { ComponentRef } from 'react';
import type { BloomEffect, ChromaticAberrationEffect } from 'postprocessing';
import type { OrbitControls } from '@react-three/drei';

/** The imperative handle drei's <OrbitControls> forwards (three-stdlib impl). */
export type OrbitControlsHandle = ComponentRef<typeof OrbitControls>;

export interface SceneRefs {
  // --- animated sub-meshes -------------------------------------------------
  /** Ventilator bellows cylinder (position.y / scale.y breathing + freeze). */
  bellows: RefObject<Mesh | null>;
  /** Ventilator status LED (emissive green -> red). */
  led: RefObject<Mesh | null>;
  /** Patient torso group (subtle breathing scale.y, frozen on crash). */
  breathing: RefObject<Group | null>;
  /** IV drip droplet (position.y fall). */
  drip: RefObject<Mesh | null>;
  /** Monitor screen material (emissive intensity ramp on alarm). */
  screenMat: RefObject<MeshStandardMaterial | null>;

  // --- lights (animated in place, never mounted/unmounted on alarm) --------
  ambient: RefObject<AmbientLight | null>;
  rim: RefObject<DirectionalLight | null>;
  key: RefObject<PointLight | null>;
  fill: RefObject<PointLight | null>;

  // --- post-processing effect instances ------------------------------------
  /** null when the current perf tier has dropped it. */
  bloom: RefObject<BloomEffect | null>;
  /** null below the HIGH perf tier. */
  chroma: RefObject<ChromaticAberrationEffect | null>;

  // --- HUD + camera --------------------------------------------------------
  /** Floating CODE banner wrapper; opacity driven directly on style. */
  codeHud: RefObject<HTMLDivElement | null>;
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
    ambient: useRef<AmbientLight | null>(null),
    rim: useRef<DirectionalLight | null>(null),
    key: useRef<PointLight | null>(null),
    fill: useRef<PointLight | null>(null),
    bloom: useRef<BloomEffect | null>(null),
    chroma: useRef<ChromaticAberrationEffect | null>(null),
    codeHud: useRef<HTMLDivElement | null>(null),
    controls: useRef<OrbitControlsHandle | null>(null),
    interacting: useRef<boolean>(false),
  };
}
