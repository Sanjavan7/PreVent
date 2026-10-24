// Parent/child pair for a staggered scroll reveal: wrap a list in
// <StaggerGroup> and each entry in <StaggerItem>, and the children rise+fade in
// sequence when the group scrolls into view. The stagger is driven by the
// variant orchestration `delayChildren: stagger(step)` (Motion v14), so one
// parent controls the whole cascade.
//
// Reduced motion is handled app-wide by <MotionConfig reducedMotion="user">:
// the y-offset is dropped, the opacity fade stays.

import { motion, stagger, type HTMLMotionProps, type Variants } from 'motion/react';
import type { ReactNode, RefObject } from 'react';
import { EASE_SETTLE } from './motion';

const groupVariants = (step: number): Variants => ({
  hidden: {},
  show: { transition: { delayChildren: stagger(step) } },
});

/** Each child's own entrance -- referenced by <StaggerItem>. */
export const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_SETTLE } },
};

interface StaggerGroupProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: ReactNode;
  /** Seconds between each child's entrance (spec: 0.06-0.08). */
  step?: number;
  /** Scroll container the viewport is measured against. */
  root?: RefObject<Element | null>;
  once?: boolean;
}

export function StaggerGroup({
  children,
  step = 0.07,
  root,
  once = true,
  ...rest
}: StaggerGroupProps) {
  return (
    <motion.div
      variants={groupVariants(step)}
      initial="hidden"
      whileInView="show"
      viewport={{ root, once, amount: 0.15 }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  ...rest
}: Omit<HTMLMotionProps<'div'>, 'children'> & { children: ReactNode }) {
  return (
    <motion.div variants={staggerItemVariants} {...rest}>
      {children}
    </motion.div>
  );
}
