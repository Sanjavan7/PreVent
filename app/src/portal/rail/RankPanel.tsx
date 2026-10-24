// Claude's ranking — findings ordered by CVSS, exploitable ones marked and
// decoys demoted. The "which do we attack first" decision, made legible.

import type { RankedFinding } from '../types';

function severityTone(sev: string): string {
  const s = sev.toUpperCase();
  if (s === 'ERROR' || s === 'HIGH') return 'text-danger-fg';
  if (s === 'MEDIUM' || s === 'WARNING') return 'text-warn-fg';
  return 'text-text-muted';
}

export function RankPanel({ ranking }: { ranking: RankedFinding[] }) {
  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center justify-between px-3.5 py-2.5">
        <span className="text-sm font-medium text-text-secondary">Ranked findings</span>
        {ranking.length > 0 && (
          <span className="font-mono text-meta text-text-muted">
            {ranking.filter((r) => r.real).length} exploitable of {ranking.length}
          </span>
        )}
      </header>

      {ranking.length === 0 ? (
        <p className="border-t border-border px-3.5 py-5 text-sm text-text-muted">
          The scan hasn’t returned findings yet.
        </p>
      ) : (
        <ul>
          {ranking.map((r) => (
            <li
              key={r.finding.id}
              className={`flex gap-3 border-t border-border px-3.5 py-2.5 ${r.real ? 'border-l-2 border-l-danger' : 'border-l-2 border-l-transparent'}`}
            >
              <span className="mt-px w-4 shrink-0 font-mono text-sm font-semibold tabular-nums text-text-secondary">
                {r.rank}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={`text-meta font-medium ${severityTone(r.finding.severity)}`}>
                    {r.finding.severity.toLowerCase()}
                  </span>
                  {r.cvss != null && (
                    <span className="font-mono text-meta text-text-secondary">CVSS {r.cvss}</span>
                  )}
                  <span className={`text-meta ${r.real ? 'text-danger-fg' : 'text-text-muted'}`}>
                    {r.real ? 'exploitable' : 'decoy'}
                  </span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-text-muted">
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
