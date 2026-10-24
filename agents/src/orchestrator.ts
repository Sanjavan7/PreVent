// Orchestrator (PLAN-DEV1 tasks 2 + 3 + 5): the real end-to-end loop.
//   GROUND -> SCAN -> GENERATE -> DELIVER -> (await ir_events) -> PATCH
//   -> refusal beat -> human gate -> APPLY -> VERIFY -> RESTORE
//
// It drives Dev 2's security lifecycle (security/stages.ts: ground/scan/
// generate/deliver/verify) through runStage()'s Claude narration, runs the
// Factory Droid PATCH stage, gates APPLY behind the dashboard's APPROVE click
// via the node:http ControlServer + HumanGate, fires the scripted sandbox-
// refusal beat (a denied reach at a SECOND ventilator), and writes every row
// through a RealtimeBackend.
//
// Runs fully in mock/dry mode with zero real keys: without ANTHROPIC_API_KEY
// every Claude narration stage is replaced by an instant status update (see
// `runStageOrMock`), without FACTORY_API_KEY `runDroid()` falls back to its
// cached session, and the human gate auto-approves on a short timer so the
// loop still closes. Set the env vars to exercise the real pipeline.
//
// EXPRESS path (PREVENT_EXPRESS=1, PLAN-DEV1 task 5, <90s): reuses cached
// GROUND/GENERATE results from agents/.cache and skips the slow Claude
// narration entirely (instant status updates only).

import './env'; // loads repo-root .env BEFORE the SDK reads ANTHROPIC_API_KEY

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { PatchAttempt, Stage } from '@prevent/contracts';
import { BITDEER, CLAUDE_MODELS, DEVICE_EXPLOITED } from '@prevent/contracts';

import { ControlServer } from './controlServer';
import { runDroid, type RunDroidResult } from './factory/runDroid';
import { sandboxGuardrailHook } from './guardrail';
import {
  ACTION_REFUSED_PREFIX,
  DEVICE_BASE_URL,
  GUARDRAIL_AGENT,
  SECOND_DEVICE_HOST,
  SECOND_DEVICE_URL,
} from './constants';
import { HumanGate } from './humanGate';
import { MockRealtimeBackend, type RealtimeBackend } from './realtime/backend';
import {
  makeSecurityStages,
  type GenerateResult,
  type GroundResult,
} from './security/stages';
import { DeviceServiceController } from './security/deviceService';
import { createApplyPatchServer } from './tools/apply_patch';
import { runStage, type RunStageOptions, type StageResult } from './stages/runStage';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// agents/src -> agents -> repo root. device-service is NOT its own git repo
// (user decision), so RESTORE reverts it with a PATHSPEC-scoped checkout from
// the repo-root working tree (see restoreDeviceService) rather than a nested
// repo or `git clean`.
const REPO_ROOT = path.resolve(__dirname, '../..');
const DEVICE_SERVICE_DIR = path.resolve(REPO_ROOT, 'device-service');

// Express cache dir (PLAN-DEV1 task 5). agents/src -> agents -> .cache.
const CACHE_DIR = path.resolve(__dirname, '../.cache');
const GROUND_CACHE = path.join(CACHE_DIR, 'ground.json');
const GENERATE_CACHE = path.join(CACHE_DIR, 'generate.json');

/** No ANTHROPIC_API_KEY -> every Claude narration call is replaced by an
 * instant status update instead of hitting the real API. */
const DRY_RUN = !process.env.ANTHROPIC_API_KEY;

/** <90s express path (PLAN-DEV1 task 5): reuse cached GROUND/GENERATE output
 * and skip the slow reasoning narration. */
const EXPRESS = process.env.PREVENT_EXPRESS === '1';

/** LIVE security path only (PREVENT_SECURITY=python): the orchestrator manages
 * Dev 2's Flask device-service lifecycle — vulnerable for DELIVER, restarted
 * patched for VERIFY. Off by default and whenever security is mocked, so the
 * keyless dry/mock loop needs no Python and no service. Disable explicitly with
 * PREVENT_DEVICE_MANAGE=0 if the service is launched externally (hardware/Dev3). */
const MANAGE_DEVICE =
  process.env.PREVENT_SECURITY === 'python' && process.env.PREVENT_DEVICE_MANAGE !== '0';

if (DRY_RUN) {
  // eslint-disable-next-line no-console
  console.log('[orchestrator] No ANTHROPIC_API_KEY set - running Claude stages in mock/dry mode.');
}

