// Agent SDK stage runner (PLAN-DEV1 task 1). One top-level `query()` per
// stage: subagent deltas are NOT forwarded through includePartialMessages, so
// every stage MUST stay a single top-level query with no nested subagents.
//
// Scope is `options.tools` (availability) + `options.disallowedTools`, never
// `allowedTools` — `allowedTools` only auto-approves permission prompts, it
// does not remove a tool from Claude's context. See PLAN-DEV1 verified pins.

import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  CanUseTool,
  HookCallbackMatcher,
  HookEvent,
  McpServerConfig,
  Options,
  PermissionMode,
} from '@anthropic-ai/claude-agent-sdk';
import type { Stage } from '@prevent/contracts';
import { CLAUDE_MODELS } from '@prevent/contracts';
import { createReportDecisionServer, type DecisionResult } from '../tools/report_decision';
import type { RealtimeBackend } from '../realtime/backend';

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface RunStageOptions {
  /** Stage system prompt. Dev 2's security/ground/scan/etc modules own this text. */
  systemPrompt?: string;
  /** The single user turn for this stage's query(). */
  prompt: string;
  /** Availability allowlist for BUILT-IN tools (not MCP tools, which are
   * unaffected by this field). `[]` removes every built-in. */
  tools?: string[];
  /** Bare names remove a tool from context entirely; scoped rules (e.g.
   * "Bash(rm *)") deny only matching calls while leaving the tool visible. */
  disallowedTools?: string[];
  /** 'default' + canUseTool is how the human-approval gate (humanGate.ts)
   * intercepts the APPLY stage's patch tool. 'dontAsk' for read-only stages. */
  permissionMode?: PermissionMode;
  /** Defaults to CLAUDE_MODELS.mid; GROUND/cheap narration should pass
   * CLAUDE_MODELS.cheap, deep triage (SCAN/VERIFY) should pass .reasoning. */
  model?: string;
  /** claude-opus-5-5 defaults to 'medium' and can't disable thinking -
   * pass 'low' explicitly for cheap calls per the verified pins. */
  effort?: EffortLevel;
  /** Required for the APPLY stage's human-approval gate; awaits indefinitely
   * until the dashboard resolves it. See humanGate.ts. */
  canUseTool?: CanUseTool;
  maxTurns?: number;
  maxBudgetUsd?: number;
  /** Extra in-process MCP servers beyond the always-on `report_decision`
   * server, e.g. the APPLY stage's gated `apply_patch` tool. */
  extraMcpServers?: Record<string, McpServerConfig>;
  /** Lifecycle hooks for this stage's query(), e.g. the PreToolUse sandbox
   * guardrail that denies out-of-allowlist tool calls (the refusal beat). */
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
}

export interface StageResult {
  /** Full accumulated text_delta stream for this stage. */
  text: string;
  /** The report_decision tool's payload, if the model called it. */
  decision?: DecisionResult;
}

/**
 * Runs exactly one stage of the pipeline as a single top-level `query()`,
 * streaming `text_delta`s into `backend.updateAgentStatus` as they arrive and
 * resolving once the query's async generator is exhausted.
 *
 * Dev 2's stage modules (ground/scan/generate/deliver/verify) call this with
 * their own prompt + tool scope and consume the returned `StageResult`
 * (parsing `text` as needed, or reading `decision` for confidence/uncertainty).
 */
export async function runStage(
  agentName: string,
  stage: Stage,
  opts: RunStageOptions,
  backend: RealtimeBackend,
): Promise<StageResult> {
  const { server: reportDecisionServer, getDecision } = createReportDecisionServer();

  let reasoning = '';
  await backend.updateAgentStatus(agentName, stage, 'running', reasoning);

  const options: Options = {
    systemPrompt: opts.systemPrompt,
    // Never let this laptop's CLAUDE.md / hooks / settings.json leak into a
    // stage run - every stage is a clean, scoped process identity.
    settingSources: [],
    includePartialMessages: true,
    permissionMode: opts.permissionMode ?? 'default',
    model: opts.model ?? CLAUDE_MODELS.mid,
    effort: opts.effort ?? 'medium',
    tools: opts.tools,
    disallowedTools: opts.disallowedTools,
    mcpServers: { report_decision: reportDecisionServer, ...opts.extraMcpServers },
    // report_decision is OUR trusted internal tool (confidence/uncertainty
    // only, no side effects) - always pre-approved regardless of stage scope.
    // This is a permission allowlist, not an availability scope, so it does
    // not violate the tools/disallowedTools-for-scope rule above.
    allowedTools: ['mcp__report_decision__report_decision'],
    canUseTool: opts.canUseTool,
    maxTurns: opts.maxTurns,
    maxBudgetUsd: opts.maxBudgetUsd,
    hooks: opts.hooks,
  };

  try {
    for await (const message of query({ prompt: opts.prompt, options })) {
      if (message.type === 'stream_event') {
        const event = message.event;
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          reasoning += event.delta.text;
          await backend.updateAgentStatus(agentName, stage, 'running', reasoning);
        }
      }
      // TODO(dev): branch on message.type === 'system' (subtype 'init') to
      // confirm mcp__report_decision__* actually connected, and on
      // message.type === 'result' to log cost/turns/duration to event_log.
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await backend.updateAgentStatus(agentName, stage, 'error', reasoning);
    await backend.logEvent(agentName, `stage ${stage} failed: ${message}`);
    throw err;
  }

  const decision = getDecision();
  await backend.updateAgentStatus(agentName, stage, 'done', reasoning, decision);

  return { text: reasoning, decision };
}
