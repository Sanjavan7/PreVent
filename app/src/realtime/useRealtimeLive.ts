// Live SpacetimeDB implementation of the realtime hook.
// MUST be rendered under <SpacetimeDBProvider> (see main.tsx). Reads from the
// generated client tables; the same `device_status` row drives both panels and
// the Arduino so nothing can desync.

import { useMemo } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from '@prevent/realtime/spacetime';
import { DEVICE_HEALTHY } from '@prevent/contracts';
import type {
  AgentStatus,
  DeviceStatus,
  EventLogRow,
  ExploitRun,
  Finding,
  IrEvent,
  PatchAttempt,
} from '@prevent/contracts';

import type { RealtimeState } from './useRealtime';

/** No-op since mock-only knobs do not apply in live mode. */
const NOOP = () => {
  /* intentionally empty */
};

export function useRealtimeLive(): RealtimeState {
  const [deviceRows, deviceReady] = useTable(tables.deviceStatus);
  const [agentRows, agentReady] = useTable(tables.agentStatus);
  const [findingRows, findingReady] = useTable(tables.findings);
  const [logRows, logReady] = useTable(tables.eventLog);
  const [exploitRows, exploitReady] = useTable(tables.exploitRuns);
  const [patchRows, patchReady] = useTable(tables.patchAttempts);
  const [irRows, irReady] = useTable(tables.irEvents);

  const ready =
    deviceReady &&
    agentReady &&
    findingReady &&
    logReady &&
    exploitReady &&
    patchReady &&
    irReady;

  return useMemo<RealtimeState>(() => {
    // Expect exactly one device_status row (id = 1). Fall back to the healthy
    // fixture until the first write lands so panels never crash.
    const device: DeviceStatus =
      (deviceRows[0] as DeviceStatus | undefined) ?? DEVICE_HEALTHY;

    // Freshest events first; the dashboard renders newest-at-top.
    const eventLog: EventLogRow[] = [...(logRows as EventLogRow[])].sort(
      (a, b) => b.ts - a.ts,
    );

    // Agents in the canonical stage order so the timeline reads top-to-bottom.
    const STAGE_ORDER: Record<string, number> = {
      ground: 0,
      scan: 1,
      generate: 2,
      deliver: 3,
      patch: 4,
      verify: 5,
      restore: 6,
    };
    const agents: AgentStatus[] = [...(agentRows as AgentStatus[])].sort(
      (a, b) => (STAGE_ORDER[a.stage] ?? 99) - (STAGE_ORDER[b.stage] ?? 99),
    );

    const findings: Finding[] = [...(findingRows as Finding[])].sort(
      (a, b) => b.createdAt - a.createdAt,
    );

    // Newest-first for each of the three additive collections.
    const exploitRuns: ExploitRun[] = [...(exploitRows as ExploitRun[])].sort(
      (a, b) => b.deliveredAt - a.deliveredAt,
    );
    // The generated patch_attempts row carries an extra `proposedBy` identity
    // and types `appliedAt` as `number | undefined`, so narrow via `unknown` to
    // the frozen contract shape (mirrors realtime/src/backend/mock.ts).
    const patchAttempts: PatchAttempt[] = (
      [...patchRows] as unknown as PatchAttempt[]
    ).sort((a, b) => b.proposedAt - a.proposedAt);
    const irEvents: IrEvent[] = [...(irRows as IrEvent[])].sort(
      (a, b) => b.ts - a.ts,
    );

    return {
      mode: 'live',
      ready,
      device,
      agents,
      findings,
      eventLog,
      exploitRuns,
      patchAttempts,
      irEvents,
      mockExploited: false,
      setMockExploited: NOOP,
      approve: NOOP,
    };
  }, [
    deviceRows,
    agentRows,
    findingRows,
    logRows,
    exploitRows,
    patchRows,
    irRows,
    ready,
  ]);
}
