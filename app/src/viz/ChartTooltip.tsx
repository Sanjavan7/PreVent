// Framer-exact dark-glass tooltip + crosshair for the hand-rolled charts.
// Rendered INSIDE the chart <svg> via <foreignObject> so it tracks the data in
// chart space. Presentational only -- the chart owns hover state and passes the
// resolved anchor x, header, and series rows. The box flips to the left of the
// crosshair when it would overflow the right edge.

import type { CSSProperties } from 'react';

export interface TooltipRow {
  label: string;
  value: string;
  color: string;
}

interface ChartTooltipProps {
  /** Crosshair x in chart space. */
  x: number;
  /** Chart dimensions (crosshair height + edge-flip math). */
  width: number;
  height: number;
  /** Date/label header line. */
  header: string;
  rows: TooltipRow[];
  boxWidth?: number;
}

const glass: CSSProperties = {
  background: 'rgba(10,10,11,0.92)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 10,
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  padding: '8px 10px',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  lineHeight: 1.45,
  color: 'var(--color-text-strong)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  pointerEvents: 'none',
};

export function ChartTooltip({ x, width, height, header, rows, boxWidth = 132 }: ChartTooltipProps) {
  const boxHeight = 22 + rows.length * 16 + 8;
  const flip = x + boxWidth + 14 > width;
  const boxX = flip ? x - boxWidth - 12 : x + 12;
  const boxY = Math.max(2, Math.min(height - boxHeight - 2, 6));

  return (
    <g pointerEvents="none">
      {/* Crosshair */}
      <line
        x1={x}
        x2={x}
        y1={0}
        y2={height}
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <foreignObject x={boxX} y={boxY} width={boxWidth} height={boxHeight}>
        <div style={glass}>
          <div style={{ color: '#8b9aab', marginBottom: 4 }}>{header}</div>
          {rows.map((row) => (
            <div
              key={row.label}
              style={{ display: 'flex', alignItems: 'center', gap: 6, height: 16 }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: row.color,
                  flex: '0 0 auto',
                }}
              />
              <span style={{ color: 'var(--color-text-secondary)' }}>{row.label}</span>
              <span
                style={{
                  marginLeft: 'auto',
                  color: row.color,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </foreignObject>
    </g>
  );
}
