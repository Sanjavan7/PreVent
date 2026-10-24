// Click-to-focus interaction layer for the bright cutaway ward.
//
// Adds, per room, an invisible (but raycastable) floor-footprint hit mesh with
// hover + click handlers; a HOVER affordance (a translucent accent box with
// crisp accent edges enclosing the room's volume); a floating 3D "You are here"
// ARROW bobbing above the SELECTED room; and a room-identity label for the
// selected (non-judge) room. A ward-wide invisible catcher plane (empty-ground
// clicks) plus onPointerMissed (background clicks) clear the selection.
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
// its own always-on halo + "Room 202" pin, so this layer draws no identity label
// for it -- it still gets a hit area, the hover box, the arrow and the glide.
//
// Data-flow contract: hover/selected are DISCRETE useState (set on pointer
// events, never per frame). The only per-frame work here is the arrow's bob,
// driven by mutating a group ref inside a useFrame (NO setState); under reduced
// motion the arrow holds static. Nothing here reconciles the memoized ward.

import { memo, useEffect, useRef, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { useFrame, useThree } from '@react-three/fiber';
import type { Group } from 'three';
import { Edges, Html } from '@react-three/drei';
import { ROOM_LAYOUT } from './layout';
import type { RoomDef, Vec3 } from './layout';
import { hex, C } from '../palette';

const ACCENT = hex(C.brand);

// Hover box: encloses the room volume just inside the 1.3 m walls.
const BOX_FOOT = ROOM_LAYOUT.roomSize - 0.1; // footprint (x/z)
const BOX_H = ROOM_LAYOUT.wallHeight; // floor -> wall top

// Floating "You are here" arrow, bobbing above the selected room.
const ARROW_BASE_Y = 2.15; // clears the 1.3 m walls
const ARROW_BOB_AMP = 0.14;
const ARROW_BOB_HZ = 0.9; // slow bob, not a jitter
const TWO_PI = Math.PI * 2;

interface Props {
  selectedId: string | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  reducedMotion: boolean;
}

function labelText(room: RoomDef): string {
  // Non-judge labels are the bare room number ("201").
  const num = room.label.split('·')[0].trim();
  return `Room ${num} · Patient`;
}

/** Floating selection identity label -- crisp DOM that fades + rises in. */
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

/** The "You are here" chip above the arrow -- a filled accent pill (the primary
 *  locator, so it pops against the white identity pills). Fades + rises in. */
function YouAreHereLabel() {
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
        background: ACCENT,
        color: '#ffffff',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.04em',
        boxShadow: '0 6px 20px rgba(0,151,254,0.38)',
        opacity: enter ? 1 : 0,
        transform: enter ? 'translateY(0) scale(1)' : 'translateY(6px) scale(0.96)',
        transition: 'opacity 0.28s ease, transform 0.28s cubic-bezier(0.22,1,0.36,1)',
      }}
    >
      You are here
    </div>
  );
}

/** Semi-transparent accent box with crisp accent edges, sitting over a room's
 *  volume. Purely decorative -- non-raycastable so it never steals the hit
 *  mesh's pointer events, non-occluding (depthWrite off). */
function HoverBox() {
  return (
    <mesh position={[0, BOX_H / 2, 0]} raycast={() => null}>
      <boxGeometry args={[BOX_FOOT, BOX_H, BOX_FOOT]} />
      <meshBasicMaterial
        color={ACCENT}
        transparent
        opacity={0.1}
        depthWrite={false}
        toneMapped={false}
        side={2}
      />
      <Edges threshold={1} color={ACCENT} scale={1.001} />
    </mesh>
  );
}

/** A real 3D pointer (cone head + short shaft) in accent blue, floating above
 *  the selected room and bobbing on position.y via a ref in useFrame (no
 *  setState). The "You are here" chip above it stays static (crisp text). Under
 *  reduced motion the arrow holds still. */
function ArrowMarker({ center, reducedMotion }: { center: Vec3; reducedMotion: boolean }) {
  const bob = useRef<Group>(null);
  useFrame((state) => {
    if (reducedMotion) return;
    const g = bob.current;
    if (!g) return;
    g.position.y = ARROW_BASE_Y + Math.sin(state.clock.elapsedTime * TWO_PI * ARROW_BOB_HZ) * ARROW_BOB_AMP;
  });
  return (
    <group position={[center[0], 0, center[2]]}>
      <group ref={bob} position={[0, ARROW_BASE_Y, 0]}>
        {/* Shaft. */}
        <mesh position={[0, 0.65, 0]}>
          <cylinderGeometry args={[0.07, 0.07, 0.5, 20]} />
          <meshStandardMaterial
            color={ACCENT}
            emissive={ACCENT}
            emissiveIntensity={0.45}
            metalness={0.1}
            roughness={0.5}
            toneMapped={false}
          />
        </mesh>
        {/* Cone head, flipped to point DOWN at the room (tip near local y=0). */}
        <mesh position={[0, 0.2, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.23, 0.42, 26]} />
          <meshStandardMaterial
            color={ACCENT}
            emissive={ACCENT}
            emissiveIntensity={0.45}
            metalness={0.1}
            roughness={0.5}
            toneMapped={false}
          />
        </mesh>
      </group>
      {/* Static "You are here" chip above the arrow (billboarded DOM). */}
      <Html
        position={[0, ARROW_BASE_Y + 1.05, 0]}
        center
        distanceFactor={7}
        zIndexRange={[21, 0]}
        style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}
      >
        <YouAreHereLabel />
      </Html>
    </group>
  );
}

export const WardInteractions = memo(function WardInteractions({
  selectedId,
  hoveredId,
  onHover,
  onSelect,
  reducedMotion,
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

            {/* Hover affordance: a translucent accent box with crisp edges
                enclosing the room volume. Appears on pointer-over, clears on out. */}
            {isHover && <HoverBox />}
          </group>
        );
      })}

      {/* The floating "you are here" arrow over the selected room (default = the
          judge room 202, so it shows on load). The camera glide to it lives in
          CameraRig; re-keyed per selection so its chip re-animates in. */}
      {selectedRoom && (
        <ArrowMarker
          key={selectedRoom.id}
          center={selectedRoom.center}
          reducedMotion={reducedMotion}
        />
      )}

      {/* Room-identity label for the selected NON-judge room (crisp DOM;
          re-animates on each new selection via the key). The judge room carries
          its own always-on "Room 202" pin, so it needs none here. */}
      {selectedRoom && !selectedRoom.judge && (
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
