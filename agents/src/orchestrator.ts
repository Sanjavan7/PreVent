// Orchestrator (PLAN-DEV1 tasks 2 + 5): sequences
//   GROUND -> SCAN -> GENERATE -> DELIVER -> (await ir_events) -> PATCH
//   -> gate -> APPLY -> VERIFY -> RESTORE
// calling Dev 2's security/ stage functions (STUBBED below - see the
// "Dev 2's stage modules" section) through runStage(), running the Factory
// Droid PATCH stage, gating APPLY behind the human-approval callback, and
// writing every row through a RealtimeBackend.
//
// Runs fully in mock/dry mode with zero real keys: without ANTHROPIC_API_KEY
// every Claude stage is replaced by an instant stubbed StageResult (see
// `runStageOrMock`), and without FACTORY_API_KEY `runDroid()` falls back to
// its cached session. Set both env vars to exercise the real pipeline.

import './env'; // loads repo-root .env BEFORE the SDK reads ANTHROPIC_API_KEY

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  HookCallback,
  HookCallbackMatcher,
  HookJSONOutput,
  PreToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import type { Finding, PatchAttempt, Stage } from '@prevent/contracts';
import { BITDEER, CLAUDE_MODELS, DEVICE_EXPLOITED, MOCK_FINDINGS, NVD } from '@prevent/contracts';

import { createApplyPatchServer } from './tools/apply_patch';
import { runDroid, type RunDroidResult } from './factory/runDroid';
import { HumanGate } from './humanGate';
import { MockRealtimeBackend, type RealtimeBackend } from './realtime/backend';
import { runStage, type RunStageOptions, type StageResult } from './stages/runStage';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// agents/src -> agents -> repo root -> device-service (its OWN git repo,
// per PLAN-FOUNDATION, so RESTORE's git-revert never touches other packages).
const DEVICE_SERVICE_DIR = path.resolve(__dirname, '../../device-service');

/** No ANTHROPIC_API_KEY -> every Claude stage call is stubbed instead of
 * hitting the real API. Flip this on by setting the env var. */
const DRY_RUN = !process.env.ANTHROPIC_API_KEY;

/** <90s express path (PLAN-DEV1 task 5): skip the slow reasoning narration
 * and reuse cached GROUND/GENERATE output. TODO(dev): wire this to actually
 * load a cached GROUND summary + exploit payload once those are recorded. */
const EXPRESS = process.env.PREVENT_EXPRESS === '1';

if (DRY_RUN) {
  // eslint-disable-next-line no-console
  console.log('[orchestrator] No ANTHROPIC_API_KEY set - running Claude stages in mock/dry mode.');
}

// --- Separation-of-duties sandbox guardrail (PLAN-DEV1 task 2) -------------

/** TODO(dev): read SANDBOX_ALLOWLIST from .env (comma-separated hostnames
 * every tool call's network target must be in). */
