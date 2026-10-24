// Backend factory - the ONE place that decides which realtime backend is live.
// Selection: VITE_REALTIME_BACKEND = spacetimedb | convex | mock (see .env.example).
//
// spacetime.ts imports the GENERATED ../module_bindings, so it is loaded lazily: `mock` and
// `convex` work (and typecheck-in-isolation consumers can run) before bindings exist.

import { ConvexBackend } from './convex';
import { MockBackend } from './mock';
import type { BackendKind, RealtimeBackend } from './RealtimeBackend';

export * from './RealtimeBackend';
export { MockBackend } from './mock';
export { ConvexBackend } from './convex';
export type { ConvexConfig } from './convex';
export type { SpacetimeConfig } from './spacetime';

type Env = Record<string, string | undefined>;

function readEnv(): Env {
  // Vite exposes import.meta.env; Node services use process.env.
  const meta = (import.meta as unknown as { env?: Env }).env;
  const proc = typeof process !== 'undefined' ? (process.env as Env) : {};
  return { ...proc, ...meta };
}

export async function createBackend(
  kind?: BackendKind,
  env: Env = readEnv()
): Promise<RealtimeBackend> {
  const k = (kind ?? env.VITE_REALTIME_BACKEND ?? 'mock') as BackendKind;
  switch (k) {
    case 'spacetimedb': {
      const { SpacetimeBackend } = await import('./spacetime');
      return new SpacetimeBackend({
        uri: env.VITE_SPACETIMEDB_URI ?? 'ws://localhost:3000',
        moduleName: env.VITE_SPACETIMEDB_MODULE ?? 'prevent',
        token: env.SPACETIMEDB_TOKEN, // TODO(dev): per-service token (bridge/agents), unset in browser
      });
    }
    case 'convex':
      if (!env.VITE_CONVEX_URL) throw new Error('VITE_CONVEX_URL is not set');
      return new ConvexBackend({ url: env.VITE_CONVEX_URL });
    case 'mock':
      return new MockBackend();
  }
}
