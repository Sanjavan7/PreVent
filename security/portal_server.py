"""PreVent portal control plane — local HTTP service for the security UI (Dev 2).

A small Flask app (same Flask the device-service uses) that the Vite portal
talks to. It is the read/observe side of the pipeline: it describes the target
codebase, detects a plugged-in Arduino, serves source files, and — the main
act — streams the REAL scanner fleet over Server-Sent Events with honest
per-agent wall-clock timing. Nothing here is faked: every `durationMs` is a
`time.perf_counter()` measurement of an actual semgrep/bandit invocation.

Everything runs locally against the team's own repo (127.0.0.1). No external
services, no new pip deps — CORS is set by hand so we don't pull in flask-cors.

Run it:
    PORTAL_PORT=8077 .venv/bin/python security/portal_server.py

Endpoints:
    GET /api/health        -> {"ok": true}
    GET /api/hardware      -> plugged-in Arduino (via `arduino-cli board list`)
    GET /api/target        -> the codebase under scan + the two planted vulns
    GET /api/scan/stream   -> SSE: 4 scanner agents, honest timing, then ranking
    GET /api/exploit/stream-> SSE: one DeepSeek exploit-author agent per
                              exploitable finding, honest timing, then done
    GET /api/file?path=... -> a repo source file (path-escape guarded)
"""

from __future__ import annotations

import atexit
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

import requests
from flask import Flask, Response, jsonify, request

SECURITY_DIR = Path(__file__).resolve().parent
REPO_ROOT = SECURITY_DIR.parent

# Make the sibling stage modules importable by their package paths, exactly as
# security/loop.py does, so `from scan.run_scanners import ...` resolves no
# matter the CWD the server is launched from.
sys.path.insert(0, str(SECURITY_DIR))

from scan.run_scanners import (  # noqa: E402
    DEVICE_SERVICE_DIR,
    FIRMWARE_DIR,
    FIRMWARE_RULES_DIR,
    SEMGREP_RULES_DIR,
    _SCAN_FLEET,
    run_bandit,
    run_semgrep,
)

# The REAL exploit-author stage, imported by package path exactly as loop.py
# does it (security/ is on sys.path above). generate_dynamic_payload has the
# DeepSeek model AUTHOR a validated executable DeviceCommand from the finding;
# it never raises (falls back to a deterministic validated command).
from generate.exploit import (  # noqa: E402
    DEEPSEEK_MODEL,
    generate_dynamic_payload,
)

# The REAL exploit DELIVER -> PATCH -> VERIFY tail. We reuse loop.py's
# DeviceService (launches device-service/app.py vulnerable or patched against a
# shared row file), deliver.py's unauthenticated POST, and verify.py's
# deterministic re-run checks — no reimplementation.
from loop import DeviceService, _port_free  # noqa: E402
from deliver import deliver_payload  # noqa: E402
from verify import fetch_device_status_row, verify_patch  # noqa: E402

app = Flask(__name__)

# Where the exploit-author reads the device's live attack surface (it falls back
# to a static surface if the device-service isn't up, so this works either way).
DEVICE_SERVICE_URL = os.environ.get("DEVICE_SERVICE_URL", "http://127.0.0.1:8071")

# The Vite dev server lives on a different origin, so every response needs
# permissive CORS. Done by hand (no flask-cors dependency).
_ALLOWED_PORTAL_ORIGINS = ("http://127.0.0.1:5174", "http://localhost:5174")

# Source files that make up the device under scan (what the fleet reads).
_SCANNED_FILES: list[tuple[str, str]] = [
    ("device-service/app.py", "python"),
    ("device-service/diagnostics.py", "python"),
    ("firmware/uno_actuator.ino", "cpp"),
]

# Directories a client may read source from via /api/file. Anything outside
# these (or outside the repo root) is rejected.
_ALLOWED_FILE_DIRS = ("device-service", "firmware", "security")

