# PreVent — Dev 2 (Security & Verification): what was built, and why

> Branch `dev2/security-verification`. This doc explains the implementation of
> the security role in [`plans/PLAN-DEV2-security-verification.md`](../plans/PLAN-DEV2-security-verification.md):
> what exists, how to run it, the decisions behind it, and what's left for a human.
> Written for a teammate who will integrate or demo it. No overclaiming — every
> "verified" claim below is backed by the 24-test suite.

---

## 1. Scope & the one-loop thesis

Dev 2 owns the **security substance** of the demo: the attack surface, the
detection, the proof-of-compromise, the proof-of-fix, and the grounding. The
whole thing runs as one loop end-to-end:

```
GROUND → SCAN → GENERATE → DELIVER → PATCH → VERIFY → RESTORE
```

| Stage | What it does | Code |
|---|---|---|
| **GROUND** | Cite the real advisory (CVE-2019-6538, CWE-306) from NVD, cached locally | `security/ground/ground.py` |
| **SCAN** | SemGrep (1 real CWE-306 finding) + Bandit (3 decoys); triage self-corrects onto the real one | `device-service/rules/missing-auth.yaml`, `security/scan/` |
| **GENERATE** | **Author** the executable payload — either a preset (IR-mapped) or **dynamically** from a plain-English goal + the live attack surface — via any OpenAI-compatible provider (Featherless primary, Bitdeer fallback — both host `DeepSeek-V4.1-Flash-1017`), with a validated fallback | `security/generate/exploit.py` |
| **DELIVER** | Fire the **unauthenticated** payload: fan stops, patient crashes, device keeps reporting normal (the lie) | `security/deliver.py` |
| **PATCH** | Deploy the patched service (bearer-token required, overrides ignored) — stands in for Factory Droid's diff | `device-service/app.py` (`DEVICE_SERVICE_PATCHED=1`) |
| **VERIFY** | Re-send the **byte-identical** exploit; assert 401/403 + true_state unchanged + no lie (deterministic, non-AI) | `security/verify.py` |
| **RESTORE** | Flip back to the clean, pre-patch vulnerable state for the next judge | `security/restore.py` |

