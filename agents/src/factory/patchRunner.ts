// Standalone PATCH-stage producer (blueprint §6a). ONE spawned Node process:
//   writer stream -> git diff -> reviewer stream -> verdict -> `done`, then exit.
// It writes ONLY the frozen JSONL event contract (§1) to stdout, one JSON
// object per line; all logs/diagnostics go to stderr. The Python portal
// (§4c) relays each stdout line verbatim as an SSE event and synthesizes the
// human-gate / verify tail.
//
// Invoked by the portal as:
//   node node_modules/tsx/dist/cli.mjs src/factory/patchRunner.ts <device-service-dir>
//
// No-key / rate-limited / offline -> it replays cached-patch.json with the
// IDENTICAL JSONL shape (§1 "Fallback parity"), so the SSE stream looks the
// same whether live or replayed.
//
// NOTE (blueprint §0 item 6): the `!success -> throw -> cache fallback` landmine
// lives in runDroid.ts:228-230 and is used by orchestrator.ts. Removing it there
// would change that exported path's behavior, so per the task's risk guidance it
// is left intact in runDroid() and the no-throw / diff-regardless logic is
// implemented HERE instead: this runner captures the git diff regardless of
// `result.success`, uses it when non-empty, and only replays the cache on a
// transient (connection/rate-limit) error or an empty diff with a transient
// error. A permission (Droid-Shield) denial therefore never forces a fallback.

import '../env'; // loads repo-root .env BEFORE the SDK reads FACTORY_API_KEY

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DroidMessageType, createSession } from '@factory/droid-sdk/node';
import type { DroidResultMessage } from '@factory/droid-sdk/node';

import {
  DEFAULT_PROMPT as WRITER_PROMPT,
  buildSessionOptions,
  captureGitDiff,
  loadCachedPatch,
  shouldFallback,
} from './runDroid';
import { emitReviewerFallback, parseDiffFiles, runReviewer } from './runReviewer';
import type { RunnerIO } from './runReviewer';

