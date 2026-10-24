// The one highlighted room the judge is resting in (spec §4). Everything that
// makes it the focal point lives here -- all CALM / blue / peaceful at this
// stage (the warm "money moment" ramp is wired into DeviceDriver in a later
// stage; nothing here snaps). It composes:
//   - the shared RoomShell (floor tile + 3 cutaway walls)
//   - an accent floor inlay (soft blue rug) + a cove strip ringing the wall tops
//   - a ground halo ring around the bed (the one piece that gently blooms)
//   - a soft warm focus spotlight angled down into the room
//   - an <Html occlude> room-label chip floating over the bed
//   - the LIVE Pixi monitor (the ONE object fed by useMonitorTexture) via the
//     shared screen material ref
//   - the resting judge patient (skin head + bright white linen; breathing group)
//   - a ventilator (named bellows + LED refs) and an IV pole (drip ref)
//   - the floating CODE banner (opacity driven by DeviceDriver)
//
// Ports the retired dark bedside Patient / Ventilator singletons in here as the
// judge-only rig. No device props -- only the stable SceneRefs flow in, so the
// room is React.memo and never reconciles on a device tick. The bellows / drip
// local geometry matches the old singletons so DeviceDriver's base-Y constants
// still line up.

import { memo, useEffect, useMemo } from 'react';
import { MeshStandardMaterial, Object3D } from 'three';
import type { CanvasTexture } from 'three';
import { Html, RoundedBox } from '@react-three/drei';
import type { Vec3 } from './layout';
import { RoomShell, MonitorBox, IVPole, Chair } from './furniture';
import { CodeHud } from '../CodeHud';
import { hex, C } from '../palette';
import { STATUS_GREEN, STATUS_GREEN_BORDER } from '../visualState';
import type { SceneRefs } from '../sceneRefs';

interface Props {
  center: Vec3;
  label: string;
  /** Live Pixi waveform texture (null on the first frame before ready). */
  screenTex: CanvasTexture | null;
  refs: SceneRefs;
}

// Bed anchor inside the room (head toward -Z, against the back wall).
const BED: Vec3 = [-0.35, 0, -0.1];

