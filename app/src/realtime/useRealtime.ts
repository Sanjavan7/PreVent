// Realtime hook facade: picks the mock or live implementation ONCE at module
// load based on VITE_REALTIME_BACKEND. Panels import only `useRealtime` and
// stay backend-agnostic.
//
// Hook-rules note: because `BACKEND` is a Vite build-time constant, the same
// implementation is called every render. React's rules of hooks are satisfied.

import type {
  AgentStatus,
  DeviceStatus,
  EventLogRow,
  Finding,
} from '@prevent/contracts';

import { useRealtimeLive } from './useRealtimeLive';
import { useRealtimeMock } from './useRealtimeMock';

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

const BACKEND = import.meta.env.VITE_REALTIME_BACKEND ?? 'mock';
const useRealtimeImpl: () => RealtimeState =
  BACKEND === 'spacetimedb' ? useRealtimeLive : useRealtimeMock;

export function useRealtime(): RealtimeState {
  return useRealtimeImpl();
}
