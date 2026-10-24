# PreVent — demo flow (what to type, when)

A beat-by-beat script of the 3-minute pitch, paired with the exact commands that
drive the shared `device_status` / `agent_status` / `findings` / `event_log` rows
behind both panels + the Arduino.

The real orchestrator (Dev 1) + security loop (Dev 2) can drive this end-to-end
on their own. This doc is the backup: when the pitcher wants a reliable, scripted
run on the demo laptop (or the live loop stalls mid-pitch), fire these phases
instead and the panels will react identically.

Every phase just writes to the same SpacetimeDB tables the live loop would.
Panels do not care which source wrote them.

---

## 0. Setup checklist (30 seconds before the judge arrives)

```bash
# Terminal A — SpacetimeDB server + module
spacetime start                                                            # local server on :3000
spacetime publish --module-path realtime/spacetimedb --server local prevent

# Terminal B — the app
cd app && pnpm dev                                                          # http://localhost:5173

# Terminal C — one-tap phase firing (keep this one in front of the pitcher)
cd scripts && ls seed-demo.sh                                               # verify present
```

Open http://localhost:5173 in the browser. **Click anywhere on the page once** to
unlock Web Audio — the alarm beep will not fire on its very first alarm
without a prior user gesture (browser autoplay policy).

Set the opening state:

```bash
./scripts/seed-demo.sh healthy
```

The screen should show:
- Header: `NO THREATS` green
- Monitor: ECG + SpO₂ + Respiration all healthy, `NORMAL` banner
- Dashboard: all 7 stages `IDLE`, `MATCH` chip in Telemetry vs Reality

---

## 1. Full 3-minute pitch (the primary path)

The pitcher narrates; the operator fires each phase on cue. Approximate wall
times given for pacing — real cue is the pitcher's words, not the clock.

| T    | Pitcher cue                                                         | Operator command                                 | What the screen does                                                                                                           |
|------|--------------------------------------------------------------------|--------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------|
| 0:00 | *"The machine is breathing for you. In a second it will stop..."* | *(nothing — baseline is already up)*             | Healthy state is the opener. Hold on it.                                                                                       |
| 0:22 | *"...and the scary part is the doctor won't know."*               | `./scripts/seed-demo.sh attack`                 | Header snaps **THREAT ACTIVE**. `fan: OFF`. **RESP flatlines red.** ECG + SpO₂ keep beating (device lying). DELIVER goes DONE. |
| 0:40 | *"The device is lying."* (point at the dashboard)                 | *(nothing — attack already fired)*              | **"THE DEVICE IS LYING"** red pill in Telemetry vs Reality. True vitals (35/82) in red. Reported (72/98) stays green.          |
| 0:52 | *"Our agents notice."*                                            | `./scripts/seed-demo.sh scanning`               | SCAN expands with streaming reasoning + 72% confidence gauge + the SemGrep CVE-2019-6538 finding (REAL badge) and a Bandit decoy. |
| 1:20 | *"And they catch their own mistakes."*                             | `./scripts/seed-demo.sh self-correct`           | Amber **SELF-CORRECTION · PATCH-AGENT** card: "REJECTED my own patch — v1 broke the emergency override..."                     |
| 1:32 | *"And refuse out-of-scope reaches."*                               | `./scripts/seed-demo.sh guardrail`              | Red **ACTION REFUSED · SANDBOX** banner.                                                                                       |
| 1:45 | *"But a human still signs."*                                      | `./scripts/seed-demo.sh patch-pending`          | Pulsing amber **APPROVE & DEPLOY** card appears with the test checklist. The pitcher deliberately clicks it on stage.          |
| 1:58 | *"The same attack now fails."*                                   | `./scripts/seed-demo.sh verified`               | ECG/SpO₂ exhale back to normal, fan ON, header back to **NO THREATS**, Telemetry chip returns to **MATCH**.                   |
| 2:18 | *"At scale..."* (gesture at `1 of 3,412 devices`)                 | *(nothing)*                                      | The fleet pill tells the scale story on its own.                                                                               |
| 2:30 | *"...with a receipt the FDA already asks for."*                   | *(nothing — Compliance card is already visible)* | Point at the **FDA §524B · AUDITABLE RECEIPT** card.                                                                           |
| 2:42 | *Close.*                                                            |                                                   |                                                                                                                                |