/** Emit one JSONL line to stdout (atomic write). Logs go to stderr. */
const io: RunnerIO = {
  emit: (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`),
  log: (msg) => process.stderr.write(`[patchRunner] ${msg}\n`),
};

/** Best-effort file hint for a `writer_tool` event (e.g. the edited path). */
function toolDetail(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const rec = input as Record<string, unknown>;
  for (const key of ['path', 'file_path', 'filePath', 'filename', 'file']) {
    const v = rec[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}

/** No-key / unavailable path: replay the cached patch with the frozen shape. */
function replayFallback(start: number): void {
  const cached = loadCachedPatch();
  io.emit({
    type: 'writer_started',
    ts: Date.now(),
    sessionId: cached.droidSession,
    model: 'cached',
    usedFallback: true,
  });
  if (cached.text) {
    io.emit({ type: 'writer_delta', ts: Date.now(), channel: 'text', text: cached.text });
  }
  io.emit({
    type: 'diff',
    ts: Date.now(),
    empty: cached.diff.trim() === '',
    files: parseDiffFiles(cached.diff),
    diff: cached.diff,
  });
  emitReviewerFallback(io, cached.diff);
  io.emit({ type: 'done', ts: Date.now(), success: true, subtype: 'success', durationMs: Date.now() - start });
}

/** Live writer session: stream the frozen writer JSONL and return the captured
 * diff + the terminal result. Never throws on `!success` (see module note). */
async function runWriter(
  deviceServiceDir: string,
  modelId: string | undefined,
): Promise<{ diff: string; result: DroidResultMessage | null }> {
  const session = await createSession(
    buildSessionOptions(deviceServiceDir, undefined, {
      modelId,
      onBlock: (b) => io.emit({ type: 'shield_blocked', ts: Date.now(), ...b }),
    }),
  );
  io.emit({
    type: 'writer_started',
    ts: Date.now(),
    sessionId: session.id,
    model: modelId ?? 'droid-default',
    usedFallback: false,
  });

  let result: DroidResultMessage | null = null;
  let creditsEmitted = false;
  try {
    for await (const ev of session.stream(WRITER_PROMPT, { includePartialMessages: true })) {
      switch (ev.type) {
        case DroidMessageType.AssistantTextDelta:
          io.emit({ type: 'writer_delta', ts: Date.now(), channel: 'text', text: ev.text });
          break;
        case DroidMessageType.ThinkingTextDelta:
          io.emit({ type: 'writer_delta', ts: Date.now(), channel: 'thinking', text: ev.text });
          break;
        case DroidMessageType.ToolCall:
          io.emit({
            type: 'writer_tool',
            ts: Date.now(),
            phase: 'call',
            name: ev.name,
            toolUseId: ev.toolUseId,
            detail: toolDetail(ev.input),
          });
          break;
        case DroidMessageType.ToolProgress:
          io.emit({
            type: 'writer_tool',
            ts: Date.now(),
            phase: 'progress',
            name: ev.toolName,
            toolUseId: ev.toolUseId,
            detail: ev.content,
          });
          break;
        case DroidMessageType.TokenUsageUpdate:
          creditsEmitted = true;
          io.emit({
            type: 'credits',
            ts: Date.now(),
            factoryCredits: ev.factoryCredits,
            inputTokens: ev.inputTokens,
            outputTokens: ev.outputTokens,
            thinkingTokens: ev.thinkingTokens,
          });
          break;
        case DroidMessageType.Result:
          result = ev;
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

  // Final credits from the terminal result if no incremental update arrived.
  if (!creditsEmitted && result?.tokenUsage) {
    const u = result.tokenUsage;
    io.emit({
      type: 'credits',
      ts: Date.now(),
      factoryCredits: u.factoryCredits,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      thinkingTokens: u.thinkingTokens,
    });
  }

  // Capture the diff REGARDLESS of result.success (blueprint §0 item 6).
  const diff = await captureGitDiff(deviceServiceDir);
  io.emit({
    type: 'diff',
    ts: Date.now(),
    empty: diff.trim() === '',
    files: parseDiffFiles(diff),
    diff,
  });
  return { diff, result };
}

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // argv[2] = device-service dir; default to repo-root device-service.
  const deviceServiceDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(here, '../../../device-service');
  const modelId = process.env.FACTORY_DROID_MODEL;
  const start = Date.now();

  // No key -> straight to the cached replay (don't even try to connect).
  if (!process.env.FACTORY_API_KEY) {
    io.log('No FACTORY_API_KEY; replaying cached patch (identical JSONL shape).');
    replayFallback(start);
    return;
  }

  try {
    const { diff, result } = await runWriter(deviceServiceDir, modelId);

    // Diff-regardless: a non-empty diff means Droid did real work even if the
    // turn reported !success (e.g. a Droid-Shield denial). Only fall back to the
    // cache when the diff is empty AND the turn failed transiently.
    if (diff.trim() === '' && result && !result.success) {
      const reason = result.error?.message ?? `turn ended: ${result.subtype}`;
      if (shouldFallback(new Error(reason))) {
        io.log(`empty diff + transient failure (${reason}); replaying cached reviewer+diff.`);
        emitReviewerFallback(io, loadCachedPatch().diff);
        io.emit({ type: 'done', ts: Date.now(), success: true, subtype: 'success', durationMs: Date.now() - start });
        return;
      }
    }

    await runReviewer(deviceServiceDir, diff, io, { modelId });

    const success = result?.success ?? true;
    io.emit({
      type: 'done',
      ts: Date.now(),
      success,
      subtype: result?.subtype ?? 'success',
      durationMs: Date.now() - start,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Transient (connection/rate-limit/offline) -> keep the loop closing by
    // replaying the cached patch with the frozen shape. Anything else is a hard
    // error and surfaces as the terminal `error` event.
    if (shouldFallback(err)) {
      io.log(`transient failure (${message}); replaying cached patch.`);
      replayFallback(start);
      return;
    }
    io.emit({ type: 'error', ts: Date.now(), message });
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    io.emit({
      type: 'error',
      ts: Date.now(),
      message: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  });
}
