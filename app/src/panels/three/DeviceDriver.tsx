// The ONE useFrame that animates the entire scene (spec §5). It renders nothing.
//
// Perf contract: this is the single place anything moves per frame. It reads the
// live device through the stable getDevice() accessor, turns it into target
// visual parameters with the pure visualState() map, and eases every live value
// toward those targets with maath/easing damps -- mutating lights, effect
// uniforms, sub-meshes, the CODE HUD DOM node and the camera in place. It NEVER
// calls setState, so SimPanel's per-tick re-renders never touch the scene graph.
//
// Two independent emotional axes (both damped, so crash + restore feel organic):
//   - `red`    follows the PHYSICAL truth (isCrashed: fan off OR true vitals
//              collapsed OR alarm). The room reddens and bloom swells even while
//              the device stays silent -- that is the visible lie.
//   - `strobe` follows the ADMITTED alarm (alarmActive). It adds the ~2.2 Hz red
//              pulse, the extra bloom spike and the CODE HUD. The on-screen
//              flatline/glitch is owned by the Pixi texture, not here, and the
//              alarm audio is owned by Pixi too -- never double-fired here.
//
// Under reduced motion the bellows hold mid-stroke, the camera stops orbiting
// and the strobe pulse flattens to its mean; the crash colours still resolve so
// the money moment still lands, just without motion.

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { MeshStandardMaterial } from 'three';
import { easing } from 'maath';
import type { DeviceStatus } from '@prevent/contracts';
import { visualState } from './visualState';
import type { SceneRefs } from './sceneRefs';

// Healthy light values (spec §4) used as the calm end of each lerp.
const AMBIENT_CALM = 0x0a1420;
const AMBIENT_ALARM = 0x200607;
const FILL_CALM = 0x2b5f8a;
const FILL_ALARM = 0x7a2630;

const KEY_CALM = 2.4;
const KEY_ALARM_BASE = 1.6;
const KEY_ALARM_AMP = 1.8; // pulses 1.6 <-> 3.4
const RIM_CALM = 0.9;
const RIM_ALARM = 1.15;
const AMBIENT_INT_CALM = 0.06;
const AMBIENT_INT_ALARM = 0.05;

const LED_BASE_INTENSITY = 3;

// Bellows geometry (matches Ventilator.tsx: bellows mesh at y = 1.62).
const BELLOWS_BASE_Y = 1.62;
const RESP_PERIOD = 4; // 15 breaths/min -- fixed (no respiration field in DeviceStatus)

const TWO_PI = Math.PI * 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Props {
  getDevice: () => DeviceStatus;
  refs: SceneRefs;
  reducedMotion: boolean;
}

