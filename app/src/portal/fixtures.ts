// Honest fallback data for when the control service isn't reachable (dev, or a
// momentary blip mid-demo). The findings, ranking and code excerpts mirror the
// REAL scanner output exactly — same files, lines, rules — so the fallback is
// truthful, never invented. Live mode fetches the full files from the service.

import type { PlantedVuln, RankItem, ScanFinding, Target } from './api';

export const SIM_TARGET: Target = {
  name: 'prevent-device',
  root: '~/calhacks',
  files: [
    { path: 'device-service/app.py', lang: 'python', loc: 384 },
    { path: 'device-service/diagnostics.py', lang: 'python', loc: 42 },
    { path: 'firmware/uno_actuator.ino', lang: 'cpp', loc: 378 },
  ],
  plantedVulns: [
    { id: 'srv-auth', title: 'Unauthenticated device command channel', cwe: 'CWE-306', cveRef: 'CVE-2019-6538', file: 'device-service/app.py', line: 333, severity: 'critical', note: 'POST /device/command has no token check — any caller can command the device.' },
    { id: 'fw-serial', title: 'Unauthenticated serial control channel', cwe: 'CWE-306', cveRef: 'CVE-2019-6538', file: 'firmware/uno_actuator.ino', line: 248, severity: 'critical', note: 'Firmware applies host STATE frames with no auth on the serial link.' },
  ] satisfies PlantedVuln[],
};

export const SIM_FINDINGS: ScanFinding[] = [
  { id: 1, scanner: 'semgrep', target: 'device-service', file: 'device-service/app.py', line: 333, severity: 'ERROR', ruleId: 'flask-missing-auth-decorator', message: 'State-changing route POST /device/command has no authentication guard.', cveRef: 'CVE-2019-6538', cwe: 'CWE-306' },
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

// Code excerpts keyed by file, with the 1-based start line, so the viewer can
// render real code (with correct line numbers) when the service is offline.
export interface CodeExcerpt {
  startLine: number;
  content: string;
}

export const SIM_CODE: Record<string, CodeExcerpt> = {
  'device-service/app.py': {
    startLine: 320,
    content: `        # and the alarm honestly reflects a stopped fan.
        reported_state["reported_hr"] = true_state["true_hr"]
        reported_state["reported_spo2"] = true_state["true_spo2"]
        reported_state["alarm_active"] = not true_state["fan_on"]

        _sync_and_push(action)
        return jsonify({"ok": True, "fan_on": true_state["fan_on"]})

else:
    # VULNERABLE handler — CWE-306: Missing Authentication for Critical Function.
    # No auth decorator / token check at all. This is the function
    # rules/missing-auth.yaml is written to fire on.
    # ruleid: flask-missing-auth-decorator
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
