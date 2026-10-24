// One feed row. It derives all of its affordances from `status` (no boolean
// soup): the left-gutter marker, the pill, whether the body is expanded or
// collapsed to a single summary line, and the dim 50% look of a queued hint.
//
// Appear = opacity 0->1, y 8->0 (dur-base, ease-out). Active rows scroll
// themselves into view ({block:'nearest'}); collapsed done rows get
// content-visibility:auto so off-screen rows cost nothing. Everything respects
// reduced motion.

import { useEffect, useRef, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { DUR, EASE_OUT } from '../../lib/motion';
import { STATUS_TOKENS, type ActivityStatus } from '../pipeline/status';
import { StatusMarker } from '../primitives/StatusMarker';
import { StatusPill } from '../primitives/StatusPill';

/** mm:ss elapsed since the run origin, or '' when unknown / queued. */
function formatElapsed(at: number, origin?: number): string {
  if (!origin || !at || at >= Number.MAX_SAFE_INTEGER) return '';
  const s = Math.max(0, Math.round((at - origin) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function ActivityStep({
  status,
  title,
  agentName,
  summary,
  at,
  origin,
  connectorActive = false,
  isLast = false,
  children,
}: {
  status: ActivityStatus;
  title: string;
  agentName?: string;
  summary?: string;
  at?: number;
  origin?: number;
  /** draw the connector segment below this row in accent (leads to the active row) */
  connectorActive?: boolean;
  isLast?: boolean;
  children?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const expanded = STATUS_TOKENS[status].expanded;
  const queued = status === 'queued';

  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if ((status === 'running' || status === 'needs-approval') && ref.current) {
      ref.current.scrollIntoView({
        block: 'nearest',
        behavior: reduce ? 'auto' : 'smooth',
      });
    }
  }, [status, reduce]);

  const elapsed = formatElapsed(at ?? 0, origin);

  return (
    <motion.li
      ref={ref}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: queued ? 0.5 : 1, y: 0 }}
      exit={reduce ? undefined : { opacity: 0 }}
      transition={{ duration: DUR.base, ease: EASE_OUT }}
      className="relative pl-7"
      style={!queued && !expanded ? { contentVisibility: 'auto' } : undefined}
    >
      {/* vertical connector to the next step (grows with the stack; never a pre-drawn spine) */}
      {!isLast ? (
        <span
          aria-hidden
          className="absolute bottom-0 top-5 w-px"
          style={{
            left: 9,
            background: connectorActive ? 'var(--color-accent)' : 'var(--color-border)',
          }}
        />
      ) : null}

      {/* left-gutter marker (20px rail) */}
      <span className="absolute left-0 top-0.5 flex w-[18px] justify-center">
        <StatusMarker status={status} />
      </span>

      <div className="flex items-baseline gap-2">
        <span className={`text-base font-medium ${queued ? 'text-text-muted' : 'text-text'}`}>
          {title}
        </span>
        {agentName ? (
          <span className="truncate text-meta text-text-muted">{agentName}</span>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          {elapsed ? (
            <span className="text-meta tabular-nums text-text-muted">{elapsed}</span>
          ) : null}
          {queued ? null : <StatusPill status={status} />}
        </span>
      </div>

      {/* collapsed done rows keep a single quiet summary line */}
      {!expanded && !queued && summary ? (
        <p className="mt-0.5 text-sm text-text-secondary">{summary}</p>
      ) : null}

      {/* body: streaming reasoning (when expanded) and/or in-step artifacts behind disclosures */}
      {!queued && children ? <div className="mt-1.5 space-y-2">{children}</div> : null}
    </motion.li>
  );
}
