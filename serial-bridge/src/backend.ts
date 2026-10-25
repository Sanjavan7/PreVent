// Minimal realtime seam for the bridge. The bridge only needs two things from
// the data layer: a live feed of the single device_status row, and the
// pushIrEvent reducer. This mirrors the RealtimeBackend abstraction owned by
// Dev 3 (realtime/src/backend/RealtimeBackend.ts).
// TODO(dev): once @prevent/realtime exists, delete this interface and import
// RealtimeBackend from there; keep only the thin adapter in createBackend().

import { DEVICE_EXPLOITED, DEVICE_HEALTHY } from '@prevent/contracts';
import type { DeviceStatus } from '@prevent/contracts';
import { createBackend as createRealtimeBackend } from '@prevent/realtime/backend';

/** The device_status row minus server-managed fields (the updateDeviceStatus reducer input). */
export type DeviceStatusUpdate = Omit<DeviceStatus, 'id' | 'updatedAt'>;

export interface BridgeBackend {
  /** Calls cb immediately with the current row (if any) and on every update. Returns unsubscribe. */
  subscribeDeviceStatus(cb: (row: DeviceStatus) => void): () => void;
  /** WRITE the device_status row — the hardware reporting its real state (role `device`). */
  updateDeviceStatus(row: DeviceStatusUpdate): Promise<void>;
  /** Calls the pushIrEvent reducer (orchestrator consumes it and fires the exploit). */
  pushIrEvent(code: number): Promise<void>;
  close(): void;
}

/** Dev path: flips DEVICE_HEALTHY <-> DEVICE_EXPLOITED so the board can be exercised with no backend. */
export function createMockBackend(intervalMs = 5000): BridgeBackend {
  const listeners = new Set<(row: DeviceStatus) => void>();
  let exploited = false;
  let current: DeviceStatus = { ...DEVICE_HEALTHY, updatedAt: Date.now() };

  const timer = setInterval(() => {
    exploited = !exploited;
    current = { ...(exploited ? DEVICE_EXPLOITED : DEVICE_HEALTHY), updatedAt: Date.now() };
    for (const cb of listeners) cb(current);
  }, intervalMs);

  return {
    subscribeDeviceStatus(cb) {
      listeners.add(cb);
      cb(current);
      return () => {
        listeners.delete(cb);
      };
    },
    async updateDeviceStatus(row) {
      current = { ...current, ...row, updatedAt: Date.now() };
      for (const cb of listeners) cb(current);
    },
    async pushIrEvent(code) {
      console.log(`[mock] pushIrEvent(code=${code})`);
    },
    close() {
      clearInterval(timer);
      listeners.clear();
    },
  };
}

/**
 * Live path: subscribe to the single device_status row on SpacetimeDB (Maincloud or local)
 * via the already-built shared client (@prevent/realtime SpacetimeBackend). That client owns the
 * connection, the generated-bindings row -> DeviceStatus mapping, and automatic reconnect; here we
 * only adapt its RealtimeBackend surface down to the two methods the bridge needs.
 *
 * Config comes from process.env (the realtime factory reads these keys):
 *   VITE_SPACETIMEDB_URI    e.g. wss://maincloud.spacetimedb.com (shared) or ws://localhost:3000
 *   VITE_SPACETIMEDB_MODULE e.g. prevent
 *   SPACETIMEDB_TOKEN       optional; only needed to keep a stable identity for pushIrEvent (role `bridge`)
 */
export async function createSpacetimeBackend(): Promise<BridgeBackend> {
  const rt = await createRealtimeBackend('spacetimedb', process.env);
  await rt.connect(); // resolves once the initial subscription snapshot is applied
  return {
    subscribeDeviceStatus(cb) {
      // SpacetimeBackend replays the current snapshot immediately, then fires on every update.
      // device_status is a single-row table (id=1), so the row is rows[0].
      return rt.subscribe('device_status', (rows) => {
        const row = rows[0];
        if (row) cb(row);
      });
    },
    // Reading device_status is anonymous/public; pushIrEvent calls a role-`bridge` reducer, so it
    // only lands if this process holds a granted identity (set SPACETIMEDB_TOKEN). index.ts already
    // logs and swallows a rejection, so leaving it unauthorized degrades gracefully.
    updateDeviceStatus: (row) => rt.updateDeviceStatus(row),
    pushIrEvent: (code) => rt.pushIrEvent(code),
    close: () => rt.disconnect(),
  };
}

export function createBackend(): Promise<BridgeBackend> {
  return process.env.BRIDGE_MODE === 'live'
    ? createSpacetimeBackend()
    : Promise.resolve(createMockBackend());
}
