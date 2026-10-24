# VITALS — Build Plan and Work Split

Four people, four owned workstreams, clear interfaces so you build in parallel. Read CONTEXT.md first. Honor the hard scope rules in section 0 of that doc at all times.

Deadline anchor: submission closes Sunday 9 AM. Plan backward from there.

---

## The ownership model

Each person owns one workstream end to end, including its demo moment. You are not just coding a piece, you own that it works on stage. Help across lines when blocked, but one name is accountable per stream.

| Stream | Owner | Owns | Demo moment they are accountable for |
|---|---|---|---|
| A. Target device | TBD | Device A firmware, prop, telemetry, seeded weaknesses | The visible healthy and failed states |
| B. Guardian device | TBD | Device B attack delivery, fix delivery, physical recovery | The device coming back online |
| C. Agent pipeline | TBD | 5 agents, orchestrator CLI, Semgrep/Bandit, models | The live find-prove-fix loop, no black box |
| D. Backend + dashboard + pitch | TBD | SpaceTimeDB, dashboard, demo script, Devpost, sponsors | The live dashboard and the 3-min pitch |

Assign names at the kickoff. Match to strengths: embedded to A and B, agents/LLM to C, full-stack/real-time and presentation to D.

---

## Hour 1 is the whole game: lock the contracts

Before anyone goes deep, the four of you agree on the three data contracts in CONTEXT.md section 4, and commit them to `contracts/`:
1. Device command API.
2. Telemetry format.
3. Event / pipeline record format.

Everything else depends on these. If they are stable, all four streams integrate cleanly. If they drift, integration fails at hour 20. Lock them, write them down, and treat any change after hour 2 as an all-hands.

Also in hour 1: repo created, skeleton folders, everyone can push, SpaceTimeDB instance running locally and reachable.

---

## Workstream A — Target device (Device A)

**Goal:** a self-built, intentionally vulnerable device with a visible physical state.

**Deliverables**
- MCU/SBC driving the fan or blower, tubing, mask, sensor, status LED.
- Firmware exposing the command + telemetry interface per the contract.
- Planted weakness classes from CONTEXT section 0.3, clearly commented in source so the Scanner can find them and so we can prove they were intentional.
- A software-only fallback twin of Device A, so the pipeline and demo survive a dead board.

**Interfaces out**
- Publish the command set and telemetry format to `contracts/` early. Owners B and C are blocked until you do.
- Firmware source in the repo so the Scanner can run on it.

**Definition of done**
- Device shows healthy: fan on, telemetry normal, LED green.
- A known bad input flips it to failed: fan off, telemetry abnormal, LED red.
- The same behavior works on the software twin.

---

## Workstream B — Guardian device (Device B)

**Goal:** the board that delivers the demonstration input and the fix, and physically restores Device A.

**Deliverables**
- Attack delivery: send the demonstration input to Device A over the contract interface, on command from the pipeline.
- Fix delivery: push the clean config or firmware to Device A.
- Recovery: power-cycle or re-flash Device A via a relay, then confirm it is healthy.
- A software-only fallback for this board too.

**Interfaces**
- Consumes Owner A's command API.
- Exposes simple actions the orchestrator calls: `deliver_attack`, `deliver_fix`, `recover`.

**Definition of done**
- On command, triggers the visible failure on Device A.
- On command, delivers the fix and brings Device A back to healthy.
- Recovery works end to end without a human touching the board.

---

## Workstream C — Agent pipeline + orchestrator

**Goal:** the five-agent loop and the CLI that runs it, Nara-style, fully observable.

**Deliverables**
- Scanner: Semgrep + Bandit on Device A firmware, plus a light interface scan.
- Triage: LLM ranks findings, picks the real one, explains, kills false positives.
- Proof: calls Owner B's `deliver_attack`, captures before/after telemetry.
- Remediation: generates the patch, via Factory Droid SDK.
- Recovery+Verify: calls `deliver_fix` and `recover`, re-runs proof, confirms blocked.
- Orchestrator CLI: sequences all five, passes artifacts, writes every step to the backend, and has a clean failure path.

**Interfaces**
- Consumes Owner A's firmware source and telemetry.
- Calls Owner B's actions.
- Writes event records to Owner D's backend per the contract.

