# PreVent — Demo Runbook (judge-facing)

> Two laptops, one physical ventilator (Arduino + fan), one 3D patient ward.
> Laptop B drives the portal + hardware; Laptop A shows the patient sim. They stay in sync through
> one shared SpacetimeDB row on Maincloud. Keep this open on stage.

---

## 1. The 60-second pitch (what to say first)
> "Hospitals run thousands of networked medical devices — ventilators, pumps, monitors — on firmware
> and control software no clinic can audit. When one has a missing-auth bug, an attacker can stop the
> device and **spoof the monitor so staff see 'healthy' while the patient crashes.** People die from
> exactly this class of unpatched device flaw, and there is no RunSybil for hardware in the clinic.
>
> PreVent is that service. You point us at the device's repo and plug in the device. We **discover** the
> vulnerabilities for real, **prove** each one is exploitable with an AI agent per flaw, show you the
> **patient risk**, and then **push a patch and verify the attack is dead** — live, with every step
> observable. Watch: this is the ventilator." *(gesture at the fan — green, spinning.)*

Keep the fan in view the whole time. Green + spinning = patient breathing. Red + buzzer = patient in arrest.

---

## 2. Hardware wiring recap (Laptop B)
Board: **Arduino UNO R4 WiFi** over USB. Fan via **L293D**: enable **D5**, IN1 **D7**, IN2 **D8**
(separate 3–6 V motor supply, common ground). Indicators (each through a 220–330 Ω resistor):
- **GREEN LED → A1** — on (soft-PWM dimmed) while the fan spins.
- **RED LED → D2** — on (dimmed) when the fan is stopped.
- **Buzzer → D13** — short ~120 ms beep each second while the fan is down (not a continuous blare).

Healthy firmware = `calhacks2026/arduino/bedside/bedside.ino` (sensor-driven; green while spinning).
Attack = a fan-off sketch flashed over USB (fan forced off, green off, red on, buzzer beeps).

> Heads-up: the board has been dropping off the USB bus this build. Use a **known-good data cable**
> plugged **directly** into the laptop (no hub). Confirm `arduino-cli board list` shows the UNO before you start.

---

## 3. Pre-demo setup

### 3a. One-time, by the SpacetimeDB module OWNER (do once, well before)
```
spacetime publish --module-path realtime/spacetimedb --server maincloud prevent
spacetime call --server maincloud prevent grant_role 0x<writer-identity> device   # the trigger's identity
```
Reading the row needs no role. `spacetime login show` prints the identity.

### 3b. Laptop A — the 3D patient sim (teammate)
Root `.env` (or inline `VITE_` vars):
```
VITE_REALTIME_BACKEND=spacetimedb
VITE_SPACETIMEDB_URI=wss://maincloud.spacetimedb.com
VITE_SPACETIMEDB_MODULE=prevent
```
- `pnpm install` once; generate bindings on a fresh clone: `pnpm --filter @prevent/realtime gen`.
- `pnpm --filter @prevent/app dev` → open **`http://localhost:<port>/sim.html`**.
- ✅ Top-left reads **"source: live"** and the ward shows **STABLE · BREATHING**. Console logs
  `[realtime] connected as <identity>`. Laptop A is a read-only client — nothing else to run.

### 3c. Laptop B — the portal + hardware (this machine)
1. Plug the UNO in. `arduino-cli board list` shows `Arduino UNO R4 WiFi` on its port
   (mac: `/dev/cu.usbmodem…`; Windows: `COMx`).
