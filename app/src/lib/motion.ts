// Shared motion vocabulary (v2, restrained). Motion is for MEANING — appear,
// state change, and the two honesty overshoots — never decoration. Infinite
// decorative loops live in CSS @keyframes, not here.

import type { Transition } from 'motion/react';

/** Duration tokens (seconds). */
export const DUR = {
  micro: 0.12, // hover / color state
  base: 0.22, // appear / collapse
  draw: 0.36, // chart line draw-in
  settle: 0.6, // number settle
} as const;

/** easeOutExpo — entrances, draw-in, number settle. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
/** standard — color / opacity micro-states. */
export const EASE_STATE = [0.4, 0, 0.2, 1] as const;

export const SPRING = {
  /** active-marker FLIP / layout moves. */
  move: { type: 'spring', stiffness: 300, damping: 30, mass: 0.9 },
  /** the ONLY overshoot — the lie beat + the 401 pop (fired once). */
  snap: { type: 'spring', stiffness: 460, damping: 24, mass: 1 },
} as const satisfies Record<string, Transition>;
