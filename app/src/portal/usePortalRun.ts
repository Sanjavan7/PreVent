// Portal director — the scripted multi-agent run the mission-control UI renders.
//
// Produces a PipelineModel that evolves over ~20s, telling the real pipeline's
// story beat by beat: four scanner agents spawn across the server + firmware,
// Claude ranks the findings (with one self-correction), DeepSeek-via-Bitdeer
// fans out an author agent per exploitable finding, the top-ranked exploit
// fires (device lies), the blue team patches behind a human gate, and VERIFY
// proves the re-run is blocked. The data mirrors the real backend: five
// findings across four agents (two genuine CWE-306, three Bandit decoys).
//
// This is the demo's source of truth. A live SpacetimeDB adapter can later
// produce the same PipelineModel shape from real rows; the UI won't change.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventLogRow, Finding } from '@prevent/contracts';

import type {
  FleetAgent,
  PhaseId,
  PhaseNode,
  PipelineModel,
  RankedFinding,
  TruthState,
} from './types';

// ---------------------------------------------------------------- fixtures ---

const GROUND = {
  id: 'CVE-2019-6538',
  cwe: 'CWE-306',
  cvss: 9.3,
  title: 'Unauthenticated control of a medical device command channel',
};

// The four scanner agents — {semgrep, bandit} × {server, firmware}.
const SCAN_FLEET: FleetAgent[] = [
  { id: 'semgrep/device-service', phase: 'scan', kind: 'scanner', label: 'semgrep · server', engine: 'semgrep', target: 'device-service', state: 'idle' },
  { id: 'bandit/device-service', phase: 'scan', kind: 'scanner', label: 'bandit · server', engine: 'bandit', target: 'device-service', state: 'idle' },
  { id: 'semgrep/firmware', phase: 'scan', kind: 'scanner', label: 'semgrep · firmware', engine: 'semgrep', target: 'firmware', state: 'idle' },
  { id: 'bandit/firmware', phase: 'scan', kind: 'scanner', label: 'bandit · firmware', engine: 'bandit', target: 'firmware', state: 'idle' },
];

const SCAN_METRIC: Record<string, string> = {
  'semgrep/device-service': '1 finding · CWE-306',
  'bandit/device-service': '3 findings · decoys',
  'semgrep/firmware': '1 finding · CWE-306',
  'bandit/firmware': 'no jurisdiction (C)',
};

// The five findings the four agents return (mirrors run_scan_agents()).
const FINDINGS: Finding[] = [
  { id: 1, scanner: 'semgrep', cveRef: 'CVE-2019-6538', file: 'device-service/app.py', line: 333, severity: 'ERROR', claudeVerdict: 'Missing auth on POST /device/command (CWE-306).', isTheRealOne: true, createdAt: 0 },
  { id: 2, scanner: 'bandit', cveRef: '', file: 'device-service/diagnostics.py', line: 20, severity: 'LOW', claudeVerdict: 'Hardcoded diagnostic token (B105) — not exploitable.', isTheRealOne: false, createdAt: 0 },
  { id: 3, scanner: 'bandit', cveRef: '', file: 'device-service/diagnostics.py', line: 26, severity: 'HIGH', claudeVerdict: 'Weak MD5 (B324) — scary severity, but no live reproduce.', isTheRealOne: false, createdAt: 0 },
  { id: 4, scanner: 'bandit', cveRef: '', file: 'device-service/diagnostics.py', line: 34, severity: 'LOW', claudeVerdict: 'try/except/pass (B110) — noise.', isTheRealOne: false, createdAt: 0 },
  { id: 5, scanner: 'semgrep', cveRef: 'CVE-2019-6538', file: 'firmware/uno_actuator.ino', line: 248, severity: 'ERROR', claudeVerdict: 'Unauthenticated serial STATE control channel (CWE-306).', isTheRealOne: true, createdAt: 0 },
];

const findingById = (id: number) => FINDINGS.find((f) => f.id === id)!;

