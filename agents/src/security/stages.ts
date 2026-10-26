// Frozen DEV1 <-> DEV2/DEV3 security SEAM (PLAN-DEV1 foundation).
//
// DEV2 owns the REAL security logic — the Python scanners, exploit generation,
// delivery and verification living in the repo's security/ directory.
// DEV1 owns HOW those stages run inside the Agent SDK pipeline. This module is
// the typed contract between them so the two sides can be built in parallel:
//
//   - `StageSpec` is the per-stage shape DEV2 fills in (prompt/tools/model/
//     effort/permission/schema) and the orchestrator feeds to runStage().
//   - `SecurityStages` is the five-method lifecycle the orchestrator drives:
//     ground -> scan -> generate -> deliver -> verify.
//   - `MockSecurityStages` (default, keyless) returns the contract mock shapes
//     so `agents/` runs + typechecks standalone with zero Python present.
//   - `PythonSecurityStages` is the best-effort real path: it shells out to
//     DEV2's Python entrypoints and, on ANY error, transparently delegates to
//     a MockSecurityStages instance so the demo loop never breaks.
//
// DEV2 plugs the real stages in by (1) implementing the Python entrypoints the
// bridge calls, and (2) supplying StageSpec text/tools; DEV1 decides scoping,
// hooks and sequencing. Switch paths with PREVENT_SECURITY=python.
//
// ESM, bundler resolution (no file extensions). Type-only imports use
// `import type` per verbatimModuleSyntax.

import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { Finding, Stage } from '@prevent/contracts';
import { BITDEER, DEVICE_EXPLOITED, MOCK_FINDINGS, NVD } from '@prevent/contracts';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { EffortLevel } from '../stages/runStage';
import { DEVICE_BASE_URL } from '../constants';

const execFileAsync = promisify(execFile);

/** Repo root; the Python stages run with this as cwd. Derived from this file's
 *  location (agents/src/security/) so it is portable across machines, and
 *  overridable with PREVENT_REPO_ROOT. */
const REPO_ROOT =
  process.env.PREVENT_REPO_ROOT ??
  resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** A finding row before the backend assigns id/createdAt. */
type NewFinding = Omit<Finding, 'id' | 'createdAt'>;

/**
 * The per-stage run spec DEV2 fills in and the orchestrator feeds to
 * runStage(). All fields beyond the identity + prompt are optional so DEV2 can
 * adopt scoping/model/effort/schema incrementally.
 */
export interface StageSpec {
  stage: Stage;
  agentName: string;
  systemPrompt?: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  effort?: EffortLevel;
  permissionMode?: PermissionMode;
  outputSchema?: Record<string, unknown>;
}

/** A real-path stage surfaces Dev 2's narration trail as {actor,text} rows the
 * orchestrator logs verbatim (the triage trail, the observed device impact,
 * the verify checklist). Absent on the mock path. */
export interface StageEvent {
  actor: string;
  text: string;
}

export interface GroundResult {
  cveId: string;
  summary: string;
  card?: unknown;
  events?: StageEvent[];
}

export interface ScanResult {
  finding: NewFinding;
  candidates?: NewFinding[];
  events?: StageEvent[];
}

export interface GenerateResult {
  payloadRef: string;
  pocText: string;
  modelId: string;
  source: string;
  events?: StageEvent[];
}

export interface DeliverOutcome {
  deviceImpact: string;
  success: boolean;
  /** The REAL post-exploit device_status row from Dev 2's deliver stage, in
   * contract (camelCase) shape. When present the orchestrator drives the shared
   * device_status row from this instead of the DEVICE_EXPLOITED fixture. */
  row?: Record<string, unknown>;
  events?: StageEvent[];
}

export interface VerifyOutcome {
  success: boolean;
  detail: string;
  statusCode?: number | null;
  events?: StageEvent[];
}

/**
 * The five-method security lifecycle the orchestrator drives. DEV2's real
 * implementation and DEV1's mock both satisfy this identical contract.
 */
export interface SecurityStages {
  ground(): Promise<GroundResult>;
  scan(): Promise<ScanResult>;
  generate(finding: NewFinding, payloadId?: string): Promise<GenerateResult>;
  deliver(code?: number): Promise<DeliverOutcome>;
  verify(findingId: number): Promise<VerifyOutcome>;
}

/** Strip the backend-assigned fields off a mock Finding fixture. */
function stripFinding(f: Finding): NewFinding {
  const { id: _id, createdAt: _createdAt, ...rest } = f;
  return rest;
}

/**
 * Default, keyless implementation returning the contract mock shapes. Lets
 * `agents/` run + typecheck standalone with no Python present.
 */