# The two GENUINE CWE-306 findings the demo is built around — the server HTTP
# handler and its device-side serial analog. Both grounded in CVE-2019-6538.
_PLANTED_VULNS: list[dict[str, Any]] = [
    {
        "id": "server-cwe306",
        "title": "Missing authentication on POST /device/command",
        "cwe": "CWE-306",
        "cveRef": "CVE-2019-6538",
        "file": "device-service/app.py",
        "line": 333,
        "severity": "critical",
        "note": (
            "The vulnerable command handler has no auth decorator and no token "
            "check — any unauthenticated caller can stop the fan and spoof the "
            "reported vitals."
        ),
    },
    {
        "id": "firmware-cwe306",
        "title": "Unauthenticated serial STATE control channel",
        "cwe": "CWE-306",
        "cveRef": "CVE-2019-6538",
        "file": "firmware/uno_actuator.ino",
        "line": 248,
        "severity": "critical",
        "note": (
            "handleState() applies any STATE frame off the serial link with no "
            "authentication — the device-side analog of the server flaw."
        ),
    },
]

_EXT_LANG = {".py": "python", ".ino": "cpp", ".yaml": "yaml", ".yml": "yaml"}


def _now_ms() -> int:
    return int(time.time() * 1000)


# ------------------------------------------------------------------- CORS ----

@app.before_request
def _handle_preflight():
    """Answer CORS preflight (OPTIONS) with a bare 204; the real CORS headers
    are attached by _cors() below (runs on this response too)."""
    if request.method == "OPTIONS":
        return ("", 204)
    return None


@app.after_request
def _cors(resp: Response) -> Response:
    """Permissive CORS on every response so the Vite app (:5174) can call us."""
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "*"
    return resp


# ----------------------------------------------------------------- health ----

@app.get("/api/health")
def health():
    return jsonify({"ok": True})


# --------------------------------------------------------------- hardware ----

# Tiny TTL cache so the portal can poll hardware cheaply without shelling out
# to arduino-cli on every request.
_HW_CACHE: dict[str, Any] = {"ts": 0.0, "value": None}
_HW_TTL_S = 1.5
_HW_NONE = {"connected": False, "board": None, "port": None, "fqbn": None}


def _parse_board_list_table(stdout: str) -> list[dict[str, str]]:
    """Parse the `arduino-cli board list` table into row dicts.

    arduino-cli prints a left-aligned, space-padded table (tabwriter), so cells
    can contain spaces ('Serial Port (USB)', 'Arduino UNO R4 WiFi'). We recover
    them by slicing each data row at the column start positions of the header
    labels — header and data share the same left edges, so this reconstructs
    multi-word cells that a naive whitespace split would mangle.
    """
    lines = [ln for ln in stdout.splitlines() if ln.strip()]
    if not lines:
        return []
    header = lines[0]
    labels = ("Port", "Protocol", "Type", "Board Name", "FQBN", "Core")
    starts: list[int] = []
    present: list[str] = []
    search_from = 0
    for label in labels:
        idx = header.find(label, search_from)
        if idx == -1:
            continue
        starts.append(idx)
        present.append(label)
        search_from = idx + len(label)
    rows: list[dict[str, str]] = []
    for line in lines[1:]:
        row: dict[str, str] = {}
        for i, label in enumerate(present):
            start = starts[i]
            end = starts[i + 1] if i + 1 < len(starts) else len(line)
            row[label] = line[start:end].strip() if start < len(line) else ""
        rows.append(row)
    return rows


def _detect_arduino(stdout: str) -> dict[str, Any]:
    """Pick the Arduino row: Type mentions USB, or Board Name / FQBN mentions
    Arduino (the row shape in the plan's example)."""
    for row in _parse_board_list_table(stdout):
        typ = row.get("Type", "")
        board = row.get("Board Name", "")
        fqbn = row.get("FQBN", "")
        if "USB" in typ.upper() or "ARDUINO" in board.upper() or "ARDUINO" in fqbn.upper():
            return {
                "connected": True,
                "board": board or None,
                "port": row.get("Port") or None,
                "fqbn": fqbn or None,
            }
    return dict(_HW_NONE)


@app.get("/api/hardware")
def hardware():
    """Detect a plugged-in Arduino via `arduino-cli board list`. Never 500s:
    a missing/erroring CLI just reports 'not connected'. Cached ~1.5s."""
    now = time.monotonic()
    if _HW_CACHE["value"] is not None and now - _HW_CACHE["ts"] < _HW_TTL_S:
        return jsonify(_HW_CACHE["value"])

    try:
        proc = subprocess.run(
            ["arduino-cli", "board", "list"],
            capture_output=True,
            text=True,
            timeout=8.0,
        )
        value = _detect_arduino(proc.stdout) if proc.returncode == 0 else dict(_HW_NONE)
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        # arduino-cli absent, hung, or otherwise unhappy -> honest "no board".
        value = dict(_HW_NONE)

    _HW_CACHE["ts"] = now
    _HW_CACHE["value"] = value
    return jsonify(value)


