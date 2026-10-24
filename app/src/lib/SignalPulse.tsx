// The ghostFlow relay: an opacity wave that reads as a signal traveling down the
// 7-stage pipeline. Each node renders a <SignalPulse index={i}> and the wave
// staggers by index*0.08s, so the glow appears to flow stage -> stage.
//
// Doctrine (frame budget is shared with the Pixi monitor): this is an infinite
// loop, so only the ACTIVE segment should mount it with `active` -- never light
// the whole spine at once. Under Reduce Motion it holds a steady mid-opacity
// instead of looping.

import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { DUR } from './motion';

interface SignalPulseProps extends HTMLMotionProps<'span'> {
  /** Position in the relay chain -> staggers the wave by index * 0.08s. */
  index?: number;
  /** Only the active node/segment should animate (frame-budget doctrine). */
  active?: boolean;
}

export function SignalPulse({ index = 0, active = true, style, ...rest }: SignalPulseProps) {
  const reduce = useReducedMotion();
  const animate = active && !reduce ? { opacity: [0.3, 1, 0.6, 0.3] } : undefined;
  return (
    <motion.span
      {...rest}
      style={{ display: 'inline-block', ...style }}
      animate={animate}
      transition={{
        duration: DUR.relay,
        ease: 'linear',
        repeat: Infinity,
        delay: index * 0.08,
      }}
    />
  );
}
