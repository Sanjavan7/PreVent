// Serial link to the UNO with the three behaviours the demo depends on:
//  1. WAIT for `READY` before sending (opening the port toggles DTR and resets the UNO).
//  2. Auto-reconnect when the cable is unplugged / the port closes or errors.
//  3. Heartbeat watchdog: the firmware emits `HB` ~1/s; if no line arrives within
//     the timeout the link is considered dead, torn down and reopened.

import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { SERIAL_BAUD, parseInbound } from '@prevent/contracts';
import type { Inbound } from '@prevent/contracts';

export interface ArduinoLinkOptions {
  /** Fixed path (e.g. COM3). If omitted, auto-detects an Arduino/CH340 port. */
  path?: string;
  baudRate?: number;
  reconnectDelayMs?: number;
  /** No line for this long while open => treat as dead. UNO sends HB ~1/s. */
  heartbeatTimeoutMs?: number;
  onIr: (code: number) => void;
  /** Called every time the board announces READY (including after a reset/replug). */
  onReady?: () => void;
  /** Called on every telemetry status line the firmware emits (the device's real state). */
  onTelemetry?: (t: { fan: number; alarm: boolean; compromised: boolean }) => void;
  onLog?: (msg: string) => void;
}

// Arduino, Arduino.org, CH340 clones, FTDI
const ARDUINO_VENDOR_IDS = new Set(['2341', '2a03', '1a86', '0403']);

export class ArduinoLink {
  private port: SerialPort | null = null;
  private ready = false;
  private stopped = false;
  private lastRx = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private readonly baudRate: number;
  private readonly reconnectDelayMs: number;
  private readonly heartbeatTimeoutMs: number;

  constructor(private readonly opts: ArduinoLinkOptions) {
    this.baudRate = opts.baudRate ?? SERIAL_BAUD;
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 2000;
    this.heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? 4000;
  }

  /** True only after READY has been received on the current connection. */
  get isReady(): boolean {
    return this.ready;
  }

  start(): void {
    this.stopped = false;
    this.watchdogTimer ??= setInterval(() => this.checkWatchdog(), 1000);
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.reconnectTimer = null;
    this.watchdogTimer = null;
    this.teardown();
  }

  /** Send a pre-encoded frame (must already end in \n). Dropped (returns false) until READY. */
  send(frame: string): boolean {
    if (!this.port?.isOpen || !this.ready) return false;
    this.port.write(frame, (err) => {
      if (err) this.log(`write error: ${err.message}`);
    });
    return true;
  }

  private log(msg: string): void {
    (this.opts.onLog ?? console.log)(`[serial] ${msg}`);
  }

  private async resolvePath(): Promise<string | undefined> {
    if (this.opts.path) return this.opts.path;
    const ports = await SerialPort.list();
    const hit = ports.find((p) => p.vendorId && ARDUINO_VENDOR_IDS.has(p.vendorId.toLowerCase()));
    return hit?.path;
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.port) return;
    let path: string | undefined;
    try {
      path = await this.resolvePath();
    } catch (e) {
      this.log(`port list failed: ${(e as Error).message}`);
    }
    if (!path) {
      this.log('no Arduino port found (set ARDUINO_SERIAL_PORT); retrying');
      this.scheduleReconnect();
      return;
    }
    if (this.stopped || this.port) return; // raced with stop() or another connect()

    const port = new SerialPort({ path, baudRate: this.baudRate, autoOpen: false });
    this.port = port;
    this.ready = false;

    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
    parser.on('data', (line: string) => this.onLine(line));
    port.on('error', (err) => this.log(`error: ${err.message}`));
    port.on('close', () => {
      if (this.port !== port) return;
      this.log('port closed');
      this.port = null;
      this.ready = false;
      this.scheduleReconnect();
    });

    port.open((err) => {
      if (err) {
        this.log(`open failed (${path}): ${err.message}`);
        if (this.port === port) {
          this.port = null;
          this.scheduleReconnect();
        }
        return;
      }
      // Arm the watchdog; after the DTR reset the board needs ~2s to boot and say READY.
      this.lastRx = Date.now();
      this.log(`opened ${path} @ ${this.baudRate}, waiting for READY`);
    });
  }

  private onLine(line: string): void {
    this.lastRx = Date.now();
    const msg: Inbound = parseInbound(line);
    switch (msg.type) {
      case 'READY':
        this.ready = true;
        this.log('READY');
        this.opts.onReady?.();
        break;
      case 'HB':
        break; // lastRx already refreshed
      case 'IR':
        this.opts.onIr(msg.code);
        break;
      case 'telemetry':
        this.opts.onTelemetry?.({ fan: msg.fan, alarm: msg.alarm, compromised: msg.compromised });
        break;
      case 'unknown':
        if (msg.raw) this.log(`unknown line: ${msg.raw}`);
        break;
    }
  }

  private checkWatchdog(): void {
    if (this.stopped || !this.port?.isOpen) return;
    if (Date.now() - this.lastRx > this.heartbeatTimeoutMs) {
      this.log(`heartbeat timeout (>${this.heartbeatTimeoutMs}ms); reconnecting`);
      this.teardown();
      this.scheduleReconnect();
    }
  }

  private teardown(): void {
    const port = this.port;
    this.port = null;
    this.ready = false;
    if (port?.isOpen) port.close(() => undefined);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.reconnectDelayMs);
  }
}
