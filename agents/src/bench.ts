// Loop-timing + 10x repeatability harness (PLAN-DEV1 task 5 acceptance: the
// express pipeline "survives 10+ resets within the express budget"). Runs the
// real orchestrator loop N times against ONE shared MockRealtimeBackend, times
// each iteration with process.hrtime.bigint(), and fails (exit 1) if any run
// throws or exceeds the express budget.
//
// This harness forces the express + dry path so it measures the demo's own
// loop timing, not real Claude/Droid/network latency:
//   - PREVENT_EXPRESS=1  -> reuse cached GROUND/GENERATE, skip slow narration.
//   - ANTHROPIC_API_KEY=''-> DRY_RUN (no live query(); the human gate is
//                            exercised via its dry-run auto-approve instead of
//                            blocking on a dashboard POST /approve).
//   - PREVENT_CONTROL_PORT=0 -> each run's ControlServer binds an OS-assigned
//                            ephemeral port, so repeated start/stop cycles can
//                            never collide on a fixed port.
// These MUST be set BEFORE the orchestrator module is imported, because
// constants.ts (CONTROL_PORT) and orchestrator.ts (DRY_RUN/EXPRESS) read them
// at module-evaluation time. We therefore dynamic-import the orchestrator only
// after the env is in place. dotenv (loaded by ./env inside the orchestrator)
// does not override an already-present key, so ANTHROPIC_API_KEY='' sticks.
//
// Invocation: `pnpm bench`. Tunables:
//   PREVENT_BENCH_RUNS       (default 10)    number of iterations
//   PREVENT_EXPRESS_BUDGET_MS(default 90000) per-run budget; exceed -> FAIL
//
// ESM, bundler module resolution (no file extensions). Type-only imports use
// `import type` per verbatimModuleSyntax. NO new dependencies.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNS = Number(process.env.PREVENT_BENCH_RUNS ?? 10) || 10;
const BUDGET_MS = Number(process.env.PREVENT_EXPRESS_BUDGET_MS ?? 90000) || 90000;

// --- Force the express + dry path BEFORE importing the orchestrator ---------
process.env.PREVENT_EXPRESS = '1';
process.env.PREVENT_CONTROL_PORT = process.env.PREVENT_CONTROL_PORT ?? '0';
// Force DRY_RUN for a deterministic, keyless loop. Setting the key to '' (not
// deleting it) means dotenv's non-overriding config() leaves it empty, so the
// orchestrator's `DRY_RUN = !ANTHROPIC_API_KEY` stays true.
process.env.ANTHROPIC_API_KEY = '';

interface RunRecord {
  run: number;
  ms: number;
  ok: boolean;
  error?: string;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function fmtMs(ms: number): string {
  return `${ms.toFixed(1)} ms`;
}

async function main(): Promise<void> {
  // Dynamic imports AFTER the env is forced above.
  const { runPipeline } = await import('./orchestrator');
  const { MockRealtimeBackend } = await import('./realtime/backend');

  const backend = new MockRealtimeBackend();
  const records: RunRecord[] = [];

  // eslint-disable-next-line no-console
  console.log(`\n[bench] Running express/dry pipeline ${RUNS}x (budget ${BUDGET_MS} ms/run)...\n`);

  for (let i = 1; i <= RUNS; i++) {
    // Reset shared backend between runs so nothing leaks across iterations.
    await backend.resetHealthy();

    const started = process.hrtime.bigint();
    let ok = true;
    let error: string | undefined;
    try {
      await runPipeline(backend);
    } catch (err) {
      ok = false;
      error = err instanceof Error ? err.message : String(err);
    }
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    records.push({ run: i, ms: elapsedMs, ok, error });
    // eslint-disable-next-line no-console
    console.log(`[bench] run ${i}/${RUNS}: ${fmtMs(elapsedMs)}${ok ? '' : ` THREW: ${error}`}`);
  }

  // --- Table ----------------------------------------------------------------
  // eslint-disable-next-line no-console
  console.log('\n  run |      ms | status');
  // eslint-disable-next-line no-console
  console.log('  ----+---------+-------');
  for (const r of records) {
    const overBudget = r.ms > BUDGET_MS;
    const status = !r.ok ? 'THREW' : overBudget ? 'OVER' : 'ok';
    // eslint-disable-next-line no-console
    console.log(`  ${String(r.run).padStart(3)} | ${r.ms.toFixed(1).padStart(7)} | ${status}`);
  }

  // --- Stats ----------------------------------------------------------------
  const times = records.map((r) => r.ms);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const med = median(times);
  // eslint-disable-next-line no-console
  console.log(
    `\n[bench] min=${fmtMs(min)}  median=${fmtMs(med)}  max=${fmtMs(max)}  mean=${fmtMs(mean)}`,
  );

  // --- Verdict --------------------------------------------------------------
  const threw = records.filter((r) => !r.ok);
  const overBudget = records.filter((r) => r.ok && r.ms > BUDGET_MS);
  const pass = threw.length === 0 && overBudget.length === 0;

  if (pass) {
    // eslint-disable-next-line no-console
    console.log(
      `\n[bench] PASS: ${RUNS}/${RUNS} runs completed, all within the ${BUDGET_MS} ms express budget (max ${fmtMs(max)}).`,
    );
  } else {
    // eslint-disable-next-line no-console
    console.log(
      `\n[bench] FAIL: ${threw.length} run(s) threw, ${overBudget.length} run(s) exceeded the ${BUDGET_MS} ms budget (max ${fmtMs(max)}).`,
    );
  }

  process.exitCode = pass ? 0 : 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[bench] harness failed:', err);
    process.exitCode = 1;
  });
}
