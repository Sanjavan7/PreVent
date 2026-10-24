// Custom in-process MCP tool every stage exposes so Claude can self-report a
// structured confidence/uncertainty at the end of its reasoning. runStage.ts
// wraps this in a fresh createSdkMcpServer() per call and reads the last
// decision back out after query() completes.

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export interface DecisionResult {
  confidence: number; // 0..1
  uncertainty: string;
  summary: string;
}

const reportDecisionSchema = {
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('How confident you are in this stage result, 0 (guessing) to 1 (certain).'),
  uncertainty: z
    .string()
    .describe('One sentence naming what you are NOT sure about, or "" if none.'),
  summary: z.string().describe('One sentence summary of the decision for the dashboard.'),
};

/**
 * Builds a fresh `report_decision` MCP server + a getter for the last call's
 * decision. One of these is created per `runStage()` invocation so decisions
 * from different stages never bleed into each other.
 */
export function createReportDecisionServer() {
  let lastDecision: DecisionResult | undefined;

  const reportDecision = tool(
    'report_decision',
    'Report your confidence and uncertainty for this stage so the dashboard can show it. Call this exactly once, right before you finish.',
    reportDecisionSchema,
    async (args) => {
      lastDecision = {
        confidence: args.confidence,
        uncertainty: args.uncertainty,
        summary: args.summary,
      };
      return {
        content: [{ type: 'text', text: `Recorded decision: ${args.summary}` }],
      };
    },
    { annotations: { readOnlyHint: true } },
  );

  const server = createSdkMcpServer({
    name: 'report_decision',
    version: '1.0.0',
    tools: [reportDecision],
  });

  return {
    server,
    getDecision: (): DecisionResult | undefined => lastDecision,
  };
}
