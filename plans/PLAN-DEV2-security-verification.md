# PLAN — DEV 2: Security & Verification (the security role)

> Project **PreVent** · Cal Hacks 13.0. Master: `plans/PLAN-MASTER.md`. Foundation first: `plans/PLAN-FOUNDATION.md`.
> **You own:** the vulnerable+patched **device-service** (the attack surface), **SemGrep rule + Bandit**, the **SCAN reasoning** (prompt + the wrong-then-caught probe), **Bitdeer GENERATE** + the exploit payloads + `deliver.py`, the **deterministic verifier**, and **NVD grounding**. Sponsors: **Armadin** (the verified find→exploit→fix loop is their thesis), **Bitdeer** (exploit model), + the security substance of Most-Technically-Advanced.
> **Seam with Dev 1:** you write *what the agents do* (stage modules, prompts, exploit, verifier); Dev 1's `runStage` runs your Claude stages and the orchestrator calls your functions. You write `device_status` via Dev 3's `updateDeviceStatus` reducer.

## Verified pins / APIs (live 2026-10-24)
- `semgrep==1.182.1`, `bandit==1.9.4` — install under **Python 3.10–3.14** (NOT 3.15): `uv tool install --python 3.13 semgrep==1.182.1`.
- **Bitdeer:** base `https://api-inference.bitdeer.ai/v1`, `Authorization: Bearer $BITDEER_API_KEY`, `POST /v1/chat/completions`. Model **`deepseek-ai/DeepSeek-V4.1-Flash`** (NOT `DeepSeek-V4-Pro`, which 404s); strong alt `zai-org/GLM-5.3`. 100 RPM (429 `RATE_LIMIT_EXCEEDED`), 403 `NOT_ENOUGH_BALANCE`. PoC-refusal behavior undocumented → test on first key.
- **NVD:** `GET https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2019-6538` works **keyless**; key goes in header **`apiKey:`** (not query param). Rate 5/30s keyless. CVE-2019-6538 → CWE-306 + CWE-862 (NVD), CWE-284 (CISA); CVSS 9.3 CRITICAL (CISA) vs 6.5 MEDIUM (NVD) — name the source.
- **Factory scoping:** commit `device-service/.factory/settings.json` `permissionRules` (block push/net/sudo).

## Tasks

### 1. Vulnerable device-service (`device-service/app.py`, its OWN git repo) — H2–H10
- Flask/FastAPI. Hold `true_state` and `reported_state` **separately**.
- `GET /device/status` → `{ fan_on, reported:{hr,spo2}, alarm }`.
- `POST /device/command` **(VULNERABLE: no auth)** → `{action, reported_overrides}`: on `stop_fan` set `true_state.fan_on=false` and blindly apply `reported_overrides` (the lie); then call Dev 3's `updateDeviceStatus(...)`.
- Patched variant (what Droid will produce): require a valid token → 401/403, and ignore untrusted `reported_overrides` so true/reported can't desync.

### 2. SCAN signal + stage (`device-service/rules/missing-auth.yaml`, `security/scan/`) — H2–H10
- Write the custom **CWE-306** rule (no stock rule exists). Shape: `patterns` over `@$APP.$M(...) def $FUNC(...):` + `metavariable-regex` `$M` ∈ get/post/put/patch/delete/route + `pattern-not` for auth decorators (`@login_required`, `@$AUTH(...)`) and FastAPI `Depends(...)`. **Author it WITH the handler and assert it fires on the vuln, silent on the patched** (`semgrep scan --validate`; `semgrep --test` with `# ruleid:`/`# ok:` fixtures).
- Run both: `semgrep scan --config rules/ --json --metrics off --disable-version-check --quiet device-service > semgrep.json` and `bandit -r device-service -f json -o bandit.json --exit-zero` (Bandit never flags missing-auth → it's the noise: B201/B105-107/B608).
- **SCAN stage module:** a Claude triage prompt (run via Dev 1's `runStage`, Opus, tools Read/Grep/Bash) that reads both JSONs and picks the real finding → `recordFinding(...)`. **The wrong-then-caught probe:** a deterministic check that the Bandit pick does NOT reproduce → write the contradiction to `event_log` → self-correct to the SemGrep CWE-306 finding. Rehearsed code path, not emergent.

### 3. GROUND (`security/ground/`) — H2–H10
- Fetch CVE-2019-6538 once, **cache the JSON locally**; produce the grounding-card data (CWE-306/862, CVSS with source named). Render from cache during judging (no live NVD dependency on repeat runs).

### 4. GENERATE — Bitdeer exploit (`security/generate/`) — H2–H10
- Client to Bitdeer `DeepSeek-V4.1-Flash`. Author the 3 exploit payloads mapped to the IR remote: ① stop-breathing (`stop_fan` + falsify vitals), ② max-pressure (`set_rate` high), ③ falsify-vitals only.
- **Pre-cache a known-good PoC + auto-failover** on any 429/refusal so GENERATE never blocks. Write `recordExploitRun(model_id, payload_ref)`.

### 5. DELIVER (`security/deliver.py`) — H10–H22
- Subscribe to `ir_events`; on a judge press (or orchestrator trigger) fire the chosen unauthenticated payload at `/device/command`. The device obeys + lies; the row flip propagates to hardware + both panels.

### 6. VERIFY (deterministic, non-AI) + RESTORE (`security/verify.py`) — H10–H22
- Re-send the **byte-identical** exploit; assert (a) status 401/403, (b) `true_state` unchanged (fan didn't stop), (c) `reported == true` (no lie). All three pass = PASS → `recordExploitRun(success=false)`; the row flips back → fan resumes, vitals true, alarm armed, rgb green.
- **RESTORE:** `git -C device-service` revert to clean pre-patch state + `resetHealthy()`.

## Acceptance
SemGrep fires only on the vuln (and is silent on the patch); Claude picks the real finding out of Bandit noise and **visibly self-corrects once**; the exploit achieves control+integrity (fan stops + device lies), not a crash; the verifier proves the re-run fails; the whole security loop runs headless against the **emulator** (no board). **Manual:** pin semgrep/bandit; get the Bitdeer key (credit-request form) + smoke-test a PoC prompt the moment you have it.
