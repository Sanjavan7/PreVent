// Click-to-focus interaction layer for the bright cutaway ward.
//
// Adds, per room, an invisible (but raycastable) floor-footprint hit mesh with
// hover + click handlers, a soft on-palette highlight for the hovered/selected
// room, and a floating room label for the selected room. A ward-wide invisible
// catcher plane (empty-ground clicks) plus onPointerMissed (background clicks)
// clear the selection.
//
// It never moves the camera (that is CameraRig) and never touches the memoized
// Ward subtree, so a hover/select only reconciles THIS cheap layer. The hit
// handlers are stable setState callbacks from <Scene>; hover/selected are passed
// in as props. Coordinates are ward-local (same space as ROOM_LAYOUT), so this
// must be mounted inside the same <Center>/<Bounds> wrapper as <Ward>.
//
// Invisible meshes use colorWrite=false + depthWrite=false so they raycast
// (visible=true) without drawing or occluding. The catcher is kept to the floor
// footprint so it never enlarges the <Bounds> fit. The judge room (202) keeps
// its own always-on halo, so this layer draws no extra glow for it -- it still
// gets a hit area, a "You" label and the camera glide.

import { memo, useEffect, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { ROOM_LAYOUT } from './layout';
import type { RoomDef } from './layout';
import { hex, C } from '../palette';

const ACCENT = hex(C.brand);

interface Props {
  selectedId: string | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}

function labelText(room: RoomDef): string {
  if (room.judge) return 'You';
  // Non-judge labels are the bare room number ("201"); the judge carries "·".
  const num = room.label.split('·')[0].trim();
  return `Room ${num} · Patient`;
}

/** Floating selection label -- crisp DOM that fades + rises in on mount. */
function FocusLabel({ text }: { text: string }) {
  const [enter, setEnter] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEnter(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      style={{
        padding: '5px 13px',
        borderRadius: 999,
        border: `1px solid ${ACCENT}`,
        background: 'rgba(255,255,255,0.9)',
        backdropFilter: 'blur(4px)',
        color: ACCENT,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.04em',
        boxShadow: '0 4px 16px rgba(0,151,254,0.22)',
        opacity: enter ? 1 : 0,
        transform: enter ? 'translateY(0) scale(1)' : 'translateY(6px) scale(0.96)',
        transition: 'opacity 0.28s ease, transform 0.28s cubic-bezier(0.22,1,0.36,1)',
      }}
    >
      {text}
    </div>
  );
}

export const WardInteractions = memo(function WardInteractions({
  selectedId,
  hoveredId,
  onHover,
  onSelect,
}: Props) {
  const gl = useThree((s) => s.gl);

  // Drive the canvas cursor from hover STATE (order-independent vs over/out).
  useEffect(() => {
    const el = gl.domElement;
    el.style.cursor = hoveredId ? 'pointer' : '';
    return () => {
      el.style.cursor = '';
    };
  }, [gl, hoveredId]);

  const [fw, fd] = ROOM_LAYOUT.floor.size;
  const selectedRoom = selectedId
    ? ROOM_LAYOUT.rooms.find((r) => r.id === selectedId) ?? null
    : null;

  return (
    <group>
      {/* Ward-wide deselect catcher: invisible, raycastable, just above the
          floor so empty-ground clicks land here (room hits sit above it).
          onPointerMissed fires for background (no-mesh) clicks. Kept to the
          floor footprint so it never enlarges the <Bounds> fit. */}
      <mesh
        position={[0, 0.12, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          onSelect(null);
        }}
        onPointerMissed={() => onSelect(null)}
      >
        <planeGeometry args={[fw, fd]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>

      {ROOM_LAYOUT.rooms.map((room) => {
        const isHover = hoveredId === room.id;
        const isSelected = selectedId === room.id;
        // The judge room keeps its own always-on halo; no extra glow for it.
        const showGlow = (isHover || isSelected) && !room.judge;
        return (
          <group key={room.id} position={room.center}>
            {/* Invisible hit footprint -- covers the room so clicks on its
                furniture/walls (which the ray also crosses) still select it. */}
            <mesh
              position={[0, 0.2, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              onPointerOver={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                onHover(room.id);
              }}
              onPointerOut={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                onHover(null);
              }}
              onPointerDown={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                onSelect(room.id);
              }}
            >
              <planeGeometry args={[ROOM_LAYOUT.roomSize, ROOM_LAYOUT.roomSize]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
            </mesh>

            {/* Soft on-palette focus highlight: a floor light-pool + a crisp
                outline ring. Stronger when selected than on mere hover. */}
            {showGlow && (
              <group position={[0, 0.085, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <mesh>
                  <circleGeometry args={[1.75, 48]} />
                  <meshBasicMaterial
                    color={ACCENT}
                    transparent
                    opacity={isSelected ? 0.18 : 0.1}
                    depthWrite={false}
                    toneMapped={false}
                  />
                </mesh>
                <mesh>
                  <ringGeometry args={[1.66, 1.78, 56]} />
                  <meshBasicMaterial
                    color={ACCENT}
                    transparent
                    opacity={isSelected ? 0.95 : 0.5}
                    depthWrite={false}
                    toneMapped={false}
                  />
                </mesh>
              </group>
            )}
          </group>
        );
      })}

      {/* Floating label for the selected room (crisp DOM; re-animates on each
          new selection via the key). Non-occluding so it always reads. */}
      {selectedRoom && (
        <Html
          key={selectedRoom.id}
          position={[selectedRoom.center[0], 1.9, selectedRoom.center[2] + 0.3]}
          center
          distanceFactor={7}
          zIndexRange={[20, 0]}
          style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}
        >
          <FocusLabel text={labelText(selectedRoom)} />
        </Html>
      )}
    </group>
  );
});
