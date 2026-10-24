"""RESTORE stage — PreVent security pipeline (Dev 2).

Puts everything back to the clean, pre-patch state between judges so the full
find -> exploit -> patch -> verify loop can be re-run from scratch (10+ times
over the roving window):

  1. git-revert the device-service source to its committed (vulnerable) state,
     SCOPED to device-service paths only so it never touches other packages'
     work. This undoes any file edits the Factory Droid patch stage made.
  2. reset the device to the healthy baseline (fan on, true vitals, alarm armed).

The headless loop (loop.py) reaches the pre-patch state by restarting the
service in vulnerable mode (no file edits to revert), so it calls
reset_device_healthy() and treats the git revert as a no-op. git_revert_device_
service() is here for the real Droid integration (Dev 1), which edits app.py.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

import requests

REPO_ROOT = Path(__file__).resolve().parents[1]
DEVICE_SERVICE_DIR = REPO_ROOT / "device-service"
# Only ever revert these tracked files — never a blanket `git checkout -- .`,
# which could wipe a teammate's or your own uncommitted work elsewhere.
DEVICE_SERVICE_TRACKED = ["device-service/app.py", "device-service/diagnostics.py"]


def git_revert_device_service(*, repo_root: Path = REPO_ROOT, dry_run: bool = False) -> dict[str, Any]:
    """`git checkout -- <device-service files>` scoped to device-service only.

    Reverts the patch stage's edits back to the committed vulnerable state.
    Returns a summary; never raises on a non-fatal git error (logs it)."""
    # Which of the scoped files are actually modified right now?
    try:
        status = subprocess.run(
            ["git", "status", "--porcelain", "--", *DEVICE_SERVICE_TRACKED],
            cwd=str(repo_root), capture_output=True, text=True, timeout=15,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return {"reverted": [], "error": f"git status failed: {exc}"}

    modified = [line[3:] for line in status.stdout.splitlines() if line.strip()]
    if not modified:
        return {"reverted": [], "note": "device-service already clean (nothing to revert)."}

    if dry_run:
        return {"reverted": [], "wouldRevert": modified, "note": "dry-run"}

    try:
        subprocess.run(
            ["git", "checkout", "--", *DEVICE_SERVICE_TRACKED],
            cwd=str(repo_root), capture_output=True, text=True, timeout=15, check=True,
        )
    except subprocess.CalledProcessError as exc:
        return {"reverted": [], "error": f"git checkout failed: {exc.stderr}"}
    return {"reverted": modified}


def reset_device_healthy(*, base_url: str, timeout: float = 5.0) -> dict[str, Any]:
    """Hit the device-service internal reset hook so the shared row flips back
    to healthy. Returns the healthy row, or an error dict if unreachable."""
    try:
        resp = requests.get(f"{base_url}/device/_reset", timeout=timeout)
        resp.raise_for_status()
        return {"ok": True, "row": resp.json()}
    except requests.RequestException as exc:
        return {"ok": False, "error": str(exc)}


def restore(*, base_url: str, revert_git: bool = False, repo_root: Path = REPO_ROOT) -> dict[str, Any]:
    """Full RESTORE: (optionally) revert device-service source, then reset the
    device to healthy. The loop passes revert_git=False (flag-based patch);
    the Droid path passes revert_git=True to undo real file edits."""
    result: dict[str, Any] = {}
    if revert_git:
        result["git"] = git_revert_device_service(repo_root=repo_root)
    result["device"] = reset_device_healthy(base_url=base_url)
    return result


if __name__ == "__main__":
    import json
    import os

    base = os.environ.get("DEVICE_SERVICE_URL", "http://127.0.0.1:8071")
    print(json.dumps(restore(base_url=base, revert_git="--revert-git" in sys.argv), indent=2))
