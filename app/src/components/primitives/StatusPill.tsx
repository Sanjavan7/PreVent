// Small text pill echoing the step status. Neutral by default; BLUE (accent)
// for `needs-approval` (owner override: no amber); danger for `error`.

import { STATUS_TOKENS, type ActivityStatus, type PillTone } from '../pipeline/status';

const TONE: Record<PillTone, string> = {
  neutral: 'border-border bg-surface-2 text-text-muted',
  accent: 'border-accent-border bg-accent-bg text-accent-fg',
  danger: 'border-danger/40 bg-danger-bg text-danger-fg',
};

export function StatusPill({ status }: { status: ActivityStatus }) {
  const token = STATUS_TOKENS[status];
  return (
    <span
      className={`rounded-xs border px-1.5 py-0.5 text-overline uppercase tracking-wide ${TONE[token.tone]}`}
    >
      {token.label}
    </span>
  );
}
