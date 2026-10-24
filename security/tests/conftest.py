"""Shared pytest fixtures for the PreVent security suite (Dev 2).

Launches the real device-service subprocess (vulnerable or patched) on an
ephemeral free port with an isolated temp row file, and tears it down. Tests
talk to it over HTTP exactly as the pipeline does — no mocks of the thing under
test.
"""

from __future__ import annotations

import socket
import sys
from pathlib import Path

import pytest

SECURITY_DIR = Path(__file__).resolve().parents[1]
# Make the stage modules importable by their package paths (loop, deliver,
# verify, scan.*, ground.*, generate.*, restore).
sys.path.insert(0, str(SECURITY_DIR))

from loop import DeviceService  # noqa: E402


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def service_factory(tmp_path):
    """Yields start(patched=bool) -> base_url. Guarantees teardown of every
    service it starts (only one alive at a time, mirroring the loop)."""
    started: list[DeviceService] = []
    row_file = tmp_path / "device_row.json"

    def start(*, patched: bool) -> str:
        for svc in started:
            svc.stop()
        svc = DeviceService(port=free_port(), row_file=row_file, log_dir=tmp_path)
        svc.start(patched=patched)
        started.append(svc)
        return svc.base_url

    yield start

    for svc in started:
        svc.stop()


@pytest.fixture
def vulnerable_url(service_factory) -> str:
    return service_factory(patched=False)


@pytest.fixture
def patched_url(service_factory) -> str:
    return service_factory(patched=True)
