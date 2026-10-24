// The agent's confidence as a 270-degree radial arc (gap at the bottom), with a
// blurred glow underlay, round caps, and the live percentage odometer-ing in the
// center via the shared <AnimatedNumber>. The arc fills by animating `pathLength`
// along a single arc path, driven by a soft spring so it settles instead of
// snapping. Color crosses the spec thresholds as confidence changes.
//
// A compact 6px-bar variant is kept for tight rows (scaleX fill + leading glow).
// Under Reduce Motion the arc renders at its final length with no spring.

import { useEffect, useMemo } from 'react';
import { motion, useReducedMotion, useSpring } from 'motion/react';
import { AnimatedNumber } from '../lib/AnimatedNumber';
import { SPRING } from '../lib/motion';

const SIZE = 112;
const STROKE = 9;
const CENTER = SIZE / 2;
const RADIUS = CENTER - STROKE / 2 - 3;
const START_DEG = 135; // lower-left; clockwise (screen space, y-down)
const SWEEP_DEG = 270; // gap of 90 centered at the bottom

function pointOnArc(deg: number): [number, number] {
  const a = (Math.PI / 180) * deg;
  return [CENTER + RADIUS * Math.cos(a), CENTER + RADIUS * Math.sin(a)];
}

// The full 270-degree track as one arc path (large-arc=1, sweep=1 clockwise).
const [SX, SY] = pointOnArc(START_DEG);
const [EX, EY] = pointOnArc(START_DEG + SWEEP_DEG);
const ARC_D = `M ${SX.toFixed(2)},${SY.toFixed(2)} A ${RADIUS},${RADIUS} 0 1 1 ${EX.toFixed(2)},${EY.toFixed(2)}`;

function toneFor(pct: number): string {
  if (pct >= 80) return 'var(--color-ok)';
  if (pct >= 55) return 'var(--color-blue)';
  if (pct >= 30) return 'var(--color-warn)';
  return 'var(--color-danger)';
}

interface ConfidenceGauge270Props {
  /** Confidence in 0..1. */
  value: number;
  uncertainty?: string;
  /** Render the compact 6px bar instead of the full radial arc. */
  compact?: boolean;
  className?: string;
}

export function ConfidenceGauge270({
  value,
  uncertainty,
  compact = false,
  className,
}: ConfidenceGauge270Props) {
  const reduce = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, value));
  const pct = Math.round(clamped * 100);
  const tone = toneFor(pct);

  // One spring drives the arc length; `pathLength` is a fraction 0..1.
  const length = useSpring(0, { stiffness: SPRING.soft.stiffness, damping: SPRING.soft.damping });
  useEffect(() => {
    if (reduce) length.jump(clamped);
    else length.set(clamped);
  }, [clamped, reduce, length]);

  if (compact) {
    return (
      <div className={className}>
        <div className="mb-1 flex items-center justify-between font-mono text-overline uppercase tracking-wider text-text-secondary">
          <span>Confidence</span>
          <span className="tabular-nums" style={{ color: tone }}>
            {pct}%
          </span>
        </div>
        <div className="relative h-1.5 overflow-hidden rounded-pill bg-surface-2">
          <motion.div
            className="h-full origin-left rounded-pill"
            style={{ background: tone, boxShadow: `0 0 8px ${tone}` }}
            initial={{ scaleX: reduce ? clamped : 0 }}
            animate={{ scaleX: clamped }}
            transition={SPRING.soft}
          />
        </div>
        {uncertainty ? (
          <p className="mt-1 font-mono text-caption leading-snug text-text-secondary">
            <span className="text-warn">!</span> {uncertainty}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center ${className ?? ''}`}>
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <defs>
            <filter id="gauge-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2.5" />
            </filter>
          </defs>

          {/* Track */}
          <path
            d={ARC_D}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={STROKE}
            strokeLinecap="round"
          />

          {/* Blurred glow underlay -- same arc, same spring length. */}
          <motion.path
            d={ARC_D}
            fill="none"
            stroke={tone}
            strokeWidth={STROKE}
            strokeLinecap="round"
            filter="url(#gauge-glow)"
            opacity={0.5}
            style={{ pathLength: length }}
          />

          {/* Crisp progress arc. */}
          <motion.path
            d={ARC_D}
            fill="none"
            stroke={tone}
            strokeWidth={STROKE}
            strokeLinecap="round"
            style={{ pathLength: length }}
          />
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <AnimatedNumber
            value={pct}
            suffix="%"
            className="font-display text-h3 tabular-nums"
          />
          <span className="font-mono text-overline uppercase tracking-wider text-text-secondary">
            Confidence
          </span>
        </div>
      </div>

      {uncertainty ? (
        <p className="mt-2 max-w-[220px] text-center font-mono text-caption leading-snug text-text-secondary">
          <span className="text-warn">!</span> {uncertainty}
        </p>
      ) : null}
    </div>
  );
}
