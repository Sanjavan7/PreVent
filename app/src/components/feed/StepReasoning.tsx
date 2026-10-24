// The streaming reasoning line for the active step: a 2-line clamp with a
// "View reasoning" disclosure for the full text. aria-live="polite" announces
// growth without stealing focus. When the step is no longer active the parent
// stops rendering this, so it folds away on its own.

import { Disclosure } from '../primitives/Disclosure';

export function StepReasoning({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  if (!text) {
    return streaming ? (
      <p className="mt-2 text-sm text-text-muted" aria-live="polite">
        Thinking&hellip;
      </p>
    ) : null;
  }

  return (
    <div className="mt-2">
      <p className="line-clamp-2 text-sm text-text-secondary" aria-live="polite">
        {text}
      </p>
      <Disclosure trigger="View reasoning" className="mt-1">
        <p className="whitespace-pre-wrap text-sm text-text-secondary">{text}</p>
      </Disclosure>
    </div>
  );
}
