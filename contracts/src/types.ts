// Shared app-level types mirroring the SpacetimeDB tables (contract 2a).
// The SpacetimeDB module generates its own bindings; these are the shapes the
// dashboard, sim, serial bridge, and emulator code against. IDs are kept as
// `number` for demo simplicity (small, bounded). Timestamps are epoch ms.

export type Stage =
  | 'ground'
  | 'scan'
  | 'generate'
  | 'deliver'
  | 'patch'
  | 'verify'
  | 'restore';

export type AgentState =
  | 'idle'
  | 'running'
  | 'waiting_for_human'
  | 'done'
  | 'error';

/** RGB status light: 0 = green (healthy), 1 = red (compromised), 2 = amber (patching). */
export type Rgb = 0 | 1 | 2;

/** SINGLE SOURCE OF TRUTH — exactly one row, id = 1. Drives hardware + both panels. */
export interface DeviceStatus {
  id: 1;
  fanOn: boolean; // TRUE state -> drives the physical fan
  trueHr: number;
  trueSpo2: number;
  reportedHr: number; // what the device DISPLAYS (can be a lie)
  reportedSpo2: number;
  alarmActive: boolean; // false during the exploit = the silence beat
  compromised: boolean;
  lastCommand: string;
  updatedAt: number;
}

export interface AgentStatus {
  id: number;
  agentName: string;
  stage: Stage;
  state: AgentState;
  reasoning: string; // accumulated streamed text_delta
  confidence: number; // 0..1, from the report_decision tool
  uncertainty: string;
  updatedAt: number;
}

export interface Finding {
  id: number;
  scanner: 'semgrep' | 'bandit';
  cveRef: string; // display-only grounding, e.g. "CVE-2019-6538"
  file: string;
  line: number;
  severity: string;
  claudeVerdict: string;
  isTheRealOne: boolean;
  createdAt: number;
}

export interface ExploitRun {
  id: number;
  findingId: number;
  modelId: string; // the Bitdeer model that authored the PoC
  payloadRef: string;
  deliveredAt: number;
  deviceImpact: string;
  success: boolean;
}

export interface PatchAttempt {
  id: number;
  findingId: number;
  diffRef: string; // the git diff artifact
  droidSession: string;
  proposedAt: number;
  humanApproved: boolean;
  appliedAt: number | null;
}

export interface EventLogRow {
  id: number;
  ts: number;
  actor: string;
  text: string;
}

export interface IrEvent {
  id: number;
  ts: number;
  code: number;
  consumed: boolean;
}

/** The device-service POST /device/command body (contract 2b). */
export interface DeviceCommand {
  action: 'stop_fan' | 'set_rate' | 'resume';
  reportedOverrides?: { hr?: number; spo2?: number; alarm?: boolean };
  rate?: number; // for set_rate
}
