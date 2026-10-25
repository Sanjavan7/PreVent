// Client for the local control-plane service (security/portal_server.py).
// It detects the plugged-in Arduino, runs the REAL Semgrep/Bandit scanners
// (honest timing, streamed over SSE), and serves the actual source so findings
// open into real code. Every call fails soft: if the service isn't running the
// portal falls back to an honest local simulation (see usePipeline).

const BASE = import.meta.env.VITE_PORTAL_API ?? 'http://127.0.0.1:8077';

export interface Hardware {
  connected: boolean;
  board: string | null;
  port: string | null;
  fqbn: string | null;
}

export interface TargetFile {
  path: string;
  lang: string;
  loc: number;
}

export interface PlantedVuln {
  id: string;
  title: string;
  cwe: string;
  cveRef: string;
  file: string;
  line: number;
  severity: string;
  note: string;
}

export interface Target {
  name: string;
  root: string;
  files: TargetFile[];
  plantedVulns: PlantedVuln[];
}

export interface ScanFinding {
  id: number;
  scanner: 'semgrep' | 'bandit';
  tool?: string;
  target: string;
  file: string;
  line: number;
  severity: string;
  ruleId: string;
  message: string;
  cveRef?: string;
  cwe?: string;
}

export interface RankItem {
  rank: number;
  findingId: number;
  cvss: number;
  real: boolean;
  verdict: string;
}

export interface CodeFile {
  path: string;
  lang: string;
  content: string;
  lines: number;
}

export type ScanEvent =
  | { type: 'agent_started'; agentId: string; tool: string; target: string; language: string; ts: number }
  | { type: 'agent_finished'; agentId: string; tool: string; target: string; durationMs: number; findingCount: number; findings: ScanFinding[] }
  | { type: 'ranking'; findings: ScanFinding[]; ranking: RankItem[]; durationMs: number }
  | { type: 'scan_done' };

/** A DeepSeek-authored, validated device command (the exploit payload). */
export interface AuthoredCommand {
  action: string; // 'stop_fan' | 'set_rate' | 'resume'
  rate?: number;
  reportedOverrides?: { hr?: number; spo2?: number; alarm?: boolean };
}

export type ExploitEvent =
  | { type: 'author_started'; agentId: string; findingId: number; target: string; file: string; model: string; ts: number; prompt: { system: string; user: string } }
  | { type: 'author_delta'; agentId: string; findingId: number; text: string }
  | { type: 'author_finished'; agentId: string; findingId: number; target: string; durationMs: number; model: string; source: string; command: AuthoredCommand; impact: string; rationale: string; fullText: string }
  | { type: 'authors_done'; count: number };

export interface FlashResult {
  ok: boolean;
  durationMs: number;
  port: string;
  log: string;
  error: string | null;
}

function streamSSE<E>(path: string, onEvent: (e: E) => void, onError: () => void): () => void {
  const es = new EventSource(`${BASE}${path}`);
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data) as E);
    } catch {
      /* ignore malformed frame */
    }
  };
  es.onerror = () => {
    es.close();
    onError();
  };
  return () => es.close();
}

export interface Vitals {
  hr: number;
  spo2: number;
  fanOn?: boolean;
  alarmActive: boolean;
}

export interface DeliverResult {
  statusCode: number;
  compromised: boolean;
  impact: string;
  true: Vitals;
  reported: Vitals;
}

/** The read-only reviewer's structured verdict on Droid's patch. */
export interface PatchReview {
  verdict: 'approve' | 'request_changes' | 'block';
  confidence: number;
  closesCwe306: boolean;
  requiresAuthNow: boolean;
  ignoresUntrustedOverrides: boolean;
  onlyAppPyTouched: boolean;
  summary: string;
  issues: { severity: 'low' | 'medium' | 'high'; file: string; line?: number; note: string }[];
}

/** The merged patch stream: Node-runner lines relayed verbatim, then the
 *  Python-synthesized gate / verify tail. One SSE `data:` frame per event. */
