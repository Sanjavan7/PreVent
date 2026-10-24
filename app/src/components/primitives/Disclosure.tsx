// Accessible disclosure (button[aria-expanded] + region). Children are
// UNMOUNTED when closed, so expensive work gated behind it — parseDiff in
// CompactDiff — runs only once the viewer opens it.

import { useId, useState, type ReactNode } from 'react';

export function Disclosure({
  trigger,
  children,
  defaultOpen = false,
  className,
  onToggle,
}: {
  trigger: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  onToggle?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const regionId = useId();

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => {
          const next = !open;
          setOpen(next);
          onToggle?.(next);
        }}
        className="state-transition inline-flex items-center gap-1 text-meta text-text-muted hover:text-text-secondary"
      >
        <span aria-hidden className="inline-block w-2 text-center">
          {open ? '▾' : '▸'}
        </span>
        {trigger}
      </button>
      {open ? (
        <div id={regionId} role="region" className="mt-1.5">
          {children}
        </div>
      ) : null}
    </div>
  );
}
