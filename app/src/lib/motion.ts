// Shared motion vocabulary for the PreVent UI. Motion is for MEANING -- state
// changes, reveals, the honesty beats -- never decoration. Infinite decorative
// loops (carets, idle pulses) live in CSS @keyframes, not here.
//
// Easings and durations are the framer.com-verified house values; springs are
// tuned per use. Import these instead of inlining magic numbers so every surface
// animates with one coherent feel.

import type { Transition } from 'motion/react';

/** framer.com house curve -- hovers, color/state micro-transitions (~0.2s). */
export const EASE_FRAMER = [0.44, 0, 0.56, 1] as const;
/** easeOutExpo -- entrances, chart/arc draw-in. */
export const EASE_SETTLE = [0.22, 1, 0.36, 1] as const;
/** symmetric -- shakes and back-and-forth moves. */
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

/** Named spring presets. `dramatic` overshoots -- reserve it for the LIE snap
 *  and the restore; `vital` is the slow lurch of a crashing number. */
export const SPRING = {
  snappy: { type: 'spring', stiffness: 400, damping: 32, mass: 0.8 },
  default: { type: 'spring', stiffness: 260, damping: 28 },
  soft: { type: 'spring', stiffness: 170, damping: 26 },
  dramatic: { type: 'spring', stiffness: 520, damping: 18, mass: 1.1 },
  vital: { type: 'spring', stiffness: 90, damping: 18, mass: 0.8 },
  scroll: { stiffness: 100, damping: 30, restDelta: 0.001 },
} as const satisfies Record<string, Transition>;

/** Duration tokens (seconds). `relay` is the signature ghostFlow loop period. */
export const DUR = {
  micro: 0.2,
  enter: 0.4,
  reveal: 0.6,
  draw: 1.1,
  count: 0.8,
  relay: 0.75,
} as const;

/** The house default, applied app-wide via <MotionConfig> in main.tsx. */
export const HOUSE_SPRING: Transition = { type: 'spring', stiffness: 260, damping: 28 };
