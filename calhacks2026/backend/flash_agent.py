"""Firmware delivery: stage the generated sketch, compile it with
arduino-cli, and push it to the board — or fake all of that when the bench
has no hardware attached.

The real path is expressed as a small sequential pipeline of async steps, so
the stage → compile → upload ordering is the shape of the code rather than a
comment. A failed step short-circuits the rest of the pipeline.
"""

import asyncio
import os
import shutil
import tempfile
from dataclasses import dataclass, field
from typing import Awaitable, Callable, List, Optional, Tuple


@dataclass
class FlashReport:
    ok: bool
    note: str
    transcript: str


@dataclass
class _BurnState:
    """Mutable state threaded through the real burn pipeline."""

    source: str
    sketch_name: str
    workspace: str = ""
    sketch_dir: str = ""
    compile_log: str = ""
    failed: Optional[FlashReport] = None


Step = Callable[[_BurnState], Awaitable[None]]


class SketchFlasher:
    """Compile-and-upload driver for Arduino sketches via arduino-cli."""

    COMPILE_DELAY_S = 1.4
    UPLOAD_DELAY_S = 0.6

    def __init__(
        self,
        port: str = "/dev/cu.usbmodemE83DC1E348A42",
        fqbn: str = "arduino:renesas_uno:unor4wifi",
        simulate: bool = True,
    ):
        self.port = port
        self.fqbn = fqbn
        self.simulate = simulate

    async def deploy(
        self, source: str, sketch_name: str = "calhacks_patch"
    ) -> FlashReport:
        if self.simulate:
            return await self._rehearse(source)
        return await self._burn(source, sketch_name)

    async def _rehearse(self, source: str) -> FlashReport:
        for pause in (self.COMPILE_DELAY_S, self.UPLOAD_DELAY_S):
            await asyncio.sleep(pause)
        return FlashReport(
            ok=True,
            note="[SIMULATED] Firmware compiled and flashed successfully",
            transcript="\n".join(
                [
                    f"Sketch source: {len(source.encode())} bytes",
                    "Sketch uses 5,234 bytes (16%) of program storage space",
                    "Global variables use 312 bytes (15%) of dynamic memory",
                    "avrdude: 5234 bytes of flash written",
                    "avrdude: verifying flash memory against patch.hex",
                    "avrdude done.  Thank you.",
                ]
            ),
        )

    async def _burn(self, source: str, sketch_name: str) -> FlashReport:
        state = _BurnState(source=source, sketch_name=sketch_name)
        steps: List[Step] = [self._stage, self._compile, self._upload]
        try:
            for step in steps:
                await step(state)
                if state.failed is not None:
                    return state.failed
            return state.failed or self._report_from(state)
        finally:
            if state.workspace:
                shutil.rmtree(state.workspace, ignore_errors=True)

    async def _stage(self, state: _BurnState) -> None:
        state.workspace = tempfile.mkdtemp(prefix=f"calhacks_{state.sketch_name}_")
        state.sketch_dir = os.path.join(state.workspace, state.sketch_name)
        os.makedirs(state.sketch_dir, exist_ok=True)
        sketch_path = os.path.join(state.sketch_dir, f"{state.sketch_name}.ino")
        with open(sketch_path, "w") as fh:
            fh.write(state.source)

    async def _compile(self, state: _BurnState) -> None:
        rc, state.compile_log = await self._run_cli("compile", state.sketch_dir)
        if rc != 0:
            state.failed = FlashReport(False, "Compilation failed", state.compile_log)

    async def _upload(self, state: _BurnState) -> None:
        rc, upload_log = await self._run_cli(
            "upload",
            state.sketch_dir,
            "--port",
            self.port,
        )
        state.failed = FlashReport(
            ok=rc == 0,
            note="Firmware flashed successfully" if rc == 0 else "Upload failed",
            transcript=state.compile_log + "\n" + upload_log,
        )

    def _report_from(self, state: _BurnState) -> FlashReport:
        return FlashReport(False, "Unknown flash pipeline state", state.compile_log)

    async def _run_cli(
        self, verb: str, sketch_dir: str, *extra: str
    ) -> Tuple[int, str]:
        proc = await asyncio.create_subprocess_exec(
            "arduino-cli",
            verb,
            "--fqbn",
            self.fqbn,
            *extra,
            sketch_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        out, _ = await proc.communicate()
        return proc.returncode, out.decode(errors="replace")
