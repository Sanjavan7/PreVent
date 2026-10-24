// Floating "CODE" banner over the bed, drawn as crisp DOM via drei <Html> (not a
// texture) so the type stays razor-sharp and never blooms. It hangs at opacity 0
// and DeviceDriver ramps its opacity straight on the wrapper's style when the
// device finally admits the alarm -- no React re-render, no device props here.
//
// occlude: the banner hides when scene geometry passes in front of it, so it
// reads as living inside the room rather than pasted on the glass.

import { memo } from 'react';
import type { RefObject } from 'react';
import { Html } from '@react-three/drei';

interface Props {
  hudRef: RefObject<HTMLDivElement | null>;
  position?: [number, number, number];
}

export const CodeHud = memo(function CodeHud({
  hudRef,
  position = [0.3, 1.9, 0.1],
}: Props) {
  return (
    <Html
      ref={hudRef}
      position={position}
      center
      occlude
      distanceFactor={3}
      zIndexRange={[20, 0]}
      style={{
        opacity: 0,
        pointerEvents: 'none',
        transition: 'none',
        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        whiteSpace: 'nowrap',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          padding: '6px 18px',
          borderRadius: 8,
          border: '1px solid rgba(255,107,91,0.85)',
          background: 'rgba(255,255,255,0.9)',
          backdropFilter: 'blur(4px)',
          color: '#ff6b5b',
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: '0.18em',
          boxShadow: '0 2px 16px rgba(255,107,91,0.3)',
        }}
      >
        CODE
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 11,
          letterSpacing: '0.24em',
          color: '#d9594b',
        }}
      >
        VENTILATOR STOPPED
      </div>
    </Html>
  );
});
