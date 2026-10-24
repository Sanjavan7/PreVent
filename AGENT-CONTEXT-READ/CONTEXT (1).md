# VITALS — Project Context (master brief for all agents and code sessions)

**Working name:** VITALS (Vulnerability Identification, Triage, And Live-recovery System). Rename freely.

**One line:** A multi-agent system that finds a vulnerability in a connected medical-style device, proves it is real on a sandboxed twin, generates and applies a fix, and brings the device back online, with every agent step visible, not a black box.

**Tagline:** Find it. Prove it. Patch it. Bring it back.

**Lineage:** This is the Nara pattern applied to hardware. Nara (prior hackathon win) was a CLI pipeline: scan with static analysis (Semgrep/Bandit), confirm the finding is not a false positive, then prove it in an isolated container. VITALS keeps that spine and adds two things Nara did not have: a physical device, and an automated remediation + recovery loop. The judges care about the fix and the recovery, not the break.

---

## 0. HARD SCOPE AND SAFETY RULES (read first, applies to every agent and every teammate)

These are not optional. They keep us clean with judges, sponsors, and the law, and they make the project stronger.

1. **Everything runs on our own two devices, on an isolated network.** Use a dedicated hotspot or a wired link, never venue infrastructure, never any real or third-party equipment.
2. **The "medical device" is a generic, self-built training target with a prop.** It is clearly labeled as a simulation. The hospital angle is the market story in the pitch and the Devpost, not a real device on the table. This is standard for security teaching targets like DVWA and Metasploitable.
3. **Weakness classes are generic and well known** (OWASP IoT Top 10 level): missing authentication on a command endpoint, a hardcoded credential, an unsigned or unverified config/firmware update path, plaintext telemetry, no rate limiting. No real medical-device CVEs, no device-specific attack content, no working exploit code against anything real.
4. **The "payload" is a demonstration input** our own attacker board sends to our own target board to cause a visible, harmless failure. It exists to prove the finding is real. That is the only reason it exists.
5. **No patient data. No clinical claims. No "deployment-ready" or "clinically safe" claims.** It is a hackathon prototype that demonstrates a pipeline.
6. **Back every real-world risk claim with a cited source, not an invented statistic.** Starter citations are in section 10. Verify each against its primary source before putting a number on a slide.
7. **Agents are scoped as defensive work on our own training device, because that is what this is.** Write every agent prompt with that context stated plainly. Do not architect the system around evading model safety. If a model refuses, it is because the request was phrased ambiguously, so restate it accurately: "analyze and remediate a seeded weakness in our own sandboxed training device." Model choice is about cost, latency, and running locally, not about dodging guardrails.

If a coding agent is ever unsure whether something crosses a line, it stays inside this box: our own device, generic weakness, sandbox, fix-focused.

---

## 1. The pitch

**Problem.** Hospitals run large fleets of connected devices, many on old firmware that is hard to patch and hard to monitor. A compromised or malfunctioning device can stop working or report wrong readings, and the downstream effect on care is real and documented (section 10). Patching these devices is slow, and many cannot be taken offline easily.

**Solution.** VITALS is an agent pipeline that does the full loop a security team wishes it had: discover the weakness, prove it is exploitable so it cannot be waved away as a false positive, propose and apply a fix, and restore the device to a known-good state, with a live, auditable record of what every agent did.

**Why it wins.** Most security demos stop at "we found a bug." We go find, prove, fix, recover, and we show it on real hardware with full agent observability. That is the whole product, and it is the part sponsors like Armadin and Factory are built around.

**Why now.** Autonomous vulnerability discovery and repair is a hot, funded direction. The novelty we are claiming is the closed find-to-recovery loop on a physical device with visible agent reasoning. Verify novelty on GitHub and Devpost before pitching it as new (section 11).

---

## 2. System architecture

Two hardware devices, a software pipeline, a real-time backend, and a dashboard.

### Device A — the Target ("the patient device")
- MCU or SBC: ESP32-S3 or Raspberry Pi.
- Physical prop for a visible working/failed state: a small blower or fan pushing air through tubing into a mask, plus a flow or distance sensor, plus a status LED (green working, red failed).
- Exposes a control + telemetry interface over the sandbox network (TCP over WiFi, or BLE, or serial to the host).
- Runs intentionally vulnerable firmware with the planted weakness classes from section 0.3.
- Healthy state: fan on, air flowing, LED green, telemetry streaming normal values.
- Failed state: fan stops or sensor reports a bad value, LED red, telemetry abnormal.

