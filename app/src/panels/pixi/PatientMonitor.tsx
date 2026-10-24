// Bedside patient monitor (2D). Thin React wrapper over `createMonitorApp`.
//
// The entire PixiJS simulation now lives in `monitorApp.ts` so the exact same
// waveform code can also be run headless into a THREE.CanvasTexture by the 3D
// scene. This wrapper just owns the DOM: it creates a canvas, hands it to
// createMonitorApp, and tears everything down on unmount.
//
// This component is BOTH its own 2D mode AND the ultimate fallback (and the
// Suspense loading state) for the lazy 3D left panel, so it must render
// identically to the previous implementation.
//
// PixiJS state is kept out of React re-renders: the ticker reads the latest
// device from a ref, so prop changes are picked up without rebuilding the
// Application. The Application is created once per mount and destroyed on
// unmount (StrictMode-safe via createMonitorApp's cancelled flag).

import { useEffect, useRef } from 'react';
import type { DeviceStatus } from '@prevent/contracts';
import { createMonitorApp } from './monitorApp';

interface Props {
  device: DeviceStatus;
}

export function PatientMonitor({ device }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Keep the latest device state in a ref so the ticker always reads fresh
  // values without us rebuilding the Pixi app on every prop change.
  const deviceRef = useRef<DeviceStatus>(device);
  deviceRef.current = device;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Create the render target and place it in the host; createMonitorApp
    // never touches the DOM itself.
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    host.appendChild(canvas);

    const monitor = createMonitorApp(canvas, () => deviceRef.current);

    return () => {
      monitor.destroy();
      try {
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      } catch {
        // ignore -- may already be gone
      }
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-label="Patient monitor waveforms"
      className="min-h-56 flex-1 overflow-hidden rounded-lg border border-border"
      style={{ touchAction: 'none' }}
    />
  );
}