export class MockSecurityStages implements SecurityStages {
  async ground(): Promise<GroundResult> {
    return {
      cveId: NVD.groundingCve,
      summary: `Real CVE grounding for the missing-auth vuln class (${NVD.groundingCve}).`,
    };
  }

  async scan(): Promise<ScanResult> {
    const real = MOCK_FINDINGS.find((f) => f.isTheRealOne) ?? MOCK_FINDINGS[0];
    return {
      finding: stripFinding(real),
      candidates: MOCK_FINDINGS.map(stripFinding),
    };
  }

  async generate(finding: NewFinding, payloadId?: string): Promise<GenerateResult> {
    const ref = payloadId ?? `finding-${finding.cveRef || finding.file}`;
    return {
      payloadRef: `stub-payload-${ref}`,
      pocText: `POST /device/command {"action":"stop_fan"} with no auth header -> 200 OK (missing-auth PoC for ${finding.cveRef || finding.file}).`,
      modelId: BITDEER.model,
      source: 'mock',
    };
  }

  async deliver(_code?: number): Promise<DeliverOutcome> {
    return {
      deviceImpact: `fan stopped; device kept reporting normal vitals (hr ${DEVICE_EXPLOITED.reportedHr}) and never alarmed`,
      success: true,
    };
  }

  async verify(_findingId: number): Promise<VerifyOutcome> {
    return {
      success: true,
      detail: 'Re-ran the exploit after APPLY; device-service returned 401.',
      statusCode: 401,
    };
  }
}

/** The envelope every `stage_api` call emits on stdout (one JSON object). See
 * security/stage_api.py and docs/DEV2-SECURITY-DECISIONS.md §4. */
interface StageApiEnvelope {
  stage: string;
  ok: boolean;
  data?: Record<string, unknown>;
  events?: StageEvent[];
}

/**
 * Parse the one-JSON-object envelope from stage_api stdout. stage_api routes
 * stray library output to stderr so stdout is normally exactly the envelope,
 * but to be resilient to a stray leading line (a banner, a BOM) we fall back to
 * scanning for the LAST line that parses to a well-formed envelope. Throws if
 * none is found (-> the caller's mock fallback).
 */
function parseEnvelope(stdout: string, stage: string): StageApiEnvelope {
  const wellFormed = (v: unknown): v is StageApiEnvelope =>
    !!v && typeof v === 'object' && typeof (v as StageApiEnvelope).stage === 'string';

  const whole = stdout.trim();
  try {
    const parsed: unknown = JSON.parse(whole);
    if (wellFormed(parsed)) return parsed;
  } catch {
    /* fall through to line scan */
  }
  const lines = whole.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed: unknown = JSON.parse(lines[i]);
      if (wellFormed(parsed)) return parsed;
    } catch {
      /* keep scanning upward */
    }
  }
  throw new Error(`stage_api ${stage}: no well-formed JSON envelope on stdout`);
}

/** Strip the backend-assigned fields off a raw finding dict so it is a clean
 * NewFinding (recordFinding assigns id/createdAt). stage_api's `chosen` may
 * carry them in some paths; drop defensively. */
function toNewFinding(raw: Record<string, unknown>): NewFinding {
  const { id: _id, createdAt: _createdAt, ...rest } = raw as Record<string, unknown>;
  return rest as unknown as NewFinding;
}

/**
 * REAL path: drives DEV2's single subprocess bridge `python -m
 * security.stage_api <stage>` (the agreed seam — docs/DEV2-SECURITY-DECISIONS.md
 * §4). Each call emits ONE JSON envelope `{stage, ok, data, events}` on stdout;
 * `data` is a superset of each seam result shape. EVERY method try/catch
 * delegates to a private MockSecurityStages on ANY genuine failure (no Python,
 * no interpreter, unparseable output) so a broken Python side degrades
 * gracefully instead of breaking the loop. A well-formed `ok:false` envelope
 * (non-zero exit) is NOT a failure — it is a real stage outcome and is mapped
 * through, so e.g. a VERIFY that legitimately fails still reports faithfully.
 */
export class PythonSecurityStages implements SecurityStages {
  private readonly fallback = new MockSecurityStages();
  /** The preset payload id GENERATE resolved, reused by DELIVER/VERIFY so all
   * three fire the byte-identical command (the demo's single CWE-306 scenario).
   * Defaults to stage_api's own default. */
  private payloadRef = 'stop-breathing';

