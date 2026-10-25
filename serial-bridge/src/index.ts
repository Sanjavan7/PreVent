// PreVent serial bridge: device_status (source of truth) -> STATE frames -> UNO,
// and IR remote presses (UNO) -> pushIrEvent reducer -> orchestrator.
//
//   ARDUINO_SERIAL_PORT=COM3 pnpm --filter @prevent/serial-bridge dev
//   BRIDGE_MODE=mock (default)  flips DEVICE_HEALTHY <-> DEVICE_EXPLOITED every 5s
//   BRIDGE_MODE=live            subscribes to SpacetimeDB (TODO(dev) in backend.ts)

import { deviceStatusToState, encodeState } from '@prevent/contracts';
import type { DeviceStatus } from '@prevent/contracts';
import { ArduinoLink } from './arduino-link';
import { createBackend, type DeviceStatusUpdate } from './backend';

// Vitals model: a spinning fan = a ventilated, healthy patient; a stopped fan =
// the patient crashing while the monitor keeps DISPLAYING healthy (the lie).
const HEALTHY = { hr: 72, spo2: 98 };
const CRASH = { hr: 38, spo2: 61 };

// Latest row wins; re-sent in full on every READY so a replug/reset resyncs the board.
let latest: DeviceStatus | null = null;
let lastFrame = '';
let lastReported = ''; // de-dupe hardware -> DB writes (only on real state change)

// Set once the backend connects (mock is synchronous; live awaits the SpacetimeDB snapshot).
let backend: Awaited<ReturnType<typeof createBackend>>;

const link = new ArduinoLink({
  path: process.env.ARDUINO_SERIAL_PORT || undefined,
  onIr: (code) => void pushIrEvent(code),
  onReady: () => pushLatest(true),
  onTelemetry: (t) => void reportHardware(t),
});

// Hardware -> DB: the board's REAL state becomes the device_status row the sim +
// dashboard read, so the hardware is the source of truth. A stopped fan IS the
// compromise (the patient crashes while the monitor keeps reporting healthy).
async function reportHardware(t: { fan: number; alarm: boolean; compromised: boolean }): Promise<void> {
  if (!backend) return; // backend still connecting
  const fanOn = t.fan > 0;
  const compromised = t.compromised || !fanOn;
  const row: DeviceStatusUpdate = {
    fanOn,
    trueHr: fanOn ? HEALTHY.hr : CRASH.hr,
    trueSpo2: fanOn ? HEALTHY.spo2 : CRASH.spo2,
    reportedHr: HEALTHY.hr, // the monitor keeps DISPLAYING healthy — the silent lie
    reportedSpo2: HEALTHY.spo2,
    alarmActive: t.alarm,
    compromised,
    lastCommand: compromised ? 'stop_fan (unauthenticated)' : 'healthy',
  };
  const key = JSON.stringify(row);
  if (key === lastReported) return; // only write on a real change
  lastReported = key;
  try {
    await backend.updateDeviceStatus(row);
    console.log(`[bridge] hardware -> DB: fanOn=${fanOn} compromised=${compromised}`);
  } catch (e) {
    console.error(`[bridge] updateDeviceStatus failed (this identity needs the 'device' role): ${(e as Error).message}`);
  }
}

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
