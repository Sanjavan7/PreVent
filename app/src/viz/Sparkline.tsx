// A tiny auto-scaled trend line -- no axes, no labels, just the shape of a
// series with a soft gradient fill and a pulsing live dot at the head. Used for
// at-a-glance vitals/confidence trends beside the big numbers.
//
// All geometry is memoized; the only running animation is the one-shot pathLength
// draw-in and the native <animate> on the leading dot. Under Reduce Motion the
// line renders fully drawn and the dot sits static.

import { useId, useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { DUR, EASE_SETTLE } from '../lib/motion';
import { areaFromLine, niceBounds, smoothPath, toPoints } from '../lib/svgPath';

type SparkTone = 'blue' | 'purple' | 'red' | 'ok';

const STROKE: Record<SparkTone, string> = {
  blue: 'var(--color-blue)',
  purple: 'var(--color-purple)',
  red: 'var(--color-danger)',
  ok: 'var(--color-ok)',
};

// Fill gradient stops per spec: top 0.22 -> bottom 0 (lighter than the big charts).
const FILL_TOP: Record<SparkTone, string> = {
  blue: 'rgba(0,151,254,0.22)',
  purple: 'rgba(138,88,255,0.22)',
  red: 'rgba(255,77,79,0.22)',
  ok: 'rgba(0,222,104,0.22)',
};

interface SparklineProps {
  values: number[];
  tone?: SparkTone;
  width?: number;
  height?: number;
  /** Draw a filled gradient under the line. */
  fill?: boolean;
  className?: string;
}

export function Sparkline({
  values,
  tone = 'blue',
  width = 120,
  height = 36,
  fill = true,
  className,
}: SparklineProps) {
  const reduce = useReducedMotion();
  const gradId = useId();

  const geom = useMemo(() => {
    if (values.length < 2) return null;
    // 2px line with round caps -> inset by 2 so the stroke never clips.
    const pad = 2.5;
    const w = width - pad * 2;
    const h = height - pad * 2;
    const { min, max } = niceBounds([values]);
    const pts = toPoints(values, w, h, min, max).map((p) => ({ x: p.x + pad, y: p.y + pad }));
    return {
      line: smoothPath(pts),
      area: fill ? areaFromLine(pts, height - pad) : '',
      head: pts[pts.length - 1],
    };
  }, [values, width, height, fill]);

  if (!geom) {
    return <svg width={width} height={height} className={className} aria-hidden />;
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={FILL_TOP[tone]} />
          <stop offset="100%" stopColor={FILL_TOP[tone].replace(/0\.22\)/, '0)')} />
        </linearGradient>
      </defs>

      {geom.area ? <path d={geom.area} fill={`url(#${gradId})`} stroke="none" /> : null}

      <motion.path
        d={geom.line}
        fill="none"
        stroke={STROKE[tone]}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={reduce ? undefined : { pathLength: 1 }}
        transition={{ duration: DUR.reveal, ease: EASE_SETTLE }}
      />

      <circle cx={geom.head.x} cy={geom.head.y} r={2.5} fill={STROKE[tone]}>
        {reduce ? null : (
          <>
            <animate attributeName="r" values="2.5;5;2.5" dur="1.6s" repeatCount="indefinite" />
            <animate
              attributeName="opacity"
              values="1;0.4;1"
              dur="1.6s"
              repeatCount="indefinite"
            />
          </>
        )}
      </circle>
    </svg>
  );
}
