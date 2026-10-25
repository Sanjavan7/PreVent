// The "network kill chain" overlay — the dramatic, diegetic story of HOW the
// patient's device is attacked, rendered as a compact spatial layer centered
// BEHIND the patient's room (outside the bright ward footprint). It makes the
// real architecture physical and legible:
//
//   UNKNOWN HOST (external attacker terminal)  ──red unauthenticated command──▶
//   DEVICE CONTROL SERVICE (the hospital's datacenter — every device's hub)
//   ──▶  the patient's ventilator in Room 202.
//
// On the fix a lock snaps onto the datacenter, the replayed command ricochets
// (the 401), and the conduit cools from red back to blue.
//
// PERF / ARCHITECTURE CONTRACT (matches People.tsx, DeviceDriver.tsx):
//   - React.memo island fed only STABLE props (getDevice + a flag).
//   - Owns ONE useFrame; reads the live row via the stable getDevice() accessor
//     and drives every visual by mutating refs/materials/instances in place —
//     never setState, so the scene subtree never reconciles on a tick.
//   - Mounted as a SIBLING of <Bounds> (Scene.tsx) in raw world coordinates, so
//     it neither enlarges the auto-fit bbox nor shifts the <Center> centroid.
//
// PALETTE: the ward's amber→coral is the PATIENT's physiological axis and is not
// reused here. The attack uses a foreign saturated red (#ff0033); the datacenter
// hums mint; the calm/secured baseline is brand blue — all emissive +
// toneMapped:false so the scene's selective bloom lights them up.

import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CatmullRomCurve3, Color, Object3D, TubeGeometry, Vector3 } from 'three';
import type { Group, InstancedMesh, Mesh, MeshStandardMaterial } from 'three';
import { Html, RoundedBox } from '@react-three/drei';
import { easing } from 'maath';
import type { DeviceStatus } from '@prevent/contracts';
import { C, hex } from '../palette';

// ---------------------------------------------------------------------------
// World anchors (raw ROOM_LAYOUT space; aligned 1:1 with the ward). The chain
// sits CENTERED behind room 202 (R2 ≈ x -2.3, z -4.6; its ventilator ≈ world
// (-3.5, 1.3, -4.25)). The datacenter sits on the open ground behind the ward
// (slab back edge z = -7.5), with the attacker terminal just beside it.
const DEVICE: [number, number, number] = [-3.5, 1.3, -4.25];
const DC: [number, number, number] = [-4.8, 0, -10.2]; // datacenter base (centered behind R2)
const ATTACKER: [number, number, number] = [-1.0, 0, -9.7]; // right of the datacenter, facing it

// Foreign "malicious data" red — deliberately OFF the ward's amber→coral ramp.
const ATTACK_RED = new Color(0xff0033);
const CALM_BLUE = new Color(C.brand); // 0x0097fe

const CMD_COUNT = 12; // command packets racing attacker → datacenter → device

// ONE command conduit, authored taut (few control points, little y variation)
// so it reads as a straight cable, not a wobble: attacker port → datacenter
// intrusion port → a slight arch over R2's back wall → the ventilator. The
// descent segment holds x ≈ -3.5 so it drops straight down into the room.
const CMD_POINTS = [
  new Vector3(-1.25, 1.2, -9.7), // attacker port (anchored at the console back)
  new Vector3(-3.3, 1.5, -10.0), // enters the datacenter's RIGHT side (behind the front face)
  new Vector3(-4.8, 1.6, -10.35), // THROUGH the racks (hidden inside the datacenter)
  new Vector3(-4.75, 1.35, -9.5), // emerges from the datacenter front toward the patient
  new Vector3(-4.0, 1.6, -6.9), // out across the gap toward R2
  new Vector3(-3.8, 1.65, -6.5), // slight arch over R2's back wall
  new Vector3(-3.5, 1.35, -4.25), // the device (ventilator)
];

