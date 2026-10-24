# PreVent — 3D ICU Left-Panel Spec (implementation-ready)

> Verified 2026-10-24 against `app/package.json` + `contracts/src/types.ts`. Stack is **React 19.3.1 / Vite 8.3.5** (NOT React 18). All versions target React 19 + Vite 8. Source of truth for the 3D left panel.

## 1. VERDICT & APPROACH

**PRIMARY: stylized low-poly three.js primitives, not realistic GLBs.** The signature look (pitch-black room, emissive monitor screen as key light, `#0097FE` bloom) comes from lighting + emissive materials + bloom, not polygon detail. Primitives give named animatable sub-meshes (bellows that freezes), zero network fetch, zero Draco/license/404 risk.

**UPGRADE (optional, low-risk, only if time):** swap the two static objects (hospital bed + draped patient) for CC-BY/CC0 GLBs, re-tinted dark. Keep ventilator+monitor+IV as primitives (they animate). Lighting/post code unchanged.

**ULTIMATE FALLBACK:** existing 2D Pixi `PatientMonitor` (WebGL-fail / weak-GPU / mobile). It's also the Suspense loading state → free, coherent degrade.

**Scene concept:** cinematic pitch-black ICU bedside — ventilator on a cart, bedside monitor on a stand, bed + draped patient, IV pole — lit almost entirely by the glowing monitor screen in `#0097FE`, slow breathing camera orbit. Screen = the real Pixi waveform rendered to `THREE.CanvasTexture` so it blooms, reflects, lights the room. On compromise: screen keeps lying (calm blue vitals) while bellows freeze mid-stroke, room lerps to emergency red with pulsing CODE heartbeat, truth-trace flatlines — then patch+verify eases back to calm blue. The visible contradiction IS the demo.

## 2. DEPENDENCIES (peer-verified for React 19.3.1 + three 0.186.1)

```
three@0.186.1
@react-three/fiber@9.8.2          # peer react >=19 <19.4 ✓ ; three >=0.156 ✓
@react-three/drei@10.7.9          # peer react ^19 ✓ ; fiber ^9 ✓ ; three >=0.159 ✓
@react-three/postprocessing@3.2.2 # peer react ^19 ✓ ; fiber >=9.7 ✓ ; postprocessing ^6.36 ✓
postprocessing@6.39.5             # peer three >=0.168 <0.187 → 0.186.1 ✓
maath@0.10.8                      # the animation backbone (damp/damp3/dampC)
-D @types/three@0.186.0
```
`pnpm --filter @prevent/app add three@0.186.1 @react-three/fiber@9.8.2 @react-three/drei@10.7.9 @react-three/postprocessing@3.2.2 postprocessing@6.39.5 maath@0.10.8` then `-D @types/three@0.186.0`. Verify `npm ls three` resolves a single three.

**Hard rules:** do NOT install `framer-motion-3d` (deprecated, React-18 only). Do NOT use the r3f v8 / React-18 line. Keep WebGLRenderer (not WebGPU). Confirm r3f/drei/pp APIs via ctx7 during build. If React bumps ≥19.4, bump fiber in lockstep. No Babel/SWC/optimizeDeps changes needed. SPA, no SSR.

## 3. SCENE GRAPH (lazy island — ~500–700KB gz never in first paint)

```
app/src/panels/
  SimPanel.tsx          // swaps <PatientMonitor> for <Suspense><ICUScene3D device={device}/></Suspense> + 2D/3D toggle
  pixi/
    monitorApp.ts       // NEW: extract createMonitorApp(canvas, getDevice) from PatientMonitor's useEffect
    PatientMonitor.tsx  // thin 2D wrapper over monitorApp — FALLBACK + Suspense loading state
  three/
    ICUScene3D.tsx      // lazy default export: <Canvas> + <Suspense> + WebGL2 check + ErrorBoundary
    Scene.tsx           // rig, lights, environment, models, controls, effects
    DeviceDriver.tsx    // writes device→ref each render, lerps ALL visual state in ONE useFrame
    Ventilator.tsx MonitorScreen.tsx Bed.tsx IVPole.tsx Patient.tsx RoomShell.tsx
    Lighting.tsx        // emissive-screen key + rim + red CODE light (lerped, never mount/unmount)
    Effects.tsx         // <EffectComposer>: Bloom + ToneMapping + Vignette + Noise (+ alarm chroma)
    useMonitorTexture.ts// headless Pixi canvas → THREE.CanvasTexture, needsUpdate in useFrame
    visualState.ts      // pure DeviceStatus → {lightColor, intensity, bellowsStroke, bloom, red, glitch,...}
```

