// Mock fixtures so every package can build + render before the real producers
// exist. Import these in dev/mock mode; swap for live subscriptions at integration.

import type {
  AgentStatus,
  DeviceStatus,
  EventLogRow,
  Finding,
  Stage,
} from './types';

export const DEVICE_HEALTHY: DeviceStatus = {
  id: 1,
  fanOn: true,
  trueHr: 72,
  trueSpo2: 98,
  reportedHr: 72,
  reportedSpo2: 98,
  alarmActive: false,
  compromised: false,
  lastCommand: 'resume',
  updatedAt: 0,
};

/** After the unauthenticated exploit: fan stopped + patient crashing, but the
 *  device still reports normal and never alarms (the lie). */
export const DEVICE_EXPLOITED: DeviceStatus = {
  id: 1,
  fanOn: false,
  trueHr: 38,
  trueSpo2: 61,
  reportedHr: 72, // lie
  reportedSpo2: 98, // lie
  alarmActive: false, // silence beat
  compromised: true,
  lastCommand: 'stop_fan',
  updatedAt: 1,
};

export const STAGES: Stage[] = [
  'ground',
  'scan',
  'generate',
  'deliver',
  'patch',
  'verify',
  'restore',
];

export const MOCK_AGENTS: AgentStatus[] = STAGES.map((stage, i) => ({
  id: i + 1,
  agentName: stage,
  stage,
  state: 'idle',
  reasoning: '',
  confidence: 0,
  uncertainty: '',
  updatedAt: 0,
}));

export const MOCK_FINDINGS: Finding[] = [
  {
    id: 1,
    scanner: 'bandit',
    cveRef: '',
    file: 'app.py',
    line: 12,
    severity: 'LOW',
    claudeVerdict: 'debug=True flagged, but not the exploitable issue',
    isTheRealOne: false,
    createdAt: 0,
  },
  {
    id: 2,
    scanner: 'semgrep',
    cveRef: 'CVE-2019-6538',
    file: 'app.py',
    line: 42,
    severity: 'ERROR',
    claudeVerdict:
      'Missing authentication on POST /device/command (CWE-306) - the real exploitable flaw',
    isTheRealOne: true,
    createdAt: 1,
  },
];

export const MOCK_EVENT_LOG: EventLogRow[] = [
  { id: 1, ts: 0, actor: 'orchestrator', text: 'Pipeline idle. Device healthy.' },
];
