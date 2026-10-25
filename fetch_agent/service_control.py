"""Keep the vulnerable/patched device-service WARM on a fixed port.

A Python port of `agents/src/security/deviceService.ts`. The naive loop restarts
the Flask app three times (each a ~15s readiness wait); for the ASI:One demo we
instead start it ONCE in vulnerable mode so the live `GET /device/status`
round-trips answer instantly during DELIVER, and do a SINGLE restart-to-patched
on APPROVE (masked by the human-gate pause).

Readiness probes `GET /device/_schema` and requires
`commandEndpoint.authRequired == patched`: a bare "is the port answering" check
could resolve against a STALE process (e.g. a crashed prior run still holding
the port), so VERIFY might run against the wrong build. Matching the advertised
mode proves it is the process we meant.

Sync on purpose (subprocess + a short blocking probe loop); the async pipeline
calls these via `asyncio.to_thread(...)` so the agent event loop never blocks.
"""

from __future__ import annotations

import subprocess
import time
from typing import Optional

import requests

from .constants import DEVICE_BASE_URL, DEVICE_HOST, DEVICE_PORT, DEVICE_SERVICE_DIR, DEVICE_TOKEN, PYTHON


class DeviceServiceController:
    """One controller per agent process; always `stop()` in a finally."""

    def __init__(self, base_url: str = DEVICE_BASE_URL) -> None:
        self.base_url = base_url.rstrip("/")
        self._proc: Optional[subprocess.Popen] = None
        self._mode: Optional[str] = None

    def start(self, *, patched: bool, timeout: float = 15.0) -> None:
        """(Re)start the service in the requested mode and block until it answers
        in the CORRECT mode, or raise on timeout/spawn failure."""
        self.stop()
        env = {
            "DEVICE_SERVICE_HOST": DEVICE_HOST,
            "DEVICE_SERVICE_PORT": str(DEVICE_PORT),
            "DEVICE_SERVICE_PATCHED": "1" if patched else "0",
            "DEVICE_SERVICE_TOKEN": DEVICE_TOKEN if patched else "",
            # UTF-8 pipes/files on Windows (avoid cp1252 crashes in anything it shells to).
            "PYTHONUTF8": "1",
            "PYTHONIOENCODING": "utf-8",
        }
        import os

        full_env = {**os.environ, **env}
        self._mode = "patched" if patched else "vulnerable"
        self._proc = subprocess.Popen(
            [PYTHON, "app.py"],
            cwd=str(DEVICE_SERVICE_DIR),
            env=full_env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        schema_url = f"{self.base_url}/device/_schema"
        deadline = time.time() + timeout
        last_err = ""
        while time.time() < deadline:
            # Early-exit if the child died (e.g. bad interpreter, port in use).
            if self._proc.poll() is not None:
                code = self._proc.returncode
                self._proc = None
                raise RuntimeError(f"device-service ({self._mode}) exited early (code {code})")
            try:
                res = requests.get(schema_url, timeout=1.0)
                if res.ok:
                    body = res.json()
                    auth_required = bool((body.get("commandEndpoint") or {}).get("authRequired"))
                    if auth_required == patched:
                        return
                    last_err = (
                        f"service reports authRequired={auth_required}, wanted {patched} "
                        f"(a stale service may hold port {DEVICE_PORT})"
                    )
                else:
                    last_err = f"HTTP {res.status_code}"
            except requests.RequestException as exc:
                last_err = str(exc)
            time.sleep(0.15)
        self.stop()
        raise TimeoutError(f"device-service ({self._mode}) not ready in {timeout}s: {last_err}")

    def stop(self) -> None:
        proc = self._proc
        self._proc = None
        self._mode = None
        if proc is None or proc.poll() is not None:
            return
        proc.terminate()
        try:
            proc.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            proc.kill()
            try:
                proc.wait(timeout=3.0)
            except subprocess.TimeoutExpired:
                pass

    def __enter__(self) -> "DeviceServiceController":
        return self

    def __exit__(self, *exc) -> None:
        self.stop()
