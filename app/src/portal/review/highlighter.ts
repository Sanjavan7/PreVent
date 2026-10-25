// A single shiki highlighter loaded with the grammars this app needs: the demo
// device (python, C/C++, yaml) plus the common languages an arbitrary scanned
// GitHub repo tends to be written in. Anything else renders as plain 'text'
// (see langFor in CodeViewer) so an unknown grammar never throws.

import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';

export const CODE_THEME = 'github-light-default';

let highlighterPromise: Promise<HighlighterCore> | null = null;

export function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [import('shiki/themes/github-light-default.mjs')],
      langs: [
        import('shiki/langs/python.mjs'),
        import('shiki/langs/cpp.mjs'),
        import('shiki/langs/yaml.mjs'),
        import('shiki/langs/javascript.mjs'),
        import('shiki/langs/typescript.mjs'),
        import('shiki/langs/tsx.mjs'),
        import('shiki/langs/go.mjs'),
        import('shiki/langs/rust.mjs'),
        import('shiki/langs/java.mjs'),
        import('shiki/langs/ruby.mjs'),
        import('shiki/langs/php.mjs'),
        import('shiki/langs/json.mjs'),
        import('shiki/langs/bash.mjs'),
      ],
      engine: createOnigurumaEngine(import('shiki/wasm')),
    });
  }
  return highlighterPromise;
}
