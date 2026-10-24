// Claude's ranking — every finding ordered by severity/CVSS, exploitable ones
// marked, decoys demoted. This is the "which do we attack first" decision made
// legible.

import type { RankedFinding } from '../types';

function severityTone(sev: string): string {
  const s = sev.toUpperCase();
  if (s === 'ERROR' || s === 'HIGH') return 'text-danger-fg';
  if (s === 'MEDIUM' || s === 'WARNING') return 'text-warn-fg';
  return 'text-text-muted';
}

export function RankPanel({ ranking }: { ranking: RankedFinding[] }) {
  return (
    <section className="panel flex flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-overline uppercase text-text-muted">Ranked findings</span>
        <span className="font-mono text-meta text-text-muted">{ranking.length}</span>
      </header>
      {ranking.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-text-muted">
          Waiting for the scan to return findings.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {ranking.map((r) => (
            <li
              key={r.finding.id}
              className={`flex gap-3 px-3 py-2.5 ${r.real && r.rank === 1 ? 'bg-danger-bg' : ''}`}
            >
              <span className="mt-0.5 w-5 shrink-0 text-center font-mono text-sm font-semibold tabular-nums text-text">
                {r.rank}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-overline uppercase ${severityTone(r.finding.severity)}`}>
                    {r.finding.severity}
                  </span>
                  {r.cvss != null && (
                    <span className="font-mono text-meta text-text-secondary">CVSS {r.cvss}</span>
                  )}
                  {r.real ? (
                    <span className="rounded-sm bg-danger-bg px-1.5 py-0.5 text-overline uppercase text-danger-fg">
                      exploitable
                    </span>
                  ) : (
                    <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-overline uppercase text-text-muted">
                      decoy
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate font-mono text-meta text-text-secondary">
                  {r.finding.scanner} · {r.finding.file}:{r.finding.line}
                </div>
                <p className="mt-0.5 text-sm leading-snug text-text-secondary">{r.verdict}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
