"""Telemetry sources for the bridge.

`SensorSimulator` fabricates Arduino-grade telemetry (parameterised spoofing
plus virtual-sensor substitution) for bench demos; `SerialTelemetrySource`
consumes newline-delimited JSON from a real Arduino over USB.
"""

import asyncio
import json
import math
import random
import threading
import time
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional

ChannelName = str
SPOOF_STYLES = ("flatline", "spike", "drift")


@dataclass
class SensorReading:
    timestamp: float
    temperature: float
    pressure: float
    fan: float = 0.0
    alarm: int = 0

    def get(self, key: str) -> float:
        return getattr(self, key)


def _sine(
    base: float, amp: float, freq: float, noise: float
) -> Callable[[float], float]:
    def at(elapsed: float) -> float:
        return base + amp * math.sin(elapsed * freq) + random.gauss(0, noise)

    return at


_BASE_SIGNALS: Dict[str, Callable[[float], float]] = {
    "temperature": _sine(24.5, 1.5, 0.2, 0.3),
    "pressure": _sine(1013.2, 5.0, 0.3, 0.8),
}
_QUANTIZE = {
    "temperature": 3,
    "pressure": 3,
    "fan": 0,
}


def _fan_duty(pressure: float) -> float:
    duty = 170.0 + (pressure - 980.0) * (40.0 / 60.0)
    if duty < 170.0:
        return 170.0
    if duty > 210.0:
        return 210.0
    return duty


@dataclass
class SpoofProfile:
    """One active spoofing campaign against a channel."""

    target: ChannelName
    kind: str
    magnitude: float = 1.0
    engaged_at: float = 0.0
    anchor: float = 0.0


@dataclass
class ShadowChannel:
    """A fitted substitute: intercept + Σ coef_i · reading.get(basis_i)."""

    target: ChannelName
    basis: List[str]
    intercept: float
    coefficients: List[float]


def _distortion(profile: SpoofProfile, natural: float, since: float) -> float:
    """Map a spoof kind onto a replacement value for the latched channel."""
    if profile.kind == "spike":
        transient = profile.magnitude * 4.0 * math.sin(since * 6.0)
        return natural + transient + random.gauss(0, 0.05)
    if profile.kind == "drift":
        return natural + profile.magnitude * 0.6 * since
    return profile.anchor + random.gauss(0, 0.01 * profile.magnitude)


class SensorSimulator:
    """Fabricates telemetry with optional spoof injection and shadow healing.

    Samples flow through three stages — base waveforms, spoof distortion,
    shadow substitution — each replacing one named channel. The shadow runs
    after the spoof, which is the point of the demo: the patch recomputes the
    compromised channel from the survivors and the attack stops mattering.
    """

    def __init__(self):
        self._booted = time.time()
        self._spoof: Optional[SpoofProfile] = None
        self._shadow: Optional[ShadowChannel] = None

    def engage_spoof(
        self,
        target: ChannelName = "temperature",
        kind: str = "flatline",
        magnitude: float = 1.0,
    ) -> SpoofProfile:
        if kind not in SPOOF_STYLES:
            kind = "flatline"
        if target not in ("temperature", "pressure"):
            target = "temperature"
        natural = self._base_values(time.time() - self._booted)[target]
        self._spoof = SpoofProfile(target, kind, magnitude, time.time(), natural)
        return self._spoof

    def disengage_spoof(self) -> None:
        self._spoof = None

    @property
    def spoof(self) -> Optional[SpoofProfile]:
        return self._spoof

    @property
    def spoof_engaged(self) -> bool:
        return self._spoof is not None

    def install_shadow(
        self,
        target: ChannelName,
        basis: List[str],
        intercept: float,
        coefficients: List[float],
    ) -> ShadowChannel:
        self._shadow = ShadowChannel(
            target=target,
            basis=list(basis),
            intercept=float(intercept),
            coefficients=[float(c) for c in coefficients],
        )
        return self._shadow

    def remove_shadow(self) -> None:
        self._shadow = None

    @property
    def shadow(self) -> Optional[ShadowChannel]:
        return self._shadow

    def _base_values(self, elapsed: float) -> Dict[str, float]:
        return {name: fn(elapsed) for name, fn in _BASE_SIGNALS.items()}

    async def next_sample(self) -> SensorReading:
        await asyncio.sleep(0.1)
        now = time.time()
        values = self._base_values(now - self._booted)
        if self._spoof is not None:
            sp = self._spoof
            values[sp.target] = _distortion(sp, values[sp.target], now - sp.engaged_at)
        if self._shadow is not None:
            sh = self._shadow
            values[sh.target] = sh.intercept + sum(
                coef * values[key] for coef, key in zip(sh.coefficients, sh.basis)
            )
        pressure = values["pressure"]
        return SensorReading(
            timestamp=now,
            temperature=round(values["temperature"], _QUANTIZE["temperature"]),
            pressure=round(pressure, _QUANTIZE["pressure"]),
            fan=round(_fan_duty(pressure), _QUANTIZE["fan"]),
            alarm=1 if self._spoof is not None else 0,
        )


