// Convex FALLBACK adapter (convex@1.48.0) implementing RealtimeBackend.
//
// Last resort for the ~H13 gate: if the SpacetimeDB TS loop is not reliable, swap the factory in
// ./index.ts to this adapter (forfeits the SpacetimeDB prize). Panels do not change because they
// code against RealtimeBackend.
//
// Mapping: SpacetimeDB table -> Convex table (same names + field shapes),
//          reducer -> Convex mutation, subscription -> Convex query via ConvexClient.onUpdate.
//
// STUB STATUS: the client side below is complete against the interface. The Convex FUNCTIONS
// (realtime/convex/*.ts: schema.ts + one `list` query per table + one mutation per reducer, with
// the same separation-of-duties checks via ctx.auth.getUserIdentity()) are NOT written yet.
// We use `anyApi` so this file compiles without `npx convex dev` codegen.
// TODO(dev): only if we trip the gate - write realtime/convex/schema.ts and the functions named
//   below (`tables:<table>` queries and `reducers:<name>` mutations), then flip the factory.

import { ConvexClient } from 'convex/browser';
import { anyApi } from 'convex/server';
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

export interface ConvexConfig {
  /** VITE_CONVEX_URL, e.g. https://<deployment>.convex.cloud */
  url: string;
}

// `anyApi.<module>.<fn>` builds a function reference by name with no codegen.
const api = anyApi as any;

export class ConvexBackend implements RealtimeBackend {
  readonly kind = 'convex' as const;
  private client: ConvexClient | null = null;

  constructor(private readonly cfg: ConvexConfig) {}

  async connect(): Promise<void> {
    // ConvexClient opens its websocket lazily; subscribe() calls below start the queries.
    this.client = new ConvexClient(this.cfg.url);
  }

  disconnect(): void {
    void this.client?.close();
    this.client = null;
  }

  subscribe<K extends TableName>(table: K, cb: (rows: TableMap[K][]) => void): Unsubscribe {
    if (!this.client) throw new Error('ConvexBackend: connect() first');
    // Convex query `tables:<table>` returns every row (single row for device_status).
    // Rows must already match the contract shapes (appliedAt null, ids as numbers).
    return this.client.onUpdate(api.tables[table], {}, (rows: TableMap[K][]) => cb(rows));
  }

  private async mutate(name: string, args: Record<string, unknown> = {}): Promise<void> {
    if (!this.client) throw new Error('ConvexBackend: not connected');
    await this.client.mutation(api.reducers[name], args);
  }

  updateDeviceStatus(a: UpdateDeviceStatusArgs): Promise<void> {
    return this.mutate('updateDeviceStatus', a);
  }
  updateAgentStatus(a: UpdateAgentStatusArgs): Promise<void> {
    return this.mutate('updateAgentStatus', a);
  }
  recordFinding(a: RecordFindingArgs): Promise<void> {
    return this.mutate('recordFinding', a);
  }
  recordExploitRun(a: RecordExploitRunArgs): Promise<void> {
    return this.mutate('recordExploitRun', a);
  }
  recordPatchAttempt(a: RecordPatchAttemptArgs): Promise<void> {
    return this.mutate('recordPatchAttempt', a);
  }
  approvePatch(patchId: number): Promise<void> {
    return this.mutate('approvePatch', { patchId });
  }
  logEvent(actor: string, text: string): Promise<void> {
    return this.mutate('logEvent', { actor, text });
  }
  pushIrEvent(code: number): Promise<void> {
    return this.mutate('pushIrEvent', { code });
  }
  resetHealthy(): Promise<void> {
    return this.mutate('resetHealthy');
  }
}
