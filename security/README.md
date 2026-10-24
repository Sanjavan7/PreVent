# `security/` + `device-service/` — PreVent Security & Verification (Dev 2)

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
         ignored) — stands in for Factory Droid's diff (Dev 1)
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

## Tests

```bash
./.venv/bin/python -m pytest security/tests        # 24 tests, ~16s
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
| `FEATHERLESS_API_KEY` | *(unset)* | **primary** live PoC provider (verified HTTP 200) |
| `FEATHERLESS_BASE_URL` | `https://api.featherless.ai/v1` | Featherless endpoint |
| `BITDEER_API_KEY` | *(unset)* | secondary PoC provider; else cached PoC |
| `NVD_API_KEY` | *(unset)* | higher NVD rate limit; cache already committed |

GENERATE is provider-agnostic: it tries Featherless, then Bitdeer, then a
pre-cached PoC. Both providers host `deepseek-ai/DeepSeek-V4.1-Flash-1017`.

See [`docs/DEV2-SECURITY-DECISIONS.md`](../docs/DEV2-SECURITY-DECISIONS.md) for
the design decisions and the Dev 1 / Dev 3 integration seams.
