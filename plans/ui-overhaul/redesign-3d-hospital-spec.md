# PreVent — Bright Cutaway Hospital 3D Redesign Spec (v2)

> Opus-4.8 research synthesis. Supersedes 3d-hospital-spec.md. Bright/white/peaceful dollhouse ward.

Verified against disk: versions match exactly (`@react-three/fiber@9.8.2`, `drei@10.7.9`, `@react-three/postprocessing@3.2.2`, `postprocessing@6.39.5`, `three@0.186.1`, `maath@0.10.8`); Canvas is currently `flat` + `shadows={false}` + clearColor `#000000` + bedside camera `[2.6,1.5,3.4]`; `sceneRefs` and `visualState` are as the streams described (`ALARM_RED 0xff1d2e`, whole-room `red` axis, `KEY_INTENSITY_ALARM_AMP` strobe — all to be replaced). Vercel skills confirmed present (`vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines`, `dataviz`, `artifact-design`) — those belong to the 2D/design-guide work, not this 3D spec.

Below is the synthesized, sign-off-ready spec.

---

# Bright Cutaway Hospital — 3D Redesign Spec (SYNTHESIZED)

## Conflicts resolved (decisive calls)
1. **Shadows: SoftShadows(PCSS) + ContactShadows, NOT AccumulativeShadows.** Stream 1 wanted `AccumulativeShadows temporal`; Streams 3 & 4 win — temporal accumulation is for a settled hero object with a still camera, but we have an orbiting camera and walking people that would never let it settle. One directional caster + PCSS + one baked `ContactShadows` is cheaper and reads cleaner.
2. **Tonemap: `ToneMappingMode.NEUTRAL`, NOT ACES.** Stream 3 wins over Stream 4/1. NEUTRAL (Khronos PBR Neutral) keeps whites white and the `#0097FE` accent hue true; ACES muddies the blue and darkens mids — wrong for "bright/peaceful."
3. **Environment: offline `<Lightformer>` rig, NOT `preset="city"`.** Stream 1's preset hits a CDN (ctx7 warns it's "not for production") — a demo-night network dependency. Overridden.
4. **Post: N8AO(HIGH) + selective Bloom(0.35) + NEUTRAL. No vignette / noise / chroma by default.** (Optional micro-chroma `0.0004` on `compromised` only, HIGH tier — Stream 4's "signal tampered" tell, kept as polish.)
5. **People: primitive peg-people as 2 `InstancedMesh` (bodies+heads), driven by their own `useFrame`. Rigged GLB is post-hackathon only.** All streams converge; faces/limbs are illegible at dollhouse zoom, and skinned instancing is not first-class in three 0.186.
6. **Layout authority: Stream 1's 20×13 m four-room ward.** Its camera distance (`~25 m`) follows from it; `<Bounds fit observe>` auto-frames so exact numbers self-correct.
7. **Palette authority: Stream 4's token set** (brand/amber/coral/mint + neutrals), mirrored to a scene `palette.ts` and the CSS design-guide. Pulse **0.8 Hz** (Streams 1 & 3 over Stream 4's 1.1).

---

## 1. VERDICT & concept
A **bright, roofless, white dollhouse ward** seen from an angled top-down orbit: four patient rooms off a corridor, a nurse station, plants, and 6–12 low-poly people strolling calmly. **The judge is the still patient in one gently highlighted room.** Daylit, matte-ceramic, one accent blue — it "transmits peace." The money moment reads by **focus and warmth, never darkness**: the judge's room alone warms blue→coral with a slow breath-pulse while its monitor keeps lying and the ventilator bellows freeze; the rest of the hospital stays bright and white, people keep walking. Restore = exhale back to calm blue. Ship-today, 100% three.js primitives, zero asset/network risk, 2D Pixi fallback intact.