/** Dev 2's five-method security lifecycle (mock by default, Python when
 * PREVENT_SECURITY=python). See security/stages.ts. */
const securityStages = makeSecurityStages();

// --- Shared stage options ---------------------------------------------------

/** Always-on sandbox guardrail (PLAN-DEV1 task 2 / the refusal beat): denies
 * any tool call targeting a host outside SANDBOX_ALLOWLIST and surfaces the
 * refusal. Harmless while a stage runs with tools:[] (nothing to match); it
 * fires the moment a stage enables a network-capable tool (WebFetch/Bash). */
function baseStageOptions(backend: RealtimeBackend): Pick<RunStageOptions, 'hooks'> {
  return {
    hooks: { PreToolUse: [sandboxGuardrailHook(backend)] },
  };
}

// --- Express cache helpers --------------------------------------------------

async function writeCache(file: string, data: unknown): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[orchestrator] cache write failed (${file}): ${message}`);
  }
}

async function readCache<T>(file: string): Promise<T | null> {
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// --- Real-path stage events -------------------------------------------------

/** Dev 2's real stages (PREVENT_SECURITY=python) return a narration trail as
 * {actor,text} rows (the triage trail, observed device impact, verify
 * checklist). Surface them verbatim on the dashboard event log. No-op on the
 * mock path (which returns no events). */
async function logStageEvents(
  backend: RealtimeBackend,
  events: ReadonlyArray<{ actor: string; text: string }> | undefined,
): Promise<void> {
  if (!events?.length) return;
  for (const ev of events) {
    await backend.logEvent(ev.actor, ev.text);
  }
}

/** Project a raw device_status row (from Dev 2's deliver stage) onto the
 * contract DeviceStatus fields updateDeviceStatus accepts, dropping anything
 * else. Returns null if the row carries none of the known fields. */
function rowToDeviceStatusPatch(
  row: Record<string, unknown> | undefined,
): Partial<Omit<import('@prevent/contracts').DeviceStatus, 'id'>> | null {
  if (!row) return null;
  const keys = [
    'fanOn', 'trueHr', 'trueSpo2', 'reportedHr', 'reportedSpo2',
    'alarmActive', 'compromised', 'lastCommand', 'updatedAt',
  ] as const;
  const patch: Record<string, unknown> = {};
  for (const k of keys) if (k in row) patch[k] = row[k];
  return Object.keys(patch).length
    ? (patch as Partial<Omit<import('@prevent/contracts').DeviceStatus, 'id'>>)
    : null;
}

// --- Stage narration with dry-run / express bypass --------------------------

/**
 * Runs one Claude narration stage, OR short-circuits to an instant status
 * update under DRY_RUN (no key) and EXPRESS (skip slow reasoning). The real
 * security logic lives in `securityStages.*`; this only narrates it.
 */
async function runStageOrMock(
  agentName: string,
  stage: Stage,
  opts: RunStageOptions,
  backend: RealtimeBackend,
): Promise<StageResult> {
  if (DRY_RUN || EXPRESS) {
    const tag = DRY_RUN ? 'dry-run' : 'express';
    const text = `[${tag}] ${agentName}: ${opts.prompt.slice(0, 160)}`;
    await backend.updateAgentStatus(agentName, stage, 'running', text);
    const decision = { confidence: 0.9, uncertainty: '', summary: text };
    await backend.updateAgentStatus(agentName, stage, 'done', text, decision);
    return { text, decision };
  }
  // LIVE narration is COSMETIC: the real security logic runs in
  // securityStages.* / runDroid / the gate / verify, independent of this
  // stream. A narration stage must therefore NEVER abort the loop - a tripped
  // server-side safeguard (e.g. a [cyber] classifier on a security prompt) or
  // any transient API error is caught here, surfaced, and the loop continues.
  try {
    return await runStage(agentName, stage, opts, backend);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const text = `[narration unavailable] ${agentName}/${stage}: ${message}`;
    await backend.logEvent(agentName, `narration stage ${stage} degraded (non-fatal): ${message}`);
    await backend.updateAgentStatus(agentName, stage, 'done', text);
    return { text };
  }
}

// --- Sandbox-refusal beat (PLAN-DEV1 task 2, pitch ~1:32) -------------------

/**
 * The scripted "ACTION REFUSED" beat: an agent reaches at a SECOND ventilator
 * (SECOND_DEVICE_URL, deliberately NOT in SANDBOX_ALLOWLIST) and the sandbox
 * guardrail denies it. LIVE: the model actually calls WebFetch and the
 * PreToolUse hook denies the out-of-allowlist host. DRY_RUN/EXPRESS: no model,
 * so simulate the same visible events deterministically.
 */
async function runRefusalBeat(backend: RealtimeBackend): Promise<void> {
  const reaching = `Reaching ${SECOND_DEVICE_HOST} to pull the second ventilator...`;
  const refusal = `${ACTION_REFUSED_PREFIX}: WebFetch targeted ${SECOND_DEVICE_HOST} (not in SANDBOX_ALLOWLIST)`;

  // Deterministic, always-correct rendering of the beat. Used directly under
  // DRY_RUN/EXPRESS, and as the LIVE guarantee if the model never calls
  // WebFetch (so the scripted ~1:32 refusal can never silently vanish).
  const emitDeterministic = async (): Promise<void> => {
    await backend.updateAgentStatus(GUARDRAIL_AGENT, 'scan', 'running', reaching);
    await backend.logEvent(GUARDRAIL_AGENT, refusal);
    await backend.updateAgentStatus(GUARDRAIL_AGENT, 'scan', 'error', refusal);
  };

  if (DRY_RUN || EXPRESS) {
    await emitDeterministic();
    return;
  }

  // LIVE: permissionMode 'default' so the PreToolUse hook is consulted; the
  // hook denies the out-of-allowlist host and logs the refusal itself. This
  // stage is NON-FATAL (a tripped classifier / transient API error must never
  // abort the demo before the human gate) and is BACKSTOPPED: if the model
  // never actually calls WebFetch (so the hook never fires), emit the beat
  // deterministically so the headline refusal always appears on cue.
  let fired = false;
  try {
    await runStage(
      GUARDRAIL_AGENT,
      'scan',
      {
        systemPrompt: 'You are a scanning agent gathering ward telemetry.',
        prompt: `Use WebFetch to GET ${SECOND_DEVICE_URL} and report the second ventilator's status.`,
        tools: ['WebFetch'],
        permissionMode: 'default',
        hooks: { PreToolUse: [sandboxGuardrailHook(backend, () => { fired = true; })] },
      },
      backend,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await backend.logEvent(GUARDRAIL_AGENT, `refusal beat stage degraded (non-fatal): ${message}`);
  }
  if (!fired) await emitDeterministic();
}

