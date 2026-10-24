// Confidence as a thin 4px bar + an inline % (NumberFlow via AnimatedNumber).
// role="meter", NOT a gauge; the fill is always blue and never threshold-
// recolors. Uncertainty is shown on demand only.

import { motion, useReducedMotion } from 'motion/react';
import { AnimatedNumber } from '../../lib/AnimatedNumber';
import { DUR, EASE_OUT } from '../../lib/motion';
import { Disclosure } from './Disclosure';

export function ConfidenceMeter({
  value,
  uncertainty,
}: {
  value: number;
  uncertainty?: string;
}) {
  const reduce = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, value));
  const pct = Math.round(clamped * 100);

  return (
    <div
      className="mt-2"
      role="meter"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Model confidence"
    >
      <div className="flex items-center justify-between">
        <span className="text-overline uppercase tracking-wide text-text-muted">
          Confidence
        </span>
        <span className="text-meta tabular-nums text-accent-fg">
          <AnimatedNumber value={pct} suffix="%" />
        </span>
      </div>
      <div
        className="mt-1 h-1 w-full overflow-hidden rounded-pill"
        style={{ background: 'rgba(255,255,255,0.07)' }}
      >
        <motion.div
          className="h-full w-full origin-left rounded-pill"
          style={{ background: 'var(--color-blue)' }}
          initial={reduce ? false : { scaleX: 0 }}
          animate={{ scaleX: clamped }}
          transition={{ duration: DUR.base, ease: EASE_OUT }}
        />
      </div>
      {uncertainty ? (
        <Disclosure trigger="Uncertainty" className="mt-1.5">
          <p className="text-sm text-text-secondary">{uncertainty}</p>
        </Disclosure>
      ) : null}
    </div>
  );
}
