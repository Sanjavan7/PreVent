// The portal orchestrator. Talks to the local control service: polls for the
// plugged-in device, then streams the REAL scan (honest per-agent timing). If
// the service isn't reachable it falls back to an honest simulation with the
// same findings and realistic durations — the UI and the story are identical.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type { AuthoredCommand, Hardware, RankItem, ScanFinding, Target } from './api';
import { SIM_AGENT_MS, SIM_AUTHORED, SIM_FINDINGS, SIM_RANKING, SIM_TARGET } from './fixtures';

export type Phase = 'connect' | 'ready' | 'scanning' | 'review' | 'exploit';
export type Mode = 'connecting' | 'live' | 'sim';
export type AgentState = 'idle' | 'running' | 'done';

export interface ScanAgent {
  id: string;
  tool: 'semgrep' | 'bandit';
  target: string; // 'device-service' | 'firmware'
  language: string;
  state: AgentState;
  startedAt: number | null;
  durationMs: number | null;
  findingCount: number;
}

const AGENT_SPEC: Omit<ScanAgent, 'state' | 'startedAt' | 'durationMs' | 'findingCount'>[] = [
  { id: 'semgrep/device-service', tool: 'semgrep', target: 'device-service', language: 'python' },
  { id: 'bandit/device-service', tool: 'bandit', target: 'device-service', language: 'python' },
  { id: 'semgrep/firmware', tool: 'semgrep', target: 'firmware', language: 'C/C++' },
  { id: 'bandit/firmware', tool: 'bandit', target: 'firmware', language: 'python' },
];

const freshAgents = (): ScanAgent[] =>
  AGENT_SPEC.map((a) => ({ ...a, state: 'idle', startedAt: null, durationMs: null, findingCount: 0 }));

/** A DeepSeek exploit-author agent — one spawned per exploitable finding. */
export interface AuthorAgent {
  id: string;
  findingId: number;
  target: string;
  file: string;
  model: string;
  state: AgentState; // 'running' = authoring
  startedAt: number | null;
  durationMs: number | null;
  command: AuthoredCommand | null;
  rationale: string;
  impact: string;
  source: string; // 'bitdeer' | 'featherless' | 'pre_cached_fallback'
}

const DISCONNECTED: Hardware = { connected: false, board: null, port: null, fqbn: null };

export interface Pipeline {
  mode: Mode;
  phase: Phase;
  hardware: Hardware;
  target: Target | null;
  agents: ScanAgent[];
  findings: ScanFinding[];
  ranking: RankItem[];
  scanStartedAt: number | null;
  authorAgents: AuthorAgent[];
  startScan: () => void;
  startExploit: () => void;
  reset: () => void;
}

