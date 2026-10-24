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
  /** When set, the stage requests native structured output (SDK 0.3.310
   * `options.outputFormat = { type: 'json_schema', schema }`) and the validated
   * object is returned as `StageResult.structuredOutput`. Plain JSON Schema. */
  outputSchema?: Record<string, unknown>;
  /** If the query throws and this differs from the model actually used, the
   * whole query is retried ONCE with `options.model = fallbackModel`. */
  fallbackModel?: string;
}

export interface StageResult {
  /** Full accumulated text_delta stream for this stage. */
  text: string;
  /** Full accumulated thinking_delta stream (Opus adaptive thinking), if any. */
  thinking?: string;
  /** The report_decision tool's payload, if the model called it. */
  decision?: DecisionResult;
  /** The validated structured-output object, present when `outputSchema` was set
   * and the success result carried a `structured_output` attachment. */
  structuredOutput?: unknown;
  /** Cost/turn/duration accounting captured from the success result message. */
  timing?: {
    durationMs?: number;
    apiMs?: number;
    numTurns?: number;
    costUsd?: number;
  };
}

/**
 * Runs exactly one stage of the pipeline as a single top-level `query()`,
 * streaming `text_delta`s (and, separately, `thinking_delta`s) into
 * `backend.updateAgentStatus` as they arrive and resolving once the query's
 * async generator is exhausted.
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
  // Two separate buffers so the dashboard can show the model THINKING first,
  // then ANSWERING (the Anthropic visible-reasoning beat). `reasoning` sent to
  // the backend is the thinking block followed by the output block.
  let output = '';
  let thinking = '';
  const compose = (): string => (thinking ? thinking + '\n\n' : '') + output;

  await backend.updateAgentStatus(agentName, stage, 'running', compose());

  const permissionMode: PermissionMode = opts.permissionMode ?? 'default';

  // dontAsk GOTCHA: permissionMode 'dontAsk' NEVER calls canUseTool and DENIES
  // anything not pre-approved in allowedTools; combined with settingSources:[]
  // (which strips all permission rules), built-ins made available via
  // options.tools (e.g. Read/Grep for SCAN) would be denied. So under dontAsk
  // we auto-approve those made-available built-ins too. Under 'default' we do
  // NOT auto-approve them — that would defeat the human-approval gate.
  const allowedTools =
    permissionMode === 'dontAsk'
      ? ['mcp__report_decision__report_decision', ...(opts.tools ?? [])]
      : ['mcp__report_decision__report_decision'];

  let decision: DecisionResult | undefined;
  let structuredOutput: unknown;
  let timing: StageResult['timing'];

  // One query attempt against a given model. Re-creates the report_decision
  // server and resets the stream buffers so a fallback retry never duplicates
  // text from the failed primary attempt.
  const attempt = async (model: string): Promise<void> => {
    output = '';
    thinking = '';
    structuredOutput = undefined;
    timing = undefined;
    let resultErrorSubtype: string | undefined;

    const { server: reportDecisionServer, getDecision } = createReportDecisionServer();

    const options: Options = {
      systemPrompt: opts.systemPrompt,
      // Never let this laptop's CLAUDE.md / hooks / settings.json leak into a
      // stage run - every stage is a clean, scoped process identity.
      settingSources: [],
      includePartialMessages: true,
      permissionMode,
      model,
      effort: opts.effort ?? 'medium',
      tools: opts.tools,
      disallowedTools: opts.disallowedTools,
      mcpServers: { report_decision: reportDecisionServer, ...opts.extraMcpServers },
      // report_decision is OUR trusted internal tool (confidence/uncertainty
      // only, no side effects) - always pre-approved regardless of stage scope.
      // This is a permission allowlist, not an availability scope, so it does
      // not violate the tools/disallowedTools-for-scope rule above.
      allowedTools,
      canUseTool: opts.canUseTool,
      maxTurns: opts.maxTurns,
      maxBudgetUsd: opts.maxBudgetUsd,
      hooks: opts.hooks,
      // Native 0.3.310 structured output (NOT a tool/MCP). The validated object
      // comes back on the success result as `structured_output`.
      outputFormat: opts.outputSchema
        ? { type: 'json_schema', schema: opts.outputSchema }
        : undefined,
    };

    for await (const message of query({ prompt: opts.prompt, options })) {
      if (message.type === 'stream_event') {
        const event = message.event;
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            output += event.delta.text;
            await backend.updateAgentStatus(agentName, stage, 'running', compose());
          } else if (event.delta.type === 'thinking_delta') {
            thinking += event.delta.thinking;
            await backend.updateAgentStatus(agentName, stage, 'running', compose());
          }
        }
      } else if (message.type === 'result') {
        if (message.subtype === 'success') {
          // Guard field access defensively — fields may be absent on some
          // result variants / older producers.
          timing = {
            durationMs: message.duration_ms,
            apiMs: message.duration_api_ms,
            numTurns: message.num_turns,
            costUsd: message.total_cost_usd,
          };
          structuredOutput = message.structured_output;
          await backend.logEvent(
            agentName,
            `stage ${stage} done in ${message.duration_ms ?? '?'}ms turns=${
              message.num_turns ?? '?'
            } cost=$${message.total_cost_usd ?? '?'}`,
          );
        } else {
          // error_during_execution | error_max_turns | error_max_budget_usd |
          // error_max_structured_output_retries. The SDK emits this as a
          // MESSAGE, not a throw, so we record it and throw AFTER the loop -
          // otherwise the stage is falsely marked 'done' as a success, the
          // fallbackModel retry never fires, and (for APPLY) the pipeline would
          // proceed to VERIFY as if the patch had been applied.
          resultErrorSubtype = message.subtype;
          await backend.logEvent(agentName, `stage ${stage} result error: ${message.subtype}`);
        }
      }
      // TODO(dev): branch on message.type === 'system' (subtype 'init') to
      // confirm mcp__report_decision__* actually connected.
    }

    if (resultErrorSubtype) {
      throw new Error(`stage ${stage} ended with an error result (${resultErrorSubtype})`);
    }

    decision = getDecision();
  };

  const primaryModel = opts.model ?? CLAUDE_MODELS.mid;

  try {
    await attempt(primaryModel);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // MODEL FALLBACK: retry the whole query ONCE on a different model, if given.
    if (opts.fallbackModel && opts.fallbackModel !== primaryModel) {
      await backend.logEvent(
        agentName,
        `stage ${stage} failed on ${primaryModel} (${message}); retrying with ${opts.fallbackModel}`,
      );
      try {
        await attempt(opts.fallbackModel);
      } catch (retryErr) {
        const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
        await backend.updateAgentStatus(agentName, stage, 'error', compose());
        await backend.logEvent(agentName, `stage ${stage} failed: ${retryMessage}`);
        throw retryErr;
      }
    } else {
      await backend.updateAgentStatus(agentName, stage, 'error', compose());
      await backend.logEvent(agentName, `stage ${stage} failed: ${message}`);
      throw err;
    }
  }

  const reasoning = compose();
  await backend.updateAgentStatus(agentName, stage, 'done', reasoning, decision);

  return { text: output, thinking, decision, structuredOutput, timing };
}