## 2. DEPENDENCIES
**Installed is enough — add nothing.** `fiber@9.8.2`, `drei@10.7.9`, `@react-three/postprocessing@3.2.2`, `postprocessing@6.39.5`, `three@0.186.1`, `maath@0.10.8`, `pixi.js@8.22.0`, `react@19.3.1` all present. No GLB, no loader, no fonts, no HDR, no CORS.
- **One pre-build check:** confirm `N8AO` is exported by the installed `@react-three/postprocessing@3.2.2` (`import { N8AO } from '@react-three/postprocessing'`). If absent, drop it — PCSS + ContactShadows already ground the scene.
- **Post-hackathon upgrade only (do NOT block demo):** Kenney "Animated Characters" (CC0, glTF, walk clip) or Quaternius (QAL, no attribution) for rigged crowd; one hero bed GLB. Would need a `useGLTF`+DRACO path + `SkeletonUtils.clone` per character (drei `<Clone>` shares skeletons — unsafe for independent walkers). Attribution → `app/public/CREDITS.txt`.

## 3. SCENE GRAPH + FILE ARCHITECTURE + Canvas + camera

**Keep intact:** lazy-island (`React.lazy` in SimPanel), WebGL2 guard, internal `ErrorBoundary`, reduced-motion `frameloop="demand"`, stable `getDevice` ref, memoized `<Scene>`, ONE `DeviceDriver` useFrame, `PerformanceMonitor`/`AdaptiveDpr`, 2D Pixi fallback. This redesign changes **aesthetics, composition, and crash encoding only — not the data-flow contract.**

```
app/src/panels/three/
  ICUScene3D.tsx     EDIT: clearColor #000→#EEF3F8; shadows false→"soft"(HIGH/MED); camera→iso rig; keep flat + guards
  Scene.tsx          REWRITE graph; KEEP memo + getDevice + single <DeviceDriver> + PerfMonitor/AdaptiveDpr/Preload
  sceneRefs.ts       EXTEND (see §7a)
  visualState.ts     REWRITE mapping (warm-local alert, §7b); KEEP isCrashed() verbatim
  DeviceDriver.tsx   RETARGET the ONE useFrame to cove/ring/inlay/focusLight/global-dim (§7c); keep bellows/breathing/drip
  Lighting.tsx       REWRITE bright (§6)
  Effects.tsx        REWRITE minimal (§6)
  palette.ts         NEW — token mirror (§4)
  useMonitorTexture.ts + pixi/monitorApp.ts   KEEP; now feeds ONLY the judge monitor; soften danger→coral (§7)
  ward/              NEW
    layout.ts        ROOM_LAYOUT constant (§4) — single source of truth
    Ward.tsx         floor slab + corridor + rooms + nurse station + plants; wrapped in <Center disableY>/<Bounds>
    Room.tsx         memo: generic room (floor tile, 3 low cutaway walls, bed, bedside monitor box, chair)
    JudgeRoom.tsx    accent inlay + halo ring + focus spot + <Html occlude> label + live Pixi monitor + judge patient
    Corridor.tsx     corridor strip + #0097FE baseboard trim
    NurseStation.tsx curved desk + 2 ambient flat screens (not data-bound)
    People.tsx       2 InstancedMesh (bodies+heads) + its OWN useFrame (waypoints, no setState)
    furniture.ts     pure memoized primitive builders: Bed, MonitorBox, IVPole, Chair, Plant, Door
  (retire bedside singletons RoomShell/Bed/Patient/Ventilator/IVPole/MonitorScreen into furniture.ts/JudgeRoom;
   keep files until ported)
```

**Canvas (`ICUScene3D.tsx`):**
```tsx
<Canvas
  flat                                  // => THREE.NoToneMapping on gl; composer owns the curve
  frameloop={reducedMotion ? 'demand' : 'always'}
  shadows={tier === 'LOW' ? false : 'soft'}   // one directional caster; LOW uses ContactShadows only
  dpr={[1, 1.5]}
  performance={{ min: 0.5 }}
  gl={{ antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' }}
  camera={{ position: [14, 13, 16], fov: 32, near: 0.5, far: 120 }}
  onCreated={({ gl }) => gl.setClearColor('#EEF3F8', 1)}   // was #000000
>
```
`antialias:false` is deliberate — AA happens in the composer (`multisampling={4}`), not the default framebuffer.

