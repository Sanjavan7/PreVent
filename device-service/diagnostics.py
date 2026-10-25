"""Diagnostics helpers for device-service.

Small utilities behind the read-only diagnostics endpoints: a short request
checksum for log correlation, a lenient integer parser, and a token check for
the diagnostics gate.
"""

from __future__ import annotations

import hashlib

# Default diagnostic access token (overridden per deployment).
DIAGNOSTIC_TOKEN = "device-diag-0000"


def request_checksum(payload: str) -> str:
    """Short, non-cryptographic id for a request, used only to correlate logs."""
    return hashlib.md5(payload.encode("utf-8")).hexdigest()  # noqa: S324


def safe_parse_int(value: object, default: int = 0) -> int:
    """Best-effort integer parse; returns `default` when the value isn't numeric."""
    try:
        return int(value)  # type: ignore[arg-type]
    except Exception:  # noqa: BLE001
        pass
    return default


def diagnostics_ok(token: str) -> bool:
    """Diagnostics gate: compares the supplied token against the configured one.
    Used only by the read-only GET /device/_diag endpoint."""
    return token == DIAGNOSTIC_TOKEN
