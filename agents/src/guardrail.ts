// Separation-of-duties PreToolUse sandbox guardrail (PLAN-DEV1 task 2). Moved
// out of the orchestrator into a leaf module so every stage can attach the same
// hook, and corrected to also surface the refusal on the dashboard via an
// agent_status error card (the scripted "refusal" beat: a reach at a second
// ventilator outside SANDBOX_ALLOWLIST is denied and shown).
//
// ESM, bundler resolution (no file extensions). Type-only imports use
// `import type` per verbatimModuleSyntax.

import type {
  HookCallback,
  HookCallbackMatcher,
  HookJSONOutput,
  PreToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import type { RealtimeBackend } from './realtime/backend';
import { ACTION_REFUSED_PREFIX, GUARDRAIL_AGENT, SANDBOX_ALLOWLIST } from './constants';

/**
 * Extracts every unique `http(s)://host` hostname referenced anywhere in a
 * tool-call input by JSON-stringifying it and regex-matching URLs.
 */
export function extractHosts(value: unknown): string[] {
  const text = JSON.stringify(value ?? '');
  const matches = text.match(/https?:\/\/([a-zA-Z0-9.-]+)/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/^https?:\/\//, '')))];
}

/**
 * A PreToolUse hook that denies any tool call whose input targets a host
 * outside `SANDBOX_ALLOWLIST`, emits a visible refusal event, and flips the
 * guardrail's agent_status card to `error` with the same refusal text so the
 * dashboard renders the refusal. This is a scripted, rehearsed demo beat
 * proving enforcement is real.
 */
export function sandboxGuardrailHook(
  backend: RealtimeBackend,
  /** Called whenever the hook actually DENIES a call. Lets the refusal beat
   * confirm it fired (and backstop it deterministically if it did not). */
  onRefuse?: () => void,
): HookCallbackMatcher {
  const hook: HookCallback = async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const preToolInput = input as PreToolUseHookInput;

    const hosts = extractHosts(preToolInput.tool_input);
    const blocked = hosts.filter((h) => !SANDBOX_ALLOWLIST.includes(h));
    if (blocked.length === 0) return {};

    const refusal = `${ACTION_REFUSED_PREFIX}: ${preToolInput.tool_name} targeted ${blocked.join(', ')} (not in SANDBOX_ALLOWLIST)`;
    await backend.logEvent(GUARDRAIL_AGENT, refusal);
    // The Stage union has no `guardrail` member, so reuse the neutral existing
    // 'scan' Stage for the status card. 'error' state renders the refusal.
    await backend.updateAgentStatus(GUARDRAIL_AGENT, 'scan', 'error', refusal);
    onRefuse?.();

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
