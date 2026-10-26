# `security/` + `device-service/` — PreVent Security & Verification

The autonomous **find → exploit → patch → verify** loop, runnable **headless,
offline, and with zero API keys** against the team's own localhost toy service.

```
GROUND   cite the real CVE (NVD, cached)                         ground/ground.py
SCAN     SemGrep (1 real CWE-306) + Bandit (3 decoys) → triage   scan/
         that visibly self-corrects once
GENERATE draft the PoC (Bitdeer if keyed, else cached)           generate/exploit.py
DELIVER  fire the UNAUTHENTICATED payload: fan stops, patient    deliver.py
         crashes, device keeps reporting normal + never alarms
PATCH    deploy the patched service (token required, overrides   device-service/app.py
         ignored) — stands in for Factory Droid's diff
VERIFY   re-send the BYTE-IDENTICAL exploit; assert 401/403 +    verify.py
         true_state unchanged + no lie (deterministic, non-AI)
RESTORE  flip back to the clean pre-patch state for the next run restore.py
```

> **What this is.** `device-service/` is a Flask app on `127.0.0.1` whose
> "ventilator" is a boolean fan flag. It deliberately models the **CWE-306**
> missing-authentication class (grounded read-only in **CVE-2019-6538**). It is
> **not** a real medical device, and all exploit activity here is authorized
> testing against a service the team wrote and owns.

## Setup

```bash
# from the repo root — Python 3.11–3.13 (NOT 3.15; semgrep/bandit wheels stop at 3.14)
python3.13 -m venv .venv
./.venv/bin/python -m pip install -r security/requirements.txt -r security/requirements-dev.txt

# semgrep + bandit are standalone tool installs (kept out of the app venv):
uv tool install --python 3.13 semgrep==1.182.1
uv tool install --python 3.13 bandit==1.9.4
#   (this machine already had semgrep 1.159.0 + bandit 1.9.4 on PATH, which work;
#    re-pin on the demo laptop.)
```

## Run the whole loop

```bash
./.venv/bin/python security/loop.py                 # human-readable transcript + receipt
./.venv/bin/python security/loop.py --json          # also emit the machine report
./.venv/bin/python security/loop.py --payload max-pressure   # stop-breathing | max-pressure | falsify-vitals
./.venv/bin/python security/loop.py --port 8071     # device-service port (default 8071)

# DYNAMIC: the model AUTHORS the executable payload from a plain-English goal
./.venv/bin/python security/loop.py --goal "stop the ventilator but keep the monitor showing healthy vitals"
./.venv/bin/python security/generate/exploit.py --goal "lower only the displayed SpO2 to 80"   # just print the authored command
```

Exit code is `0` **iff** the loop closed (exploit worked, then VERIFY proved it
fixed). A per-run receipt + logs land in `security/.runs/<timestamp>/`
(gitignored).

> **macOS note:** the default port is **8071**, not 5000. On macOS the AirPlay
> Receiver (ControlCenter) listens on `:5000` and answers `403`, which would
> masquerade as our patched service and cause a *false* VERIFY pass.

## Run each stage on its own

```bash
./.venv/bin/python security/ground/ground.py              # grounding card (from cache)
./.venv/bin/python security/scan/run_scanners.py          # semgrep + bandit JSON
./.venv/bin/python security/scan/triage.py                # deterministic triage preview
./.venv/bin/python security/generate/exploit.py           # PoC drafts (cached w/o a key)
./.venv/bin/python security/deliver.py                    # fire all payloads (needs a running service)
./.venv/bin/python security/verify.py                     # deterministic verify (mock w/o a service)
DEVICE_SERVICE_URL=http://127.0.0.1:8071 ./.venv/bin/python security/restore.py
```

Bring the device-service up by hand:

```bash
# vulnerable (default)
PREVENT_DEVICE_ROW_FILE=/tmp/row.json DEVICE_SERVICE_PORT=8071 ./.venv/bin/python device-service/app.py
# patched
DEVICE_SERVICE_PATCHED=1 DEVICE_SERVICE_TOKEN=prevent-demo-token DEVICE_SERVICE_PORT=8071 \
  ./.venv/bin/python device-service/app.py
```

## Two integration bridges