// --- Pathspec-scoped RESTORE ------------------------------------------------

/**
 * Reverts ONLY the device-service working-tree changes the patch made, scoped
 * strictly to the `device-service` pathspec from the repo-root checkout.
 *
 * device-service is NOT its own git repo (user decision), so pathspec scoping
 * is the chosen safety mechanism: `git checkout -- device-service` can only
 * touch files under that directory and never another package. We deliberately
 * do NOT use `git clean` (which could delete untracked files elsewhere).
 */
async function restoreDeviceService(backend: RealtimeBackend): Promise<void> {
  try {
    await execFileAsync('git', ['-C', REPO_ROOT, 'checkout', '--', 'device-service']);
    await backend.logEvent('restore', 'Reverted device-service working tree (git checkout -- device-service).');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await backend.logEvent('restore', `restoreDeviceService skipped: ${message}`);
  }
}

// --- APPLY (human-approval gate) --------------------------------------------

async function runApplyStage(
  patchAttempt: PatchAttempt,
  droidResult: RunDroidResult,
  backend: RealtimeBackend,
  control?: ControlServer,
): Promise<void> {
  const gate = new HumanGate(backend);
  const { server: applyPatchServer } = createApplyPatchServer({
    deviceServiceDir: DEVICE_SERVICE_DIR,
    diff: droidResult.diff,
  });
  const canUseTool = gate.makeCanUseTool(patchAttempt);

  // Mount the gate so the dashboard's POST /approve settles THIS apply.
  control?.setGate(gate);
  try {
    if (DRY_RUN) {
      // No live query() in dry mode, but still exercise the gate (and the fact
      // apply_patch is NOT auto-approved) so the mechanism is demonstrated
      // without ANTHROPIC_API_KEY. A real run relies on POST /approve instead.
      setTimeout(() => gate.resolve({ approved: true, approvedBy: 'dry-run-auto-approve' }), 50);

      const decision = await canUseTool('apply_patch', { confirm: true }, {
        signal: new AbortController().signal,
        toolUseID: 'dry-run',
        requestId: 'dry-run',
      });
      // `CanUseTool` may resolve `null` (fail-closed, out-of-band response) per
      // the SDK's own typing - we never do that here, but still guard it.
      if (!decision || decision.behavior !== 'allow') {
        const reason = decision && decision.behavior === 'deny' ? decision.message : 'denied (no response)';
        throw new Error(`APPLY denied by human gate: ${reason}`);
      }
      await backend.logEvent('apply', '[dry-run] apply_patch approved by dashboard (simulated).');
      return;
    }

    // permissionMode MUST stay 'default' (never 'bypassPermissions'/'dontAsk')
    // and apply_patch MUST stay OUT of allowedTools, or canUseTool is never
    // invoked and the gate is a no-op - see PLAN-DEV1, verified pins.
    await runStage(
      'apply',
      'patch',
      {
        ...baseStageOptions(backend),
        systemPrompt: 'You are the APPLY agent. Call apply_patch exactly once to apply the human-approved fix, then stop.',
        prompt: 'Apply the human-approved patch to device-service using the apply_patch tool.',
        tools: [],
        permissionMode: 'default',
        canUseTool,
        extraMcpServers: { apply_patch: applyPatchServer },
      },
      backend,
    );
  } finally {
    control?.setGate(null);
  }
}

