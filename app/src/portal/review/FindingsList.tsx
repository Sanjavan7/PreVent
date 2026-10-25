// Ranked findings. Click one to open its real code in the viewer. While the
// scan is still streaming, findings appear in arrival order; once ranking lands
// they reorder by CVSS with exploitable ones marked.

import type { RankItem, ScanFinding } from '../api';

function sevTone(sev: string): string {
  const s = sev.toUpperCase();
  if (s === 'ERROR' || s === 'HIGH') return 'text-danger-fg';
  if (s === 'MEDIUM' || s === 'WARNING') return 'text-warn-fg';
  return 'text-text-muted';
}

interface Props {
  findings: ScanFinding[];
  ranking: RankItem[];
  selectedId: number | null;
  onSelect: (f: ScanFinding) => void;
  scanning: boolean;
}

export function FindingsList({ findings, ranking, selectedId, onSelect, scanning }: Props) {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const rows = ranking.length
    ? ranking.map((r) => ({ rank: r.rank, rankItem: r, finding: byId.get(r.findingId) })).filter((x) => x.finding)
    : findings.map((f, i) => ({ rank: i + 1, rankItem: undefined as RankItem | undefined, finding: f }));

  const exploitable = ranking.filter((r) => r.real).length;

  return (
    <section className="panel flex min-h-0 flex-col overflow-hidden">
      <header className="flex items-center justify-between px-3.5 py-2.5">
        <span className="text-sm font-medium text-text-secondary">Findings</span>
        <span className="font-mono text-meta text-text-muted">
          {ranking.length ? `${exploitable} exploitable of ${findings.length}` : scanning ? 'scanning…' : `${findings.length}`}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain]">
        {rows.length === 0 ? (
          <p className="border-t border-border px-3.5 py-5 text-sm text-text-muted">
            {scanning ? 'Agents are reading the code…' : 'Run a scan to surface findings.'}
          </p>
        ) : (
          <ul>
            {rows.map(({ rank, rankItem, finding }) => {
              const f = finding!;
              const real = rankItem?.real ?? f.scanner === 'semgrep';
              const selected = selectedId === f.id;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(f)}
                    className={`press flex w-full gap-3 border-t border-border px-3.5 py-2.5 text-left state-transition ${selected ? 'bg-surface-2' : 'hover:bg-surface-2'} ${real ? 'border-l-2 border-l-danger' : 'border-l-2 border-l-transparent'}`}
                  >
                    <span className="mt-px w-4 shrink-0 font-mono text-sm font-semibold tabular-nums text-text-secondary">
                      {rankItem ? rank : '·'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className={`text-meta font-medium ${sevTone(f.severity)}`}>{f.severity.toLowerCase()}</span>
                        {rankItem && <span className="font-mono text-meta text-text-secondary">CVSS {rankItem.cvss}</span>}
                        <span className={`text-meta ${real ? 'text-danger-fg' : 'text-text-muted'}`}>
                          {real ? 'exploitable' : 'decoy'}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-text-muted">
                        {f.ruleId} · {f.file}:{f.line}
                      </span>
                      {rankItem && (
                        <span className="mt-0.5 block text-sm leading-snug text-text-secondary">{rankItem.verdict}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
