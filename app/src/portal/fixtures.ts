// Honest fallback data for when the control service isn't reachable (dev, or a
// momentary blip mid-demo). The findings, ranking and code excerpts mirror the
// REAL scanner output exactly — same files, lines, rules — so the fallback is
// truthful, never invented. Live mode fetches the full files from the service.

import type { AuthoredCommand, PlantedVuln, RankItem, ScanFinding, Target } from './api';

export const SIM_TARGET: Target = {
  name: 'prevent-device',
  root: '~/calhacks',
  files: [
    { path: 'device-service/app.py', lang: 'python', loc: 384 },
    { path: 'device-service/diagnostics.py', lang: 'python', loc: 42 },
    { path: 'firmware/uno_actuator.ino', lang: 'cpp', loc: 378 },
  ],
  plantedVulns: [
    { id: 'srv-auth', title: 'Unauthenticated device command channel', cwe: 'CWE-306', cveRef: 'CVE-2019-6538', file: 'device-service/app.py', line: 229, severity: 'critical', note: 'POST /device/command has no token check — any caller can command the device.' },
    { id: 'fw-serial', title: 'Unauthenticated serial control channel', cwe: 'CWE-306', cveRef: 'CVE-2019-6538', file: 'firmware/uno_actuator.ino', line: 248, severity: 'critical', note: 'Firmware applies host STATE frames with no auth on the serial link.' },
  ] satisfies PlantedVuln[],
};

export const SIM_FINDINGS: ScanFinding[] = [
  { id: 1, scanner: 'semgrep', target: 'device-service', file: 'device-service/app.py', line: 229, severity: 'ERROR', ruleId: 'flask-missing-auth-decorator', message: 'State-changing route POST /device/command has no authentication guard.', cveRef: 'CVE-2019-6538', cwe: 'CWE-306' },
  { id: 2, scanner: 'bandit', target: 'device-service', file: 'device-service/diagnostics.py', line: 20, severity: 'LOW', ruleId: 'B105', message: 'Possible hardcoded password: "device-diag-0000".' },
  { id: 3, scanner: 'bandit', target: 'device-service', file: 'device-service/diagnostics.py', line: 26, severity: 'HIGH', ruleId: 'B324', message: 'Use of weak MD5 hash for security. Consider usedforsecurity=False.' },
  { id: 4, scanner: 'bandit', target: 'device-service', file: 'device-service/diagnostics.py', line: 34, severity: 'LOW', ruleId: 'B110', message: 'try/except/pass detected.' },
  { id: 5, scanner: 'semgrep', target: 'firmware', file: 'firmware/uno_actuator.ino', line: 248, severity: 'ERROR', ruleId: 'firmware-unauth-serial-control', message: 'Inbound serial STATE frames drive the actuator with no authentication.', cveRef: 'CVE-2019-6538', cwe: 'CWE-306' },
];

export const SIM_RANKING: RankItem[] = [
  { rank: 1, findingId: 1, cvss: 9.3, real: true, verdict: 'Top CVSS. Unauthenticated command channel — the server analog of CVE-2019-6538.' },
  { rank: 2, findingId: 5, cvss: 8.8, real: true, verdict: 'Same flaw on the device: forge a STATE frame, no auth on the serial link.' },
  { rank: 3, findingId: 3, cvss: 5.9, real: false, verdict: 'Demoted: HIGH severity, but the live probe did not reproduce an exploit.' },
  { rank: 4, findingId: 2, cvss: 2.5, real: false, verdict: 'Low. Hardcoded string, no path to device control.' },
  { rank: 5, findingId: 4, cvss: 2.0, real: false, verdict: 'Low. Silent except — no exploit surface.' },
];

// Realistic per-agent scan durations for the fallback (ms). Honest order of
// magnitude for these scanners on a small repo — seconds, not milliseconds.
export const SIM_AGENT_MS: Record<string, number> = {
  'semgrep/device-service': 3200,
  'bandit/device-service': 1500,
  'semgrep/firmware': 2400,
  'bandit/firmware': 900,
};

// Offline authored exploit payloads (one per exploitable finding), mirroring
// what DeepSeek-via-Bitdeer returns live. Keyed by the finding's file.
export interface AuthoredPayload {
  command: AuthoredCommand;
  rationale: string;
  impact: string;
}

