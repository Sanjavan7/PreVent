// Factory Droid PATCH stage (PLAN-DEV1 task 4). One real `createSession()` +
// `session.stream()` call against the device-service repo, streamed token by
// token into the dashboard, with a cached-session fallback for when Droid
// rate-limits (5h/7d/30d rolling), is offline, or no key is present.
//
// SCOPE (PLAN-DEV1 task 4 - prove Droid cannot commit/push/deploy):
//   Droid runs at `autonomyLevel: AutonomyLevel.Low`. At Low the SDK
//   auto-approves file edits + read-only commands (so Droid can still edit
//   app.py) and routes EVERY mutating/shell command to `permissionHandler`,
//   which is DENY-BY-DEFAULT here. The scoping is enforced in-process by the
//   autonomy level + handler, NOT by device-service/.factory/settings.json:
//   that file's permissionRules are INERT (workspace-untrusted; the SDK never
//   reads them) and must not be relied on.

import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  AutonomyLevel,
  DroidMessageType,
  ToolConfirmationOutcome,
  ToolConfirmationType,
  createSession,
} from '@factory/droid-sdk/node';
import type {
  CreateSessionOptions,
  RequestPermissionHandlerResult,
  RequestPermissionRequestParams,
} from '@factory/droid-sdk/node';

import type { RealtimeBackend } from '../realtime/backend';

const execFileAsync = promisify(execFile);

export interface RunDroidOptions {
  /** Absolute path to the device-service repo. RESTORE's git-revert runs
   * against this directory, so Droid's `cwd` points here too. */
  deviceServiceDir: string;
  findingId: number;
  prompt?: string;
}

export interface RunDroidResult {
  droidSession: string;
  diff: string;
  text: string;
  usedFallback: boolean;
  /** Whether the real Droid turn reported success (absent on the fallback). */
  success?: boolean;
  /** The final `result` event's subtype, when a real turn produced one. */
  subtype?: string;
}

const DEFAULT_PROMPT =
  'Fix CWE-306 on POST /device/command: require a valid token and ignore untrusted reported_overrides. Edit only app.py.';

/** Shape of `cached-patch.json` (loaded at runtime, see `loadCachedPatch`). */
interface CachedPatch {
  droidSession: string;
  text: string;
  diff: string;
}

/** Command families Droid must never run in this demo. We DENY every command
 * that reaches the handler regardless; matching one of these just makes the
 * refusal log loud and specific (the rehearsed "it cannot ship code" beat). */
const FORBIDDEN_COMMAND_RE =
  /\b(git|push|commit|remote|config|clone|deploy|curl|wget|ssh|scp|nc|sudo)\b/i;

/** Broadened fallback matcher (PLAN-DEV1 task 4 - the loop must ALWAYS close):
 * rate limits, offline/DNS/connection failures, missing binaries, permission
 * errors - anything that means "Droid is not usable right now". */
function shouldFallback(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /429|rate.?limit|ENOENT|not found|ECONN|ETIMEDOUT|offline|spawn|EACCES/i.test(message);
}

/** Logs through the backend when available, else to the console (so the
 * standalone recorder can reuse the scoped options without a backend). */
