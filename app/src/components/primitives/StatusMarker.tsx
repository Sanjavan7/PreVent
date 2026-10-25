// The left-gutter marker, one per status (spec B3 status -> visual table).
//
// OWNER OVERRIDE (zero amber): `needs-approval` is a solid BLUE ringed marker,
// NOT an amber ring. Everything here is static except the running spinner.

import type { ActivityStatus } from '../pipeline/status';
import { Spinner } from './Spinner';

export function StatusMarker({ status }: { status: ActivityStatus }) {
  if (status === 'running') {
    return <Spinner label="Running…" />;
  }

  if (status === 'needs-approval') {
    // solid blue dot + a soft blue ring — "act now", in the one accent hue.
    return (
      <span
        aria-hidden
        className="block h-3.5 w-3.5 rounded-full"
        style={{
          background: 'var(--color-accent)',
          boxShadow: '0 0 0 3px var(--color-accent-bg)',
        }}
      />
    );
  }

  if (status === 'done') {
    // green check chip — "the fix holds" (brand story: green = verified/safe).
    return (
      <span
        aria-hidden
        className="flex h-[18px] w-[18px] items-center justify-center rounded-full"
        style={{ background: 'var(--color-success-bg)' }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M2 5.2 L4.2 7.4 L8 3"
            stroke="var(--color-success)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  if (status === 'error') {
    return (
      <span
        aria-hidden
        className="block h-2 w-2 rounded-full"
        style={{ background: 'var(--color-danger)' }}
      />
    );
  }

  // queued — a dim hollow ring, the one look-ahead hint.
  return (
    <span
      aria-hidden
      className="block h-2.5 w-2.5 rounded-full border"
      style={{ borderColor: 'var(--color-border-strong)' }}
    />
  );
}
