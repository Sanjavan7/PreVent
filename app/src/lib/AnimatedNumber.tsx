// Hero numbers that animate their digits like an odometer (confidence %, the
// vitals, the "401" payoff). Wraps @number-flow/react and adds the one PreVent-
// specific treatment: a `crashing` state that tints danger-red and shakes, for
// the true vital counting down while the device lies.
//
// <MotionNumber> is the zero-dependency fallback (a rounded MotionValue rendered
// as a text child -> no React re-render per frame) for lower-stakes counters.

import NumberFlow, { type Format } from '@number-flow/react';
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { useEffect } from 'react';
import { EASE_SETTLE } from './motion';

interface AnimatedNumberProps {
  value: number;
  format?: Format;
  prefix?: string;
  suffix?: string;
  className?: string;
  /** danger tint + shake -- the true vital collapsing during the lie. */
  crashing?: boolean;
}

export function AnimatedNumber({
  value,
  format,
  prefix,
  suffix,
  className,
  crashing = false,
}: AnimatedNumberProps) {
  const reduce = useReducedMotion();

  const flow = (
    <NumberFlow
      value={value}
      format={format}
      prefix={prefix}
      suffix={suffix}
      className={className}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    />
  );

  if (!crashing) return flow;

  return (
    <motion.span
      style={{ display: 'inline-block', color: 'var(--color-danger)', textShadow: '0 0 18px rgba(255,77,79,0.33)' }}
      animate={reduce ? undefined : { x: [0, -2, 2, -1, 1, 0] }}
      transition={{ duration: 0.35, ease: EASE_SETTLE, repeat: Infinity, repeatDelay: 0.9 }}
    >
      {flow}
    </motion.span>
  );
}

/**
 * Zero-dependency animated counter. Drives a MotionValue toward `value` and
 * renders it rounded as a text child -- updates the DOM text node directly,
 * never re-rendering React. Use for lower-stakes numbers; prefer AnimatedNumber
 * for the hero digits.
 */
export function MotionNumber({
  value,
  className,
  decimals = 0,
}: {
  value: number;
  className?: string;
  decimals?: number;
}) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const rounded = useTransform(mv, (v) =>
    decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString(),
  );

  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.8, ease: EASE_SETTLE });
    return () => controls.stop();
  }, [value, mv, reduce]);

  return (
    <motion.span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {rounded as unknown as MotionValue<string>}
    </motion.span>
  );
}
