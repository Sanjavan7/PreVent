# Media

All assets captured from the running app. GIFs are under Devpost's 5MB gallery limit.

## Assets

| File | What it is | Use |
|------|-----------|-----|
| `media/ward.gif` (4.7MB) | 3D ward: stable, to NO AIR / ventilator stopped, to SECURED / 401 and breathing again | README hero, Devpost gallery image 1 |
| `media/agents.gif` (3.9MB) | Agent flow: Claude, DeepSeek writes the exploit, breach at 200, writer Droid + reviewer, approve, verify 401 | Devpost gallery image 3 |
| `architecture.png` | The white logo diagram | README, Devpost gallery |
| `hardware-devpost.png` | The hardware digital twin | Devpost gallery, lower in README |
| `media/shots/cc_patch.png` | Command Center at the approve gate with the reviewer verdict | Devpost gallery image 2 (strong product shot) |
| `media/shots/cc_verified.png` | Exploit Blocked, 401, graph secured | Devpost gallery |
| `media/shots/cc_deepseek.png`, `cc_breached.png`, `cc_findings.png`, `cc_connected.png` | Command Center stages | Devpost gallery |
| `media/shots/ward_healthy.png`, `ward_attack.png` | Ward stills | optional |

## Devpost

- Video demo auto-embeds at the top of the story (`youtu.be/Aq5WXmQQooo`).
- Gallery accepts JPG, PNG, GIF, 5MB max each. Suggested order: `ward.gif`, `cc_patch.png`, `agents.gif`, `architecture.png`, `cc_verified.png`, `hardware-devpost.png`, then the rest.
- To embed a GIF inline in the story text, push the repo public and use the raw GitHub URL, for example `https://raw.githubusercontent.com/Sanjavan7/PreVent/main/devpost/media/ward.gif`.

## Before submitting

- The hardware image is labeled Arduino Uno R3, but the real flashed board is the UNO R4 WiFi (`FLASH_FQBN` in `security/portal_server.py`). Relabel the image or confirm the board, then make the firmware header and `graphModel.ts` agree. The write-ups stay generic ("an Arduino").
- Confirm the Microsoft track's product requirement before claiming it; file the separate MLH Commit supplemental form if entering that track.
- To re-render the diagram: serve the repo root and screenshot `devpost/media/architecture.html` with the logos in `devpost/media/logos/`.
