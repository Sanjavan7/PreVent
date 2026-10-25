"""Offline smoke test — runs the FULL loop with a print-based `send`, no uagents
and no ASI:One. Proves the async driver + warm device-service + real stage_api
work end-to-end (GROUND->...->DELIVER, simulated APPROVE, VERIFY->RESTORE).

Run from the repo root with the project venv:
    ./.venv/Scripts/python.exe -m fetch_agent._smoke
"""

from __future__ import annotations

import asyncio
import sys

# Windows consoles default to cp1252; the agent sends over a UTF-8 wire, so make
# the test's stdout match rather than crash on any non-ASCII char.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from .pipeline import run_after_approval, run_to_gate
from .service_control import DeviceServiceController


async def _send(text: str) -> None:
    print(text, flush=True)


async def main() -> None:
    ctrl = DeviceServiceController()
    try:
        print("\n========== RUN TO GATE ==========\n", flush=True)
        state = await run_to_gate(_send, run_id="r-smoke", controller=ctrl)
        print("\n---- GATE STATE ----", dict(state), flush=True)

        print("\n========== (simulated APPROVE) ==========\n", flush=True)
        result = await run_after_approval(_send, state, controller=ctrl)
        print("\n---- RESULT ----", result, flush=True)

        ok = bool(result.get("verified"))
        print(f"\n========== SMOKE {'PASS' if ok else 'FAIL'} ==========", flush=True)
    finally:
        ctrl.stop()


if __name__ == "__main__":
    asyncio.run(main())
