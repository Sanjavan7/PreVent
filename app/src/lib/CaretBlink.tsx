// A blinking terminal caret for the streaming reasoning line. Decorative and
// infinite, so per doctrine it's a pure CSS @keyframes loop -- not a JS/Motion
// animation. index.css is owned by another worktree, so the keyframes are
// injected once into <head> at first mount instead of living in the stylesheet.
// The injected rule also stops the blink under Reduce Motion.

import { useEffect } from 'react';

const CARET_CSS = `
@keyframes prevent-caret { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
.prevent-caret { animation: prevent-caret 1.05s steps(1, end) infinite; }
@media (prefers-reduced-motion: reduce) { .prevent-caret { animation: none; opacity: 1 } }
`;

let injected = false;
function ensureCaretStyles(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const el = document.createElement('style');
  el.setAttribute('data-prevent-caret', '');
  el.textContent = CARET_CSS;
  document.head.appendChild(el);
}

export function CaretBlink({
  className,
  color = 'var(--color-blue)',
}: {
  className?: string;
  color?: string;
}) {
  useEffect(() => {
    ensureCaretStyles();
  }, []);
  return (
    <span
      aria-hidden
      className={`prevent-caret${className ? ` ${className}` : ''}`}
      style={{
        display: 'inline-block',
        width: '1px',
        height: '1em',
        marginLeft: '2px',
        verticalAlign: 'text-bottom',
        background: color,
      }}
    />
  );
}
