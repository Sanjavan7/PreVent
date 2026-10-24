// Rise-and-fade a block in when it scrolls into view, once. Used for the
// evidence stack so cards arrive as the judge scrolls instead of all at once.
//
// Declarative `whileInView` is covered by the app-wide <MotionConfig
// reducedMotion="user">: under Reduce Motion the y-transform is dropped and only
// the opacity fade remains, so nothing stays invisible. The dashboard scrolls
// inside its own container, so pass that container's ref as `root` or the
// viewport is measured against the window and never triggers.

import { motion, type HTMLMotionProps } from 'motion/react';
import type { ReactNode, RefObject } from 'react';
import { DUR, EASE_SETTLE } from './motion';

interface RevealOnViewProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: ReactNode;
  /** Scroll container the viewport is measured against (the dashboard is scrollable). */
  root?: RefObject<Element | null>;
  /** Entrance offset in px (slides up from +y). */
  y?: number;
  delay?: number;
}

export function RevealOnView({
  children,
  root,
  y = 16,
  delay = 0,
  transition,
  ...rest
}: RevealOnViewProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ root, once: true, amount: 0.3, margin: '0px 0px -10% 0px' }}
      transition={transition ?? { duration: DUR.reveal, ease: EASE_SETTLE, delay }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