Two thin wrappers expose the loop to the rest of the system without changing any
stage logic — they only reuse the existing stage functions.

### `stage_api.py` — JSON-in / JSON-out stage CLI (the subprocess bridge)

The TypeScript orchestrator can invoke any security stage as a subprocess and
parse **one JSON object** off stdout:
`{"stage", "ok", "data": {...}, "events": [{"actor","text"}...]}`. `data` is a
superset of the matching orchestrator stub's return shape. Exit code is non-zero
when `ok` is false.

```bash
# offline stages (no service, no keys)
./.venv/bin/python -m security.stage_api ground
./.venv/bin/python -m security.stage_api scan                     # triage falls back offline
./.venv/bin/python -m security.stage_api generate --input '{"cveRef":"CVE-2019-6538"}'          # preset (default stop-breathing)
./.venv/bin/python -m security.stage_api generate --goal "crank the pressure to maximum"        # dynamic (model-authored)

# live stages (need a running device-service at --base-url, default 8071)
./.venv/bin/python -m security.stage_api deliver --base-url http://127.0.0.1:8071 --payload stop-breathing   # vulnerable -> exploitWorked
./.venv/bin/python -m security.stage_api verify  --base-url http://127.0.0.1:8071 --payload stop-breathing   # patched   -> passed
./.venv/bin/python -m security.stage_api restore --base-url http://127.0.0.1:8071
./.venv/bin/python -m security.stage_api --help
```

### `emulate_stream.py` — device_status row → serial STATE frames

A faithful Python port of `contracts/src/serial.ts` (`deviceStatusToState` +
`encodeState`). It turns the shared `device_status` row into the
`STATE,fan=…,rate=…,hr=…,spo2=…,alarm=…,rgb=…\n` frames a board/visualizer
consumes, so the loop can drive a serial consumer with **no board and no realtime
backend**. STATE frames go to stdout (pipe into the consumer); a human-readable
board render goes to stderr.

```bash
# one frame from the row file device-service writes, then exit
./.venv/bin/python -m security.emulate_stream --row-file /tmp/row.json --once

# follow the row ~4x/sec, emitting a frame on every change — pipe into a consumer
./.venv/bin/python -m security.emulate_stream --base-url http://127.0.0.1:8071 | <consumer>
PREVENT_DEVICE_ROW_FILE=/tmp/row.json ./.venv/bin/python -m security.emulate_stream   # --watch is the default
```

## Tests

```bash
./.venv/bin/python -m pytest security/tests        # 67 tests
```

Covers: the vulnerable crash+lie and the patched 401/ignored-overrides; the
SemGrep rule (`--validate`, `--test`, exactly-one on the real app); the
signal-vs-noise scan + live reproduce-probe + triage self-correction; the
cached-PoC failover; the grounding card; VERIFY passing on patched **and failing
on vulnerable** (so the verifier can't trivially pass); and the full `run_loop`.
SemGrep tests auto-skip if semgrep isn't installed.

## Environment

| Var | Default | Purpose |
|---|---|---|
| `DEVICE_SERVICE_URL` | `http://127.0.0.1:8071` | where stages reach the service |
| `DEVICE_SERVICE_PORT` | `8071` | device-service bind port |
| `DEVICE_SERVICE_PATCHED` | `0` | `1` = patched reference handler |
| `DEVICE_SERVICE_TOKEN` | *(empty)* | bearer token the patched handler requires |
| `PREVENT_DEVICE_ROW_FILE` | *(unset)* | JSON sink for the source-of-truth row |
| `BITDEER_API_KEY` | *(unset)* | **primary** live PoC provider |
| `BITDEER_BASE_URL` | `https://api-inference.bitdeer.ai/v1` | Bitdeer endpoint |
| `FEATHERLESS_API_KEY` | *(unset)* | secondary PoC provider; else cached PoC |
| `FEATHERLESS_BASE_URL` | `https://api.featherless.ai/v1` | Featherless endpoint |
| `NVD_API_KEY` | *(unset)* | higher NVD rate limit; cache already committed |

GENERATE is provider-agnostic: it tries Bitdeer, then Featherless, then a
pre-cached PoC. Both providers host `deepseek-ai/DeepSeek-V4.1-Flash-1017`.

See [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for the design decisions
and the integration seams.
