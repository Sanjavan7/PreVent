// The Factory human gate, living inside the `patch` step.
//
// The CTA is the TEAL brand hue (var(--color-accent)), static — no pulse, no
// shimmer; white-on-teal clears WCAG AA. Reject is a ghost that reveals coral
// intent on hover. On approve, the button is replaced by the one spinner +
// "Deploying…". The preflight checklist and Droid scope line live in the
// patch-step extras so they persist on the collapsed done row.

import { Spinner } from '../primitives/Spinner';

export function ApprovalGate({
  show,
  approved,
  onApprove,
  onReject,
}: {
  show: boolean;
  approved: boolean;
  onApprove: () => void;
  onReject?: () => void;
}) {
  if (!show) return null;

  return (
    <div className="mt-3">
      {approved ? (
        <div className="flex items-center justify-center gap-2 rounded-sm bg-surface-3 px-4 py-2 text-sm text-text-secondary">
          <Spinner label="Deploying…" />
          <span>Deploying&hellip;</span>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={onApprove}
            className="state-transition w-full rounded-md px-4 py-2 text-sm font-medium text-white hover:brightness-110"
            style={{ background: 'var(--color-accent)' }}
          >
            Approve &amp; deploy
          </button>
          {onReject && (
            <button
              type="button"
              onClick={onReject}
              className="state-transition w-full rounded-md border border-border px-4 py-2 text-sm text-text-secondary hover:border-danger/50 hover:bg-danger-bg hover:text-danger-fg"
            >
              Reject
            </button>
          )}
        </div>
      )}
    </div>
  );
}