**Scene body:**
```tsx
<>
  <Lighting refs={refs} />
  <Bounds fit clip observe margin={1.15} maxDuration={0.8}>
    <Center disableY>
      <Ward layout={ROOM_LAYOUT} refs={refs} getDevice={getDevice} screenTex={screenTex} />
    </Center>
  </Bounds>
  <ContactShadows position={[0,0.01,0]} scale={34} resolution={1024}
     blur={2.6} far={9} opacity={0.4} color="#43566B" frames={1} smooth />
  <OrbitControls ref={refs.controls} {...ISO_CONTROLS} />
  <People refs={refs} layout={ROOM_LAYOUT} reducedMotion={reducedMotion} />
  <Effects tier={tier} refs={refs} />
  <AdaptiveDpr pixelated /><PerformanceMonitor onDecline={...} onIncline={...} /><Preload all />
  <DeviceDriver getDevice={getDevice} refs={refs} reducedMotion={reducedMotion} />
</>
```

**Camera / controls (`ISO_CONTROLS`):** angled dollhouse-isometric, long lens (fov 32) → near-isometric, low distortion.
```tsx
makeDefault enableDamping dampingFactor={0.08} enablePan={false}
enableZoom minDistance={18} maxDistance={30}
minPolarAngle={0.78} maxPolarAngle={1.08}      // 45°–62°: always looking DOWN into roofless rooms
minAzimuthAngle={0.42} maxAzimuthAngle={1.02}  // gentle ±0.3 rad arc
target={[-1.5, 0.6, -1]}                        // ward center, biased to judge room
onStart={() => (refs.interacting.current = true)}
onEnd={()   => (refs.interacting.current = false)}
```
`<Bounds fit observe>` auto-frames the ward to the half-screen panel on mount/resize. Idle motion (NOT drei `autoRotate`) lives in `DeviceDriver`, only when `!interacting`: `controls.setAzimuthalAngle(0.72 + 0.10*Math.sin(t*0.06))` — serene. Reduced-motion skips it.

## 4. ROOM LAYOUT (coords, meters) + judge-room treatment

`palette.ts` (scene mirror of the CSS design tokens — the single source of truth):
```ts
export const C = {
  brand: 0x0097fe, brandTint: 0xbfe4ff, sky: 0xeaf4ff,
  alert: 0xffb020, coral: 0xff6b5b, mint: 0x3ddc97,
  wall: 0xf7fafc, floor: 0xeceff3, trim: 0xdfe6ee, linen: 0xffffff,
  chrome: 0xc7d0d9, plastic: 0xeef2f6, skin: 0xe8c9b0, sun: 0xfff6ec,
} as const;
```
**Discipline rule (the "too many colors" fix):** four hue families only — brand-blue, warm (amber→coral), mint-success, neutrals. **ECG-green and alarm-red exist ONLY inside the Pixi monitor canvas** (a diegetic medical device). The room, people, lights, HUD, UI chrome never use raw green/red.

`layout.ts` — origin at ward center, +Y up, floor on XZ. Footprint **20 m × 13 m**, rooms **4×4 m**, pitch 4.6 m, **low cutaway walls h=1.3 m, NO ceiling**, corridor 2.6 m wide.
```ts
ROOM_LAYOUT = {
  floor:   { size:[20,13], y:0, color:C.floor },
  wallHeight:1.3, wallThickness:0.12, wallColor:C.wall,
  corridor:{ z:0, depth:2.6, color:0xdfe6ee, trim:C.brand },
  rooms: [ // back row, center z=-4.6
    { id:'R1', label:'201', center:[-6.9,0,-4.6] },
    { id:'R2', label:'202 · PATIENT', center:[-2.3,0,-4.6], judge:true },  // ← JUDGE
    { id:'R3', label:'203', center:[ 2.3,0,-4.6] },
    { id:'R4', label:'204', center:[ 6.9,0,-4.6] },
  ],
  nurseStation:{ center:[0,0,4.4], size:[6,1.0,2.0] },
  waiting:{ center:[7.5,0,4.2] },
  waypoints:[ [-9,0,0],[-4,0,0.5],[0,0,-0.4],[4,0,0.4],[9,0,0],[6.9,0,-2.0] ],
}
```
Each generic room (from `furniture.ts`, all primitives): `RoundedBox` mattress on `Box` frame + 2 `Cylinder` rails (head to −Z), a bedside monitor box on a pole, a chair, optional IV pole. Low segment counts (sphere 16, capsule 8).