export function DeviceDriver({ getDevice, refs, reducedMotion }: Props) {
  // Persistent per-frame scalars eased toward their targets. Mutated, never
  // setState-d.
  const env = useRef({
    red: 0, // physical crash (0 calm blue .. 1 emergency red)
    strobe: 0, // admitted alarm (drives pulse + CODE HUD)
    emissive: 1, // monitor screen emissive multiplier
    code: 0, // CODE HUD opacity
    bloom: -1, // damped bloom intensity (-1 = uninitialised)
    chroma: 0, // aberration widen amount
  });
  const phase = useRef({ bellows: 0, drip: 0 });
  const calmBloom = useRef<number | null>(null);
  const baseAz = useRef<number | null>(null);

  useFrame((state, delta) => {
    // Clamp delta so a tab-return or GC stall can't fling a damp past its target.
    const dt = Math.min(delta, 1 / 20);
    const t = state.clock.elapsedTime;
    const d = getDevice();
    const v = visualState(d, Date.now());

    // ---- damp the two emotional axes + screen emissive ---------------------
    easing.damp(env.current, 'red', v.crashed ? 1 : 0, 0.3, dt);
    easing.damp(env.current, 'strobe', v.alarm ? 1 : 0, 0.25, dt);
    easing.damp(env.current, 'emissive', v.alarm ? 1.8 : 1, 0.35, dt);
    easing.damp(env.current, 'code', v.alarm ? 1 : 0, 0.3, dt);
    easing.damp(env.current, 'chroma', v.compromised ? 1 : 0, 0.4, dt);
    const red = env.current.red;
    const strobe = env.current.strobe;

    // ~2.2 Hz red heartbeat; flat at its mean under reduced motion.
    const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * TWO_PI * 2.2);
    const staleDim = v.stale ? 0.85 : 1;

    // ---- lights (same objects, lerped -- never remounted) ------------------
    const { key, rim, ambient, fill, led } = refs;
    if (key.current) {
      easing.dampC(key.current.color, v.accentColor, 0.5, dt);
      const base = lerp(KEY_CALM, KEY_ALARM_BASE, red);
      key.current.intensity = (base + KEY_ALARM_AMP * strobe * pulse) * staleDim;
    }
    if (rim.current) {
      easing.dampC(rim.current.color, v.accentColor, 0.5, dt);
      rim.current.intensity = lerp(RIM_CALM, RIM_ALARM, red);
    }
    if (ambient.current) {
      easing.dampC(
        ambient.current.color,
        red > 0.5 ? AMBIENT_ALARM : AMBIENT_CALM,
        0.5,
        dt,
      );
      ambient.current.intensity = lerp(AMBIENT_INT_CALM, AMBIENT_INT_ALARM, red);
    }
    if (fill.current) {
      easing.dampC(fill.current.color, red > 0.5 ? FILL_ALARM : FILL_CALM, 0.5, dt);
    }

    // ---- ventilator status LED --------------------------------------------
    if (led.current) {
      const mat = led.current.material as MeshStandardMaterial;
      easing.dampC(mat.emissive, v.ledColor, 0.3, dt);
      mat.emissiveIntensity =
        LED_BASE_INTENSITY + strobe * pulse + (v.compromised ? 0.6 : 0);
    }

    // ---- monitor screen emissive ramp -------------------------------------
    if (refs.screenMat.current) {
      refs.screenMat.current.emissiveIntensity = 1.4 * env.current.emissive;
    }

    // ---- bellows: breathe while fanOn, freeze + slump when it stops --------
    const bellows = refs.bellows.current;
    if (bellows) {
      let targetScaleY: number;
      let targetPosY: number;
      if (v.bellowsActive) {
        if (!reducedMotion) phase.current.bellows += dt / RESP_PERIOD;
        const stroke = 0.5 + 0.5 * Math.sin(phase.current.bellows * TWO_PI);
        targetScaleY = reducedMotion ? 0.86 : 0.72 + stroke * 0.28;
        targetPosY = BELLOWS_BASE_Y + (stroke - 0.5) * 0.05;
      } else {
        // Fan stopped: hold phase (freeze mid-stroke) and sink to a slump.
        targetScaleY = 0.6;
        targetPosY = BELLOWS_BASE_Y - 0.05;
      }
      easing.damp(bellows.scale, 'y', targetScaleY, 0.18, dt);
      easing.damp(bellows.position, 'y', targetPosY, 0.18, dt);
    }

    // ---- patient chest: subtle rise synced to the bellows ------------------
    const breathing = refs.breathing.current;
    if (breathing) {
      let chest = 1;
      if (v.bellowsActive && !reducedMotion) {
        const stroke = 0.5 + 0.5 * Math.sin(phase.current.bellows * TWO_PI);
        chest = 1 + stroke * 0.035;
      }
      easing.damp(breathing.scale, 'y', chest, 0.2, dt);
    }

    // ---- IV drip (cosmetic sawtooth) --------------------------------------
    const drip = refs.drip.current;
    if (drip) {
      if (!reducedMotion) phase.current.drip += dt * 0.6;
      const frac = phase.current.drip - Math.floor(phase.current.drip);
      drip.position.y = 1.55 - frac * 0.14;
    }

    // ---- post FX: bloom swell + chromatic widen on crash ------------------
    const bloom = refs.bloom.current;
    if (bloom) {
      if (calmBloom.current === null) calmBloom.current = bloom.intensity;
      const target =
        calmBloom.current + red * 0.7 + strobe * (0.3 + 0.4 * pulse);
      easing.damp(env.current, 'bloom', target, 0.3, dt);
      bloom.intensity = env.current.bloom;
    }
    const chroma = refs.chroma.current;
    if (chroma) {
      const off =
        0.0006 + red * 0.0012 + env.current.chroma * 0.001 + strobe * pulse * 0.0006;
      chroma.offset.set(off, off);
    }

    // ---- CODE HUD opacity (crisp DOM, no bloom) ---------------------------
    if (refs.codeHud.current) {
      refs.codeHud.current.style.opacity = env.current.code.toFixed(3);
    }

    // ---- idle auto-orbit (paused while the viewer drags / reduced motion) --
    const controls = refs.controls.current;
    if (controls) {
      if (refs.interacting.current || reducedMotion) {
        // Track the live angle so releasing the drag resumes without a jump.
        baseAz.current = controls.getAzimuthalAngle();
      } else {
        if (baseAz.current === null) baseAz.current = controls.getAzimuthalAngle();
        controls.setAzimuthalAngle(baseAz.current + 0.18 * Math.sin(t * 0.12));
        controls.update();
      }
    }
  });

  return null;
}
