// Single data hook for both panels. Both read the SAME rows (zero desync).
//
// TODO(dev): swap the mock body for live SpacetimeDB subscriptions:
//   import { SpacetimeDBProvider, useTable } from 'spacetimedb/react';
//   const [deviceRows, ready] = useTable(tables.device_status);
//   const [agentRows] = useTable(tables.agent_status);
//   const [findingRows] = useTable(tables.finding);
//   const [logRows] = useTable(tables.event_log);
// Wrap <App/> in <SpacetimeDBProvider connectionBuilder={...}> in main.tsx
// (pass the DbConnection.builder() result, do NOT call .build()).
// Keep this hook's return shape stable so panels do not change.

import { useCallback, useMemo, useState } from 'react';
import {
  DEVICE_EXPLOITED,
  DEVICE_HEALTHY,
  MOCK_AGENTS,
  MOCK_EVENT_LOG,
  MOCK_FINDINGS,
} from '@prevent/contracts';
import type {
  AgentStatus,
  DeviceStatus,
  EventLogRow,
  Finding,
} from '@prevent/contracts';

export type RealtimeMode = 'mock' | 'live';

export interface RealtimeState {
  mode: RealtimeMode;
  ready: boolean;
  device: DeviceStatus;
  agents: AgentStatus[];
  findings: Finding[];
  eventLog: EventLogRow[];
  /** Mock-only: flip the device between healthy and exploited fixtures. */
  mockExploited: boolean;
  setMockExploited: (exploited: boolean) => void;
}

export function useRealtime(): RealtimeState {
  const [mockExploited, setMockExploitedState] = useState(false);
  const setMockExploited = useCallback(
    (v: boolean) => setMockExploitedState(v),
    [],
  );

  return useMemo<RealtimeState>(
    () => ({
      mode: 'mock',
      ready: true,
      device: mockExploited ? DEVICE_EXPLOITED : DEVICE_HEALTHY,
      agents: MOCK_AGENTS,
      findings: MOCK_FINDINGS,
      eventLog: MOCK_EVENT_LOG,
      mockExploited,
      setMockExploited,
    }),
    [mockExploited, setMockExploited],
  );
}
