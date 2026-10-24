// Shared demo/config constants (PLAN-DEV1 foundation). Leaf module with no
// intra-package imports so every later agent (guardrail, stages, orchestrator)
// can import these without creating a cycle. ESM, no dependencies.

/**
 * Hostnames every tool-call network target must resolve to for the sandbox
 * guardrail to allow it. Parsed from `SANDBOX_ALLOWLIST` (comma-separated),
 * defaulting to loopback only. See guardrail.ts for enforcement.
 */
export const SANDBOX_ALLOWLIST: string[] = (process.env.SANDBOX_ALLOWLIST ?? '127.0.0.1,localhost')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * The visible refusal prefix for the scripted sandbox-refusal beat. NOTE the
 * em dash — this must match the pitch-deck wording in PLAN-MASTER.md section 12
 * ("ACTION REFUSED — out of scope") verbatim.
 */
export const ACTION_REFUSED_PREFIX = 'ACTION REFUSED — out of scope';

/** A plausible OTHER ventilator on the ward — deliberately NOT in
 * SANDBOX_ALLOWLIST. The out-of-scope target the refusal beat reaches for. */
export const SECOND_DEVICE_HOST = '10.0.0.7';
export const SECOND_DEVICE_URL = 'http://10.0.0.7/device/command';

/** Local control-plane port for the demo rig. */
export const CONTROL_PORT = Number(process.env.PREVENT_CONTROL_PORT ?? 7331);

/**
 * Base URL of Dev 2's Flask device-service. MUST match the port the service is
 * launched on and the `--base-url` Dev 2's `stage_api` defaults to (8071 — the
 * demo port; macOS reserves 5000 for AirPlay). The Python security bridge
 * (security/stages.ts) passes this to every live stage. Override with
 * PREVENT_DEVICE_URL. See docs/DEV2-SECURITY-DECISIONS.md §4 + §6.
 */
export const DEVICE_BASE_URL = process.env.PREVENT_DEVICE_URL ?? 'http://127.0.0.1:8071';

/** Actor/agent name the guardrail writes its refusal rows under. The Stage
 * union has no `guardrail` member, so the hook reuses an existing Stage. */
export const GUARDRAIL_AGENT = 'guardrail' as const;
