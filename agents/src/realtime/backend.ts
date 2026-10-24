// Seam with Dev 3: the orchestrator writes every row through this interface.
// TODO(dev): replace MockRealtimeBackend with a thin adapter over Dev 3's
// `@prevent/realtime` SpacetimeDB client (RealtimeBackend abstraction) once
// `realtime/` exists and is published. The method shapes below should match
// Dev 3's reducers 1:1 (updateDeviceStatus, updateAgentStatus, recordFinding,
// recordExploitRun, recordPatchAttempt, approvePatch, logEvent, pushIrEvent,
// resetHealthy) so swapping the implementation needs no orchestrator changes.

import type {
  AgentState,
  AgentStatus,
  DeviceStatus,
  EventLogRow,
  ExploitRun,
  Finding,
  IrEvent,
  PatchAttempt,
  Stage,
} from '@prevent/contracts';
import {
  DEVICE_HEALTHY,
  MOCK_AGENTS,
  MOCK_EVENT_LOG,
  MOCK_FINDINGS,
} from '@prevent/contracts';

export interface RealtimeBackend {
  getDeviceStatus(): Promise<DeviceStatus>;
  updateDeviceStatus(patch: Partial<Omit<DeviceStatus, 'id'>>): Promise<DeviceStatus>;

  getAgentStatuses(): Promise<AgentStatus[]>;
  updateAgentStatus(
    agentName: string,
    stage: Stage,
    state: AgentState,
    reasoning: string,
    extra?: Partial<Pick<AgentStatus, 'confidence' | 'uncertainty'>>,
  ): Promise<AgentStatus>;

  recordFinding(finding: Omit<Finding, 'id' | 'createdAt'>): Promise<Finding>;
  recordExploitRun(run: Omit<ExploitRun, 'id'>): Promise<ExploitRun>;
  recordPatchAttempt(attempt: Omit<PatchAttempt, 'id'>): Promise<PatchAttempt>;
  approvePatch(id: number, approvedBy: string): Promise<PatchAttempt>;

  logEvent(actor: string, text: string): Promise<EventLogRow>;

  pushIrEvent(code: number): Promise<IrEvent>;
  /** Resolves with the next unconsumed ir_event, or null on timeout. DELIVER
   *  stage blocks here waiting for the judge's remote press. */
  waitForIrEvent(timeoutMs: number): Promise<IrEvent | null>;

  resetHealthy(): Promise<DeviceStatus>;
}

let nextId = 1000; // mock-only counter; real backend assigns ids server-side

/** In-memory, single-process mock so `agents/` runs + typechecks standalone.
 * TODO(dev): swap for the real SpacetimeDB-backed RealtimeBackend at integration. */
export class MockRealtimeBackend implements RealtimeBackend {
  private device: DeviceStatus = { ...DEVICE_HEALTHY };
  private agents: Map<string, AgentStatus> = new Map(
    MOCK_AGENTS.map((a) => [a.agentName, { ...a }]),
  );
  private findings: Finding[] = [...MOCK_FINDINGS];
  private exploitRuns: ExploitRun[] = [];
  private patchAttempts: PatchAttempt[] = [];
  private eventLog: EventLogRow[] = [...MOCK_EVENT_LOG];
  private irEvents: IrEvent[] = [];
  private irWaiters: Array<(ev: IrEvent | null) => void> = [];

  async getDeviceStatus(): Promise<DeviceStatus> {
    return { ...this.device };
  }

  async updateDeviceStatus(patch: Partial<Omit<DeviceStatus, 'id'>>): Promise<DeviceStatus> {
    this.device = { ...this.device, ...patch, updatedAt: Date.now() };
    await this.logEvent('device_status', `updateDeviceStatus ${JSON.stringify(patch)}`);
    return { ...this.device };
  }

  async getAgentStatuses(): Promise<AgentStatus[]> {
    return [...this.agents.values()];
  }

  async updateAgentStatus(
    agentName: string,
    stage: Stage,
    state: AgentState,
    reasoning: string,
    extra?: Partial<Pick<AgentStatus, 'confidence' | 'uncertainty'>>,
  ): Promise<AgentStatus> {
    const prev = this.agents.get(agentName);
    const next: AgentStatus = {
      id: prev?.id ?? nextId++,
      agentName,
      stage,
      state,
      reasoning,
      confidence: extra?.confidence ?? prev?.confidence ?? 0,
      uncertainty: extra?.uncertainty ?? prev?.uncertainty ?? '',
      updatedAt: Date.now(),
    };
    this.agents.set(agentName, next);
    return next;
  }

  async recordFinding(finding: Omit<Finding, 'id' | 'createdAt'>): Promise<Finding> {
    const row: Finding = { ...finding, id: nextId++, createdAt: Date.now() };
    this.findings.push(row);
    await this.logEvent('scan', `recordFinding ${row.file}:${row.line} (${row.cveRef})`);
    return row;
  }

  async recordExploitRun(run: Omit<ExploitRun, 'id'>): Promise<ExploitRun> {
    const row: ExploitRun = { ...run, id: nextId++ };
    this.exploitRuns.push(row);
    await this.logEvent('deliver', `recordExploitRun success=${row.success}`);
    return row;
  }

  async recordPatchAttempt(attempt: Omit<PatchAttempt, 'id'>): Promise<PatchAttempt> {
    const row: PatchAttempt = { ...attempt, id: nextId++ };
    this.patchAttempts.push(row);
    await this.logEvent('patch', `recordPatchAttempt session=${row.droidSession}`);
    return row;
  }

  async approvePatch(id: number, approvedBy: string): Promise<PatchAttempt> {
    const row = this.patchAttempts.find((p) => p.id === id);
    if (!row) throw new Error(`approvePatch: no patch attempt with id ${id}`);
    row.humanApproved = true;
    row.appliedAt = Date.now();
    await this.logEvent('human_gate', `approvePatch ${id} by ${approvedBy}`);
    return row;
  }

  async logEvent(actor: string, text: string): Promise<EventLogRow> {
    const row: EventLogRow = { id: nextId++, ts: Date.now(), actor, text };
    this.eventLog.push(row);
    // eslint-disable-next-line no-console
    console.log(`[event_log] ${actor}: ${text}`);
    return row;
  }

  async pushIrEvent(code: number): Promise<IrEvent> {
    const row: IrEvent = { id: nextId++, ts: Date.now(), code, consumed: false };
    this.irEvents.push(row);
    const waiter = this.irWaiters.shift();
    if (waiter) {
      row.consumed = true;
      waiter(row);
    }
    return row;
  }

  async waitForIrEvent(timeoutMs: number): Promise<IrEvent | null> {
    const pending = this.irEvents.find((e) => !e.consumed);
    if (pending) {
      pending.consumed = true;
      return pending;
    }
    return new Promise<IrEvent | null>((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.irWaiters.indexOf(settle);
        if (idx >= 0) this.irWaiters.splice(idx, 1);
        resolve(null);
      }, timeoutMs);
      const settle = (ev: IrEvent | null) => {
        clearTimeout(timer);
        resolve(ev);
      };
      this.irWaiters.push(settle);
    });
  }

  async resetHealthy(): Promise<DeviceStatus> {
    this.device = { ...DEVICE_HEALTHY, updatedAt: Date.now() };
    await this.logEvent('orchestrator', 'resetHealthy');
    return { ...this.device };
  }
}
