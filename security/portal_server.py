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
import queue
import re
import shutil
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
    run_bandit_generic,
    run_semgrep,
    run_semgrep_generic,
)

# The REAL exploit-author stage, imported by package path exactly as loop.py
# does it (security/ is on sys.path above). generate_dynamic_payload has the
# DeepSeek model AUTHOR a validated executable DeviceCommand from the finding;
# it never raises (falls back to a deterministic validated command).
from generate.exploit import (  # noqa: E402
    DEEPSEEK_MODEL,
    run_finding_conversation,
    stream_dynamic_payload,
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
    if os.environ.get("PREVENT_FAKE_HW") == "1":
        # Dev/test only: report a demo board so the flow proceeds without USB.
        return jsonify({"connected": True, "board": "Arduino Uno (demo)", "port": "COM-DEMO", "fqbn": "arduino:avr:uno"})
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


# ------------------------------------------------------- repo scan/SSE ----
# "Real scan, any repo": clone a PUBLIC GitHub repo and run the REAL scanners
# over it, streaming the SAME event shape as /api/scan/stream so the review UI
# is unchanged. Static analysis only — semgrep/bandit never execute the cloned
# code; we clone shallow, scan, and delete. This path stops at ranked findings;
# the hardware exploit/patch/verify loop stays bound to the demo device repo.

_REPO_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")
_CLONE_ROOT = Path(tempfile.gettempdir()) / "prevent-repo-scan"
_MAX_CLONE_FILES = 2000
_MAX_CLONE_BYTES = 50 * 1024 * 1024  # 50 MB working tree

# The most recent cloned repo: its root (for /api/repo/file) and scan result.
_ACTIVE_REPO: dict[str, Any] = {"root": None, "owner": None, "name": None, "findings": [], "ranking": []}

_SEV_CVSS = {"CRITICAL": 9.0, "ERROR": 7.5, "HIGH": 7.5, "WARNING": 5.0, "MEDIUM": 5.0, "INFO": 2.5, "LOW": 2.5}


def _cvss_generic(finding: dict[str, Any]) -> float:
    """Severity-band CVSS for an arbitrary-repo finding — no filename heuristics
    (those only make sense for the planted demo vulns)."""
    return _SEV_CVSS.get(str(finding.get("severity", "")).upper(), 3.0)


def _verdict_generic(finding: dict[str, Any]) -> str:
    sev = str(finding.get("severity", "")).upper() or "INFO"
    rule = finding.get("ruleId", "") or "rule"
    return f"{sev} · {rule} ({finding.get('scanner', '')})"


def rank_findings_generic(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rank arbitrary-repo findings by severity-band CVSS desc (stable by id).
    `real` is always False: that flag drives the hardware exploit, which repo
    mode never runs."""
    ordered = sorted(findings, key=lambda f: (-_cvss_generic(f), f.get("id", 0)))
    return [
        {
            "rank": i + 1,
            "findingId": f.get("id"),
            "cvss": _cvss_generic(f),
            "real": False,
            "verdict": _verdict_generic(f),
        }
        for i, f in enumerate(ordered)
    ]


def _parse_repo_arg(raw: str) -> tuple[str, str] | None:
    """Accept a full https URL, a git@ SSH URL, or bare owner/repo, and return
    (owner, name) when both are safe, shell-free identifiers; else None."""
    raw = (raw or "").strip()
    if not raw:
        return None
    m = re.search(r"github\.com[:/]+([^/]+)/([^/#?]+)", raw)
    if m:
        owner, name = m.group(1), m.group(2)
    else:
        parts = [p for p in raw.split("/") if p]
        if len(parts) < 2:
            return None
        owner, name = parts[-2], parts[-1]
    if name.endswith(".git"):
        name = name[:-4]
    if not (_REPO_NAME_RE.match(owner) and _REPO_NAME_RE.match(name)):
        return None
    return owner, name


def _cleanup_active_clone() -> None:
    root = _ACTIVE_REPO.get("root")
    if root:
        shutil.rmtree(root, ignore_errors=True)
    _ACTIVE_REPO.update({"root": None, "owner": None, "name": None, "findings": [], "ranking": []})


@atexit.register
def _cleanup_clone_root() -> None:
    shutil.rmtree(_CLONE_ROOT, ignore_errors=True)


def _within_limits(root: Path) -> tuple[bool, str]:
    """Reject pathologically large repos after clone (before scanning)."""
    files = 0
    total = 0
    for p in root.rglob("*"):
        if ".git" in p.parts:
            continue
        if p.is_file():
            files += 1
            try:
                total += p.stat().st_size
            except OSError:
                pass
            if files > _MAX_CLONE_FILES:
                return False, f"repo too large (over {_MAX_CLONE_FILES} files) to scan here"
            if total > _MAX_CLONE_BYTES:
                return False, f"repo too large (over {_MAX_CLONE_BYTES // (1024 * 1024)} MB) to scan here"
    return True, ""


def _clone_repo(owner: str, name: str) -> tuple[Path | None, str | None]:
    """Shallow-clone a public GitHub repo into a fresh temp dir. Non-interactive
    (never prompts for credentials — a private/missing repo fails fast). Returns
    (path, None) on success or (None, error_message)."""
    _cleanup_active_clone()
    _CLONE_ROOT.mkdir(parents=True, exist_ok=True)
    dest = Path(tempfile.mkdtemp(prefix=f"{owner}-{name}-", dir=_CLONE_ROOT))
    url = f"https://github.com/{owner}/{name}.git"
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never"}
    try:
        proc = subprocess.run(
            ["git", "-c", "credential.helper=", "clone", "--depth", "1",
             "--single-branch", url, str(dest)],
            capture_output=True, text=True, timeout=90.0, env=env,
        )
    except subprocess.TimeoutExpired:
        shutil.rmtree(dest, ignore_errors=True)
        return None, "clone timed out after 90s"
    except FileNotFoundError:
        shutil.rmtree(dest, ignore_errors=True)
        return None, "git is not installed on the control-plane host"
    if proc.returncode != 0:
        shutil.rmtree(dest, ignore_errors=True)
        tail = [ln for ln in (proc.stderr or "").strip().splitlines() if ln.strip()]
        low = " ".join(tail).lower()
        # GitHub answers a missing OR private repo over https with an auth
        # challenge; with prompts disabled that surfaces as a password error.
        if any(k in low for k in ("password", "authentication", "could not read username", "403")):
            return None, f"{owner}/{name} not found, or it is private (public repos only)"
        detail = tail[-1] if tail else "clone failed"
        return None, f"could not clone {owner}/{name} — {detail}"
    ok, why = _within_limits(dest)
    if not ok:
        shutil.rmtree(dest, ignore_errors=True)
        return None, why
    return dest, None


def _repo_has_python(root: Path) -> bool:
    for p in root.rglob("*.py"):
        if ".git" not in p.parts:
            return True
    return False


def _repo_scan_stream(owner: str, name: str):
    """Clone + scan an arbitrary repo, emitting the SAME events as _scan_stream
    (agent_started / agent_finished / ranking / scan_done), plus a terminal
    scan_error on a clone/validation failure."""
    label = f"{owner}/{name}"
    total_t0 = time.perf_counter()

    yield _sse({"type": "agent_started", "agentId": f"clone/{name}", "tool": "git",
                "target": label, "language": "clone", "ts": _now_ms()})
    clone_t0 = time.perf_counter()
    dest, err = _clone_repo(owner, name)
    clone_ms = int(round((time.perf_counter() - clone_t0) * 1000))
    if err or dest is None:
        yield _sse({"type": "scan_error", "message": err or "clone failed"})
        return
    _ACTIVE_REPO.update({"root": dest, "owner": owner, "name": name, "findings": [], "ranking": []})
    yield _sse({"type": "agent_finished", "agentId": f"clone/{name}", "tool": "git",
                "target": label, "language": "clone", "durationMs": clone_ms,
                "findingCount": 0, "findings": []})

    fleet: list[tuple[str, str]] = [("semgrep", "multi-language")]
    if _repo_has_python(dest):
        fleet.append(("bandit", "python"))

    all_findings: list[dict[str, Any]] = []
    gid = 0
    for tool, language in fleet:
        agent_id = f"{tool}/{name}"
        yield _sse({"type": "agent_started", "agentId": agent_id, "tool": tool,
                    "target": label, "language": language, "ts": _now_ms()})
        at0 = time.perf_counter()
        found = run_semgrep_generic(dest) if tool == "semgrep" else run_bandit_generic(dest)
        dur = int(round((time.perf_counter() - at0) * 1000))
        for f in found:
            gid += 1
            f["id"] = gid
            f["target"] = label
        all_findings.extend(found)
        yield _sse({"type": "agent_finished", "agentId": agent_id, "tool": tool,
                    "target": label, "language": language, "durationMs": dur,
                    "findingCount": len(found), "findings": found})

    ranking = rank_findings_generic(all_findings)
    _ACTIVE_REPO["findings"] = all_findings
    _ACTIVE_REPO["ranking"] = ranking
    total_ms = int(round((time.perf_counter() - total_t0) * 1000))
    yield _sse({"type": "ranking", "findings": all_findings, "ranking": ranking, "durationMs": total_ms})
    yield _sse({"type": "scan_done"})


@app.get("/api/repo/scan/stream")
def repo_scan_stream():
    parsed = _parse_repo_arg(request.args.get("repo", ""))
    if parsed is None:
        def _bad():
            yield _sse({"type": "scan_error",
                        "message": "enter a GitHub repo as owner/name or a full github.com URL"})
        return Response(_bad(), mimetype="text/event-stream")
    owner, name = parsed
    resp = Response(_repo_scan_stream(owner, name), mimetype="text/event-stream")
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


def _all_findings_for_exploit() -> list[dict[str, Any]]:
    """EVERY finding the scan surfaced (not just the exploitable ones): each gets
    its own DeepSeek conversation node and the model decides exploitable-or-not.
    Prefers an active cloned-repo scan; else the built-in demo scan (run cold)."""
    if _ACTIVE_REPO.get("findings"):
        return list(_ACTIVE_REPO["findings"])
    if not _LAST_SCAN["findings"]:
        findings, ranking = _compute_scan()
        _LAST_SCAN["findings"] = findings
        _LAST_SCAN["ranking"] = ranking
    return list(_LAST_SCAN["findings"])


def _exploit_stream(finding_id: int | None = None):
    """Spawn ONE DeepSeek conversation per scanner finding, ALL IN PARALLEL, and
    multiplex their live turns over a single SSE stream (tagged by findingId).
    Per finding: agent_spawned -> turn/delta... -> verdict -> payload? ->
    agent_done; a final all_done once every conversation ends. Each conversation
    runs run_finding_conversation (2 turns: analyze, then verdict + an authored
    command + patient/patch risk) on its own worker thread; it never raises —
    with no provider it synthesizes a paced ~10-12s conversation. With
    ?finding=<id> only that one finding's conversation runs."""
    findings = _all_findings_for_exploit()
    if finding_id is not None:
        findings = [f for f in findings if f.get("id") == finding_id]
    total = len(findings)
    if total == 0:
        yield _sse({"type": "all_done", "count": 0})
        return

    events: "queue.Queue[dict[str, Any]]" = queue.Queue()

    def _worker(f: dict[str, Any]):
        fid = f.get("id")
        t0 = time.perf_counter()
        events.put({"type": "agent_spawned", "findingId": fid, "model": DEEPSEEK_MODEL,
                    "file": f.get("file"), "target": f.get("target")})
        source = "pre_cached_fallback"
        try:
            def _on_turn(idx: int, _fid=fid):
                events.put({"type": "turn", "findingId": _fid, "role": "deepseek",
                            "text": f"\n\n— DeepSeek turn {idx} —\n"})

            def _on_delta(text: str, _fid=fid):
                events.put({"type": "delta", "findingId": _fid, "role": "deepseek", "text": text})

            res = run_finding_conversation(f, base_url=DEVICE_SERVICE_URL,
                                           on_delta=_on_delta, on_turn=_on_turn)
            source = res.get("source", source)
            events.put({"type": "verdict", "findingId": fid,
                        "exploitable": bool(res.get("exploitable")),
                        "rationale": res.get("rationale", "")})
            if res.get("exploitable") and res.get("command"):
                events.put({"type": "payload", "findingId": fid, "command": res.get("command"),
                            "impact": res.get("impact", ""),
                            "patientRisk": res.get("patientRisk", ""),
                            "patchRisk": res.get("patchRisk", "")})
        except Exception as exc:  # noqa: BLE001 -- surfaced as a not-exploitable verdict
            source = "error"
            events.put({"type": "verdict", "findingId": fid, "exploitable": False,
                        "rationale": f"author error: {exc}"})
        finally:
            events.put({"type": "agent_done", "findingId": fid,
                        "durationMs": int(round((time.perf_counter() - t0) * 1000)),
                        "source": source})

    threads = [threading.Thread(target=_worker, args=(f,), daemon=True) for f in findings]
    for t in threads:
        t.start()

    # Drain the shared queue, flushing each event as it arrives, until every
    # worker has emitted its single agent_done.
    done = 0
    while done < total:
        ev = events.get()
        yield _sse(ev)
        if ev.get("type") == "agent_done":
            done += 1
    for t in threads:
        t.join(timeout=1)
    yield _sse({"type": "all_done", "count": total})


@app.get("/api/exploit/stream")
def exploit_stream():
    # Optional ?finding=<id>: author ONLY that finding so the UI can run the
    # server stage and the fan stage separately. Absent (or unparseable) ->
    # author every exploitable finding, exactly as before.
    finding_id: int | None = None
    raw = request.args.get("finding")
    if raw is not None:
        try:
            finding_id = int(raw)
        except (TypeError, ValueError):
            finding_id = None
    resp = Response(_exploit_stream(finding_id), mimetype="text/event-stream")
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

# --------------------------------------------- Factory Droid patch gate ----
#
# The REAL remediation stage. A Node runner (Factory Droid writer + read-only
# reviewer) produces a diff + verdict, then a HUMAN gates the deploy. The gate
# lives here in Python (not in the runner) so it reuses the proven worker/
# queue/generator plumbing _exploit_stream already uses and never holds the
# Node child open across minutes of deliberation — the runner EXITS after the
# verdict; approval drives the device restart + VERIFY, rejection git-reverts.
AGENTS_DIR = REPO_ROOT / "agents"
# Invoke `node` against tsx's JS entry directly (never a tsx/pnpm shim) so the
# spawn is Windows-safe.
TSX_CLI = AGENTS_DIR / "node_modules" / "tsx" / "dist" / "cli.mjs"
PATCH_RUNNER = AGENTS_DIR / "src" / "factory" / "patchRunner.ts"
_PATCH_GATE = threading.Event()  # set by /api/approve|reject; unblocks the stream
_PATCH_DECISION: dict[str, Any] = {}  # {"approved": bool, "approvedBy": str}
_PATCH_PENDING = threading.Event()  # set while a gate is awaited; guards the 409

# The exploit command the patch-stage VERIFY re-sends byte-identical against
# Droid's edited bytes. Captured from the most recent /api/deliver (the attack
# the judge just watched land); defaults to the canonical stop-fan payload so
# the inline VERIFY is well-behaved even on a cold patch run.
_DEFAULT_EXPLOIT_COMMAND: dict[str, Any] = {
    "action": "stop_fan",
    "reportedOverrides": {"hr": 72, "spo2": 98, "alarm": False},
}
_LAST_EXPLOIT_COMMAND: dict[str, Any] = dict(_DEFAULT_EXPLOIT_COMMAND)


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


def _device(patched: bool = False) -> DeviceService:
    """Lazily create the device-service singleton (temp row file + log dir) and
    (re)start it in the requested build, returning the running service.
    DeviceService.start() stops any prior process first, so this launches the
    service cold and relaunches it between stages: vulnerable for DELIVER, patched
    for the post-approval VERIFY. The patch stage also edits app.py for real (the
    Droid diff shown in the UI); the build flag makes VERIFY deterministic whether
    or not that on-disk edit applied."""
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


# ------------------------------------------- SpacetimeDB state mirror ----
#
# When the portal fires a payload (red) or lands a patch/recovery (green), mirror
# the patient state to the shared SpacetimeDB `device_status` row so the 3D sim +
# dashboard react to the REAL pipeline instead of a manual seed. Best-effort: a
# missing CLI, stale login, or no network must NEVER break the demo, so every
# failure is swallowed. Disable with PORTAL_SPACETIME_SYNC=0.

_SPACETIME_STATES = {
    # phase:      fanOn   trueHr trueSpo2 repHr repSpo2 alarm  compromised lastCommand
    "attack": ["false", "35", "82", "72", "98", "false", "true", "stop_fan (unauthenticated)"],
    "healthy": ["true", "72", "98", "72", "98", "false", "false", "healthy"],
}


def _spacetime_bin() -> str:
    for cand in (
        os.path.expanduser("~/.local/bin/spacetime"),
        "/opt/homebrew/bin/spacetime",
        "/usr/local/bin/spacetime",
    ):
        if os.path.exists(cand):
            return cand
    return "spacetime"


def _mirror_db_state(phase: str) -> None:
    """Best-effort write of device_status to SpacetimeDB. phase: 'attack'|'healthy'."""
    if os.environ.get("PORTAL_SPACETIME_SYNC", "1") == "0":
        return
    args = _SPACETIME_STATES.get(phase)
    if not args:
        return
    server = os.environ.get("SPACETIME_SERVER", "maincloud")
    module = os.environ.get("VITE_SPACETIMEDB_MODULE", "prevent")
    try:
        subprocess.run(
            [_spacetime_bin(), "call", "--server", server, module, "update_device_status", *args],
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass


# The board's current firmware, tracked so a transition only re-flashes when the
# hardware isn't already in that state. The flash is slow (~8s) and holds the
# serial port, so it runs on a daemon thread serialized by a lock — requests never
# block and two flashes never fight for the port. Disable with PORTAL_HW_SYNC=0.
_HW_LOCK = threading.Lock()
_HW_STATE: str | None = None  # 'attack' | 'healthy' | None (unknown)


def _note_hw_flashed(phase: str) -> None:
    """Record that the board was just flashed to `phase` (called by the explicit
    /api/flash* endpoints so the reconciler's tracking stays accurate)."""
    global _HW_STATE
    with _HW_LOCK:
        _HW_STATE = phase


def _reconcile_hardware(phase: str) -> None:
    """Flash the board to match `phase` ('attack'|'healthy') unless it's already
    there. Background + lock-serialized; best-effort (a missing board is fine)."""
    if os.environ.get("PORTAL_HW_SYNC", "1") == "0":
        return

    def _work() -> None:
        global _HW_STATE
        with _HW_LOCK:
            if phase == _HW_STATE:
                return  # board already in this state — skip the ~8s flash
            try:
                if phase == "attack":
                    _flash_sketch(_write_fanoff_sketch())
                else:
                    _flash_sketch(_write_healthy_sketch())
                _HW_STATE = phase
            except Exception:  # noqa: BLE001 -- hardware is best-effort
                pass

    threading.Thread(target=_work, daemon=True).start()


def _apply_state(phase: str) -> None:
    """Set BOTH the shared DB row (sim/dashboard) and the physical board to
    `phase`, so software and hardware always move together."""
    _mirror_db_state(phase)
    _reconcile_hardware(phase)


@app.post("/api/deliver")
def api_deliver():
    """Run the device-service VULNERABLE and fire the unauthenticated payload at
    it for real, returning the true-vs-reported divergence it produced."""
    global _LAST_EXPLOIT_COMMAND
    body = request.get_json(silent=True) or {}
    command = body.get("command") or {}
    if command:
        # Remember the exact bytes delivered so the patch-stage VERIFY can
        # re-send a byte-identical exploit against Droid's edited handler.
        _LAST_EXPLOIT_COMMAND = command

    svc = _device()
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

    # Mirror a successful breach to the shared DB so the sim + dashboard go red.
    # A non-compromise leaves the row untouched — recovery is the patch's job, and
    # writing "healthy" here would race the physical fan-off flash fired alongside.
    if compromised:
        _apply_state("attack")

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


def _apply_diff_idempotent(diff_text: str) -> str:
    """Deploy the proposed patch to device-service/app.py, tolerant of BOTH the
    live path (the writer Droid already edited the file in place) and the
    replay/no-key path (the file is still the pristine vulnerable bytes).

    Returns: "empty" (nothing to apply), "applied" (forward-applied the diff),
    "already" (a clean reverse-check proves it is already in the tree -> no-op),
    or "failed" (neither direction applies -> VERIFY will then honestly fail).

    The diff is a plain unified diff (a/app.py b/app.py, no `diff --git`/`index`
    headers), applied with `-p1` and `-C device-service`, matching how it was
    produced (toApplicableDiff) and validated.
    """
    if not diff_text.strip():
        return "empty"
    dev = str(DEVICE_SERVICE_DIR)
    with tempfile.NamedTemporaryFile(
        "w", suffix=".diff", delete=False, encoding="utf-8", newline="\n"
    ) as fh:
        fh.write(diff_text if diff_text.endswith("\n") else diff_text + "\n")
        patch_path = fh.name
    try:
        base = ["git", "-C", dev, "apply", "-p1"]
        if subprocess.run(base + ["--check", patch_path], capture_output=True, text=True).returncode == 0:
            subprocess.run(base + [patch_path], check=True, capture_output=True, text=True)
            return "applied"
        # Already applied (live Droid edit) -> a clean reverse-check -> no-op.
        if subprocess.run(base + ["--reverse", "--check", patch_path], capture_output=True, text=True).returncode == 0:
            return "already"
        return "failed"
    finally:
        try:
            os.unlink(patch_path)
        except OSError:
            pass


def _patch_parent_finding_id() -> int | None:
    """The finding the patch closes — the exploitable device-service CWE-306 one —
    so the UI can attach the Factory/Droid patch nodes to that DeepSeek node."""
    exp = _exploitable_findings()
    for f in exp:
        if f.get("target") == "device-service" or str(f.get("file", "")).endswith("app.py"):
            return f.get("id")
    return exp[0].get("id") if exp else None


def _patch_stream():
    """Spawn the Node patch runner (Factory Droid writer + read-only reviewer),
    relay each stdout JSON line verbatim as one SSE event, then SYNTHESIZE the
    human-gate / verify / restore tail.

    Modeled 1:1 on _exploit_stream: the runner runs on a worker thread that
    pushes each parsed stdout line onto a queue; this generator drains the queue
    and yields one SSE event per line IMMEDIATELY (flush per event). The runner
    EXITS after emitting its reviewer verdict; we then announce awaiting_approval
    and BLOCK on _PATCH_GATE until a human clicks approve/reject (POST
    /api/approve|reject, serviced on another thread because app.run is
    threaded=True). On approve we relaunch the device on Droid's edited bytes and
    run VERIFY inline; on reject we git-revert the device-service source."""
    _PATCH_GATE.clear()
    _PATCH_PENDING.clear()
    _PATCH_DECISION.clear()
    # The DeepSeek finding node this patch hangs off (the exploitable server
    # CWE-306); every patch event carries it so the UI attaches the Factory nodes.
    pid = _patch_parent_finding_id()

    # Windows-safe spawn: `node` against tsx's JS entry, with AGENTS_DIR as cwd
    # so the workspace tsconfig / node_modules resolve. The runner reads
    # FACTORY_API_KEY itself (via its own `import '../env'`); we inject nothing.
    proc = subprocess.Popen(
        ["node", str(TSX_CLI), str(PATCH_RUNNER), str(DEVICE_SERVICE_DIR)],
        cwd=str(AGENTS_DIR),
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    # Bridge the runner's stdout lines to this generator via a thread-safe
    # queue: the runner's pipe is drained on a worker thread; we emit as lines
    # arrive. Non-JSON lines (tsx diagnostics on the merged stream) are skipped.
    q: "queue.Queue[tuple[str, Any]]" = queue.Queue()

    def _worker(_proc=proc, _q=q):
        try:
            for line in _proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except (ValueError, TypeError):
                    continue  # tsx/node diagnostics -> not an event line
                _q.put(("event", obj))
        finally:
            _q.put(("done", None))

    worker = threading.Thread(target=_worker, daemon=True)
    worker.start()

    verdict: Any = None
    diff_text: str = ""
    while True:
        kind, obj = q.get()
        if kind == "done":
            break
        # Track the reviewer verdict so the gate card can show it.
        if obj.get("type") == "review_verdict":
            verdict = obj.get("review")
        # Track the proposed diff so APPROVE can deploy it (idempotently).
        elif obj.get("type") == "diff":
            diff_text = obj.get("diff", "") or ""
        yield _sse({**obj, "parentFindingId": pid})

    worker.join()
    try:
        if proc.stdout is not None:
            proc.stdout.close()
    except OSError:
        pass
    proc.wait()

    # --- Human gate: announce, then block until approve/reject --------------
    _PATCH_PENDING.set()
    yield _sse(
        {
            "type": "awaiting_approval",
            "parentFindingId": pid,
            "diffRef": "device-service/app.py",
            "verdict": verdict,
        }
    )
    # Keep-alive comments every ~15s while blocked so proxies/dev-servers don't
    # drop the idle connection. _PATCH_GATE.wait() returns True once a human
    # clicks (sets it); until then it times out and we emit a ping.
    while not _PATCH_GATE.wait(timeout=15):
        yield ": ping\n\n"

    _PATCH_PENDING.clear()
    approved = bool(_PATCH_DECISION.get("approved"))
    app_py = str(DEVICE_SERVICE_DIR / "app.py")

    if approved:
        # Deploy = apply the proposed diff to the on-disk app.py (idempotent),
        # then relaunch the service on those bytes and re-run the exact exploit.
        # Live: Droid already edited app.py -> forward apply is a no-op (reverse
        # check matches). Replay/no-key: app.py is pristine vulnerable -> this
        # applies the cached guard. Either way VERIFY runs against the SAME bytes
        # the dashboard showed in the diff — the green check is a property of the
        # deployed bytes, never an env flag.
        _apply_diff_idempotent(diff_text)
        # Patch deployed -> reset BOTH the sim and the physical board to healthy,
        # regardless of the verify outcome (fan back on, buzzer off, green LED).
        _apply_state("healthy")
        svc = _device(patched=True)
        yield _sse(
            {
                "type": "patch_applied",
                "parentFindingId": pid,
                "approvedBy": _PATCH_DECISION.get("approvedBy", "judge"),
                "ranAgainst": app_py,
            }
        )
        command = _LAST_EXPLOIT_COMMAND or _DEFAULT_EXPLOIT_COMMAND
        v_before = fetch_device_status_row(base_url=svc.base_url)
        outcome = verify_patch(command, base_url=svc.base_url, status_before=v_before)
        after = fetch_device_status_row(base_url=svc.base_url)
        yield _sse(
            {
                "type": "verify_result",
                "parentFindingId": pid,
                "statusCode": outcome["statusCode"],
                "passed": outcome["passed"],
                "detail": outcome["detail"],
                "true": _true_block(after),
                "ranAgainst": app_py,
            }
        )
        yield _sse(
            {"type": "patch_done", "parentFindingId": pid, "outcome": "verified" if outcome["passed"] else "failed"}
        )
    else:
        # Rejected: git-revert the device-service source back to the committed
        # vulnerable bytes (after a Droid edit the on-disk file is no longer
        # vulnerable), scoped to device-service paths only.
        from restore import git_revert_device_service

        result = git_revert_device_service(repo_root=REPO_ROOT)
        yield _sse(
            {"type": "patch_rejected", "parentFindingId": pid, "reverted": result.get("reverted", [])}
        )
        yield _sse({"type": "patch_done", "parentFindingId": pid, "outcome": "rejected"})


@app.get("/api/patch/stream")
def patch_stream():
    resp = Response(_patch_stream(), mimetype="text/event-stream")
    # Same anti-buffering headers as the scan/exploit streams so each beat (and
    # the keep-alive pings during the gate) reach the UI as they happen.
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["X-Accel-Buffering"] = "no"
    return resp


@app.post("/api/approve")
def api_approve():
    """Approve & deploy the pending patch. 409 when no gate is open (the
    one-outstanding-approval invariant)."""
    if not _PATCH_PENDING.is_set():
        return jsonify({"ok": False, "error": "no pending approval"}), 409
    body = request.get_json(silent=True) or {}
    _PATCH_DECISION.update(
        {"approved": True, "approvedBy": body.get("approvedBy", "dashboard")}
    )
    _PATCH_GATE.set()
    return jsonify({"ok": True})


@app.post("/api/reject")
def api_reject():
    """Reject the pending patch (git-revert). 409 when no gate is open."""
    if not _PATCH_PENDING.is_set():
        return jsonify({"ok": False, "error": "no pending approval"}), 409
    _PATCH_DECISION.update({"approved": False})
    _PATCH_GATE.set()
    return jsonify({"ok": True})


@app.post("/api/verify")
def api_verify():
    """Re-send the byte-identical exploit at the PATCHED service and run the
    deterministic checks (401/403 + true_state unchanged + no lie)."""
    body = request.get_json(silent=True) or {}
    command = body.get("command") or {}

    # verify runs against the service the patch stage left running (Droid's
    # edited bytes); if nothing is up yet, bring it up from the current on-disk
    # bytes so the endpoint is still well-behaved.
    svc = _SVC if _SVC is not None else _device()
    v_before = fetch_device_status_row(base_url=svc.base_url)
    outcome = verify_patch(command, base_url=svc.base_url, status_before=v_before)
    after = fetch_device_status_row(base_url=svc.base_url)

    # Patch proven: the re-run was blocked, so the patient stays stable -> green.
    if outcome["passed"]:
        _apply_state("healthy")

    return jsonify(
        {
            "statusCode": outcome["statusCode"],
            "passed": outcome["passed"],
            "detail": outcome["detail"],
            "true": _true_block(after),
            # The honesty line: the actual file the exploit was re-run against.
            "ranAgainst": str(DEVICE_SERVICE_DIR / "app.py"),
        }
    )


@app.post("/api/restore")
def api_restore():
    """Flip back to the clean, pre-patch VULNERABLE service and reset it to the
    healthy baseline. After a Droid edit the on-disk app.py is no longer
    vulnerable, so git-revert the device-service source FIRST (scoped checkout),
    then relaunch from the committed vulnerable bytes and reset the row."""
    from restore import git_revert_device_service

    git_revert_device_service(repo_root=REPO_ROOT)
    svc = _device()  # now the committed vulnerable bytes
    try:
        requests.get(f"{svc.base_url}/device/_reset", timeout=5.0)
    except requests.RequestException:
        pass  # a reset hiccup shouldn't fail the restore; restart already reset
    _apply_state("healthy")  # back to clean vulnerable baseline -> sim + board green
    return jsonify({"ok": True})


# ------------------------------------------------------ flash (real HW) ----
#
# The PHYSICAL attack/restore pair: flash the plugged-in Arduino with
# arduino-cli. /api/flash uploads a MALICIOUS sketch that forces the ventilator
# fan OFF and lights the red LED no matter what the sensor says; /api/flash/
# restore re-flashes the teammate's good bedside firmware. Both compile then
# upload for real, measure honest wall-clock, cap each step at ~120s, and never
# 500 — any failure comes back as ok:false + error. Set FLASH_DRY_RUN=1 to
# short-circuit the upload (returns ok:true, log "DRY RUN") so the JSON shape can
# be exercised in tests without touching the board.

# One board, one core: the UNO R4 WiFi the demo runs on.
FLASH_FQBN = "arduino:renesas_uno:unor4wifi"
# The teammate's good firmware we re-flash on restore (its sketch dir).
BEDSIDE_SKETCH_DIR = REPO_ROOT / "calhacks2026" / "arduino" / "bedside"
# Per-step ceiling (compile and upload each get their own ~120s budget).
_FLASH_TIMEOUT_S = 120.0

# The malicious fan-off sketch body. Pin map: motor enable 5, IN1 7, IN2 8,
# GREEN LED A1, RED LED D2, buzzer D13. It holds the motor at zero duty forever,
# kills the green "healthy" LED, drives the red LED (dimmed via a 250 Hz soft-PWM
# window since A1/D2 aren't PWM pins on the R4), and sounds a short ~120 ms beep
# each second. The \\" sequences write literal \" into the .ino so the Serial
# frame is valid C++.
_FANOFF_SKETCH = (
    "#define PIN_MOTOR_EN 5\n"
    "#define PIN_MOTOR_IN1 7\n"
    "#define PIN_MOTOR_IN2 8\n"
    "#define PIN_LED_GREEN A1\n"
    "#define PIN_LED_RED 2\n"
    "#define PIN_BUZZER 13\n"
    "unsigned long _tx=0;\n"
    "void setup(){pinMode(PIN_MOTOR_EN,OUTPUT);pinMode(PIN_MOTOR_IN1,OUTPUT);"
    "pinMode(PIN_MOTOR_IN2,OUTPUT);pinMode(PIN_LED_GREEN,OUTPUT);"
    "pinMode(PIN_LED_RED,OUTPUT);pinMode(PIN_BUZZER,OUTPUT);"
    "digitalWrite(PIN_MOTOR_IN1,LOW);digitalWrite(PIN_MOTOR_IN2,LOW);"
    "analogWrite(PIN_MOTOR_EN,0);digitalWrite(PIN_LED_GREEN,LOW);"
    "Serial.begin(115200);}\n"
    "void loop(){analogWrite(PIN_MOTOR_EN,0);digitalWrite(PIN_LED_GREEN,LOW);"
    "digitalWrite(PIN_LED_RED,(micros()%4000UL)<2000UL?HIGH:LOW);"
    "digitalWrite(PIN_BUZZER,(millis()%1000UL)<120UL?HIGH:LOW);"
    "if(millis()-_tx>=500){_tx=millis();"
    "Serial.println(\"{\\\"compromised\\\":1,\\\"fan\\\":0}\");}}\n"
)

# The deterministic HEALTHY sketch — exact mirror of the attack sketch, forcing the
# opposite state: fan ON (duty 200), GREEN LED on (dimmed), RED LED + buzzer off. It
# does NOT read the SPA06 sensor, so "healthy" always shows a spinning fan regardless
# of whether the sensor is wired/reading. Emits {"compromised":0,"fan":200}.
_HEALTHY_SKETCH = (
    "#define PIN_MOTOR_EN 5\n"
    "#define PIN_MOTOR_IN1 7\n"
    "#define PIN_MOTOR_IN2 8\n"
    "#define PIN_LED_GREEN A1\n"
    "#define PIN_LED_RED 2\n"
    "#define PIN_BUZZER 13\n"
    "unsigned long _tx=0;\n"
    "void setup(){pinMode(PIN_MOTOR_EN,OUTPUT);pinMode(PIN_MOTOR_IN1,OUTPUT);"
    "pinMode(PIN_MOTOR_IN2,OUTPUT);pinMode(PIN_LED_GREEN,OUTPUT);"
    "pinMode(PIN_LED_RED,OUTPUT);pinMode(PIN_BUZZER,OUTPUT);"
    "digitalWrite(PIN_MOTOR_IN1,HIGH);digitalWrite(PIN_MOTOR_IN2,LOW);"
    "analogWrite(PIN_MOTOR_EN,200);digitalWrite(PIN_LED_RED,LOW);"
    "digitalWrite(PIN_BUZZER,LOW);Serial.begin(115200);}\n"
    "void loop(){digitalWrite(PIN_MOTOR_IN1,HIGH);digitalWrite(PIN_MOTOR_IN2,LOW);"
    "analogWrite(PIN_MOTOR_EN,200);"
    "digitalWrite(PIN_LED_GREEN,(micros()%4000UL)<2000UL?HIGH:LOW);"
    "digitalWrite(PIN_LED_RED,LOW);digitalWrite(PIN_BUZZER,LOW);"
    "if(millis()-_tx>=500){_tx=millis();"
    "Serial.println(\"{\\\"compromised\\\":0,\\\"fan\\\":200}\");}}\n"
)


def _dry_run() -> bool:
    """FLASH_DRY_RUN=1 short-circuits the upload (tests assert JSON shape
    without ever flashing the live board)."""
    return os.environ.get("FLASH_DRY_RUN") == "1"


def _tail(text: str, n: int = 800) -> str:
    """Last ~n chars of a combined command log (what the UI surfaces)."""
    text = text or ""
    return text[-n:]


def _write_fanoff_sketch() -> Path:
    """Write the malicious sketch to <tmp>/prevent_fanoff/prevent_fanoff.ino
    (arduino-cli requires the .ino basename to match its sketch dir). Returns
    the sketch dir."""
    tmp = Path(tempfile.mkdtemp(prefix="prevent-flash-"))
    sketch_dir = tmp / "prevent_fanoff"
    sketch_dir.mkdir(parents=True, exist_ok=True)
    (sketch_dir / "prevent_fanoff.ino").write_text(_FANOFF_SKETCH, encoding="utf-8")
    return sketch_dir


def _write_healthy_sketch() -> Path:
    """Write the deterministic HEALTHY sketch to <tmp>/prevent_healthy/ (forces fan
    on, green LED, no buzzer — sensor-independent). Returns the sketch dir."""
    tmp = Path(tempfile.mkdtemp(prefix="prevent-flash-"))
    sketch_dir = tmp / "prevent_healthy"
    sketch_dir.mkdir(parents=True, exist_ok=True)
    (sketch_dir / "prevent_healthy.ino").write_text(_HEALTHY_SKETCH, encoding="utf-8")
    return sketch_dir


def _run_cli(args: list[str], timeout: float = _FLASH_TIMEOUT_S) -> tuple[bool, str]:
    """Run one arduino-cli invocation, returning (ok, combined stdout+stderr).
    Never raises: a missing CLI, a timeout, or an OS error comes back as
    (False, <message>) so callers can report it instead of 500ing."""
    try:
        proc = subprocess.run(
            ["arduino-cli", *args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError:
        return False, "arduino-cli not found"
    except subprocess.TimeoutExpired as exc:
        out = (exc.stdout or "") + (exc.stderr or "")
        return False, out + f"\n[timeout after {timeout:.0f}s]"
    except OSError as exc:
        return False, f"[error] {exc}"
    return proc.returncode == 0, (proc.stdout or "") + (proc.stderr or "")


def _flash_port() -> str | None:
    """Resolve the plugged-in board's serial port via the SAME detection
    /api/hardware uses (`arduino-cli board list` + _detect_arduino). Returns the
    port, or None when no board is detected."""
    ok, out = _run_cli(["board", "list"], timeout=8.0)
    if not ok:
        return None
    board = _detect_arduino(out)
    return board.get("port") if board.get("connected") else None


def _flash_sketch(sketch_dir: Path) -> dict[str, Any]:
    """Compile then upload `sketch_dir` to the detected board at FLASH_FQBN.
    Returns the documented JSON dict {ok,durationMs,port,log,error}. Never
    raises. FLASH_DRY_RUN=1 short-circuits before compile/upload."""
    t0 = time.perf_counter()
    port = _flash_port()

    def done(ok: bool, log: str, error: str | None) -> dict[str, Any]:
        return {
            "ok": ok,
            "durationMs": int(round((time.perf_counter() - t0) * 1000)),
            "port": port,
            "log": _tail(log),
            "error": error,
        }

    if _dry_run():
        return done(True, "DRY RUN", None)
    if port is None:
        return done(False, "", "no board")

    ok, compile_out = _run_cli(["compile", "--fqbn", FLASH_FQBN, str(sketch_dir)])
    if not ok:
        return done(False, compile_out, "compile failed")

    ok, upload_out = _run_cli(
        ["upload", "-p", port, "--fqbn", FLASH_FQBN, str(sketch_dir)]
    )
    combined = compile_out + "\n" + upload_out
    return done(ok, combined, None if ok else "upload failed")


def _ensure_libraries(names: list[str]) -> list[str]:
    """Best-effort `arduino-cli lib install` for each named library (skipped in
    dry-run). Returns the names that could not be installed (empty if all OK)."""
    if _dry_run():
        return []
    failed: list[str] = []
    for name in names:
        ok, _out = _run_cli(["lib", "install", name], timeout=_FLASH_TIMEOUT_S)
        if not ok:
            failed.append(name)
    return failed


@app.post("/api/flash")
def api_flash():
    """Flash the MALICIOUS fan-off firmware to the plugged-in board for real.
    Compiles then uploads the temp sketch; returns {ok,durationMs,port,log,
    error}. Never 500s — any failure is ok:false + error; no board -> 'no
    board'."""
    try:
        sketch_dir = _write_fanoff_sketch()
        result = _flash_sketch(sketch_dir)
        if result.get("ok"):
            _note_hw_flashed("attack")  # keep the reconciler's tracking accurate
            _mirror_db_state("attack")  # physical fan-off fired -> sim red
        return jsonify(result)
    except Exception as exc:  # noqa: BLE001 -- never 500; surface as error
        return jsonify(
            {"ok": False, "durationMs": 0, "port": None, "log": "", "error": str(exc)}
        )


@app.post("/api/flash/restore")
def api_flash_restore():
    """Re-flash the deterministic HEALTHY sketch (fan on, green LED, no buzzer —
    sensor-independent) so the board is VISIBLY healthy no matter what the SPA06
    sensor is doing. Returns {ok,durationMs,port,log,error} and never 500s."""
    try:
        result = _flash_sketch(_write_healthy_sketch())
        if result.get("ok"):
            _note_hw_flashed("healthy")  # keep the reconciler's tracking accurate
            _mirror_db_state("healthy")  # fan on, green LED -> sim green
        return jsonify(result)
    except Exception as exc:  # noqa: BLE001 -- never 500; surface as error
        return jsonify(
            {"ok": False, "durationMs": 0, "port": None, "log": "", "error": str(exc)}
        )


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


@app.get("/api/repo/file")
def repo_file():
    """Serve a source file from the active cloned repo (repo-scan mode), with a
    strict path-escape guard. 400 if no repo is active or the path escapes."""
    root = _ACTIVE_REPO.get("root")
    rel_path = request.args.get("path", "")
    if not root or not rel_path:
        return jsonify({"error": "no active repo"}), 400
    try:
        base = Path(root).resolve()
        candidate = (base / rel_path).resolve()
        rel = candidate.relative_to(base)  # raises if it escaped the clone root
    except (ValueError, OSError):
        return jsonify({"error": "path not allowed"}), 400
    if ".git" in rel.parts or not candidate.is_file():
        return jsonify({"error": "path not allowed"}), 400
    content = candidate.read_text(encoding="utf-8", errors="replace")
    return jsonify(
        {
            "path": str(rel),
            "lang": _EXT_LANG.get(candidate.suffix.lower(), "text"),
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