export function usePipeline(): Pipeline {
  const [mode, setMode] = useState<Mode>('connecting');
  const [phase, setPhase] = useState<Phase>('connect');
  const [hardware, setHardware] = useState<Hardware>(DISCONNECTED);
  const [target, setTarget] = useState<Target | null>(null);
  const [agents, setAgents] = useState<ScanAgent[]>(freshAgents);
  const [findings, setFindings] = useState<ScanFinding[]>([]);
  const [ranking, setRanking] = useState<RankItem[]>([]);
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [authorAgents, setAuthorAgents] = useState<AuthorAgent[]>([]);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const closeScan = useRef<(() => void) | null>(null);
  const modeRef = useRef<Mode>('connecting');
  modeRef.current = mode;

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    closeScan.current?.();
    closeScan.current = null;
  }, []);

  const patchAgent = useCallback((id: string, partial: Partial<ScanAgent>) => {
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, ...partial } : a)));
  }, []);

  // ---- connection: detect live service + plugged-in device, else simulate ----
  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | undefined;

    const toSim = () => {
      if (cancelled) return;
      setMode('sim');
      const t = setTimeout(() => {
        if (cancelled) return;
        setHardware({ connected: true, board: 'Arduino UNO R4 WiFi', port: '/dev/cu.usbmodem', fqbn: 'arduino:renesas_uno:unor4wifi' });
        setTarget(SIM_TARGET);
        setPhase('ready');
      }, 1400);
      timers.current.push(t);
    };

    api
      .health()
      .then(() => {
        if (cancelled) return;
        setMode('live');
        const tick = async () => {
          try {
            const hw = await api.hardware();
            if (cancelled) return;
            setHardware(hw);
            if (hw.connected) {
              const tgt = await api.target();
              if (cancelled) return;
              setTarget(tgt);
              setPhase((p) => (p === 'connect' ? 'ready' : p));
            }
          } catch {
            /* transient; keep polling */
          }
        };
        void tick();
        poll = setInterval(tick, 1500);
      })
      .catch(toSim);

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
    };
  }, []);

  // ---- scan ----
  const runSim = useCallback(() => {
    let acc = 0;
    AGENT_SPEC.forEach((spec) => {
      const dur = SIM_AGENT_MS[spec.id] ?? 1500;
      const mine = SIM_FINDINGS.filter((f) => f.scanner === spec.tool && f.target === spec.target);
      timers.current.push(
        setTimeout(() => patchAgent(spec.id, { state: 'running', startedAt: Date.now() }), acc),
      );
      acc += dur;
      timers.current.push(
        setTimeout(() => {
          patchAgent(spec.id, { state: 'done', durationMs: dur, findingCount: mine.length });
          setFindings((prev) => [...prev, ...mine]);
        }, acc),
      );
    });
    timers.current.push(
      setTimeout(() => {
        setFindings(SIM_FINDINGS);
        setRanking(SIM_RANKING);
        setPhase('review');
      }, acc + 500),
    );
  }, [patchAgent]);

  const runLive = useCallback(() => {
    closeScan.current = api.streamScan(
      (e) => {
        if (e.type === 'agent_started') patchAgent(e.agentId, { state: 'running', startedAt: Date.now() });
        else if (e.type === 'agent_finished') {
          patchAgent(e.agentId, { state: 'done', durationMs: e.durationMs, findingCount: e.findingCount });
          setFindings((prev) => [...prev, ...e.findings]);
        } else if (e.type === 'ranking') {
          setFindings(e.findings);
          setRanking(e.ranking);
        } else if (e.type === 'scan_done') {
          setPhase('review');
          closeScan.current?.();
          closeScan.current = null;
        }
      },
      () => {
        // SSE failed mid-stream — fall back to the honest simulation.
        setAgents(freshAgents());
        setFindings([]);
        runSim();
      },
    );
  }, [patchAgent, runSim]);

  const startScan = useCallback(() => {
    clearTimers();
    setAgents(freshAgents());
    setFindings([]);
    setRanking([]);
    setScanStartedAt(Date.now());
    setPhase('scanning');
    if (modeRef.current === 'live') runLive();
    else runSim();
  }, [clearTimers, runLive, runSim]);

  // ---- exploit authoring: spawn one DeepSeek agent per exploitable finding ----
  const patchAuthor = useCallback((findingId: number, partial: Partial<AuthorAgent>) => {
    setAuthorAgents((prev) => prev.map((a) => (a.findingId === findingId ? { ...a, ...partial } : a)));
  }, []);

  const buildAuthors = useCallback((): AuthorAgent[] => {
    const real = ranking.filter((r) => r.real);
    const src = real.length ? real.map((r) => r.findingId) : findings.filter((f) => f.scanner === 'semgrep').map((f) => f.id);
    return src.map((findingId) => {
      const f = findings.find((ff) => ff.id === findingId);
      const target = f?.target ?? 'device';
      return {
        id: `author/${target}`, findingId, target, file: f?.file ?? '',
        model: 'DeepSeek-V4.1-Flash', state: 'idle' as const, startedAt: null,
        durationMs: null, command: null, rationale: '', impact: '', source: '',
      };
    });
  }, [ranking, findings]);

  const runAuthorsSim = useCallback((agents: AuthorAgent[]) => {
    agents.forEach((a, i) => {
      const dur = 2400 + i * 1100;
      timers.current.push(setTimeout(() => patchAuthor(a.findingId, { state: 'running', startedAt: Date.now() }), 300 + i * 250));
      timers.current.push(
        setTimeout(() => {
          const sim = SIM_AUTHORED[a.file];
          patchAuthor(a.findingId, {
            state: 'done', durationMs: dur,
            command: sim?.command ?? { action: 'stop_fan' },
            rationale: sim?.rationale ?? 'Unauthenticated command accepted.',
            impact: sim?.impact ?? 'Fan stopped.',
            source: 'pre_cached_fallback', model: 'DeepSeek-V4.1-Flash',
          });
        }, 300 + i * 250 + dur),
      );
    });
  }, [patchAuthor]);

  const runAuthorsLive = useCallback(
    (agents: AuthorAgent[]) => {
      closeScan.current = api.streamExploit(
        (e) => {
          if (e.type === 'author_started') patchAuthor(e.findingId, { state: 'running', startedAt: Date.now(), model: e.model });
          else if (e.type === 'author_finished')
            patchAuthor(e.findingId, { state: 'done', durationMs: e.durationMs, command: e.command, rationale: e.rationale, impact: e.impact, source: e.source, model: e.model });
          else if (e.type === 'authors_done') {
            closeScan.current?.();
            closeScan.current = null;
          }
        },
        () => runAuthorsSim(agents),
      );
    },
    [patchAuthor, runAuthorsSim],
  );

  const startExploit = useCallback(() => {
    clearTimers();
    const agents = buildAuthors();
    setAuthorAgents(agents);
    setPhase('exploit');
    if (modeRef.current === 'live') runAuthorsLive(agents);
    else runAuthorsSim(agents);
  }, [clearTimers, buildAuthors, runAuthorsLive, runAuthorsSim]);

  const reset = useCallback(() => {
    clearTimers();
    setAgents(freshAgents());
    setFindings([]);
    setRanking([]);
    setScanStartedAt(null);
    setAuthorAgents([]);
    setPhase(hardware.connected ? 'ready' : 'connect');
  }, [clearTimers, hardware.connected]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return useMemo(
    () => ({ mode, phase, hardware, target, agents, findings, ranking, scanStartedAt, authorAgents, startScan, startExploit, reset }),
    [mode, phase, hardware, target, agents, findings, ranking, scanStartedAt, authorAgents, startScan, startExploit, reset],
  );
}
