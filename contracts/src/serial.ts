// FROZEN host <-> Arduino serial schema (contract 2b). Shared by the serial
// bridge, the firmware (mirrored in C), the emulator, and any test harness.
// Line-based, \n-terminated, colon/comma-delimited. NO JSON. 115200 baud.

import type { DeviceStatus, Rgb } from './types';

export const SERIAL_BAUD = 115200;

/** One outbound STATE frame: host -> Arduino. */
export interface StateLine {
  fan: 0 | 1;
  rate: number; // 0..255 PWM duty (breathing rhythm)
  hr: number;
  spo2: number;
  alarm: 0 | 1;
  rgb: Rgb;
}

/**
 * The ONE mapping from the source-of-truth row to the wire.
 * fan follows TRUE state; the displayed vitals are the REPORTED (possibly lying) values.
 */
export function deviceStatusToState(d: DeviceStatus): StateLine {
  return {
    fan: d.fanOn ? 1 : 0,
    rate: d.fanOn ? 180 : 0,
    hr: d.reportedHr,
    spo2: d.reportedSpo2,
    alarm: d.alarmActive ? 1 : 0,
    rgb: d.compromised ? 1 : 0,
  };
}

export function encodeState(s: StateLine): string {
  return `STATE,fan=${s.fan},rate=${s.rate},hr=${s.hr},spo2=${s.spo2},alarm=${s.alarm},rgb=${s.rgb}\n`;
}

export function encodeServo(angle: number): string {
  const a = Math.max(0, Math.min(180, Math.trunc(angle)));
  return `SRV,angle=${a}\n`;
}

/** Inbound: Arduino -> host. */
export type Inbound =
  | { type: 'READY' }
  | { type: 'HB' }
  | { type: 'IR'; code: number }
  | { type: 'unknown'; raw: string };

export function parseInbound(line: string): Inbound {
  const l = line.trim();
  if (l === 'READY') return { type: 'READY' };
  if (l === 'HB') return { type: 'HB' };
  if (l.startsWith('IR,code=')) {
    const code = Number(l.slice('IR,code='.length));
    return Number.isFinite(code) ? { type: 'IR', code } : { type: 'unknown', raw: l };
  }
  return { type: 'unknown', raw: l };
}