**Judge room (R2) focal treatment — always-on, peaceful:**
- **Accent floor inlay:** judge floor tile `C.brand` at ~12% over base (soft blue rug). `★ref: inlayMat`.
- **Ground halo ring:** thin emissive `ringGeometry [1.9,2.15,48]` at y≈0.02 around the bed, `C.brand`, low intensity — the one thing that gently blooms. `★ref: focusRing`.
- **Cove strip:** thin emissive box ringing the wall tops. `★ref: roomCove`.
- **`<Html occlude>` label:** crisp `"Room 202 · Patient"` chip in accent, floats over the room (drei `occlude` hides it behind geometry). `★ref: pinEl`.
- **Soft focus spotlight** angled down into R2 only, calm intensity ~0.15, warm; ramps on alert. `★ref: focusLight`.
- **Judge patient:** warm skin head (`C.skin`) + bright white blanket + pillow — "a person resting," NOT the old dark morgue figure. `★ref: breathing`.
- The judge's **bedside monitor** is the ONE object using `useMonitorTexture` (live Pixi waveform of the *reported* vitals). `★ref: screenMat`, baseline `emissiveIntensity 0.9`, `toneMapped={false}`.

## 5. PEOPLE
**Primitive peg-people, two `InstancedMesh` (bodies = `CapsuleGeometry` ~0.18r×0.5h; heads = `SphereGeometry`) → 2 draw calls for the whole crowd.** Count tiered: HIGH 10, MED 6, LOW 4, **0 when `hardwareConcurrency < 8`** (crowd is first to cut). Colors: calm scrubs in brand-tint/slate/soft-teal — **no red/green**. One highlighted visitor peg near the judge room.

Movement in **`People.tsx`'s own `useFrame`** (separate from DeviceDriver by design; still frame-loop-only, no setState): a plain mutable waypoint FSM in a `useRef` — advance `t += dt*speed/segLen`, `lerp` between waypoints, `easing.dampAngle` the yaw toward heading, add `position.y += Math.sin(t*8+phase)*0.015` walk-bob. Write instance matrices via a shared `THREE.Object3D` dummy + `instanceMatrix.needsUpdate=true`. **The crowd is unaffected by the crash** — they keep strolling calmly while the judge room pulses; that contrast *is* the "one patient out of thousands, caught in time" narrative. Reduced-motion → freeze path + bob. Fallback: if a (future) GLB layer fails, silently degrade to these primitives, then to 2D Pixi.

## 6. BRIGHT LIGHTING + materials + minimal post

**`Lighting.tsx` (mount once, never remount on alarm — DeviceDriver lerps in place):**
| Light | Type | Intensity (calm) | Color | Pos | Shadows |
|---|---|---|---|---|---|
| Sky/ground fill | `hemisphereLight` `★ref:hemi` | **0.9** | sky `#EAF4FF` / ground `#D9DEE6` | — | no |
| Ambient lift | `ambientLight` | **0.35** | `#FFFFFF` | — | no |
| Sun (hero) | `directionalLight` `★ref:sun` | **1.8** | `#FFF6EC` (~4000K) | `[6,11,4]` | **yes — only caster** |
| Judge focus | `spotLight` `★ref:focusLight` | **0.15→ramps** | warm | over R2 | no |
| Env softbox | `<Environment frames={1} resolution={256} environmentIntensity={0.85}>` + 3–4 white `<Lightformer form="rect">` | — | white / pale | overhead | no (offline, no CDN) |

Sun shadow: `shadow-mapSize={[2048,2048]}`(HIGH)/`[1024,1024]`(MED), `shadow-bias=-0.0004`, `shadow-normalBias=0.02`, camera fit to ward (`left/right ±14, top/bottom ±9, near 1, far 40`). **`SoftShadows size={28} samples={10} focus={0.9}` mounted ONCE at HIGH only** (PCSS recompiles all shaders on mount — decide tier before first render, never toggle at runtime). `<ContactShadows frames={1} color="#43566B">` (slate, not black) grounds the static building for free. Background `<color args={['#EEF3F8']} />`; optional `<fog args={['#EEF4F9', 22, 48]} />` to soften far rooms. No `<Sky>` (shader cost).

**Materials:** everything `meshStandardMaterial`, `metalness:0 roughness:0.85–0.95` matte near-white (wall `C.wall`, floor `C.floor`, linen `C.linen`, plastic `C.plastic`); the only metallic pieces are bed rails / IV pole / equipment (`C.chrome`, roughness .25 metalness .9) so the white env gives a clean sheen, no hotspots. Screens are the one exception: emissive `C.brand`, `emissiveIntensity ~0.9`, `toneMapped={false}` so only they survive the >1 bloom gate.

