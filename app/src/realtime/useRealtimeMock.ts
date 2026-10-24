// Mock implementation of the realtime hook (no network, deterministic fixtures).
// Used when VITE_REALTIME_BACKEND !== 'spacetimedb', or at build time before the
// shared Maincloud module exists. Keeps the panels functional on cold starts.
//
// SCRIPTED DEMO DIRECTOR: in mock mode the device fixture alone is dead air — the
// right-panel activity feed derives from `agents` (state !== 'idle'), so with all
// agents idle it renders nothing. `setMockExploited(true)` therefore plays a
// scripted ~18s timeline that drives device + agents + findings + eventLog +
// exploitRuns + patchAttempts step by step so the feed fills like a live run.
// `setMockExploited(false)` (or unmount) tears every timer down and resets.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEMO_PATCH_DIFF,
  DEVICE_EXPLOITED,
  DEVICE_HEALTHY,
  MOCK_AGENTS,
  MOCK_EVENT_LOG,
  MOCK_IR_EVENTS,
} from '@prevent/contracts';
import type {
  AgentStatus,
  DeviceStatus,
  EventLogRow,
  ExploitRun,
  Finding,
  PatchAttempt,
  Stage,
} from '@prevent/contracts';

import type { RealtimeState } from './useRealtime';

// ---------------------------------------------------------------------------
// Approve bridge. App.tsx wires the panels with individual props (not `rt`), so
// the ApprovalGate inside DashboardPanel cannot reach `rt.approve()` directly.
// This module-level holder lets the panel nudge the active mock run without
// App.tsx or the panel plumbing a prop through. A no-op when nothing is mounted
// (e.g. live mode).
let activeApprove: (() => void) | null = null;

/** Advance the scripted mock run past the human-approval gate, if one is waiting. */
export function requestMockApprove(): void {
  activeApprove?.();
}

// ---------------------------------------------------------------------------
// Fresh base (idle) collections. Rebuilt per run so no state bleeds across toggles.

const baseAgents = (): AgentStatus[] => MOCK_AGENTS.map((a) => ({ ...a }));