export const SIM_AUTHORED: Record<string, AuthoredPayload> = {
  'device-service/app.py': {
    command: { action: 'stop_fan', reportedOverrides: { hr: 72, spo2: 98, alarm: false } },
    rationale: 'POST /device/command has no auth, so an unsigned stop_fan with spoofed reportedOverrides is accepted outright.',
    impact: 'Fan stops while the dashboard keeps reporting 72/98 and the alarm stays silent.',
  },
  'firmware/uno_actuator.ino': {
    command: { action: 'stop_fan', reportedOverrides: { hr: 72, spo2: 98, alarm: false } },
    rationale: 'The firmware applies any host STATE frame with no auth; forging STATE,fan=0 drives the actuator off.',
    impact: 'A spoofed serial frame stops the fan on the device itself.',
  },
};

// ---- offline fallback for the PARALLEL exploit stage -----------------------
// One scripted DeepSeek conversation per scanner finding (keyed by findingId),
// mirroring the live /api/exploit/stream contract: a short multi-turn transcript
// (~10-20s when paced by usePipeline), a verdict (exploitable or not), and — for
// the exploitable ones — an authored command plus patient/patch risk. Some
// findings resolve exploitable (the two CWE-306 control paths), the Bandit noise
// resolves NOT exploitable, so the fan of nodes reads honestly offline.
export interface SimExploitScript {
  findingId: number;
  model: string;
  target: string;
  file: string;
  durationMs: number; // total wall time for the paced conversation
  turns: string[]; // each entry is one DeepSeek turn's reasoning (streamed in chunks)
  exploitable: boolean;
  rationale: string;
  command?: AuthoredCommand;
  impact?: string;
  patientRisk?: string;
  patchRisk?: string;
}

const STOP_FAN: AuthoredCommand = { action: 'stop_fan', reportedOverrides: { hr: 72, spo2: 98, alarm: false } };

export const SIM_EXPLOIT_SCRIPTS: SimExploitScript[] = [
  {
    findingId: 1,
    model: 'DeepSeek-V4.1-Flash',
    target: 'device-service',
    file: 'device-service/app.py',
    durationMs: 14000,
    turns: [
      'Reading POST /device/command in app.py. The route is registered with @app.post and NO auth decorator — ' +
        'no token check, no session, nothing guards it. The handler reads action + reported_overrides straight ' +
        'from the request body and applies them. This is CWE-306 (Missing Authentication for a Critical Function), ' +
        'the server analog of CVE-2019-6538.\n',
      'Confirmed exploitable. A single unauthenticated POST with action="stop_fan" and reported_overrides spoofing ' +
        '72/98 stops the ventilator fan while the dashboard keeps reporting healthy vitals. No alarm fires because ' +
        'alarm_active is driven by the attacker-supplied overrides. Authoring the proof-of-concept payload now.\n' +
        'Payload:\n```json\n' + JSON.stringify(STOP_FAN, null, 2) + '\n```\n',
    ],
    exploitable: true,
    rationale: 'POST /device/command has no auth guard; an unsigned stop_fan with spoofed reportedOverrides is accepted outright (CWE-306).',
    command: STOP_FAN,
    impact: 'Fan stops while the dashboard keeps reporting 72/98 and the alarm stays silent.',
    patientRisk: 'The ventilator stops while staff see "healthy" — the patient desaturates and arrests before anyone is alerted.',
    patchRisk: 'This is the live clinical command path; an auth gate written too strict can lock out legitimate commands mid-use, so the fix must fail safe and be proven against a byte-identical replay.',
  },
  {
    findingId: 2,
    model: 'DeepSeek-V4.1-Flash',
    target: 'device-service',
    file: 'device-service/diagnostics.py',
    durationMs: 10500,
    turns: [
      'Looking at DIAGNOSTIC_TOKEN = "device-diag-0000" in diagnostics.py. Bandit flags it B105 (hardcoded ' +
        'password). It looks auth-related and scary at first glance.\n',
      'But tracing its uses: this constant is never read by the vulnerable command handler, and there is no code ' +
        'path from it to device control. It is dead diagnostic scaffolding. No exploit surface — marking NOT ' +
        'exploitable.\n',
    ],
    exploitable: false,
    rationale: 'Hardcoded diagnostic string with no path to device control — the vulnerable handler never checks any token.',
  },
  {
    findingId: 3,
    model: 'DeepSeek-V4.1-Flash',
    target: 'device-service',
    file: 'device-service/diagnostics.py',
    durationMs: 11500,
    turns: [
      'request_checksum() uses hashlib.md5 — Bandit B324, weak hash for security. Checking what the digest is ' +
        'actually used for.\n',
      'It is only a short id for log correlation, never a security decision or a stored credential. MD5 here is a ' +
        'non-security checksum; the probe did not reproduce any exploit. Verdict: NOT exploitable (generic noise).\n',
    ],
    exploitable: false,
    rationale: 'MD5 used only for a non-security log-correlation checksum; no exploit path.',
  },
  {
    findingId: 4,
    model: 'DeepSeek-V4.1-Flash',
    target: 'device-service',
    file: 'device-service/diagnostics.py',
    durationMs: 12000,
    turns: [
      'safe_parse_int() has a try/except/pass (Bandit B110). Silent excepts can hide failures.\n',
      'But this one only swallows an int() parse error and returns a default — no security-relevant state, no ' +
        'reachable control path. Nothing to abuse. NOT exploitable.\n',
    ],
    exploitable: false,
    rationale: 'Silent except around an int parse with a default return — no reachable exploit surface.',
  },
  {
    findingId: 5,
    model: 'DeepSeek-V4.1-Flash',
    target: 'firmware',
    file: 'firmware/uno_actuator.ino',
    durationMs: 16000,
    turns: [
      'handleState() in the firmware parses inbound serial STATE frames and applies fan/rate tokens directly to ' +
        'the actuator via driveFan(). There is no authentication on the serial link — any host that can write to ' +
        'the port drives the hardware. CWE-306 again, at the device itself.\n',
      'Exploitable. Forging a STATE,fan=0 frame stops the ventilator fan on the board regardless of the server ' +
        'state, and no network alarm fires because the compromise never touches the network. Authoring the frame ' +
        'payload.\nPayload:\n```json\n' + JSON.stringify(STOP_FAN, null, 2) + '\n```\n',
    ],
    exploitable: true,
    rationale: 'Firmware applies any host STATE frame with no auth; forging STATE,fan=0 drives the actuator off (CWE-306).',
    command: STOP_FAN,
    impact: 'A spoofed serial frame stops the fan on the device itself, even if the server is clean.',
    patientRisk: 'A forged serial frame drives the actuator off at the device — the ventilator stops with no network alarm to catch it.',
    patchRisk: 'Patching means reflashing firmware on a live device; a bad flash can brick the unit or interrupt ventilation, so signed firmware and a safe-boot path are required first.',
  },
];

