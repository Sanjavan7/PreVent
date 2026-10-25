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

  /** Stream the real scan. Returns a cleanup fn. Calls onEvent per SSE message. */
  streamScan(onEvent: (e: ScanEvent) => void, onError: () => void): () => void {
    const es = new EventSource(`${BASE}/api/scan/stream`);
    es.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data) as ScanEvent);
      } catch {
        /* ignore malformed frame */
      }
    };
    es.onerror = () => {
      es.close();
      onError();
    };
    return () => es.close();
  },
};
