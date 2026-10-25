# PreVent Brand Kit — "Vital Shield"

The PreVent mark is **Vital Shield**: a shield silhouette carrying a vital-sign pulse, signalling proactive protection of patient health. It is verified legible down to 16px, so it doubles as the app favicon and the Agentverse agent avatar.

## Color tokens

| Token | Hex | Role |
| --- | --- | --- |
| teal | `#19C6DC` | Primary accent |
| blue | `#1E7CF0` | Secondary accent |
| deep | `#1346C8` | Deep gradient / depth |
| secure-green | `#5BF0C0` | Secure / healthy state |
| white pulse | `#FFFFFF` | Pulse line highlight |
| ink | `#0B1B2B` | Neutral — primary text |
| paper | `#F6F8FB` | Neutral — light background |
| dark-bg | `#0A1526` | Neutral — dark background |

## Files

| File | Purpose |
| --- | --- |
| `prevent-mark.svg` | Full-color primary icon (512 viewBox). The canonical mark. |
| `prevent-lockup.svg` | Horizontal lockup: icon + "PreVent" wordmark. |
| `prevent-mark-mono.svg` | Single-color variant (uses `currentColor`) for favicons/avatars and monochrome contexts. |
| `prevent-avatar.png` | 400x400 Agentverse avatar, dark background. |
| `preview-light.png` | 512x512 preview on a light background. |
| `preview-dark.png` | 512x512 preview on a dark background. |

The app ships the same mark under `app/public/brand/` (served at `/brand/…`), with `favicon.svg` wiring both app tabs to the Vital Shield icon.

Agentverse avatar: upload `brand/prevent-avatar.png` via the Agentverse dashboard (not committable in code).
