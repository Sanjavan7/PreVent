// The ONE useFrame that animates the entire bright ward (spec §7c). It renders
// nothing.
//
// Perf contract: this is the single place anything (besides the crowd) moves per
// frame. It reads the live device through the stable getDevice() accessor, turns
// it into target visual parameters with the pure visualState() map, and eases
// every live value toward those targets with maath/easing damps -- mutating the
// ward light rig, the judge-room focal materials, the focus spot, the ventilator
// sub-meshes, the monitor emissive, the bloom and the DOM HUD in place. It NEVER
// calls setState, so SimPanel's per-tick re-renders never touch the scene graph.
//
// The money moment is WARM and LOCAL (spec §7): on a crash the judge room's cove
// strip, halo ring and floor rug warm blue -> amber -> coral and breathe at a
// slow 0.8 Hz, the focus spot rises, and the REST of the ward recedes only ~12%
// (hemisphere + sun dimmed, never dark). The monitor keeps beating the reported
// (lying) vitals until the device admits the alarm. Restore exhales everything
// back to calm blue. The crowd (People.tsx) is untouched and keeps strolling.
//
// Under reduced motion the bellows hold mid-stroke, the camera stops orbiting and
// the pulse flattens to its mean; the crash colours still resolve so the money
// moment still lands, just without motion.

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { MeshStandardMaterial } from 'three';
import { easing } from 'maath';
import type { DeviceStatus } from '@prevent/contracts';
import { visualState, ACCENT_BLUE, CORAL } from './visualState';
import { hex } from './palette';
import type { SceneRefs } from './sceneRefs';

// Ward light rig calm baselines (spec §6); the crash dims these ~12%, never dark.
const HEMI_CALM = 0.9;
const SUN_CALM = 1.8;
// Always-on judge-room pool (the "you are here" focal light), rising on alert.
const FOCUS_CALM = 0.55;
const FOCUS_ALERT = 1.1;

const LED_BASE_INTENSITY = 3;

// Bellows geometry (matches JudgeRoom.tsx: bellows mesh at y = 1.62).
const BELLOWS_BASE_Y = 1.62;
const RESP_PERIOD = 4; // 15 breaths/min -- fixed (no respiration field in DeviceStatus)

const TWO_PI = Math.PI * 2;
const PULSE_HZ = 0.8; // slow breath, NOT a strobe
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Chip colours for the judge-room label (blue calm -> coral on admitted alarm).
const CHIP_BLUE = hex(ACCENT_BLUE);
const CHIP_CORAL = hex(CORAL);

interface Props {
  getDevice: () => DeviceStatus;
  refs: SceneRefs;
  reducedMotion: boolean;
}

