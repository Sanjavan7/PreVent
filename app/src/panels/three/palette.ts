// Scene colour tokens (spec §4) -- the single source of truth for the 3D ward,
// mirroring the CSS design-guide tokens. Values are THREE.ColorRepresentation
// integers (0xRRGGBB) so they drop straight into light/material props and into
// maath `easing.dampC` targets (via `new THREE.Color(int)`).
//
// Discipline rule (the "too many colours" fix): FOUR hue families only --
// brand-blue, warm (amber -> coral), mint-success, and neutrals/whites. Raw
// ECG-green and alarm-red exist ONLY inside the Pixi monitor canvas (a diegetic
// medical device); the room, people, lights, HUD and UI chrome never use them.
export const C = {
  // brand blue + tints
  brand: 0x0097fe,
  brandTint: 0xbfe4ff,
  sky: 0xeaf4ff,

  // warm alert axis (local to the judge room; never a whole-room red)
  alert: 0xffb020,
  coral: 0xff6b5b,

  // success
  mint: 0x3ddc97,

  // neutrals / whites
  wall: 0xf7fafc,
  floor: 0xeceff3,
  trim: 0xdfe6ee,
  linen: 0xffffff,
  chrome: 0xc7d0d9,
  plastic: 0xeef2f6,
  skin: 0xe8c9b0,
  sun: 0xfff6ec,

  // environment / background
  clear: 0xeef3f8,
  ground: 0xd9dee6,
  shadow: 0x43566b,
} as const;

/** CSS hex string for a token (DOM styles, clearColor strings, etc.). */
export const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
