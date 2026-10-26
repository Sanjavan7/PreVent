// Human-gate CONTROL SERVER (PLAN-DEV1 task 3). The gate must block until a
// REAL dashboard click resolves it - not an auto-approve timer. This module is
// that control surface: a dependency-free node:http server the Dev 3 dashboard
// POSTs to. On the dashboard's "APPROVE & DEPLOY" click it POSTs /approve,
// which calls `gate.resolve({ approved:true, approvedBy })` on the currently
// mounted HumanGate (the promise `canUseTool` is awaiting). It also exposes a
// /ir route so the judge's IR press can be injected without hardware, and
// read-only /state + /health for the dashboard to poll.
//
// ESM, bundler resolution (no file extensions). Type-only imports use
// `import type` per verbatimModuleSyntax. NO new dependencies (node:http only).

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { HumanGate } from './humanGate';
import type { RealtimeBackend } from './realtime/backend';
import { CONTROL_PORT } from './constants';

// The control plane binds to loopback only (see start()), so it is never
// network-reachable; this CORS allows the local dashboard (a separate port) to
// call it. State-changing routes are additionally guarded by `authorized()`.
const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Control-Token',
};

// Loopback is the primary protection; set CONTROL_TOKEN to additionally require
// `Authorization: Bearer <token>` (or an `X-Control-Token` header) on the
// state-changing routes, as defense-in-depth against a local cross-origin caller.
const CONTROL_TOKEN = process.env.CONTROL_TOKEN ?? '';

function authorized(req: IncomingMessage): boolean {
  if (!CONTROL_TOKEN) return true; // loopback-only; token enforcement is opt-in
  const header = req.headers['authorization'];
  const bearer = typeof header === 'string' ? header.replace(/^Bearer\s+/i, '').trim() : '';
  const alt = req.headers['x-control-token'];
  const token = bearer || (typeof alt === 'string' ? alt.trim() : '');
  return token.length > 0 && token === CONTROL_TOKEN;
}

/**
 * Local HTTP control plane for the human-approval gate. Construct with the
 * active RealtimeBackend, `setGate()` the HumanGate the APPLY stage is using,
 * then `start()`. The dashboard's APPROVE click settles the gate via /approve.
 */
export class ControlServer {
  private server: Server | null = null;
  private currentGate: HumanGate | null = null;
  private boundPort: number | null = null;

  constructor(private backend: RealtimeBackend) {}

  /** The actual port the server bound to (may differ from the requested port
   * if an ephemeral fallback was used), or null before `start()`. */
  get port(): number | null {
    return this.boundPort;
  }

  /** Mounts (or clears, with `null`) the gate that /approve and /reject settle. */
  setGate(gate: HumanGate | null): void {
    this.currentGate = gate;
  }

  /** Starts listening; resolves once accepting connections. If the requested
   * port is already in use, retries ONCE on an OS-assigned ephemeral port so a
   * live run never silently fails to expose the APPROVE surface and then hangs
   * forever at the human gate. Logs (and records) the ACTUAL bound port. */
  start(port: number = CONTROL_PORT): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handle(req, res);
      });
      let triedEphemeral = false;
      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && !triedEphemeral) {
          triedEphemeral = true;
          void this.backend.logEvent('control', `Port ${port} in use; retrying on an ephemeral port.`);
          server.listen(0, '127.0.0.1');
          return;
        }
        reject(err);
      });
      server.on('listening', () => {
        this.server = server;
        const addr = server.address();
        this.boundPort = addr && typeof addr === 'object' ? addr.port : port;
        void this.backend.logEvent('control', `Control server listening at http://127.0.0.1:${this.boundPort}`);
        resolve();
      });
      // Bind to loopback only: this is a local control plane, never exposed to
      // the network (it settles the human-approval gate and injects IR events).
      server.listen(port, '127.0.0.1');
    });
  }

  /** Stops the server; resolves once fully closed. No-op if not started. */
  stop(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        this.server = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const method = req.method ?? 'GET';
      // Strip any query string / resolve against a dummy base for the pathname.
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;

      // CORS preflight.
      if (method === 'OPTIONS') {
        this.send(res, 204, {});
        return;
      }

      if (method === 'GET' && path === '/health') {
        this.send(res, 200, { ok: true });
        return;
      }

      if (method === 'GET' && path === '/state') {
        const [device, agents] = await Promise.all([
          this.backend.getDeviceStatus(),
          this.backend.getAgentStatuses(),
        ]);
        this.send(res, 200, { device, agents });
        return;
      }

      // State-changing routes require auth when CONTROL_TOKEN is set.
      if (method === 'POST' && !authorized(req)) {
        this.send(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }

      if (method === 'POST' && path === '/approve') {
        const body = await readJsonBody(req);
        const gate = this.currentGate;
        if (gate && gate.getPending()) {
          const approvedBy = typeof body.approvedBy === 'string' ? body.approvedBy : 'dashboard';
          gate.resolve({ approved: true, approvedBy });
          this.send(res, 200, { ok: true });
        } else {
          this.send(res, 409, { ok: false, error: 'no pending approval' });
        }
        return;
      }

      if (method === 'POST' && path === '/reject') {
        const body = await readJsonBody(req);
        const gate = this.currentGate;
        if (gate && gate.getPending()) {
          const approvedBy = typeof body.approvedBy === 'string' ? body.approvedBy : 'dashboard';
          gate.resolve({ approved: false, approvedBy });
          this.send(res, 200, { ok: true });
        } else {
          this.send(res, 409, { ok: false, error: 'no pending approval' });
        }
        return;
      }

      if (method === 'POST' && path === '/ir') {
        const body = await readJsonBody(req);
        const code = Number(body.code);
        await this.backend.pushIrEvent(code);
        this.send(res, 200, { ok: true, code });
        return;
      }

      this.send(res, 404, { ok: false, error: 'not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.send(res, 500, { ok: false, error: message });
    }
  }

  private send(res: ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, JSON_HEADERS);
    res.end(JSON.stringify(payload));
  }
}

/**
 * Reads and JSON-parses a request body defensively: an empty or malformed body
 * yields `{}` rather than throwing, so a bare POST (no body) still works.
 */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