async function scopeLog(backend: RealtimeBackend | undefined, text: string): Promise<void> {
  if (backend) {
    await backend.logEvent('patch', text);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[patch] ${text}`);
}

/**
 * DENY-BY-DEFAULT permission handler. At `AutonomyLevel.Low` safe edits +
 * read-only commands are auto-approved and never reach this handler, so Droid
 * can still edit app.py; everything mutating/shell routes here and is always
 * cancelled. A thrown handler also defaults to Cancel, so we fail closed.
 */
function makePermissionHandler(backend?: RealtimeBackend) {
  return async (params: RequestPermissionRequestParams): Promise<RequestPermissionHandlerResult> => {
    try {
      for (const tu of params.toolUses) {
        const details = tu.details;
        let label: string;
        if (details.type === ToolConfirmationType.Execute) {
          const extracted = details.extractedCommands ?? [];
          const command = details.fullCommand || details.command || extracted.join(' ');
          const haystack = `${details.fullCommand} ${details.command} ${extracted.join(' ')}`;
          label = FORBIDDEN_COMMAND_RE.test(haystack)
            ? `${command} [forbidden: git/push/commit/remote/config/clone/deploy/curl/wget/ssh/scp/nc/sudo]`
            : command;
        } else {
          label = tu.toolUse.name;
        }
        await scopeLog(backend, `Droid command blocked by scope: ${label}`);
      }
    } catch {
      return ToolConfirmationOutcome.Cancel;
    }
    return ToolConfirmationOutcome.Cancel;
  };
}

/**
 * The scoped `createSession` options (PLAN-DEV1 task 4). Reused by the
 * recorder (`record.ts`) so the recorded session is scoped identically to the
 * live one. `cwd` points at device-service; `autonomyLevel: Low` +
 * `permissionHandler` is the real, trust-independent scoping.
 */
export function buildSessionOptions(
  deviceServiceDir: string,
  backend?: RealtimeBackend,
): CreateSessionOptions {
  return {
    cwd: deviceServiceDir,
    autonomyLevel: AutonomyLevel.Low,
    permissionHandler: makePermissionHandler(backend),
  };
}

/** Loads the pre-recorded fallback patch next to this module. Uses
 * `readFileSync` relative to `import.meta.url` rather than a JSON import
 * assertion, which is brittle under tsx/ESM. */
function loadCachedPatch(): CachedPatch {
  const jsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cached-patch.json');
  return JSON.parse(readFileSync(jsonPath, 'utf8')) as CachedPatch;
}

/** Replays the cached patch so the PATCH -> APPLY -> VERIFY loop always closes. */
async function returnCachedFallback(backend: RealtimeBackend): Promise<RunDroidResult> {
  try {
    const cached = loadCachedPatch();
    await backend.updateAgentStatus('patch', 'patch', 'done', cached.text);
    return { ...cached, usedFallback: true };
  } catch (err) {
    // A missing / truncated / corrupt cached-patch.json must still NOT break
    // the loop (PLAN-DEV1: the loop must ALWAYS close). Degrade to an empty
    // no-op diff; apply_patch treats "" as a success no-op and VERIFY then
    // legitimately reports the hole is still open rather than the run crashing.
    const message = err instanceof Error ? err.message : String(err);
    await backend.logEvent('patch', `cached-patch.json unavailable (${message}); using empty no-op fallback.`);
    const text = 'Cached patch unavailable - no diff applied (loop kept alive).';
    await backend.updateAgentStatus('patch', 'patch', 'done', text);
    return { droidSession: 'cached-unavailable', diff: '', text, usedFallback: true };
  }
}

/**
 * Runs the real scoped Droid session, streaming tokens live into the
 * dashboard; falls back to the cached diff whenever Droid is unavailable so
 * the demo loop never stalls. A finished Droid run is NOT the same as a
 * verified fix - the orchestrator still hands off to VERIFY afterward.
 */
export async function runDroid(
  opts: RunDroidOptions,
  backend: RealtimeBackend,
): Promise<RunDroidResult> {
  const prompt = opts.prompt ?? DEFAULT_PROMPT;

  // No key -> skip straight to the cached patch (don't even try to connect).
  if (!process.env.FACTORY_API_KEY) {
    await backend.logEvent('patch', 'No FACTORY_API_KEY, using cached patch.');
    return returnCachedFallback(backend);
  }

  try {
    const session = await createSession(buildSessionOptions(opts.deviceServiceDir, backend));
    let output = ''; // Droid's visible output (typewriter)
    let thinking = ''; // Droid's reasoning stream
    let success = true;
    let subtype: string | undefined;
    let resultError: string | null = null;

    try {
      // includePartialMessages:true yields token-level DroidStreamEvents.
      for await (const ev of session.stream(prompt, { includePartialMessages: true })) {
        switch (ev.type) {
          case DroidMessageType.AssistantTextDelta:
            output += ev.text;
            await backend.updateAgentStatus('patch', 'patch', 'running', output);
            break;
          case DroidMessageType.ThinkingTextDelta:
            thinking += ev.text;
            await backend.updateAgentStatus(
              'patch',
              'patch',
              'running',
              thinking ? `${output}\n\n[thinking] ${thinking}` : output,
            );
            break;
          case DroidMessageType.ToolCall:
            await backend.logEvent('patch', `Droid tool: ${ev.name}`);
            break;
          case DroidMessageType.Result:
            success = ev.success;
            subtype = ev.subtype;
            resultError = ev.error?.message ?? null;
            break;
          case DroidMessageType.Error:
            throw new Error(ev.message);
          default:
            break;
        }
      }
    } finally {
      await session.close();
    }

    if (!success) {
      throw new Error(resultError ?? `Droid turn ended: ${subtype ?? 'unknown'}`);
    }

    const diff = await captureGitDiff(opts.deviceServiceDir);
    await backend.updateAgentStatus('patch', 'patch', 'done', output);

    return { droidSession: session.id, diff, text: output, usedFallback: false, success, subtype };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const kind = shouldFallback(err) ? 'expected transient failure' : 'unexpected error';
    await backend.logEvent('patch', `[patch] Droid unavailable (${kind}): ${message} - replaying cached patch`);
    return returnCachedFallback(backend);
  }
}

/** The git diff artifact `recordPatchAttempt`'s `diffRef` points to. */
async function captureGitDiff(deviceServiceDir: string): Promise<string> {
  // --relative + the `.` pathspec scope the diff to device-service and emit
  // device-service-RELATIVE paths (a/app.py, not a/device-service/app.py), so
  // the captured diff applies under `git -C device-service apply` (-p1) and
  // never pulls in unrelated monorepo files (device-service shares the repo).
  const { stdout } = await execFileAsync(
    'git',
    ['-C', deviceServiceDir, 'diff', '--relative', '--', '.'],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  return toApplicableDiff(stdout);
}

/**
 * Strip the `diff --git`/`index` git-header lines, leaving a PLAIN unified diff
 * (`--- a/f` / `+++ b/f` / hunks). This is REQUIRED: `git -C device-service
 * apply` resolves `diff --git a/app.py` against the repo TOP-LEVEL (-> repo-root
 * app.py, which does not exist) and silently SKIPS the patch (exit 0, no change).
 * A plain diff makes git resolve paths relative to cwd (device-service) and
 * apply correctly. apply_patch.ts and the cached fallback both depend on this.
 */
export function toApplicableDiff(gitDiff: string): string {
  return gitDiff
    .split('\n')
    .filter((line) => !line.startsWith('diff --git ') && !line.startsWith('index '))
    .join('\n');
}

// TODO(dev): daemon option - if the web app should drive Droid directly
// instead of through this Node process, run `droid daemon --port N` and
// `connectToDaemon({ url, auth })` from @factory/droid-sdk/node. Never put
// FACTORY_API_KEY in public web code; this module reads it only from
// process.env via createSession()'s default `apiKey: process.env.FACTORY_API_KEY`.
