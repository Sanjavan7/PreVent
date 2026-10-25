// The entry point: the portal waits for real hardware, then takes the code to
// scan — pasted as a public GitHub repo or uploaded as a folder. Nothing scans
// until a device is detected over USB.

import { useRef, useState, type ChangeEvent } from 'react';
import type { Pipeline } from './usePipeline';

const CODE_EXT = /\.(py|ino|c|cpp|h|hpp|ts|tsx|js|jsx|go|rs|java|rb|yaml|yml)$/i;

function Beacon({ connected }: { connected: boolean }) {
  return (
    <div className={`relative flex h-32 w-32 items-center justify-center ${connected ? 'text-success' : 'text-accent'}`}>
      {!connected && (
        <>
          <span className="beacon-ping absolute h-24 w-24" />
          <span className="beacon-ping absolute h-24 w-24" style={{ animationDelay: '0.95s' }} />
          <span className="absolute h-24 w-24 rounded-full border border-border" />
        </>
      )}
      <span className={connected ? 'h-4 w-4 rounded-full bg-success' : 'beacon-core h-6 w-6'} />
    </div>
  );
}

interface Source {
  kind: 'repo' | 'folder';
  label: string;
  files: string[];
}

export function ConnectScreen({ pipeline, onStart }: { pipeline: Pipeline; onStart: () => void }) {
  const { hardware, target, mode } = pipeline;
  const connected = hardware.connected;
  const [repoUrl, setRepoUrl] = useState('');
  const [source, setSource] = useState<Source | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const useRepo = () => {
    const u = repoUrl.trim();
    if (!u) return;
    const name = u.replace(/\.git$/, '').split('/').slice(-2).join('/') || u;
    setSource({ kind: 'repo', label: name, files: [] });
  };

  const onFolder = (e: ChangeEvent<HTMLInputElement>) => {
    const all = Array.from(e.target.files ?? []);
    const code = all.filter((f) => CODE_EXT.test(f.name));
    const root = (all[0] as { webkitRelativePath?: string })?.webkitRelativePath?.split('/')[0] ?? 'folder';
    setSource({
      kind: 'folder',
      label: root,
      files: code.map((f) => (f as { webkitRelativePath?: string }).webkitRelativePath || f.name),
    });
  };

  const files = source?.files.length ? source.files : (target?.files.map((f) => f.path) ?? []);

  return (
    <div className="grid-field flex min-h-0 flex-1 flex-col items-center justify-center gap-7 overflow-y-auto p-6">
      {/* beacon + status */}
      <div className="flex flex-col items-center gap-4 text-center">
        <Beacon connected={connected} />
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text">
            {connected ? `${hardware.board ?? 'Device'} connected` : 'Waiting for device'}
          </h2>
          <p className="mt-1.5 max-w-md text-sm text-text-secondary">
            {connected
              ? 'Hardware detected. Give it the code to scan, then start.'
              : 'Plug the device into USB. The scan starts from real hardware — the portal detects the board before it reads a line of code.'}
          </p>
        </div>
        {connected ? (
          <span className="font-mono text-meta text-success-fg">{hardware.port}</span>
        ) : (
          <span className="flex items-center gap-2 font-mono text-meta text-text-muted">
            <span className="spinner" style={{ width: 11, height: 11 }} />
            {mode === 'sim' ? 'control service offline — using demo device' : 'scanning USB for an Arduino…'}
          </span>
        )}
      </div>

      {/* upload files */}
      <div className="panel w-full max-w-xl p-4">
        <div className="text-sm font-medium text-text-secondary">Device code</div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <div className="state-transition flex flex-1 items-center gap-2 rounded-sm border border-border bg-surface-2 px-2.5 focus-within:border-accent-border">
            <span className="shrink-0 font-mono text-meta text-text-muted">github.com/</span>
            <input
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && useRepo()}
              placeholder="org/repo"
              className="no-ring min-w-0 flex-1 bg-transparent py-2 font-mono text-sm text-text placeholder:text-text-muted"
            />
            <button type="button" onClick={useRepo} className="press no-ring shrink-0 text-meta font-medium text-accent-fg">
              use
            </button>
          </div>
          <button
            type="button"
            onClick={() => folderRef.current?.click()}
            className="press state-transition rounded-sm bg-surface-2 px-3 py-2 text-sm text-text-secondary hover:bg-surface-3"
          >
            Upload folder
          </button>
          <input
            ref={(el) => {
              if (el) {
                el.setAttribute('webkitdirectory', '');
                el.setAttribute('directory', '');
              }
            }}
            type="file"
            multiple
            onChange={onFolder}
            className="hidden"
          />
        </div>

        {source && (
          <div className="mt-2 font-mono text-meta text-text-secondary">
            {source.kind === 'repo' ? 'repo' : 'folder'}: <span className="text-accent-fg">{source.label}</span>
            {source.files.length ? <span className="text-text-muted"> · {source.files.length} source files</span> : null}
          </div>
        )}

        {files.length > 0 && (
          <ul className="mt-3 max-h-40 overflow-y-auto border-t border-border [overscroll-behavior:contain]">
            {files.slice(0, 40).map((p) => (
              <li key={p} className="flex items-center justify-between border-b border-border py-1.5 last:border-b-0">
                <span className="truncate font-mono text-meta text-text">{p}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={onStart}
        disabled={!connected}
        className="press state-transition rounded-sm bg-accent-bg px-5 py-2.5 text-sm font-medium text-accent-fg hover:bg-surface-3 disabled:opacity-40"
      >
        {connected ? 'Scan device code' : 'Waiting for device…'}
      </button>
    </div>
  );
}
