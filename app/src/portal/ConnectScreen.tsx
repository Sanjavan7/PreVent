// The landing / entry hero. A dark "mission-control" opening that states the
// niche plainly — exploits for the one ventilator keeping someone breathing —
// over a living ECG trace whose R-spike is the real vulnerability (CWE-306).
// The portal still waits for real hardware before anything scans; the device
// code (GitHub repo or uploaded folder) and the status live inside the hero.

import { useRef, useState, type ChangeEvent } from 'react';
import type { Pipeline } from './usePipeline';

const CODE_EXT = /\.(py|ino|c|cpp|h|hpp|ts|tsx|js|jsx|go|rs|java|rb|yaml|yml)$/i;

// Build a repeating ECG trace (P wave, QRS complex, T wave) across `beats`.
function ecgPath(beats: number, w: number, midY: number): string {
  let d = `M0 ${midY}`;
  for (let i = 0; i < beats; i++) {
    const x = i * w;
    d +=
      ` H${x + w * 0.28}` +
      ` L${x + w * 0.34} ${midY - 9}` + ` L${x + w * 0.4} ${midY}` + // P wave
      ` H${x + w * 0.49}` +
      ` L${x + w * 0.53} ${midY + 13}` + // Q
      ` L${x + w * 0.57} ${midY - 44}` + // R spike
      ` L${x + w * 0.61} ${midY + 19}` + // S
      ` L${x + w * 0.65} ${midY}` +
      ` H${x + w * 0.78}` +
      ` L${x + w * 0.84} ${midY - 12}` + ` L${x + w * 0.9} ${midY}` + // T wave
      ` H${x + w}`;
  }
  return d;
}

const ECG_BEATS = 4;
const ECG_W = 150;
const ECG_MID = 70;
const ECG_PATH = ecgPath(ECG_BEATS, ECG_W, ECG_MID);
// Center of the third beat's R-spike — where the "vulnerability" sits.
const FLAW_X = 2 * ECG_W + ECG_W * 0.57;