export function DeviceDriver({ getDevice, refs, reducedMotion }: Props) {
  // Persistent per-frame scalars eased toward their targets. Mutated, never
  // setState-d. Stable identity so maath's damp accumulates correctly.
  const env = useRef({
    alert: 0, // 0 calm-blue .. 1 coral (local to the judge room)
    focus: 0, // judge focus spot up + halo brighten
    dim: 0, // how much the rest of the ward recedes
    emissive: 1, // monitor screen emissive multiplier
    code: 0, // CODE HUD opacity
  });
  const phase = useRef({ bellows: 0, drip: 0 });
  const baseAz = useRef<number | null>(null);
  const lastAlarm = useRef<boolean | null>(null);

  useFrame((state, delta) => {
    // Clamp delta so a tab-return or GC stall can't fling a damp past its target.
    const dt = Math.min(delta, 1 / 20);
    const t = state.clock.elapsedTime;
    const d = getDevice();
    const v = visualState(d, Date.now());

    // Slow 0.8 Hz breath (flat at its mean under reduced motion). Never a strobe.
    const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * TWO_PI * PULSE_HZ);

    // ---- damp the warm-local axes (all eased; nothing snaps) ----------------
    easing.damp(env.current, 'alert', v.alertLevel, 0.5, dt);
    easing.damp(env.current, 'focus', v.focusOn ? 1 : 0, 0.6, dt);
    easing.damp(env.current, 'dim', v.restDim, 0.6, dt);
    easing.damp(env.current, 'emissive', v.emissive, 0.35, dt);
    easing.damp(env.current, 'code', v.codeOpacity, 0.3, dt);
    const alert = env.current.alert;
    const focus = env.current.focus;

    // ---- judge-room focal materials: warm blue -> coral, breathe on alert ---
    const cove = refs.roomCove.current;
    if (cove) {
      easing.dampC(cove.emissive, v.coveColor, 0.5, dt);
      cove.emissiveIntensity = lerp(0.3, 0.7 + 0.5 * pulse, alert);
    }
    const ring = refs.focusRing.current;
    if (ring) {
      easing.dampC(ring.color, v.ringColor, 0.5, dt);
      easing.dampC(ring.emissive, v.ringColor, 0.5, dt);
      // Always-on gentle halo; brightens + pulses as the room warms.
      ring.opacity = 0.35 + focus * (0.25 + 0.3 * pulse);
      ring.emissiveIntensity = lerp(0.9, 1.4, alert);
    }
    if (refs.inlayMat.current) {
      easing.dampC(refs.inlayMat.current.color, v.inlayColor, 0.5, dt);
    }

    // ---- the rest of the ward RECEDES ~12% (never dark); judge spot rises ----
    if (refs.hemi.current) refs.hemi.current.intensity = HEMI_CALM * (1 - env.current.dim);
    if (refs.sun.current) refs.sun.current.intensity = SUN_CALM * (1 - env.current.dim);
    if (refs.focusLight.current) {
      refs.focusLight.current.intensity = lerp(FOCUS_CALM, FOCUS_ALERT, focus);
    }

    // ---- judge monitor screen emissive (stays legible; the lie keeps beating) -
    if (refs.screenMat.current) {
      refs.screenMat.current.emissiveIntensity = 0.9 * env.current.emissive;
    }

    // ---- bloom nudged with alert (only emissive screens/halo bloom) ----------
    if (refs.bloom.current) {
      refs.bloom.current.intensity = 0.35 + 0.15 * alert;
    }

    // ---- ventilator status LED (mint -> coral; subtle pulse on alert) --------
    if (refs.led.current) {
      const mat = refs.led.current.material as MeshStandardMaterial;
      easing.dampC(mat.emissive, v.ledColor, 0.3, dt);
      mat.emissiveIntensity = LED_BASE_INTENSITY + (v.compromised ? 0.6 : 0) + alert * pulse * 0.8;
    }

    // ---- bellows: breathe while fanOn, freeze + slump when it stops ----------
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

    // ---- patient chest: subtle rise synced to the bellows --------------------
    const breathing = refs.breathing.current;
    if (breathing) {
      let chest = 1;
      if (v.bellowsActive && !reducedMotion) {
        const stroke = 0.5 + 0.5 * Math.sin(phase.current.bellows * TWO_PI);
        chest = 1 + stroke * 0.035;
      }
      easing.damp(breathing.scale, 'y', chest, 0.2, dt);
    }

    // ---- IV drip (cosmetic sawtooth) ----------------------------------------
    const drip = refs.drip.current;
    if (drip) {
      if (!reducedMotion) phase.current.drip += dt * 0.6;
      const frac = phase.current.drip - Math.floor(phase.current.drip);
      drip.position.y = 1.55 - frac * 0.14;
    }

    // ---- CODE HUD opacity (crisp DOM, no bloom) -----------------------------
    if (refs.codeHud.current) {
      refs.codeHud.current.style.opacity = env.current.code.toFixed(3);
    }

    // ---- judge-room label chip warms only when the alarm state flips ---------
    if (lastAlarm.current !== v.alarm && refs.pinEl.current) {
      const el = refs.pinEl.current;
      const c = v.alarm ? CHIP_CORAL : CHIP_BLUE;
      el.style.color = c;
      el.style.borderColor = c;
      el.style.boxShadow = v.alarm
        ? '0 2px 14px rgba(255,107,91,0.35)'
        : '0 2px 10px rgba(0,151,254,0.18)';
      lastAlarm.current = v.alarm;
    }

    // ---- idle auto-orbit (paused while the viewer drags / reduced motion) ----
    const controls = refs.controls.current;
    if (controls) {
      if (refs.interacting.current || reducedMotion) {
        // Track the live angle so releasing the drag resumes without a jump.
        baseAz.current = controls.getAzimuthalAngle();
      } else {
        if (baseAz.current === null) baseAz.current = controls.getAzimuthalAngle();
        controls.setAzimuthalAngle(baseAz.current + 0.1 * Math.sin(t * 0.06));
        controls.update();
      }
    }
  });

  return null;
}