class SerialTelemetrySource:
    """Streams JSON telemetry frames from an Arduino over USB serial.

    A blocking pyserial loop runs on a daemon thread and hands readings to the
    async side through an asyncio.Queue. The pyserial-asyncio wrapper is
    deliberately avoided: the Arduino's DTR pulse on port-open briefly drops
    the USB-CDC link, which its StreamReader latches as EOF — every readline()
    after that returns b'' immediately and hot-spins the event loop.
    """

    RECONNECT_BACKOFF_S = 0.5
    _FRAME_MAP = (
        ("temp_c", "temperature"),
        ("press", "pressure"),
        ("fan", "fan"),
        ("alarm", "alarm"),
    )

    def __init__(self, port: str = "/dev/cu.usbmodemE83DC1E348A42", baud: int = 115200):
        self.port = port
        self.baud = baud
        self._inbox: "asyncio.Queue[SensorReading]" = asyncio.Queue(maxsize=200)
        self._worker: Optional[threading.Thread] = None

    def _decode(self, line: str) -> Optional[SensorReading]:
        if not line.startswith("{"):
            return None
        try:
            frame = json.loads(line)
        except json.JSONDecodeError:
            return None
        fields = {"timestamp": time.time()}
        for wire_key, attr in self._FRAME_MAP:
            if wire_key not in frame:
                if wire_key in ("fan", "alarm"):
                    continue
                return None
            try:
                fields[attr] = (
                    int(frame[wire_key]) if attr == "alarm" else float(frame[wire_key])
                )
            except (TypeError, ValueError):
                return None
        return SensorReading(**fields)

    def _spawn_worker(self) -> None:
        if self._worker is not None and self._worker.is_alive():
            return
        self._worker = threading.Thread(
            target=self._pump,
            args=(asyncio.get_running_loop(),),
            name="serial-telemetry-pump",
            daemon=True,
        )
        self._worker.start()

    def _pump(self, loop: asyncio.AbstractEventLoop) -> None:
        import serial

        while True:
            try:
                port = serial.Serial(self.port, self.baud, timeout=1)
            except Exception:
                time.sleep(1.0)
                continue
            try:
                self._drain(port, loop)
            except Exception:
                pass
            finally:
                try:
                    port.close()
                except Exception:
                    pass
                time.sleep(self.RECONNECT_BACKOFF_S)

    def _drain(self, port, loop: asyncio.AbstractEventLoop) -> None:
        while True:
            raw = port.readline()
            if not raw:
                continue
            reading = self._decode(raw.decode(errors="replace").strip())
            if reading is not None:
                asyncio.run_coroutine_threadsafe(self._inbox.put(reading), loop)

    async def next_sample(self) -> SensorReading:
        self._spawn_worker()
        return await self._inbox.get()