**`Effects.tsx` — minimal bright stack:**
```tsx
<EffectComposer multisampling={4} frameBufferType={HalfFloatType}>
  <N8AO aoRadius={1.2} distanceFalloff={1} intensity={1.1} color="#43566B"
        quality="medium" aoSamples={16} denoiseSamples={4} halfRes />   {/* HIGH only; drop if not exported */}
  <Bloom ref={refs.bloom} mipmapBlur luminanceThreshold={1.0}
         luminanceSmoothing={0.2} intensity={0.35} radius={0.6} />       {/* only emissive screens/halo bloom */}
  <ToneMapping mode={ToneMappingMode.NEUTRAL} />
</EffectComposer>
```
**Delete** ChromaticAberration, Vignette, Noise (the old "dark horror" look). Optional max polish: Vignette `offset 0.5 darkness 0.15`, or micro-chroma `0.0004` ramped only on `compromised`, HIGH only.

**Healthy → gentle-alarm values** (lights/post, all eased — never snap):
| Param | Healthy | Alarm/crash | Restore |
|---|---|---|---|
| hemisphere + sun | 0.9 / 1.8 | ×0.88 (rest of ward recedes ~12%) | → back |
| focusLight (judge) | 0.15 | → ~0.9, warm | → 0.15 |
| cove/ring/inlay color | `C.brand` | `dampC` → `C.coral` (via `C.alert`) | → `C.brand` |
| ring/cove emissiveIntensity | 0.25 | `0.7 + 0.5*pulse` (0.8 Hz) | → 0.25 |
| screen emissive | 0.9 | ×(1+0.4·alert), stays legible | → 0.9 |
| Bloom intensity | 0.35 | +0.15·alert (→~0.5) | → 0.35 |

## 7. STATE BINDING (bright money moment)

**One SpacetimeDB `device_status` row → everything.** Keep the exact architecture: `getDevice` ref, memoized `<Scene>`, ONE `DeviceDriver` useFrame, **zero per-frame setState**, `maath/easing` damps. `isCrashed()` unchanged: `!fanOn || trueSpo2<85 || trueHr<40 || alarmActive`.

### (a) `sceneRefs.ts` additions
Keep `bellows, led, breathing, drip, screenMat, bloom, controls, interacting, codeHud`. Replace the bedside `rim/key/fill` with the ward rig; add:
```ts
hemi:       RefObject<HemisphereLight | null>;
sun:        RefObject<DirectionalLight | null>;
focusLight: RefObject<SpotLight | null>;        // judge-room spot (ramps on alert)
roomCove:   RefObject<MeshStandardMaterial | null>;  // cove strip emissive (blue→coral)
focusRing:  RefObject<MeshStandardMaterial | null>;  // floor halo emissive + opacity
inlayMat:   RefObject<MeshStandardMaterial | null>;  // floor rug accent
pinEl:      RefObject<HTMLDivElement | null>;        // Html judge chip (warms on alert)
people:     RefObject<InstancedMesh | null>;         // bodies (ambient; driven in People.tsx)
```
`chroma` optional (HIGH-only tamper tell). Drop the `keyIntensity*` strobe constants.

### (b) `visualState.ts` rewrite — warm, LOCAL alert axis (replaces whole-room `red`)
Keep the pure-function shape and `crashed/alarm/compromised/lying/stale/bellowsActive`. Swap the red axis for:
```ts
export const ACCENT_BLUE = 0x0097fe, SOFT_ALERT = 0xffb020, CORAL = 0xff6b5b, MINT = 0x3ddc97;
// ...
alertLevel:  crashed ? 1 : 0,               // 0 calm-blue … 1 coral (warm, LOCAL to judge room)
focusOn:     crashed || alarm,               // focus spot up + ring visible + (opt) camera push
coveColor:   crashed ? CORAL : ACCENT_BLUE,
ringColor:   alarm ? CORAL : (crashed ? SOFT_ALERT : ACCENT_BLUE),
inlayColor:  crashed ? SOFT_ALERT : ACCENT_BLUE,
restDim:     crashed ? 0.12 : 0,             // how much the OTHER rooms recede (via global light, not per-mat)
pulseOn:     crashed,                         // 0.8 Hz breath, not a strobe
ledColor:    (d.compromised || alarm) ? CORAL : MINT,   // monitor-adjacent LED only
bellowsActive: d.fanOn,                       // unchanged physical tell
```
**The lie stays:** the Pixi monitor keeps beating on `reportedHr`/`reportedSpo2` (calm, normal) while the room quietly warns — until the device admits `alarmActive`, when the monitor flatlines (Pixi already handles).

