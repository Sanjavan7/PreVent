// The portal orchestrator. Polls for the plugged-in device, streams the REAL
// scan, then runs the attack as N PARALLEL DeepSeek conversations — ONE per
// scanner finding, all streaming at once over a single multiplexed SSE. Each
// conversation reaches its own verdict (exploitable or not) and, when
// exploitable, an authored payload. The user then picks ONE exploitable finding
// + a route (breach the server over real HTTP, or flash the malicious fan-off
// firmware to the real board), then drives the Factory patch → approval → verify
// remediation. Falls back to an honest simulation (same story, streamed) if the
// control service isn't reachable.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type { AuthoredCommand, DeliverResult, FlashResult, Hardware, PatchReview, RankItem, ScanFinding, Target, VerifyResult } from './api';
import { SIM_AGENT_MS, SIM_EXPLOIT_SCRIPTS, SIM_FINDINGS, SIM_RANKING, SIM_TARGET } from './fixtures';

export type ExploitRoute = 'server' | 'fan';

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

/** A DeepSeek exploit-author agent — ONE per scanner finding, keyed by
 *  findingId. All N run in parallel; each `transcript` accumulates its own
 *  streamed turns/deltas so judges watch every conversation curate live. The
 *  model decides `verdict.exploitable`; an exploitable one also carries the
 *  authored `command` + impact + patient/patch risk. */
export interface AuthorAgent {
  id: string; // graph node id — `author/<findingId>`
  findingId: number;
  target: string;
  file: string;
  model: string;
  state: AgentState; // 'running' = the conversation is streaming
  startedAt: number | null;
  durationMs: number | null;
  transcript: string; // streamed turns + deltas
  verdict: { exploitable: boolean; rationale: string } | null;
  command: AuthoredCommand | null; // present iff exploitable
  impact: string;
  patientRisk: string;
  patchRisk: string;
  source: string;
}

/** A single command the Droid Shield denied while the writer ran. */
export interface ShieldBlock {
  command: string;
  reason: string;
  ts: number;
}

/** The Factory Droid writer agent — streams its reasoning + the patch diff. */
export interface WriterAgent {
  state: AgentState;
  model: string;
  usedFallback: boolean;
  transcript: string; // text channel
  thinking: string; // thinking channel
  diff: string;
  diffEmpty: boolean;
  shieldBlocks: ShieldBlock[];
  credits: { factoryCredits?: number; inputTokens: number; outputTokens: number; thinkingTokens: number } | null;
  durationMs: number | null;
}

/** The read-only reviewer agent — audits the diff, emits a typed verdict. */
export interface ReviewAgent {
  state: AgentState;
  model: string;
  transcript: string;
  verdict: PatchReview | null;
  structured: boolean;
}

/** The exploit timeline. N author conversations stream in parallel during
 *  `curating`; once they all finish (`ready`) the user picks ONE exploitable
 *  finding + a route and runs it (`breaching` → `breached`); then the Factory
 *  remediation (patch → review → human gate → verify) extends the same line. */
export type ExploitStage =
  | 'idle'
  | 'curating' // all N conversations streaming in parallel
  | 'ready' // every conversation done; user picks an exploit + route
  | 'breaching' // running the chosen route (deliver / flash)
  | 'breached' // the chosen route landed
  | 'patching'
  | 'reviewing'
  | 'awaiting_approval'
  | 'applying'
  | 'verifying'
  | 'verified'
  | 'patch_failed'
  | 'patch_rejected';

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

// ---- offline fallback for the patch / review cell (same story, replayed) ----
// A genuine guard diff (already stripped of git headers, like the runner emits)
// that adds a @require_token decorator above POST /device/command.
const SIM_PATCH_DIFF = `--- a/app.py
+++ b/app.py
@@ -148,6 +148,23 @@ reset_healthy()
+import os
+from functools import wraps
+
+
+def require_token(fn):
+    """CWE-306: require a bearer token on this state-changing route."""
+    @wraps(fn)
+    def _guard(*args, **kwargs):
+        expected = os.environ.get("DEVICE_SERVICE_TOKEN")
+        if not expected:
+            return jsonify({"error": "server token not configured"}), 403
+        sent = (request.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
+        if not sent:
+            return jsonify({"error": "missing bearer token"}), 401
+        if sent != expected:
+            return jsonify({"error": "invalid bearer token"}), 403
+        return fn(*args, **kwargs)
+    return _guard
+
+
+@require_token
 @app.post("/device/command")
 def device_command():
     body = request.get_json(silent=True) or {}
`;

