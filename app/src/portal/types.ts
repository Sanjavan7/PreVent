// Portal view-model — the single shape the mission-control UI renders.
//
// Derived from the shared realtime state (device/agents/findings/eventLog/...)
// WITHOUT changing the shared @prevent/contracts tables. The multi-agent fleet
// (4 scanner agents, N exploit-author agents) is a portal-side projection: the
// pipeline is the same seven SpacetimeDB stages, visualized as a spawning graph.

import type {
  EventLogRow,
  ExploitRun,
  Finding,
  PatchAttempt,
} from '@prevent/contracts';

/** Pipeline phases as the portal tells the story (adds `rank`; renames the
 *  shared `patch` stage to `blueteam` for display). Order is the flow. */
export type PhaseId =
  | 'ground'
  | 'scan'
  | 'rank'
  | 'generate'
  | 'deliver'
  | 'blueteam'
  | 'verify';

export const PHASE_ORDER: PhaseId[] = [
  'ground',
  'scan',
  'rank',
  'generate',
  'deliver',
  'blueteam',
  'verify',
];

/** A node's live status. `alert` is the compromise beat; `waiting` is the
 *  human-approval hold. */
export type NodeState = 'idle' | 'active' | 'waiting' | 'done' | 'alert';

export interface PhaseNode {
  id: PhaseId;
  label: string;
  caption: string; // the phase's one-line job, in the operator's words
  state: NodeState;
  agentName?: string; // who is driving this phase right now
  confidence?: number; // 0..1
  detail?: string; // the latest reasoning line
  spawnCount?: number; // sub-agents spawned here (scan = 4, generate = N)
}

export type AgentKind = 'scanner' | 'author' | 'blue';

/** A spawned sub-agent shown fanning out beneath its phase. */
export interface FleetAgent {
  id: string;
  phase: PhaseId;
  kind: AgentKind;
  label: string; // 'semgrep · server'
  engine: string; // 'semgrep' | 'bandit' | 'DeepSeek-V4.1-Flash' | 'Factory'
  target?: string; // 'device-service' | 'firmware'
  state: NodeState;
  metric?: string; // '1 finding' | 'CWE-306 → stop_fan'
  detail?: string;
}

/** One finding after Claude's ranking pass. `real` = exploitable (gets an
 *  author agent); decoys rank low and are marked not-real. */
export interface RankedFinding {
  rank: number;
  finding: Finding;
  cvss: number | null;
  real: boolean;
  verdict: string;
}

/** Truth vs. reported — the lie strip. */
export interface TruthState {
  compromised: boolean;
  fanOn: boolean;
  trueHr: number;
  trueSpo2: number;
  reportedHr: number;
  reportedSpo2: number;
  alarmActive: boolean;
  lying: boolean;
}

export interface GroundCard {
  id: string; // 'CVE-2019-6538'
  cwe: string; // 'CWE-306'
  cvss: number; // 9.3
  title: string;
}

export interface PipelineModel {
  phases: PhaseNode[];
  scanFleet: FleetAgent[];
  authorFleet: FleetAgent[];
  ranking: RankedFinding[];
  telemetry: EventLogRow[];
  truth: TruthState;
  activePhase: PhaseId | null;
  ground: GroundCard | null;
  exploitRuns: ExploitRun[];
  patch: PatchAttempt | null;
  /** True once VERIFY has proven the re-run is blocked (the payoff). */
  resolved: boolean;
}