export function useRealtimeMock(): RealtimeState {
  const [mockExploited, setMockExploitedState] = useState(false);
  const [device, setDevice] = useState<DeviceStatus>(DEVICE_HEALTHY);
  const [agents, setAgents] = useState<AgentStatus[]>(baseAgents);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [eventLog, setEventLog] = useState<EventLogRow[]>(MOCK_EVENT_LOG);
  const [exploitRuns, setExploitRuns] = useState<ExploitRun[]>([]);
  const [patchAttempts, setPatchAttempts] = useState<PatchAttempt[]>([]);

  // Every pending setTimeout id for this run; cleared wholesale on reset/unmount.
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // The gate's continuation while the run holds at waiting_for_human (else null).
  const approveRef = useRef<(() => void) | null>(null);
  // Monotonic id counters for the additive collections.
  const seqRef = useRef(0);

  const nextId = useCallback(() => (seqRef.current += 1), []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    approveRef.current = null;
  }, []);

  const resetToBase = useCallback(() => {
    seqRef.current = 0;
    setDevice(DEVICE_HEALTHY);
    setAgents(baseAgents());
    setFindings([]);
    setEventLog(MOCK_EVENT_LOG);
    setExploitRuns([]);
    setPatchAttempts([]);
  }, []);

  // ---- director mutation helpers (functional setState, no stale closures) ----

  const schedule = useCallback((delay: number, fn: () => void) => {
    const id = setTimeout(fn, delay);
    timersRef.current.push(id);
  }, []);

  const patchAgent = useCallback(
    (stage: Stage, partial: Partial<AgentStatus>) => {
      setAgents((prev) =>
        prev.map((a) =>
          a.stage === stage ? { ...a, ...partial, updatedAt: Date.now() } : a,
        ),
      );
    },
    [],
  );

  // Append streamed reasoning text so the "streaming" UI actually animates.
  const streamAgent = useCallback(
    (stage: Stage, delta: string, partial: Partial<AgentStatus> = {}) => {
      setAgents((prev) =>
        prev.map((a) =>
          a.stage === stage
            ? {
                ...a,
                ...partial,
                reasoning: a.reasoning + delta,
                updatedAt: Date.now(),
              }
            : a,
        ),
      );
    },
    [],
  );

  const log = useCallback(
    (actor: string, text: string) => {
      setEventLog((prev) => [
        { id: nextId(), ts: Date.now(), actor, text },
        ...prev,
      ]);
    },
    [nextId],
  );

  const approve = useCallback(() => approveRef.current?.(), []);

  // Register the approve bridge while this hook instance is mounted.
  useEffect(() => {
    activeApprove = approve;
    return () => {
      if (activeApprove === approve) activeApprove = null;
    };
  }, [approve]);

  // ---- the scripted timeline -------------------------------------------------

  useEffect(() => {
    if (!mockExploited) {
      clearTimers();
      resetToBase();
      return;
    }

    // Fresh run: wipe any prior timers, then play the story from t0.
    clearTimers();
    seqRef.current = 0;

    // t0 — the exploit lands. Device lies; ground context is already in hand;
    // the scanner starts streaming.
    setDevice(DEVICE_EXPLOITED);
    setFindings([]);
    setExploitRuns([]);
    setPatchAttempts([]);
    setEventLog([
      {
        id: nextId(),
        ts: Date.now(),
        actor: 'orchestrator',
        text: 'Unauthenticated POST /device/command accepted — device compromised, alarm silenced.',
      },
    ]);
    setAgents(
      baseAgents().map((a) => {
        if (a.stage === 'ground')
          return {
            ...a,
            agentName: 'Claude · ground',
            state: 'done',
            confidence: 1,
            updatedAt: Date.now(),
          };
        if (a.stage === 'scan')
          return {
            ...a,
            agentName: 'Claude · scan',
            state: 'running',
            reasoning: 'Pulling the device-service source into context. ',
            confidence: 0.3,
            updatedAt: Date.now(),
          };
        return a;
      }),
    );

    // scan streams its reasoning, confidence climbing toward ~0.72.
    schedule(600, () =>
      streamAgent('scan', 'Running semgrep + bandit over the Flask command surface. ', {
        confidence: 0.46,
      }),
    );
    schedule(1200, () =>
      streamAgent('scan', 'bandit flags debug=True — low severity, a decoy, not the flaw. ', {
        confidence: 0.6,
      }),
    );
    schedule(1800, () =>
      streamAgent(
        'scan',
        'semgrep: POST /device/command has NO auth guard — CWE-306. That is the one.',
        { confidence: 0.72 },
      ),
    );

    // ~2.5s — scan done; the two findings land; generate starts the PoC.
    schedule(2500, () => {
      patchAgent('scan', { state: 'done', confidence: 0.72 });
      setFindings([
        {
          id: nextId(),
          scanner: 'bandit',
          cveRef: '',
          file: 'app.py',
          line: 12,
          severity: 'LOW',
          claudeVerdict: 'debug=True flagged, but not the exploitable issue',
          isTheRealOne: false,
          createdAt: Date.now(),
        },
        {
          id: nextId(),
          scanner: 'semgrep',
          cveRef: 'CVE-2019-6538',
          file: 'app.py',
          line: 42,
          severity: 'ERROR',
          claudeVerdict:
            'Missing authentication on POST /device/command (CWE-306) - the real exploitable flaw',
          isTheRealOne: true,
          createdAt: Date.now(),
        },
      ]);
      log(
        'scan',
        'semgrep: missing auth on POST /device/command — CWE-306 (CVE-2019-6538).',
      );
      patchAgent('generate', {
        agentName: 'DeepSeek-V3 · Bitdeer',
        state: 'running',
        reasoning: 'DeepSeek-V3 on Bitdeer drafting a proof-of-concept. ',
        confidence: 0.4,
      });
    });

    schedule(3200, () =>
      streamAgent(
        'generate',
        'Crafting an unsigned POST /device/command {action: stop_fan} with spoofed reportedOverrides. ',
        { confidence: 0.6 },
      ),
    );
    schedule(3900, () =>
      streamAgent(
        'generate',
        'PoC ready: it stops the fan while the device keeps reporting 72/98.',
        { confidence: 0.78 },
      ),
    );

    // ~4.5s — generate done; deliver fires the payload at the sandbox device.
    schedule(4500, () => {
      patchAgent('generate', { state: 'done', confidence: 0.8 });
      patchAgent('deliver', {
        agentName: 'Claude · deliver',
        state: 'running',
        reasoning: 'Firing the unsigned payload at the sandbox device endpoint. ',
        confidence: 0.5,
      });
    });

    // ~5.5s — deliver done; exploit run recorded (200 OK, device obeyed).
    schedule(5500, () => {
      patchAgent('deliver', {
        state: 'done',
        reasoning:
          'Firing the unsigned payload at the sandbox device endpoint. 200 OK — the fan actuator obeyed.',
        confidence: 0.85,
      });
      setExploitRuns((prev) => [
        {
          id: nextId(),
          findingId: 2,
          modelId: 'bitdeer/deepseek-v3',
          payloadRef: 'POST /device/command {"action":"stop_fan"}',
          deliveredAt: Date.now(),
          deviceImpact: '200 OK — fan actuator obeyed unsigned payload; vitals diverge',
          success: true,
        },
        ...prev,
      ]);
      log('deliver', 'Exploit delivered: 200 OK — fan actuator obeyed unsigned payload.');
    });

    // ~6.5s — Factory Droid starts the patch; the diff is proposed (unapproved).
    schedule(6500, () => {
      patchAgent('patch', {
        agentName: 'Factory Droid',
        state: 'running',
        reasoning:
          'Factory Droid: require X-Device-Token (constant-time compare), drop untrusted reportedOverrides. ',
        confidence: 0.6,
      });
      setPatchAttempts((prev) => [
        {
          id: nextId(),
          findingId: 2,
          diffRef: DEMO_PATCH_DIFF,
          droidSession: 'droid-7f3a1c',
          proposedAt: Date.now(),
          humanApproved: false,
          appliedAt: null,
        },
        ...prev,
      ]);
    });

    schedule(7200, () =>
      streamAgent('patch', 'Drafting the diff against device-service/app.py. ', {
        confidence: 0.7,
      }),
    );
    // ~7.9s — the self-correction beat + a guardrail refusal in the log.
    schedule(7900, () => {
      streamAgent(
        'patch',
        'Claude rejected its first fix — it broke the emergency override. Revising to gate only unsigned writes while preserving the resume path. ',
        { confidence: 0.76 },
      );
      log('guardrail', 'Sandbox refused the destructive call outside device-service/ scope.');
    });
    schedule(8500, () =>
      streamAgent('patch', 'Tests green in sandbox. Requesting human sign-off.', {
        confidence: 0.82,
      }),
    );

    // ~9s — HOLD at the human-approval gate (BLUE). Advance on approve() OR auto
    // after ~6s. Whichever fires first wins; the other is a no-op.
    schedule(9000, () => {
      patchAgent('patch', { state: 'waiting_for_human', confidence: 0.82 });

      let fired = false;
      const proceed = () => {
        if (fired) return;
        fired = true;
        approveRef.current = null;
        // Defer the tail ~600ms so the gate's gray "Deploying…" spinner actually
        // renders before patch flips to done. Timer is tracked for teardown.
        schedule(600, afterApprove);
      };
      approveRef.current = proceed;
      schedule(6000, proceed); // auto-advance fallback if the judge never clicks
    });

    // Post-approval tail: deploy, verify (401 payoff), restore to healthy.
    const afterApprove = () => {
      patchAgent('patch', { state: 'done', confidence: 0.82 });
      setPatchAttempts((prev) =>
        prev.map((p, i) =>
          i === 0 ? { ...p, humanApproved: true, appliedAt: Date.now() } : p,
        ),
      );
      log('operator', 'Patch approved by operator — deploying auth fix to device-service/.');
      patchAgent('verify', {
        agentName: 'Claude · verify',
        state: 'running',
        reasoning:
          'Replaying the exact same unsigned POST /device/command against the patched endpoint. ',
        confidence: 0.6,
      });

      // ~1.5s — verify done; the same payload now bounces off a 401.
      schedule(1500, () => {
        patchAgent('verify', {
          state: 'done',
          reasoning:
            'Replaying the exact same unsigned POST /device/command against the patched endpoint. 401 Unauthorized — the fix holds.',
          confidence: 0.9,
        });
        setExploitRuns((prev) => [
          {
            id: nextId(),
            findingId: 2,
            modelId: 'bitdeer/deepseek-v3',
            payloadRef: 'POST /device/command {"action":"stop_fan"}',
            deliveredAt: Date.now(),
            deviceImpact: '401 Unauthorized — X-Device-Token required; fan state unchanged',
            success: false,
          },
          ...prev,
        ]);
        log('verify', 'verify: 401 Unauthorized — X-Device-Token now required.');
      });

      // ~2s — restore begins; ~3.5s — device recovers to healthy, run complete.
      schedule(2000, () =>
        patchAgent('restore', {
          agentName: 'Claude · restore',
          state: 'running',
          reasoning: 'Restoring the device to its signed-command baseline; vitals recovering. ',
          confidence: 0.7,
        }),
      );
      schedule(3500, () => {
        patchAgent('restore', { state: 'done', confidence: 1 });
        setDevice({ ...DEVICE_HEALTHY, lastCommand: 'resume', updatedAt: Date.now() });
        log('orchestrator', 'Device restored. Vitals recovered. Pipeline complete.');
      });
    };

    return clearTimers;
    // resetToBase/clearTimers/helpers are stable (useCallback); the run keys off
    // mockExploited only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mockExploited]);

  const setMockExploited = useCallback(
    (v: boolean) => setMockExploitedState(v),
    [],
  );

  return useMemo<RealtimeState>(
    () => ({
      mode: 'mock',
      ready: true,
      device,
      agents,
      findings,
      eventLog,
      exploitRuns,
      patchAttempts,
      irEvents: MOCK_IR_EVENTS,
      mockExploited,
      setMockExploited,
      approve,
    }),
    [
      device,
      agents,
      findings,
      eventLog,
      exploitRuns,
      patchAttempts,
      mockExploited,
      setMockExploited,
      approve,
    ],
  );
}
