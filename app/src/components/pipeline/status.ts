// Single source of truth for the activity-feed status vocabulary: the five UI
// statuses, the per-stage titles, and the status -> visual tokens (marker +
// pill tone). Keeping this here means no component re-decides what a status
// looks like.
//
// OWNER OVERRIDE (zero amber): the `needs-approval` beat reads BLUE (accent),
// NOT amber. The unused --color-warn tokens stay in index.css; nothing here
// references them.

import type { AgentState, Stage } from '@prevent/contracts';

export type ActivityStatus =
  | 'running'
  | 'needs-approval'
  | 'done'
  | 'error'
  | 'queued';

/** One-line title per stage (the feed row heading). */
export const STAGE_TITLE: Record<Stage, string> = {
  ground: 'Grounded device context',
  scan: 'Scanned device service',
  generate: 'Generated the exploit proof',
  deliver: 'Proved the exploit in sandbox',
  patch: 'Writing the auth fix',
  verify: 'Verified the fix',
  restore: 'Restored the device',
};

/** One concise summary line kept on a stage after it collapses to `done`, so a
 *  finished row reads as more than "title + Done" once its streaming reasoning
 *  and confidence meter have unmounted. */
export const STAGE_SUMMARY: Record<Stage, string> = {
  ground: 'Firmware + device-service source pulled into context.',
  scan: 'semgrep: missing auth on POST /device/command — CWE-306.',
  generate: 'PoC ready — unsigned stop_fan while vitals still read normal.',
  deliver: '200 OK — the device obeyed the unsigned payload.',
  patch: 'Auth fix approved and deployed to device-service/.',
  verify: 'Same exploit replayed → 401 Unauthorized.',
  restore: 'Device restored to its signed-command baseline; vitals recovered.',
};

/** Map the raw agent state onto the five UI statuses. */
export function statusFromState(state: AgentState): ActivityStatus {
  switch (state) {
    case 'running':
      return 'running';
    case 'waiting_for_human':
      return 'needs-approval';
    case 'done':
      return 'done';
    case 'error':
      return 'error';
    default:
      return 'queued';
  }
}

export type MarkerKind = 'spinner' | 'approval' | 'check' | 'error' | 'queued';
export type PillTone = 'neutral' | 'accent' | 'danger';

export interface StatusToken {
  /** text for the StatusPill */
  label: string;
  /** which StatusMarker glyph sits in the left gutter */
  marker: MarkerKind;
  /** pill color family */
  tone: PillTone;
  /** whether the feed body is expanded (vs collapsed to one summary line) */
  expanded: boolean;
}

export const STATUS_TOKENS: Record<ActivityStatus, StatusToken> = {
  running: { label: 'Running', marker: 'spinner', tone: 'neutral', expanded: true },
  'needs-approval': { label: 'Needs approval', marker: 'approval', tone: 'accent', expanded: true },
  done: { label: 'Done', marker: 'check', tone: 'neutral', expanded: false },
  error: { label: 'Failed', marker: 'error', tone: 'danger', expanded: true },
  queued: { label: 'Queued', marker: 'queued', tone: 'neutral', expanded: false },
};