const SIM_PATCH_THINKING =
  'POST /device/command has no auth guard (CWE-306). ' +
  'I will add a @require_token decorator that reads DEVICE_SERVICE_TOKEN and fails closed when it is unset.\n';
const SIM_PATCH_TEXT =
  'Adding a require_token decorator above the route: 401 on a missing bearer token, 403 when it is wrong or ' +
  'no server token is configured, and mirroring reported_state to true_state so the caller can no longer desync ' +
  'the reported view. Editing only app.py, keeping the diff minimal.\n';

const SIM_REVIEW_TEXT =
  'Checking the decorator is stacked directly above @app.post… reads DEVICE_SERVICE_TOKEN, no hard-coded secret… ' +
  'fails closed when unset… reported_* now mirrors true_*… only app.py touched. Minimal and correct.\n';

const SIM_REVIEW: PatchReview = {
  verdict: 'approve', confidence: 0.88,
  closesCwe306: true, requiresAuthNow: true, ignoresUntrustedOverrides: true, onlyAppPyTouched: true,
  summary: 'Adds a bearer-token decorator above the route and mirrors reported→true. Minimal, closes CWE-306.',
  issues: [{ severity: 'low', file: 'app.py', line: 171, note: 'Consider a constant-time token compare.' }],
};

const SIM_VERIFY = (): VerifyResult => ({
  statusCode: 401, passed: true,
  detail: 'Replayed the same unauthenticated POST /device/command — now 401 Unauthorized. Fan stayed on; reported mirrors true.',
  true: { hr: 72, spo2: 98, fanOn: true, alarmActive: false },
  ranAgainst: 'device-service/app.py',
});

export interface Pipeline {
  mode: Mode;
  phase: Phase;
  hardware: Hardware;
  target: Target | null;
  agents: ScanAgent[];
  scanSource: 'device' | 'repo';
  activeRepo: { owner: string; name: string } | null;
  scanError: string | null;
  findings: ScanFinding[];
  ranking: RankItem[];
  scanStartedAt: number | null;
  authorAgents: AuthorAgent[];
  exploitStage: ExploitStage;
  /** The exploitable finding the user picked to run, and the route it runs by. */
  chosenFindingId: number | null;
  chosenRoute: ExploitRoute | null;
  /** The DeepSeek finding node the Factory patch nodes hang off (parentFindingId). */
  patchParentFindingId: number | null;
  serverBreach: DeliverResult | null;
  fanBreach: FlashResult | null;
  patchAgent: WriterAgent | null;
  reviewAgent: ReviewAgent | null;
  approved: boolean;
  verifyResult: VerifyResult | null;
  startScan: (repo?: { owner: string; name: string }) => void;
  startExploit: () => void;
  chooseFinding: (findingId: number) => void;
  chooseRoute: (route: ExploitRoute) => void;
  runExploit: () => void;
  startPatch: () => void;
  approve: () => void;
  reject: () => void;
  reset: () => void;
}

