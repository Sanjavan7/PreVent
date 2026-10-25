// The entry point: the portal waits for real hardware. Nothing scans until a
// device is plugged in over USB and detected. Once connected, it shows the
// device's codebase and the planted vulnerabilities, and offers to scan.

import type { Pipeline } from './usePipeline';

function WaitingForDevice({ mode }: { mode: string }) {
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span className="absolute h-20 w-20 rounded-full border border-border" />
        <span className="absolute h-14 w-14 rounded-full border border-border-strong" />
        <span className="gem gem--live h-3 w-3 text-accent" />
      </div>
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-text">Waiting for device</h2>
        <p className="mt-1.5 max-w-sm text-sm text-text-secondary">
          Plug the device into USB. The scan starts from real hardware — the portal detects the
          board before it reads a line of code.
        </p>
      </div>
      <div className="flex items-center gap-2 font-mono text-meta text-text-muted">
        <span className="spinner" style={{ width: 11, height: 11 }} />
        {mode === 'sim' ? 'control service offline — using demo device' : 'scanning USB for an Arduino…'}
      </div>
    </div>
  );
}

function DeviceReady({ pipeline, onStart }: { pipeline: Pipeline; onStart: () => void }) {
  const { hardware, target } = pipeline;
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <div className="panel panel--raised flex items-center justify-between gap-4 px-4 py-3.5">
        <div className="flex items-center gap-3">
          <span className="gem h-2.5 w-2.5 text-success" />
          <div>
            <div className="text-base font-semibold text-text">{hardware.board ?? 'Device'} connected</div>
            <div className="font-mono text-meta text-text-muted">{hardware.port ?? '—'}</div>
          </div>
        </div>
        <span className="font-mono text-meta text-success-fg">ready</span>
      </div>

      {target && (
        <div className="panel overflow-hidden">
          <header className="flex items-center justify-between px-4 py-2.5">
            <span className="text-sm font-medium text-text-secondary">Device code</span>
            <span className="font-mono text-meta text-text-muted">{target.files.length} files</span>
          </header>
          <ul className="border-t border-border">
            {target.files.map((f) => (
              <li key={f.path} className="flex items-center justify-between border-b border-border px-4 py-2 last:border-b-0">
                <span className="font-mono text-meta text-text">{f.path}</span>
                <span className="font-mono text-[11px] text-text-muted">
                  {f.lang} · {f.loc} loc
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onStart}
        className="press state-transition self-start rounded-md bg-accent-bg px-4 py-2 text-sm font-medium text-accent-fg hover:bg-surface-3"
      >
        Scan device code
      </button>
    </div>
  );
}

export function ConnectScreen({ pipeline, onStart }: { pipeline: Pipeline; onStart: () => void }) {
  return (
    <div className="grid-field flex min-h-0 flex-1 items-center justify-center p-6">
      {pipeline.hardware.connected ? (
        <DeviceReady pipeline={pipeline} onStart={onStart} />
      ) : (
        <WaitingForDevice mode={pipeline.mode} />
      )}
    </div>
  );
}