**Definition of done**
- `vitals run` executes the full loop and prints each agent's input, decision, and output.
- Every phase appears in SpaceTimeDB.
- One bad agent step fails gracefully, it does not crash the demo.

**Note on models:** scope every prompt as defensive work on our own sandbox training device, per CONTEXT section 0.7. Choose models for cost, latency, and local running.

---

## Workstream D — Backend, dashboard, pitch

**Goal:** the real-time backend, the observability dashboard, and the win on stage.

**Deliverables**
- SpaceTimeDB module: schema and reducers per CONTEXT section 5. Pin 2.12+.
- Dashboard: live device state, the agent timeline with input/decision/output per step, the incident record. This is the judges' no-black-box requirement, own it hard.
- Demo script, the 3-minute run of show, the replay-now-blocked beat.
- Devpost writeup, sponsor conversations, the open questions in CONTEXT section 11.
- Offline fallback: the dashboard and a cached good run must work with no venue internet.

**Interfaces**
- Consumes event records from Owner C and telemetry from Owner A.

**Definition of done**
- Dashboard updates live as the pipeline runs.
- A non-technical person watching the dashboard understands what each agent did.
- The demo runs start to finish from one command, with a recorded backup video.

---

## Timeline (36 hours, backward from Sunday 9 AM)

- **Hour 0 to 2, Fri:** kickoff, assign owners, lock the three contracts, repo + skeleton, SpaceTimeDB up.
- **Hour 2 to 10, Fri night:** each stream to a stub-integrated state. Device A shows healthy. Scanner runs on firmware. Backend ingests telemetry. Dashboard renders device state. First integration smoke test at hour 10 with stubs.
- **Hour 10 to 20, Sat:** real end to end. Attack causes visible failure. Full pipeline runs. Remediation produces a patch. Recovery restores the device. This is the make-or-break window.
- **Hour 20 to 28, Sat eve:** add the replay-now-blocked beat. Polish dashboard observability. Harden the failure paths. Draft Devpost. Confirm sponsor tracks.
- **Hour 28 to 34, Sat night to Sun:** freeze features. Rehearse the 3-min demo and 2-min Q&A out loud. Record the backup video. Verify offline fallback.
- **Hour 34 to 36, Sun:** submit by 9 AM, with buffer. Do not leave submission to the last 15 minutes.

Integration checkpoints: hour 10 (stubs talk), hour 20 (real loop runs once), hour 28 (demo-complete). If you miss a checkpoint, cut scope, do not push the checkpoint.

---

## Risk register and fallbacks

- **Integration drift:** lock contracts hour 1, freeze after hour 2. The single biggest risk.
- **Dead or flaky board:** every hardware stream ships a software twin. The demo can run fully in software if a board dies.
- **Venue WiFi:** use your own hotspot or wired. Run SpaceTimeDB locally. Test at your table early.
- **LLM nondeterminism:** cache one known-good run for the live demo, and have a scripted fallback. Judges watch the demo, not a live dice roll.
- **SpaceTimeDB learning curve:** Owner D starts it at hour 0, pins 2.12+, remembers reducers cannot make external calls.
- **Scope creep:** the 3D room, characters, extra devices are all optional. Core loop first, polish only after hour 20.

---

## Demo-day runbook (Owner D leads, everyone knows it)

1. Devices powered, on the hotspot, healthy state confirmed before judges arrive.
2. Lead with the problem and one cited stat, 15 seconds.
3. Run the loop live from one command.
4. Hit the replay-now-blocked beat.
5. Close on the audit timeline and the tagline.
6. Backup video queued in case hardware misbehaves.
7. Tailor the Q&A to each judge, sponsor judges read the Devpost, general judges watch the demo.

---

## Sponsor and logistics checklist (Owner D)

- Confirm multi-track entry and any prize cap.
- Confirm Armadin product name and that a sandboxed self-attack qualifies.
- Confirm SpaceTimeDB sidecar/observer capability and workshop time.
- Confirm Factory Droid SDK usage for Remediation.
- Hardware desk: boards, relay, fan/blower, sensor, flashing rig.
- 20-minute novelty search before claiming the loop is new.
