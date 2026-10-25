# PreVent — Portal Revamp Plan (real-time, multi-agent, de-planted)

> Driver: Opus 4.8 (this chat). Implementation: parallel Opus agents, one per workstream below.
> This doc is the single source of truth for the revamp. Each workstream is a self-contained agent task.

## The pitch (the "why" every surface must serve)
PreVent is an **autonomous security service for healthcare clinics** that can't audit the firmware and
control software of the hardware keeping patients alive. A ventilator (modeled here by a real Arduino
+ fan) has a missing-authentication flaw; an attacker stops the fan and spoofs the monitor so staff
see "healthy" while the patient crashes. **People die from exactly this class of unpatched device bug.**
We come in like a pentest firm: point us at the repo + plug in the device, and we **discover, prove,
and patch** the vulnerability in real time, in front of the client — with full observability.

## Two parts of the demo
1. **The portal (this laptop — "Laptop B"):** repo in + device plugged in → scan → vulnerabilities →
   per-vuln DeepSeek agents → pick an exploit → fan stops (hardware) / server breached → push a patch
   (Factory/Droid) → verify (exploit now blocked) → recover.
2. **The patient simulation (teammate — "Laptop A"):** a 3D ward that breathes/freezes/reddens with the
   device, synced through the shared SpacetimeDB `device_status` row. See `plans/DEMO-TWO-LAPTOP.md`.

---

## Current state (honest) — what we're changing
- **Entry:** connect screen already waits for hardware + takes a repo/folder; but scan can start without
  a repo. → require **both** repo AND device before "scan" lights up.
- **Scan:** live path runs real Semgrep/Bandit but fast; sim path uses **hardcoded timings** (fixtures).
  Finding set is small + sourced only from 3 planted files. → real scan over the **whole cloned repo**,
  genuinely ≥8s, no hardcoded timing tells.
- **Planted tells (MUST remove):** `device-service/app.py` and `firmware/uno_actuator.ino` are covered in
  giveaways — `# ruleid: flask-missing-auth-decorator`, "intentionally vulnerable", "THE LIE",
  "CWE-306 (see rules/missing-auth.yaml)", "the SCAN stage's wrong-then-caught probe relies on Bandit's
  noise", etc. A judge reading the repo must see an **organic** codebase with a **real** bug, not a plant.
- **"decoy" framing (MUST remove):** findings are pre-labeled `exploitable` / `decoy`. The verdict must
  instead come out of the **DeepSeek conversation** at exploit time, not a precomputed label.
- **Exploit:** currently a **one-shot** prompt→response for 2 fixed payloads (server, fan), rendered as a
  linear graph. → **one multi-turn DeepSeek conversation per exploitable finding, N in parallel.**
- **Patch:** Droid writer/reviewer/verify exists as a separate chain. → Factory nodes should **spawn from
  the DeepSeek node** that proved the exploit, completing the graph.

---

## Target experience (the user's vision, point by point)
1. **Entry gate:** program runs → paste GitHub repo URL **and** plug in the Arduino → only when **both**
   are present does "Run scan" light up.
2. **Scan (≥8s, real):** Semgrep + Bandit run for real over the cloned repo; ~8s+ of genuine work; then
   the findings become clickable. No hardcoding anywhere on the live path.
3. **No "decoy":** drop that label. Non-exploitable findings are revealed as such **through the agent
   conversation**, not a sticker.
4. **Real-time feel:** everything reads as live analysis — streamed tokens, spawning nodes, elapsed timers.
5. **De-planted repo:** the vulnerable Arduino/server code has a *real* bug but **no author tells**. The
   scanners fire on the **code pattern**, not on a `# ruleid:` comment.
6. **Per-vuln DeepSeek agents:** for **each** Semgrep/Bandit finding, open **one** DeepSeek conversation
   (via Bitdeer) that argues exploitable-or-not and, if yes, writes the exploit. **N findings → N nodes in
   a line, running in PARALLEL.** Each conversation takes ~10–20s.
7. **Click into any node:** watch the live back-and-forth with DeepSeek (observability). Some conclude
   "not exploitable" with reasoning; the known-bad ones conclude exploitable and author a PoC.
8. **Right panel = risk:** for the selected finding, show **patient risk** (clinical impact) **and the
   risk of patching** (why a fix is non-trivial / what could break) — the latter motivates the patch step.
9. **Two exploit routes:** (a) **hardware** — flash the board so the fan stops (patient stops breathing) +
   update the sim; (b) **simulation/server** — a web-layer exploit / status change routed through the sim.
