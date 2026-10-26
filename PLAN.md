# Project Brief: Autonomous Medical-Device Security Pipeline

_The product and problem brief behind PreVent. For how the built system fits
together, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)._

---

## 0. What this document is

This is the product and architecture brief. It explains the problem, why it matters, the solution, and how every component fits together. It is the input to a separate, detailed implementation plan (that plan decides languages, libraries, file structure, and exact APIs). So this brief stays at the level of what each part does and why, and deliberately does not prescribe implementation detail. Where a number is cited, it is from a real source listed in section 17, and vendor or survey figures are marked as estimates because that is what they are.

---

## 1. Executive summary

Ransomware is doing measurable, deadly harm to hospitals, and the attack surface it exploits to get a foothold, spread, and hold care hostage is the hospital's own medical devices: thousands of them, riddled with known vulnerabilities, and unpatchable the normal way. We are building a system that autonomously finds a security vulnerability in a medical device's software, proves it is real by exploiting it in an isolated sandbox, then writes and verifies a fix and restores the device, with every step visible and a human approving before anything is treated as final. It shrinks the device attack surface that ransomware walks through.

It is framed as a pre-market and development-pipeline tool: a device maker runs it against a device's software before the device ships, or in staging, to find and fix vulnerabilities while a human signs off. It is explicitly not a tool that auto-patches live devices attached to patients.

The demonstration runs on real but harmless hardware: a small networked device that stands in for a medical device, driving a fan-and-mask "ventilator" prop with a vitals display. When the exploit compromises the device's software, the hardware visibly reacts. When the verified patch is applied, it recovers. Nothing is scripted; the hardware reacts to the real state of the real software. The demo is shown as a split screen: on the left, a hospital/patient view; on the right, the full agent and security pipeline working in real time.

The whole loop is: ground the vulnerability in a real CVE, scan, generate a proof-of-concept exploit, deliver it (the device is compromised), write a patch, verify the patch closes the exact exploit, restore the device. A live dashboard shows every agent's reasoning and artifacts as it happens.

---

## 2. The problem

**The harm: ransomware is devastating hospitals and the patients in them.**
- The FBI recorded **460 ransomware attacks on the US healthcare and public-health sector in 2025**, more than any of the 16 critical-infrastructure sectors it tracks (FBI/IC3, 2025).
- For patients already admitted when an attack hits, studies put the rise in in-hospital mortality at roughly a third (estimates range from about 20% to 40%; McGlave, Neprash and Nikpay). Say "about a third higher" to stay within the evidence.
- Attacks routinely take hospitals offline for weeks. The Joint Commission tells hospitals to plan for systems being down **four weeks or longer** (Sentinel Event Alert 67, 2023). Real cases: Ascension (2024), Change Healthcare (2024), and CommonSpirit (2022, where a 3-year-old received about five times the prescribed dose while the dosing software was down).

