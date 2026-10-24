// THE hero chart and the clearest frame of the whole story: the device's
// *reported* vital holds a calm blue line while its *true* vital crashes in red,
// and the filled area between them IS the lie. Both series read from the
// load-bearing useVitalsHistory ring buffer, so the chart shares one x-axis with
// everything else on screen.
//
// Geometry is memoized; the running animations are the one-shot pathLength
// draw-in, the gap's opacity fade, and the native <animate> head dots. Hovering
// reveals the Framer-exact crosshair + tooltip. Under Reduce Motion the lines
// render fully drawn and the dots sit static (meaning is preserved, transforms
// dropped).

import { useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { VitalSample } from '../lib/useVitalsHistory';
import { DUR, EASE_SETTLE } from '../lib/motion';
import { betweenPath, niceBounds, smoothPath, toPoints } from '../lib/svgPath';
import { ChartTooltip, type TooltipRow } from './ChartTooltip';

type Metric = 'hr' | 'spo2';

const METRIC_LABEL: Record<Metric, string> = { hr: 'HR · bpm', spo2: 'SpO₂ · %' };

const REPORTED = 'var(--color-blue)';
const TRUE = 'var(--color-danger)';

interface VitalsDivergenceChartProps {
  samples: VitalSample[];
  metric?: Metric;
  width?: number;
  height?: number;
  className?: string;
}

export function VitalsDivergenceChart({
  samples,
  metric = 'hr',
  width = 560,
  height = 170,
  className,
}: VitalsDivergenceChartProps) {
  const reduce = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const pad = 6;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;

  const geom = useMemo(() => {
    if (samples.length < 2) return null;
    const reportedVals = samples.map((s) => (metric === 'hr' ? s.reportedHr : s.reportedSpo2));
    const trueVals = samples.map((s) => (metric === 'hr' ? s.trueHr : s.trueSpo2));
    const { min, max } = niceBounds([reportedVals, trueVals]);
    const shift = (p: { x: number; y: number }) => ({ x: p.x + pad, y: p.y + pad });
    const reportedPts = toPoints(reportedVals, plotW, plotH, min, max).map(shift);
    const truePts = toPoints(trueVals, plotW, plotH, min, max).map(shift);
    return {
      reportedVals,
      trueVals,
      reportedPts,
      truePts,
      reportedLine: smoothPath(reportedPts),
      trueLine: smoothPath(truePts),
      gap: betweenPath(reportedPts, truePts),
    };
  }, [samples, metric, plotW, plotH]);

  if (!geom) {
    return (
      <div
        className={`flex items-center justify-center font-mono text-caption text-text-secondary ${className ?? ''}`}
        style={{ height }}
      >
        gathering telemetry&hellip;
      </div>
    );
  }

  const n = samples.length;
  const reportedHead = geom.reportedPts[n - 1];
  const trueHead = geom.truePts[n - 1];

  const handleMove = (e: React.MouseEvent<SVGRectElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width; // viewBox scales uniformly
    const idx = Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
    setHoverIdx(idx);
  };

  const hoverX = hoverIdx != null ? geom.reportedPts[hoverIdx].x : 0;
  const hoverRows: TooltipRow[] =
    hoverIdx != null
      ? [
          { label: 'reported', value: String(Math.round(geom.reportedVals[hoverIdx])), color: REPORTED },
          { label: 'actual', value: String(Math.round(geom.trueVals[hoverIdx])), color: TRUE },
        ]
      : [];

  return (
    <svg
      ref={svgRef}
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label={`${metric === 'hr' ? 'Heart rate' : 'Oxygen saturation'}: reported versus actual`}
    >
      <defs>
        <linearGradient id="divergence-gap" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,77,79,0.30)" />
          <stop offset="55%" stopColor="rgba(255,77,79,0.07)" />
          <stop offset="100%" stopColor="rgba(255,77,79,0)" />
        </linearGradient>
      </defs>

      {/* The lie: the filled gap between reported and true. Fades in after the lines start. */}
      <motion.path
        d={geom.gap}
        fill="url(#divergence-gap)"
        stroke="none"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: DUR.reveal, delay: reduce ? 0 : 0.2, ease: EASE_SETTLE }}
      />

      {/* True vital -- crashing, in red. */}
      <motion.path
        d={geom.trueLine}
        fill="none"
        stroke={TRUE}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={reduce ? undefined : { pathLength: 1 }}
        transition={{ duration: DUR.draw, ease: EASE_SETTLE }}
      />

      {/* Reported vital -- calm, in blue, drawn on top. */}
      <motion.path
        d={geom.reportedLine}
        fill="none"
        stroke={REPORTED}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={reduce ? undefined : { pathLength: 1 }}
        transition={{ duration: DUR.draw, ease: EASE_SETTLE }}
      />

      {/* Live heads. */}
      <circle cx={trueHead.x} cy={trueHead.y} r={3} fill={TRUE}>
        {reduce ? null : (
          <animate attributeName="r" values="3;6;3" dur="1.6s" repeatCount="indefinite" />
        )}
      </circle>
      <circle cx={reportedHead.x} cy={reportedHead.y} r={3.5} fill={REPORTED}>
        {reduce ? null : (
          <>
            <animate attributeName="r" values="3.5;6;3.5" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="1;0.5;1" dur="1.6s" repeatCount="indefinite" />
          </>
        )}
      </circle>

      {hoverIdx != null ? (
        <ChartTooltip
          x={hoverX}
          width={width}
          height={height}
          header={METRIC_LABEL[metric]}
          rows={hoverRows}
        />
      ) : null}

      {/* Transparent hit area for the crosshair. */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="transparent"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      />
    </svg>
  );
}
