// The one context the right panel reads from. React 19: the Context object is
// itself the provider (<PipelineContext value={…}>), no forwardRef, components
// at module scope. The value is assembled once by the composition root
// (DashboardPanel in Stage 2) from the single realtime subscription, so the
// feed, the gate and the truth strip can never desync.

import { createContext, type ReactNode } from 'react';
import type {
  AgentStatus,
  DeviceStatus,
  EventLogRow,
  ExploitRun,
  Finding,
  PatchAttempt,
} from '@prevent/contracts';

export interface PipelineMeta {
  /** header scale pill text, e.g. "1 of 3,412 devices" */
  deviceLabel: string;
  /** total fleet size behind the "1 of N" pill */
  fleetSize: number;
  /** SpacetimeDB liveness for the header "ST · live" chip */
  live: boolean;
}

export interface PipelineActions {
  /** human approval of the Factory patch gate */
  approve: () => void;
}

export interface PipelineValue {
  device: DeviceStatus;
  agents: AgentStatus[];
  findings: Finding[];
  eventLog: EventLogRow[];
  exploitRuns: ExploitRun[];
  patchAttempts: PatchAttempt[];
  /** whether the human has approved the patch gate this run */
  approved: boolean;
  meta: PipelineMeta;
  actions: PipelineActions;
}

export const PipelineContext = createContext<PipelineValue | null>(null);

export function PipelineProvider({
  value,
  children,
}: {
  value: PipelineValue;
  children: ReactNode;
}) {
  return <PipelineContext value={value}>{children}</PipelineContext>;
}
