// Small text pill echoing the step status. Neutral by default; TEAL (accent)
// for `needs-approval`; danger (coral) for `error`.

import { STATUS_TOKENS, type ActivityStatus, type PillTone } from '../pipeline/status';

const TONE: Record<PillTone, string> = {
  neutral: 'border-border bg-surface-2 text-text-secondary',
  accent: 'border-accent-border bg-accent-bg text-accent-fg',
  danger: 'border-danger/40 bg-danger-bg text-danger-fg',
};

export function StatusPill({ status }: { status: ActivityStatus }) {
  const token = STATUS_TOKENS[status];
  return (
    <span
      className={`rounded-pill border px-2 py-0.5 text-overline uppercase tracking-wide ${TONE[token.tone]}`}
    >
      {token.label}
    </span>
  );
}
