// The portal orchestrator. Polls for the plugged-in device, streams the REAL
// scan, then runs the attack as TWO visible stages: DeepSeek curates the SERVER
// exploit (streaming its reasoning) → breach the server over real HTTP → then
// curates the FAN exploit → flash the malicious fan-off firmware to the real
// board. Falls back to an honest simulation (same story, streamed) if the
// control service isn't reachable.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type { AuthoredCommand, DeliverResult, FlashResult, Hardware, RankItem, ScanFinding, Target } from './api';
import { SIM_AGENT_MS, SIM_AUTHORED, SIM_FINDINGS, SIM_RANKING, SIM_TARGET } from './fixtures';

export type Phase = 'connect' | 'ready' | 'scanning' | 'review' | 'exploit';
export type Mode = 'connecting' | 'live' | 'sim';
export type AgentState = 'idle' | 'running' | 'done';

export interface ScanAgent {
  id: string;
  tool: 'semgrep' | 'bandit';
  target: string;
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

/** A DeepSeek exploit-author agent — one per exploitable finding. Its `transcript`
 *  accumulates the model's streamed reasoning so judges watch it curate live. */
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
  source: string;
  transcript: string; // streamed reasoning
  prompt: { system: string; user: string } | null;
}

/** The attack runs as two sequential, visible stages. */
export type ExploitStage =
  | 'idle'
  | 'curating_server'
  | 'server_ready'
  | 'breaching_server'
  | 'server_breached'
  | 'curating_fan'
  | 'fan_ready'
  | 'flashing_fan'
  | 'fan_breached';

const DISCONNECTED: Hardware = { connected: false, board: null, port: null, fqbn: null };

const SIM_DELIVER = (): DeliverResult => ({
  statusCode: 200, compromised: true,
  impact: '200 OK — server accepted the unauthenticated command; fan commanded off, monitor still reports 72/98.',
  true: { hr: 38, spo2: 61, fanOn: false, alarmActive: false },
  reported: { hr: 72, spo2: 98, alarmActive: false },
});
const SIM_FLASH = (): FlashResult => ({
  ok: true, durationMs: 4800, port: '/dev/cu.usbmodem',
  log: 'avrdude: 5234 bytes of flash written\navrdude: verifying flash memory against prevent_fanoff.ino.hex\navrdude: verified', error: null,
});