const SANDBOX_ALLOWLIST = (process.env.SANDBOX_ALLOWLIST ?? '127.0.0.1,localhost')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function extractHosts(value: unknown): string[] {
  const text = JSON.stringify(value ?? '');
  const matches = text.match(/https?:\/\/([a-zA-Z0-9.-]+)/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/^https?:\/\//, '')))];
}

/**
 * A PreToolUse hook that denies any tool call whose input targets a host
 * outside `SANDBOX_ALLOWLIST`, and emits a visible refusal event
 * (`logEvent('guardrail', 'ACTION REFUSED - out of scope: ...')`) - this is a
 * scripted, rehearsed beat for the demo, proving enforcement is real.
 */
function sandboxGuardrailHook(backend: RealtimeBackend): HookCallbackMatcher {
  const hook: HookCallback = async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const preToolInput = input as PreToolUseHookInput;

    const hosts = extractHosts(preToolInput.tool_input);
    const blocked = hosts.filter((h) => !SANDBOX_ALLOWLIST.includes(h));
    if (blocked.length === 0) return {};

    await backend.logEvent(
      'guardrail',
      `ACTION REFUSED - out of scope: ${preToolInput.tool_name} targeted ${blocked.join(', ')} (not in SANDBOX_ALLOWLIST)`,
    );

    const output: HookJSONOutput = {
      // PreToolUse blocks via hookSpecificOutput.permissionDecision: 'deny';
      // the legacy top-level `decision` field is not the operative one here.
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Sandbox guardrail: ${blocked.join(', ')} is not in SANDBOX_ALLOWLIST.`,
      },
    };
    return output;
  };

  return { hooks: [hook] };
}

function baseStageOptions(backend: RealtimeBackend): Pick<RunStageOptions, 'disallowedTools' | 'hooks'> {
  return {
    // TODO(dev): once Dev 2's stages need Bash/WebFetch for real scans, drop
    // this to a narrower deny list - the guardrail hook below still catches
    // any out-of-allowlist network target regardless of what's enabled here.
    disallowedTools: [],
    // Always-on sandbox guardrail (PLAN-DEV1 task 2 / the "refusal" beat):
    // denies any tool call targeting a host outside SANDBOX_ALLOWLIST and logs
    // the visible refusal. Harmless while a stage runs with tools:[] (nothing
    // to match); fires once a stage enables Bash/WebFetch.
    hooks: { PreToolUse: [sandboxGuardrailHook(backend)] },
  };
}

// --- Dev 2's stage modules (STUBBED for now) --------------------------------
// TODO(dev): once security/ exists, replace every *Stub() below with real
// calls, e.g. `import { ground, scan, generate, deliver, verify } from
// '../../security/src';` (a sibling package at the repo root - Dev 2's
// contract). Each stub below mirrors the shape the real module will return.

async function groundStub(): Promise<{ cveId: string; summary: string }> {
  return {
    cveId: NVD.groundingCve,
    summary: `Real CVE grounding for the missing-auth vuln class (${NVD.groundingCve}).`,
  };
}

async function scanStub(): Promise<Finding> {
  return MOCK_FINDINGS.find((f) => f.isTheRealOne) ?? MOCK_FINDINGS[0];
}

async function generateStub(finding: Finding): Promise<{ payloadRef: string }> {
  return { payloadRef: `stub-payload-finding-${finding.id}` };
}

async function deliverStub(): Promise<{ deviceImpact: string; success: boolean }> {
  return {
    deviceImpact: 'fan stopped; device kept reporting normal vitals and never alarmed',
    success: true,
  };
}

async function verifyStub(): Promise<{ success: boolean; detail: string }> {
  return { success: true, detail: 'Re-ran the exploit after APPLY; device-service returned 401.' };
}

// --- Stage runner with a dry-run bypass -------------------------------------

async function runStageOrMock(
  agentName: string,
  stage: Stage,
  opts: RunStageOptions,
  backend: RealtimeBackend,
): Promise<StageResult> {
  if (DRY_RUN) {
    const text = `[dry-run] ${agentName}: ${opts.prompt.slice(0, 160)}`;
    await backend.updateAgentStatus(agentName, stage, 'running', text);
    const decision = { confidence: 0.9, uncertainty: '', summary: text };
    await backend.updateAgentStatus(agentName, stage, 'done', text, decision);
    return { text, decision };
  }
  return runStage(agentName, stage, opts, backend);
}

// --- APPLY (human-approval gate) --------------------------------------------

async function runApplyStage(
  patchAttempt: PatchAttempt,
  droidResult: RunDroidResult,
  backend: RealtimeBackend,
): Promise<void> {
  const gate = new HumanGate(backend);
  const { server: applyPatchServer } = createApplyPatchServer({
    deviceServiceDir: DEVICE_SERVICE_DIR,
    diff: droidResult.diff,
  });
  const canUseTool = gate.makeCanUseTool(patchAttempt);

  if (DRY_RUN) {
    // No live query() call in dry mode, but we still exercise the gate
    // itself (and the fact apply_patch is NOT auto-approved) so the
    // mechanism is demonstrated without ANTHROPIC_API_KEY.
    // TODO(dev): wire gate.resolve(...) to the dashboard's APPROVE click
    // instead of this timer once Dev 3's HTTP route exists.
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
  // or canUseTool is never invoked and the gate is a no-op - see PLAN-DEV1.
  await runStage(
    'apply',
    'patch',
    {
      systemPrompt: 'You are the APPLY agent. Call apply_patch exactly once to apply the human-approved fix, then stop.',
      prompt: 'Apply the human-approved patch to device-service using the apply_patch tool.',
      tools: [],
      permissionMode: 'default',
      canUseTool,
      extraMcpServers: { apply_patch: applyPatchServer },
    },
    backend,
  );
}

// --- Pipeline loop -----------------------------------------------------------

export async function runPipeline(backend: RealtimeBackend = new MockRealtimeBackend()): Promise<void> {
  const started = Date.now();
  await backend.logEvent('orchestrator', `Pipeline starting${EXPRESS ? ' (express path)' : ''}.`);
  await backend.resetHealthy();

  // GROUND
  const ground = await groundStub();
  await runStageOrMock(
    'ground',
    'ground',
    {
      ...baseStageOptions(backend),
      systemPrompt: 'You are the GROUND agent. Summarize the real CVE this demo is modeled on, briefly.',
      prompt: `Ground this run in a real CVE: ${ground.cveId}. ${ground.summary}`,
      model: CLAUDE_MODELS.cheap, // cheap narration per the verified pins
      effort: 'low',
      tools: [],
      permissionMode: 'dontAsk', // read-only stage
    },
    backend,
  );

  // SCAN
  const finding = await scanStub();
  await backend.recordFinding({
    scanner: finding.scanner,
    cveRef: finding.cveRef,
    file: finding.file,
    line: finding.line,
    severity: finding.severity,
    claudeVerdict: finding.claudeVerdict,
    isTheRealOne: finding.isTheRealOne,
  });
  await runStageOrMock(
    'scan',
    'scan',
    {
      ...baseStageOptions(backend),
      systemPrompt: 'You are the SCAN agent. Triage SemgGrep/Bandit findings and pick the one real exploitable flaw.',
      prompt: `Triage this static-analysis finding and decide if it is the real exploitable flaw: ${JSON.stringify(finding)}`,
      model: CLAUDE_MODELS.reasoning, // deep triage per the verified pins
      effort: 'medium',
      tools: ['Read', 'Grep'],
      disallowedTools: ['Bash', 'WebFetch'],
      permissionMode: 'dontAsk',
    },
    backend,
  );

  // GENERATE
  const generated = await generateStub(finding);
  await runStageOrMock(
    'generate',
    'generate',
    {
      ...baseStageOptions(backend),
      prompt: `Generate a harmless PoC exploit payload for ${finding.cveRef} against device-service's POST /device/command (via Bitdeer, model=${BITDEER.model}).`,
      model: CLAUDE_MODELS.mid,
      effort: EXPRESS ? 'low' : 'medium',
      tools: [],
      permissionMode: 'dontAsk',
    },
    backend,
  );

  // DELIVER
  const delivered = await deliverStub();
  await backend.recordExploitRun({
    findingId: finding.id,
    modelId: BITDEER.model,
    payloadRef: generated.payloadRef,
    deliveredAt: Date.now(),
    deviceImpact: delivered.deviceImpact,
    success: delivered.success,
  });
  // One shared device_status row drives the hardware + both dashboards.
  await backend.updateDeviceStatus({
    fanOn: DEVICE_EXPLOITED.fanOn,
    trueHr: DEVICE_EXPLOITED.trueHr,
    trueSpo2: DEVICE_EXPLOITED.trueSpo2,
    reportedHr: DEVICE_EXPLOITED.reportedHr,
    reportedSpo2: DEVICE_EXPLOITED.reportedSpo2,
    alarmActive: DEVICE_EXPLOITED.alarmActive,
    compromised: true,
    lastCommand: DEVICE_EXPLOITED.lastCommand,
  });
  await runStageOrMock(
    'deliver',
    'deliver',
    {
      ...baseStageOptions(backend),
      prompt: `Deliver the exploit payload ${generated.payloadRef} and narrate the device's (lying) response.`,
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

  // PATCH (Factory Droid)
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
    // TODO(dev): write the diff to a blob/file store and reference that path
    // instead of the session id once Dev 3's diff viewer needs a real ref.
    diffRef: droidResult.droidSession,
    droidSession: droidResult.droidSession,
    proposedAt: Date.now(),
    humanApproved: false,
    appliedAt: null,
  });

  // gate -> APPLY
  await runApplyStage(patchAttempt, droidResult, backend);

  // VERIFY
  const verified = await verifyStub();
  await runStageOrMock(
    'verify',
    'verify',
    {
      ...baseStageOptions(backend),
      prompt: `Re-run the exploit against the patched device-service and report whether it now fails: ${verified.detail}`,
      model: CLAUDE_MODELS.reasoning,
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

  // RESTORE
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

// TODO(dev): also pass `hooks: { PreToolUse: [sandboxGuardrailHook(backend)] }`
// into every stage's `runStage()` options above once Dev 2's modules start
// enabling network-capable tools (Bash/WebFetch) - the guardrail is written
// above and ready to attach, left off the read-only stub stages for now so
// the mock-mode run above stays easy to read.

// TODO(dev): once device-service exists, sanity-check captureGitDiff()
// (runDroid.ts) and apply_patch.ts against a real `git -C device-service diff`.

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runPipeline().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[orchestrator] pipeline failed:', err);
    process.exitCode = 1;
  });
}
