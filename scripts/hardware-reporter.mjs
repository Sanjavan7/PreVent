#!/usr/bin/env node
// scripts/hardware-reporter.mjs
//
// Read UNO serial output, detect fan state, write to the Maincloud `device_status`
// row when the fan state changes. This flips the architecture direction compared to
// the serial-bridge: here the HARDWARE is the source of truth, and Maincloud follows.
//
// Fan running (reported from UNO)  → write {fan_on=true, compromised=false, status="healthy"}
// Fan stopped / UNO silent >3s      → write {fan_on=false, compromised=true, status="hardware-silence"}
//
// Uses the `spacetime call` CLI subprocess, so auth is whatever the local CLI session
// has. Prerequisites on this laptop:
//   1. `spacetime login` done (`spacetime login show` prints an identity)
//   2. That identity granted the `device` role by the module owner
//   3. UNO plugged in and emitting serial (either bedside.ino JSON or uno_actuator.ino key=value)
//
// Usage:
//   ARDUINO_SERIAL_PORT=/dev/cu.usbmodem... node scripts/hardware-reporter.mjs
//
// IMPORTANT: only one process may hold the serial port at a time — don't run this
// concurrently with another serial consumer (or the portal's flash) on the same
// laptop. Pick one direction per machine.

import { SerialPort, ReadlineParser } from 'serialport';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve seed-demo.sh against this script's own dir so the reporter works from
// any cwd, not only the repo root.
const SEED_DEMO = resolve(dirname(fileURLToPath(import.meta.url)), 'seed-demo.sh');

const port = process.env.ARDUINO_SERIAL_PORT;
if (!port) {
  console.error('ARDUINO_SERIAL_PORT required (e.g. /dev/cu.usbmodemE83DC1E348A42)');
  process.exit(1);
}

const sp = new SerialPort({ path: port, baudRate: 115200 });
const parser = sp.pipe(new ReadlineParser({ delimiter: '\n' }));

let lastState = null;    // 'healthy' | 'attack' | null
let callInFlight = false;
let lastHbMs = 0;

sp.on('open', () => console.log(`[reporter] opened ${port}`));
sp.on('error', (e) => console.error(`[reporter] serial error: ${e.message}`));

// Call seed-demo.sh via spacetime CLI (inherits logged-in identity + device role grant).
function flipState(target) {
  if (callInFlight) return;
  if (target === lastState) return;
  callInFlight = true;
  console.log(`[reporter] fan state ${lastState ?? '(unknown)'} -> ${target}`);
  const p = spawn(SEED_DEMO, [target === 'healthy' ? 'healthy' : 'attack', 'maincloud'], {
    stdio: 'inherit',
  });
  p.on('exit', (code) => {
    callInFlight = false;
    if (code === 0) lastState = target;
    else console.error(`[reporter] seed-demo exit ${code}; will retry`);
  });
}

// Parse each line. Supports both firmware formats defensively.
parser.on('data', (raw) => {
  const line = raw.trim();
  let fanValue = null;

  if (line.startsWith('{')) {
    // bedside.ino JSON: {"t":74031,"fan":194,"alarm":0,...}
    try {
      const o = JSON.parse(line);
      if (typeof o.fan === 'number') fanValue = o.fan;
    } catch { /* malformed JSON — ignore */ }
  } else if (line.includes('fan=')) {
    // uno_actuator.ino comma-delimited: STATE,fan=1,rate=200,...
    const m = line.match(/fan=(\d+)/);
    if (m) fanValue = parseInt(m[1], 10);
  }

  // Any readable line counts as a heartbeat from the UNO.
  lastHbMs = Date.now();

  if (fanValue !== null) {
    // Treat any non-zero fan value as "running" (PWM >0 for bedside, bool 1 for actuator).
    flipState(fanValue > 0 ? 'healthy' : 'attack');
  }
});

// Watchdog: if no serial activity for >3s, assume UNO disconnected and flip to attack.
setInterval(() => {
  if (lastHbMs === 0) return;              // never heard from UNO yet
  if (Date.now() - lastHbMs > 3000) flipState('attack');
}, 1000);

process.on('SIGINT', () => { console.log('\n[reporter] bye'); sp.close(); process.exit(0); });
