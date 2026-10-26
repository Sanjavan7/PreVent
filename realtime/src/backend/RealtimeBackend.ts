// Backend-agnostic realtime interface. The dashboard, 2D sim, and agents code
// against THIS, never against SpacetimeDB directly, so the backend adapter
// (spacetime.ts / mock.ts) can be swapped in one place. Row shapes are the
// frozen contract types.

import type {
  AgentState,
  AgentStatus,
  DeviceStatus,
  EventLogRow,
  ExploitRun,
  Finding,
  IrEvent,
  PatchAttempt,
  Stage,
} from '@prevent/contracts';

export type BackendKind = 'spacetimedb' | 'mock';

/** Table name -> row type. Names mirror the SpacetimeDB tables (contract 2a). */
export interface TableMap {
  device_status: DeviceStatus; // single row (id = 1)
  agent_status: AgentStatus;
  findings: Finding;
  exploit_runs: ExploitRun;
  patch_attempts: PatchAttempt;
  event_log: EventLogRow;
  ir_events: IrEvent;
}
export type TableName = keyof TableMap;
export const TABLE_NAMES: TableName[] = [
  'device_status',
  'agent_status',
  'findings',
  'exploit_runs',
  'patch_attempts',
  'event_log',
  'ir_events',
];

export type Unsubscribe = () => void;

// ---- reducer argument shapes (mirror the SpacetimeDB reducers) --------------------------------

/** Device row minus id/updatedAt (server stamps those). */
export type UpdateDeviceStatusArgs = Omit<DeviceStatus, 'id' | 'updatedAt'>;
export type UpdateAgentStatusArgs = {
  agentName: string;
  stage: Stage;
  state: AgentState;
  reasoning: string;
  confidence: number;
  uncertainty: string;
};
export type RecordFindingArgs = Omit<Finding, 'id' | 'createdAt'>;
export type RecordExploitRunArgs = Omit<ExploitRun, 'id' | 'deliveredAt'>;
export type RecordPatchAttemptArgs = {
  /** Omit to propose a new patch; pass to revise / stamp appliedAt on an existing one. */
  patchId?: number;
  findingId: number;
  diffRef: string;
  droidSession: string;
  appliedAt?: number | null;
};

export interface RealtimeBackend {
  readonly kind: BackendKind;

  /** Open the connection and start all subscriptions. Resolves once the first snapshot applied. */
  connect(): Promise<void>;
  disconnect(): void;

  /**
   * Subscribe to a table. `cb` fires with the FULL current row set once the initial snapshot
   * is applied and again on every change. Returns an unsubscribe function.
   */
  subscribe<K extends TableName>(table: K, cb: (rows: TableMap[K][]) => void): Unsubscribe;

  // ---- reducers (each also appends an event_log row server-side) -----------------------------
  updateDeviceStatus(args: UpdateDeviceStatusArgs): Promise<void>; // only writer of device row
  updateAgentStatus(args: UpdateAgentStatusArgs): Promise<void>;
  recordFinding(args: RecordFindingArgs): Promise<void>;
  recordExploitRun(args: RecordExploitRunArgs): Promise<void>;
  recordPatchAttempt(args: RecordPatchAttemptArgs): Promise<void>;
  approvePatch(patchId: number): Promise<void>;
  logEvent(actor: string, text: string): Promise<void>;
  pushIrEvent(code: number): Promise<void>;
  resetHealthy(): Promise<void>;
}

/** Convenience: subscribe to the single device_status row (null until the snapshot arrives). */
export function subscribeDeviceStatus(
  backend: RealtimeBackend,
  cb: (row: DeviceStatus | null) => void
): Unsubscribe {
  return backend.subscribe('device_status', (rows) => cb(rows[0] ?? null));
}