# ----------------------------------------------------------------- target ----

def _loc(rel_path: str) -> int:
    """Line count of a repo source file (0 if it has vanished)."""
    try:
        return len((REPO_ROOT / rel_path).read_text(encoding="utf-8", errors="replace").splitlines())
    except OSError:
        return 0


@app.get("/api/target")
def target():
    """Describe the codebase the fleet scans: the three source files and the
    two planted CWE-306 vulnerabilities."""
    return jsonify(
        {
            "name": "prevent-device",
            "root": str(REPO_ROOT),
            "files": [
                {"path": path, "lang": lang, "loc": _loc(path)}
                for path, lang in _SCANNED_FILES
            ],
            "plantedVulns": _PLANTED_VULNS,
        }
    )


# -------------------------------------------------------------- scan/SSE ----

def _cvss_for(finding: dict[str, Any]) -> float:
    """Deterministic CVSS score by (scanner, file) then (scanner, ruleId),
    with a severity-based fallback. The two semgrep CWE-306 findings score
    highest; the bandit decoys score low."""
    scanner = finding.get("scanner", "")
    file = finding.get("file", "")
    rule = finding.get("ruleId", "")
    severity = str(finding.get("severity", "")).upper()

    if scanner == "semgrep" and file.endswith("app.py"):
        return 9.3
    if scanner == "semgrep" and file.endswith("uno_actuator.ino"):
        return 8.8
    if scanner == "bandit" and rule == "B324":
        return 5.9
    if scanner == "bandit" and rule == "B105":
        return 2.5
    if scanner == "bandit" and rule == "B110":
        return 2.0
    if severity in ("ERROR", "HIGH"):
        return 5.0
    if severity == "MEDIUM":
        return 4.0
    return 2.0


def _verdict_for(finding: dict[str, Any]) -> str:
    """One-sentence human verdict that explains the ranking."""
    scanner = finding.get("scanner", "")
    file = finding.get("file", "")
    rule = finding.get("ruleId", "")

    if scanner == "semgrep" and file.endswith("app.py"):
        return "Top CVSS. Unauthenticated command channel — the server analog of CVE-2019-6538."
    if scanner == "semgrep" and file.endswith("uno_actuator.ino"):
        return "Same flaw on the device: forge a STATE frame, no auth on the serial link."
    if scanner == "bandit" and rule == "B324":
        return "Demoted: HIGH severity, but not an exploitable control path."
    return "Low. No path to device control."


