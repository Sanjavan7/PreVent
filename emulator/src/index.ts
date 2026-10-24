// PreVent software emulator (owner: Hardware).
//
// Drop-in for the serial bridge + UNO: consumes `device_status` and emits the
// EXACT same frames the bridge would write to the board (STATE,... via
// encodeState from @prevent/contracts), and can inject IR keypresses as if the
// judge pressed the remote.
//
// Streams:
//   stdout  = outbound host->UNO frames ONLY (STATE,... / SRV,...), one per line,
//             byte-for-byte what goes over the wire. Safe to pipe/diff.
//   stderr  = human-readable log: simulated UNO->host lines (READY / HB / IR,...)
//             and a rendering of what the board would show.
//
// stdin commands (one per line):
//   exploit | heal | amber     switch the mock device_status scenario
//   ir <code>                  inject IR,code=<uint32> (calls the IR hook)
//   srv <angle>                emit SRV,angle=<0-180>
//   status                     reprint the current board view
//   quit
//
// Env / flags:
//   EMULATOR_LOOP=0 (or --no-loop)   hold the healthy state instead of cycling
//   EMULATOR_HOLD_MS=6000            time per scenario step when looping

import { createInterface } from 'node:readline';
import {
  DEVICE_EXPLOITED,
  DEVICE_HEALTHY,
  deviceStatusToState,
  encodeServo,
  encodeState,
  parseInbound,
  type DeviceStatus,
  type Rgb,
  type StateLine,
} from '@prevent/contracts';

// ---------------------------------------------------------------- source ----

/** Anything that can feed device_status rows. Swap the mock for the live one. */
interface DeviceStatusSource {
  subscribe(onRow: (row: DeviceStatus) => void): () => void;
}

const HOLD_MS = Number(process.env.EMULATOR_HOLD_MS ?? 6000);
const LOOP = process.env.EMULATOR_LOOP !== '0' && !process.argv.includes('--no-loop');

/** Mock loop: healthy -> exploited -> healthy ... (and manual overrides). */
function createMockSource(): DeviceStatusSource & {
  push(row: DeviceStatus): void;
} {
  const listeners = new Set<(row: DeviceStatus) => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let step = 0;

  const emit = (row: DeviceStatus) => {
    const stamped = { ...row, updatedAt: Date.now() };
    for (const l of listeners) l(stamped);
  };

  return {
    push: emit,
    subscribe(onRow) {
      listeners.add(onRow);
      if (listeners.size === 1) {
        emit(DEVICE_HEALTHY);
        if (LOOP) {
          timer = setInterval(() => {
            step += 1;
            emit(step % 2 === 1 ? DEVICE_EXPLOITED : DEVICE_HEALTHY);
          }, HOLD_MS);
        }
      }
      return () => {
        listeners.delete(onRow);
        if (listeners.size === 0 && timer) clearInterval(timer);
      };
    },
  };
}

// TODO(dev): live source. Subscribe to the SpacetimeDB `device_status` table
// (spacetimedb@2.13.0, same client the serial-bridge uses), map each row to the
// camelCase DeviceStatus shape and call onRow on insert/update. The emulator
// must stay a true drop-in: nothing below this point should care which source
// is plugged in.
//   function createSpacetimeSource(): DeviceStatusSource { ... }

// ------------------------------------------------------------ IR inject ----

/**
 * Called when an IR press is injected. The real bridge calls the
 * `pushIrEvent(code)` reducer here.
 * TODO(dev): call the SpacetimeDB `pushIrEvent` reducer so the orchestrator
 * fires the chosen exploit even without a board.
 */
async function onIrEvent(code: number): Promise<void> {
  // Placeholder: log only (mock mode).
  log(`[mock] pushIrEvent(${code}) -> orchestrator (not wired; TODO(dev))`);
}

// ----------------------------------------------------------------- output ----

function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

/** Write one outbound frame exactly as it would hit the serial port. */
function sendFrame(frame: string): void {
  process.stdout.write(frame);
}

/** Simulated UNO->host line, round-tripped through the real parser. */
function receiveFromBoard(line: string): void {
  const msg = parseInbound(line);
  log(`< ${line}   (${msg.type})`);
}

/** What the physical board would show for a given STATE frame. */
function renderBoard(s: StateLine): string {
  const rgbName = ['GREEN', 'RED', 'AMBER'][s.rgb];
  const row0 = `HR ${String(s.hr).padEnd(3)} SpO2 ${String(s.spo2).padEnd(3)}`.padEnd(16);
  const row1 = (s.alarm ? 'ALARM ON' : 'ALARM OFF').padEnd(16);
  return [
    `  LCD  |${row0}|`,
    `       |${row1}|`,
    `  fan=${s.fan ? 'ON ' : 'OFF'} pwm=${s.fan ? s.rate : 0}  rgb=${rgbName}  buzzer=${s.alarm ? 'BEEPING' : 'silent'}  7seg=${s.spo2}`,
  ].join('\n');
}

// ------------------------------------------------------------------ main ----

let lastState: StateLine | null = null;
let rgbOverride: Rgb | null = null;

function applyRow(row: DeviceStatus): void {
  const state = deviceStatusToState(row);
  if (rgbOverride !== null) state.rgb = rgbOverride;
  lastState = state;
  sendFrame(encodeState(state));
  log(renderBoard(state));
}

function main(): void {
  const source = createMockSource(); // TODO(dev): swap for createSpacetimeSource()
  let lastRow: DeviceStatus = DEVICE_HEALTHY;

  // The board prints READY once after boot; the bridge waits for it before sending.
  receiveFromBoard('READY');
  const hb = setInterval(() => receiveFromBoard('HB'), 1000);

  const unsubscribe = source.subscribe((row) => {
    lastRow = row;
    rgbOverride = null; // a fresh row owns the colour again
    applyRow(row);
  });

  const rl = createInterface({ input: process.stdin });
  const shutdown = () => {
    clearInterval(hb);
    unsubscribe();
    rl.close();
    process.exit(0);
  };

  rl.on('line', (raw) => {
    const [cmd, arg] = raw.trim().split(/\s+/);
    switch (cmd) {
      case 'exploit':
        source.push(DEVICE_EXPLOITED);
        break;
      case 'heal':
        source.push(DEVICE_HEALTHY);
        break;
      case 'amber': // patching colour; not producible from deviceStatusToState
        rgbOverride = 2;
        applyRow(lastRow);
        break;
      case 'ir': {
        const code = Number(arg);
        if (!Number.isInteger(code) || code < 0 || code > 0xffffffff) {
          log('usage: ir <uint32 code>');
          break;
        }
        receiveFromBoard(`IR,code=${code}`);
        void onIrEvent(code);
        break;
      }
      case 'srv': {
        const angle = Number(arg);
        if (!Number.isFinite(angle)) {
          log('usage: srv <0-180>');
          break;
        }
        sendFrame(encodeServo(angle));
        break;
      }
      case 'status':
        if (lastState) log(renderBoard(lastState));
        break;
      case 'quit':
      case 'exit':
        shutdown();
        break;
      case '':
        break;
      default:
        log(`unknown command: ${cmd}`);
    }
  });

  // stdin closing (piped / no TTY) must not stop the mock loop.
  process.on('SIGINT', shutdown);
  log(`emulator up (loop=${LOOP ? `${HOLD_MS}ms` : 'off'}); commands: exploit | heal | amber | ir <code> | srv <angle> | status | quit`);
}

main();
