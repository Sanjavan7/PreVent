// A tiny STATIC sparkline for the Truth Strip — no axes, no labels, no fill, no
// animation, no live dot (the full crashing waveform lives on the LEFT 3D
// monitor). Neutral stroke by default; red only while the device is lying.

import { useMemo } from 'react';

export function Sparkline({
  values,
  lying = false,
  width = 56,
  height = 16,
}: {
  values: number[];
  lying?: boolean;
  width?: number;
  height?: number;
}) {
  const d = useMemo(() => {
    if (values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pad = 1.5;
    const w = width - pad * 2;
    const h = height - pad * 2;
    const step = w / (values.length - 1);
    return values
      .map((v, i) => {
        const x = pad + i * step;
        const y = pad + h - ((v - min) / span) * h;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }, [values, width, height]);

  if (!d) return <svg width={width} height={height} aria-hidden />;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      className="shrink-0"
    >
      <path
        d={d}
        fill="none"
        stroke={lying ? 'var(--color-danger)' : 'var(--color-text-muted)'}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
