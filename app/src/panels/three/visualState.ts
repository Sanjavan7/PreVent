// Pure, side-effect-free mapping from a DeviceStatus row to the TARGET visual
// parameters of the 3D scene. This is intentionally a plain function (no React,
// no three) so it can be unit-reasoned and called once per frame inside the
// DeviceDriver's single useFrame (Stage 7) to compute damp targets.
//
// It does NOT mutate anything and never reads the clock implicitly -- `now` is
// injected so callers stay deterministic. Every field is a *target*; the
// DeviceDriver eases the live scene toward these with maath/easing so crashes
// and restores feel organic instead of snap-cut.

import type { DeviceStatus } from '@prevent/contracts';

// sRGB hex ints (authoring space) for the two emotional poles of the scene.
export const ACCENT_BLUE = 0x0097fe; // calm, healthy key/rim light + screen glow
export const ALARM_RED = 0xff1d2e; // crash key/rim light
export const LED_GREEN = 0x00ff9c; // healthy ventilator status LED
export const LED_RED = 0xff1d2e; // compromised / alarm LED

/** Monitor key light intensity envelope (see spec §4). */
export const KEY_INTENSITY_CALM = 2.4;
export const KEY_INTENSITY_ALARM_BASE = 1.6;
export const KEY_INTENSITY_ALARM_AMP = 1.8; // pulses 1.6 <-> 3.4

/** A device is considered physically crashed when the truth diverges from safe,
 * the ventilator has stopped, or the device finally admits the alarm. */
export function isCrashed(d: DeviceStatus): boolean {
  return !d.fanOn || d.trueSpo2 < 85 || d.trueHr < 40 || d.alarmActive;
}

export interface VisualTargets {
  /** True physical emergency (room should redden, bloom should spike). */
  crashed: boolean;
  /** The device has admitted the alarm (red strobe + flatline + CODE HUD). */
  alarm: boolean;
  /** Firmware compromised (screen glitch + red vent LED even while numbers lie). */
  compromised: boolean;
  /** Reported vitals diverge from true vitals (optional "SIGNAL SUSPECT"). */
  lying: boolean;
  /** No fresh row for >3s (desaturate + "LINK LOST"). */
  stale: boolean;

  /** Target color for the key + rim lights (sRGB hex int). */
  accentColor: number;
  /** Target emissive color for the ventilator status LED. */
  ledColor: number;

  /** Base intensity for the monitor key light (pre-pulse). */
  keyIntensityBase: number;
  /** Amplitude of the red alarm pulse added on top of the base. */
  keyIntensityAmp: number;

  /** 0 = calm blue environment, 1 = full emergency red. */
  red: number;
  /** 0 = live trace, 1 = collapsed flatline. */
  flat: number;
  /** 0 = clean screen, 1 = full glitch band. */
  glitch: number;
  /** Multiplier on the monitor screen emissive (spikes with the alarm). */
  emissive: number;
  /** 0..1 opacity of the floating CODE HUD. */
  codeOpacity: number;
  /** Whether the bellows phase should keep advancing this frame. */
  bellowsActive: boolean;
}

/**
 * Map a device row to its target visual parameters.
 *
 * @param d    the single source-of-truth device row
 * @param now  epoch ms (injected for determinism; defaults to Date.now())
 */
export function visualState(d: DeviceStatus, now: number = Date.now()): VisualTargets {
  const crashed = isCrashed(d);
  const alarm = d.alarmActive;
  const stale = now - d.updatedAt > 3000;
  const lying = d.reportedHr !== d.trueHr || d.reportedSpo2 !== d.trueSpo2;

  return {
    crashed,
    alarm,
    compromised: d.compromised,
    lying,
    stale,

    accentColor: crashed ? ALARM_RED : ACCENT_BLUE,
    ledColor: d.compromised || alarm ? LED_RED : LED_GREEN,

    keyIntensityBase: alarm ? KEY_INTENSITY_ALARM_BASE : KEY_INTENSITY_CALM,
    keyIntensityAmp: alarm ? KEY_INTENSITY_ALARM_AMP : 0,

    red: alarm ? 1 : 0,
    flat: alarm ? 1 : 0,
    glitch: d.compromised ? 1 : 0,
    emissive: alarm ? 2.5 : 1,
    codeOpacity: alarm ? 1 : 0,
    // The bellows keep breathing only while the fan is physically on; the
    // moment it stops they freeze mid-stroke and slump.
    bellowsActive: d.fanOn,
  };
}
