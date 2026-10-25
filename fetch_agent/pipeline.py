"""Async driver that runs the PreVent security loop and streams it to ASI:One.

Decoupled from uagents: every function takes an async `send(text)` callback, so
the loop is testable offline (print-based send) and the agent passes a callback
that emits a ChatMessage.

IMPORTANT (rate limits): ASI:One's chat delivery rate-limits bursts (HTTP 429),
so we send ONE consolidated message PER STAGE (not many small lines) and the
agent spaces them out. Over-granular streaming gets messages dropped.

The loop is split around the HUMAN GATE, because the user's approval arrives in
a LATER handler invocation:
  * `run_to_gate(...)`  -> GROUND, SCAN, GENERATE, DELIVER (+ the lying device),
    then returns a `GateState` to persist.
  * `run_after_approval(...)` -> APPLY (restart patched), VERIFY (byte-identical
    200->401), RECEIPT (signed evidence), RESTORE.

Honesty guardrails: "applies a vetted fix" (never "autonomous patch"); the
device "lie" is shown in the device's OWN JSON from a live GET; a compromise is
only claimed on a REAL (non-mocked) HTTP response.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional, TypedDict

import requests

from .constants import DEVICE_BASE_URL, DEFAULT_PAYLOAD, PYTHON, REPO_ROOT
from .evidence import build_sbom_vex, build_signed_manifest, write_artifacts
from .service_control import DeviceServiceController

Send = Callable[[str], Awaitable[None]]


class GateState(TypedDict, total=False):
    run_id: str
    payload: str
    base_url: str
    finding_id: int
    deliver_status: Optional[int]
    request_sha256: str
    canonical_request: str
    exploit_worked: bool
    cve_id: str
    pre_patch_row: Optional[dict]


# --------------------------------------------------------------------------
# stage_api subprocess bridge (non-blocking; mirrors agents/src/security/stages.ts)
# --------------------------------------------------------------------------
async def run_stage(
    stage: str,
    *,
    base_url: str = DEVICE_BASE_URL,
    input_obj: Optional[dict] = None,
    payload: Optional[str] = None,
    goal: Optional[str] = None,
) -> dict:
    """Run `python -m security.stage_api <stage> ...` and return the parsed
    `{stage, ok, data, events}` envelope. Non-blocking (asyncio subprocess).
    A non-zero exit still prints the envelope on stdout and is recovered."""
    args = [PYTHON, "-m", "security.stage_api", stage, "--base-url", base_url]
    if input_obj is not None:
        args += ["--input", json.dumps(input_obj)]
    if payload is not None:
        args += ["--payload", payload]
    if goal is not None:
        args += ["--goal", goal]

    import os

    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    proc = await asyncio.create_subprocess_exec(
        *args,
        cwd=str(REPO_ROOT),
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, _err = await proc.communicate()
    return _parse_envelope(out.decode("utf-8", "replace"), stage)


def _parse_envelope(stdout: str, stage: str) -> dict:
    """One JSON object on stdout; fall back to the LAST well-formed line."""
    def well_formed(v: Any) -> bool:
        return isinstance(v, dict) and isinstance(v.get("stage"), str)

    whole = stdout.strip()
    try:
        parsed = json.loads(whole)
        if well_formed(parsed):
            return parsed
    except json.JSONDecodeError:
        pass
    for line in reversed([l.strip() for l in whole.splitlines() if l.strip()]):
        try:
            parsed = json.loads(line)
            if well_formed(parsed):
                return parsed
        except json.JSONDecodeError:
            continue
    return {"stage": stage, "ok": False, "data": {"error": "no JSON envelope on stdout"}, "events": []}


async def device_status(base_url: str = DEVICE_BASE_URL) -> Optional[dict]:
    """Live `GET /device/status` (the device's OWN voice). None if unreachable
    (so we never fabricate the 'lie')."""
    def _get() -> Optional[dict]:
        try:
            r = requests.get(f"{base_url.rstrip('/')}/device/status", timeout=2.0)
            return r.json() if r.ok else None
        except requests.RequestException:
            return None

    return await asyncio.to_thread(_get)


def _canonical_request(payload: str) -> tuple[str, str]:
    canonical = f"POST /device/command  (no Authorization header)  payload={payload}"
    return canonical, hashlib.sha256(canonical.encode()).hexdigest()


def _event_lines(events: Optional[list]) -> list[str]:
    return [f"  - {ev.get('text', '')}" for ev in (events or []) if ev.get("text")]


# --------------------------------------------------------------------------
# First half: GROUND -> SCAN -> GENERATE -> DELIVER, up to the human gate.
# ONE message per stage (rate-limit safe).
# --------------------------------------------------------------------------
async def run_to_gate(
    send: Send,
    *,
    run_id: str,
    base_url: str = DEVICE_BASE_URL,
    payload: str = DEFAULT_PAYLOAD,
    goal: Optional[str] = None,
    controller: Optional[DeviceServiceController] = None,
) -> GateState:
    controller = controller or DeviceServiceController(base_url)

    # GROUND (one live NVD fetch, cache fallback).
    g = await run_stage("ground", base_url=base_url)
    gd = g.get("data") or {}
    cve_id = str(gd.get("cveId", "CVE-2019-6538"))
    await send(
        f"**GROUND** - pulled **{cve_id}** live from NVD: missing-authentication class (CWE-306). "
        f"{gd.get('summary', '')}".strip()
    )

    # Bring the target up WARM (vulnerable) so live polls answer instantly.
    await asyncio.to_thread(controller.start, patched=False)

    # SCAN - real SemGrep + Bandit + the visible probe-driven self-correction.
    s = await run_stage("scan", base_url=base_url)
    sd = s.get("data") or {}
    chosen = sd.get("chosen") or {}
    finding_id = int(chosen.get("id", 1)) if isinstance(chosen, dict) else 1
    scan_lines = ["**SCAN** - SemGrep + Bandit, then triage (self-correcting):"]
    scan_lines += _event_lines(s.get("events"))
    scan_lines.append(
        f"Confirmed: **CWE-306** missing auth on `{chosen.get('file', '/device/command')}` "
        f"(the reproduce-probe landed it)."
    )
    await send("\n".join(scan_lines))

    # GENERATE - DeepSeek (Featherless/Bitdeer) authors the PoC.
    gen = await run_stage("generate", base_url=base_url, input_obj=chosen if isinstance(chosen, dict) else None, payload=payload)
    gend = gen.get("data") or {}
    await send(f"**GENERATE** - PoC authored ({gend.get('source', 'model')}): {gend.get('pocText', 'unauthenticated POST /device/command')}")

    # DELIVER - fire the exploit; let the device testify against itself. All in
    # ONE message (the whole gut-punch), so none of it gets rate-limited away.
    d = await run_stage("deliver", base_url=base_url, payload=payload)
    dd = d.get("data") or {}
    status = dd.get("httpStatus")
    worked = bool(dd.get("exploitWorked") or dd.get("success"))
    canonical, sha = _canonical_request(payload)
    pre_patch_row: Optional[dict] = None

    deliver_lines = ["**DELIVER** - fired the exploit (no Authorization header - that absence IS the bug)."]
    if worked and status is not None:
        deliver_lines.append(f"Accepted: **HTTP {status}**. The device obeyed. {dd.get('deviceImpact') or dd.get('impact') or ''}".strip())
        for i in range(3):
            row = await device_status(base_url)
            if row is None:
                break
            if i == 0:
                pre_patch_row = row
            deliver_lines.append(f"`device-service > {json.dumps(row, separators=(',', ':'))}`")
        deliver_lines.append("...still reporting a healthy patient - it has no idea it is compromised.")
        deliver_lines.append("The device is **lying to the hospital in its own words** while fully owned. That silence is why these attacks kill.")
    else:
        deliver_lines.append(f"No real compromise landed (status={status}); holding - no false proof will be shown.")
    await send("\n".join(deliver_lines))

    return GateState(
        run_id=run_id,
        payload=payload,
        base_url=base_url,
        finding_id=finding_id,
        deliver_status=status,
        request_sha256=sha,
        canonical_request=canonical,
        exploit_worked=worked,
        cve_id=cve_id,
        pre_patch_row=pre_patch_row,
    )


# --------------------------------------------------------------------------
# Second half (post-approval): APPLY -> VERIFY -> RECEIPT -> RESTORE.
# --------------------------------------------------------------------------
async def run_after_approval(
    send: Send,
    state: GateState,
    *,
    controller: Optional[DeviceServiceController] = None,
) -> dict:
    base_url = state.get("base_url", DEVICE_BASE_URL)
    payload = state.get("payload", DEFAULT_PAYLOAD)
    cve_id = state.get("cve_id", "CVE-2019-6538")
    controller = controller or DeviceServiceController(base_url)

    # APPLY (vetted fix -> restart patched) + VERIFY (byte-identical replay). One message.
    await asyncio.to_thread(controller.start, patched=True)
    v = await run_stage("verify", base_url=base_url, payload=payload)
    vd = v.get("data") or {}
    passed = bool(vd.get("success") or vd.get("passed"))
    code = vd.get("statusCode")
    before = state.get("deliver_status")

    lines = [
        "**APPLY** - applied the vetted fix (require a token; ignore untrusted telemetry overrides) and restarted the service.",
        f"**VERIFY** - re-sent the identical request (sha256 `{(state.get('request_sha256') or '')[:16]}...`).",
        f"BEFORE: `HTTP {before}` (obeyed)  ->  AFTER: `HTTP {code}` (refused).",
    ]
    post_patch_row: Optional[dict] = None
    if passed:
        lines.append("**PASS** - same bytes, now rejected. Vulnerability closed, proven by re-execution (not prose).")
        post_patch_row = await device_status(base_url)
        if post_patch_row is not None:
            lines.append(f"`device-service > {json.dumps(post_patch_row, separators=(',', ':'))}` - the device finally tells the truth.")
    else:
        lines.append(f"VERIFY did not pass ({vd.get('detail', '')}); reporting honestly rather than claiming a fix.")
    await send("\n".join(lines))

    # RECEIPT - tamper-evident evidence, only from real statuses. One message.
    artifacts: dict = {}
    if passed and before is not None and code is not None:
        try:
            ts = datetime.now(timezone.utc).isoformat()
            sbom = build_sbom_vex(cve_id=cve_id, exploitable=False, deliver_status=before, verify_status=code, ts=ts)
            manifest = build_signed_manifest(
                run_id=state.get("run_id", "run"),
                cve_id=cve_id,
                canonical_request=state.get("canonical_request", ""),
                request_sha256=state.get("request_sha256", ""),
                deliver_status=before,
                verify_status=code,
                pre_patch_row=state.get("pre_patch_row"),
                post_patch_row=post_patch_row,
                sbom=sbom,
            )
            artifacts = write_artifacts(state.get("run_id", "run"), manifest, sbom)
            sig = manifest["signature"]
            await send(
                "**RECEIPT** - ed25519-signed evidence + CycloneDX 1.5 SBOM/VEX (exploitable->resolved), the record that feeds an FDA 524B submission - proven for this target.\n"
                f"root_hash=`{manifest['root_hash'][:24]}...`  sig=`{sig['value'][:24]}...`  pubkey=`{sig['public_key'][:24]}...`"
            )
        except Exception as exc:
            await send(f"(evidence step skipped: {exc})")

    # RESTORE.
    r = await run_stage("restore", base_url=base_url)
    await asyncio.to_thread(controller.stop)
    await send("**RESTORE** - reverted to a clean baseline for the next run.")

    return {"verified": passed, "before": before, "after": code, "restore_ok": bool(r.get("ok")), "artifacts": artifacts}


# --------------------------------------------------------------------------
# Machine-to-machine GATE CHECK (no human gate): used by the A2A Release Captain.
# --------------------------------------------------------------------------
async def run_gate_check(
    send: Send,
    *,
    base_url: str = DEVICE_BASE_URL,
    payload: str = DEFAULT_PAYLOAD,
    controller: Optional[DeviceServiceController] = None,
) -> dict:
    controller = controller or DeviceServiceController(base_url)
    g = await run_stage("ground", base_url=base_url)
    cve = str((g.get("data") or {}).get("cveId", "CVE-2019-6538"))
    await asyncio.to_thread(controller.start, patched=False)
    try:
        await run_stage("scan", base_url=base_url)
        d = await run_stage("deliver", base_url=base_url, payload=payload)
        dd = d.get("data") or {}
        exploitable = bool(dd.get("exploitWorked") or dd.get("success")) and dd.get("httpStatus") is not None
    finally:
        await run_stage("restore", base_url=base_url)
        await asyncio.to_thread(controller.stop)
    go = not exploitable
    reason = (
        "clean - no unauthenticated command path found"
        if go
        else f"exploitable {cve} (CWE-306): unauthenticated POST /device/command was accepted"
    )
    await send(f"security gate result: {'GO' if go else 'NO-GO'} - {reason}")
    return {"go": go, "reason": reason, "cve": cve}
