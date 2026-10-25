// A single shiki highlighter loaded with only the grammars this app needs
// (python, C/C++, yaml) and one dark theme — so the bundle doesn't ship every
// language grammar shiki supports.

import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';

export const CODE_THEME = 'github-dark-default';

let highlighterPromise: Promise<HighlighterCore> | null = null;

export function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [import('shiki/themes/github-dark-default.mjs')],
      langs: [
        import('shiki/langs/python.mjs'),
        import('shiki/langs/cpp.mjs'),
        import('shiki/langs/yaml.mjs'),
      ],
      engine: createOnigurumaEngine(import('shiki/wasm')),
    });
  }
  return highlighterPromise;
}
