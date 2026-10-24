// The ONE in-progress indicator in the whole panel: a 14px gray spinner.
// Geometry, the 0.8s linear spin, and the reduced-motion fallback (static ¾
// arc) all live in index.css under `.spinner`.

export function Spinner({ label = 'Working…' }: { label?: string }) {
  return (
    <span role="status" className="spinner shrink-0">
      <span className="sr-only">{label}</span>
    </span>
  );
}