export type PatchEvent =
  | { type: 'writer_started'; sessionId: string; model: string; usedFallback: boolean }
  | { type: 'writer_delta'; channel: 'text' | 'thinking'; text: string }
  | { type: 'writer_tool'; phase: 'call' | 'progress'; name: string; toolUseId?: string; detail?: string }
  | { type: 'shield_blocked'; command: string; reason: string; ts: number }
  | { type: 'credits'; factoryCredits?: number; inputTokens: number; outputTokens: number; thinkingTokens: number }
  | { type: 'diff'; diff: string; files: string[]; empty: boolean }
  | { type: 'reviewer_started'; sessionId: string; model: string; readOnly: boolean; disabledToolIds: string[] }
  | { type: 'reviewer_delta'; channel: 'text' | 'thinking'; text: string }
  | { type: 'review_verdict'; review: PatchReview; structured: boolean; fallbackText?: string }
  | { type: 'awaiting_approval'; diffRef: string; verdict: PatchReview | null }
  | { type: 'patch_applied'; approvedBy: string; ranAgainst: string }
  | { type: 'verify_result'; statusCode: number; passed: boolean; detail: string; true: Vitals; ranAgainst: string }
  | { type: 'patch_rejected'; reverted: string[] }
  | { type: 'patch_done'; outcome: 'verified' | 'failed' | 'rejected' };

export interface VerifyResult {
  statusCode: number;
  passed: boolean;
  detail: string;
  true: Vitals;
  ranAgainst: string;
}

async function postJSON<T>(path: string, body: unknown, timeoutMs = 20000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

async function getJSON<T>(path: string, timeoutMs = 2500): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: ctl.signal });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export const api = {
  base: BASE,
  health: () => getJSON<{ ok: boolean }>('/api/health', 1200),
  hardware: () => getJSON<Hardware>('/api/hardware'),
  target: () => getJSON<Target>('/api/target'),
  file: (path: string) => getJSON<CodeFile>(`/api/file?path=${encodeURIComponent(path)}`),

  /** Stream the real scan (one SSE message per agent event). */
  streamScan: (onEvent: (e: ScanEvent) => void, onError: () => void) =>
    streamSSE<ScanEvent>('/api/scan/stream', onEvent, onError),

  /** Stream one DeepSeek exploit author's real reasoning (optionally a single
   *  finding, so the server stage and the fan stage can run separately). */
  streamExploit: (onEvent: (e: ExploitEvent) => void, onError: () => void, findingId?: number) =>
    streamSSE<ExploitEvent>(`/api/exploit/stream${findingId != null ? `?finding=${findingId}` : ''}`, onEvent, onError),

  // Stage 1 — real HTTP against the running device-service (server breach).
  deliver: (command: AuthoredCommand) => postJSON<DeliverResult>('/api/deliver', { command }),
  verify: (command: AuthoredCommand) => postJSON<VerifyResult>('/api/verify', { command }),
  restore: () => postJSON<{ ok: boolean }>('/api/restore', {}),

  // Patch stage — the Glass-Box review cell. A long-lived SSE stream carries the
  // writer/reviewer transcripts, the diff and the verdict, blocks on the human
  // gate, then relays the apply + VERIFY (approve) or git-revert (reject) tail.
  streamPatch: (onEvent: (e: PatchEvent) => void, onError: () => void) =>
    streamSSE<PatchEvent>('/api/patch/stream', onEvent, onError),
  approve: (body?: { approvedBy?: string }) => postJSON<{ ok: boolean }>('/api/approve', body ?? {}),
  reject: () => postJSON<{ ok: boolean }>('/api/reject', {}),

  // Stage 2 — flash the malicious fan-off firmware to the real board (physical).
  flash: () => postJSON<FlashResult>('/api/flash', {}, 180000),
  flashRestore: () => postJSON<FlashResult>('/api/flash/restore', {}, 180000),
};
