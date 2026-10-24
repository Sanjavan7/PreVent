// A one-line "Review patch (diff)" disclosure that reveals a STATIC, two-color
// unified diff (react-diff-view, de-animated via the `.diff` theme in
// index.css). parseDiff runs only when the disclosure mounts this body, since
// Disclosure unmounts its children while closed.

import { useMemo } from 'react';
import { Diff, Hunk, parseDiff } from 'react-diff-view';
import 'react-diff-view/style/index.css';
import { Disclosure } from './Disclosure';

function DiffBody({ diff }: { diff: string }) {
  const files = useMemo(() => parseDiff(diff, { nearbySequences: 'zip' }), [diff]);
  return (
    <div className="diff overflow-hidden rounded-sm border border-border">
      {files.map((file, i) => (
        <Diff
          key={i}
          viewType="unified"
          diffType={file.type}
          hunks={file.hunks}
          gutterType="none"
        >
          {(hunks) => hunks.map((h) => <Hunk key={h.content} hunk={h} />)}
        </Diff>
      ))}
    </div>
  );
}

export function CompactDiff({
  diff,
  trigger = 'Review patch (diff)',
}: {
  diff: string;
  trigger?: string;
}) {
  return (
    <Disclosure trigger={trigger}>
      <DiffBody diff={diff} />
    </Disclosure>
  );
}
