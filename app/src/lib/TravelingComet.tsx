// A glowing dot that travels along an SVG path -- the "data flowing" packet on
// the active pipeline segment and the exploit/replay packet on the attack path.
//
// Uses the browser's native SMIL <animateMotion> rather than JS: the motion runs
// off the main thread, costs us nothing per frame, and the `path` attribute
// takes the same `d` string the connector is drawn from. MUST be rendered inside
// an <svg>. Under Reduce Motion it renders nothing (the static connector already
// shows the from/to relationship) rather than teleporting a dot around.

import { useReducedMotion } from 'motion/react';

interface TravelingCometProps {
  /** Absolute SVG path `d` the comet travels along. */
  path: string;
  /** Travel duration in seconds. */
  dur?: number;
  /** Comet fill + glow color (token or CSS color). */
  color?: string;
  /** Comet radius. */
  r?: number;
  /** Loop forever (relay) vs run once and stop at the end (one-shot packet). */
  repeat?: boolean;
  /** Gate so only the active segment animates. */
  active?: boolean;
}

export function TravelingComet({
  path,
  dur = 1.4,
  color = 'var(--color-blue)',
  r = 3.5,
  repeat = true,
  active = true,
}: TravelingCometProps) {
  const reduce = useReducedMotion();
  if (reduce || !active) return null;
  return (
    <circle r={r} fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }}>
      <animateMotion
        path={path}
        dur={`${dur}s`}
        repeatCount={repeat ? 'indefinite' : 1}
        rotate="auto"
        fill="freeze"
      />
    </circle>
  );
}
