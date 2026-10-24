// Pure SVG path geometry for the hand-rolled charts (no charting lib). Every
// chart maps its data to screen points here, then draws a Catmull-Rom -> cubic
// Bezier curve so lines read smooth instead of jagged. Kept framework-free and
// side-effect-free so chart components can `useMemo` all geometry once per data
// change and never recompute during animation frames.

export interface Point {
  x: number;
  y: number;
}

// 2-decimal rounding keeps the emitted `d` strings short (smaller DOM, cheaper
// diffing) without any visible precision loss at screen scale.
const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Map a series of values onto chart-space points. x is spread evenly across the
 * width (oldest -> newest, left -> right); y is inverted so larger values sit
 * higher. Pass a shared [min,max] when several series must line up on one scale.
 */
export function toPoints(
  values: number[],
  width: number,
  height: number,
  min: number,
  max: number,
): Point[] {
  const n = values.length;
  const span = max - min || 1;
  return values.map((v, i) => ({
    x: r2(n <= 1 ? width : (i / (n - 1)) * width),
    y: r2(height - ((v - min) / span) * height),
  }));
}

/** Min/max of a set of series with a little headroom so lines never kiss the edge. */
export function niceBounds(series: number[][], padFraction = 0.08): { min: number; max: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    for (const v of s) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1 };
  if (lo === hi) {
    // Flat series: invent a symmetric band so the line sits centered.
    const pad = Math.abs(lo) * 0.1 || 1;
    return { min: lo - pad, max: hi + pad };
  }
  const pad = (hi - lo) * padFraction;
  return { min: lo - pad, max: hi + pad };
}

/**
 * Catmull-Rom spline through `pts`, emitted as a cubic-Bezier `d` string. The
 * curve passes through every point; `smoothing` (0 = polyline, 1 = default)
 * scales the tangent length. End tangents are clamped to the endpoints so the
 * curve doesn't overshoot at the edges.
 */
export function smoothPath(pts: Point[], smoothing = 1): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`;
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = r2(p1.x + ((p2.x - p0.x) / 6) * smoothing);
    const cp1y = r2(p1.y + ((p2.y - p0.y) / 6) * smoothing);
    const cp2x = r2(p2.x - ((p3.x - p1.x) / 6) * smoothing);
    const cp2y = r2(p2.y - ((p3.y - p1.y) / 6) * smoothing);
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

/**
 * Close a smooth line into a filled area by dropping to a flat baseline. Used for
 * the gradient fill under a sparkline / single series.
 */
export function areaFromLine(
  pts: Point[],
  baselineY: number,
  smoothing = 1,
): string {
  if (pts.length < 2) return '';
  const line = smoothPath(pts, smoothing);
  const first = pts[0];
  const last = pts[pts.length - 1];
  return `${line} L ${last.x},${baselineY} L ${first.x},${baselineY} Z`;
}

/**
 * The enclosed region between two series -- for the VitalsDivergenceChart this
 * filled gap IS the lie (reported on top, true below). Follows `top` left->right,
 * drops to the last `bottom` point, then traces `bottom` back right->left and
 * closes. Both boundaries are smoothed so the shape matches the drawn lines.
 */
export function betweenPath(top: Point[], bottom: Point[], smoothing = 1): string {
  if (top.length < 2 || bottom.length < 2) return '';
  const topD = smoothPath(top, smoothing);
  const rev = [...bottom].reverse();
  // Strip the reversed path's leading "M x,y" -- we arrive there with an explicit L.
  const revBody = smoothPath(rev, smoothing).replace(/^M\s*[-\d.,\s]+/, '');
  return `${topD} L ${rev[0].x},${rev[0].y}${revBody} Z`;
}