### Device B — the Attacker + Guardian ("the injector")
- Second MCU or SBC on the same sandbox network.
- Attacker role: sends the demonstration input to Device A to trigger the visible failure.
- Guardian role: delivers the fix back to Device A (clean config or firmware), can power-cycle or re-flash via a relay, and verifies recovery.
- Keeping attack and fix delivery on the same board is fine. If time allows, split guardian onto a third board for a cleaner story.

### Software — the Orchestrator (CLI) + the agent pipeline
- A CLI tool, Nara-style, runs the pipeline and streams every step to the backend. It is the control panel for the whole system.
- A dashboard subscribes to the backend and renders device state and agent activity live. This is the observability layer the judges asked for.
- Both the CLI and the dashboard exist. The CLI is the engine and the backup demo surface. The dashboard is the primary visual.

### Backend — SpaceTimeDB
- Holds device state, agent runs, findings, artifacts, and the incident timeline.
- Pushes live updates to the dashboard via subscriptions.
- Doubles as the tamper-evident audit log for the "Close" beat of the demo.

---

## 3. The agent pipeline (five roles)

Each agent has a narrow job, a defined input, and a defined output. The orchestrator runs them in order and logs each to SpaceTimeDB.

1. **Scanner.** Input: Device A firmware source + a light scan of its live interface. Runs Semgrep and Bandit. Output: a list of candidate weaknesses with location and class. Deterministic and credible, this is the backbone.
2. **Triage.** Input: scanner findings. An LLM reasons over them, ranks by impact, picks the real one, and writes a plain-language explanation. Output: the chosen finding + why it matters + why the others are noise. Kills false positives.
3. **Proof.** Input: the chosen finding. Directs Device B to send the demonstration input to Device A, producing the visible failure. Output: before/after telemetry and a pass/fail that the weakness is real. This is the "not a false positive" step. Scoped strictly to our own device.
4. **Remediation.** Input: the confirmed finding + firmware source. Produces the fix: a firmware/config patch and/or a guardian policy rule that blocks the bad input. Output: a patch artifact. This is the Factory AI / Droid hook.
5. **Recovery + Verify.** Input: the patch artifact. Delivers the fix via Device B, restores Device A, re-runs the proof, confirms the attack is now blocked, reports healthy. Output: recovered status + verification result.

Orchestrator responsibilities: sequence the agents, pass artifacts between them, write every phase transition and every agent input/output to SpaceTimeDB, handle a clean failure path so the demo survives one bad step.

---

## 4. Data contracts (lock these in hour 1, they are the critical path)

Three contracts let the four workstreams build in parallel. Exact fields to be finalized together, but the shape is:

**Device command API (host to Device A, and Device B to Device A)**
- `command`: string, for example `set_fan`, `set_config`, `get_status`, `update_config`.
- `args`: object.
- `auth`: token field, which is deliberately missing or ignored on the vulnerable path and enforced on the patched path.
- Response: `status`, `value`, `error`.

**Telemetry (Device A to backend)**
- `device_id`, `timestamp`, `fan_on` bool, `flow` number, `status` enum {healthy, degraded, failed}, `firmware_version`.

**Event / pipeline record (orchestrator to SpaceTimeDB)**
- `incident_id`, `phase` enum {idle, attack, scan, triage, proof, remediation, recovery, closed}, `agent`, `status`, `summary`, `artifact_ref`, `timestamp`.

Keep these stable. Any change after hour 2 needs a quick all-hands because it touches every workstream.

---

## 5. SpaceTimeDB schema sketch

- Tables: `device` (id, role, status, firmware_version, last_telemetry), `agent_run` (id, incident_id, agent, phase, status, started, ended, summary), `finding` (id, incident_id, class, severity, location, status), `artifact` (id, incident_id, kind {patch, proof, log}, ref), `incident` (id, started, phase, ended), `event_log` (append-only, incident_id, phase, actor, detail, hash, prev_hash).
- Reducers: `ingest_telemetry`, `open_incident`, `advance_phase`, `record_finding`, `record_artifact`, `mark_recovered`, `close_incident`.
- Dashboard subscribes to `device`, `agent_run`, `incident`, `event_log` for live rendering.
- Pin SpaceTimeDB 2.12 or later. Expect stale 1.x snippets from tutorials and LLMs. Reducers cannot make external network calls, so any outbound call goes through a scheduled procedure or the orchestrator, not a reducer.

