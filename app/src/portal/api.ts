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
  | { type: 'agent_finished'; agentId: string; tool: string; target: string; language: string; durationMs: number; findingCount: number; findings: ScanFinding[] }
  | { type: 'ranking'; findings: ScanFinding[]; ranking: RankItem[]; durationMs: number }
  | { type: 'scan_done' }
  | { type: 'scan_error'; message: string };

/** A DeepSeek-authored, validated device command (the exploit payload). */
export interface AuthoredCommand {
  action: string; // 'stop_fan' | 'set_rate' | 'resume'
  rate?: number;
  reportedOverrides?: { hr?: number; spo2?: number; alarm?: boolean };
}

// The parallel exploit stream: the server opens ONE DeepSeek conversation per
// scanner finding and multiplexes their live turns over a SINGLE SSE stream,
// every frame tagged by `findingId`. Per finding the beats are:
//   agent_spawned → (turn | delta)* → verdict → payload? → agent_done
// and a terminal `all_done` fires once every conversation has ended.
export type ExploitEvent =
  | { type: 'agent_spawned'; findingId: number; model: string; file: string; target: string }
  | { type: 'turn'; findingId: number; role: 'deepseek'; text: string }
  | { type: 'delta'; findingId: number; role: 'deepseek'; text: string }
  | { type: 'verdict'; findingId: number; exploitable: boolean; rationale: string }
  | { type: 'payload'; findingId: number; command: AuthoredCommand; impact: string; patientRisk: string; patchRisk: string }
  | { type: 'agent_done'; findingId: number; durationMs: number; source: string }
  | { type: 'all_done'; count: number };

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
 *  Python-synthesized gate / verify tail. One SSE `data:` frame per event.
 *  Every frame now carries `parentFindingId` — the DeepSeek finding node the
 *  Factory patch nodes hang off (null when no exploitable server finding). */
export type PatchEvent =
  | { type: 'writer_started'; parentFindingId: number | null; sessionId: string; model: string; usedFallback: boolean }
  | { type: 'writer_delta'; parentFindingId: number | null; channel: 'text' | 'thinking'; text: string }
  | { type: 'writer_tool'; parentFindingId: number | null; phase: 'call' | 'progress'; name: string; toolUseId?: string; detail?: string }
  | { type: 'shield_blocked'; parentFindingId: number | null; command: string; reason: string; ts: number }
  | { type: 'credits'; parentFindingId: number | null; factoryCredits?: number; inputTokens: number; outputTokens: number; thinkingTokens: number }
  | { type: 'diff'; parentFindingId: number | null; diff: string; files: string[]; empty: boolean }
  | { type: 'reviewer_started'; parentFindingId: number | null; sessionId: string; model: string; readOnly: boolean; disabledToolIds: string[] }
  | { type: 'reviewer_delta'; parentFindingId: number | null; channel: 'text' | 'thinking'; text: string }
  | { type: 'review_verdict'; parentFindingId: number | null; review: PatchReview; structured: boolean; fallbackText?: string }
  | { type: 'awaiting_approval'; parentFindingId: number | null; diffRef: string; verdict: PatchReview | null }
  | { type: 'patch_applied'; parentFindingId: number | null; approvedBy: string; ranAgainst: string }
  | { type: 'verify_result'; parentFindingId: number | null; statusCode: number; passed: boolean; detail: string; true: Vitals; ranAgainst: string }
  | { type: 'patch_rejected'; parentFindingId: number | null; reverted: string[] }
  | { type: 'patch_done'; parentFindingId: number | null; outcome: 'verified' | 'failed' | 'rejected' };

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

  /** Stream a real clone + scan of an arbitrary public GitHub repo. Same event
   *  shape as streamScan, plus a terminal `scan_error` on failure. `repo` is
   *  owner/name (or a full github.com URL — the server re-parses either). */
  streamRepoScan: (repo: string, onEvent: (e: ScanEvent) => void, onError: () => void) =>
    streamSSE<ScanEvent>(`/api/repo/scan/stream?repo=${encodeURIComponent(repo)}`, onEvent, onError),

  /** A source file from the active cloned repo (repo-scan mode). */
  repoFile: (path: string) => getJSON<CodeFile>(`/api/repo/file?path=${encodeURIComponent(path)}`),

  /** Open ONE DeepSeek conversation per scanner finding, ALL IN PARALLEL, and
   *  stream their live turns over a single multiplexed SSE (tagged by findingId).
   *  Streams every finding by default; `?finding=<id>` narrows to just one. */
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
