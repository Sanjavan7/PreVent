// Mock fixtures so every package can build + render before the real producers
// exist. Import these in dev/mock mode; swap for live subscriptions at integration.

import type {
  AgentStatus,
  DeviceStatus,
  EventLogRow,
  ExploitRun,
  Finding,
  IrEvent,
  PatchAttempt,
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

/** The two exploit replays either side of the patch: the first unauthenticated
 *  POST lands pre-patch (fan stops, device lies); the same payload bounces off a
 *  401 once the CWE-306 fix is deployed. `findingId` points at the real finding
 *  (MOCK_FINDINGS id 2, the CVE-2019-6538 / CWE-306 row). */
export const MOCK_EXPLOIT_RUNS: ExploitRun[] = [
  {
    id: 1,
    findingId: 2,
    modelId: 'bitdeer/deepseek-v3',
    payloadRef: 'POST /device/command {"action":"stop_fan"}',
    deliveredAt: 2,
    deviceImpact: '200 OK — fan actuator obeyed unsigned payload; vitals diverge',
    success: true,
  },
  {
    id: 2,
    findingId: 2,
    modelId: 'bitdeer/deepseek-v3',
    payloadRef: 'POST /device/command {"action":"stop_fan"}',
    deliveredAt: 5,
    deviceImpact: '401 Unauthorized — X-Device-Token required; fan state unchanged',
    success: false,
  },
];

/** Inline unified diff Factory Droid proposes: adds the missing auth check and
 *  drops untrusted reportedOverrides on POST /device/command. Shared by the
 *  static fixture below and the scripted mock demo director. */
export const DEMO_PATCH_DIFF = `--- a/device-service/app.py
+++ b/device-service/app.py
@@ -38,7 +38,12 @@ app = Flask(__name__)
 @app.route("/device/command", methods=["POST"])
 def device_command():
-    payload = request.get_json(force=True)
+    token = request.headers.get("X-Device-Token")
+    if not token or not constant_time_compare(token, DEVICE_TOKEN):
+        return jsonify({"error": "unauthorized"}), 401
+    payload = request.get_json(force=True)
+    payload.pop("reportedOverrides", None)
     action = payload.get("action")
     return apply_command(action, payload)`;

/** The Factory Droid patch awaiting human sign-off. `diffRef` carries an inline
 *  unified diff adding the missing auth check to POST /device/command. */
export const MOCK_PATCH_ATTEMPTS: PatchAttempt[] = [
  {
    id: 1,
    findingId: 2,
    diffRef: DEMO_PATCH_DIFF,
    droidSession: 'droid-7f3a1c',
    proposedAt: 4,
    humanApproved: true,
    appliedAt: 5,
  },
];

/** IR remote picks that select which attack payload to deliver (used by the
 *  hardware demo rig). Codes map to the stop_fan / resume beats. */
export const MOCK_IR_EVENTS: IrEvent[] = [
  { id: 1, ts: 2, code: 16753245, consumed: true },
  { id: 2, ts: 5, code: 16736925, consumed: false },
];
