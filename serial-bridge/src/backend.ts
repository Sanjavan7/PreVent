// Minimal realtime seam for the bridge. The bridge only needs two things from
// the data layer: a live feed of the single device_status row, and the
// pushIrEvent reducer. This mirrors the RealtimeBackend abstraction owned by
// Dev 3 (realtime/src/backend/RealtimeBackend.ts).
// TODO(dev): once @prevent/realtime exists, delete this interface and import
// RealtimeBackend from there; keep only the thin adapter in createBackend().

import { DEVICE_EXPLOITED, DEVICE_HEALTHY } from '@prevent/contracts';
import type { DeviceStatus } from '@prevent/contracts';

export interface BridgeBackend {
  /** Calls cb immediately with the current row (if any) and on every update. Returns unsubscribe. */
  subscribeDeviceStatus(cb: (row: DeviceStatus) => void): () => void;
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
    async pushIrEvent(code) {
      console.log(`[mock] pushIrEvent(code=${code})`);
    },
    close() {
      clearInterval(timer);
      listeners.clear();
    },
  };
}

/** Live path: SpacetimeDB (spacetimedb@2.13.0) subscription on device_status + pushIrEvent reducer. */
export function createSpacetimeBackend(): BridgeBackend {
  // TODO(dev): connect with the generated module bindings from realtime/ using
  // process.env.SPACETIMEDB_URI / SPACETIMEDB_MODULE (see .env.example):
  //   - subscribe to `SELECT * FROM device_status`; map row -> DeviceStatus
  //     (call cb on onInsert and onUpdate)
  //   - pushIrEvent(code) -> conn.reducers.pushIrEvent({ code })
  throw new Error('SpacetimeDB backend not wired yet (TODO(dev)); run with BRIDGE_MODE=mock');
}

export function createBackend(): BridgeBackend {
  return process.env.BRIDGE_MODE === 'live' ? createSpacetimeBackend() : createMockBackend();
}