If you want the alarm beep + full CODE overlay to land before the patch, insert
`./scripts/seed-demo.sh mayday` right after the attack (around 0:35) — the
monitor flatlines ECG + SpO₂, red vignette pulses, big `⚠ CODE` fades in, and
the triple beep fires.

---

## 2. Express path (<90 s, for a rushed judge)

```
./scripts/seed-demo.sh healthy          # just before they walk up
./scripts/seed-demo.sh attack           # 0:00 — hook + kill in one
./scripts/seed-demo.sh scanning         # 0:20 — agents wake
./scripts/seed-demo.sh patch-pending    # 0:40 — pitcher clicks APPROVE on stage
./scripts/seed-demo.sh verified         # 0:55 — vitals restored
# 1:10 — hold up the Compliance card, close.
```

Skip mayday/self-correct/guardrail in the express path. The device-is-lying
beat alone sells it.

---

## 3. Reset between judges

```bash
./scripts/seed-demo.sh healthy
```

Reload the page too, so any one-shot animations (CODE overlay, confidence
gauge from the previous run) start fresh.

If an agent state got stuck:

```bash
# Clear and reseed (nuclear option — only if nothing else works)
spacetime publish --module-path realtime/spacetimedb --server local --delete-data=always prevent
./scripts/seed-demo.sh healthy
```

---

## 4. Troubleshooting

| Symptom                                   | Likely cause                                              | Fix                                                                                                              |
|-------------------------------------------|-----------------------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| Dashboard still says `source: mock`       | `VITE_REALTIME_BACKEND` not set to `spacetimedb`          | Check root `.env`, restart `pnpm dev`.                                                                           |
| No triple beep on `mayday`                | AudioContext not yet unlocked                             | Click anywhere on the page once, then re-fire `mayday`.                                                          |
| `source: live` but tables are all empty   | Published to a different server than the client reads     | `VITE_SPACETIMEDB_URI` + the server you published to must match. Local = `ws://localhost:3000`, Maincloud = `wss://maincloud.spacetimedb.com`. |
| Trust cards never appear                  | Reducer calls silently failed                              | Try a bare call to check: `spacetime call --server local prevent log_event test hi`.                             |
| Venue WiFi dies mid-demo                   | Expected                                                   | Flip `.env` → `VITE_SPACETIMEDB_URI=ws://localhost:3000`, re-publish to local, reload. See README for the one-liner. |

---

## 5. What drives what (quick reference)

- **Header "THREAT ACTIVE / NO THREATS" chip** → `device_status.compromised`
- **"THE DEVICE IS LYING" pill** → `device_status.reportedHr ≠ trueHr` OR `reportedSpo2 ≠ trueSpo2`
- **ECG + SpO₂ flatline + alarm beep + CODE overlay** → `device_status.alarmActive = true`
- **RESP flatline (always)** → `device_status.fanOn = false`
- **Timeline stage pills** → `agent_status.state` per `agent_status.stage`
- **Streaming reasoning + confidence gauge** → `agent_status.reasoning` + `agent_status.confidence` for a stage in `running` or `waiting_for_human`
- **Awaiting-approval card** → any `agent_status.state = 'waiting_for_human'`
- **Self-correction card** → `agent_status.reasoning` containing `REJECTED` / `revising` / `self-correct` (case-insensitive)
- **Guardrail-blocked card** → an `event_log` row with `actor = 'guardrail'` or text containing `ACTION REFUSED`
- **Findings card entries** → `findings` table (sorted by `createdAt` desc)
- **Patch diff** → will swap to the real Droid-authored diff once the orchestrator writes `patch_attempts.diffRef`; until then renders the canned CWE-306 diff
- **FDA §524B compliance card timestamp** → `device_status.updatedAt`
