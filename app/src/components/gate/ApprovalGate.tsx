// The Factory human gate, living inside the `patch` step.
//
// OWNER OVERRIDE (zero amber): the CTA is BLUE (var(--color-accent)), static —
// no pulse, no shimmer. A 3-item preflight sits above it and the Droid scope
// line below. On approve, the button is replaced by the one gray spinner +
// "Deploying…".

import { Spinner } from '../primitives/Spinner';

function Tick() {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 10 10"
      fill="none"
      className="shrink-0"
    >
      <path
        d="M2 5.2 L4.2 7.4 L8 3"
        stroke="var(--color-text-muted)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ApprovalGate({
  show,
  approved,
  onApprove,
}: {
  show: boolean;
  approved: boolean;
  onApprove: () => void;
}) {
  if (!show) return null;

  return (
    <div className="mt-3 rounded-md border border-border bg-surface-2 p-3">
      <ul className="space-y-1 text-sm text-text-secondary">
        <li className="flex items-center gap-2">
          <Tick /> Patch written
        </li>
        <li className="flex items-center gap-2">
          <Tick /> Tests green in sandbox
        </li>
        <li className="flex items-center gap-2">
          <Tick /> Exploit proof captured
        </li>
      </ul>

      <div className="mt-3">
        {approved ? (
          <div className="flex items-center justify-center gap-2 rounded-sm bg-surface-3 px-4 py-2 text-sm text-text-secondary">
            <Spinner label="Deploying…" />
            <span>Deploying&hellip;</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={onApprove}
            className="state-transition w-full rounded-sm px-4 py-2 text-sm font-medium text-white hover:brightness-110"
            style={{ background: 'var(--color-accent)' }}
          >
            Approve &amp; deploy
          </button>
        )}
      </div>

      <p className="mt-2 text-meta text-text-muted">
        Droid scoped to <code className="font-mono">device-service/</code> &middot; cannot
        commit, push, or deploy.
      </p>
    </div>
  );
}
