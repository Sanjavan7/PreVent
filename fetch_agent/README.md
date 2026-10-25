![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

# PreVent — autonomous medical-device security agent (ASI:One)

**Agent name:** `PreVent-Security`
**Agent address:** `agent1qwf55mgy47a4qa3a4vfan45lp7mvp6j302nk2amns2qwgwxsw6g0xx4y5g3`

Find → **prove** → (human-approved) **fix** → **re-verify**, entirely inside one ASI:One
conversation. PreVent grounds on a real CVE, runs real SAST (SemGrep + Bandit) and
triages the true finding with a visible, probe-driven self-correction, **actually
compromises** a networked device-service with an unauthenticated request (the device
obeys *and keeps reporting healthy vitals in its own words*), pauses at a **human
APPROVE gate**, applies a vetted fix, then **re-fires the byte-identical request to
prove it now returns 401/403**. The result is a traceability record (CVE → finding →
exploit proof → fix → re-verify) — the kind of evidence that *feeds* an FDA §524B
pre-market submission.

> **Honest scope.** This is a **pre-market / staging** triage agent for the
> missing-authentication (CWE-306) class, demonstrated against an instrumented
> reference `device-service` the team owns. It *applies a vetted fix* (not an
> "autonomous patch"), and it produces evidence that *feeds* a §524B submission —
> it is not an FDA compliance certification. All exploit activity is authorized
> testing against our own sandboxed service.

## Try it in ASI:One
Ask the agent (discoverable via ASI:One, or @mention its address):

> **"Audit our device-service for missing-authentication flaws and prove whether it's exploitable."**

It streams every stage, pauses for your **APPROVE** (reply `APPROVE`, or tap the review
card), then proves the fix closed the hole. Reply `REJECT` to abort — nothing is changed
without approval.

## Run / test locally
From the repo root, with the project venv (Python 3.11–3.13):

```bash
# 1) deps (same venv as security/, so `import security.*` resolves)
uv pip install --python ./.venv/Scripts/python.exe -r fetch_agent/requirements.txt

# 2) env: copy ../.env.example -> ../.env and set ASI_ONE_API_KEY + a unique AGENT_SEED
# 3) run the agent (it manages the device-service itself)
ASI_ONE_API_KEY=... AGENT_SEED="your-unique-seed" ./.venv/Scripts/python.exe -m fetch_agent.agent
```
Open the **Agent Inspector** link in the logs → **connect → Mailbox**, then chat with it
from https://asi1.ai. Keep the process running so it stays discoverable.

Offline smoke test of the full loop (no ASI:One, no keys needed):
```bash
./.venv/Scripts/python.exe -m fetch_agent._smoke
```

## How it works
- **uAgent + Agent Chat Protocol** (`chat_protocol_spec` v0.3.0), mailbox-connected and
  manifest-published for ASI:One discovery.
- Drives the real Python security loop in [`../security/`](../security/) via its
  `stage_api` bridge — no cross-language shim. The human gate splits the loop across two
  chat turns (state persisted per session); the device-service is kept **warm** so the
  live `GET /device/status` round-trips answer during the exploit and the re-verify.
- The exploit PoC is authored by DeepSeek (Featherless/Bitdeer), **not** ASI:One's model.

## Extra resources needed to run
| Resource | Where | Needed for |
|---|---|---|
| ASI:One API key | https://asi1.ai | running outside Agentverse / your own billing |
| Agentverse account + Mailbox | https://agentverse.ai | discovery + inbound messages |
| SemGrep 1.182.1 + Bandit 1.9.4 | standalone tool installs (see `../security/README.md`) | the real SCAN stage |
| Featherless / Bitdeer key *(optional)* | https://featherless.ai / https://bitdeer.ai | live PoC authoring (else a cached PoC is used) |
| NVD API key *(optional)* | https://nvd.nist.gov | higher NVD rate limit (CVE cache is committed) |
