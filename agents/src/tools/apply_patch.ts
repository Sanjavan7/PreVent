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
      const dir = await mkdtemp(path.join(tmpdir(), 'prevent-patch-'));
      const diffPath = path.join(dir, 'patch.diff');
      await writeFile(diffPath, deps.diff, 'utf8');

      // TODO(dev): `git apply --check` first and surface a structured error
      // back to Claude (isError: true) instead of throwing, so a malformed
      // cached-fallback diff doesn't crash the whole orchestrator run.
      await execFileAsync('git', ['-C', deps.deviceServiceDir, 'apply', diffPath]);
      applied = true;

      return { content: [{ type: 'text' as const, text: 'Patch applied to device-service.' }] };
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