export const JudgeRoom = memo(function JudgeRoom({
  center,
  label,
  screenTex,
  refs,
}: Props) {
  // A scene-graph target so the focus spotlight aims DOWN into the room rather
  // than at the world origin (three's default). Placed via <primitive> so its
  // world matrix updates.
  const spotTarget = useMemo(() => new Object3D(), []);

  // ONE shared cove material across the three wall-top strips, so DeviceDriver
  // warms them together (blue -> coral) from a single ref. Baseline = calm blue.
  const coveMat = useMemo(
    () =>
      new MeshStandardMaterial({
        color: C.brand,
        emissive: C.brand,
        emissiveIntensity: 0.3,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => {
    refs.roomCove.current = coveMat;
    return () => {
      refs.roomCove.current = null;
      // Manually-created material attached via <primitive> isn't auto-disposed.
      coveMat.dispose();
    };
  }, [coveMat, refs]);

  return (
    <group position={center}>
      <RoomShell size={4}>
        {/* Accent floor inlay -- a soft blue rug (DeviceDriver warms to amber). */}
        <mesh position={[0, 0.07, 0]} receiveShadow>
          <boxGeometry args={[3.0, 0.02, 3.0]} />
          <meshStandardMaterial ref={refs.inlayMat} color={hex(C.brand)} metalness={0} roughness={0.95} />
        </mesh>

        {/* Cove strip ringing the wall tops (gently emissive; shared material). */}
        {(
          [
            { k: 'back', pos: [0, 1.3, -1.94] as Vec3, size: [4, 0.06, 0.06] as Vec3 },
            { k: 'left', pos: [-1.94, 1.3, 0] as Vec3, size: [0.06, 0.06, 4] as Vec3 },
            { k: 'right', pos: [1.94, 1.3, 0] as Vec3, size: [0.06, 0.06, 4] as Vec3 },
          ] as const
        ).map((c) => (
          <mesh key={c.k} position={c.pos}>
            <boxGeometry args={c.size} />
            <primitive object={coveMat} attach="material" />
          </mesh>
        ))}

        {/* Ground halo ring around the bed -- the one piece that gently blooms. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[BED[0], 0.08, BED[2]]}>
          <ringGeometry args={[0.92, 1.08, 48]} />
          <meshStandardMaterial
            ref={refs.focusRing}
            color={hex(C.brand)}
            emissive={hex(C.brand)}
            emissiveIntensity={0.9}
            toneMapped={false}
            transparent
            opacity={0.5}
          />
        </mesh>

        {/* Soft warm focus spotlight angled straight DOWN into the room -- always
            pooling light so this reads as the "you are here" room at a glance,
            then ramps brighter on alert (DeviceDriver drives .intensity). */}
        <primitive object={spotTarget} position={[BED[0], 0.4, BED[2]]} />
        <spotLight
          ref={refs.focusLight}
          position={[BED[0], 4.2, BED[2] + 0.2]}
          target={spotTarget}
          angle={0.62}
          penumbra={0.85}
          intensity={0.55}
          distance={12}
          decay={2}
          color={hex(C.sun)}
        />

        {/* Visible soft beam cone from overhead down into the room (static set-
            dressing; translucent so it reads as a shaft of light, not a solid). */}
        <mesh position={[BED[0], 2.0, BED[2] + 0.1]}>
          <cylinderGeometry args={[0.18, 1.55, 3.9, 32, 1, true]} />
          <meshBasicMaterial
            color={hex(C.sun)}
            transparent
            opacity={0.07}
            depthWrite={false}
            toneMapped={false}
            side={2}
          />
        </mesh>

        {/* Floor "you are here" marker: a soft brand light-pool disc filling the
            room floor under the spotlight -- the obvious focal locator. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
          <circleGeometry args={[1.7, 48]} />
          <meshBasicMaterial
            color={hex(C.brandTint)}
            transparent
            opacity={0.3}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        {/* Bed + resting judge patient. */}
        <group position={BED}>
          {/* Bed frame + linen (bright). */}
          <mesh position={[0, 0.35, 0]} castShadow>
            <boxGeometry args={[0.95, 0.1, 2.05]} />
            <meshStandardMaterial color={hex(C.plastic)} metalness={0} roughness={0.6} />
          </mesh>
          {/* Mattress: thin flat slab on the frame -- no castShadow (the frame
              below already grounds the bed). */}
          <RoundedBox args={[0.9, 0.14, 1.9]} radius={0.05} smoothness={3} position={[0, 0.47, 0.05]}>
            <meshStandardMaterial color={hex(C.linen)} metalness={0} roughness={0.95} />
          </RoundedBox>
          {([-0.5, 0.5] as const).map((x) => (
            <mesh key={x} position={[x, 0.62, 0.1]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.018, 0.018, 1.5, 10]} />
              <meshStandardMaterial color={hex(C.chrome)} metalness={0.9} roughness={0.28} envMapIntensity={0.8} />
            </mesh>
          ))}

          {/* Breathing torso (DeviceDriver drives scale.y; frozen on crash). */}
          <group ref={refs.breathing} position={[0, 0.6, 0.0]}>
            <RoundedBox args={[0.46, 0.16, 0.95]} radius={0.08} smoothness={3}>
              <meshStandardMaterial color={hex(C.linen)} metalness={0} roughness={0.95} />
            </RoundedBox>
          </group>

          {/* Pillow + warm skin head (a person resting). */}
          <mesh position={[0, 0.57, -0.78]}>
            <boxGeometry args={[0.6, 0.1, 0.32]} />
            <meshStandardMaterial color={hex(C.linen)} metalness={0} roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.66, -0.74]} castShadow>
            <sphereGeometry args={[0.12, 20, 16]} />
            <meshStandardMaterial color={hex(C.skin)} metalness={0} roughness={0.8} />
          </mesh>

          {/* Blanket over the lower body (bright white). */}
          <RoundedBox args={[0.6, 0.1, 1.0]} radius={0.05} smoothness={3} position={[0, 0.58, 0.45]}>
            <meshStandardMaterial color={hex(C.linen)} metalness={0} roughness={0.95} />
          </RoundedBox>
        </group>

        {/* The LIVE Pixi monitor -- the one data-bound screen (reported vitals). */}
        <MonitorBox position={[0.95, 0, -1.25]} rotation={[0, -0.5, 0]} texture={screenTex} matRef={refs.screenMat} />

        {/* Ventilator rig (bellows + LED refs). Internal Y matches the old
            singleton so DeviceDriver's BELLOWS_BASE_Y (1.62) still lines up. */}
        <group position={[-1.35, 0, 0.1]}>
          <RoundedBox args={[0.5, 1.0, 0.4]} radius={0.04} smoothness={3} position={[0, 0.95, 0]} castShadow>
            <meshStandardMaterial color={hex(C.wall)} metalness={0.1} roughness={0.6} />
          </RoundedBox>
          {/* Front UI panel (calm blue glow). */}
          <mesh position={[0, 1.05, 0.205]}>
            <planeGeometry args={[0.34, 0.28]} />
            <meshStandardMaterial
              color={hex(C.brand)}
              emissive={hex(C.brand)}
              emissiveIntensity={0.8}
              toneMapped={false}
              metalness={0}
              roughness={1}
            />
          </mesh>
          {/* Status LED (DeviceDriver recolors emissive). */}
          <mesh ref={refs.led} position={[0.18, 1.4, 0.205]}>
            <sphereGeometry args={[0.025, 16, 16]} />
            <meshStandardMaterial color="#000000" emissive={hex(C.mint)} emissiveIntensity={3} toneMapped={false} />
          </mesh>
          {/* Glass column enclosing the bellows. */}
          <mesh position={[0, 1.75, 0.08]}>
            <cylinderGeometry args={[0.12, 0.12, 0.5, 20, 1, true]} />
            <meshStandardMaterial color="#cfe0ea" metalness={0} roughness={0.1} transparent opacity={0.16} depthWrite={false} />
          </mesh>
          {/* Bellows (DeviceDriver animates position.y / scale.y; freezes on stop). */}
          <mesh ref={refs.bellows} position={[0, 1.62, 0.08]}>
            <cylinderGeometry args={[0.09, 0.09, 0.26, 20]} />
            <meshStandardMaterial color={hex(C.linen)} metalness={0.1} roughness={0.7} />
          </mesh>
        </group>

        {/* IV pole with the animated drip droplet. */}
        <IVPole position={[-1.45, 0, -1.3]} dripRef={refs.drip} />

        {/* Visitor chair on the open (corridor) side. */}
        <Chair position={[1.2, 0, 1.1]} rotation={[0, -0.9, 0]} />

        {/* Floating room-label chip (crisp DOM; hides behind geometry). */}
        <Html
          position={[0, 1.65, 0.3]}
          center
          occlude
          distanceFactor={6}
          zIndexRange={[18, 0]}
          style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}
        >
          <div
            ref={refs.pinEl}
            style={{
              padding: '4px 12px',
              borderRadius: 999,
              border: `1px solid ${hex(C.brand)}`,
              background: 'rgba(255,255,255,0.82)',
              backdropFilter: 'blur(4px)',
              color: hex(C.brand),
              fontFamily: 'ui-sans-serif, system-ui, sans-serif',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.04em',
              boxShadow: '0 2px 10px rgba(0,151,254,0.18)',
              transition: 'color 0.3s, border-color 0.3s, box-shadow 0.3s',
            }}
          >
            Room {label}
          </div>
        </Html>

        {/* Big floating PATIENT STATUS chip -- the "is the patient alive" readout,
            the single most important thing on the simulation laptop. Floats above
            the foot of the bed (toward the corridor/viewer, clear of the room pin
            and the "you are here" arrow). Default content = the calm GREEN state;
            DeviceDriver rewrites its text + colour the instant the device flips to
            "no air" (red) and back to "stable" (green). Billboarded crisp DOM so
            it stays legible and face-on from any orbit angle. */}
        <Html
          position={[0.55, 2.3, 0.95]}
          center
          distanceFactor={9}
          zIndexRange={[22, 0]}
          style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}
        >
          <div
            ref={refs.statusEl}
            style={{
              padding: '7px 16px',
              borderRadius: 999,
              border: `2px solid ${STATUS_GREEN_BORDER}`,
              background: 'rgba(255,255,255,0.92)',
              backdropFilter: 'blur(6px)',
              color: STATUS_GREEN,
              fontFamily: 'ui-sans-serif, system-ui, sans-serif',
              fontSize: 15,
              fontWeight: 800,
              letterSpacing: '0.03em',
              boxShadow: '0 4px 18px rgba(52,211,153,0.28)',
              transition: 'color 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease',
            }}
          >
            ● STABLE · BREATHING
          </div>
        </Html>

        {/* Floating CODE banner (opacity ramped by DeviceDriver on admitted alarm). */}
        <CodeHud hudRef={refs.codeHud} position={[BED[0], 1.95, BED[2] + 0.2]} />
      </RoomShell>
    </group>
  );
});