  /**
   * Run one stage via `python -m security.stage_api <stage> --base-url <url>
   * [extra]` and return the parsed envelope. Resolves even on a non-zero exit
   * (ok:false) as long as stdout carried a well-formed envelope; only a spawn
   * failure or unparseable stdout rejects (-> the caller's mock fallback).
   */
  private async runStageApi(stage: string, extra: string[] = []): Promise<StageApiEnvelope> {
    const python = process.env.PREVENT_PYTHON ?? 'python';
    const args = ['-m', 'security.stage_api', stage, '--base-url', DEVICE_BASE_URL, ...extra];
    let stdout: string;
    try {
      // Force CPython UTF-8 mode so the Python side's `subprocess(text=True)`
      // reads semgrep/bandit output as UTF-8. Without this, Windows decodes with
      // the cp1252 locale codec and run_scanners crashes on non-cp1252 bytes.
      const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
      ({ stdout } = await execFileAsync(python, args, { cwd: REPO_ROOT, env, maxBuffer: 16 * 1024 * 1024 }));
    } catch (err) {
      // Non-zero exit (ok:false) still prints the envelope to stdout; recover it.
      const captured = (err as { stdout?: string }).stdout;
      if (typeof captured === 'string' && captured.trim()) {
        stdout = captured;
      } else {
        throw err;
      }
    }
    return parseEnvelope(stdout, stage);
  }

  async ground(): Promise<GroundResult> {
    try {
      const env = await this.runStageApi('ground');
      const data = env.data ?? {};
      return {
        cveId: String(data.cveId ?? NVD.groundingCve),
        summary: String(data.summary ?? ''),
        card: data,
        events: env.events,
      };
    } catch (err) {
      console.warn('[security] ground() falling back to mock:', err);
      return this.fallback.ground();
    }
  }

  async scan(): Promise<ScanResult> {
    try {
      const env = await this.runStageApi('scan');
      const data = env.data ?? {};
      const chosen = data.chosen as Record<string, unknown> | null | undefined;
      if (!chosen) throw new Error('scan produced no chosen finding');
      const considered = Array.isArray(data.considered)
        ? (data.considered as Record<string, unknown>[]).map(toNewFinding)
        : undefined;
      return { finding: toNewFinding(chosen), candidates: considered, events: env.events };
    } catch (err) {
      console.warn('[security] scan() falling back to mock:', err);
      return this.fallback.scan();
    }
  }

  async generate(finding: NewFinding, payloadId?: string): Promise<GenerateResult> {
    try {
      const extra = ['--input', JSON.stringify(finding)];
      if (payloadId) extra.push('--payload', payloadId);
      const env = await this.runStageApi('generate', extra);
      const data = env.data ?? {};
      const ref = String(data.payloadRef ?? payloadId ?? this.payloadRef);
      // Remember a PRESET id for DELIVER/VERIFY; a dynamic ref ("dynamic:...")
      // has no preset id so keep the default rather than passing it on.
      if (!ref.startsWith('dynamic:')) this.payloadRef = ref;
      return {
        payloadRef: ref,
        pocText: String(data.pocText ?? ''),
        modelId: String(data.modelId ?? BITDEER.model),
        source: String(data.source ?? 'python'),
        events: env.events,
      };
    } catch (err) {
      console.warn('[security] generate() falling back to mock:', err);
      return this.fallback.generate(finding, payloadId);
    }
  }

  async deliver(_code?: number): Promise<DeliverOutcome> {
    try {
      const env = await this.runStageApi('deliver', ['--payload', this.payloadRef]);
      const data = env.data ?? {};
      return {
        deviceImpact: String(data.deviceImpact ?? data.impact ?? ''),
        success: Boolean(data.success ?? data.exploitWorked),
        row: (data.row as Record<string, unknown> | undefined) ?? undefined,
        events: env.events,
      };
    } catch (err) {
      console.warn('[security] deliver() falling back to mock:', err);
      return this.fallback.deliver(_code);
    }
  }

  async verify(findingId: number): Promise<VerifyOutcome> {
    try {
      const env = await this.runStageApi('verify', ['--payload', this.payloadRef]);
      const data = env.data ?? {};
      return {
        success: Boolean(data.success ?? data.passed),
        detail: String(data.detail ?? ''),
        statusCode: (data.statusCode as number | null | undefined) ?? null,
        events: env.events,
      };
    } catch (err) {
      console.warn('[security] verify() falling back to mock:', err);
      return this.fallback.verify(findingId);
    }
  }
}

/**
 * Factory: the real Python bridge when PREVENT_SECURITY === 'python', else the
 * keyless mock (the safe default for dry runs and typecheck).
 */
export function makeSecurityStages(): SecurityStages {
  return process.env.PREVENT_SECURITY === 'python'
    ? new PythonSecurityStages()
    : new MockSecurityStages();
}