**State-flow rule (most important perf decision):** `SimPanel` re-renders every tick with fresh `device`. Pass to `<ICUScene3D device={device}/>`; `DeviceDriver` writes it into a `useRef` every render; ALL per-frame animation reads that ref in ONE `useFrame`. Model components are `React.memo` with NO device props → per-tick changes never reconcile them. NEVER `setState` in `useFrame`.

**`<Canvas>` config (tone-mapping ONCE in composer, Canvas is `flat`):**
```tsx
<Canvas
  flat                                    // NoToneMapping; ACES lives in the composer
  frameloop="always"
  shadows={false}                         // use drei <ContactShadows frames={1}>
  dpr={[1, 1.5]}
  performance={{ min: 0.5 }}
  gl={{ antialias:false, alpha:false, stencil:false, powerPreference:'high-performance' }}
  camera={{ position:[2.6,1.5,3.4], fov:33, near:0.1, far:50 }}
  onCreated={({ gl }) => gl.setClearColor('#000000', 1)}
>
```
Author all colors sRGB hex (`#0097FE`); r3f@9/three 0.186 default sRGB output + ColorManagement on.

**Camera + controls:** OrbitControls tightly clamped + programmatic slow auto-orbit (NOT drei autoRotate). `makeDefault enableDamping dampingFactor={0.08} enablePan={false} minDistance={2.6} maxDistance={4.5} minPolarAngle={PI*0.28} maxPolarAngle={PI*0.52} minAzimuthAngle={-0.6} maxAzimuthAngle={0.6} target={[0.3,1.0,0]}`. In `useFrame` when `controls.active===false`: `controls.setAzimuthalAngle(base + 0.18*Math.sin(t*0.12))`. (Option B: wrap scene in drei `<PresentationControls global snap polar={[-0.15,0.25]} azimuth={[-0.5,0.5]}>`.)

**Objects (meters, +Y up, bed long-axis Z, patient head −Z; monitor/vent cart ≈ `[0.9,0,-0.2]` facing camera):**
- **Ventilator (animates):** body `RoundedBox` 0.5×1.0×0.4 charcoal (roughness0.6 metalness0.2); front screen `Plane` emissive `#0097FE`. **Bellows** = vertical `Cylinder` in transparent glass `Cylinder`; animate `position.y`/`scale.y` sinusoidally (stroke 0.6↔1.0) ONLY while `fanOn`; on `!fanOn` stop advancing phase → damps to slumped rest. LED emissive `Sphere` (green/blue→red on alarm). Cart = 2 `Cylinder` legs + `Torus` wheels.
- **Bedside monitor (key light):** housing `RoundedBox` on `Cylinder` pole+base. Screen `Plane` textured by the headless Pixi canvas (hero light). Numeric vitals live inside the Pixi texture (shows reported lie).
- **Bed + patient:** mattress `RoundedBox` on `Box` frame + `Cylinder` rails; patient `RoundedBox` torso + `Sphere` head under low-opacity sheet; breathing `scale.y` synced to respiration, stops on crash. *(This pair is the one worth a GLB swap.)*
- **IV pole:** `Cylinder` pole + `Torus` hooks + translucent drip bag emissive blue rim; `Sphere` drip animates down.
- **Room shell:** inverted `Box` black, floor slightly glossy (metalness0.3 roughness0.55) so screen-blue smears as cheap reflection.

