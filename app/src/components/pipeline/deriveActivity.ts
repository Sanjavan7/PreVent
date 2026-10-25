// PURE selector: AgentStatus[] -> ActivityEntry[]. This one function kills both
// the pre-laid 7-node timeline AND the empty parallel column: the feed renders
// only what has actually happened (state !== 'idle'), in chronological order
// (oldest first, newest at the bottom), plus EXACTLY ONE dim "queued" hint for
// the next stage. Memoize the call in render; never run it in an effect.

import type { AgentStatus, Stage } from '@prevent/contracts';
import { STAGE_SUMMARY, STAGE_TITLE, statusFromState, type ActivityStatus } from './status';

export interface ActivityEntry {
  id: string;
  stage: Stage;
  title: string;
  status: ActivityStatus;
  agentName: string;
  reasoning: string;
  confidence: number;
  uncertainty: string;
  /** one quiet line shown once the row collapses to `done` (empty otherwise) */
  summary: string;
  at: number;
}

const STAGE_ORDER: readonly Stage[] = [
  'ground',
  'scan',
  'generate',
  'deliver',
  'patch',
  'verify',
  'restore',
];

export function deriveActivity(agents: AgentStatus[]): ActivityEntry[] {
  const live = agents.filter((a) => a.state !== 'idle');

  const entries: ActivityEntry[] = live
    .map((a) => {
      const status = statusFromState(a.state);
      return {
        id: `stage:${a.stage}`,
        stage: a.stage,
        title: STAGE_TITLE[a.stage],
        status,
        agentName: a.agentName,
        reasoning: a.reasoning,
        confidence: a.confidence,
        uncertainty: a.uncertainty,
        summary: status === 'done' ? STAGE_SUMMARY[a.stage] : '',
        at: a.updatedAt,
      };
    })
    // chronological; ties broken by canonical stage order.
    .sort(
      (x, y) =>
        x.at - y.at ||
        STAGE_ORDER.indexOf(x.stage) - STAGE_ORDER.indexOf(y.stage),
    );

  // Exactly one queued hint: the stage immediately after the furthest reached.
  const lastIndex = live.reduce(
    (max, a) => Math.max(max, STAGE_ORDER.indexOf(a.stage)),
    -1,
  );
  const next = STAGE_ORDER[lastIndex + 1];
  if (next && !live.some((a) => a.stage === next)) {
    entries.push({
      id: `stage:${next}`,
      stage: next,
      title: STAGE_TITLE[next],
      status: 'queued',
      agentName: '',
      reasoning: '',
      confidence: 0,
      uncertainty: '',
      summary: '',
      at: Number.MAX_SAFE_INTEGER,
    });
  }

  return entries;
}