**Why hospitals are so exposed: their medical devices are a soft, undefendable attack surface.**
- A hospital runs roughly **10 to 15 connected devices per bed**, and a health system averages **more than 26,000 network-connected devices** (Ponemon/Proofpoint, 2022).
- These devices outlive their security support: hardware is built to last **10 to 30 years** while software support runs out in months to a few years, and **more than 40% of end-of-life devices receive little or no patching** (FBI PIN, 2022). An estimated **83% of imaging devices run unsupported operating systems** (Palo Alto Unit 42, 2020).
- An estimated **53% of connected medical/IoT devices carry a known critical vulnerability**, and among IV pumps (about 38% of a hospital's device footprint) roughly **73% have a vulnerability** (Cynerio, 2022). These are vendor-survey estimates; present them as estimates, but they are the cited industry baseline.
- Attackers exploit exactly this. In the documented **MEDJACK** pattern, attackers use vulnerable medical devices as a foothold to move through the hospital network and persist. Unpatched devices are how an intrusion spreads and holds, and they cannot be patched the normal way, because a software change to a cleared device can trigger a new FDA 510(k) review.
- Real disclosed device flaws at scale: **Abbott/St. Jude pacemakers** (about 465,000, no authentication on the radio interface, 2017); **Medtronic Conexus** telemetry (up to 750,000 defibrillators, no encryption or authentication, CVSS 9.3, 2019); **Medtronic MiniMed insulin pumps** (Class I recall, 2019); and component-level flaws **URGENT/11**, **Ripple20**, **SweynTooth**, and **PwnedPiper** (in about 80% of major North American hospitals), plus infusion-pump flaws in **Becton Dickinson Alaris** and **Baxter Sigma Spectrum**.

**The chain to state plainly, without overclaiming:** unpatched devices widen the attack surface → ransomware gets in and spreads → care is disrupted → patients are harmed. Two honesty points the pitch must respect:
- Medical devices are **not** the most common initial entry point for ransomware (phishing, stolen credentials, and exposed services such as the no-MFA Citrix login at Change Healthcare are more common). Devices are the unpatchable surface attackers pivot through and persist on once inside. Frame them that way, not as "how ransomware always gets in."
- There is **no publicly confirmed patient death caused by a medical-device hack**. The documented deaths come from ransomware disrupting care broadly. The mortality and outcome figures above are about hospital attacks (mostly ransomware hitting IT), not device compromise specifically. Say so; overclaiming a device-hack death is false and easy for a knowledgeable reviewer to puncture.

**Why the fix has to happen before deployment or in staging:** because a change to a cleared device can require a new FDA submission, and because patching live clinical devices can require downtime or physician supervision, the right place to find and fix these vulnerabilities is before a device ships or in the maker's development pipeline, with a human in control, not pushed automatically to a device in use.

---

## 3. Why it is needed now

Two things converged in the last two years that make this both required and possible.

**It is now legally required.** FDA section 524B (added by the Consolidated Appropriations Act, 2023) makes it a condition of clearing a "cyber device" that the manufacturer:
- submit a plan to monitor, identify, and address cybersecurity vulnerabilities and exploits in a reasonable time,
- design and maintain processes that provide reasonable assurance the device is secure and make patches available, and
- provide a software bill of materials (a list of all software components, including open-source and off-the-shelf).

This applied to submissions from March 29, 2023, with enforcement from October 1, 2023. In plain terms: device makers now have to demonstrate a repeatable way to find and fix vulnerabilities to get a device approved. That is a tooling problem, and it is the market this project serves. (Cite this as "section 524B," not the "PATCH Act," which was the informal bill name. The software-bill-of-materials-to-vulnerability link is a logical use of the inventory, cross-referencing components against known-vulnerability databases, not a direct FDA instruction.)

**It is now technically possible.** Autonomous systems that find and fix vulnerabilities went from research to demonstrated reality in 2025:
- At **DARPA's AI Cyber Challenge final (August 2025)**, autonomous systems analyzed over 54 million lines of code, found 86% of planted vulnerabilities, patched 68% of those they found in about 45 minutes each, and discovered 18 real previously-unknown vulnerabilities. This is the strongest proof that autonomous find-and-patch on real code is real.
- **Google's Big Sleep** found a critical real vulnerability (CVE-2025-6965) that was known only to attackers and headed off an in-the-wild exploit (2025).
- **XBOW** reached number one on HackerOne's US leaderboard (2025), evidence that autonomous discovery is now competitive with human researchers (with the caveat that its findings were human-reviewed and its precision is debated).

**But the capability is imperfect, and that is the core design argument.** A 2026 study of over 6,000 AI patch attempts found only **26% completely fixed the vulnerability without side effects**, about **49% failed to close at least one exploit path**, about **20% fixed the flaw but broke functionality**, and about **2% introduced a new vulnerability**. The researchers' line: "generating a patch isn't the same as fixing a vulnerability." This is not a reason to avoid the tool. It is the reason the tool must verify every patch by re-running the exploit, must keep a human sign-off, and must stay in the pre-market or staging pipeline rather than auto-pushing to live devices. The limitation justifies the design.

**The gap we fill:** existing autonomous security work mostly finds vulnerabilities, or finds and patches in pure software. Tying the full find-exploit-patch-verify loop to a real device that visibly fails and recovers, with a human gate and full visibility, aimed at the pre-market medical-device context the FDA now regulates, is the specific contribution.

---

## 4. The solution

A pipeline of specialized AI agents, coordinated through shared state, that runs one loop end to end and shows its work. Each agent has one job, and no single agent can both find a weakness and silently fix or deploy it. The loop:

1. **Ground the vulnerability.** Pull a real, published medical-device vulnerability (from the free NVD/CVE database) and model the device's planted weakness on it, so the scenario is realistic and citable rather than invented.
2. **Scan.** Run standard static-analysis tools (SemGrep, Bandit) over the device's software. An agent interprets the results and decides which finding is a real, exploitable weakness rather than noise.
3. **Generate the exploit.** An agent writes a proof-of-concept exploit for that weakness, targeting only the team's own sandboxed device. The exploit must achieve a real effect (controlling the device or corrupting its data), not merely crash it, because a crash is the weakest and least convincing result.
4. **Deliver.** The exploit is sent to the device's software. The device is genuinely compromised, and because the hardware is driven by the real software state, the physical device and the on-screen patient visibly react.
5. **Patch.** The coding agent (Factory Droid) writes a fix for the vulnerability, with its reasoning and the code change shown as a visible diff, limited to the target repository and unable to deploy on its own.
6. **Verify (deterministic, not AI).** The exact same exploit is re-run against the patched software. It must now fail. This is the hard proof that the fix actually works, not just that code changed.
7. **Restore.** The patched software is redeployed, the device recovers, and the physical device and the on-screen patient return to their working state.

A human approves before the patch is treated as final, and the system refuses to act outside its sandbox. Every step, including the agents' reasoning and the real artifacts (the finding, the exploit, the diff, the verification result), appears on the live dashboard.

**Recommended vulnerability to use.** Model the planted flaw on **missing authentication on the device's control interface**, which is a real, documented medical-device vulnerability class: the Medtronic Conexus telemetry flaw (CVE-2019-6538) and the Abbott pacemaker flaw both had no authentication on the commands that control the device. The exploit then sends an unauthenticated request that controls the device. For the effect, the strongest and most credible option is a combined **control-and-integrity attack**: the unauthenticated command stops the ventilator (the fan stops, visible sabotage) and falsifies the device's own readings so it still reports normal and never alarms (the device lies), while the real patient crash shows on the left panel. That is a genuine control and integrity compromise, not a denial of service, it maps to a real CVE, and the patch (add authentication and input validation on the endpoint) is clean and the verifier can prove it closed. A simpler fallback effect is to have the device visibly fail and alarm on compromise instead of lying. Avoid memory-corruption exploits as the primary path; they are hard to pull off reliably on this hardware in the time available.

---

## 5. Framing and safety boundaries (critical, do not drift from these)

These boundaries are what make the project credible to security and medical reviewers and what keep it responsible. The implementation must honor them.

- **Pre-market / staging only.** The system operates on device software in development or before shipping, producing a fix for human approval. It does not auto-patch live devices in clinical use. Auto-patching a running medical device is exactly the reckless thing real regulation prevents.
- **Sandbox only.** All exploitation happens against the team's own deliberately vulnerable target, in an isolated environment. The system must be built so it cannot act against anything outside that sandbox, and it should visibly refuse if asked to.
- **AI proposes, humans dispose.** Agents find, exploit, draft, and the system verifies. A human approves the patch. The deterministic verifier, not an AI, makes the final "the exploit now fails" call.
- **Separation of duties between agents.** The agent that reads untrusted input (scanner output, the target's responses) is not the agent that writes the patch or decides to restore the device. This mirrors real security controls and is also a genuine defense against an agent being manipulated.
- **No overclaiming.** The pitch states honestly that no confirmed patient death from a device hack exists, and presents vulnerability statistics as industry estimates.

---

## 6. System architecture (high level)

Three layers.

```
  AGENT LAYER (reasoning + action)
  orchestrator -> scan -> exploit-gen -> deliver
                -> patch -> verify -> restore
        |  each agent reads and writes shared state, and emits its steps
        v
  COORDINATION + OBSERVABILITY LAYER (shared state)
  one real-time shared database holds: agent status, findings,
  exploit runs, patch attempts, the event log, and the device's status.
  BOTH the dashboard (right panel) and the hospital/patient view (left panel)
  subscribe to this, so the physical device and both screens stay in sync.
        ^
        |  the device's status is a row here; changing it drives the hardware
        v
  DEVICE LAYER (the simulated medical device)
  a small networked service runs the vulnerable software; its real state
  drives the physical prop (fan, vitals display, alarm, status light).
```

Two contracts hold the system together, and both must be agreed before building:
- **The event schema** in the shared database (what every agent writes: which agent, which step, status, the input and output of that step, a timestamp). This is what makes the dashboard possible and is the backbone of the "no black box" requirement.
- **The device service API** (the shape of the request the exploit sends and the service's responses). The exploit, the device, and the verifier all depend on this.

The single source of truth for the device's condition is one shared-state row. The physical hardware, the left-panel patient view, and the right-panel dashboard all read it, so nothing can drift out of sync and nothing is faked.

---

## 7. The agent pipeline, stage by stage (functional)

Each agent's responsibility, what it takes in, and what it produces. Implementation (how each is built, which model, exact prompts) is for the implementation plan.

- **Orchestrator.** Drives the loop, decides what runs next, and carries the overall reasoning. Enforces that a human approval happens before the patch is final. Emits its decisions to the shared state.
- **Scanner agent.** Input: the device's source. Runs static-analysis tools, then reasons over their output to select the genuine exploitable finding (not just forwarding the tool's list). Output: a chosen finding with a rationale, linked to the real CVE it is modeled on.
- **Exploit-generation agent.** Input: the chosen finding and the device API. Produces a proof-of-concept exploit aimed only at the sandboxed device, designed to achieve a real effect. Output: the exploit, plus a statement of what effect it should produce.
- **Delivery + outcome check.** Sends the exploit to the device service, observes whether the intended effect occurred, and records the real compromise. Output: confirmation (with evidence) that the device was compromised, and the device-status change that drives the hardware and both screens.
- **Patch agent (Factory Droid).** Input: the finding and the confirmed exploit. Writes a fix, shown as a visible diff, limited to the target repository and unable to deploy on its own. Output: the patch.
- **Verifier (deterministic, not AI).** Re-runs the exact same exploit against the patched software. Output: the exploit now fails (or it does not, in which case the loop goes back to the patch agent). This is the proof.
- **Restore.** Redeploys the patched software; the device recovers; the device-status row flips back to healthy.

The reactive property matters: the loop must handle a vulnerability it was not pre-fed in the demo (for example, an operator choosing the payload, or a second bug introduced live), because that is what proves it is a real system and not a scripted sequence.

---

## 8. The hardware (what it represents and how it is driven)

The physical device is a prop, but its behavior is real: it is driven by the actual state of the device software, so it cannot be faked.

Available hardware: a Raspberry Pi Pico 2 W (has WiFi) plus an Elegoo starter kit (UNO R3, breadboard, relay, a 3-6V fan motor, LCD1602 display, active and passive buzzers, RGB LED, resistors, jumper wires, power supply module).

- The **Pico 2 W** runs the vulnerable networked service over WiFi. This is the stand-in medical device.
- A **fan** (switched by the relay, on its own power) is the "ventilator": it runs when the device is healthy and stops when the device is compromised, so the sabotage is physically visible.
- The **LCD1602** is the device's own readout. Under the recommended attack (section 4) it keeps displaying normal vitals even after the fan stops, because the attacker has made the device lie; the true patient deterioration appears on the left panel instead. It returns to true, healthy vitals on restore. (Simpler alternative if you want more immediate legibility on the device itself: have the LCD visibly flatline and the alarm fire on compromise.)
- The **buzzer** and the **RGB LED** are the device's alarm and status light. Under the recommended attack the point is that they stay calm (green, silent) while the patient is really failing, because the device has been made to hide the problem; the red state and the alarm live on the left-panel ground truth. They return to an honest green on restore.
- A **mask and tubing** on a prop patient (not a person's face) complete the picture; airflow should be visible from a distance. A cheap pharmacy CPAP or oxygen mask is enough for the look.

Do not chase a real ICU ventilator: it is not a retail product, it is expensive hospital equipment, and it adds nothing over the prop. The fan-and-mask prop is the correct and safer choice.

The implementation must drive all of this from the device's real status (the shared-state row or a direct signal from the service), never from a timer or a script. Safety: the mask is never sealed on a person; it sits on a prop or is held loosely so air only flows toward the person.

The hardware's role is to make the stakes legible and emotional and to qualify for hardware and social-impact recognition. It is not the technical core; the find-exploit-patch-verify loop is. Weight implementation effort accordingly.

---

## 9. The demo experience and interface (split screen)

The demo is presented as one split screen, both halves driven by the same real shared state, so the physical device and both panels always agree.

**Left panel: the hospital and patient.** An immersive hospital view (built in the same web app, 2D or 3D) showing the patient in a room with live vitals, set inside a hospital floor or building so the viewer sees this is one device among thousands — the ground truth of what is really happening to the patient. When the device is compromised, this panel shows the patient truly crashing, while the device itself keeps reporting normal (the lie, see section 4), which is the chilling contrast. Optionally, the compromise can be shown spreading to neighboring devices (the MEDJACK and ransomware-spread story), then contained and healed by the fix. This panel carries the human stakes.

**Right panel: the pipeline.** The full agent and security dashboard (section below): every agent's current step and reasoning, and the real security artifacts as they are produced. This is the depth-and-complexity showcase.

**Build order.** The core find-exploit-patch-verify loop must reach a working state before the simulation is polished, because the live exploit is the one thing that cannot be faked. The physical device and the simulation reinforce each other: the hardware is the physical stakes, and the simulation is the system-level view.

---

## 10. Observability (the "no black box" requirement)

Judges have said explicitly they do not want a black box. The right panel must show not just that steps happened but what each agent reasoned and produced. On one live view:
- each agent's current step and status,
- the real artifacts at each step: the scanner finding, the exploit code, the patch diff, the verification result,
- each agent's stated hypothesis and its uncertainty, and at least one visible instance of an agent being wrong and the system catching it,
- the device's status, changing live as the loop runs.

This view also carries the sponsor goals at once: it shows the reasoning model's judgment and safety refusals (Anthropic), it streams the coding agent's plan and diff (Factory), and it proves the exploit fires and then fails after the patch (Armadin).

---

## 11. Tech stack

The stack and what each piece does.

**Load-bearing:**
- **Claude (Anthropic)** is the reasoning core across the loop: choosing the real finding, planning the exploit, judging outcomes, and triaging verification. Its safety behavior (reasoning about blast radius, refusing to act outside the sandbox, surfacing uncertainty before the patch is final) is a visible, first-class part of the system, not a disclaimer.
- **Factory Droid SDK** is the patch agent: invoked by the orchestrator (not a human), it does real repository work, streams its plan and diff to the dashboard, and is scoped so it cannot leave the repository.
- **SpacetimeDB** is the coordination and observability layer: the one shared real-time database all agents write to, and that both panels subscribe to, with the device's status as a row. A keyless `mock` backend stands in for fully offline development.
- **An open model for exploit generation** (`DeepSeek-V4.1-Flash`, served via Bitdeer, with Featherless as a standby) writes the proof-of-concept — kept as a separate trust domain from the decision model (Claude never writes exploit code).

**Committed, lighter:**
- **Free NVD/CVE data** grounds the modeled vulnerability in a real published advisory (no external dependency).

---

## 12. The demo sequence (what must work end to end)

The implementation must support this sequence running live, across the split screen:

1. The device is alive: fan running, vitals steady, green light; on the left the patient is stable; on the right the agents are idle. State the framing line (pre-market pipeline, human sign-off).
2. The scan runs and the reasoning agent picks the real vulnerability out of the noise, citing the real CVE it is modeled on.
3. The exploit fires, ideally on a chosen or newly introduced payload, achieving a real effect; the device is compromised; the ventilator stops while the device keeps reporting normal (the lie), and the left panel shows the patient truly crashing.
4. The patch agent writes the fix, its plan and diff streaming onto the right panel, visibly unable to leave the repository.
5. The reasoning agent surfaces its uncertainty and waits for a human OK (the sign-off).
6. The same exploit is re-run and now fails; the device recovers; the patient recovers.
7. The loop can be run again cold, on a new input, to prove it is reactive and not scripted.

Optional, to make the ransomware center literal: show the exploited device being used as the foothold, with a ransom lock or message appearing, and in the fixed run the closed vulnerability blocks it so the lock never happens. Only add this once the core loop is solid, and keep the honesty framing (the device is the way in, not the whole attack).

The implementation must also produce a backup recording of this full sequence, because the live hardware can fail (the device can drop its wireless connection).

---

## 13. Success criteria

The build is successful when:
- the full loop runs end to end, live, on real hardware, reliably enough to repeat on demand;
- the exploit demonstrably achieves a real effect (control or data integrity), not just a crash, and the verifier proves the same exploit fails after the patch;
- the loop works on an input that was not pre-staged (operator-chosen or newly introduced);
- the right panel shows every agent's reasoning and the real artifacts, including at least one caught mistake;
- the left panel reflects the real device state, so the physical device and both screens always agree;
- the patch agent's work is genuinely autonomous and visibly scoped, and a human approval gates the result;
- the framing (pre-market, sandbox, human sign-off, honest claims) holds throughout.

---

## 14. Non-goals and out of scope

- Not auto-patching live or clinical devices.
- Not acting on any target outside the team's sandbox.
- Not claiming clinical safety, regulatory clearance, or real deployment.
- Not a general-purpose scanner product; the demo is one device, one vulnerability class, done convincingly, rather than broad coverage done shallowly.
- Not handling real patient data.

---

## 15. Decisions (as built)

1. Exploit-generation model host: an open DeepSeek model via Bitdeer (Featherless standby), kept separate from the decision model.
2. Realtime backend: SpacetimeDB, with a keyless `mock` backend for offline development.
3. The simulation ships as a 3D hospital view alongside the dashboard.
4. Project name: PreVent.

---

## 16. Key risks

- **The exploit being a mere crash, or the vulnerability being obviously planted.** Mitigation: achieve a real control/integrity effect, model it on a real CVE (the missing-authentication class, CVE-2019-6538), and support an operator-chosen or newly introduced input.
- **AI patch unreliability** (the 26% figure). Mitigation: the deterministic verifier and the human gate are mandatory, not optional.
- **The sim and the core loop competing for attention.** Mitigation: the core loop reaches a working state first, and the two are tracked separately so neither starves the other.
- **SpacetimeDB setup time.** Mitigation: start it first; the keyless `mock` backend keeps everything runnable offline meanwhile.
- **Live hardware failure during judging.** Mitigation: the backup recording and a software-only fallback path.
- **Overclaiming patient harm.** Mitigation: the honesty requirements in sections 2 and 5.

---

## 17. Sources

Scale and prevalence:
- Connected devices per bed and FBI patching data: FBI PIN, Sept 2022, https://www.ic3.gov/CSA/2022/220912.pdf
- 26,000+ devices per health system, and post-attack outcome survey: Ponemon/Proofpoint via Healthcare IT News, 2022, https://cloudgate.healthcareitnews.com/news/direct-line-between-hospital-cyberattacks-and-patient-mortality-report-shows
- 83% of imaging devices on unsupported OS: Palo Alto Unit 42, 2020, https://unit42.paloaltonetworks.com/iot-threat-report-2020/
- 53% critical-vuln figure, IV pump figures: Cynerio 2022, https://www.hcinnovationgroup.com/cybersecurity/medical-device-security/news/21254226

Incidents and recalls:
- Abbott/St. Jude pacemakers (465,000), 2017: https://www.raps.org/resource/abbott-recalls-465000-pacemakers-for-cybersecurit.html
- Medtronic Conexus (750,000 defibrillators; CVE-2019-6538), 2019: https://securityboulevard.com/2019/05/750000-medtronic-defibrillators-are-vulnerable-to-hacking-3/
- Medtronic MiniMed insulin pumps recall, 2019: https://www.hpnonline.com/patient-satisfaction/patient-safety-tactics/article/21113878
- URGENT/11, 2019: https://www.healthcareitnews.com/news/urgent11-fda-issues-alert-cyber-vulnerability-threatens-medical-devices-networks
- SweynTooth, 2020: https://www.hpnonline.com/healthcare-it/article/21128449
- Ripple20, 2020: https://www.trendmicro.com/vinfo/us/security/news/internet-of-things/millions-of-iot-devices-affected-by-ripple20-vulnerabilities
- PwnedPiper, 2021: https://health-isac.org/armis-discovers-9-vulnerabilities-in-infrastructure-used-by-80-of-major-hospitals-in-north-america/
- MEDJACK, 2015-16: https://spectrum.ieee.org/hackers-invade-hospital-networks-through-insecure-medical-equipment
- BD Alaris infusion pumps, 2023: https://www.medtechdive.com/news/becton-dickinson-cybersecurity-vulnerabilities-alaris/687036/
- No confirmed death from a device cyberattack: https://www.medtechdive.com/news/cyber-attacks-security-medical-devices-kevin-fu-advamed/607483

Why hard to patch:
- FDA guidance on when a software change needs a new 510(k): https://www.fda.gov/regulatory-information/search-fda-guidance-documents/deciding-when-submit-510k-software-change-existing-device

Regulation (why needed now):
- FDA section 524B FAQ: https://www.fda.gov/medical-devices/digital-health-center-excellence/cybersecurity-medical-devices-frequently-asked-questions-faqs
- Section 524B compliance overview: https://www.crowe.com/insights/medical-device-cybersecurity-complying-with-section-524b
- SBOM (CISA): https://www.cisa.gov/sbom

Why possible now (AI capability) and its limits:
- DARPA AIxCC results, Aug 2025: https://www.darpa.mil/news/2025/aixcc-results
- Google Big Sleep, 2025: https://therecord.media/google-big-sleep-ai-tool-found-bug
- XBOW tops HackerOne, 2025: https://www.techrepublic.com/article/news-ai-xbow-tops-hackerone-us-leaderboad/
- AI patch failure-rate study, 2026: https://www.esecurityplanet.com/artificial-intelligence/1password-finds-ai-security-patches-fail-more-than-half-the-time