**GLB upgrade (bed+patient only):** GLBs in `app/public/models/*.glb` (`useGLTF('/models/bed.glb')`). Vendor Draco to `app/public/draco/` + `useGLTF.setDecoderPath('/draco/')`. `npx @gltf-transform/cli optimize` + `npx gltfjsx@latest --transform --types --keepnames`. Budget ≤2–5MB, textures ≤1024². No free CC ICU ventilator/monitor/IV exists (why primitives are primary). CC options: bed → Poly Pizza (CC-BY, confirm per page); patient → Quaternius (CC0). Add `app/public/CREDITS.txt` for any CC-BY.

## 4. LIGHTING & POST-FX

**HEALTHY lights:**
```tsx
<ambientLight intensity={0.06} color="#0a1420" />
<directionalLight position={[-3,2.4,-2.5]} intensity={0.9} color="#0097fe" />
<pointLight position={[0.9,1.15,0.05]} intensity={2.4} distance={4.5} decay={2} color="#0097fe" />  // monitor key (hero)
<pointLight position={[2.2,1.6,2.6]} intensity={0.35} distance={8} decay={2} color="#2b5f8a" />      // camera fill
```
Dim drei `<Environment preset="night">` (envMapIntensity ≤0.6, ship HDR locally) for chrome/floor reflections.

**ALARM (animate the SAME light objects, never mount/unmount; lerp ~0.6s to red, ~1.2s back):**
| Light | Healthy | ALARM |
|---|---|---|
| ambient | `#0a1420`/0.06 | `#200607`/0.05 |
| directional rim | `#0097fe`/0.9 | `#ff2436`/1.15 |
| monitor key | `#0097fe`/2.4 | `#ff1d2e`, pulses 1.6↔3.4 @ ~2.2Hz |
| camera fill | `#2b5f8a`/0.35 | `#7a2630`/0.35 |
Red pulse: `intensity = base + amp*(0.5+0.5*sin(t*2π*2.2))` gated on `alarmActive`; on resolve ramp `amp→0` + lerp colors back.

**Materials (bloom needs `toneMapped={false}` + emissive >1):**
- Monitor screen: `map=screenTex emissive="#ffffff" emissiveMap=screenTex emissiveIntensity={1.4} toneMapped={false} metalness0 roughness1`.
- LED: emissive sphere, color black, emissive `#00ff9c`→`#ff1d2e`, intensity 3→4 + sin pulse, `toneMapped={false}`.
- Housing: `#c7ced6` metalness0.1 roughness0.75. Cart/IV: `#8a929c` metalness0.9 roughness0.35 envMapIntensity0.6. Bed frame: `#1b2026` metalness0.6 roughness0.5. Sheets/patient: `#2a3139` metalness0 roughness0.95. Floor: `#05080c` metalness0.3 roughness0.55 envMapIntensity0.4.

**EffectComposer (ONE, exact order):**
```tsx
<EffectComposer multisampling={4} frameBufferType={THREE.HalfFloatType} disableNormalPass>
  <Bloom mipmapBlur luminanceThreshold={0.9} luminanceSmoothing={0.08} intensity={0.9} radius={0.7} kernelSize={KernelSize.LARGE} />  // ALARM → intensity ~1.6
  <ChromaticAberration blendFunction={BlendFunction.NORMAL} offset={[0.0006,0.0006]} radialModulation modulationOffset={0.3} />          // ALARM → [0.0018,0.0018]
  <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />   // LAST of HDR stage (Canvas is flat)
  <Vignette eskil={false} offset={0.28} darkness={0.9} />
  <Noise premultiply blendFunction={BlendFunction.OVERLAY} opacity={0.035} />
</EffectComposer>
```
`luminanceThreshold≈0.9` keeps the black room black. HalfFloat buffer MANDATORY so emissive >1 survives to bloom. Bloom is the dominant GPU cost — dpr clamp is the biggest lever. Refinement if room lifts: `SelectiveBloom` on screen+emergency meshes. DoF (focus monitor) is HIGH-tier only, first to cut.

**Shadows:** `<ContactShadows position={[0.3,0.001,0]} scale={8} resolution={512} blur={2.4} far={3.5} opacity={0.75} color="#000306" frames={1} />` (render once). `shadows={false}` on Canvas.

## 5. STATE BINDING

