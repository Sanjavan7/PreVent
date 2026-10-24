// Mock implementation of the realtime hook (no network, deterministic fixtures).
// Used when VITE_REALTIME_BACKEND !== 'spacetimedb', or at build time before the
// shared Maincloud module exists. Keeps the panels functional on cold starts.

import { useCallback, useMemo, useState } from 'react';
import {
  DEVICE_EXPLOITED,
  DEVICE_HEALTHY,
  MOCK_AGENTS,
  MOCK_EVENT_LOG,
  MOCK_FINDINGS,
} from '@prevent/contracts';

import type { RealtimeState } from './useRealtime';

export function useRealtimeMock(): RealtimeState {
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