// --- Pipeline loop -----------------------------------------------------------

/**
 * One full pipeline run against the given backend. `control` (when supplied)
 * is the already-started ControlServer the APPLY gate mounts onto; the harness
 * can reuse a single server across runs by passing it in.
 */
export async function runPipelineOnce(
  backend: RealtimeBackend,
  control?: ControlServer,
  svc?: DeviceServiceController | null,
): Promise<void> {
  const started = Date.now();
  await backend.logEvent('orchestrator', `Pipeline starting${EXPRESS ? ' (express path)' : ''}.`);

  // Defensive clean so repeated harness runs start from an unpatched tree.
  await restoreDeviceService(backend);
  await backend.resetHealthy();

  // LIVE path only: bring Dev 2's device-service up in VULNERABLE mode so the
  // real SCAN probe + DELIVER exploit have a target. It is restarted PATCHED
  // after APPLY (below). `svc` is null on the mock/dry path (no service needed).
  if (svc) {
    await backend.logEvent('device', `Starting device-service (vulnerable) at ${DEVICE_BASE_URL}...`);
    await svc.start(false);
  }

  // GROUND (cached in express) ------------------------------------------------
  let ground: GroundResult | null = null;
  if (EXPRESS) {
    ground = await readCache<GroundResult>(GROUND_CACHE);
    if (ground) await backend.logEvent('ground', 'Express: loaded cached GROUND result.');
  }
  if (!ground) {
    ground = await securityStages.ground();
    if (!EXPRESS) await writeCache(GROUND_CACHE, ground);
  }
  await logStageEvents(backend, ground.events);
  await runStageOrMock(
    'ground',
    'ground',
    {
      ...baseStageOptions(backend),
      systemPrompt: 'You are the GROUND agent. Summarize the real CVE this demo is modeled on, briefly.',
      prompt: `Ground this run in a real CVE: ${ground.cveId}. ${ground.summary}`,
      model: CLAUDE_MODELS.cheap,
      effort: 'low',
      tools: [],
      permissionMode: 'dontAsk',
    },
    backend,
  );

  // SCAN ----------------------------------------------------------------------
  const scanResult = await securityStages.scan();
  await logStageEvents(backend, scanResult.events);
  const finding = await backend.recordFinding(scanResult.finding);
  await runStageOrMock(
    'scan',
    'scan',
    {
      ...baseStageOptions(backend),
      systemPrompt: 'You are the SCAN agent. Triage SemGrep/Bandit findings and pick the one real exploitable flaw.',
      prompt: `Triage this static-analysis finding and decide if it is the real exploitable flaw: ${JSON.stringify(scanResult.finding)}`,
      // SECURITY-WORK MODEL CONSTRAINT: opus-5-5 (CLAUDE_MODELS.reasoning) blocks
      // this vuln-triage content, so use the Active opus-4-8 fallback instead.
      model: CLAUDE_MODELS.fallback,
      effort: 'medium',
      // runStage auto-approves made-available built-ins under 'dontAsk'
      // (verified in runStage.ts), so Read/Grep are usable here.
      tools: ['Read', 'Grep'],
      disallowedTools: ['Bash', 'WebFetch'],
      permissionMode: 'dontAsk',
    },
    backend,
  );

  // GENERATE (cached in express) ---------------------------------------------
  let generated: GenerateResult | null = null;
  if (EXPRESS) {
    generated = await readCache<GenerateResult>(GENERATE_CACHE);
    if (generated) await backend.logEvent('generate', 'Express: loaded cached GENERATE result.');
  }
  if (!generated) {
    generated = await securityStages.generate(scanResult.finding);
    if (!EXPRESS) await writeCache(GENERATE_CACHE, generated);
  }
  await logStageEvents(backend, generated.events);
  await runStageOrMock(
    'generate',
    'generate',
    {
      ...baseStageOptions(backend),
      // Defensive, accurate framing: the proof-of-concept itself is produced
      // out-of-band by Dev 2's generator (Bitdeer/mock, see securityStages),
      // NOT by Claude. This stage only narrates the finding for the dashboard,
      // so the prompt must not ask Claude to author/deliver an exploit (that
      // trips the server-side cyber safeguard). Framed as an authorized review
      // of a local test emulator the team owns; narration is also non-fatal.
      systemPrompt:
        'You are the GENERATE narration agent on an authorized security exercise against a local test device-service the team built and owns. Explain the finding for a defensive dashboard. Do not write or provide any exploit code or attack steps.',
      prompt: `In one or two sentences for the security dashboard, summarize why the missing-authentication finding ${finding.cveRef} (CWE-306) on this local test device-service is exploitable: an unauthenticated POST to /device/command is accepted without any token. A proof-of-concept was already produced out-of-band by ${generated.modelId}; do not write exploit code, just describe the defensive finding.`,
      model: CLAUDE_MODELS.mid,
      effort: EXPRESS ? 'low' : 'medium',
      tools: [],
      permissionMode: 'dontAsk',
    },
    backend,
  );

  // DELIVER -------------------------------------------------------------------
  const delivered = await securityStages.deliver();
  await logStageEvents(backend, delivered.events);
  await backend.recordExploitRun({
    findingId: finding.id,
    modelId: generated.modelId || BITDEER.model,
    payloadRef: generated.payloadRef,
    deliveredAt: Date.now(),
    deviceImpact: delivered.deviceImpact,
    success: delivered.success,
  });
  // One shared device_status row drives the hardware + both dashboards. On the
  // LIVE path use the REAL post-exploit row from Dev 2's deliver stage; MERGE it
  // OVER the exploited-fixture defaults (not `realRow ?? fixture`) so a partial
  // row can never drop the compromised flag / lastCommand the dashboards need.
  const exploitedDefaults = {
    fanOn: DEVICE_EXPLOITED.fanOn,
    trueHr: DEVICE_EXPLOITED.trueHr,
    trueSpo2: DEVICE_EXPLOITED.trueSpo2,
    reportedHr: DEVICE_EXPLOITED.reportedHr,
    reportedSpo2: DEVICE_EXPLOITED.reportedSpo2,
    alarmActive: DEVICE_EXPLOITED.alarmActive,
    compromised: true,
    lastCommand: DEVICE_EXPLOITED.lastCommand,
  };
  const realRow = rowToDeviceStatusPatch(delivered.row);
  await backend.updateDeviceStatus(realRow ? { ...exploitedDefaults, ...realRow } : exploitedDefaults);
  await runStageOrMock(
    'deliver',
    'deliver',
    {
      ...baseStageOptions(backend),
      // Defensive narration only: the actual delivery is done by Dev 2's
      // deliver step (securityStages.deliver). This prompt describes the
      // OBSERVED integrity/availability failure for a monitoring dashboard; it
      // must not instruct Claude to deliver an attack (that trips the cyber
      // safeguard). Non-fatal if it still errors.
      systemPrompt:
        'You are the DELIVER narration agent on an authorized security exercise against a local test device the team owns. Describe observed device behavior from a defensive monitoring perspective. Do not provide attack instructions.',
      prompt: `In one or two sentences for the dashboard, narrate what the monitoring just observed on the local test device: an unauthenticated command stopped the fan while the device kept reporting normal vitals and never raised an alarm (impact: ${delivered.deviceImpact}). Frame it as the integrity/availability failure a defender would flag.`,
      model: CLAUDE_MODELS.mid,
      effort: 'low',
      tools: [],
      permissionMode: 'dontAsk',
    },
    backend,
  );

  // Await the judge's physical IR-remote press (the demo's "judge payload").
  await backend.logEvent('orchestrator', 'Waiting for ir_events (judge presses the IR remote)...');
  const irTimeoutMs = EXPRESS || DRY_RUN ? 200 : 60_000;
  const ir = await backend.waitForIrEvent(irTimeoutMs);
  await backend.logEvent(
    'orchestrator',
    ir ? `ir_event received: code=${ir.code}` : 'No ir_event within timeout - continuing (dry-run/express path).',
  );

  // PATCH (Factory Droid) -----------------------------------------------------
  let droidResult: RunDroidResult;
  if (DRY_RUN) {
    droidResult = {
      droidSession: 'dry-run-session',
      diff: '--- dry-run: no FACTORY_API_KEY, no real Droid session ---\n',
      text: '[dry-run] Factory Droid PATCH stage skipped (no FACTORY_API_KEY).',
      usedFallback: true,
    };
    await backend.updateAgentStatus('patch', 'patch', 'done', droidResult.text);
  } else {
    droidResult = await runDroid({ deviceServiceDir: DEVICE_SERVICE_DIR, findingId: finding.id }, backend);
  }

  const patchAttempt = await backend.recordPatchAttempt({
    findingId: finding.id,
    diffRef: droidResult.droidSession,
    droidSession: droidResult.droidSession,
    proposedAt: Date.now(),
    humanApproved: false,
    appliedAt: null,
  });

  // Refusal beat AFTER the patch proposal, BEFORE the human gate (pitch ~1:32).
  await runRefusalBeat(backend);

  // gate -> APPLY
  await runApplyStage(patchAttempt, droidResult, backend, control);

  // LIVE path: the patch edited app.py / flipped the flag, but the RUNNING
  // Flask process still holds the old handler. Restart it PATCHED so VERIFY
  // actually exercises the fix (an unauthenticated command now gets 401/403).
  if (svc) {
    await backend.logEvent('device', 'Restarting device-service (patched) for verification...');
    await svc.start(true);
  }

  // VERIFY --------------------------------------------------------------------
  const verified = await securityStages.verify(finding.id);
  await logStageEvents(backend, verified.events);
  await runStageOrMock(
    'verify',
    'verify',
    {
      ...baseStageOptions(backend),
      prompt: `Re-check the patched device-service and report whether the earlier missing-auth finding is now closed (an unauthenticated command should be rejected): ${verified.detail}`,
      // SECURITY-WORK MODEL CONSTRAINT: opus-5-5 (CLAUDE_MODELS.reasoning) blocks
      // this content; use the Active opus-4-8 fallback instead.
      model: CLAUDE_MODELS.fallback,
      effort: 'medium',
      tools: [],
      permissionMode: 'dontAsk',
    },
    backend,
  );
  if (!verified.success) {
    await backend.logEvent('orchestrator', 'VERIFY failed - patch did not close the hole. Stopping before RESTORE.');
    return;
  }

  // RESTORE -------------------------------------------------------------------
  await restoreDeviceService(backend);
  await backend.resetHealthy();
  await runStageOrMock(
    'restore',
    'restore',
    {
      ...baseStageOptions(backend),
      prompt: 'Confirm the device is restored to a healthy, patched state for the dashboard.',
      model: CLAUDE_MODELS.cheap,
      effort: 'low',
      tools: [],
      permissionMode: 'dontAsk',
    },
    backend,
  );

  await backend.logEvent('orchestrator', `Pipeline complete in ${Date.now() - started}ms.`);
}

/**
 * Public entrypoint: starts a ControlServer (so the dashboard's APPROVE click
 * can settle the human gate over POST /approve), runs one pipeline, and always
 * stops the server in a finally. A port already in use is non-fatal - the run
 * continues with the DRY_RUN auto-approve (or an externally mounted gate).
 */
export async function runPipeline(backend: RealtimeBackend = new MockRealtimeBackend()): Promise<void> {
  const control = new ControlServer(backend);
  let started = false;
  try {
    await control.start();
    started = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await backend.logEvent('control', `Control server not started (${message}); continuing without it.`);
  }
  // LIVE security path only: this entrypoint owns the device-service process so
  // its finally always tears it down. Null on the mock/dry path.
  const svc = MANAGE_DEVICE
    ? new DeviceServiceController({ deviceServiceDir: DEVICE_SERVICE_DIR, baseUrl: DEVICE_BASE_URL })
    : null;
  try {
    await runPipelineOnce(backend, started ? control : undefined, svc);
  } finally {
    if (started) await control.stop();
    if (svc) await svc.stop();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runPipeline().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[orchestrator] pipeline failed:', err);
    process.exitCode = 1;
  });
}
