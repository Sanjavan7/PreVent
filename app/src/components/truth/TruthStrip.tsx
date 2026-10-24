// The pinned ~48px ledger at the foot of the panel: reported ▸ actual for each
// vital + a tiny sparkline. This is the ONLY red surface besides error text,
// and only while the device is lying. One 400ms shake fires ONCE on the rising
// edge of the lie (a transform, not a loop); recovery is a quiet color fade.

import { useEffect, useRef } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import type { DeviceStatus } from '@prevent/contracts';
import { AnimatedNumber } from '../../lib/AnimatedNumber';
import { useVitalsHistory } from '../../lib/useVitalsHistory';
import { EASE_STATE } from '../../lib/motion';
import { Sparkline } from './Sparkline';

function Vital({
  label,
  reported,
  actual,
  lying,
}: {
  label: string;
  reported: number;
  actual: number;
  lying: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-secondary">{reported}</span>
      <span aria-hidden className="text-text-muted">
        &#9656;
      </span>
      <AnimatedNumber value={actual} className={lying ? 'text-danger-fg' : 'text-text'} />
    </span>
  );
}

export function TruthStrip({ device }: { device: DeviceStatus }) {
  const reduce = useReducedMotion();
  const { samples } = useVitalsHistory(device);

  const hrLying = device.reportedHr !== device.trueHr;
  const spo2Lying = device.reportedSpo2 !== device.trueSpo2;
  const lying = hrLying || spo2Lying;

  // one-shot shake on the rising edge of the lie.
  const shakeX = useMotionValue(0);
  const was = useRef(lying);
  useEffect(() => {
    const rising = lying && !was.current;
    was.current = lying;
    if (rising && !reduce) {
      const controls = animate(shakeX, [0, -4, 4, -2, 2, 0], {
        duration: 0.4,
        ease: EASE_STATE,
      });
      return () => controls.stop();
    }
  }, [lying, reduce, shakeX]);

  const series = samples.map((s) => s.trueHr);

  return (
    <motion.div
      style={{
        x: shakeX,
        borderLeftWidth: lying ? 2 : 0,
        borderLeftStyle: 'solid',
        borderLeftColor: 'var(--color-danger)',
        backgroundColor: lying ? 'var(--color-danger-bg)' : 'transparent',
      }}
      className="state-transition flex items-center gap-4 border-t border-border px-4 py-2"
    >
      <span
        className={`text-overline uppercase tracking-wide ${
          lying ? 'text-danger-fg' : 'text-text-muted'
        }`}
      >
        {lying ? 'Device is lying · alarm silenced' : 'Device truth'}
      </span>

      <div className="flex items-center gap-3 font-mono text-sm tabular-nums">
        <Vital label="HR" reported={device.reportedHr} actual={device.trueHr} lying={hrLying} />
        <Vital
          label={'SpO₂'}
          reported={device.reportedSpo2}
          actual={device.trueSpo2}
          lying={spo2Lying}
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Sparkline values={series} lying={lying} />
        <span className="flex items-center gap-1.5 text-meta text-text-muted">
          <span
            aria-hidden
            className="block h-1.5 w-1.5 rounded-full"
            style={{
              background: lying ? 'var(--color-danger)' : 'var(--color-text-muted)',
            }}
          />
          {lying ? 'diverged' : 'in sync'}
        </span>
      </div>
    </motion.div>
  );
}
