// The APPLY stage's gated tool (PLAN-DEV1 task 3). Deliberately NOT added to
// `allowedTools` by runStage.ts, and the APPLY stage runs
// `permissionMode:'default'` with `canUseTool` set to humanGate.ts's
// callback, so every call sits behind the dashboard's APPROVE click.

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

/** Runs `git -C <dir> apply <args>` and reports ok/stderr instead of throwing,
 * so the caller can decide (forward-apply vs already-applied vs real failure). */
async function gitApplyOk(dir: string, args: string[]): Promise<{ ok: boolean; stderr: string }> {
  try {
    await execFileAsync('git', ['-C', dir, 'apply', ...args]);
    return { ok: true, stderr: '' };
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? (err instanceof Error ? err.message : String(err));
    return { ok: false, stderr };
  }
}

export interface ApplyPatchDeps {
  /** The device-service repo's own git repo (see PLAN-FOUNDATION). */
  deviceServiceDir: string;
  /** The diff `runDroid()` captured (or the cached fallback's diff). */
  diff: string;
}

/**
 * Builds the `apply_patch` MCP server for one PATCH -> APPLY cycle. The tool
 * itself has no opinion about approval - `canUseTool` (humanGate.ts) is what
 * makes this gated; the handler below only runs once that callback resolves
 * `{ behavior: 'allow' }`.
 */
export function createApplyPatchServer(deps: ApplyPatchDeps) {
  let applied = false;

  const applyPatch = tool(
    'apply_patch',
    'Apply the proposed git diff to the device-service repo. Only callable after human approval.',
    {
      confirm: z
        .literal(true)
        .describe('Must be true. This call only runs once the human-approval gate has allowed it.'),
    },
    async () => {
      // An empty diff (e.g. the corrupt-cache no-op fallback) is a success no-op.
      if (!deps.diff.trim()) {
        applied = true;
        return { content: [{ type: 'text' as const, text: 'No diff to apply (no-op).' }] };
      }

      const dir = await mkdtemp(path.join(tmpdir(), 'prevent-patch-'));
      const diffPath = path.join(dir, 'patch.diff');
      await writeFile(diffPath, deps.diff, 'utf8');

      // Prefer a clean forward apply (cached-fallback path: clean tree).
      const forward = await gitApplyOk(deps.deviceServiceDir, ['--check', diffPath]);
      if (forward.ok) {
        await execFileAsync('git', ['-C', deps.deviceServiceDir, 'apply', diffPath]);
        applied = true;
        return { content: [{ type: 'text' as const, text: 'Patch applied to device-service.' }] };
      }

      // Forward failed: the patch may ALREADY be in the tree (a real Droid run
      // at AutonomyLevel.Low edits app.py directly). A clean reverse-check
      // proves that - treat it as an applied no-op rather than re-applying.
      const reverse = await gitApplyOk(deps.deviceServiceDir, ['--reverse', '--check', diffPath]);
      if (reverse.ok) {
        applied = true;
        return { content: [{ type: 'text' as const, text: 'Patch already present in device-service (no-op).' }] };
      }

      // Neither forward nor reverse applies: surface a STRUCTURED error instead
      // of throwing, so a bad diff degrades the APPLY stage (and the loop)
      // rather than crashing the whole orchestrator run.
      return {
        isError: true,
        content: [
          { type: 'text' as const, text: `git apply failed: ${forward.stderr || 'patch does not apply'}` },
        ],
      };
    },
    { annotations: { destructiveHint: true, idempotentHint: false } },
  );

  const server = createSdkMcpServer({
    name: 'apply_patch',
    version: '1.0.0',
    tools: [applyPatch],
  });

  return { server, wasApplied: (): boolean => applied };
}