### (c) `DeviceDriver.tsx` retarget (the ONE useFrame)
```ts
const dt = Math.min(delta, 1/20); const v = visualState(getDevice(), Date.now());
const pulse = reducedMotion ? 0.5 : 0.5 + 0.5*Math.sin(t*Math.PI*2*0.8);   // 0.8 Hz breath
easing.damp(env, 'alert', v.alertLevel, 0.5, dt);
easing.damp(env, 'focus', v.focusOn ? 1 : 0, 0.6, dt);
easing.damp(env, 'dim',   v.restDim, 0.6, dt);
// LOCAL warm highlight — damp color so it never snaps
if (refs.roomCove.current){ easing.dampC(refs.roomCove.current.emissive, v.coveColor, 0.5, dt);
  refs.roomCove.current.emissiveIntensity = lerp(0.25, 0.7+0.5*pulse, env.alert); }
if (refs.focusRing.current){ easing.dampC(refs.focusRing.current.color, v.ringColor, 0.5, dt);
  refs.focusRing.current.opacity = env.focus*(0.4+0.3*pulse); }
if (refs.inlayMat.current) easing.dampC(refs.inlayMat.current.color, v.inlayColor, 0.5, dt);
// Other rooms RECEDE (not darken the judge): dim the globals, raise the judge spot — 2 writes, not a mat sweep
if (refs.hemi.current) refs.hemi.current.intensity = 0.9*(1-env.dim);
if (refs.sun.current)  refs.sun.current.intensity  = 1.8*(1-env.dim);
if (refs.focusLight.current) refs.focusLight.current.intensity = lerp(0.15, 0.9, env.focus);
if (refs.screenMat.current) refs.screenMat.current.emissiveIntensity = 0.9*(1+0.4*env.alert);
if (refs.bloom.current) refs.bloom.current.intensity = 0.35 + 0.15*env.alert;
// KEEP existing bellows/breathing/drip freeze logic verbatim (physical tells read in bright, no color needed)
// idle orbit when !interacting (§3); skip under reducedMotion
```
**One-row-drives-all legibility:** on `d.updatedAt` change, give `pinEl.style` a ~150 ms accent tick and dispatch `window` CustomEvent `prevent:devicetick` so the right panel's attack-path node flashes in lockstep — same row, same instant, three surfaces visibly react.

**Emotional arc:** Calm = blue halo/inlay, monitor normal. Compromised + true crash = ring/cove/inlay warm blue→amber→coral, focus spot rises, ward dims ~12%, bellows freeze + chest stops + drip halts, **monitor keeps smiling** (the lie). Alarm admitted = ring steady coral, monitor flatlines, label `CODE`. Restore = all `damp` back to blue over ~0.6–1.2 s, pulse→0, bellows resume — relief is the return of motion and cool palette. **The rest of the hospital stays bright and white throughout.**

## 8. PERF & FALLBACK
**Target 60 fps on an integrated-GPU demo laptop, `dpr [1,1.5]`.** Budget: primitive ward + 2 instanced people meshes → ~20–30 draw calls, <12k tris; 2 real lights + 1 judge spot; 1 directional shadow (PCSS HIGH); 1 baked `ContactShadows` (`frames={1}` → free after frame 1); 1 monitor texture (judge only, ≤1024×640, one upload/frame). Share one wall material + one bed geometry across rooms.

| Tier | People | Shadows | Post | dpr |
|---|---|---|---|---|
| HIGH | 10 (2 calls) | PCSS + 1 dir (2048) | N8AO + Bloom 0.35 + NEUTRAL | [1,1.5] |
| MED | 6 | 1 dir (1024), no PCSS | Bloom + NEUTRAL | [1,1.25] |
| LOW | 4 | `shadows={false}` + ContactShadows | Bloom + NEUTRAL | [1,1] |