def rank_findings(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Deterministic ranking: the exploitable (semgrep CWE-306) findings first,
    then by CVSS descending. 'real' marks the two genuine control-path vulns;
    bandit hits are decoys. Returns one item per finding:
    {rank, findingId, cvss, real, verdict}."""
    scored = []
    for f in findings:
        real = f.get("scanner") == "semgrep"
        cvss = _cvss_for(f)
        scored.append((f, real, cvss))

    # real first, then CVSS desc; findingId as a stable final tiebreak.
    scored.sort(key=lambda t: (0 if t[1] else 1, -t[2], t[0].get("id", 0)))

    ranking: list[dict[str, Any]] = []
    for rank, (f, real, cvss) in enumerate(scored, start=1):
        ranking.append(
            {
                "rank": rank,
                "findingId": f.get("id"),
                "cvss": cvss,
                "real": real,
                "verdict": _verdict_for(f),
            }
        )
    return ranking


# The most recent scan result, so the exploit endpoint can pick up the ranking
# the scan stream already computed instead of re-running the fleet. Populated by
# _scan_stream() when it reaches the ranking, and by _compute_scan() on a cold
# start (exploit hit before any scan).
_LAST_SCAN: dict[str, Any] = {"findings": [], "ranking": []}


def _compute_scan() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Run the full scanner fleet once (non-streaming) and return
    (findings, ranking). Uses the exact same fleet + run_semgrep/run_bandit +
    rank_findings the SSE scan endpoint uses; the exploit endpoint calls this
    when it is hit before any scan has populated _LAST_SCAN."""
    all_findings: list[dict[str, Any]] = []
    gid = 0
    for tool, target_name, _language, target_dir, rules_dir in _SCAN_FLEET:
        if tool == "semgrep" and rules_dir:
            found = run_semgrep(target_dir, rules_dir)
        else:
            found = run_bandit(target_dir)
        for f in found:
            gid += 1
            f["id"] = gid
            f["target"] = target_name
        all_findings.extend(found)
    return all_findings, rank_findings(all_findings)


def _sse(obj: dict[str, Any]) -> str:
    """Encode one SSE `data:` message (double newline terminates the event)."""
    return f"data: {json.dumps(obj)}\n\n"


def _scan_stream():
    """Run the 4-agent scanner fleet in order, emitting an agent_started /
    agent_finished SSE pair per agent with HONEST per-agent wall-clock timing,
    then a final ranking and a scan_done. Every scan is a real subprocess."""
    all_findings: list[dict[str, Any]] = []
    gid = 0  # globally-unique finding id across all agents
    total_t0 = time.perf_counter()

    for tool, target_name, language, target_dir, rules_dir in _SCAN_FLEET:
        agent_id = f"{tool}/{target_name}"
        yield _sse(
            {
                "type": "agent_started",
                "agentId": agent_id,
                "tool": tool,
                "target": target_name,
                "language": language,
                "ts": _now_ms(),
            }
        )

        t0 = time.perf_counter()
        if tool == "semgrep" and rules_dir:
            found = run_semgrep(target_dir, rules_dir)
        else:
            found = run_bandit(target_dir)
        duration_ms = int(round((time.perf_counter() - t0) * 1000))

        # Tag each finding with a global id and its target (server vs firmware).
        for f in found:
            gid += 1
            f["id"] = gid
            f["target"] = target_name
        all_findings.extend(found)

        yield _sse(
            {
                "type": "agent_finished",
                "agentId": agent_id,
                "tool": tool,
                "target": target_name,
                "language": language,
                "durationMs": duration_ms,
                "findingCount": len(found),
                "findings": found,
            }
        )

    total_ms = int(round((time.perf_counter() - total_t0) * 1000))
    ranking = rank_findings(all_findings)
    # Stash the result so /api/exploit/stream reuses this ranking rather than
    # re-running the fleet.
    _LAST_SCAN["findings"] = all_findings
    _LAST_SCAN["ranking"] = ranking
    yield _sse(
        {
            "type": "ranking",
            "findings": all_findings,
            "ranking": ranking,
            "durationMs": total_ms,
        }
    )
    yield _sse({"type": "scan_done"})


@app.get("/api/scan/stream")
def scan_stream():
    resp = Response(_scan_stream(), mimetype="text/event-stream")
    # Keep proxies/dev-servers from buffering the stream so each agent beat
    # reaches the UI as it happens.
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["X-Accel-Buffering"] = "no"
    return resp


# ----------------------------------------------------------- exploit/SSE ----

# The attacker goal handed to the author agent, chosen by the finding's file:
# the server HTTP command handler vs its firmware serial analog.
_GOAL_SERVER = (
    "Stop the ventilator fan while keeping the dashboard reporting healthy "
    "vitals and no alarm."
)
_GOAL_FIRMWARE = (
    "Forge a serial STATE frame that stops the fan and falsifies the displayed "
    "vitals."
)


def _goal_for(file: str) -> str:
    """Pick the attacker goal by the finding's file (firmware vs server)."""
    if file.endswith("uno_actuator.ino"):
        return _GOAL_FIRMWARE
    return _GOAL_SERVER


def _exploitable_findings() -> list[dict[str, Any]]:
    """The exploitable findings — the ranking entries flagged real==True (the
    two CWE-306) — joined back to their full finding dicts, in rank order. On a
    cold cache (exploit hit before any scan) it runs the fleet to populate it."""
    if not _LAST_SCAN["findings"] or not _LAST_SCAN["ranking"]:
        findings, ranking = _compute_scan()
        _LAST_SCAN["findings"] = findings
        _LAST_SCAN["ranking"] = ranking

    by_id = {f.get("id"): f for f in _LAST_SCAN["findings"]}
    exploitable: list[dict[str, Any]] = []
    for entry in _LAST_SCAN["ranking"]:  # already in rank order
        if entry.get("real"):
            finding = by_id.get(entry.get("findingId"))
            if finding is not None:
                exploitable.append(finding)
    return exploitable


def _exploit_stream():
    """Spawn one DeepSeek exploit-author agent per exploitable finding, in rank
    order, emitting an author_started / author_finished SSE pair per agent with
    HONEST per-author wall-clock timing, then a final authors_done. Each agent
    has the model AUTHOR a validated, executable DeviceCommand for a goal picked
    by the finding's file. generate_dynamic_payload never raises — a missing or
    declining model falls back to a deterministic validated command (its
    `source` becomes 'pre_cached_fallback')."""
    findings = _exploitable_findings()
    for finding in findings:
        file = finding.get("file", "")
        target = finding.get("target", "")
        goal = _goal_for(file)
        agent_id = f"author/{target}"

        yield _sse(
            {
                "type": "author_started",
                "agentId": agent_id,
                "findingId": finding.get("id"),
                "target": target,
                "file": file,
                "model": DEEPSEEK_MODEL,
                "ts": _now_ms(),
            }
        )

        t0 = time.perf_counter()
        result = generate_dynamic_payload(goal, finding, base_url=DEVICE_SERVICE_URL)
        duration_ms = int(round((time.perf_counter() - t0) * 1000))

        yield _sse(
            {
                "type": "author_finished",
                "agentId": agent_id,
                "findingId": finding.get("id"),
                "target": target,
                "durationMs": duration_ms,
                "model": result.get("modelId"),
                "source": result.get("source"),
                "command": result.get("command"),
                "impact": result.get("impact"),
                "rationale": result.get("rationale"),
            }
        )

    yield _sse({"type": "authors_done", "count": len(findings)})


@app.get("/api/exploit/stream")
def exploit_stream():
    resp = Response(_exploit_stream(), mimetype="text/event-stream")
    # Same anti-buffering headers as the scan stream, so each author beat
    # reaches the UI as it happens.
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["X-Accel-Buffering"] = "no"
    return resp


# ----------------------------------------------- exploit DELIVER/PATCH/VERIFY -

# A single device-service subprocess that the DELIVER -> PATCH -> VERIFY tail
# drives for REAL. We manage it exactly as loop.py does — one DeviceService,
# one shared temp row file, one temp log dir — but keep it alive across requests
# (the portal fires deliver, then patch, then verify, then restore as separate
# HTTP calls) instead of inside one run_loop() scope.
_SVC: DeviceService | None = None
_SVC_TMPDIR: Path | None = None
# Serialize (re)starts: Flask runs threaded, and DeviceService.start() does a
# stop()+spawn, so overlapping calls could orphan a child. One lock, no races.
_SVC_LOCK = threading.Lock()


def _free_device_port() -> int:
    """A free TCP port for the device-service singleton. Prefer 8071 (loop's
    default; NOT the portal's own 8077), scanning upward if it's taken, then
    fall back to an OS-assigned ephemeral port."""
    for port in range(8071, 8171):
        if port == 8077:
            continue
        if _port_free(port):
            return port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _device(patched: bool) -> DeviceService:
    """Lazily create the device-service singleton (temp row file + log dir) and
    (re)start it in the requested mode, returning the running service.
    DeviceService.start() stops any prior process first, so this both launches
    the service cold and flips it between vulnerable/patched on later calls."""
    global _SVC, _SVC_TMPDIR
    with _SVC_LOCK:
        if _SVC is None:
            _SVC_TMPDIR = Path(tempfile.mkdtemp(prefix="prevent-portal-dev-"))
            _SVC = DeviceService(
                port=_free_device_port(),
                row_file=_SVC_TMPDIR / "device_row.json",
                log_dir=_SVC_TMPDIR,
            )
        _SVC.start(patched=patched)
        return _SVC


@atexit.register
def _stop_device_on_exit() -> None:
    """Never leave an orphan device-service child when the portal exits."""
    if _SVC is not None:
        _SVC.stop()


def _true_block(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "hr": row["trueHr"],
        "spo2": row["trueSpo2"],
        "fanOn": row["fanOn"],
        "alarmActive": row["alarmActive"],
    }


@app.post("/api/deliver")
def api_deliver():
    """Run the device-service VULNERABLE and fire the unauthenticated payload at
    it for real, returning the true-vs-reported divergence it produced."""
    body = request.get_json(silent=True) or {}
    command = body.get("command") or {}

    svc = _device(patched=False)
    fetch_device_status_row(base_url=svc.base_url)  # before (observed baseline)
    result = deliver_payload(command, base_url=svc.base_url)
    after = fetch_device_status_row(base_url=svc.base_url)

    status_code = result["statusCode"]
    compromised = status_code == 200 and (
        after["fanOn"] is False or after["reportedHr"] != after["trueHr"]
    )

    if compromised:
        fan_txt = "fan stopped" if not after["fanOn"] else "fan running"
        alarm_txt = "alarm silent" if not after["alarmActive"] else "alarm active"
        impact = (
            f"{status_code} OK — {fan_txt}; device still reports "
            f"{after['reportedHr']}/{after['reportedSpo2']} while true vitals are "
            f"{after['trueHr']}/{after['trueSpo2']}, {alarm_txt}."
        )
    else:
        impact = (
            f"HTTP {status_code} — no compromise (fan "
            f"{'on' if after['fanOn'] else 'off'}, reported matches true)."
        )

    return jsonify(
        {
            "statusCode": status_code,
            "compromised": bool(compromised),
            "impact": impact,
            "true": _true_block(after),
            "reported": {
                "hr": after["reportedHr"],
                "spo2": after["reportedSpo2"],
                "alarmActive": after["alarmActive"],
            },
        }
    )


@app.post("/api/patch")
def api_patch():
    """Deploy the patched device-service (bearer auth required, untrusted
    reported_overrides ignored) — stands in for Factory Droid's diff."""
    _device(patched=True)
    return jsonify(
        {
            "applied": True,
            "diffRef": "device-service/app.py (+bearer auth, −trust overrides)",
            "droid": "factory-7f3a1c",
        }
    )


@app.post("/api/verify")
def api_verify():
    """Re-send the byte-identical exploit at the PATCHED service and run the
    deterministic checks (401/403 + true_state unchanged + no lie)."""
    body = request.get_json(silent=True) or {}
    command = body.get("command") or {}

    # verify runs against the patched service /api/patch left running; if nothing
    # is up yet, bring it up patched so the endpoint is still well-behaved.
    svc = _SVC if _SVC is not None else _device(patched=True)
    v_before = fetch_device_status_row(base_url=svc.base_url)
    outcome = verify_patch(command, base_url=svc.base_url, status_before=v_before)
    after = fetch_device_status_row(base_url=svc.base_url)

    return jsonify(
        {
            "statusCode": outcome["statusCode"],
            "passed": outcome["passed"],
            "detail": outcome["detail"],
            "true": _true_block(after),
        }
    )


@app.post("/api/restore")
def api_restore():
    """Flip back to the clean, pre-patch VULNERABLE service and reset it to the
    healthy baseline (device-service exposes GET /device/_reset)."""
    svc = _device(patched=False)
    try:
        requests.get(f"{svc.base_url}/device/_reset", timeout=5.0)
    except requests.RequestException:
        pass  # a reset hiccup shouldn't fail the restore; restart already reset
    return jsonify({"ok": True})


# ------------------------------------------------------------------- file ----

def _safe_repo_file(rel_path: str) -> Path | None:
    """Resolve a repo-relative path and reject anything that escapes the repo
    root or lands outside the allowed source dirs. Returns the resolved Path
    for a readable file, or None to signal a 400."""
    if not rel_path:
        return None
    try:
        candidate = (REPO_ROOT / rel_path).resolve()
        rel = candidate.relative_to(REPO_ROOT)  # raises if it escaped the root
    except (ValueError, OSError):
        return None
    if not rel.parts or rel.parts[0] not in _ALLOWED_FILE_DIRS:
        return None
    if not candidate.is_file():
        return None
    return candidate


@app.get("/api/file")
def file():
    rel_path = request.args.get("path", "")
    resolved = _safe_repo_file(rel_path)
    if resolved is None:
        return jsonify({"error": "path not allowed"}), 400
    content = resolved.read_text(encoding="utf-8", errors="replace")
    return jsonify(
        {
            "path": str(resolved.relative_to(REPO_ROOT)),
            "lang": _EXT_LANG.get(resolved.suffix.lower(), "text"),
            "content": content,
            "lines": len(content.splitlines()),
        }
    )


# ------------------------------------------------------------------- main ----

def main() -> None:
    host = os.environ.get("PORTAL_HOST", "127.0.0.1")
    port = int(os.environ.get("PORTAL_PORT", "8077"))
    # threaded=True so the SSE stream (a long-lived response) doesn't block the
    # other endpoints — same dev-server posture as device-service/app.py.
    app.run(host=host, port=port, threaded=True, debug=False)


if __name__ == "__main__":
    main()
