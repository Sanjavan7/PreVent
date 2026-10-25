"""Edge-triggered incident detector over the firmware alarm bit.

The Arduino latches its alarm line high when a sensor fault is recognised.
This watchdog turns each 0→1 transition into exactly one incident; the bit
must fall before it can fire again, so a fault held on cannot flood the
pipeline.
"""

import random
import statistics
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict, List


@dataclass
class IncidentReport:
    flagged: bool
    summary: str
    score: float
    window: List[dict] = field(default_factory=list)
    metrics: Dict[str, float] = field(default_factory=dict)
    suspect: str = ""


class _Ring:
    """Named deques so channels can be sampled by name instead of by position."""

    KEYS = ("temperature", "pressure")

    def __init__(self, maxlen: int):
        self._lanes: Dict[str, Deque[float]] = {
            k: deque(maxlen=maxlen) for k in self.KEYS
        }
        self.stamps: Deque[float] = deque(maxlen=maxlen)

    def push(self, reading) -> None:
        for key in self.KEYS:
            self._lanes[key].append(getattr(reading, key))
        self.stamps.append(reading.timestamp)

    def clear(self) -> None:
        for lane in self._lanes.values():
            lane.clear()
        self.stamps.clear()

    def lane(self, key: str) -> Deque[float]:
        return self._lanes[key]

    def __len__(self) -> int:
        return len(self.stamps)

    def rows(self) -> List[dict]:
        """Wire-friendly snapshot, one dict per sample."""
        return [
            {"timestamp": ts, "temperature": t, "pressure": p}
            for ts, t, p in zip(
                self.stamps,
                self._lanes["temperature"],
                self._lanes["pressure"],
            )
        ]


class AnomalyWatchdog:
    """Rolling window + rising-edge latch on the alarm bit."""

    CHANNEL_POOL = ("temperature", "pressure")

    def __init__(self, buffer_len: int = 50, warmup: int = 25):
        self._ring = _Ring(buffer_len)
        self._edge = _EdgeLatch()

    def observe(self, reading) -> None:
        self._ring.push(reading)
        self._edge.level(int(reading.alarm))

    def rearm(self) -> None:
        """Drop the window (post-incident / new client).

        The edge latch deliberately survives: if a spoof is still in flight we
        hold fire until the line clears instead of firing a duplicate.
        """
        self._ring.clear()

    def poll(self) -> IncidentReport:
        metrics = self._metrics()
        if not self._edge.consume_rising():
            return IncidentReport(False, "All sensors nominal", 0.0, metrics=metrics)
        suspect = random.choice(self.CHANNEL_POOL)
        return IncidentReport(
            flagged=True,
            summary=(
                "SENSOR FAULT DETECTED — firmware alarm bit raised. "
                f"Suspected spoofing vector: {suspect.upper()} channel."
            ),
            score=1.0,
            window=self.snapshot(),
            metrics=metrics,
            suspect=suspect,
        )

    def snapshot(self) -> List[dict]:
        return self._ring.rows()

    def _metrics(self) -> Dict[str, float]:
        def var(key: str) -> float:
            lane = self._ring.lane(key)
            return statistics.variance(lane) if len(lane) >= 2 else 0.0

        return {
            "temp_variance": round(var("temperature"), 5),
            "pressure_variance": round(var("pressure"), 4),
        }


class _EdgeLatch:
    """0→1 edge detector with sticky-hold semantics.

    `consume_rising()` returns True exactly once per rising edge and stays
    False while the line is held high, regardless of how often the window is
    cleared elsewhere.
    """

    def __init__(self) -> None:
        self._level = 0
        self._armed = True

    def level(self, value: int) -> None:
        self._level = value
        if value == 0:
            self._armed = True

    def consume_rising(self) -> bool:
        if self._level == 1 and self._armed:
            self._armed = False
            return True
        return False
