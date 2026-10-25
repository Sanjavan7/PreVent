// The Factory human gate, living inside the `patch` step.
//
// OWNER OVERRIDE (zero amber): the CTA is BLUE, static — no pulse, no shimmer.
// Darkened to #006FCE so white-on-blue clears WCAG AA (~5:1). On approve, the
// button is replaced by the one gray spinner + "Deploying…". The preflight
// checklist and Droid scope line now live in DashboardPanel's patch-step
// extras (PatchSafety) so they persist on the collapsed done row.

import { Spinner } from '../primitives/Spinner';

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
          style={{ background: '#006FCE' }}
        >
          Approve &amp; deploy
        </button>
      )}
    </div>
  );
}