// Claude's ranking by CVSS/criticality. The two real CWE-306 findings top it;
// the Bandit HIGH (md5) is the tempting-but-wrong pick that gets demoted.
const RANKING: RankedFinding[] = [
  { rank: 1, finding: findingById(1), cvss: 9.3, real: true, verdict: 'Top CVSS. Unauthenticated command channel — the server analog of the CVE.' },
  { rank: 2, finding: findingById(5), cvss: 8.8, real: true, verdict: 'Same flaw on the device: forge a STATE frame, no auth on the serial link.' },
  { rank: 3, finding: findingById(3), cvss: 5.9, real: false, verdict: 'Demoted: HIGH severity, but the live probe did not reproduce an exploit.' },
  { rank: 4, finding: findingById(2), cvss: 2.5, real: false, verdict: 'Low. Hardcoded string, no path to control.' },
  { rank: 5, finding: findingById(4), cvss: 2.0, real: false, verdict: 'Low. Silent except — no exploit surface.' },
];

// One author agent per exploitable finding (the fan-out).
const AUTHOR_FLEET: FleetAgent[] = [
  { id: 'author/1', phase: 'generate', kind: 'author', label: 'author · server', engine: 'DeepSeek-V4.1 · Bitdeer', target: 'device-service', state: 'idle', metric: 'stop_fan + spoof vitals' },
  { id: 'author/2', phase: 'generate', kind: 'author', label: 'author · firmware', engine: 'DeepSeek-V4.1 · Bitdeer', target: 'firmware', state: 'idle', metric: 'forge STATE,fan=0' },
];

const DEVICE_HEALTHY = { trueHr: 72, trueSpo2: 98, reportedHr: 72, reportedSpo2: 98, fanOn: true, alarmActive: false, compromised: false };
const DEVICE_LYING = { trueHr: 38, trueSpo2: 61, reportedHr: 72, reportedSpo2: 98, fanOn: false, alarmActive: false, compromised: true };

const PHASE_META: Record<PhaseId, { label: string; caption: string }> = {
  ground: { label: 'Ground', caption: 'cite the real CVE' },
  scan: { label: 'Scan', caption: 'four agents read the code' },
  rank: { label: 'Rank', caption: 'Claude orders by severity' },
  generate: { label: 'Generate', caption: 'DeepSeek authors exploits' },
  deliver: { label: 'Deliver', caption: 'fire the top-ranked attack' },
  blueteam: { label: 'Blue team', caption: 'Factory patches the flaw' },
  verify: { label: 'Verify', caption: 're-run the exact attack' },
};

// --------------------------------------------------------------- builders ---

function idlePhases(): PhaseNode[] {
  return (Object.keys(PHASE_META) as PhaseId[]).map((id) => ({
    id,
    label: PHASE_META[id].label,
    caption: PHASE_META[id].caption,
    state: 'idle' as const,
  }));
}

function idleTruth(): TruthState {
  return { ...DEVICE_HEALTHY, lying: false };
}

function idleModel(): PipelineModel {
  return {
    phases: idlePhases(),
    scanFleet: SCAN_FLEET.map((a) => ({ ...a })),
    authorFleet: AUTHOR_FLEET.map((a) => ({ ...a })),
    ranking: [],
    telemetry: [],
    truth: idleTruth(),
    activePhase: null,
    ground: null,
    exploitRuns: [],
    patch: null,
    resolved: false,
  };
}

// ------------------------------------------------------------------- hook ---

export interface PortalRun {
  model: PipelineModel;
  running: boolean;
  awaitingApproval: boolean;
  start: () => void;
  reset: () => void;
  approve: () => void;
}

