// Factory Droid PATCH stage (PLAN-DEV1 task 4). One real `createSession()` +
// `session.stream()` call against the device-service repo, with a
// cached-session fallback for when Droid rate-limits (5h/7d/30d rolling) or
// is offline. Scope is enforced by `device-service/.factory/settings.json`
// (block push/net/sudo) - Dev 2 owns that file; we only point `cwd` there.

import { createSession, DroidMessageType } from '@factory/droid-sdk/node';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RealtimeBackend } from '../realtime/backend';

const execFileAsync = promisify(execFile);

export interface RunDroidOptions {
  /** Absolute path to the device-service repo (its OWN git repo, per
   * PLAN-FOUNDATION, so RESTORE's git-revert never touches other packages). */
  deviceServiceDir: string;
  findingId: number;
  prompt?: string;
}

export interface RunDroidResult {
  droidSession: string;
  diff: string;
  text: string;
  usedFallback: boolean;
}

const DEFAULT_PROMPT =
  'Fix CWE-306 on POST /device/command: require a valid token and ignore untrusted reported_overrides. Edit only app.py.';

/**
 * Cached fallback: capture one real Droid session's streamed text + the
 * resulting `git diff` ahead of the demo, then replay it here if Droid 429s
 * or is offline, so the PATCH -> APPLY -> VERIFY loop still closes live.
 *
 * TODO(dev): record a real session (see examples/node/session-stream.ts in
 * @factory/droid-sdk) and drop its text + diff in here, or load them from
 * `agents/src/factory/cached-patch.json` instead of hardcoding.
 */
const CACHED_FALLBACK: Pick<RunDroidResult, 'droidSession' | 'diff' | 'text'> = {
  droidSession: 'cached-session-TODO',
  text: 'TODO(dev): paste the cached Droid session transcript here.',
  diff: `--- a/app.py
+++ b/app.py
@@ -1,3 +1,3 @@
-# TODO(dev): replace with the real cached git diff from a recorded Droid run
+# TODO(dev): replace with the real cached git diff from a recorded Droid run
`,
};

function looksLikeRateLimit(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /429|rate.?limit/i.test(message);
}

/**
 * Runs the real Droid session when possible; falls back to the cached diff
 * on a 429/offline error so the demo loop never stalls. Always hands off to
 * Dev 2's verifier afterward - a finished Droid run is NOT the same as a
 * verified fix.
 */
export async function runDroid(
  opts: RunDroidOptions,
  backend: RealtimeBackend,
): Promise<RunDroidResult> {
  const prompt = opts.prompt ?? DEFAULT_PROMPT;

  try {
    const session = await createSession({ cwd: opts.deviceServiceDir });
    let text = '';

    try {
      for await (const msg of session.stream(prompt)) {
        if (msg.type === DroidMessageType.Assistant) {
          text += msg.text;
          await backend.updateAgentStatus('patch', 'patch', 'running', text);
        }
        if (msg.type === DroidMessageType.Result && !msg.success) {
          throw new Error(msg.error?.message ?? `Droid turn ended: ${msg.subtype}`);
        }
      }
    } finally {
      await session.close();
    }

    const diff = await captureGitDiff(opts.deviceServiceDir);
    await backend.updateAgentStatus('patch', 'patch', 'done', text);

    return { droidSession: session.id, diff, text, usedFallback: false };
  } catch (err) {
    if (!looksLikeRateLimit(err)) throw err;

    await backend.logEvent(
      'patch',
      `Droid unavailable (${err instanceof Error ? err.message : String(err)}) - replaying cached session`,
    );
    await backend.updateAgentStatus('patch', 'patch', 'done', CACHED_FALLBACK.text);

    return { ...CACHED_FALLBACK, usedFallback: true };
  }
}

/** The git diff artifact `recordPatchAttempt`'s `diffRef` points to. */
async function captureGitDiff(deviceServiceDir: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', deviceServiceDir, 'diff'], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

// TODO(dev): daemon option - if the web app should drive Droid directly
// instead of through this Node process, run `droid daemon --port N` and
// `connectToDaemon({ url, auth })` from @factory/droid-sdk/node. Never put
// FACTORY_API_KEY in public web code; this module reads it only from
// process.env via createSession()'s default `apiKey: process.env.FACTORY_API_KEY`.
