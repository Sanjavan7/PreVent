// Cheap, dependency-free capability probes used to decide whether the 3D left
// panel should mount at all. Importing this file must NOT pull in three/r3f, so
// SimPanel can call it without eager-loading the lazy 3D island.

/** True when a WebGL2 context can be created. */
export function hasWebGL2(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!canvas.getContext('webgl2');
  } catch {
    return false;
  }
}

/**
 * Whether this device is a reasonable target for the cinematic 3D scene.
 * Conservative: desktop-class width, >= 4 logical cores, WebGL2 available.
 * Anything else falls back to the 2D Pixi monitor.
 */
export function is3dCapable(): boolean {
  if (typeof window === 'undefined') return false;
  const lg = window.matchMedia?.('(min-width: 1024px)').matches ?? true;
  const cores = navigator.hardwareConcurrency ?? 8;
  return lg && cores >= 4 && hasWebGL2();
}