Tier flips **only** via drei `<PerformanceMonitor onDecline/onIncline>` + `<AdaptiveDpr>` — never per frame; Bloom+ToneMapping always live (don't remount the composer core). `cores < 8` → start MED + people=0.

**Fallback ladder (already scaffolded — extend, don't rebuild):** `is3dCapable()`/`hasWebGL2()` false → 2D Pixi `PatientMonitor`; internal `ErrorBoundary` → 2D; `Suspense` → 2D; SimPanel wraps again. `prefers-reduced-motion` → `frameloop="demand"` + invalidate on device change, freeze people/orbit/pulse (flatten to mean) — the crash still *resolves* (ring coral, bellows slumped), just doesn't animate. **Critical invariant:** `createMonitorApp` owns the alarm `AudioContext` and must exist exactly once — never mount `useMonitorTexture` (3D) while the 2D `PatientMonitor` is up, or the beep double-fires.

## 9. STEP-BY-STEP BUILD ORDER (demo-able after each step)
1. **Go bright.** `clearColor #EEF3F8`; rewrite `Lighting.tsx` (hemi+ambient+warm sun+offline Lightformer env); gut `Effects.tsx` to `Bloom(0.35) + ToneMapping NEUTRAL`. Camera stays bedside. → scene is instantly bright & calm.
2. **Palette + retint.** Add `palette.ts`; recolor existing objects white/warm; patient → skin head + white linen. → peaceful bedside.
3. **Build the ward.** `layout.ts` + `Ward/Room/Corridor/NurseStation` primitives (static, memo), wrap in `<Center>/<Bounds>`; move camera to iso `[14,13,16]` + `ISO_CONTROLS`. → roofless dollhouse visible.
4. **Judge room.** `JudgeRoom.tsx`: accent inlay + halo ring + focus spot + `<Html occlude>` label + relocate the live Pixi monitor here; extend `sceneRefs`. → judge room distinguished, monitor live.
5. **Money moment.** Rewrite `visualState.ts` (warm-local alert) + retarget `DeviceDriver` (cove/ring/inlay damp, focus spot, global dim, 0.8 Hz pulse, keep physical tells); soften Pixi `danger→coral`. → crash plays bright & peaceful; restore exhales.
6. **People.** 2 `InstancedMesh` + `PeopleDriver` waypoints. → life around the ward.
7. **Polish + ship.** N8AO + SoftShadows (HIGH) + ContactShadows; wire PerformanceMonitor tiers + AdaptiveDpr + cores gate; verify reduced-motion and the 2D Pixi fallback (single AudioContext). → world-class, 60 fps.

## 10. RISKS
- **SoftShadows shader-recompile hitch** → mount ONCE at init; decide tier before first render; never toggle at runtime. MED/LOW simply never mount it.
- **N8AO export unconfirmed on disk** in `@react-three/postprocessing@3.2.2` → verify the import before building; if missing, drop it (PCSS + ContactShadows suffice). Don't block on it.
- **ContactShadows `frames={1}` won't show walking-people shadows** → accepted; soft static ground reads fine at this zoom. Do NOT add per-frame crowd shadows (kills the budget).
- **Optional camera push-in vs `<Bounds>`** → Bounds refits on mount/resize; a money-moment push-in (damp `controls.target`+radius) is fine between refits but must not run while a resize triggers Bounds. Ship idle-orbit baseline first; push-in is Phase-2 polish.
- **AudioContext double-beep** → enforce single `createMonitorApp` (3D texture XOR 2D fallback, never both).
- **`maath` damp targets** → `dampC` needs `THREE.Color`; convert hex ints once; `env` accumulator object must be a stable ref, not recreated per frame.
- **Emissive bloom gate** → `flat`/NoToneMapping means screens/halo must be `emissive >1`-equivalent with `toneMapped={false}`, else `luminanceThreshold 1.0` won't bloom them.
- **Rigged-crowd temptation** → skinned instancing is NOT first-class in three 0.186 and drei `<Clone>` shares skeletons; primitives ship today. Keep GLB strictly post-hackathon.
- **Don't touch Factory/other-track wiring** — this spec replaces only the `three/` scene-graph bodies, `visualState`, `sceneRefs`, `Lighting`, `Effects`; the DeviceStatus contract, right panel, and hardware bridge are untouched.