function HeroVisual() {
  return (
    <div className="pointer-events-none relative hidden min-h-[320px] flex-1 overflow-hidden lg:block" aria-hidden>
      {/* dot-matrix texture */}
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage: 'radial-gradient(rgba(53,201,214,0.18) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage: 'radial-gradient(130% 90% at 70% 45%, #000 20%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(130% 90% at 70% 45%, #000 20%, transparent 75%)',
        }}
      />
      {/* ECG trace */}
      <svg viewBox={`0 0 ${ECG_BEATS * ECG_W} 140`} className="absolute left-0 right-0 top-1/2 -translate-y-1/2" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#35c9d6" stopOpacity="0" />
            <stop offset="85%" stopColor="#35c9d6" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#8af3ff" stopOpacity="1" />
          </linearGradient>
          <filter id="glow" x="-20%" y="-60%" width="140%" height="220%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {/* faint full trace */}
        <path d={ECG_PATH} fill="none" stroke="#1d3a44" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        {/* animated monitor sweep */}
        <path className="ecg-sweep" pathLength={100} d={ECG_PATH} fill="none" stroke="url(#sweep)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" filter="url(#glow)" />
        {/* the vulnerability: a red R-spike */}
        <path
          d={`M${FLAW_X - ECG_W * 0.04} ${ECG_MID + 13} L${FLAW_X} ${ECG_MID - 44} L${FLAW_X + ECG_W * 0.04} ${ECG_MID + 19}`}
          fill="none" stroke="#f0565b" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" filter="url(#glow)"
        />
        <circle className="flaw-pulse" cx={FLAW_X} cy={ECG_MID - 44} r="4" fill="#f0565b" />
      </svg>
      {/* floating technical labels */}
      <span className="float-tag absolute left-[8%] top-[18%] font-mono text-[11px]" style={{ color: '#8aa0b4' }}>CVE-2019-6538</span>
      <span className="float-tag absolute right-[10%] top-[26%] font-mono text-[11px]" style={{ color: '#8aa0b4', animationDelay: '1.1s' }}>Arduino UNO R4 WiFi</span>
      <span className="absolute left-1/2 top-[58%] -translate-x-1/2 rounded border px-2 py-1 font-mono text-[11px]" style={{ color: '#f0888c', borderColor: 'rgba(240,86,91,0.4)', background: 'rgba(240,86,91,0.08)' }}>
        CWE-306 · missing auth
      </span>
      <span className="float-tag absolute bottom-[16%] left-[14%] font-mono text-[11px]" style={{ color: '#6f8498', animationDelay: '0.6s' }}>device-service/app.py:333</span>
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
    <div className="relative min-h-0 flex-1 overflow-y-auto" style={{ background: '#0a111d', color: '#e8eef6' }}>
      {/* grid + glow backdrop */}
      <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '44px 44px' }} />
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(120% 80% at 78% 30%, rgba(53,201,214,0.12), transparent 60%)' }} />

      <div className="relative mx-auto flex min-h-full w-full max-w-6xl flex-col items-stretch gap-10 px-6 py-10 lg:flex-row lg:items-center lg:gap-6 lg:py-0">
        {/* ── left: brand + copy + device code ── */}
        <div className="flex max-w-xl flex-col justify-center">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: '#5f7f8c' }}>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: '#35c9d6' }} />
            Autonomous medical-device security
          </div>

          <h1 className="mt-4 text-6xl font-bold leading-none tracking-tight sm:text-7xl">
            Pre<span style={{ color: '#35c9d6' }}>Vent</span>
          </h1>

          <p className="mt-5 text-2xl font-semibold leading-snug tracking-tight" style={{ color: '#eef3f9' }}>
            We break the ventilator before someone else does.
          </p>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed" style={{ color: '#9fb2c6' }}>
            An autonomous agent fleet that finds, exploits, and patches real vulnerabilities in medical-device firmware — starting with the one keeping a patient breathing. Real hardware. Real exploits. Not a scanner.
          </p>

          {/* status */}
          <div className="mt-6 flex items-center gap-2 font-mono text-[12px]">
            {connected ? (
              <>
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: '#35c9d6', boxShadow: '0 0 10px #35c9d6' }} />
                <span style={{ color: '#35c9d6' }}>{hardware.board ?? 'Device'} connected</span>
                <span style={{ color: '#5f7488' }}>· {hardware.port}</span>
              </>
            ) : (
              <>
                <span className="spinner" style={{ width: 11, height: 11, borderColor: 'rgba(255,255,255,0.25)', borderTopColor: '#35c9d6' }} />
                <span style={{ color: '#8aa0b4' }}>{mode === 'sim' ? 'control service offline — using demo device' : 'scanning USB for an Arduino…'}</span>
              </>
            )}
          </div>

          {/* device code */}
          <div className="mt-5 rounded-lg border p-4" style={{ borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
            <div className="text-[13px] font-medium" style={{ color: '#b9c6d6' }}>Device code</div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <div className="flex flex-1 items-center gap-2 rounded-md border px-2.5" style={{ borderColor: 'rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.25)' }}>
                <span className="shrink-0 font-mono text-[11px]" style={{ color: '#6f8498' }}>github.com/</span>
                <input
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && useRepo()}
                  placeholder="org/repo"
                  className="no-ring min-w-0 flex-1 bg-transparent py-2 font-mono text-sm"
                  style={{ color: '#e8eef6' }}
                />
                <button type="button" onClick={useRepo} className="press no-ring shrink-0 text-[11px] font-semibold" style={{ color: '#35c9d6' }}>
                  use
                </button>
              </div>
              <button
                type="button"
                onClick={() => folderRef.current?.click()}
                className="press rounded-md px-3 py-2 text-sm"
                style={{ background: 'rgba(255,255,255,0.06)', color: '#c3d0de' }}
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
              <div className="mt-2 font-mono text-[11px]" style={{ color: '#9fb2c6' }}>
                {source.kind === 'repo' ? 'repo' : 'folder'}: <span style={{ color: '#35c9d6' }}>{source.label}</span>
                {source.files.length ? <span style={{ color: '#6f8498' }}> · {source.files.length} source files</span> : null}
              </div>
            )}

            {files.length > 0 && (
              <ul className="mt-3 max-h-32 overflow-y-auto [overscroll-behavior:contain]" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                {files.slice(0, 40).map((p) => (
                  <li key={p} className="truncate py-1.5 font-mono text-[11px]" style={{ color: '#aebccb', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            onClick={onStart}
            disabled={!connected}
            className="press mt-6 w-fit rounded-md px-6 py-3 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: connected ? '#35c9d6' : 'rgba(255,255,255,0.08)', color: connected ? '#06222a' : '#8aa0b4' }}
          >
            {connected ? 'Scan device code →' : 'Waiting for device…'}
          </button>
        </div>

        {/* ── right: the ECG + the flaw ── */}
        <HeroVisual />
      </div>
    </div>
  );
}