export function usePipeline(): Pipeline {
  const [mode, setMode] = useState<Mode>('connecting');
  const [phase, setPhase] = useState<Phase>('connect');
  const [hardware, setHardware] = useState<Hardware>(DISCONNECTED);
  const [target, setTarget] = useState<Target | null>(null);
  const [agents, setAgents] = useState<ScanAgent[]>(freshAgents);
  const [scanSource, setScanSource] = useState<'device' | 'repo'>('device');
  const [activeRepo, setActiveRepo] = useState<{ owner: string; name: string } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [findings, setFindings] = useState<ScanFinding[]>([]);
  const [ranking, setRanking] = useState<RankItem[]>([]);
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [authorAgents, setAuthorAgents] = useState<AuthorAgent[]>([]);
  const [exploitStage, setExploitStage] = useState<ExploitStage>('idle');
  const [chosenFindingId, setChosenFindingId] = useState<number | null>(null);
  const [chosenRoute, setChosenRoute] = useState<ExploitRoute | null>(null);
  const [patchParentFindingId, setPatchParentFindingId] = useState<number | null>(null);
  const [serverBreach, setServerBreach] = useState<DeliverResult | null>(null);
  const [fanBreach, setFanBreach] = useState<FlashResult | null>(null);
  const [patchAgent, setPatchAgent] = useState<WriterAgent | null>(null);
  const [reviewAgent, setReviewAgent] = useState<ReviewAgent | null>(null);
  const [approved, setApproved] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  const authoredRef = useRef<Record<number, AuthoredCommand>>({});
  const chosenFindingRef = useRef<number | null>(null);
  const chosenRouteRef = useRef<ExploitRoute | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const closeStream = useRef<(() => void) | null>(null);
  const patchStreamClose = useRef<(() => void) | null>(null);
  const patchSimRef = useRef(false);
  const modeRef = useRef<Mode>('connecting');
  modeRef.current = mode;

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    closeStream.current?.();
    closeStream.current = null;
    patchStreamClose.current?.();
    patchStreamClose.current = null;
  }, []);

  const patchScanAgent = useCallback((id: string, partial: Partial<ScanAgent>) => {
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
      timers.current.push(setTimeout(() => patchScanAgent(spec.id, { state: 'running', startedAt: Date.now() }), acc));
      acc += dur;
      timers.current.push(
        setTimeout(() => {
          patchScanAgent(spec.id, { state: 'done', durationMs: dur, findingCount: mine.length });
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
  }, [patchScanAgent]);

  const runScanLive = useCallback(() => {
    closeStream.current = api.streamScan(
      (e) => {
        if (e.type === 'agent_started') patchScanAgent(e.agentId, { state: 'running', startedAt: Date.now() });
        else if (e.type === 'agent_finished') {
          patchScanAgent(e.agentId, { state: 'done', durationMs: e.durationMs, findingCount: e.findingCount });
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
  }, [patchScanAgent, runScanSim]);

  // ---- repo scan: real clone + scan of an arbitrary public GitHub repo ----
  // Reuses the exact scan event shape, so ScanStrip / FindingsList / CodeViewer
  // are unchanged. No sim fallback: there is no fixture for an arbitrary repo.
  const runRepoScanLive = useCallback((repo: { owner: string; name: string }) => {
    const label = `${repo.owner}/${repo.name}`;
    // Seed one visible card so the fleet strip isn't empty during the clone.
    setAgents([
      { id: `semgrep/${repo.name}`, tool: 'semgrep', target: label, language: 'multi-language', state: 'idle', startedAt: null, durationMs: null, findingCount: 0 },
    ]);
    const upsert = (id: string, tool: 'semgrep' | 'bandit', language: string, partial: Partial<ScanAgent>) =>
      setAgents((prev) =>
        prev.some((a) => a.id === id)
          ? prev.map((a) => (a.id === id ? { ...a, ...partial } : a))
          : [...prev, { id, tool, target: label, language, state: 'idle', startedAt: null, durationMs: null, findingCount: 0, ...partial }],
      );
    const fail = (message: string) => {
      setScanError(message);
      setAgents([]);
      setScanSource('device');
      setActiveRepo(null);
      setPhase(hardware.connected ? 'ready' : 'connect');
      closeStream.current?.();
      closeStream.current = null;
    };
    closeStream.current = api.streamRepoScan(
      label,
      (e) => {
        if (e.type === 'agent_started') {
          if (e.tool === 'git') return; // the clone step is not a fleet card
          upsert(e.agentId, e.tool as 'semgrep' | 'bandit', e.language, { state: 'running', startedAt: Date.now() });
        } else if (e.type === 'agent_finished') {
          if (e.tool === 'git') return;
          upsert(e.agentId, e.tool as 'semgrep' | 'bandit', e.language, { state: 'done', durationMs: e.durationMs, findingCount: e.findingCount });
          setFindings((prev) => [...prev, ...e.findings]);
        } else if (e.type === 'ranking') {
          setFindings(e.findings);
          setRanking(e.ranking);
        } else if (e.type === 'scan_done') {
          setPhase('review');
          closeStream.current?.();
          closeStream.current = null;
        } else if (e.type === 'scan_error') {
          fail(e.message);
        }
      },
      () => fail('control service unreachable — could not scan the repository'),
    );
  }, [hardware.connected]);

  const startScan = useCallback((repo?: { owner: string; name: string }) => {
    clearTimers();
    setFindings([]);
    setRanking([]);
    setScanError(null);
    setScanStartedAt(Date.now());
    setPhase('scanning');
    if (repo) {
      setScanSource('repo');
      setActiveRepo(repo);
      setAgents([]);
      if (modeRef.current === 'live') runRepoScanLive(repo);
      else {
        setScanError('repo scanning needs the control service running');
        setScanSource('device');
        setActiveRepo(null);
        setPhase(hardware.connected ? 'ready' : 'connect');
      }
      return;
    }
    setScanSource('device');
    setActiveRepo(null);
    setAgents(freshAgents());
    if (modeRef.current === 'live') runScanLive();
    else runScanSim();
  }, [clearTimers, runScanLive, runScanSim, runRepoScanLive, hardware.connected]);

  // ---- exploit: N parallel DeepSeek conversations (one per finding) ----
  // Offline fallback: replay the scripted conversations from fixtures, all
  // overlapping, each paced over ~10-20s with its own turns, verdict + payload.
  const curateAllSim = useCallback(
    (onAllDone: () => void) => {
      const ids = new Set(findings.map((f) => f.id));
      const scripts = SIM_EXPLOIT_SCRIPTS.filter((s) => ids.has(s.findingId));
      if (scripts.length === 0) {
        onAllDone();
        return;
      }
      // Reset the seeded agents so a fallback after a live blip starts clean.
      setAuthorAgents((prev) =>
        prev.map((a) => ({ ...a, state: 'idle', startedAt: null, durationMs: null, transcript: '', verdict: null, command: null, impact: '', patientRisk: '', patchRisk: '', source: '' })),
      );

      const chunk = 9;
      let latestEnd = 0;
      scripts.forEach((s, si) => {
        const fid = s.findingId;
        const start = 180 + si * 160; // slight stagger — the fan of conversations overlaps
        // Flatten the turns into paced emissions: a turn marker, then the body in chunks.
        const emissions: string[] = [];
        s.turns.forEach((turn, ti) => {
          emissions.push(`\n\n— DeepSeek turn ${ti + 1} —\n`);
          for (let pos = 0; pos < turn.length; pos += chunk) emissions.push(turn.slice(pos, pos + chunk));
        });
        const stepMs = Math.max(28, Math.round(s.durationMs / Math.max(1, emissions.length)));
        timers.current.push(setTimeout(() => patchAuthor(fid, { state: 'running', startedAt: Date.now(), model: s.model }), start));
        emissions.forEach((slice, i) => {
          timers.current.push(setTimeout(() => appendTranscript(fid, slice), start + 120 + i * stepMs));
        });
        const end = start + 120 + emissions.length * stepMs + 120;
        latestEnd = Math.max(latestEnd, end);
        timers.current.push(
          setTimeout(() => {
            patchAuthor(fid, { verdict: { exploitable: s.exploitable, rationale: s.rationale } });
            if (s.exploitable && s.command) {
              authoredRef.current[fid] = s.command;
              patchAuthor(fid, { command: s.command, impact: s.impact ?? '', patientRisk: s.patientRisk ?? '', patchRisk: s.patchRisk ?? '' });
            }
            patchAuthor(fid, { state: 'done', durationMs: end - start, source: 'pre_cached_fallback', model: s.model });
          }, end),
        );
      });
      timers.current.push(setTimeout(onAllDone, latestEnd + 300));
    },
    [appendTranscript, findings, patchAuthor],
  );

  // Live: open ONE multiplexed stream for ALL findings at once and route each
  // frame to its agent by findingId. Falls back to the scripted sim on error.
  const curateAll = useCallback(
    (onAllDone: () => void) => {
      if (modeRef.current !== 'live') {
        curateAllSim(onAllDone);
        return;
      }
      closeStream.current = api.streamExploit(
        (e) => {
          switch (e.type) {
            case 'agent_spawned':
              patchAuthor(e.findingId, { state: 'running', startedAt: Date.now(), model: e.model, file: e.file, target: e.target });
              break;
            case 'turn':
            case 'delta':
              appendTranscript(e.findingId, e.text);
              break;
            case 'verdict':
              patchAuthor(e.findingId, { verdict: { exploitable: e.exploitable, rationale: e.rationale } });
              break;
            case 'payload':
              authoredRef.current[e.findingId] = e.command;
              patchAuthor(e.findingId, { command: e.command, impact: e.impact, patientRisk: e.patientRisk, patchRisk: e.patchRisk });
              break;
            case 'agent_done':
              patchAuthor(e.findingId, { state: 'done', durationMs: e.durationMs, source: e.source });
              break;
            case 'all_done':
              closeStream.current?.();
              closeStream.current = null;
              onAllDone();
              break;
          }
        },
        () => curateAllSim(onAllDone),
      );
    },
    [appendTranscript, curateAllSim, patchAuthor],
  );

  // ---- pick an exploitable finding + a route, then run the chosen breach ----
  const chooseFinding = useCallback(
    (findingId: number) => {
      chosenFindingRef.current = findingId;
      setChosenFindingId(findingId);
      // Default the route from the finding's surface; the user can still override.
      const a = authorAgents.find((x) => x.findingId === findingId);
      const route: ExploitRoute = a?.target === 'firmware' ? 'fan' : 'server';
      chosenRouteRef.current = route;
      setChosenRoute(route);
    },
    [authorAgents],
  );

  const chooseRoute = useCallback((route: ExploitRoute) => {
    chosenRouteRef.current = route;
    setChosenRoute(route);
  }, []);

  const runExploit = useCallback(() => {
    const fid = chosenFindingRef.current;
    if (fid == null) return;
    const route = chosenRouteRef.current ?? 'server';
    setExploitStage('breaching');
    if (route === 'fan') {
      const done = (res: FlashResult) => {
        setFanBreach(res);
        setExploitStage('breached');
      };
      if (modeRef.current === 'live') api.flash().then(done).catch(() => done({ ...SIM_FLASH(), ok: false, error: 'flash failed' }));
      else timers.current.push(setTimeout(() => done(SIM_FLASH()), 4200));
    } else {
      const cmd = authoredRef.current[fid] ?? { action: 'stop_fan', reportedOverrides: { hr: 72, spo2: 98, alarm: false } };
      const done = (res: DeliverResult) => {
        setServerBreach(res);
        setExploitStage('breached');
      };
      if (modeRef.current === 'live') api.deliver(cmd).then(done).catch(() => done(SIM_DELIVER()));
      else timers.current.push(setTimeout(() => done(SIM_DELIVER()), 1200));
    }
  }, []);

  // ---- patch / review cell: Droid writes the fix, the reviewer audits it, the
  //      human gate controls deploy, VERIFY re-runs the exploit against the edit ----
  const runPatchSim = useCallback(() => {
    patchSimRef.current = true;
    const t = timers.current;
    // The Factory nodes hang off the finding the user chose to exploit.
    setPatchParentFindingId(chosenFindingRef.current);
    setExploitStage('patching');
    setPatchAgent({
      state: 'running', model: 'Factory Droid', usedFallback: true,
      transcript: '', thinking: '', diff: '', diffEmpty: false, shieldBlocks: [], credits: null, durationMs: null,
    });

    const chunk = 14, stepMs = 42, base = 300;
    let i = 0;
    for (let pos = 0; pos < SIM_PATCH_THINKING.length; pos += chunk) {
      const slice = SIM_PATCH_THINKING.slice(pos, pos + chunk);
      t.push(setTimeout(() => setPatchAgent((p) => (p ? { ...p, thinking: p.thinking + slice } : p)), base + i * stepMs));
      i += 1;
    }
    for (let pos = 0; pos < SIM_PATCH_TEXT.length; pos += chunk) {
      const slice = SIM_PATCH_TEXT.slice(pos, pos + chunk);
      t.push(setTimeout(() => setPatchAgent((p) => (p ? { ...p, transcript: p.transcript + slice } : p)), base + i * stepMs));
      i += 1;
    }
    const afterWriter = base + i * stepMs + 200;
    t.push(setTimeout(() => setPatchAgent((p) => (p ? { ...p, shieldBlocks: [...p.shieldBlocks, { command: 'git commit -am fix', reason: 'forbidden: git/push/commit/remote/… (deny-by-default scope)', ts: Date.now() }] } : p)), afterWriter));
    t.push(setTimeout(() => setPatchAgent((p) => (p ? { ...p, credits: { factoryCredits: 12.4, inputTokens: 8123, outputTokens: 612, thinkingTokens: 1840 } } : p)), afterWriter + 120));
    t.push(setTimeout(() => setPatchAgent((p) => (p ? { ...p, diff: SIM_PATCH_DIFF, diffEmpty: false, state: 'done', durationMs: afterWriter } : p)), afterWriter + 240));

    const reviewStart = afterWriter + 520;
    t.push(setTimeout(() => {
      setExploitStage('reviewing');
      setReviewAgent({ state: 'running', model: 'Factory Droid · read-only', transcript: '', verdict: null, structured: false });
    }, reviewStart));
    let j = 0;
    for (let pos = 0; pos < SIM_REVIEW_TEXT.length; pos += chunk) {
      const slice = SIM_REVIEW_TEXT.slice(pos, pos + chunk);
      t.push(setTimeout(() => setReviewAgent((p) => (p ? { ...p, transcript: p.transcript + slice } : p)), reviewStart + 150 + j * stepMs));
      j += 1;
    }
    const afterReview = reviewStart + 150 + j * stepMs + 200;
    t.push(setTimeout(() => setReviewAgent((p) => (p ? { ...p, verdict: SIM_REVIEW, structured: false, state: 'done' } : p)), afterReview));
    t.push(setTimeout(() => setExploitStage('awaiting_approval'), afterReview + 150));
  }, []);

  const startPatch = useCallback(() => {
    clearTimers();
    patchSimRef.current = false;
    setPatchAgent(null);
    setReviewAgent(null);
    setApproved(false);
    setVerifyResult(null);
    setExploitStage('patching');

    if (modeRef.current !== 'live') {
      runPatchSim();
      return;
    }

    patchStreamClose.current = api.streamPatch(
      (e) => {
        switch (e.type) {
          case 'writer_started':
            // The backend tags every patch frame with the DeepSeek finding node
            // the Factory nodes attach to (the exploitable server CWE-306).
            setPatchParentFindingId(e.parentFindingId ?? chosenFindingRef.current);
            setExploitStage('patching');
            setPatchAgent({
              state: 'running', model: e.model, usedFallback: e.usedFallback,
              transcript: '', thinking: '', diff: '', diffEmpty: false, shieldBlocks: [], credits: null, durationMs: null,
            });
            break;
          case 'writer_delta':
            setPatchAgent((p) => (p ? (e.channel === 'thinking' ? { ...p, thinking: p.thinking + e.text } : { ...p, transcript: p.transcript + e.text }) : p));
            break;
          case 'writer_tool':
            break; // tool calls surface through the transcript; no separate field
          case 'shield_blocked':
            setPatchAgent((p) => (p ? { ...p, shieldBlocks: [...p.shieldBlocks, { command: e.command, reason: e.reason, ts: e.ts }] } : p));
            break;
          case 'credits':
            setPatchAgent((p) => (p ? { ...p, credits: { factoryCredits: e.factoryCredits, inputTokens: e.inputTokens, outputTokens: e.outputTokens, thinkingTokens: e.thinkingTokens } } : p));
            break;
          case 'diff':
            setPatchAgent((p) => (p ? { ...p, diff: e.diff, diffEmpty: e.empty, state: 'done' } : p));
            break;
          case 'reviewer_started':
            setExploitStage('reviewing');
            setReviewAgent({ state: 'running', model: e.model, transcript: '', verdict: null, structured: false });
            break;
          case 'reviewer_delta':
            setReviewAgent((p) => (p ? { ...p, transcript: p.transcript + e.text } : p));
            break;
          case 'review_verdict':
            setReviewAgent((p) => (p ? { ...p, verdict: e.review, structured: e.structured, state: 'done' } : p));
            break;
          case 'awaiting_approval':
            setExploitStage('awaiting_approval');
            setReviewAgent((p) => (p ? { ...p, verdict: p.verdict ?? e.verdict } : p));
            break;
          case 'patch_applied':
            setExploitStage('verifying');
            break;
          case 'verify_result':
            setVerifyResult({ statusCode: e.statusCode, passed: e.passed, detail: e.detail, true: e.true, ranAgainst: e.ranAgainst });
            setExploitStage(e.passed ? 'verified' : 'patch_failed');
            break;
          case 'patch_rejected':
            setExploitStage('patch_rejected');
            break;
          case 'patch_done':
            patchStreamClose.current?.();
            patchStreamClose.current = null;
            break;
        }
      },
      () => runPatchSim(),
    );
  }, [clearTimers, runPatchSim]);

  const approve = useCallback(() => {
    setApproved(true);
    setExploitStage('applying');
    if (patchSimRef.current) {
      const t = timers.current;
      t.push(setTimeout(() => setExploitStage('verifying'), 700));
      t.push(setTimeout(() => {
        setVerifyResult(SIM_VERIFY());
        setExploitStage('verified');
      }, 1700));
      return;
    }
    // The real patch_applied → verify_result → patch_done tail arrives over the SSE stream.
    void api.approve({ approvedBy: 'judge' }).catch(() => undefined);
  }, []);

  const reject = useCallback(() => {
    setExploitStage('applying');
    if (patchSimRef.current) {
      timers.current.push(setTimeout(() => setExploitStage('patch_rejected'), 700));
      return;
    }
    void api.reject().catch(() => undefined);
  }, []);

  const startExploit = useCallback(() => {
    clearTimers();
    authoredRef.current = {};
    patchSimRef.current = false;
    chosenFindingRef.current = null;
    chosenRouteRef.current = null;
    setChosenFindingId(null);
    setChosenRoute(null);
    setPatchParentFindingId(null);
    setServerBreach(null);
    setFanBreach(null);
    setPatchAgent(null);
    setReviewAgent(null);
    setApproved(false);
    setVerifyResult(null);
    // ONE author agent per scanner finding — all stream in parallel.
    setAuthorAgents(buildAuthors(findings));
    setPhase('exploit');
    setExploitStage('curating');
    curateAll(() => setExploitStage('ready'));
  }, [clearTimers, curateAll, findings]);

  // When every conversation is done, default the pick to the top exploitable
  // finding (ranked order) + its natural route, so the run control is live.
  useEffect(() => {
    if (exploitStage !== 'ready' || chosenFindingRef.current != null) return;
    const pick = authorAgents.find((a) => a.verdict?.exploitable) ?? authorAgents.find((a) => a.command);
    if (!pick) return;
    chosenFindingRef.current = pick.findingId;
    setChosenFindingId(pick.findingId);
    const route: ExploitRoute = pick.target === 'firmware' ? 'fan' : 'server';
    chosenRouteRef.current = route;
    setChosenRoute(route);
  }, [exploitStage, authorAgents]);

  const reset = useCallback(() => {
    clearTimers();
    patchStreamClose.current?.();
    patchStreamClose.current = null;
    patchSimRef.current = false;
    authoredRef.current = {};
    chosenFindingRef.current = null;
    chosenRouteRef.current = null;
    setAgents(freshAgents());
    setScanSource('device');
    setActiveRepo(null);
    setScanError(null);
    setFindings([]);
    setRanking([]);
    setScanStartedAt(null);
    setAuthorAgents([]);
    setExploitStage('idle');
    setChosenFindingId(null);
    setChosenRoute(null);
    setPatchParentFindingId(null);
    setServerBreach(null);
    setFanBreach(null);
    setPatchAgent(null);
    setReviewAgent(null);
    setApproved(false);
    setVerifyResult(null);
    setPhase(hardware.connected ? 'ready' : 'connect');
  }, [clearTimers, hardware.connected]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return useMemo(
    () => ({ mode, phase, hardware, target, agents, scanSource, activeRepo, scanError, findings, ranking, scanStartedAt, authorAgents, exploitStage, chosenFindingId, chosenRoute, patchParentFindingId, serverBreach, fanBreach, patchAgent, reviewAgent, approved, verifyResult, startScan, startExploit, chooseFinding, chooseRoute, runExploit, startPatch, approve, reject, reset }),
    [mode, phase, hardware, target, agents, scanSource, activeRepo, scanError, findings, ranking, scanStartedAt, authorAgents, exploitStage, chosenFindingId, chosenRoute, patchParentFindingId, serverBreach, fanBreach, patchAgent, reviewAgent, approved, verifyResult, startScan, startExploit, chooseFinding, chooseRoute, runExploit, startPatch, approve, reject, reset],
  );
}

// ---- helpers (pure) ----
// ONE author agent per scanner finding (keyed by findingId). The DeepSeek
// conversation decides exploitable-or-not; the fields fill in as the stream
// (live or simulated) arrives.
function buildAuthors(findings: ScanFinding[]): AuthorAgent[] {
  return findings.map((f) => ({
    id: `author/${f.id}`,
    findingId: f.id,
    target: f.target ?? 'device',
    file: f.file ?? '',
    model: 'DeepSeek-V4.1-Flash',
    state: 'idle',
    startedAt: null,
    durationMs: null,
    transcript: '',
    verdict: null,
    command: null,
    impact: '',
    patientRisk: '',
    patchRisk: '',
    source: '',
  }));
}
