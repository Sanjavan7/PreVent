// Pure, side-effect-free mapping from a DeviceStatus row to the TARGET visual
// parameters of the bright ward (spec §7b). This is intentionally a plain
// function (no React, no three) so it can be unit-reasoned and called once per
// frame inside the DeviceDriver's single useFrame to compute damp targets.
//
// It does NOT mutate anything and never reads the clock implicitly -- `now` is
// injected so callers stay deterministic. Every field is a *target*; the
// DeviceDriver eases the live scene toward these with maath/easing so crashes
// and restores feel organic instead of snap-cut.
//
// The alert axis is WARM and LOCAL to the judge room (blue -> amber -> coral),
// never a whole-room red strobe and never a darkening of the hospital. The rest
// of the ward stays bright; a crash reads by FOCUS + WARMTH only.

import type { DeviceStatus } from '@prevent/contracts';

// sRGB hex ints (authoring space) for the warm-local alert axis.
export const ACCENT_BLUE = 0x0097fe; // calm halo / cove / inlay
export const SOFT_ALERT = 0xffb020; // amber -- physical crash, pre-admission
export const CORAL = 0xff6b5b; // coral -- admitted alarm (never raw red)
export const MINT = 0x3ddc97; // healthy ventilator status LED

/** A device is considered physically crashed when the truth diverges from safe,
 * the ventilator has stopped, or the device finally admits the alarm. */
export function isCrashed(d: DeviceStatus): boolean {
  return !d.fanOn || d.trueSpo2 < 85 || d.trueHr < 40 || d.alarmActive;
}

export interface VisualTargets {
  /** True physical emergency (judge room warms + pulses). */
  crashed: boolean;
  /** The device has admitted the alarm (ring coral + CODE HUD + flatline). */
  alarm: boolean;
  /** Firmware compromised (coral vent LED even while the numbers lie). */
  compromised: boolean;
  /** Reported vitals diverge from true vitals (the visible lie). */
  lying: boolean;
  /** No fresh row for >3s. */
  stale: boolean;

  /** 0 = calm blue, 1 = full warm (coral) -- LOCAL to the judge room. */
  alertLevel: number;
  /** Judge focus spot up + halo brightens + ward recedes. */
  focusOn: boolean;
  /** Cove-strip emissive target color. */
  coveColor: number;
  /** Floor halo ring target color. */
  ringColor: number;
  /** Floor rug inlay target color. */
  inlayColor: number;
  /** How much the OTHER rooms recede (0 calm .. 0.12 crash) via global light. */
  restDim: number;
  /** Whether the slow 0.8 Hz breath-pulse is active (never a strobe). */
  pulseOn: boolean;

  /** Target emissive color for the ventilator status LED. */
  ledColor: number;
  /** Multiplier on the judge monitor screen emissive (rises with alert). */
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

    alertLevel: crashed ? 1 : 0,
    focusOn: crashed || alarm,
    coveColor: crashed ? CORAL : ACCENT_BLUE,
    ringColor: alarm ? CORAL : crashed ? SOFT_ALERT : ACCENT_BLUE,
    inlayColor: crashed ? SOFT_ALERT : ACCENT_BLUE,
    restDim: crashed ? 0.12 : 0,
    pulseOn: crashed,

    ledColor: d.compromised || alarm ? CORAL : MINT,
    emissive: alarm ? 1.8 : 1,
    codeOpacity: alarm ? 1 : 0,
    // The bellows keep breathing only while the fan is physically on; the
    // moment it stops they freeze mid-stroke and slump.
    bellowsActive: d.fanOn,
  };
}