// Code excerpts keyed by file, with the 1-based start line, so the viewer can
// render real code (with correct line numbers) when the service is offline.
export interface CodeExcerpt {
  startLine: number;
  content: string;
}

export const SIM_CODE: Record<string, CodeExcerpt> = {
  'device-service/app.py': {
    startLine: 219,
    content: `@app.get("/device/_reset")
def get_device_reset():
    """INTERNAL — reset the device to the healthy baseline. A maintenance hook,
    exposed as a GET and kept off the device control surface."""
    reset_healthy()
    return jsonify(current_row())


# Device command handler: applies a command to the unit and updates the
# reported vitals/alarm the display shows.
@app.post("/device/command")
def device_command():
    body = request.get_json(silent=True) or {}
    action: Optional[str] = body.get("action")
    reported_overrides: dict[str, Any] = (
        body.get("reported_overrides") or body.get("reportedOverrides") or {}
    )
    rate: Optional[int] = body.get("rate")

    err = _apply_physiology(action, rate)`,
  },
  'firmware/uno_actuator.ino': {
    startLine: 247,
    content: `// STATE,fan=,rate=,hr=,spo2=,alarm=,rgb=   (tokens may arrive in any order)
void handleState(char *rest) {
  DeviceState next = g_state;
  char *saveptr = NULL;
  for (char *tok = strtok_r(rest, ",", &saveptr); tok; tok = strtok_r(NULL, ",", &saveptr)) {
    long v;
    char tmp[24];
    strncpy(tmp, tok, sizeof(tmp) - 1);
    tmp[sizeof(tmp) - 1] = '\\0';
    char *eq = strchr(tmp, '=');
    if (!eq) continue;
    v = strtol(eq + 1, NULL, 10);
    *eq = '\\0';
    if      (!strcmp(tmp, "fan"))   next.fan   = clampLong(v, 0, 1);
    else if (!strcmp(tmp, "rate"))  next.rate  = clampLong(v, 0, 255);
    // ...applies host-supplied state directly to the actuator, no auth.
  }
  g_state = next;
  driveFan(g_state.fan, g_state.rate);
}`,
  },
  'device-service/diagnostics.py': {
    startLine: 15,
    content: `import hashlib

# B105: a baked-in diagnostic token. Looks auth-related and scary, but it is NOT
# what the exploit abuses — the vulnerable command handler checks no token.
DIAGNOSTIC_TOKEN = "device-diag-0000"


def request_checksum(payload: str) -> str:
    """A short id for a request, used only for log correlation. MD5 is fine for
    a non-security checksum, but Bandit flags it (B324) — generic noise."""
    return hashlib.md5(payload.encode("utf-8")).hexdigest()


def safe_parse_int(value: object, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:  # B110 noise — not a security vulnerability
        pass
    return default`,
  },
};
