// The portal orchestrator. Polls for the plugged-in device, streams the REAL
// scan, then runs the attack as TWO visible stages: DeepSeek curates the SERVER
// exploit (streaming its reasoning) → breach the server over real HTTP → then
// curates the FAN exploit → flash the malicious fan-off firmware to the real
// board. Falls back to an honest simulation (same story, streamed) if the
// control service isn't reachable.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type { AuthoredCommand, DeliverResult, FlashResult, Hardware, PatchReview, RankItem, ScanFinding, Target, VerifyResult } from './api';
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

/** The attack runs as two sequential, visible stages, then the remediation
 *  (patch → review → human gate → verify) extends the same exploit timeline. */
export type ExploitStage =
  | 'idle'
  | 'curating_server'
  | 'server_ready'
  | 'breaching_server'
  | 'server_breached'
  | 'curating_fan'
  | 'fan_ready'
  | 'flashing_fan'
  | 'fan_breached'
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
  patchAgent: WriterAgent | null;
  reviewAgent: ReviewAgent | null;
  approved: boolean;
  verifyResult: VerifyResult | null;
  startScan: () => void;
  startExploit: () => void;
  sendToServer: () => void;
  sendToFan: () => void;
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
  const [findings, setFindings] = useState<ScanFinding[]>([]);
  const [ranking, setRanking] = useState<RankItem[]>([]);
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [authorAgents, setAuthorAgents] = useState<AuthorAgent[]>([]);
  const [exploitStage, setExploitStage] = useState<ExploitStage>('idle');
  const [serverBreach, setServerBreach] = useState<DeliverResult | null>(null);
  const [fanBreach, setFanBreach] = useState<FlashResult | null>(null);
  const [patchAgent, setPatchAgent] = useState<WriterAgent | null>(null);
  const [reviewAgent, setReviewAgent] = useState<ReviewAgent | null>(null);
  const [approved, setApproved] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  const authoredRef = useRef<Record<number, AuthoredCommand>>({});
  const serverFindingRef = useRef<number | null>(null);
  const fanFindingRef = useRef<number | null>(null);
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

  // ---- patch / review cell: Droid writes the fix, the reviewer audits it, the
  //      human gate controls deploy, VERIFY re-runs the exploit against the edit ----
  const runPatchSim = useCallback(() => {
    patchSimRef.current = true;
    const t = timers.current;
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
    setServerBreach(null);
    setFanBreach(null);
    setPatchAgent(null);
    setReviewAgent(null);
    setApproved(false);
    setVerifyResult(null);
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
    patchStreamClose.current?.();
    patchStreamClose.current = null;
    patchSimRef.current = false;
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
    setPatchAgent(null);
    setReviewAgent(null);
    setApproved(false);
    setVerifyResult(null);
    setPhase(hardware.connected ? 'ready' : 'connect');
  }, [clearTimers, hardware.connected]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return useMemo(
    () => ({ mode, phase, hardware, target, agents, findings, ranking, scanStartedAt, authorAgents, exploitStage, serverBreach, fanBreach, patchAgent, reviewAgent, approved, verifyResult, startScan, startExploit, sendToServer, sendToFan, startPatch, approve, reject, reset }),
    [mode, phase, hardware, target, agents, findings, ranking, scanStartedAt, authorAgents, exploitStage, serverBreach, fanBreach, patchAgent, reviewAgent, approved, verifyResult, startScan, startExploit, sendToServer, sendToFan, startPatch, approve, reject, reset],
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