---

## 6. Models and tooling

- Static analysis: Semgrep + Bandit. Deterministic, fast, credible to judges.
- LLM agents: route through a provider or an LLM router. Open-weight models are a reasonable choice for cost, latency, and running locally without internet at the venue. Choose on those merits. Keep every prompt scoped to the sandbox training device per section 0.
- Factory Droid SDK: use it for the Remediation agent, so the patch generation is a sponsor integration.
- Claude: orchestration and triage reasoning, and Claude Code to scaffold the repo.

---

## 7. Demo storyboard (target 3 minutes, plus 2 minutes Q&A)

1. **Healthy.** Device A running, air flowing through the mask, dashboard green, telemetry normal.
2. **Attack.** Proof agent has Device B send the demonstration input. Device A fails visibly, fan stops, LED red, dashboard flips, incident opens.
3. **Pipeline, live.** Scanner, triage, proof, remediation, recovery run on screen, each step showing what it found and did. No black box.
4. **Recovered and hardened.** Device A restored, air flowing again. Replay the same attack. Now it is blocked by the fix.
5. **Close.** Show the SpaceTimeDB incident timeline as the tamper-evident audit trail. End on the tagline.

Simulated: the fire-and-smoke style of a hospital, any 3D room view, patient and nurse characters, extra device types. All optional polish, not core. The core is the live loop on the two real boards.

---

## 8. Sponsor mapping and tracks

- **Anthropic / Claude:** orchestration, triage and remediation reasoning, Claude Code to build.
- **Factory AI / Droid:** the Remediation agent proposes and creates the patch.
- **Armadin:** the proof / red-team side, confirming the weakness is real on our own device. Confirm the exact product name and that a sandboxed self-attack framing qualifies. The transcript "Harmony" is likely a mishearing of Armadin.
- **SpaceTimeDB:** real-time backend and the observability dashboard. Confirm the sidecar / agent-observer capability with the sponsor rather than assuming it.
- **Likely additional fits:** Best Hardware (two custom boards), Most Technically Complex, Microsoft real-world impact. Cartesia if you add a voice incident narration.
- Confirm multi-track entry rules with organizers before counting on stacking.

---

## 9. Observability requirement (explicit judge ask)

Judges said: no black boxes. Every agent must surface what it is doing and why. Minimum bar: for each agent, show input, decision/reasoning summary, output, and a timestamp, live on the dashboard and in the CLI. The event_log table is how we guarantee this. Treat observability as a first-class feature, not a nice-to-have.

---

## 10. Real-world framing (use these, verify before quoting)

Use real, cited numbers. Starting points, each to be confirmed against its primary source:
- Microsoft reported roughly 389 healthcare organizations hit by ransomware in 2024, about a 300% rise since 2015.
- A JAMA study, reported via Microsoft, found that at nearby backup hospitals during an attack, stroke code activations rose about 113.6% and cardiac arrests about 81%.
- A Ponemon survey found roughly 25% of healthcare organizations reported increased patient mortality after cyberattacks. This is a survey perception, state it as such.
Do not invent figures. If you cannot cite it, do not say it.

---

## 11. Open questions to confirm (sponsors, organizers, hardware desk)

- Multi-track entry allowed, and any cap on prizes per team.
- Armadin product name and whether our sandboxed self-attack framing qualifies for the security track.
- SpaceTimeDB sidecar / agent-observer capability, and any workshop time.
- Factory Droid SDK quickstart and limits.
- Hardware lab inventory: boards, relays, fans or blowers, sensors, flashing rig.
- Novelty: 20-minute GitHub and Devpost search for "autonomous vulnerability remediation," "agentic patching IoT," "self-healing device security" before claiming novelty.

---

## 12. Repo layout (suggested)

```
vitals/
  device-target/      # Device A firmware + prop control (Owner 1)
  device-guardian/    # Device B attacker + fix delivery + recovery (Owner 2)
  pipeline/           # agents + orchestrator CLI + Semgrep/Bandit (Owner 3)
  backend/            # SpaceTimeDB module + schema + reducers (Owner 4)
  dashboard/          # live observability UI (Owner 4)
  contracts/          # the hour-1 data contracts, shared source of truth
  docs/               # this file + PLAN.md
```
