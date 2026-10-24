// Recorder for the Factory Droid cached fallback (PLAN-DEV1 task 4).
//
// Runs ONE real, scoped Droid session against device-service (reusing the
// exact scoped options runDroid() uses - `buildSessionOptions`), captures the
// streamed output + the resulting `git diff`, and writes cached-patch.json so
// runDroid() can replay it whenever Droid is rate-limited / offline / keyless.
//
// Run with:  tsx src/factory/record.ts   (with FACTORY_API_KEY set)

import '../env'; // loads repo-root .env BEFORE the SDK reads FACTORY_API_KEY

import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { DroidMessageType, createSession } from '@factory/droid-sdk/node';

import { buildSessionOptions, toApplicableDiff } from './runDroid';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PROMPT =
  'Fix CWE-306 on POST /device/command: require a valid token and ignore untrusted reported_overrides. Edit only app.py.';

async function captureGitDiff(deviceServiceDir: string): Promise<string> {
  // --relative + the `.` pathspec scope the diff to device-service and emit
  // device-service-RELATIVE paths (a/app.py), so the recorded fallback applies
  // under `git -C device-service apply` (-p1) and excludes unrelated repo files
  // (device-service shares the monorepo git repo, so a bare diff is repo-wide).
  const { stdout } = await execFileAsync(
    'git',
    ['-C', deviceServiceDir, 'diff', '--relative', '--', '.'],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  // Strip git-header lines so the recorded diff applies via `git apply` (see
  // toApplicableDiff) instead of being silently skipped.
  return toApplicableDiff(stdout);
}

async function main(): Promise<void> {
  // agents/src/factory -> agents/src -> agents -> repo root -> device-service.
  const deviceServiceDir = path.resolve(here, '../../../device-service');
  const prompt = process.argv.slice(2).join(' ') || DEFAULT_PROMPT;

  if (!process.env.FACTORY_API_KEY) {
    throw new Error('FACTORY_API_KEY is required to record a real Droid session.');
  }

  // Same scoped options as the live path: cwd=device-service, autonomyLevel
  // Low, deny-by-default permissionHandler (logs to the console here).
  const session = await createSession(buildSessionOptions(deviceServiceDir));
  let text = '';

  try {
    for await (const ev of session.stream(prompt, { includePartialMessages: true })) {
      if (ev.type === DroidMessageType.AssistantTextDelta) {
        text += ev.text;
        process.stdout.write(ev.text);
      } else if (ev.type === DroidMessageType.ToolCall) {
        // eslint-disable-next-line no-console
        console.log(`\n[tool] ${ev.name}`);
      } else if (ev.type === DroidMessageType.Error) {
        throw new Error(ev.message);
      } else if (ev.type === DroidMessageType.Result && !ev.success) {
        throw new Error(ev.error?.message ?? `Droid turn ended: ${ev.subtype}`);
      }
    }
  } finally {
    await session.close();
  }

  const diff = await captureGitDiff(deviceServiceDir);
  const out = { droidSession: session.id, text, diff };
  const jsonPath = path.join(here, 'cached-patch.json');
  writeFileSync(jsonPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`\nWrote ${jsonPath} (${diff.length} bytes of diff).`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[record] failed:', err);
    process.exitCode = 1;
  });
}
