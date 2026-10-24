// The one-column activity feed. Steps appear as they happen (AnimatePresence,
// initial={false} so the first paint is calm), newest at the bottom; finished
// steps collapse to one line; exactly one dim queued hint sits ahead (supplied
// by deriveActivity). Stage-specific artifacts — the patch diff, the approval
// gate, the exploit request card, the audit receipt — are injected per entry
// via `renderExtras` so the feed itself stays generic.

import { type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import type { ActivityEntry } from '../pipeline/deriveActivity';
import { ConfidenceMeter } from '../primitives/ConfidenceMeter';
import { ActivityStep } from './ActivityStep';
import { StepReasoning } from './StepReasoning';

export function ActivityFeed({
  entries,
  origin,
  renderExtras,
}: {
  entries: ActivityEntry[];
  origin?: number;
  renderExtras?: (entry: ActivityEntry) => ReactNode;
}) {
  // the connector segments leading up to the active row are drawn in accent.
  const activeIndex = entries.findIndex(
    (e) => e.status === 'running' || e.status === 'needs-approval',
  );

  return (
    <ol aria-live="polite" className="flex flex-col gap-3">
      <AnimatePresence initial={false}>
        {entries.map((entry, i) => {
          const active =
            entry.status === 'running' || entry.status === 'needs-approval';
          const extras = renderExtras?.(entry);
          return (
            <ActivityStep
              key={entry.id}
              status={entry.status}
              title={entry.title}
              agentName={entry.agentName || undefined}
              at={entry.at}
              origin={origin}
              connectorActive={activeIndex >= 0 && i < activeIndex}
              isLast={i === entries.length - 1}
            >
              {active ? (
                <>
                  <StepReasoning
                    text={entry.reasoning}
                    streaming={entry.status === 'running'}
                  />
                  {entry.confidence > 0 ? (
                    <ConfidenceMeter
                      value={entry.confidence}
                      uncertainty={entry.uncertainty || undefined}
                    />
                  ) : null}
                  {extras}
                </>
              ) : (
                extras
              )}
            </ActivityStep>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}
