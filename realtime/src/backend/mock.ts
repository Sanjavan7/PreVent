// In-memory backend for dev/UI work before SpacetimeDB is up. Same interface, no network.
// Seeds from @prevent/contracts mocks. Reducers apply immediately and notify subscribers.

import {
  DEVICE_HEALTHY,
  MOCK_AGENTS,
  MOCK_EVENT_LOG,
  MOCK_FINDINGS,
} from '@prevent/contracts';
import type {
  RealtimeBackend,
  RecordExploitRunArgs,
  RecordFindingArgs,
  RecordPatchAttemptArgs,
  TableMap,
  TableName,
  Unsubscribe,
  UpdateAgentStatusArgs,
  UpdateDeviceStatusArgs,
} from './RealtimeBackend';

type Store = { [K in TableName]: TableMap[K][] };
type AnyListener = (rows: never[]) => void;

export class MockBackend implements RealtimeBackend {
  readonly kind = 'mock' as const;
  private store: Store = {
    device_status: [{ ...DEVICE_HEALTHY }],
    agent_status: MOCK_AGENTS.map((a) => ({ ...a })),
    findings: MOCK_FINDINGS.map((f) => ({ ...f })),
    exploit_runs: [],
    patch_attempts: [],
    event_log: MOCK_EVENT_LOG.map((e) => ({ ...e })),
    ir_events: [],
  };
  private listeners = new Map<TableName, Set<AnyListener>>();
  private nextId: Record<TableName, number> = {
    device_status: 2,
    agent_status: MOCK_AGENTS.length + 1,
    findings: MOCK_FINDINGS.length + 1,
    exploit_runs: 1,
    patch_attempts: 1,
    event_log: MOCK_EVENT_LOG.length + 1,
    ir_events: 1,
  };

  async connect(): Promise<void> {}

  disconnect(): void {
    this.listeners.clear();
  }

  subscribe<K extends TableName>(table: K, cb: (rows: TableMap[K][]) => void): Unsubscribe {
    let set = this.listeners.get(table);
    if (!set) {
      set = new Set();
      this.listeners.set(table, set);
    }
    const listener = cb as unknown as AnyListener;
    set.add(listener);
    cb([...this.store[table]]);
    return () => {
      set.delete(listener);
    };
  }

  private emit(table: TableName): void {
    const rows = [...this.store[table]] as never[];
    this.listeners.get(table)?.forEach((cb) => cb(rows));
  }

  private id(table: TableName): number {
    return this.nextId[table]++;
  }

  private log(actor: string, text: string): void {
    this.store.event_log.push({ id: this.id('event_log'), ts: Date.now(), actor, text });
    this.emit('event_log');
  }

  async updateDeviceStatus(a: UpdateDeviceStatusArgs): Promise<void> {
    this.store.device_status = [{ id: 1, ...a, updatedAt: Date.now() }];
    this.emit('device_status');
    this.log('device', `${a.lastCommand}: fan=${a.fanOn ? 'on' : 'off'}`);
  }

  async updateAgentStatus(a: UpdateAgentStatusArgs): Promise<void> {
    const rows = this.store.agent_status;
    const i = rows.findIndex((r) => r.agentName === a.agentName);
    const row = { ...a, id: i >= 0 ? rows[i]!.id : this.id('agent_status'), updatedAt: Date.now() };
    if (i >= 0) rows[i] = row;
    else rows.push(row);
    this.emit('agent_status');
    this.log(a.agentName, `${a.stage} -> ${a.state}`);
  }

  async recordFinding(a: RecordFindingArgs): Promise<void> {
    this.store.findings.push({ ...a, id: this.id('findings'), createdAt: Date.now() });
    this.emit('findings');
    this.log('scanner', `finding ${a.file}:${a.line}`);
  }

  async recordExploitRun(a: RecordExploitRunArgs): Promise<void> {
    this.store.exploit_runs.push({ ...a, id: this.id('exploit_runs'), deliveredAt: Date.now() });
    this.emit('exploit_runs');
    this.log('exploit', `exploit on finding ${a.findingId}: ${a.success ? 'SUCCESS' : 'failed'}`);
  }

  async recordPatchAttempt(a: RecordPatchAttemptArgs): Promise<void> {
    const rows = this.store.patch_attempts;
    const i = a.patchId === undefined ? -1 : rows.findIndex((r) => r.id === a.patchId);
    if (i >= 0) {
      rows[i] = {
        ...rows[i]!,
        diffRef: a.diffRef,
        droidSession: a.droidSession,
        appliedAt: a.appliedAt ?? null,
      };
    } else {
      rows.push({
        id: this.id('patch_attempts'),
        findingId: a.findingId,
        diffRef: a.diffRef,
        droidSession: a.droidSession,
        proposedAt: Date.now(),
        humanApproved: false,
        appliedAt: a.appliedAt ?? null,
      });
    }
    this.emit('patch_attempts');
    this.log('patcher', `patch for finding ${a.findingId}`);
  }

  async approvePatch(patchId: number): Promise<void> {
    const p = this.store.patch_attempts.find((r) => r.id === patchId);
    if (!p) throw new Error(`no patch ${patchId}`);
    p.humanApproved = true;
    this.emit('patch_attempts');
    this.log('human', `patch ${patchId} APPROVED`);
  }

  async logEvent(actor: string, text: string): Promise<void> {
    this.log(actor, text);
  }

  async pushIrEvent(code: number): Promise<void> {
    this.store.ir_events.push({ id: this.id('ir_events'), ts: Date.now(), code, consumed: false });
    this.emit('ir_events');
    this.log('bridge', `IR code ${code}`);
  }

  async resetHealthy(): Promise<void> {
    const ts = Date.now();
    this.store.device_status = [{ ...DEVICE_HEALTHY, updatedAt: ts }];
    this.store.agent_status = this.store.agent_status.map((a) => ({
      ...a,
      state: 'idle',
      reasoning: '',
      confidence: 0,
      uncertainty: '',
      updatedAt: ts,
    }));
    this.emit('device_status');
    this.emit('agent_status');
    this.log('orchestrator', 'Reset: device healthy, agents idle.');
  }
}