**In-scene screen: CanvasTexture reusing the Pixi waveform math** (unanimous). Run the sim headless; feed `app.canvas` to `THREE.CanvasTexture`:
```ts
const app = createMonitorApp(offscreenCanvas, () => deviceRef.current);
const tex = new THREE.CanvasTexture(app.canvas);
tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
useFrame(() => { tex.needsUpdate = true; });   // one 512×384–1024×512 upload/frame
```
Reuses `ecgSample`/`plethSample`/`respSample` verbatim (screen shows reported values → fake-normal during the lie) AND the screen is in the WebGL pipeline so it blooms/reflects/lights. Glitch (`compromised`) + flatline (`alarmActive`) drawn into the same 2D canvas. Fallback: redraw at 30fps or 512×256. **Rejected** drei `<Html transform>` on the screen (won't bloom, won't receive light, blurry). `<Html occlude>` only for crisp floating labels (device name, CODE HUD).

**Enabling refactor (first):** lift the Pixi body out of `PatientMonitor.tsx`'s `useEffect` into `pixi/monitorApp.ts` as `createMonitorApp(canvas, getDevice)`. 2D wrapper passes DOM canvas; `useMonitorTexture` passes offscreen one.

**Animation lib: plain lerp/damp in `useFrame` via `maath/easing`** (zero re-render, frame-rate-independent). `damp(obj,prop,target,smoothTime?,delta?)`, `damp3`, `dampC` (blue↔red light), `dampE`/`dampAngle`/`dampQ`. Each returns `true` while moving. `@react-spring/three` optional for discrete entrance pops only. **Start maath-only.**

```tsx
function DeviceDriver({ device }) {
  const deviceRef = useRef(device); deviceRef.current = device;
  const phase = useRef({ bellows: 0 });
  const env = useRef({ red:0, flat:0, glitch:0, emissive:1, codeOpacity:0 });
  const keyColor = useRef(new THREE.Color(0x0097fe));
  useFrame((_, dt) => {
    const d = deviceRef.current;
    const crashed = !d.fanOn || d.trueSpo2 < 85 || d.trueHr < 40 || d.alarmActive;
    const respPeriod = 4;                       // 15 br/min = Pixi respPeriod (NO contract field)
    if (d.fanOn) phase.current.bellows = (phase.current.bellows + dt/respPeriod) % 1;
    const stroke = Math.sin(phase.current.bellows*Math.PI*2)*0.5 + 0.5;
    if (d.fanOn) easing.damp(bellows.current.position, 'y', BASE_Y + stroke*0.12, 0.08, dt);
    easing.dampC(keyColor.current, crashed ? 0xff1d2e : 0x0097fe, 0.5, dt);
    easing.damp(env.current, 'red',         d.alarmActive ? 1 : 0, 0.25, dt);
    easing.damp(env.current, 'flat',        d.alarmActive ? 1 : 0, 0.3,  dt);
    easing.damp(env.current, 'glitch',      d.compromised ? 1 : 0, 0.4,  dt);
    easing.damp(env.current, 'emissive',    d.alarmActive ? 2.5 : 1, 0.35, dt);
    easing.damp(env.current, 'codeOpacity', d.alarmActive ? 1 : 0, 0.3,  dt);
    // apply to light.color / material.emissiveIntensity / HUD opacity in place — never setState
  });
}
```