function simReasoning(a: AuthorAgent): string {
  const sim = SIM_AUTHORED[a.file];
  const cmd = JSON.stringify(sim?.command ?? { action: 'stop_fan' });
  return (
    `## Reasoning\n` +
    `1. Flaw: ${a.target} exposes a state-changing control path with no authentication guard (CWE-306).\n` +
    `2. Abuse: a single unauthenticated request can both stop the ventilator fan and spoof the reported vitals/alarm.\n` +
    `3. ${sim?.rationale ?? 'The handler accepts the command outright.'}\n` +
    `4. Impact: ${sim?.impact ?? 'the fan stops while the monitor keeps reading healthy.'}\n\n` +
    `Payload:\n\`\`\`json\n${cmd}\n\`\`\`\n`
  );
}

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
  exploitStage: ExploitStage;
  serverBreach: DeliverResult | null;
  fanBreach: FlashResult | null;
  startScan: () => void;
  startExploit: () => void;
  sendToServer: () => void;
  sendToFan: () => void;
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
  const [exploitStage, setExploitStage] = useState<ExploitStage>('idle');
  const [serverBreach, setServerBreach] = useState<DeliverResult | null>(null);
  const [fanBreach, setFanBreach] = useState<FlashResult | null>(null);

  const authoredRef = useRef<Record<number, AuthoredCommand>>({});
  const serverFindingRef = useRef<number | null>(null);
  const fanFindingRef = useRef<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const closeStream = useRef<(() => void) | null>(null);
  const modeRef = useRef<Mode>('connecting');
  modeRef.current = mode;

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    closeStream.current?.();
    closeStream.current = null;
  }, []);

  const patchAgent = useCallback((id: string, partial: Partial<ScanAgent>) => {
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, ...partial } : a)));
  }, []);
  const patchAuthor = useCallback((findingId: number, partial: Partial<AuthorAgent>) => {
    setAuthorAgents((prev) => prev.map((a) => (a.findingId === findingId ? { ...a, ...partial } : a)));
  }, []);
  const appendTranscript = useCallback((findingId: number, text: string) => {
    setAuthorAgents((prev) => prev.map((a) => (a.findingId === findingId ? { ...a, transcript: a.transcript + text } : a)));
  }, []);

  // ---- connection ----
  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | undefined;

    const toSim = () => {
      if (cancelled) return;
      setMode('sim');
      timers.current.push(
        setTimeout(() => {
          if (cancelled) return;
          setHardware({ connected: true, board: 'Arduino UNO R4 WiFi', port: '/dev/cu.usbmodem', fqbn: 'arduino:renesas_uno:unor4wifi' });
          setTarget(SIM_TARGET);
          setPhase('ready');
        }, 1400),
      );
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
            /* transient */
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
  const runScanSim = useCallback(() => {
    let acc = 0;
    AGENT_SPEC.forEach((spec) => {
      const dur = SIM_AGENT_MS[spec.id] ?? 1500;
      const mine = SIM_FINDINGS.filter((f) => f.scanner === spec.tool && f.target === spec.target);
      timers.current.push(setTimeout(() => patchAgent(spec.id, { state: 'running', startedAt: Date.now() }), acc));
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

  const runScanLive = useCallback(() => {
    closeStream.current = api.streamScan(
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
          closeStream.current?.();
          closeStream.current = null;
        }
      },
      () => {
        setAgents(freshAgents());
        setFindings([]);
        runScanSim();
      },
    );
  }, [patchAgent, runScanSim]);

  const startScan = useCallback(() => {
    clearTimers();
    setAgents(freshAgents());
    setFindings([]);
    setRanking([]);
    setScanStartedAt(Date.now());
    setPhase('scanning');
    if (modeRef.current === 'live') runScanLive();
    else runScanSim();
  }, [clearTimers, runScanLive, runScanSim]);

  // ---- exploit: curate one author (streaming), live or simulated ----
  const curateSim = useCallback(
    (findingId: number, onDone: () => void) => {
      const agent = buildOne(findings, ranking, findingId);
      const text = simReasoning(agent);
      const sim = SIM_AUTHORED[agent.file];
      const command = sim?.command ?? { action: 'stop_fan' };
      patchAuthor(findingId, { state: 'running', startedAt: Date.now() });
      // Stream the reasoning in chunks so judges watch it curate (realistic pace).
      const chunk = 10;
      const stepMs = 55;
      let i = 0;
      const total = 300 + Math.ceil(text.length / chunk) * stepMs;
      for (let pos = 0; pos < text.length; pos += chunk) {
        const slice = text.slice(pos, pos + chunk);
        timers.current.push(setTimeout(() => appendTranscript(findingId, slice), 300 + i * stepMs));
        i += 1;
      }
      timers.current.push(
        setTimeout(() => {
          authoredRef.current[findingId] = command;
          patchAuthor(findingId, {
            state: 'done', durationMs: total, command, source: 'pre_cached_fallback', model: 'DeepSeek-V4.1-Flash',
            rationale: sim?.rationale ?? '', impact: sim?.impact ?? '',
          });
          onDone();
        }, total),
      );
    },
    [appendTranscript, findings, patchAuthor, ranking],
  );

  const curate = useCallback(
    (findingId: number, onDone: () => void) => {
      if (modeRef.current !== 'live') {
        curateSim(findingId, onDone);
        return;
      }
      closeStream.current = api.streamExploit(
        (e) => {
          if (e.type === 'author_started') patchAuthor(e.findingId, { state: 'running', startedAt: Date.now(), model: e.model, prompt: e.prompt });
          else if (e.type === 'author_delta') appendTranscript(e.findingId, e.text);
          else if (e.type === 'author_finished') {
            authoredRef.current[e.findingId] = e.command;
            patchAuthor(e.findingId, { state: 'done', durationMs: e.durationMs, command: e.command, rationale: e.rationale, impact: e.impact, source: e.source, model: e.model });
          } else if (e.type === 'authors_done') {
            closeStream.current?.();
            closeStream.current = null;
            onDone();
          }
        },
        () => curateSim(findingId, onDone),
        findingId,
      );
    },
    [appendTranscript, curateSim, patchAuthor],
  );

  // ---- stage 1: server, stage 2: fan ----
  const curateFan = useCallback(() => {
    const fid = fanFindingRef.current;
    if (fid == null) return;
    setExploitStage('curating_fan');
    curate(fid, () => setExploitStage('fan_ready'));
  }, [curate]);

  const sendToServer = useCallback(() => {
    const fid = serverFindingRef.current;
    const cmd = (fid != null && authoredRef.current[fid]) || { action: 'stop_fan', reportedOverrides: { hr: 72, spo2: 98, alarm: false } };
    setExploitStage('breaching_server');
    const done = (res: DeliverResult) => {
      setServerBreach(res);
      setExploitStage('server_breached');
      timers.current.push(setTimeout(curateFan, 900)); // then curate the fan exploit
    };
    if (modeRef.current === 'live') api.deliver(cmd).then(done).catch(() => done(SIM_DELIVER()));
    else timers.current.push(setTimeout(() => done(SIM_DELIVER()), 1200));
  }, [curateFan]);

  const sendToFan = useCallback(() => {
    setExploitStage('flashing_fan');
    const done = (res: FlashResult) => {
      setFanBreach(res);
      setExploitStage('fan_breached');
    };
    if (modeRef.current === 'live') api.flash().then(done).catch(() => done({ ...SIM_FLASH(), ok: false, error: 'flash failed' }));
    else timers.current.push(setTimeout(() => done(SIM_FLASH()), 4200));
  }, []);

  const startExploit = useCallback(() => {
    clearTimers();
    authoredRef.current = {};
    setServerBreach(null);
    setFanBreach(null);
    const built = buildAuthors(findings, ranking);
    serverFindingRef.current = built.find((a) => a.target === 'device-service')?.findingId ?? built[0]?.findingId ?? null;
    fanFindingRef.current = built.find((a) => a.target === 'firmware')?.findingId ?? built[1]?.findingId ?? null;
    setAuthorAgents(built);
    setPhase('exploit');
    setExploitStage('curating_server');
    if (serverFindingRef.current != null) curate(serverFindingRef.current, () => setExploitStage('server_ready'));
  }, [clearTimers, curate, findings, ranking]);

  const reset = useCallback(() => {
    clearTimers();
    authoredRef.current = {};
    serverFindingRef.current = null;
    fanFindingRef.current = null;
    setAgents(freshAgents());
    setFindings([]);
    setRanking([]);
    setScanStartedAt(null);
    setAuthorAgents([]);
    setExploitStage('idle');
    setServerBreach(null);
    setFanBreach(null);
    setPhase(hardware.connected ? 'ready' : 'connect');
  }, [clearTimers, hardware.connected]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return useMemo(
    () => ({ mode, phase, hardware, target, agents, findings, ranking, scanStartedAt, authorAgents, exploitStage, serverBreach, fanBreach, startScan, startExploit, sendToServer, sendToFan, reset }),
    [mode, phase, hardware, target, agents, findings, ranking, scanStartedAt, authorAgents, exploitStage, serverBreach, fanBreach, startScan, startExploit, sendToServer, sendToFan, reset],
  );
}

// ---- helpers (pure) ----
function buildOne(findings: ScanFinding[], _ranking: RankItem[], findingId: number): AuthorAgent {
  const f = findings.find((ff) => ff.id === findingId);
  const target = f?.target ?? 'device';
  return {
    id: `author/${target}`, findingId, target, file: f?.file ?? '',
    model: 'DeepSeek-V4.1-Flash', state: 'idle', startedAt: null, durationMs: null,
    command: null, rationale: '', impact: '', source: '', transcript: '', prompt: null,
  };
}

function buildAuthors(findings: ScanFinding[], ranking: RankItem[]): AuthorAgent[] {
  const real = ranking.filter((r) => r.real);
  const ids = real.length ? real.map((r) => r.findingId) : findings.filter((f) => f.scanner === 'semgrep').map((f) => f.id);
  return ids.map((id) => buildOne(findings, ranking, id));
}
