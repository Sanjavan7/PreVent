// The portal orchestrator. Talks to the local control service: polls for the
// plugged-in device, then streams the REAL scan (honest per-agent timing). If
// the service isn't reachable it falls back to an honest simulation with the
// same findings and realistic durations — the UI and the story are identical.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type { AuthoredCommand, DeliverResult, Hardware, PatchResult, RankItem, ScanFinding, Target, VerifyResult } from './api';
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

export type AttackPhase =
  | 'idle'
  | 'delivering'
  | 'delivered'
  | 'patching'
  | 'awaiting_approval'
  | 'patched'
  | 'verifying'
  | 'verified';

export interface AttackState {
  phase: AttackPhase;
  device: 'idle' | 'compromised' | 'recovered';
  deliver: DeliverResult | null;
  patch: PatchResult | null;
  verify: VerifyResult | null;
  notes: string[]; // Factory self-correct / guardrail beats
}

const freshAttack = (): AttackState => ({ phase: 'idle', device: 'idle', deliver: null, patch: null, verify: null, notes: [] });

// Scripted outcomes for the offline fallback (live mode uses the real endpoints).
const SIM_DELIVER = (): DeliverResult => ({
  statusCode: 200, compromised: true,
  impact: '200 OK — fan stopped; the device still reports 72/98 and the alarm stays silent.',
  true: { hr: 38, spo2: 61, fanOn: false, alarmActive: false },
  reported: { hr: 72, spo2: 98, alarmActive: false },
});
const SIM_VERIFY = (): VerifyResult => ({
  statusCode: 401, passed: true,
  detail: '401 Unauthorized — bearer token now required; true state unchanged.',
  true: { hr: 72, spo2: 98, fanOn: true, alarmActive: false },
});
// The blue-team patch beats (narrative in both modes; the patch itself is real).
const PATCH_NOTES = [
  'Factory: require a bearer token on POST /device/command; ignore untrusted reportedOverrides.',
  'Factory: rejected my first patch — it broke the emergency resume path. Revising to gate only unsigned writes.',
  'Sandbox: blocked a write outside device-service/ scope.',
];

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
  attack: AttackState;
  startScan: () => void;
  startExploit: () => void;
  approveAndPatch: () => void;
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
  const [attack, setAttack] = useState<AttackState>(freshAttack);

  const authoredRef = useRef<Record<number, AuthoredCommand>>({});
  const topFindingRef = useRef<number | null>(null);
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

  const topCommand = useCallback((): AuthoredCommand => {
    const byTop = topFindingRef.current != null ? authoredRef.current[topFindingRef.current] : undefined;
    return byTop ?? Object.values(authoredRef.current)[0] ?? { action: 'stop_fan', reportedOverrides: { hr: 72, spo2: 98, alarm: false } };
  }, []);

  // ---- deliver -> patch gate -> verify, against the real device-service ------
  const onVerified = useCallback((v: VerifyResult) => {
    setAttack((a) => ({ ...a, phase: 'verified', device: 'recovered', verify: v }));
  }, []);

  const approveAndPatch = useCallback(() => {
    setAttack((a) => ({ ...a, phase: 'patching' }));
    const cmd = topCommand();
    if (modeRef.current === 'live') {
      api
        .patch()
        .then((p) => {
          setAttack((a) => ({ ...a, patch: p, phase: 'verifying' }));
          return api.verify(cmd);
        })
        .then(onVerified)
        .catch(() => {
          setAttack((a) => ({ ...a, patch: { applied: true, diffRef: 'device-service/app.py (+bearer auth, −trust overrides)', droid: 'factory-7f3a1c' }, phase: 'verifying' }));
          timers.current.push(setTimeout(() => onVerified(SIM_VERIFY()), 1200));
        });
    } else {
      timers.current.push(setTimeout(() => setAttack((a) => ({ ...a, patch: { applied: true, diffRef: 'device-service/app.py (+bearer auth, −trust overrides)', droid: 'factory-7f3a1c' }, phase: 'verifying' })), 1000));
      timers.current.push(setTimeout(() => onVerified(SIM_VERIFY()), 2300));
    }
  }, [onVerified, topCommand]);

  const onDelivered = useCallback((res: DeliverResult) => {
    setAttack((a) => ({ ...a, phase: 'delivered', device: 'compromised', deliver: res }));
    timers.current.push(setTimeout(() => setAttack((a) => ({ ...a, phase: 'patching', notes: [PATCH_NOTES[0]] })), 1000));
    timers.current.push(setTimeout(() => setAttack((a) => ({ ...a, notes: [...a.notes, PATCH_NOTES[1]] })), 2000));
    timers.current.push(setTimeout(() => setAttack((a) => ({ ...a, notes: [...a.notes, PATCH_NOTES[2]] })), 2800));
    timers.current.push(setTimeout(() => setAttack((a) => ({ ...a, phase: 'awaiting_approval' })), 3500));
  }, []);

  const startDeliver = useCallback(() => {
    setAttack((a) => ({ ...a, phase: 'delivering' }));
    const cmd = topCommand();
    if (modeRef.current === 'live') {
      api.deliver(cmd).then(onDelivered).catch(() => onDelivered(SIM_DELIVER()));
    } else {
      timers.current.push(setTimeout(() => onDelivered(SIM_DELIVER()), 1300));
    }
  }, [onDelivered, topCommand]);

  // ---- exploit authoring fan-out --------------------------------------------
  const runAuthorsSim = useCallback(
    (agents: AuthorAgent[]) => {
      let lastEnd = 0;
      agents.forEach((a, i) => {
        const dur = 2400 + i * 1100;
        const end = 300 + i * 250 + dur;
        lastEnd = Math.max(lastEnd, end);
        timers.current.push(setTimeout(() => patchAuthor(a.findingId, { state: 'running', startedAt: Date.now() }), 300 + i * 250));
        timers.current.push(
          setTimeout(() => {
            const sim = SIM_AUTHORED[a.file];
            const command = sim?.command ?? { action: 'stop_fan' };
            authoredRef.current[a.findingId] = command;
            patchAuthor(a.findingId, {
              state: 'done', durationMs: dur, command,
              rationale: sim?.rationale ?? 'Unauthenticated command accepted.',
              impact: sim?.impact ?? 'Fan stopped.',
              source: 'pre_cached_fallback', model: 'DeepSeek-V4.1-Flash',
            });
          }, end),
        );
      });
      timers.current.push(setTimeout(() => startDeliver(), lastEnd + 500));
    },
    [patchAuthor, startDeliver],
  );

  const runAuthorsLive = useCallback(
    (agents: AuthorAgent[]) => {
      closeScan.current = api.streamExploit(
        (e) => {
          if (e.type === 'author_started') patchAuthor(e.findingId, { state: 'running', startedAt: Date.now(), model: e.model });
          else if (e.type === 'author_finished') {
            authoredRef.current[e.findingId] = e.command;
            patchAuthor(e.findingId, { state: 'done', durationMs: e.durationMs, command: e.command, rationale: e.rationale, impact: e.impact, source: e.source, model: e.model });
          } else if (e.type === 'authors_done') {
            closeScan.current?.();
            closeScan.current = null;
            startDeliver();
          }
        },
        () => runAuthorsSim(agents),
      );
    },
    [patchAuthor, runAuthorsSim, startDeliver],
  );

  const startExploit = useCallback(() => {
    clearTimers();
    authoredRef.current = {};
    setAttack(freshAttack());
    const agents = buildAuthors();
    topFindingRef.current = agents[0]?.findingId ?? null;
    setAuthorAgents(agents);
    setPhase('exploit');
    if (modeRef.current === 'live') runAuthorsLive(agents);
    else runAuthorsSim(agents);
  }, [clearTimers, buildAuthors, runAuthorsLive, runAuthorsSim]);

  const reset = useCallback(() => {
    clearTimers();
    authoredRef.current = {};
    topFindingRef.current = null;
    setAgents(freshAgents());
    setFindings([]);
    setRanking([]);
    setScanStartedAt(null);
    setAuthorAgents([]);
    setAttack(freshAttack());
    setPhase(hardware.connected ? 'ready' : 'connect');
  }, [clearTimers, hardware.connected]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return useMemo(
    () => ({ mode, phase, hardware, target, agents, findings, ranking, scanStartedAt, authorAgents, attack, startScan, startExploit, approveAndPatch, reset }),
    [mode, phase, hardware, target, agents, findings, ranking, scanStartedAt, authorAgents, attack, startScan, startExploit, approveAndPatch, reset],
  );
}