export function usePortalRun(): PortalRun {
  const [model, setModel] = useState<PipelineModel>(idleModel);
  const [running, setRunning] = useState(false);
  const [awaitingApproval, setAwaitingApproval] = useState(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const approveRef = useRef<(() => void) | null>(null);
  const seq = useRef(0);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    approveRef.current = null;
  }, []);

  const at = useCallback((delay: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, delay));
  }, []);

  // Mutation helpers (functional setState — no stale closures).
  const patchPhase = useCallback((id: PhaseId, partial: Partial<PhaseNode>) => {
    setModel((m) => ({
      ...m,
      activePhase: partial.state === 'active' || partial.state === 'alert' || partial.state === 'waiting' ? id : m.activePhase,
      phases: m.phases.map((p) => (p.id === id ? { ...p, ...partial } : p)),
    }));
  }, []);

  const patchFleet = useCallback((which: 'scanFleet' | 'authorFleet', id: string, partial: Partial<FleetAgent>) => {
    setModel((m) => ({ ...m, [which]: m[which].map((a) => (a.id === id ? { ...a, ...partial } : a)) }));
  }, []);

  const log = useCallback((actor: string, text: string) => {
    const row: EventLogRow = { id: (seq.current += 1), ts: Date.now(), actor, text };
    setModel((m) => ({ ...m, telemetry: [row, ...m.telemetry] }));
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    seq.current = 0;
    setRunning(false);
    setAwaitingApproval(false);
    setModel(idleModel());
  }, [clearTimers]);

  const approve = useCallback(() => {
    approveRef.current?.();
  }, []);

  const start = useCallback(() => {
    clearTimers();
    seq.current = 0;
    setRunning(true);
    setAwaitingApproval(false);
    setModel(idleModel());

    // t0 — GROUND: cite the CVE, then the scanner fleet spawns.
    at(150, () => {
      setModel((m) => ({ ...m, ground: { id: GROUND.id, cwe: GROUND.cwe, cvss: GROUND.cvss, title: GROUND.title } }));
      patchPhase('ground', { state: 'done', agentName: 'orchestrator', detail: `Grounded in ${GROUND.id} — ${GROUND.cwe}, CVSS ${GROUND.cvss}` });
      log('ground', `Grounded in ${GROUND.id} (${GROUND.cwe}, CVSS ${GROUND.cvss}).`);
      patchPhase('scan', { state: 'active', agentName: 'scanner fleet', spawnCount: 4, confidence: 0.2, detail: 'Spawning four scanner agents across server + firmware.' });
    });

    // Scanner agents spawn one by one, then report.
    SCAN_FLEET.forEach((a, i) => {
      at(450 + i * 260, () => {
        patchFleet('scanFleet', a.id, { state: 'active' });
        log(a.engine, `${a.label}: scanning…`);
      });
      at(1600 + i * 180, () => {
        patchFleet('scanFleet', a.id, { state: 'done', metric: SCAN_METRIC[a.id] });
      });
    });
    at(1300, () => patchPhase('scan', { confidence: 0.55, detail: 'semgrep flags a POST with no auth guard on the server.' }));

    // ~2.6s — scan done; all five findings are in.
    at(2600, () => {
      patchPhase('scan', { state: 'done', confidence: 0.78, detail: '5 findings across 4 agents — 2 look exploitable.' });
      log('scan', 'Scan complete: 5 findings (2 CWE-306, 3 decoys).');
      patchPhase('rank', { state: 'active', agentName: 'Claude', confidence: 0.4, detail: 'Ranking by CVSS. The Bandit MD5 (HIGH) looks scariest — starting there.' });
    });

    // ~3.3s — the self-correction beat: Claude demotes the tempting Bandit HIGH.
    at(3300, () => {
      log('rank', 'Claude: the HIGH-severity MD5 is tempting, but the live probe does not reproduce it.');
      patchPhase('rank', { confidence: 0.62, detail: 'Self-correction: demoting the MD5 decoy; the unauth command channel is the real one.' });
    });

    // ~4.1s — ranking lands; generate spawns an author per exploitable finding.
    at(4100, () => {
      setModel((m) => ({ ...m, ranking: RANKING.map((r) => ({ ...r })) }));
      patchPhase('rank', { state: 'done', confidence: 0.82, detail: 'Ranked. #1 server CWE-306 (9.3), #2 firmware CWE-306 (8.8).' });
      log('rank', 'Ranked 5 findings. Top: unauthenticated command channel, CVSS 9.3.');
      patchPhase('generate', { state: 'active', agentName: 'DeepSeek · Bitdeer', spawnCount: 2, confidence: 0.4, detail: 'Fanning out an exploit-author agent per exploitable finding.' });
    });

    AUTHOR_FLEET.forEach((a, i) => {
      at(4500 + i * 300, () => {
        patchFleet('authorFleet', a.id, { state: 'active', detail: 'authoring…' });
        log('bitdeer', `${a.label}: DeepSeek-V4.1 authoring a validated command.`);
      });
      at(5600 + i * 300, () => {
        patchFleet('authorFleet', a.id, { state: 'done' });
      });
    });

    // ~6.4s — generate done; deliver fires the #1 exploit. Device lies.
    at(6400, () => {
      patchPhase('generate', { state: 'done', confidence: 0.85, detail: '2 validated payloads authored.' });
      patchPhase('deliver', { state: 'active', agentName: 'orchestrator', confidence: 0.6, detail: 'Firing the #1 payload: unauthenticated POST /device/command {stop_fan}.' });
    });
    at(7100, () => {
      setModel((m) => ({
        ...m,
        truth: { ...DEVICE_LYING, lying: true },
        exploitRuns: [{ id: (seq.current += 1), findingId: 1, modelId: 'bitdeer/deepseek-v4.1', payloadRef: 'POST /device/command {"action":"stop_fan"}', deliveredAt: Date.now(), deviceImpact: '200 OK — fan stopped; device still reports 72/98, alarm silent.', success: true }],
      }));
      patchPhase('deliver', { state: 'alert', confidence: 0.9, detail: '200 OK — fan stopped. True 38/61, reported 72/98. The device is lying.' });
      log('deliver', 'Exploit delivered: 200 OK — fan stopped, vitals falsified, alarm silent.');
    });

    // ~8.3s — blue team patches; self-correction; then holds at the human gate.
    at(8300, () => {
      patchPhase('blueteam', { state: 'active', agentName: 'Factory', confidence: 0.55, detail: 'Factory: require a bearer token; ignore untrusted reportedOverrides.' });
      setModel((m) => ({ ...m, patch: { id: (seq.current += 1), findingId: 1, diffRef: 'device-service/app.py (+auth, −trust overrides)', droidSession: 'factory-7f3a1c', proposedAt: Date.now(), humanApproved: false, appliedAt: null } }));
    });
    at(9100, () => {
      log('blueteam', 'Factory: rejected my first patch — it broke the emergency resume path. Revising.');
      patchPhase('blueteam', { confidence: 0.72, detail: 'Self-correction: first diff blocked recovery; gating only unsigned writes.' });
    });
    at(9900, () => {
      patchPhase('blueteam', { state: 'waiting', confidence: 0.82, detail: 'Tests green in sandbox. Waiting for operator sign-off.' });
      log('blueteam', 'Patch ready. Awaiting human approval to deploy.');
      setAwaitingApproval(true);

      let fired = false;
      const proceed = () => {
        if (fired) return;
        fired = true;
        approveRef.current = null;
        setAwaitingApproval(false);
        afterApprove();
      };
      approveRef.current = proceed;
      at(7000, proceed); // auto-advance if the operator never clicks
    });

    // Post-approval: deploy, VERIFY (401 payoff), restore, resolved.
    const afterApprove = () => {
      patchPhase('blueteam', { state: 'done', confidence: 0.85, detail: 'Patch approved and deployed to device-service.' });
      setModel((m) => ({ ...m, patch: m.patch ? { ...m.patch, humanApproved: true, appliedAt: Date.now() } : m.patch }));
      log('operator', 'Patch approved — deploying auth fix.');
      patchPhase('verify', { state: 'active', agentName: 'verifier', confidence: 0.6, detail: 'Replaying the exact same unauthenticated request against the patched endpoint.' });

      at(1500, () => {
        patchPhase('verify', { state: 'done', confidence: 0.95, detail: '401 Unauthorized — the re-run is blocked. True state intact. No lie.' });
        setModel((m) => ({
          ...m,
          truth: { ...DEVICE_HEALTHY, lying: false },
          resolved: true,
          exploitRuns: [
            { id: (seq.current += 1), findingId: 1, modelId: 'bitdeer/deepseek-v4.1', payloadRef: 'POST /device/command {"action":"stop_fan"}', deliveredAt: Date.now(), deviceImpact: '401 Unauthorized — token required; fan state unchanged.', success: false },
            ...m.exploitRuns,
          ],
        }));
        log('verify', 'Verify: 401 Unauthorized — the fix holds. Device recovered.');
        patchPhase('deliver', { state: 'done', detail: 'Neutralized — the replay no longer compromises the device.' });
        setRunning(false);
      });
    };
  }, [at, clearTimers, log, patchFleet, patchPhase]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return useMemo(
    () => ({ model, running, awaitingApproval, start, reset, approve }),
    [model, running, awaitingApproval, start, reset, approve],
  );
}