**DeviceStatus → visual map:**
| Field | Drives | Calm | Lie/crash |
|---|---|---|---|
| `fanOn` | bellows + chest rise | loops @4s | **freezes mid-stroke, chest stops** |
| `reportedHr`/`reportedSpo2` | on-screen ECG/pleth | normal | keep normal during lie |
| `trueHr<40 ∥ trueSpo2<85` | emergency environment | none | room reddens, bloom spikes, patient color shifts |
| `alarmActive` | red strobe + screen flatline + CODE HUD + bloom (audio stays in Pixi — don't double-fire) | off, `#0097FE` | pulsing red, trace collapses flat, CODE fades in |
| `compromised` | screen glitch + vent LED red | clean | glitch band + red LED even while numbers read normal |
| `reported!=true` | optional "SIGNAL SUSPECT" bezel | hidden | appears |
| `updatedAt` | staleness guard | fresh | `now−updatedAt>3000` → desaturate + "LINK LOST" |
| restore | return to calm | — | damps to blue; bellows resume = "exhale" swell |

## 6. PERFORMANCE & FALLBACK

**Budgets (60fps, ~half-screen panel):** <15k tris (GLB path <150k, each GLB <50k), ≤40 draw calls, dpr `[1,1.5]`, 2–3 lights, monitor texture 1024×512 (<2MB), total texture <32MB, bundle three+r3f+drei+pp ~500–700KB gz → `const ICUScene3D = lazy(() => import('./three/ICUScene3D'))`.

**Adaptive:** drei `<AdaptiveDpr pixelated />`, `<AdaptiveEvents />`, `<PerformanceMonitor onDecline>`, `<Preload all />`.
| Tier | dpr | MSAA | Bloom | ChromAb | DoF | Noise | Shadows |
|---|---|---|---|---|---|---|---|
| HIGH | [1,1.5] | 4 | LARGE | on | on | 0.035 | ContactShadows 512 f1 |
| MED | [1,1.25] | 2 | MEDIUM 0.8 | tiny | off | 0.03 | ContactShadows 512 f1 |
| LOW | [1,1] | 0 | SMALL 0.5 | off | off | off | ContactShadows f1 |
Drop order: DoF → ChromAb → Noise → shadow → bloom kernel → bloom last.

**Fallback ladder (floor = 2D Pixi):** (1) reduced-motion → no bloom pulse, static bellows, `frameloop="demand"` + `invalidate()` per device change; (2) explicit 2D/3D toggle in `SimPanel` (localStorage try/catch, default 3D desktop); (3) capability probe (`hardwareConcurrency<4 ∥ deviceMemory<4 ∥ WebGL2 fail ∥ PerformanceMonitor decline) → drop bloom → fall to 2D; (4) mobile/`<lg` → 2D; (5) asset/WebGL fail → ErrorBoundary → primitives → 2D. Cleanup on unmount: `tex.dispose()`, drop offscreen canvas, dispose hand-made geometries/materials, `useGLTF.clear(url)`; copy PatientMonitor's StrictMode `cancelled`-flag teardown.

## 7. BUILD ORDER (demo-able after each step)
0. Install deps + `npm ls three`; confirm r3f/drei APIs via ctx7.
1. Refactor Pixi → `pixi/monitorApp.ts`; keep `PatientMonitor.tsx` working.
2. Lazy 3D skeleton: `<Canvas flat>` + WebGL2 check + ErrorBoundary + `<Suspense fallback={<PatientMonitor/>}>` + one lit cube.
3. Primitives scene (RoomShell, Ventilator, Monitor, Bed+Patient, IVPole, ContactShadows).
4. Monitor screen texture (signature shot exists).
5. Lighting rig + dim Environment.
6. EffectComposer (look locked).
7. State binding (DeviceDriver + maath) + toggle + reduced-motion + PerformanceMonitor tiers.
8. Camera idle orbit + OrbitControls clamps.
9. Polish: CODE HUD (`<Html occlude>`), IV drip, patient breathing, DoF HIGH tier, staleness.
10. Optional GLB bed/patient upgrade + CREDITS.txt.

## 8. RISKS
1. React-19/r3f-v9 version drift → use §2 pins + `npm ls three`.
2. Asset licensing/time → primitives primary (zero assets); GLB late swap bed+patient only.
3. Bloom perf → dpr clamp, high threshold, ContactShadows f1, tier-down, 2D floor.
4. Double tone-map washout → Canvas `flat` + single composer ToneMapping + HalfFloat + emissive `toneMapped={false}` >1.
5. Pixi-in-WebGL StrictMode double-mount/disposal → copy `cancelled`-flag teardown + explicit `tex.dispose()`.
6. Time-box → every step ships a demo-able artifact; 1–6 = signature shot, 7+ = money moment, 10 = pure upgrade.

**Open decision (resolved):** no respiration field in `DeviceStatus` → lock bellows to fixed 4s (15 br/min = Pixi `respPeriod`); do NOT add a contract field.