The **attack surface** is `device-service/` — a deliberately vulnerable Flask
toy on `127.0.0.1` whose "ventilator" is a boolean fan flag. It holds `true_state`
(what's physically happening) and `reported_state` (what it displays) separately;
the gap between them *is* the exploit. A patched reference handler lives in the
same file behind a flag.

The headless driver that runs all seven stages is **`security/loop.py`**.

---

## 2. How to run it

One-time setup (Python 3.11–3.13; semgrep/bandit want ≤3.14):

```bash
# from the repo root
python3.13 -m venv .venv
./.venv/bin/python -m pip install -r security/requirements.txt -r security/requirements-dev.txt

# semgrep + bandit are standalone tool installs (NOT pip deps of this package):
uv tool install --python 3.13 semgrep==1.182.1
uv tool install --python 3.13 bandit==1.9.4
#   (any recent semgrep works; see the version note in §6)
```

Run the whole loop — **no API keys required**:

```bash
./.venv/bin/python security/loop.py            # human-readable transcript + receipt
./.venv/bin/python security/loop.py --json     # also print the machine report
./.venv/bin/python security/loop.py --payload max-pressure   # stop-breathing (default) | max-pressure | falsify-vitals
./.venv/bin/python security/loop.py --port 8071              # device-service port (default 8071)

# DYNAMIC — the model AUTHORS the payload from a plain-English goal (the judge's words):
./.venv/bin/python security/loop.py --goal "stop the ventilator but keep the monitor showing healthy vitals"
./.venv/bin/python security/generate/exploit.py --goal "lower only the displayed SpO2 to 80, don't touch the fan"
```

Exit code is `0` iff the loop closed (exploit worked, then VERIFY proved it fixed).
A per-run receipt + logs are written to `security/.runs/<timestamp>/` (gitignored).

Run the tests (24, ~16s):

```bash
./.venv/bin/python -m pytest security/tests
```

The tail of a successful run:

```
================================================================
 PreVent — FDA §524B-style run receipt
================================================================
 Grounding CVE : CVE-2019-6538  (CWE CWE-284, CWE-306, CWE-862)
 Finding       : semgrep flask-missing-auth-decorator device-service/app.py:302 (CWE-306)
 Self-correct  : yes (caught a wrong first pick)
 Exploit       : control+integrity compromise
 Verify        : PASS — re-run blocked (401/403), state intact, no lie
 Loop closed   : YES
 Artifacts     : .../security/.runs/<timestamp>
================================================================
```

---

## 3. Key design decisions + rationale

### 3.1 Headless, offline, key-free loop
The loop runs the full thesis with **zero API keys**. SCAN uses a deterministic
triage (not an LLM), and GENERATE falls back to a pre-cached PoC. Keys only
*upgrade* the demo: `ANTHROPIC_API_KEY` turns SCAN/VERIFY into visible streamed
Claude reasoning (via Dev 1's `runStage`), and `BITDEER_API_KEY` turns GENERATE
into live model output. **Why:** the demo must never hard-block on a rate limit,
a refusal, or dead venue WiFi. A loop that closes offline is a loop that closes
on stage.

### 3.2 One file holds both the vulnerable and patched handler (flag-gated)
`device-service/app.py` defines `device_command` twice — a vulnerable branch and
a patched branch — selected at import by `DEVICE_SERVICE_PATCHED`. **Why:** a
static tool sees *both* ASTs in one file, so the SemGrep rule can demonstrably
*fire on the vuln and stay silent on the patch* in a single scan. At runtime the
"patch" is a flag flip + service restart. Factory Droid's real diff (Dev 1)
produces exactly this patched handler, so the headless path and the live Droid
path converge on the same fixed code.

### 3.3 A real physiological crash, so "the lie" is real
`stop_fan` doesn't just flip a boolean — it drops the **true** vitals to
`38/61` while `reported` stays `72/98`:

```
after exploit: fan=OFF true=38/61 reported=72/98 alarm=OFF compromised=True
```

**Why:** the whole emotional and technical point is a *divergence* between truth
and telemetry. Without it, VERIFY's "reported == true" check (3.10) would be
vacuous and the dashboard's "Telemetry vs Reality" card would have nothing to show.

### 3.4 Source-of-truth row file + internal `GET /device/_truth`
The public `GET /device/status` deliberately exposes only the reported (possibly
lying) view — that asymmetry is the exploit. But the verifier needs the *full*
true-vs-reported row, so the service writes the complete `DeviceStatus` row
(camelCase, `id:1`) to a JSON sink (`PREVENT_DEVICE_ROW_FILE`) and exposes it at
the internal `GET /device/_truth`. **Why:** these stand in for Dev 3's shared
SpacetimeDB `device_status` row. In production that row is the source of truth the
dashboard, sim, and verifier all read; here a file/endpoint plays that role so
Dev 2 runs standalone with no realtime backend.

### 3.5 SemGrep rule: scoped to state-changing verbs, yields exactly one finding
`rules/missing-auth.yaml` matches a Flask route decorator sitting directly above
`def`, restricted to mutating verbs:

```yaml
- metavariable-regex:
    metavariable: $METHOD
    regex: ^(post|put|patch|delete)$
```

The handlers use Flask's `@app.post` / `@app.get` shortcuts, so `$METHOD` is the
verb itself. Authenticated handlers are excluded by `pattern-not` clauses for
`@login_required`, the project's `@require_token`, any call-form `@$AUTH(...)`,
and FastAPI `Depends(...)`. **Why these choices:**
- Read-only `@app.get` endpoints (status, truth) are *not* "critical functions",
  so flagging them would be noise.
- The internal reset hook was made a **read-only `GET /device/_reset`**
  specifically so the rule produces **exactly one** finding (the vulnerable POST),
  keeping "SemGrep fires only on the vuln" literally true.
- Validated with `semgrep scan --config device-service/rules --validate` and a
  `--test` fixture (`security/tests/semgrep_fixtures/missing-auth.py`) that asserts
  fires-on-vuln / silent-on-patched / silent-on-GET.

### 3.6 Bandit decoys are deliberate, and deliberately un-suppressed
`device-service/diagnostics.py` carries three realistic smells Bandit flags —
`B105` (hardcoded diagnostic token), `B324` (MD5, **HIGH**), `B110`
(try/except/pass) — and none is suppressed with `# nosec`. **Why:** these are the
SCAN *noise*. The triage must look past a scary-looking HIGH and land on the real
issue. The MD5 HIGH is the perfect decoy: higher severity than the SemGrep
`ERROR`, but not an exploitable auth bypass.

### 3.7 The wrong-then-caught triage is scripted, not emergent
`security/scan/triage.py` (`deterministic_triage`) reproduces the self-correction
beat deterministically: it starts on Bandit's highest-severity hit (the MD5
HIGH), runs the **non-destructive** live reproduce-probe, sees it fail, records
the contradiction, then confirms the CWE-306 SemGrep finding. The probe sends an
unauthenticated `{"action":"resume"}` (harmless — keeps the patient healthy) and
reads the status:

- `200` → an unauthenticated caller issued a device command → **reproduces**.
- `401/403` → the handler is guarded → **does not reproduce** (patched).

**Why a resume, not a stop:** SCAN must prove the vuln without crashing the
patient — the dramatic kill belongs to DELIVER on the judge's press. **Why
deterministic:** "the agent caught itself being wrong" cannot be left to chance in
a live demo. The LLM version — `security/scan/triage_prompt.py` `SYSTEM_PROMPT` —
is the *visible-reasoning* path run through Dev 1's `runStage` (Opus), and it
calls the same `reproduce_probe()` so the beat is identical whether narrated by
Claude or run headless.

### 3.8 GROUND is honest about severity
`ground.py` surfaces **every** CVSS score NVD publishes, each with its source
named, rather than silently picking one:

```
nvd_v31: 9.3 CRITICAL (NVD CVSS v3.1)
nvd_v2:  3.3 LOW       (NVD CVSS v2.0)   # vector AV:A — adjacent, not remote
cisa:    9.3 CRITICAL  (CISA ICS medical-device advisory)
```

**Why:** "how bad is it" genuinely depends on who scored it and under which
rubric. The v2 vector (`AV:A`) also backs the team's honest framing that
CVE-2019-6538 is *adjacent-radio, not a remote hack* — we model the *class*.
Note: the plan's expected "NVD 6.5 MEDIUM" was **corrected** to the real cached
value (v2 base score 3.3); we report what the live NVD JSON actually says. The
JSON is cached at `security/ground/cve-2019-6538.cache.json` so judging never
depends on the network.

### 3.9 DELIVER reconciles a real contract mismatch
PLAN-MASTER §2b specifies the HTTP wire body as snake_case `reported_overrides`,
but the TS `DeviceCommand` type and the exploit payloads use camelCase
`reportedOverrides`. Left alone, the "active lie" overrides would silently never
apply. Fixed two ways: `deliver.to_wire_body()` translates camelCase →
canonical snake_case before POSTing, **and** the device-service accepts either
spelling (liberal in what it accepts). **Why both:** the wire stays
contract-faithful (snake_case), the service is robust to either caller, and the
translation is deterministic so VERIFY can re-send **byte-identical** bytes.

### 3.10 VERIFY is deterministic and non-AI
`verify.py` re-sends the exact exploit and asserts all three of:

1. status is **401/403** (auth now enforced),
2. **true_state unchanged** (the fan didn't stop),
3. **reported == true** (no lie got applied).

The "exploit worked" invariant used by the loop is payload-agnostic: **an
unauthenticated state-changing command was accepted (HTTP 200)**. **Why
deterministic:** the proof-of-fix must be independent of whatever Claude or Droid
produced — "proof, not prose." A model is never in the verification path.

### 3.11 RESTORE reverts only device-service, by path
`restore.py` reverts **only** its own tracked files and never does a blanket
`git checkout -- .`:

```python
DEVICE_SERVICE_TRACKED = ["device-service/app.py", "device-service/diagnostics.py"]
```

It `git status --porcelain`-checks first and reverts only what's actually
modified, then resets the device to healthy. **Why scoped:** RESTORE must never
wipe a teammate's uncommitted work. Note: `device-service/` is **not** currently
its own git repo (the plan's intent) — it's tracked by the parent repo — so we
scope to its path within the parent. To honour the plan later, `git init` inside
`device-service/` and point `restore.git_revert_device_service()` at that repo;
the headless loop doesn't need it because it reaches pre-patch state by
restarting in vulnerable mode (no file edits to revert).

### 3.12 Port 8071, not 5000 (a demo-day landmine)
On macOS, **ControlCenter / AirPlay Receiver owns `:5000`** and answers every
request with `403 Forbidden`. A verifier pointed at `:5000` would see that 403
and **falsely pass** (401/403 is the success condition). The default moved to
`8071` and the reason is documented in `.env.example`. **Why it matters:** this
would have manifested as "VERIFY passes even with no service running" — the worst
kind of silent-green bug on stage.

### 3.13a Dynamic payload authoring — "is it only for this CVE?"
The honest answer a judge should hear is **"no — it curates the payload for the
case."** `generate_dynamic_payload(goal, finding, base_url)` has the model
*author the executable command* from three varying inputs: the confirmed
**finding**, the device's **live-advertised attack surface** (`GET
/device/_schema`, so point it at a different device and it adapts), and an
**attacker goal in plain English**. The model returns structured JSON; we
**validate** it (`validate_command`: action ∈ {stop_fan,set_rate,resume}, rate
clamped 0–255, override keys whitelisted) and only then fire it — the guardrail
that keeps a model-authored payload inside the sandboxed device's real action
set. Demonstrated live (Featherless / DeepSeek):

| Goal (plain English) | Authored command |
|---|---|
| stop the ventilator but keep the monitor normal | `{stop_fan, overrides 72/98/alarm off}` |
| crank the pressure to maximum | `{set_rate: 255}` |
| lower *only* the displayed SpO2 to 80, don't touch the fan | `{resume, overrides {spo2: 80}}` |

**Why both preset and dynamic:** the 3 IR-mapped presets keep the *hardware*
beat deterministic (a judge's remote press always fires a known payload), while
`--goal` proves the generator is **not** hardcoded — a judge can invent a goal
and watch it curate a new, valid, executable payload. On no provider / refusal /
invalid output it falls back to a deterministic goal-keyed command, so the demo
never stalls. The whole loop (`--goal`) runs authored → fired → **verified** end
to end.

### 3.13 Separation of duties + honesty framing
The offensive and trust roles are split across *different models*: an open model
(**`DeepSeek-V4.1-Flash-1017`**, served by Featherless/Bitdeer) writes the PoC;
**Claude** does scan/triage/verify reasoning. That makes "a model reading
untrusted input ≠ the model writing the exploit" a real separation, not a slogan. Honesty held throughout: the device is
a **localhost toy fan modeling CWE-306**, not a ventilator; CVE-2019-6538 is cited
**read-only** for grounding; what's *real* (the agent loop, the SemGrep finding,
the deterministic verifier, the true-vs-reported divergence) is kept distinct from
what's *simulated* (the patient, any fleet-scale visualization).

---

## 4. Integration seams

**For Dev 1 (orchestration):**
- `security/loop.py`'s `EventSink` mirrors the `RealtimeBackend` reducers 1:1 —
  `recordFinding`, `recordExploitRun`, `recordPatchAttempt`, `updateDeviceStatus`,
  `logEvent`. Swap `EventSink` for the real backend and the stage calls are
  unchanged.
- SCAN can run through `runStage` using `triage_prompt.SYSTEM_PROMPT` +
  `build_user_prompt(...)`, with `reproduce_probe()` invoked via the Bash tool and
  `TRIAGE_OUTPUT_SCHEMA` validating the final `recordFinding`. The deterministic
  `triage.py` is the fallback / offline equivalent.
- Droid's patch target is the patched handler in `device-service/app.py`
  (bearer-token required, `reported_overrides` ignored). After any Droid run,
  always hand off to the deterministic `verify_patch()` — a finished run ≠ a fixed
  bug.
- GENERATE/DELIVER payloads are keyed by IR code in `generate/exploit.py`
  (`PAYLOADS`); `deliver.on_ir_event(code)` is the entry point for the judge's
  remote press.

**For Dev 3 (realtime):** the service writes the exact contract `DeviceStatus`
shape (camelCase, `id:1`, `fanOn/trueHr/trueSpo2/reportedHr/reportedSpo2/
alarmActive/compromised/lastCommand/updatedAt`). `updateDeviceStatus` should take
that row as-is; the serial bridge / sim read the same row.

---

## 5. Verification (24 tests, `security/tests/`)

| File | Count | Asserts |
|---|---|---|
| `test_device_service.py` | 7 | Healthy baseline; public status hides true vitals; unauth exploit crashes **and lies**; active-lie overrides are applied over the wire; patched rejects unauth (401/403); patched honors a valid token **but ignores overrides**; reset hook heals. |
| `test_semgrep_rule.py` | 3 | Rule `--validate`s; `--test` fixtures pass (fires-on-vuln / silent-on-patched / silent-on-GET); real `app.py` yields **exactly one** finding. Auto-skips if `semgrep` is absent. |
| `test_scan_triage.py` | 5 | Exactly 1 SemGrep + Bandit noise incl. B324; live probe **reproduces on vulnerable**, **not on patched**; Bandit findings never reproduce; triage self-corrects to CWE-306 and discards the Bandit decoy first. |
| `test_generate_ground.py` | 4 | Three IR payloads map to valid actions; GENERATE falls back to the cached PoC with no key; unknown payload raises; grounding card names every CVSS source and includes both scores. |
| `test_verify_loop.py` | 5 | VERIFY **passes on patched**; VERIFY **fails on vulnerable** (the sanity check — a verifier that always passes is worthless); wire bytes are deterministic; full `run_loop()` closes for `stop-breathing` and `max-pressure` and writes a receipt. |

All 24 pass in ~16s. The semgrep tests skip cleanly (not fail) on a machine
without semgrep.

---

## 6. Manual steps for the human / what's left

**API keys** (copy `.env.example` → `.env`; all optional for the headless loop):

| Key | Needed for | If absent |
|---|---|---|
| `FEATHERLESS_API_KEY` | **Primary** live PoC generation in GENERATE | Falls through to Bitdeer, then cached PoC |
| `BITDEER_API_KEY` | Secondary live PoC generation | Used only if Featherless fails; else cached. **Currently 402 (no balance)** |
| `ANTHROPIC_API_KEY` | Live Claude reasoning in SCAN/VERIFY (Dev 1's `runStage`) | Deterministic triage runs instead |
| `NVD_API_KEY` | Higher NVD rate limit | Keyless works; cache already committed |
| `FACTORY_API_KEY` | Dev 1's Droid patch stage | **Not a Dev 2 dependency** |

> **GENERATE is provider-agnostic.** `_providers()` returns each configured
> provider (one with a key set) and tries them in order — Featherless first
> (verified live: HTTP 200, `DeepSeek-V4.1-Flash-1017`), then Bitdeer — each with
> model fallbacks, then the pre-cached PoC. Bitdeer's key authenticates but the
> hackathon credits weren't funded (HTTP 402 `insufficient_balance`), which is
> why Featherless is primary. Both host the same DeepSeek model.

Action items:
- **Pin the scanners on the demo laptop.** The plan pins `semgrep==1.182.1` /
  `bandit==1.9.4` under Python 3.10–3.14. This machine has **semgrep 1.159.0 +
  bandit 1.9.4**, which work fine; re-pin to the plan versions on the real laptop
  for reproducibility, then re-run `pytest security/tests`.
- **Smoke-test a Bitdeer PoC prompt** the moment a key exists — refusal behavior
  on PoC prompts is undocumented. The cached failover covers a refusal, but you
  want to know whether the live path is usable.
- **Confirm the port.** Keep `8071`, or disable macOS AirPlay Receiver if you must
  use `5000`.
- **(Optional, to match the plan)** split `device-service/` into its own git repo
  and point RESTORE's git-revert at it; the loop works either way today.
