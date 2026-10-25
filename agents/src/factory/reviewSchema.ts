// Typed review contract for the read-only reviewer Droid session
// (blueprint §6c, mirrors the front-end `PatchReview` in §3b api.ts).
//
// PATCH_REVIEW_SCHEMA is handed to the SDK as the `json_schema` outputFormat so
// the reviewer returns a machine-checkable verdict. `isPatchReview()` is a
// structural guard: the terminal `result.structuredOutput` is typed `unknown`,
// so the runner validates it before emitting `review_verdict{structured:true}`.

export type ReviewVerdict = 'approve' | 'request_changes' | 'block';
export type IssueSeverity = 'low' | 'medium' | 'high';

export interface PatchReviewIssue {
  severity: IssueSeverity;
  file: string;
  line?: number;
  note: string;
}

export interface PatchReview {
  verdict: ReviewVerdict;
  confidence: number;
  closesCwe306: boolean;
  requiresAuthNow: boolean;
  ignoresUntrustedOverrides: boolean;
  onlyAppPyTouched: boolean;
  summary: string;
  issues: PatchReviewIssue[];
}

/** JSON Schema passed to the SDK via `outputFormat: { type: 'json_schema', schema }`. */
export const PATCH_REVIEW_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'verdict',
    'confidence',
    'closesCwe306',
    'requiresAuthNow',
    'ignoresUntrustedOverrides',
    'onlyAppPyTouched',
    'summary',
    'issues',
  ],
  properties: {
    verdict: { enum: ['approve', 'request_changes', 'block'] },
    confidence: { type: 'number' },
    closesCwe306: { type: 'boolean' },
    requiresAuthNow: { type: 'boolean' },
    ignoresUntrustedOverrides: { type: 'boolean' },
    onlyAppPyTouched: { type: 'boolean' },
    summary: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'note'],
        properties: {
          severity: { enum: ['low', 'medium', 'high'] },
          file: { type: 'string' },
          line: { type: 'number' },
          note: { type: 'string' },
        },
      },
    },
  },
};

const VERDICTS: readonly ReviewVerdict[] = ['approve', 'request_changes', 'block'];
const SEVERITIES: readonly IssueSeverity[] = ['low', 'medium', 'high'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isIssue(v: unknown): v is PatchReviewIssue {
  if (!isRecord(v)) return false;
  if (!SEVERITIES.includes(v.severity as IssueSeverity)) return false;
  if (typeof v.file !== 'string') return false;
  if (typeof v.note !== 'string') return false;
  if (v.line !== undefined && typeof v.line !== 'number') return false;
  return true;
}

/** Structural guard for the (typed `unknown`) reviewer structuredOutput. */
export function isPatchReview(v: unknown): v is PatchReview {
  if (!isRecord(v)) return false;
  if (!VERDICTS.includes(v.verdict as ReviewVerdict)) return false;
  if (typeof v.confidence !== 'number') return false;
  if (typeof v.closesCwe306 !== 'boolean') return false;
  if (typeof v.requiresAuthNow !== 'boolean') return false;
  if (typeof v.ignoresUntrustedOverrides !== 'boolean') return false;
  if (typeof v.onlyAppPyTouched !== 'boolean') return false;
  if (typeof v.summary !== 'string') return false;
  if (!Array.isArray(v.issues) || !v.issues.every(isIssue)) return false;
  return true;
}
