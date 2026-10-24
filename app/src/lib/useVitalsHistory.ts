// LOAD-BEARING: every chart (VitalsDivergenceChart, sparklines) reads from this.
//
// `DeviceStatus` carries only scalar *current* values -- no history -- so we
// sample it on a fixed cadence into a capped ring buffer. The fixed cadence
// (not every render) gives charts a uniform x-axis regardless of how often the
// realtime backend pushes updates, and the cap bounds memory + draw cost.
//
// Returns the most recent `cap` samples, oldest first (chart-ready left->right).

import { useEffect, useRef, useState } from 'react';
import type { DeviceStatus } from '@prevent/contracts';

export interface VitalSample {
  t: number; // sample index (monotonic; uniform spacing, not wall-clock)
  reportedHr: number;
  reportedSpo2: number;
  trueHr: number;
  trueSpo2: number;
  fanOn: boolean;
  alarmActive: boolean;
}

export interface VitalsHistory {
  samples: VitalSample[];
  /** true once at least 2 samples exist (a line can be drawn). */
  ready: boolean;
}

export function useVitalsHistory(
  device: DeviceStatus,
  cap = 80,
  everyMs = 500,
): VitalsHistory {
  // Keep the latest device in a ref so the interval reads fresh values without
  // re-subscribing the timer on every realtime tick.
  const deviceRef = useRef(device);
  deviceRef.current = device;

  const tickRef = useRef(0);
  const [samples, setSamples] = useState<VitalSample[]>([]);

  useEffect(() => {
    const push = () => {
      const d = deviceRef.current;
      const sample: VitalSample = {
        t: tickRef.current++,
        reportedHr: d.reportedHr,
        reportedSpo2: d.reportedSpo2,
        trueHr: d.trueHr,
        trueSpo2: d.trueSpo2,
        fanOn: d.fanOn,
        alarmActive: d.alarmActive,
      };
      setSamples((prev) => {
        const next = prev.length >= cap ? prev.slice(prev.length - cap + 1) : prev.slice();
        next.push(sample);
        return next;
      });
    };
    // Seed one sample immediately so a chart has a point without waiting a tick.
    push();
    const id = window.setInterval(push, everyMs);
    return () => window.clearInterval(id);
  }, [cap, everyMs]);

  return { samples, ready: samples.length >= 2 };
}
