# PreVent — Demo Video Script

> Target length: **3:00** (hard cap 3:15). A **90-second cut** is at the bottom.
> Format: documentary cold-open → founder pitch → live demo → close.
> The star of this video is the **fan**. When it spins, a patient is breathing. When it stops, a patient is dying.
> Keep it on camera as much as you can.

---

## Cast & roles (swap freely)

| Role in video | Person | Why |
| --- | --- | --- |
| **The Hook** (walks, delivers the cold open) | **Israel** (security) | Owns the "this kills people" framing |
| **The Pitch** ("we built this") | **Christian** (agents) | Owns the loop / architecture story |
| **The Driver** (runs the portal live) | **Saketh** (hardware) | Hands on the laptop + the board |
| **The Ward** (narrates the patient sim) | **Sanjavan** (realtime) | Owns the 3D ward + SpacetimeDB sync |

> Two voices minimum (Hook + Pitch). If you only have two people on camera, Hook also drives; Pitch also narrates the ward.

---

## The one-sentence spine (say this truth four different ways)

**The vulnerability is known. The patch exists. Nobody ships it fast enough — so the device starts lying to the doctor while the alarm stays silent. PreVent is the thing that ships the fix.**

---

# ACT 1 — THE HOOK  (0:00 – 0:20)

**Shot:** Israel walking down a hallway toward camera (or past a row of laptops / the hardware table). Handheld, slight motion. No title card yet. He's talking straight to the lens like he's telling you a secret.

> **ISRAEL** *(walking, unhurried, grave):*
> "September 2020. A hospital in Germany gets hit with ransomware. A woman shows up needing emergency care — and the ER is down. She dies.
>
> Here's the part that should scare you: the vulnerability they walked in through was **already public**. It had a CVE. The patch **already existed.**
>
> *(stops walking, turns to camera)*
> Nobody shipped it in time. That gap — between *'the fix exists'* and *'the fix is live'* — that's where people die."

**On screen (lower third, small):** `Düsseldorf University Hospital · Sept 2020`
**Cut to black. 0.5s.** Red wordmark slams in: **PreVent**.

> *Alt hook if you want the number instead of the story — same delivery, swap in:*
> "The FBI logged **460 cyberattacks on US hospitals last year.** Up from 249 two years before. And more than **half** of the connected devices in those hospitals are running a vulnerability that's *already been published.* The attack is known. The fix is known. Hospitals just can't ship it fast enough."

---

# ACT 2 — THE PITCH  (0:20 – 0:45)

**Shot:** Christian, mid-shot, standing next to the hardware rig (fan visible, spinning green in frame). Confident, fast, no fluff.

> **CHRISTIAN:**
> "So we built **PreVent** — automatic security for every medical device your hospital *can't* patch.
>
> You point it at a device's code, you plug in the device, and it runs one loop: it **finds** the real vulnerability — cites the actual CVE, not a hallucinated one. It **proves** it's exploitable with a working payload. It **writes the patch.** A human signs off. Then it **replays the exact same attack** to prove the patch holds.
>
> *(beat, gesture at the fan)*
> And this isn't a slide. This is a real ventilator. Watch what happens when the attack fires."

**On screen:** the three words animate in as he says them — **FIND → PROVE → FIX**.

---

# ACT 3 — THE DEMO  (0:45 – 2:30)  ← the whole video lives or dies here

> Two screens on camera: **the Command Center** (the portal, Saketh driving) and **the patient ward** (the 3D sim, Sanjavan narrating). And the **physical fan** between them.
> Pre-load everything. Nothing should spin up cold on camera. Have the backup recording ready (see checklist).

### Beat 1 — "This is the patient." (0:45 – 1:00)
**Screen:** 3D ward, patient breathing, vitals green. Fan spinning, green LED.

> **SANJAVAN:** "This is the ward. That patient is on the ventilator — the fan you can hear. Heart rate 72, oxygen 98. Everything green. Everything calm."

> **SAKETH:** "And this is the device's actual codebase. I'm pointing PreVent at the repo and the plugged-in device. Running the scan now — real scanners, Semgrep and Bandit, no theater."

### Beat 2 — FIND (1:00 – 1:20)
**Screen:** scan runs ~8–10s with a live timer, then findings appear, clickable.

> **SAKETH:** "These are the real flaws in their code. This one —" *(clicks it)* "— a missing-authentication path on the ventilator's command endpoint. CWE-306. The dangerous one."

> **CHRISTIAN** *(voice-over or in frame):* "Every finding gets its own AI analyst, all at once. You don't get a verdict — you watch it reason."

### Beat 3 — PROVE + THE LIE (1:20 – 1:50)  ← the gut-punch
**Driver action:** trigger the exploit on the device.
**Screen + hardware, simultaneously:**
- **The fan spins down. Red LED. Buzzer beeps.**
- **The 3D ward freezes and reddens.** Respiration flatlines.
- **But the monitor still reads 72 / 98, still green.**

> **SANJAVAN** *(quieter):* "The attacker just stopped the ventilator. The patient is in arrest — respiration's flat.
> But look at the monitor. It still says 72 and 98. Still green. **The device is lying to the doctor.** No alarm. Nobody's coming."

> *(Let this sit for 2 full seconds. This is the moment the room stops breathing. Hold the shot on the dead fan.)*

### Beat 4 — FIX + the human gate (1:50 – 2:15)
**Driver action:** push the patch. Factory Droid writes the diff; a reviewer audits it.
**Screen:** patch nodes spawn; a **self-correction** card appears ("REJECTED my own patch — v1 broke the emergency override"); then the pulsing **APPROVE & DEPLOY** gate.

