// Opens the real source at a finding's location, syntax-highlighted, with the
// vulnerable line marked. Fetches the full file from the control service; if
// that's unavailable it shows the honest bundled excerpt. This is the "click a
// finding, see where it actually is in the code" payoff.

import { useEffect, useRef, useState } from 'react';
import { api, type ScanFinding } from '../api';
import { SIM_CODE } from '../fixtures';
import { CODE_THEME, getHighlighter } from './highlighter';

function langFor(path: string): string {
  if (path.endsWith('.ino') || path.endsWith('.c') || path.endsWith('.cpp')) return 'cpp';
  if (path.endsWith('.py')) return 'python';
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml';
  return 'text';
}

interface Loaded {
  content: string;
  startLine: number;
  lang: string;
  excerpt: boolean;
}

async function loadCode(finding: ScanFinding): Promise<Loaded> {
  const lang = langFor(finding.file);
  try {
    const f = await api.file(finding.file);
    return { content: f.content, startLine: 1, lang: f.lang || lang, excerpt: false };
  } catch {
    const ex = SIM_CODE[finding.file];
    if (ex) return { content: ex.content, startLine: ex.startLine, lang, excerpt: true };
    return { content: `// ${finding.file}:${finding.line}\n// source unavailable offline`, startLine: finding.line, lang, excerpt: true };
  }
}

export function CodeViewer({ finding }: { finding: ScanFinding }) {
  const [html, setHtml] = useState('');
  const [meta, setMeta] = useState<Loaded | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setHtml('');
    void loadCode(finding).then(async (loaded) => {
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
  }, [finding]);

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
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${real ? 'text-danger-fg' : 'text-text-secondary'}`}>
              {finding.cwe ?? finding.ruleId}
            </span>
            {finding.cveRef && <span className="font-mono text-meta text-accent-fg">{finding.cveRef}</span>}
          </div>
          <p className="mt-1 max-w-prose text-sm leading-snug text-text-secondary">{finding.message}</p>
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
