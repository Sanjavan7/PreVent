// The bright cutaway ward (spec §3/§4): the ground slab, the central corridor,
// the eight patient rooms in two rows (seven generic + the one highlighted
// JudgeRoom), and the dotted plants. Wrapped by <Center disableY>/<Bounds> in
// <Scene> so it auto-frames into the half-screen panel from the dollhouse-iso
// orbit.
//
// Only the JudgeRoom is data-adjacent: it receives the stable SceneRefs and the
// live Pixi monitor texture. Everything else is static set-dressing (React.memo,
// no device props), so the subtree never reconciles on a device tick.

import { memo } from 'react';
import type { CanvasTexture } from 'three';
import type { WardLayout } from './layout';
import { hex } from '../palette';
import type { SceneRefs } from '../sceneRefs';
import { Room } from './Room';
import { JudgeRoom } from './JudgeRoom';
import { Corridor } from './Corridor';
import { Plant } from './furniture';

interface Props {
  layout: WardLayout;
  refs: SceneRefs;
  /** Live Pixi waveform for the judge-room monitor (null before ready). */
  screenTex: CanvasTexture | null;
  /** Forwarded to generic rooms so their ambient patient breath holds under RM. */
  reducedMotion: boolean;
}

export const Ward = memo(function Ward({ layout, refs, screenTex, reducedMotion }: Props) {
  const { floor } = layout;
  return (
    <group>
      {/* Ground slab -- bright ceramic, receives the sun shadow. */}
      <mesh position={[0, 0, 0]} receiveShadow>
        <boxGeometry args={[floor.size[0], 0.04, floor.size[1]]} />
        <meshStandardMaterial color={hex(floor.color)} metalness={0} roughness={0.95} />
      </mesh>

      <Corridor />

      {layout.rooms.map((room) =>
        room.judge ? (
          <JudgeRoom
            key={room.id}
            center={room.center}
            label={room.label}
            screenTex={screenTex}
            refs={refs}
          />
        ) : (
          <Room key={room.id} center={room.center} rotY={room.rotY} reducedMotion={reducedMotion} />
        ),
      )}

      {layout.plants.map((p, i) => (
        <Plant key={`plant-${i}`} position={p} />
      ))}
    </group>
  );
});