// Datacenter server-blade rows (static mint "device" indicators), per rack.
const BLADE_ROWS = [0.45, 0.68, 0.91, 1.14, 1.37, 1.6];
const RACK_X = [-1.0, 0, 1.0];

interface Props {
  /** Stable accessor for the latest device row (identity never changes). */
  getDevice: () => DeviceStatus;
  /** When true: no flow/pulse; snap colors on each device change (demand loop). */
  reducedMotion: boolean;
}

export const NetworkAttack = memo(function NetworkAttack({ getDevice, reducedMotion }: Props) {
  // Build the curve + tube geometry once (stable; this island renders once).
  const { cmdCurve, cmdTube } = useMemo(() => {
    const cmd = new CatmullRomCurve3(CMD_POINTS, false, 'centripetal', 0.5);
    return { cmdCurve: cmd, cmdTube: new TubeGeometry(cmd, 120, 0.038, 9, false) };
  }, []);

  // Dispose the manually-created tube geometry on unmount.
  useEffect(() => () => cmdTube.dispose(), [cmdTube]);

  // Scratch objects reused every frame (no per-frame allocation).
  const scratch = useMemo(
    () => ({ dummy: new Object3D(), vec: new Vector3(), col: new Color() }),
    [],
  );

  // Animated material / instance / node handles.
  const cmdTubeMat = useRef<MeshStandardMaterial | null>(null);
  const cmdPacketMat = useRef<MeshStandardMaterial | null>(null);
  const cmdPackets = useRef<InstancedMesh | null>(null);
  const screenMat = useRef<MeshStandardMaterial | null>(null);
  const coreMat = useRef<MeshStandardMaterial | null>(null);
  const shieldRing = useRef<Mesh | null>(null);
  const lockGroup = useRef<Group | null>(null);
  const attackerEl = useRef<HTMLDivElement | null>(null);
  const statusEl = useRef<HTMLDivElement | null>(null);

  // Persistent per-frame scalars (eased/decayed, never setState-d).
  const env = useRef({ attack: 0, lock: 0 });
  const flow = useRef(0);
  const surge = useRef(0); // one-shot on the attack's rising edge (injection)
  const shield = useRef(0); // one-shot on the falling edge (the 401 repel)
  const lastComp = useRef<boolean | null>(null);
  const everAttacked = useRef(false);

  // Imperative DOM label flip (discrete, only on a compromised-state change).
  const updateLabels = (comp: boolean) => {
    const a = attackerEl.current;
    if (a) {
      a.style.color = comp ? '#ff2b4d' : '#8595a8';
      a.style.borderColor = comp ? 'rgba(255,43,77,0.85)' : 'rgba(133,149,168,0.5)';
      a.style.boxShadow = comp ? '0 0 22px rgba(255,43,77,0.55)' : 'none';
      a.style.opacity = comp ? '1' : '0.7';
    }
    const h = statusEl.current;
    if (h) {
      if (comp) {
        h.textContent = '● BREACH · unauthenticated POST';
        h.style.color = '#ff2b4d';
        h.style.borderColor = 'rgba(255,43,77,0.8)';
        h.style.boxShadow = '0 0 18px rgba(255,43,77,0.45)';
      } else if (everAttacked.current) {
        h.textContent = '● SECURED · 401 on replay';
        h.style.color = hex(C.mint);
        h.style.borderColor = 'rgba(61,220,151,0.75)';
        h.style.boxShadow = '0 0 16px rgba(61,220,151,0.4)';
      } else {
        h.textContent = '● 3,412 DEVICES · MONITORING';
        h.style.color = hex(C.brand);
        h.style.borderColor = 'rgba(0,151,254,0.6)';
        h.style.boxShadow = 'none';
      }
    }
  };

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const t = state.clock.elapsedTime;
    const comp = getDevice().compromised;

    // ---- edge detection: injection surge (rising) / 401 repel (falling) ------
    if (lastComp.current !== comp) {
      if (lastComp.current !== null) {
        if (comp) surge.current = 1;
        else shield.current = 1;
      }
      if (comp) everAttacked.current = true;
      lastComp.current = comp;
      updateLabels(comp);
    }

    // ---- ease the master attack scalar; snap under reduced motion -----------
    const targetA = comp ? 1 : 0;
    if (reducedMotion) env.current.attack = targetA;
    else easing.damp(env.current, 'attack', targetA, 0.35, dt);
    const attack = env.current.attack;

    surge.current = Math.max(0, surge.current - dt * 1.3);
    shield.current = Math.max(0, shield.current - dt * 1.1);

    const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 5.5);

    // ---- colors: blue → foreign red by attack; bloom via emissive -----------
    scratch.col.copy(CALM_BLUE).lerp(ATTACK_RED, attack);
    if (cmdTubeMat.current) {
      cmdTubeMat.current.emissive.copy(scratch.col);
      // Bright enough even in the calm/blue state that the cable reads as one
      // solid continuous line, never a dashed/cut look between packets.
      cmdTubeMat.current.emissiveIntensity = 0.95 + attack * 1.6 + surge.current * 1.6;
    }
    if (cmdPacketMat.current) {
      cmdPacketMat.current.emissive.copy(scratch.col);
      cmdPacketMat.current.emissiveIntensity = 1.5 + attack * 1.7 + surge.current * 2.2;
    }
    if (coreMat.current) {
      coreMat.current.emissive.copy(scratch.col);
      coreMat.current.emissiveIntensity = 0.6 + attack * 1.9 + surge.current * 1.5;
    }
    if (screenMat.current) {
      screenMat.current.emissiveIntensity = 0.35 + attack * (1.5 + pulse * 0.8) + surge.current;
    }

    // ---- advance the flow phase (frozen under reduced motion) ---------------
    if (!reducedMotion) {
      flow.current = (flow.current + dt * (0.05 + attack * 0.2 + surge.current * 0.7)) % 1;
    }

    // ---- place command packets along the conduit ---------------------------
    const cmd = cmdPackets.current;
    if (cmd) {
      const base = 0.5 + attack * 0.95 + surge.current * 0.8;
      for (let i = 0; i < CMD_COUNT; i++) {
        const u = (flow.current + i / CMD_COUNT) % 1;
        cmdCurve.getPointAt(u, scratch.vec);
        scratch.dummy.position.copy(scratch.vec);
        const s = base * (0.72 + 0.28 * Math.sin((u * CMD_COUNT + t) * 3));
        scratch.dummy.scale.setScalar(Math.max(0.001, s));
        scratch.dummy.updateMatrix();
        cmd.setMatrixAt(i, scratch.dummy.matrix);
      }
      cmd.instanceMatrix.needsUpdate = true;
    }

    // ---- 401 shield ring pop + the "now authenticated" lock -----------------
    if (shieldRing.current) {
      const s = shield.current;
      shieldRing.current.scale.setScalar(0.4 + (1 - s) * 1.8 + 0.001);
      (shieldRing.current.material as MeshStandardMaterial).opacity = s * 0.85;
    }
    const lockTarget = !comp && everAttacked.current ? 1 : 0;
    if (reducedMotion) env.current.lock = lockTarget;
    else easing.damp(env.current, 'lock', lockTarget, 0.3, dt);
    if (lockGroup.current) {
      lockGroup.current.visible = env.current.lock > 0.02;
      lockGroup.current.scale.setScalar(0.7 + env.current.lock * 0.3);
    }
  });

  return (
    <group>
      {/* ---- the command conduit (attacker → datacenter → device) ---- */}
      <mesh geometry={cmdTube}>
        <meshStandardMaterial
          ref={cmdTubeMat}
          color="#05070a"
          emissive={hex(C.brand)}
          emissiveIntensity={0.5}
          toneMapped={false}
          transparent
          opacity={0.95}
          roughness={0.5}
          metalness={0}
        />
      </mesh>

      {/* ---- command packets (diamonds racing the conduit) ---- */}
      <instancedMesh ref={cmdPackets} args={[undefined, undefined, CMD_COUNT]} frustumCulled={false}>
        <octahedronGeometry args={[0.058, 0]} />
        <meshStandardMaterial
          ref={cmdPacketMat}
          color="#000000"
          emissive={hex(C.brand)}
          emissiveIntensity={1.5}
          toneMapped={false}
        />
      </instancedMesh>

      {/* =================== DEVICE CONTROL SERVICE (the datacenter) =========== */}
      <group position={DC}>
        {/* Grounded dark base pad. */}
        <RoundedBox args={[3.5, 0.16, 1.9]} radius={0.05} smoothness={2} position={[0, 0.08, 0]} receiveShadow>
          <meshStandardMaterial color="#1b2027" metalness={0.25} roughness={0.7} />
        </RoundedBox>

        {/* Three server racks with glowing mint "device" blades. */}
        {RACK_X.map((rx) => (
          <group key={rx} position={[rx, 0, 0]}>
            <RoundedBox args={[0.84, 1.9, 0.92]} radius={0.04} smoothness={3} position={[0, 1.02, 0]} castShadow>
              <meshStandardMaterial color="#2c3845" metalness={0.35} roughness={0.5} />
            </RoundedBox>
            {BLADE_ROWS.map((by) => (
              <mesh key={by} position={[0, by, 0.47]}>
                <planeGeometry args={[0.6, 0.05]} />
                <meshStandardMaterial color="#000000" emissive={hex(C.mint)} emissiveIntensity={1.4} toneMapped={false} />
              </mesh>
            ))}
          </group>
        ))}

        {/* The intrusion core — a wide emissive slit the conduit plugs into
            (blue → red on attack). Sits on the center rack. */}
        <mesh position={[0, 1.78, 0.48]}>
          <planeGeometry args={[0.72, 0.14]} />
          <meshStandardMaterial
            ref={coreMat}
            color="#000000"
            emissive={hex(C.brand)}
            emissiveIntensity={0.6}
            toneMapped={false}
          />
        </mesh>

        {/* The 401 shield ring — pops outward on the fix. */}
        <mesh ref={shieldRing} position={[0, 1.1, 0.5]}>
          <torusGeometry args={[0.9, 0.035, 12, 48]} />
          <meshStandardMaterial
            color={hex(C.mint)}
            emissive={hex(C.mint)}
            emissiveIntensity={2.2}
            toneMapped={false}
            transparent
            opacity={0}
          />
        </mesh>

        {/* The "now authenticated" lock — hidden until the fix lands. */}
        <group ref={lockGroup} position={[0, 2.5, 0.3]} visible={false}>
          <mesh position={[0, 0.1, 0]}>
            <torusGeometry args={[0.12, 0.028, 10, 24, Math.PI]} />
            <meshStandardMaterial color={hex(C.mint)} emissive={hex(C.mint)} emissiveIntensity={2} toneMapped={false} />
          </mesh>
          <RoundedBox args={[0.26, 0.2, 0.09]} radius={0.02} smoothness={2} position={[0, -0.05, 0]}>
            <meshStandardMaterial color={hex(C.mint)} emissive={hex(C.mint)} emissiveIntensity={1.6} toneMapped={false} />
          </RoundedBox>
        </group>

        {/* Title (static) + status chip (LISTENING → BREACH → SECURED). */}
        <Html position={[0, 2.95, 0]} center distanceFactor={13} zIndexRange={[18, 0]} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div
              style={{
                padding: '4px 13px',
                borderRadius: 7,
                border: '1px solid rgba(0,151,254,0.35)',
                background: 'rgba(255,255,255,0.9)',
                color: hex(C.brand),
                fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '0.03em',
              }}
            >
              DEVICE CONTROL SERVICE
            </div>
            <div
              ref={statusEl}
              style={{
                padding: '3px 11px',
                borderRadius: 999,
                border: '1px solid rgba(0,151,254,0.6)',
                background: 'rgba(255,255,255,0.86)',
                color: hex(C.brand),
                fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: '0.04em',
                transition: 'color 0.3s, border-color 0.3s, box-shadow 0.3s',
              }}
            >
              ● 3,412 DEVICES · MONITORING
            </div>
          </div>
        </Html>
      </group>

      {/* =================== EXTERNAL ATTACKER TERMINAL =================== */}
      {/* Sits to the RIGHT of the datacenter with its red screen pointing exactly
          +X (world right), so from the datacenter's right-side view the screen
          reads as a flat rectangle; the hooded operator sits on the datacenter
          side. The red cable runs from it into the datacenter core. */}
      <group position={ATTACKER} rotation={[0, Math.PI / 2, 0]}>
        {/* One solid dark console block (no stacked slabs). */}
        <RoundedBox args={[1.05, 0.72, 0.52]} radius={0.04} smoothness={3} position={[0, 0.36, 0]} castShadow>
          <meshStandardMaterial color="#161c23" metalness={0.3} roughness={0.6} />
        </RoundedBox>
        {/* Thin neck + a single monitor, screen toward the camera, tilted up. */}
        <mesh position={[0, 0.84, 0.12]}>
          <boxGeometry args={[0.08, 0.26, 0.06]} />
          <meshStandardMaterial color="#0a0d12" metalness={0.4} roughness={0.5} />
        </mesh>
        <group position={[0, 1.16, 0.16]} rotation={[0, 0, 0]}>
          <RoundedBox args={[1.08, 0.66, 0.05]} radius={0.02} smoothness={2}>
            <meshStandardMaterial color="#0a0d12" metalness={0.4} roughness={0.5} />
          </RoundedBox>
          {/* The red terminal screen — faces the viewer. */}
          <mesh position={[0, 0, 0.035]}>
            <planeGeometry args={[0.94, 0.54]} />
            <meshStandardMaterial ref={screenMat} color="#000000" emissive="#ff0033" emissiveIntensity={0.4} toneMapped={false} />
          </mesh>
        </group>
        {/* Hooded operator silhouette behind the screen (head shows above it). */}
        <group position={[0, 0, -0.42]}>
          <mesh position={[0, 0.52, 0]} castShadow>
            <cylinderGeometry args={[0.15, 0.3, 0.8, 16]} />
            <meshStandardMaterial color="#0b0e13" metalness={0.1} roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.98, 0]} castShadow>
            <sphereGeometry args={[0.145, 20, 16]} />
            <meshStandardMaterial color="#0a0d11" metalness={0.1} roughness={0.9} />
          </mesh>
          <mesh position={[0, 1.03, 0.02]}>
            <coneGeometry args={[0.24, 0.46, 20, 1, true]} />
            <meshStandardMaterial color="#070a0e" metalness={0.1} roughness={0.95} side={2} />
          </mesh>
        </group>

        {/* Label — billboarded crisp DOM. */}
        <Html position={[0, 1.8, 0]} center distanceFactor={11} zIndexRange={[16, 0]} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          <div
            ref={attackerEl}
            style={{
              padding: '4px 12px',
              borderRadius: 999,
              border: '1px solid rgba(133,149,168,0.5)',
              background: 'rgba(8,10,14,0.82)',
              color: '#8595a8',
              fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.06em',
              opacity: 0.7,
              transition: 'color 0.3s, border-color 0.3s, box-shadow 0.3s, opacity 0.3s',
            }}
          >
            ⚠ UNKNOWN HOST
          </div>
        </Html>
      </group>
    </group>
  );
});
