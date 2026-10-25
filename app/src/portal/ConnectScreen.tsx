// The entry point: the portal waits for real hardware, then takes the code to
// scan — a public GitHub repo (cloned and scanned for real by the control
// plane) or a locally uploaded folder. Nothing scans until a device is detected.
//
// Visually this is the one signature "teal hero" surface (Vanta-style): a
// full-bleed teal field with a 1px crystal frame, a dot texture, floating
// frosted chips, and an editorial serif headline. The working console past
// here stays white-dominant and calm.

import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { Pipeline } from './usePipeline';
import { GitHubMark } from './icons/GitHubMark';
import { ArrowCircle } from './icons/ArrowCircle';
import { staggerParent, revealChild, revealReduced } from '../lib/motion';

const CODE_EXT = /\.(py|ino|c|cpp|h|hpp|ts|tsx|js|jsx|go|rs|java|rb|yaml|yml)$/i;
const SAFE_SEG = /^[A-Za-z0-9._-]+$/;

/** Accept a full URL (https or git@), or bare owner/repo, and return the
 *  {owner, name} when both are safe identifiers. Null when it can't be read. */
export function parseRepo(input: string): { owner: string; name: string } | null {
  const raw = input.trim();
  if (!raw) return null;
  let owner: string | undefined;
  let name: string | undefined;
  const m = raw.match(/github\.com[:/]+([^/\s]+)\/([^/\s#?]+)/i);
  if (m) {
    owner = m[1];
    name = m[2];
  } else {
    const parts = raw.split('/').filter(Boolean);
    if (parts.length >= 2) {
      owner = parts[parts.length - 2];
      name = parts[parts.length - 1];
    }
  }
  if (!owner || !name) return null;
  name = name.replace(/\.git$/i, '');
  if (!SAFE_SEG.test(owner) || !SAFE_SEG.test(name)) return null;
  return { owner, name };
}

function Beacon({ connected, reduce }: { connected: boolean; reduce: boolean }) {
  return (
    <div className="relative flex h-28 w-28 items-center justify-center text-white">
      {!connected && (
        <>
          {!reduce && (
            <>
              <span className="beacon-ping absolute h-24 w-24" />
              <span className="beacon-ping absolute h-24 w-24" style={{ animationDelay: '0.95s' }} />
            </>
          )}
          <span className="absolute h-24 w-24 rounded-full border border-white/40" />
        </>
      )}
      {connected ? (
        <span className="h-4 w-4 rounded-full bg-success [box-shadow:0_0_0_6px_rgba(255,255,255,0.18)]" />
      ) : (
        <span className="beacon-core h-6 w-6" />
      )}
    </div>
  );
}

export function ConnectScreen({
  pipeline,
  onStart,
}: {
  pipeline: Pipeline;
  onStart: (repo?: { owner: string; name: string }) => void;
}) {
  const { hardware, mode, scanError } = pipeline;
  const connected = hardware.connected;
  const reduce = !!useReducedMotion();
  const child = reduce ? revealReduced : revealChild;
  const [repoUrl, setRepoUrl] = useState('');
  const [folder, setFolder] = useState<{ label: string; files: string[] } | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const trimmed = repoUrl.trim();
  const repo = useMemo(() => parseRepo(repoUrl), [repoUrl]);
  const repoInvalid = trimmed.length > 0 && !repo;

  const start = () => {
    if (repoInvalid) return;
    onStart(repo ?? undefined);
  };

  const onFolder = (e: ChangeEvent<HTMLInputElement>) => {
    const all = Array.from(e.target.files ?? []);
    const code = all.filter((f) => CODE_EXT.test(f.name));
    const root = (all[0] as { webkitRelativePath?: string })?.webkitRelativePath?.split('/')[0] ?? 'folder';
    setFolder({
      label: root,
      files: code.map((f) => (f as { webkitRelativePath?: string }).webkitRelativePath || f.name),
    });
  };

  // Only preview files the user explicitly uploaded. On connect we just say
  // "ready" — we don't list the device's own source.
  const files = folder?.files ?? [];

  const scanLabel = !connected ? 'Waiting for device…' : repo ? `Scan ${repo.owner}/${repo.name}` : 'Scan device code';

  return (
    <section className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4 sm:p-8">
      <div
        className="relative w-full max-w-[1280px] overflow-hidden rounded-[var(--radius-xl)] px-6 py-14 text-center sm:px-16 sm:py-20"
        style={{ backgroundImage: 'radial-gradient(120% 120% at 50% 0%, #0aa3a2 0%, #008f8e 45%, #00716f 100%)' }}
      >
        {/* crystal frame + dot texture */}
        <div className="pointer-events-none absolute inset-0 rounded-[var(--radius-xl)] [box-shadow:inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_1px_0_0_rgba(255,255,255,0.65)]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.14] [background-image:radial-gradient(rgba(255,255,255,0.9)_1px,transparent_1px)] [background-size:22px_22px]" />

        {/* floating frosted chips (decorative) */}
        {!reduce && (
          <>
            <motion.div
              aria-hidden
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute left-6 top-14 hidden items-center gap-2 rounded-pill border border-glass-border bg-glass-bg px-3 py-1.5 backdrop-blur-[14px] [box-shadow:var(--shadow-md)] sm:flex"
            >
              <span className="gem text-accent" style={{ width: 6, height: 6 }} />
              <span className="text-meta text-text-secondary">4 scanners</span>
            </motion.div>
            <motion.div
              aria-hidden
              animate={{ y: [0, 7, 0] }}
              transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
              className="absolute bottom-14 right-6 hidden items-center gap-2 rounded-pill border border-glass-border bg-glass-bg px-3 py-1.5 backdrop-blur-[14px] [box-shadow:var(--shadow-md)] sm:flex"
            >
              <span className="font-mono text-meta text-text-secondary">Semgrep · Bandit</span>
            </motion.div>
          </>
        )}

        <motion.div
          variants={staggerParent}
          initial="hidden"
          animate="show"
          className="relative mx-auto flex max-w-xl flex-col items-center gap-7"
        >
          <motion.div variants={child}>
            <Beacon connected={connected} reduce={reduce} />
          </motion.div>

          <motion.div variants={child}>
            <h1 className="font-display text-[40px] font-normal leading-[1.05] tracking-[-0.02em] text-white sm:text-[56px] sm:leading-[1.08]">
              {connected ? `${hardware.board ?? 'Device'} connected` : 'Waiting for device'}
            </h1>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-white/80">
              {connected
                ? 'Hardware detected. Give it the code to scan, then start.'
                : 'Plug the device into USB. The scan starts from real hardware — the portal detects the board before it reads a line of code.'}
            </p>
          </motion.div>

          <motion.div variants={child}>
            {connected ? (
              <span className="font-mono text-meta text-white/90">{hardware.port}</span>
            ) : (
              <span className="flex items-center gap-2 font-mono text-meta text-white/75">
                <span className="spinner spinner-on-teal" style={{ width: 11, height: 11 }} />
                {mode === 'sim' ? 'control service offline — using demo device' : 'scanning USB for an Arduino…'}
              </span>
            )}
          </motion.div>

          {/* choose the code to scan — frosted glass card */}
          <motion.div
            variants={child}
            className="w-full max-w-xl rounded-[var(--radius-lg)] border border-glass-border bg-glass-bg p-4 text-left backdrop-blur-[14px] [box-shadow:var(--shadow-lift)]"
          >
            <div className="text-sm font-medium text-text-secondary">Code to scan</div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <div
                className={`state-transition flex flex-1 items-center gap-2 rounded-[var(--radius-md)] border bg-white/70 px-2.5 focus-within:border-accent ${
                  repoInvalid ? 'border-danger' : 'border-border'
                }`}
              >
                <GitHubMark size={15} className="shrink-0 text-text-muted" />
                <input
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && start()}
                  placeholder="Paste a GitHub repo URL or owner/repo"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="no-ring min-w-0 flex-1 bg-transparent py-2 font-mono text-sm text-text placeholder:text-text-muted"
                />
                {repoUrl && (
                  <button
                    type="button"
                    onClick={() => setRepoUrl('')}
                    className="press no-ring shrink-0 text-meta font-medium text-text-muted hover:text-text"
                    aria-label="Clear"
                  >
                    clear
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => folderRef.current?.click()}
                className="press state-transition shrink-0 rounded-[var(--radius-md)] border border-border bg-white/70 px-3 py-2 text-sm text-text-secondary hover:bg-white"
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

            {/* parsed repo chip / validation hint / prior error */}
            {repo ? (
              <div className="mt-2 flex items-center gap-2 font-mono text-meta text-text-secondary">
                <GitHubMark size={13} className="text-text-muted" />
                <span className="text-accent-fg">{repo.owner}/{repo.name}</span>
                <span className="text-text-muted">· cloned &amp; scanned on the control plane</span>
              </div>
            ) : repoInvalid ? (
              <div className="mt-2 font-mono text-meta text-danger-fg">
                enter a repo as <span className="text-text-secondary">owner/repo</span> or a full github.com URL
              </div>
            ) : folder ? (
              <div className="mt-2 font-mono text-meta text-text-secondary">
                folder: <span className="text-accent-fg">{folder.label}</span>
                {folder.files.length ? <span className="text-text-muted"> · {folder.files.length} source files</span> : null}
              </div>
            ) : scanError ? (
              <div className="mt-2 font-mono text-meta text-danger-fg">{scanError}</div>
            ) : null}

            {files.length > 0 && (
              <ul className="mt-3 max-h-40 overflow-y-auto border-t border-border [overscroll-behavior:contain]">
                {files.slice(0, 40).map((p) => (
                  <li key={p} className="flex items-center justify-between border-b border-border py-1.5 last:border-b-0">
                    <span className="truncate font-mono text-meta text-text">{p}</span>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>

          <motion.button
            variants={child}
            type="button"
            onClick={start}
            disabled={!connected || repoInvalid}
            className="btn group bg-white px-6 py-3 text-[15px] text-accent-fg [box-shadow:var(--shadow-lift)] hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {scanLabel}
            {connected && !repoInvalid && (
              <ArrowCircle size={18} className="text-accent transition-transform group-hover:translate-x-0.5" />
            )}
          </motion.button>
        </motion.div>
      </div>
    </section>
  );
}
