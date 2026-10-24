// Human-approval gate (PLAN-DEV1 task 3). The APPLY stage's patch-apply tool
// must be scoped OUT of `allowedTools` and run with `permissionMode:'default'`
// (never 'bypassPermissions'/'dontAsk') - otherwise `canUseTool` is never
// invoked at all and the gate is a no-op. See PLAN-DEV1, verified pins.
//
// NOTE from the SDK's own `CanUseTool` typing: returning `null` is fail-closed
// and ONLY valid after you've already sent the control_response out-of-band.
// We never do that here - we always resolve `allow`/`deny` from inside the
// promise the dashboard settles, so the tool call can await indefinitely
// without risking an unanswered permission prompt.

import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { PatchAttempt } from '@prevent/contracts';
import type { RealtimeBackend } from './realtime/backend';

export interface PendingApproval {
  patchAttemptId: number;
  toolName: string;
  input: Record<string, unknown>;
  createdAt: number;
}

export interface ApprovalDecision {
  approved: boolean;
  approvedBy: string;
}

/**
 * Tracks one outstanding dashboard approval at a time (the demo only ever
 * gates a single PATCH -> APPLY step). The dashboard's POST /approve route
 * (Dev 3's HTTP layer, not scaffolded here) calls `resolve()` on the promise
 * this class is holding; `canUseTool` below just awaits it.
 *
 * TODO(dev): if the dashboard needs to show "awaiting approval" state before
 * canUseTool fires (e.g. after PATCH proposes but before APPLY's query()
 * starts), call `backend.updateAgentStatus('patch', 'patch', 'waiting_for_human', ...)`
 * from the orchestrator right before invoking the gated stage.
 */
export class HumanGate {
  private pending: PendingApproval | null = null;
  private resolvers: Array<(decision: ApprovalDecision) => void> = [];

  constructor(private backend: RealtimeBackend) {}

  getPending(): PendingApproval | null {
    return this.pending;
  }

  /** Called by the dashboard's approve/reject endpoint. TODO(dev): wire this
   * to the real HTTP route once Dev 3's dashboard POSTs here instead of
   * calling it directly in dev/mock mode. */
  resolve(decision: ApprovalDecision): void {
    this.pending = null;
    const waiters = this.resolvers;
    this.resolvers = [];
    for (const r of waiters) r(decision);
  }

  private awaitApproval(approval: PendingApproval): Promise<ApprovalDecision> {
    this.pending = approval;
    return new Promise<ApprovalDecision>((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  /**
   * The `canUseTool` callback passed into `runStage()`'s options for the
   * APPLY stage. Awaits indefinitely until `resolve()` is called from the
   * dashboard click.
   */
  makeCanUseTool(patchAttempt: Pick<PatchAttempt, 'id'>): CanUseTool {
    return async (toolName, input): Promise<PermissionResult> => {
      await this.backend.updateAgentStatus(
        'patch',
        'patch',
        'waiting_for_human',
        `Awaiting human approval to run ${toolName} for patch #${patchAttempt.id}`,
      );
      await this.backend.logEvent(
        'human_gate',
        `Gate opened for ${toolName} (patch #${patchAttempt.id}) - waiting for dashboard APPROVE`,
      );

      const decision = await this.awaitApproval({
        patchAttemptId: patchAttempt.id,
        toolName,
        input,
        createdAt: Date.now(),
      });

      if (decision.approved) {
        await this.backend.approvePatch(patchAttempt.id, decision.approvedBy);
        await this.backend.updateAgentStatus('patch', 'patch', 'done', 'Human approved. Applying patch.');
        return { behavior: 'allow' };
      }

      await this.backend.logEvent('human_gate', `Patch #${patchAttempt.id} rejected by ${decision.approvedBy}`);
      await this.backend.updateAgentStatus('patch', 'patch', 'error', 'Human rejected the patch.');
      return { behavior: 'deny', message: `Rejected by ${decision.approvedBy}` };
    };
  }
}

// TODO(dev): for the live demo, expose a tiny HTTP endpoint (or a SpacetimeDB
// reducer subscription) that calls `gate.resolve({ approved: true, approvedBy })`
// when the dashboard's APPROVE button is clicked. In dry/mock mode, the
// orchestrator below auto-approves after a short delay so the loop still closes.
