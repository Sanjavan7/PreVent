// Opens the real source at a finding's location, syntax-highlighted, with the
// vulnerable line marked. Fetches the full file from the control service; if
// that's unavailable it shows the honest bundled excerpt. This is the "click a
// finding, see where it actually is in the code" payoff.

import { useEffect, useRef, useState } from 'react';
import { api, type ScanFinding } from '../api';
import { SIM_CODE } from '../fixtures';
import { CODE_THEME, getHighlighter } from './highlighter';

// Only the grammars the highlighter actually loads (see highlighter.ts). An
// unknown extension falls back to 'text' (always available) so an arbitrary
// repo's files never throw in codeToHtml.
function langFor(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith('.ino') || p.endsWith('.c') || p.endsWith('.cpp') || p.endsWith('.h') || p.endsWith('.hpp')) return 'cpp';
  if (p.endsWith('.py')) return 'python';
  if (p.endsWith('.yaml') || p.endsWith('.yml')) return 'yaml';
  if (p.endsWith('.tsx')) return 'tsx';
  if (p.endsWith('.ts')) return 'typescript';
  if (p.endsWith('.jsx') || p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs')) return 'javascript';
  if (p.endsWith('.go')) return 'go';
  if (p.endsWith('.rs')) return 'rust';
  if (p.endsWith('.java')) return 'java';
  if (p.endsWith('.rb')) return 'ruby';
  if (p.endsWith('.php')) return 'php';
  if (p.endsWith('.json')) return 'json';
  if (p.endsWith('.sh') || p.endsWith('.bash')) return 'bash';
  return 'text';
}

interface Loaded {
  content: string;
  startLine: number;
  lang: string;
  excerpt: boolean;
}

async function loadCode(finding: ScanFinding, repo: boolean): Promise<Loaded> {
  // Frontend decides the grammar from the path (robust across arbitrary repos);
  // the backend lang field is only the demo device's limited set.
  const lang = langFor(finding.file);
  try {
    const f = repo ? await api.repoFile(finding.file) : await api.file(finding.file);
    return { content: f.content, startLine: 1, lang, excerpt: false };
  } catch {
    const ex = SIM_CODE[finding.file];
    if (ex) return { content: ex.content, startLine: ex.startLine, lang, excerpt: true };
    return { content: `// ${finding.file}:${finding.line}\n// source unavailable offline`, startLine: finding.line, lang, excerpt: true };
  }
}

export function CodeViewer({ finding, repo = false }: { finding: ScanFinding; repo?: boolean }) {
  const [html, setHtml] = useState('');
  const [meta, setMeta] = useState<Loaded | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setHtml('');
    void loadCode(finding, repo).then(async (loaded) => {
      if (!alive) return;
      setMeta(loaded);
      const vulnRel = finding.line - loaded.startLine + 1;
      const hl = await getHighlighter();
      const out = hl.codeToHtml(loaded.content, {
        lang: loaded.lang,
        theme: CODE_THEME,
        transformers: [
          {
            line(node, n) {
              const absolute = loaded.startLine + n - 1;
              node.properties['data-ln'] = String(absolute);
              if (n === vulnRel) this.addClassToHast(node, 'vuln-line');
            },
          },
        ],
      });
      if (alive) setHtml(out);
    });
    return () => {
      alive = false;
    };
  }, [finding, repo]);

  // Scroll the marked line into view once rendered.
  useEffect(() => {
    if (!html || !scrollRef.current) return;
    const el = scrollRef.current.querySelector('.vuln-line');
    el?.scrollIntoView({ block: 'center' });
  }, [html]);

  const real = finding.scanner === 'semgrep';

  return (
    <section className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-pill px-2 py-0.5 text-overline uppercase ${real ? 'border border-danger-border bg-danger-bg text-danger-fg' : 'border border-border bg-surface-2 text-text-secondary'}`}>
              {finding.cwe ?? finding.ruleId}
            </span>
            {finding.cveRef && (
              <span className="rounded-pill border border-accent-border bg-accent-bg px-2 py-0.5 font-mono text-overline text-accent-fg">
                {finding.cveRef}
              </span>
            )}
          </div>
          <p className="mt-1.5 max-w-prose text-sm leading-snug text-text-secondary">{finding.message}</p>
        </div>
        <span className="shrink-0 font-mono text-meta text-text-muted">
          {finding.file}:{finding.line}
        </span>
      </header>

      <div ref={scrollRef} className="codeblock min-h-0 flex-1 overflow-auto border-t border-border [overscroll-behavior:contain]">
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className="flex h-full items-center justify-center text-meta text-text-muted">loading source…</div>
        )}
      </div>

      {meta?.excerpt && (
        <div className="border-t border-border px-4 py-1.5 font-mono text-[11px] text-text-muted">
          excerpt — run the control service for the full file
        </div>
      )}
    </section>
  );
}
