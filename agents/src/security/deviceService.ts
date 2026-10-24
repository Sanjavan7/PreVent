// Opt-in device-service lifecycle manager for the LIVE security path
// (PREVENT_SECURITY=python). Mirrors security/loop.py's ServiceController:
// launches Dev 2's Flask device-service as a child process in VULNERABLE or
// PATCHED mode and waits until it answers GET /device/status.
//
// Why the orchestrator needs this: in the real Droid path the patch edits
// app.py (or flips DEVICE_SERVICE_PATCHED), but a RUNNING Flask process keeps
// the old handler loaded. VERIFY only sees the fix (401/403 on an unauth
// command) once the service is RESTARTED in patched mode. This controller does
// that restart. It is strictly opt-in: the mock/dry path never constructs it,
// so a keyless run needs no Python and no service.
//
// ESM, bundler resolution (no file extensions). Type-only imports use
// `import type` per verbatimModuleSyntax. No new dependencies (node:child_process
// + global fetch, Node 18+).

import { spawn, type ChildProcess } from 'node:child_process';

export interface DeviceServiceOptions {
  /** device-service directory (holds app.py). */
  deviceServiceDir: string;
  /** Base URL the service binds to and stage_api targets, e.g.
   * http://127.0.0.1:8071. Host + port are parsed from it. */
  baseUrl: string;
  /** Bearer token the PATCHED handler requires (set only in patched mode, so an
   * unauthenticated exploit replay gets 401). Mirrors loop.py's DEMO_TOKEN. */
  token?: string;
  /** `python` interpreter to launch (PREVENT_PYTHON override). */
  python?: string;
}

/**
 * Launches/stops the Flask device-service in vulnerable or patched mode. One
 * controller per pipeline run; always `stop()` in a finally.
 */
export class DeviceServiceController {
  private proc: ChildProcess | null = null;
  private mode: 'vulnerable' | 'patched' | null = null;
  private readonly host: string;
  private readonly port: number;

  constructor(private readonly opts: DeviceServiceOptions) {
    const url = new URL(opts.baseUrl);
    this.host = url.hostname;
    this.port = Number(url.port || 80);
  }

  /**
   * Start (restarting any current process) in the requested mode, then block
   * until the service answers in the CORRECT mode or the timeout elapses.
   *
   * Readiness probes GET /device/_schema and requires
   * `commandEndpoint.authRequired === patched`: a plain "is the port answering"
   * check would resolve against a STALE service already holding the port (e.g.
   * a crashed prior run's vulnerable process), so VERIFY could run against the
   * wrong build. Matching the advertised mode proves it is the process we meant.
   *
   * A spawn failure (e.g. `python` not on PATH) emits 'error' on the child; we
   * listen for it and reject, rather than letting Node re-throw it as an
   * uncaught exception that would crash the whole orchestrator.
   */
  async start(patched: boolean, timeoutMs = 15_000): Promise<void> {
    await this.stop();
    const python = this.opts.python ?? process.env.PREVENT_PYTHON ?? 'python';
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DEVICE_SERVICE_HOST: this.host,
      DEVICE_SERVICE_PORT: String(this.port),
      DEVICE_SERVICE_PATCHED: patched ? '1' : '0',
      DEVICE_SERVICE_TOKEN: patched ? (this.opts.token ?? 'prevent-demo-token') : '',
      // UTF-8 mode so the service (and anything it shells out to) uses UTF-8
      // pipes/files on Windows instead of the cp1252 locale codec.
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    };
    this.mode = patched ? 'patched' : 'vulnerable';
    const proc = spawn(python, ['app.py'], {
      cwd: this.opts.deviceServiceDir,
      env,
      stdio: 'ignore',
    });
    this.proc = proc;

    // Capture a spawn 'error' (ENOENT etc.) or an early 'exit' as a readable
    // failure the loop below turns into a thrown (catchable) error.
    let failure: string | null = null;
    proc.once('error', (err) => {
      failure = `device-service (${this.mode ?? '?'}) failed to spawn: ${err.message}`;
    });
    proc.once('exit', (code) => {
      if (failure === null && this.mode) failure = `device-service (${this.mode}) exited early (code ${code})`;
    });

    const deadline = Date.now() + timeoutMs;
    const schemaUrl = `${this.opts.baseUrl.replace(/\/$/, '')}/device/_schema`;
    let lastErr = '';
    while (Date.now() < deadline) {
      if (failure) {
        await this.stop();
        throw new Error(failure);
      }
      try {
        const res = await fetch(schemaUrl, { signal: AbortSignal.timeout(1_000) });
        if (res.ok) {
          const body = (await res.json()) as { commandEndpoint?: { authRequired?: unknown } };
          const authRequired = Boolean(body.commandEndpoint?.authRequired);
          if (authRequired === patched) return;
          lastErr = `service reports authRequired=${authRequired}, wanted ${patched} (a stale service may hold port ${this.port})`;
        } else {
          lastErr = `HTTP ${res.status}`;
        }
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
      await delay(150);
    }
    await this.stop();
    throw new Error(`device-service (${patched ? 'patched' : 'vulnerable'}) not ready in ${timeoutMs}ms: ${lastErr}`);
  }

  /** Terminate the child process if running. Resolves once it has exited, with
   * a hard backstop so a process that ignores both SIGTERM and SIGKILL can
   * never hang the pipeline's teardown forever. */
  async stop(): Promise<void> {
    const proc = this.proc;
    this.proc = null;
    this.mode = null;
    if (!proc || proc.exitCode !== null || proc.killed) return;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(killTimer);
        clearTimeout(backstop);
        resolve();
      };
      const killTimer = setTimeout(() => proc.kill('SIGKILL'), 5_000);
      const backstop = setTimeout(finish, 8_000);
      proc.once('exit', finish);
      proc.once('error', finish); // already-dead / unkillable: don't hang
      proc.kill();
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