2. Flash healthy firmware so the demo starts green:
   `arduino-cli upload -p <port> --fqbn arduino:renesas_uno:unor4wifi calhacks2026/arduino/bedside`
   (or hit the portal's restore/`POST /api/flash/restore`). Fan spins, **green LED on**.
3. Start the control server: `PORTAL_PORT=8077 .venv/bin/python security/portal_server.py`
   → `GET /api/health` = `{"ok":true}`, `GET /api/hardware` shows the board connected.
4. Start the app: `pnpm --filter @prevent/app dev` → open **`http://localhost:<port>/`** (Command Center).
5. Same `VITE_SPACETIMEDB_*` env as Laptop A so the portal's trigger drives the shared row.

### 3d. 90-second smoke test (do once before judges)
- Portal loads to the teal "Waiting for device" → connects → **Ready** (no file dump, just ready).
- Full dry run once: scan → vulns → agents → hardware exploit → fan stops + red + buzzer → Laptop A
  ward freezes/reddens → push patch → verify 401 → reset → fan green again.

---

## 4. On-stage script (what you do · what judges see · what you say)

| Beat | You do | Judges see | Say |
| --- | --- | --- | --- |
| **0. Setup** | Portal on Laptop B, ward on Laptop A, fan green + spinning | Two screens, a breathing patient, a spinning fan | "This is a clinic's ventilator and its patient monitor." |
| **1. Engage** | Paste the client's **GitHub repo URL**; the Arduino is already plugged in | "Run scan" lights up only once **both** repo + device are present | "We come in like a pentest team: here's their repo, here's their device." |
| **2. Scan** | Click **Run scan** | Semgrep + Bandit run for real, **~8–10s**, elapsed timer; then N findings appear, clickable | "Real scanners, real time — no theater. These are the flaws in their code." |
| **3. Triage** | Click through findings | Each finding opens the real vulnerable line; no "planted" tells, no "decoy" labels | "A missing-auth control path on the ventilator — the dangerous one." |
| **4. Prove (parallel agents)** | Click **Run exploit** | **One DeepSeek node per finding, spawned in parallel, in a line**; each runs ~10–20s | "We give every flaw its own AI analyst, all at once." |
| **5. Observe** | Click into a node | The **live back-and-forth** with DeepSeek — some conclude *not exploitable* with reasoning, the real one concludes *exploitable* and writes the PoC | "This is the observability — you watch it reason, not just a verdict." |
| **6. Risk** | Keep the exploitable node selected | Right panel: **patient risk** (fan stops, patient crashes, monitor still says 'healthy') + **patch risk** | "Here's what it costs the patient — and why patching it safely is hard." |
| **7a. Exploit — hardware** | Pick **run on device** | Portal flashes the fan-off sketch; **fan spins down, RED LED on, buzzer beeps**; Laptop A ward **freezes + reddens**; monitor still shows green vitals | "Attacker stops the ventilator — and the monitor lies. The patient is crashing and no alarm fires." |
| **7b. Exploit — server/sim (alt)** | Pick **run on server** | Unauthenticated `POST` flips the shared status; the sim reacts the same way without touching firmware | "Same outcome from the web layer — no physical access needed." |
| **8. Patch** | Click **Push patch** | **Factory/Droid nodes spawn off that DeepSeek node**, write + review a fix (add the auth guard / reflash correct firmware) | "Now Factory's Droid writes the patch — and a second agent reviews it before it ships." |
| **9. Verify** | (automatic after approve) | The exact same exploit is **replayed → HTTP 401, blocked**; node turns green "secured" | "Same attack, now dead. Not our word — the replay proves it." |
| **10. Recover** | Reflash healthy / reset | Fan spins back up, **green LED**, ward **breathing** again | "Patient back online. Discover, prove, patch, verify — in under five minutes." |

---

## 5. Reset / recovery between judges
1. Portal **Reset**, or `GET /api/_reset` on the device service → healthy baseline.
2. Reflash healthy firmware: `POST /api/flash/restore` (or re-upload `bedside.ino`) → fan green.
3. Fire `scripts/seed-demo.sh reset maincloud` (or the portal) so Laptop A's ward returns to **breathing**.
4. Confirm: fan spinning + green, ward "source: live · STABLE · BREATHING", portal back at Ready.

---

## 6. Troubleshooting
- **Board missing / "Waiting for device" won't clear:** `arduino-cli board list`; if absent, re-seat the
  USB, swap to a **known-good data cable**, plug **direct** (no hub), try another port. Re-flash healthy.
- **Fan doesn't move but logs say `fan=1`:** serial native binding didn't build —
  `pnpm approve-builds` (select `@serialport/bindings-cpp`), reinstall, retry (bridge path only).
- **Exploit agents stall / no Bitdeer credit:** the pipeline falls back to a streamed offline simulation
  (same beats, ~10s each). It will not block the demo; just narrate it as the agent's reasoning.
- **No venue internet (SpacetimeDB sync dead):** put both laptops on one phone hotspot; on a host run
  `spacetime start` then `spacetime publish --module-path realtime/spacetimedb --server local prevent`,
  and point **both** laptops' `VITE_SPACETIMEDB_URI` at `ws://<host-LAN-ip>:3000`. Grant/trigger with
  `--server local`. Everything else is identical.
- **Buzzer too loud / LEDs too bright:** firmware soft-PWMs the LEDs and beeps the buzzer briefly; if it's
  still much, a larger series resistor is the hardware fix.
- **Portal lists device files on connect:** stale dev server — kill it and restart `pnpm --filter
  @prevent/app dev`; on connect it should just say **Ready**.

---

## 7. The four demo truths (close with these)
1. **Real scanners, real time** — not a scripted animation.
2. **An agent per vulnerability, in parallel** — observable reasoning, not a black-box verdict.
3. **A physical consequence** — the fan actually stops; the monitor actually lies.
4. **A verified fix** — the same exploit is replayed and blocked (401), live.
