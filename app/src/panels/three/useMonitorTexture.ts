// Headless bridge: run the EXISTING Pixi waveform simulation into an offscreen
// canvas and expose it as a THREE.CanvasTexture so the in-scene monitor screen
// shows the real ECG/SpO2/RESP traces -- and, once lit + bloomed, acts as the
// room's key light.
//
// Because the screen reuses createMonitorApp verbatim, it shows the REPORTED
// values, so it stays calmly "normal" during the lie while the ventilator
// physically stops -- that visible contradiction is the demo.
//
// The Pixi app owns the alarm audio, so exactly one createMonitorApp must be
// alive at a time. In 3D mode only this hook creates one (the 2D PatientMonitor
// is the fallback/Suspense state and is unmounted before the Canvas mounts), so
// the beep never double-fires.
//
// StrictMode-safe: a `cancelled` flag guards the (possibly double-invoked)
// effect, and teardown destroys the Pixi app, disposes the texture, and drops
// the offscreen canvas.

import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, SRGBColorSpace } from 'three';
import type { DeviceStatus } from '@prevent/contracts';
import { createMonitorApp } from '../pixi/monitorApp';

// Logical size handed to Pixi. autoDensity multiplies the backing store by the
// device pixel ratio (clamped to 2 inside createMonitorApp), so on a 2x display
// the uploaded texture is 1024x640 (~2.6MB) -- within the spec's 1024x512 budget
// band. 2:1.6 roughly matches the monitor screen plane's aspect.
const TEX_W = 512;
const TEX_H = 320;

/**
 * Create a CanvasTexture fed by a headless Pixi monitor sim.
 *
 * @param getDevice stable accessor for the latest device row (never a prop that
 *                  changes identity per tick, or the effect would re-run).
 * @returns the texture once ready (null for the first render before the effect
 *          runs); callers should fall back to a plain emissive color meanwhile.
 */
export function useMonitorTexture(
  getDevice: () => DeviceStatus,
): CanvasTexture | null {
  const [texture, setTexture] = useState<CanvasTexture | null>(null);
  const texRef = useRef<CanvasTexture | null>(null);

  useEffect(() => {
    let cancelled = false;

    const canvas = document.createElement('canvas');
    canvas.width = TEX_W;
    canvas.height = TEX_H;

    const monitor = createMonitorApp(canvas, getDevice);

    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;

    if (cancelled) {
      // Effect was torn down before we finished wiring (StrictMode / fast
      // unmount): clean up immediately and publish nothing.
      monitor.destroy();
      tex.dispose();
      return;
    }

    texRef.current = tex;
    setTexture(tex);

    return () => {
      cancelled = true;
      monitor.destroy();
      tex.dispose();
      if (texRef.current === tex) texRef.current = null;
    };
  }, [getDevice]);

  // One texture upload per frame. Pixi's own ticker redraws the canvas; we just
  // flag it dirty so three re-uploads. This is a mutation, never setState.
  useFrame(() => {
    const tex = texRef.current;
    if (tex) tex.needsUpdate = true;
  });

  return texture;
}