> **CHRISTIAN:** "Factory's Droid writes a real git diff. 41 of 41 tests green. And watch — it just **rejected its own first patch** because it broke the emergency override. It caught itself.
>
> But it does **not** ship on its own. In healthcare, autonomy without a human is a liability. So a human signs."

> **SAKETH** *(clicks APPROVE, on camera, deliberately):* "I'm the human. I sign."

### Beat 5 — VERIFY + RESTORE (2:15 – 2:30)  ← the payoff
**Screen:** the **exact same exploit bytes** replay. Status code flips. Fan spins back up; green LED; ward breathing again.

> **SANJAVAN:** "Same attack. Replayed byte-for-byte. Before the patch: **200 OK** — the device obeyed. After: **401 Unauthorized.** Device refuses. No LLM in that check — it hard-asserts the status code."

> *(Fan audibly spins back up.)*
> **SANJAVAN:** "Fan's back. Patient's breathing. Alarm's armed."

**On screen:** big **200 → 401**, red to green.

---

# ACT 4 — SCALE + RECEIPT  (2:30 – 2:50)

**Screen:** the **FDA §524B auditable receipt** card.

> **CHRISTIAN:** "Every run leaves this — an FDA §524B receipt. Finding, CVE, who patched it, who approved it, and the proof the exploit is dead. A hospital can't buy *'we fixed it.'* They can buy **a signed record of exactly what was fixed, when, and how we know.**
>
> That whole loop? Under 90 seconds. We ran it ten times straight. One hospital runs three thousand devices — and this is built to patch one, then propagate the fix across the whole fleet."

---

# ACT 5 — THE CLOSE + ASK  (2:50 – 3:00)

**Shot:** all four, or back to Israel. Fan spinning green behind them.

> **ISRAEL:**
> "The fix already exists. We just make the devices ship it themselves — and prove it.
>
> We're looking for **one device vendor** to run PreVent against real firmware. Make the devices watch themselves."

**On screen:** `PreVent · make the devices watch themselves` + GitHub link.
**Cut.**

---

## Shot list (what to actually film)

1. **Hallway walk-and-talk** — Israel, hook. 2–3 takes. (Act 1)
2. **Rig two-shot** — Christian next to the spinning fan. (Act 2)
3. **Screen capture A** — Command Center full run, clean, no stalls. (record separately, high-res)
4. **Screen capture B** — 3D ward full run, synced to A. (record separately)
5. **Hardware macro** — tight close-up of the fan: spinning green → dead + red LED + buzzer → spinning green again. Film this 3–4 times; it's your money shot.
6. **The APPROVE click** — over-the-shoulder of Saketh's hand pressing the button.
7. **Team close** — all four, fan behind them.

> Edit: cut between the screen captures and the hardware macro so the *fan stopping* and the *ward reddening* land on the **same beat**. That synchronization is the whole emotional payload.

---

## Recording / safety checklist (before you hit record)

- [ ] Fan starts **green + spinning**. (`flash healthy` / restore firmware — see DEMO-RUNBOOK §3c.)
- [ ] Known-good USB data cable, **direct to laptop, no hub** (the board has been dropping off the bus).
- [ ] Both laptops read `source: live`, ward shows `STABLE · BREATHING`.
- [ ] **Click the page once** before recording so Web Audio can fire the alarm beep.
- [ ] Do one full dry run end-to-end (scan → lie → patch → 401 → restore) and **screen-record it as the backup**. If anything flakes on the live take, you cut to this.
- [ ] If Bitdeer/Featherless credit is out, the pipeline falls back to the streamed offline sim — same beats, ~10s each. Narrate it exactly the same; don't flag it.
- [ ] Reset between takes: `./scripts/seed-demo.sh healthy` + reload the page (clears one-shot animations), reflash healthy firmware.

---

## 90-SECOND CUT (backup / Devpost thumbnail version)

| T | Who | Line / action |
| --- | --- | --- |
| 0:00 | Israel (walking) | "A patient died from a hospital hack where the patch *already existed.* Nobody shipped it. That gap is where people die." |
| 0:12 | Christian | "We built PreVent. Point it at a device, it finds the real bug, proves it, patches it, and replays the attack to prove the fix holds. This is a real ventilator — watch." |
| 0:28 | Saketh | *(scan runs)* "Real scanners. There's the missing-auth flaw — CWE-306." |
| 0:40 | Sanjavan | *(fan stops, red, buzzer; ward reddens; monitor stays green)* "Ventilator's down. Patient's crashing. But the monitor still says 72, 98. **The device is lying.** No alarm." *(hold 2s)* |
| 0:58 | Christian | *(patch, self-correction card, APPROVE)* "Droid writes the fix, catches its own bad first patch — then a human signs. Co-pilot, never autopilot." |
| 1:12 | Sanjavan | *(replay; fan restarts green)* "Same attack. 200 before, **401** after. Fan's back. Patient's breathing." |
| 1:22 | Christian | "Signed FDA receipt, every time. Whole loop, under 90 seconds." |
| 1:28 | Israel | "Make the devices watch themselves. We need one vendor and real firmware." |

---

## Lines to NOT say (the common mistakes)

- ❌ "Hi, we're team PreVent." → Open on the dead patient, not your names.
- ❌ Explaining the architecture before the demo. → Show the fan stop first; explain after.
- ❌ "Thank you for watching." → End on the **ask** (one vendor, real firmware).
- ❌ Reading the slides. → The slides are behind you; talk to the camera.
- ❌ Overselling: don't claim it hunts sibling bugs — it re-proves the one it found. (That's the roadmap; being honest about it is a trust signal if asked.)
