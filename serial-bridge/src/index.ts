// PreVent serial bridge: device_status (source of truth) -> STATE frames -> UNO,
// and IR remote presses (UNO) -> pushIrEvent reducer -> orchestrator.
//
//   ARDUINO_SERIAL_PORT=COM3 pnpm --filter @prevent/serial-bridge dev
//   BRIDGE_MODE=mock (default)  flips DEVICE_HEALTHY <-> DEVICE_EXPLOITED every 5s
//   BRIDGE_MODE=live            subscribes to SpacetimeDB (TODO(dev) in backend.ts)

import { deviceStatusToState, encodeState } from '@prevent/contracts';
import type { DeviceStatus } from '@prevent/contracts';
import { ArduinoLink } from './arduino-link';
import { createBackend } from './backend';

// Latest row wins; re-sent in full on every READY so a replug/reset resyncs the board.
let latest: DeviceStatus | null = null;
let lastFrame = '';

// Set once the backend connects (mock is synchronous; live awaits the SpacetimeDB snapshot).
let backend: Awaited<ReturnType<typeof createBackend>>;

const link = new ArduinoLink({
  path: process.env.ARDUINO_SERIAL_PORT || undefined,
  onIr: (code) => void pushIrEvent(code),
  onReady: () => pushLatest(true),
});

function pushLatest(force = false): void {
  if (!latest) return;
  const frame = encodeState(deviceStatusToState(latest));
  if (!force && frame === lastFrame) return; // skip no-op updates
  if (link.send(frame)) {
    lastFrame = frame;
    console.log(`[bridge] -> ${frame.trimEnd()}`);
  }
}

async function pushIrEvent(code: number): Promise<void> {
  try {
    // TODO(dev): in live mode this calls the SpacetimeDB pushIrEvent reducer (see backend.ts).
    await backend.pushIrEvent(code);
    console.log(`[bridge] IR code=${code} pushed`);
  } catch (e) {
    console.error(`[bridge] pushIrEvent failed: ${(e as Error).message}`);
  }
}

let unsubscribe: () => void = () => {};

async function main(): Promise<void> {
  // Start the serial link first so the board is found/opened while the backend connects
  // (live mode awaits the SpacetimeDB subscription snapshot before the first row arrives).
  link.start();

  backend = await createBackend();
  unsubscribe = backend.subscribeDeviceStatus((row) => {
    latest = row;
    pushLatest();
  });
}

function shutdown(): void {
  unsubscribe();
  link.stop();
  backend?.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((e) => {
  console.error(`[bridge] fatal: ${(e as Error).message}`);
  process.exit(1);
});