10. **Patch (Factory/Droid):** "Push patch" spawns **Factory agent nodes off the DeepSeek node** →
    isolate / reflash correct firmware / repair the server. Impression of a real patch (verify re-runs the
    exploit → blocked). New node completes the graph.

---

## Contracts (so the parallel agents integrate)

### ScanFinding (unchanged — do not alter the shape)
`{ id:number, scanner:'semgrep'|'bandit', tool?, target, file, line, severity, ruleId, message, cveRef?, cwe? }`

### Exploit conversation SSE — `GET /api/exploit/stream` (per-finding, N concurrent)
One stream can multiplex all findings, OR one stream per finding (`?finding=<id>`). Events (SSE `data:` JSON):
```
{type:'agent_spawned', findingId, model}                         // node appears
{type:'turn', findingId, role:'deepseek'|'tool', text}           // a full conversation turn (append)
{type:'delta', findingId, role, text}                            // token stream within a turn
{type:'verdict', findingId, exploitable:boolean, rationale}      // DeepSeek's conclusion
{type:'payload', findingId, command, impact, patientRisk, patchRisk}  // when exploitable
{type:'agent_done', findingId, durationMs, source}
{type:'all_done'}
```
All findings' agents start together (parallel); each emits its own turns over ~10–20s.

### Patch SSE — `GET /api/patch/stream` (spawns FROM the chosen DeepSeek finding node)
Keep the existing writer/reviewer/verify event shape; add `parentFindingId` so the UI attaches the
Factory nodes to the DeepSeek node that proved the exploit.

---

## Workstreams (one Opus agent each — file ownership is exclusive, no two agents touch the same file)

### WS1 — De-plant the repo + make the scan real (≥8s)
Files: `device-service/app.py`, `device-service/diagnostics.py`, `firmware/uno_actuator.ino`,
`firmware/rules/*.yaml` (+ any `rules/*.yaml` the scanners use), `security/scan/run_scanners.py`.
- Strip every author tell; keep the real bug + the real true/reported-lie behavior; rewrite docstrings
  to read like an ordinary internal service.
- Make the Semgrep rules match the **code structure** (unauthenticated state-changing route / unauth
  serial STATE handler), verified by running semgrep on the de-planted code.
- Scan runs real Semgrep + Bandit over the **whole cloned repo** → genuine ≥8s, real findings incl. the
  (now organic-looking) bug. No fake sleeps, no hardcoded durations on the live path.
- Keep `run_scanners`' public interface + the ScanFinding shape stable. Keep the exploit/verify working.

### WS2 — Backend: parallel multi-turn DeepSeek + patch spawn
Files: `security/generate/exploit.py`, `security/portal_server.py`.
- Turn the one-shot generator into a **multi-turn conversation per finding** (ask: is this exploitable?
  iterate; if yes, author the PoC). Keep Bitdeer primary + cache fallback.
- `/api/exploit/stream` emits the **conversation SSE contract** above for **all exploitable findings in
  parallel**, ~10–20s each. Include `patientRisk` + `patchRisk` in the payload event.
- `/api/patch/stream` tags events with `parentFindingId`. Keep verify (real 401) honest.

### WS3 — Frontend: N-node graph, live conversations, risk panel, Factory nodes, kill "decoy"
Files: `app/src/portal/usePipeline.ts`, `app/src/portal/api.ts`, `app/src/portal/fixtures.ts`,
`app/src/portal/exploit/AgentGraph.tsx`, `app/src/portal/exploit/AgentDetail.tsx`,
`app/src/portal/exploit/graphModel.ts`, `app/src/portal/review/FindingsList.tsx`.
- Consume the conversation SSE: **one DeepSeek node per finding**, spawned in parallel, each clickable to
  a **live transcript**. Remove the "decoy" label; exploitability shows via the node's verdict.
- Right panel: **patient risk + patch risk** for the selection.
- Factory/Droid patch nodes **attach to the DeepSeek node** (via `parentFindingId`) on push-patch.
- Keep the sim-fallback path working end-to-end (≥10s streamed) for offline demos.

### WS4 — Demo runbook
File: `plans/DEMO-RUNBOOK.md` — the full judge-facing demo script + setup (both laptops, fan/LED/buzzer,
the story beats, recovery), written against this target experience.

---

## Open decisions (flag to the user)
- "≥8s scan" is achieved by scanning a **real repo** (real scanner runtime), not a sleep. If the demo
  repo is tiny, we scan a larger real target so it's honest.
- The entry gate requiring **both** repo + device may need a "use the device's own code" shortcut for the
  no-repo case — keep a one-click default.
