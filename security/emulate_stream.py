"""emulate_stream — turn the device_status row into serial STATE frames.

Converts the shared `device_status` row (the one device-service writes to
PREVENT_DEVICE_ROW_FILE / exposes at GET /device/_truth) into the serial
`STATE,...` frames a board/visualizer consumes, so the security loop can drive a
downstream consumer with NO board and NO realtime backend. Pipe this script's
stdout into the consumer; the human-readable board render goes to stderr.

This is a faithful Python port of `contracts/src/serial.ts`
(`deviceStatusToState` + `encodeState`) — the ONE mapping from the source-of-truth
row to the wire:

    STATE,fan=<0|1>,rate=<0-255>,hr=<int>,spo2=<int>,alarm=<0|1>,rgb=<0|1|2>\\n

    fan   = 1 if fanOn else 0
    rate  = 180 if fanOn else 0
    hr    = reportedHr          (the DISPLAYED, possibly-lying heart rate)
    spo2  = reportedSpo2
    alarm = 1 if alarmActive else 0
    rgb   = 1 if compromised else 0      # 0=green (healthy) 1=red (compromised)
                                         # 2=amber (patching) is set by the
                                         # orchestrator, not derivable from the row

Sources (pick one via a flag; falls back to $PREVENT_DEVICE_ROW_FILE):
    --row-file <path>   read the JSON row file device-service writes
    --base-url <url>    poll GET <url>/device/_truth

Modes:
    --once              emit one STATE frame from the current row, then exit
    --watch (default)   poll the source ~4x/sec, emit a STATE frame to stdout
                        whenever the row changes (and log a board render to stderr)

A missing or partial row is handled gracefully: present fields are used, absent
ones fall back to the healthy baseline; a completely unreadable source emits no
frame (and, in --once, exits non-zero).

Usage:
  python -m security.emulate_stream --row-file /tmp/row.json --once
  python -m security.emulate_stream --base-url http://127.0.0.1:8071 | <consumer>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable, Optional, TextIO, TypedDict

TRUTH_PATH = "/device/_truth"
DEFAULT_INTERVAL = 0.25  # ~4 Hz

# Healthy-baseline defaults (contracts/src/mocks.ts DEVICE_HEALTHY) used to fill
# any field a partial row omits, so the mapping never KeyErrors.
_DEFAULTS = {"fanOn": True, "reportedHr": 72, "reportedSpo2": 98, "alarmActive": False, "compromised": False}


class StateLine(TypedDict):
    fan: int  # 0 | 1
    rate: int  # 0..255
    hr: int
    spo2: int
    alarm: int  # 0 | 1
    rgb: int  # 0 green | 1 red | 2 amber


def device_status_to_state(row: dict[str, Any]) -> StateLine:
    """Port of contracts/src/serial.ts `deviceStatusToState`. fan follows TRUE
    state; the displayed vitals are the REPORTED (possibly-lying) values. Missing
    fields fall back to the healthy baseline so a partial row still maps."""
    row = row or {}
    fan_on = bool(row.get("fanOn", _DEFAULTS["fanOn"]))
    return {
        "fan": 1 if fan_on else 0,
        "rate": 180 if fan_on else 0,
        "hr": int(row.get("reportedHr", _DEFAULTS["reportedHr"])),
        "spo2": int(row.get("reportedSpo2", _DEFAULTS["reportedSpo2"])),
        "alarm": 1 if bool(row.get("alarmActive", _DEFAULTS["alarmActive"])) else 0,
        "rgb": 1 if bool(row.get("compromised", _DEFAULTS["compromised"])) else 0,
    }


def encode_state(s: StateLine) -> str:
    """Port of contracts/src/serial.ts `encodeState` — the exact wire frame,
    newline-terminated."""
    return f"STATE,fan={s['fan']},rate={s['rate']},hr={s['hr']},spo2={s['spo2']},alarm={s['alarm']},rgb={s['rgb']}\n"


def row_to_frame(row: dict[str, Any]) -> str:
    """Convenience: map a device_status row straight to its STATE frame."""
    return encode_state(device_status_to_state(row))


_LIGHT = {0: "GREEN", 1: "RED", 2: "AMBER"}


def render_board(row: dict[str, Any]) -> str:
    """One-line, human-readable render of what the emulator board would show —
    for stderr, so stdout stays pure STATE frames."""
    s = device_status_to_state(row)
    fan = "ON " if s["fan"] else "OFF"
    alarm = "ALARM" if s["alarm"] else "silent"
    extra = ""
    if "trueHr" in row and "trueSpo2" in row and (row.get("trueHr") != s["hr"] or row.get("trueSpo2") != s["spo2"]):
        extra = f"   (true {row['trueHr']}/{row['trueSpo2']} — LYING)"
    return (
        f"[board] fan={fan} rate={s['rate']:>3}  display {s['hr']}/{s['spo2']}  "
        f"{alarm:<6}  light={_LIGHT[s['rgb']]}{extra}"
    )


# ------------------------------------------------------------------- sources --

def read_row_from_file(path: str | os.PathLike[str]) -> Optional[dict[str, Any]]:
    """Read + parse the JSON row file device-service writes. Returns None if the
    file is absent, empty, mid-write (unparseable), or not a JSON object."""
    try:
        text = Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not text:
        return None
    try:
        row = json.loads(text)
    except json.JSONDecodeError:
        return None  # likely a half-written row; the next poll will catch it
    return row if isinstance(row, dict) else None


def fetch_row_from_url(base_url: str, *, timeout: float = 3.0) -> Optional[dict[str, Any]]:
    """Poll GET <base_url>/device/_truth for the full source-of-truth row.
    Returns None on any network / parse error (so --watch keeps polling)."""
    try:
        import requests  # local import: file-source mode works without requests

        resp = requests.get(f"{base_url.rstrip('/')}{TRUTH_PATH}", timeout=timeout)
        resp.raise_for_status()
        row = resp.json()
    except Exception:  # noqa: BLE001 - unreachable/bad response -> no row this tick
        return None
    return row if isinstance(row, dict) else None


def make_reader(*, row_file: str | None, base_url: str | None) -> Callable[[], Optional[dict[str, Any]]]:
    """Build the zero-arg row reader for the chosen source."""
    if row_file:
        return lambda: read_row_from_file(row_file)
    if base_url:
        return lambda: fetch_row_from_url(base_url)
    raise ValueError("no source: pass --row-file or --base-url (or set PREVENT_DEVICE_ROW_FILE)")


# --------------------------------------------------------------------- modes --

def emit_once(reader: Callable[[], Optional[dict[str, Any]]], *, out: TextIO | None = None, log: TextIO | None = None) -> int:
    """Emit exactly one STATE frame from the current row, then return. Exit code
    1 if the source had no readable row."""
    out = out if out is not None else sys.stdout
    log = log if log is not None else sys.stderr
    row = reader()
    if row is None:
        print("[emulate_stream] no row available from source — nothing to emit.", file=log)
        return 1
    out.write(row_to_frame(row))
    out.flush()
    print(render_board(row), file=log)
    return 0


def watch(
    reader: Callable[[], Optional[dict[str, Any]]],
    *,
    interval: float = DEFAULT_INTERVAL,
    out: TextIO | None = None,
    log: TextIO | None = None,
    max_ticks: int | None = None,
) -> int:
    """Poll the source every `interval`s and emit a STATE frame to stdout
    whenever the row changes (first readable row always emits). `max_ticks`
    bounds the loop for tests; None runs until Ctrl-C."""
    out = out if out is not None else sys.stdout
    log = log if log is not None else sys.stderr
    last_key: str | None = None
    print(f"[emulate_stream] watching source every {interval:g}s (Ctrl-C to stop)…", file=log)
    ticks = 0
    try:
        while max_ticks is None or ticks < max_ticks:
            row = reader()
            if row is not None:
                key = json.dumps(row, sort_keys=True)
                if key != last_key:
                    out.write(row_to_frame(row))
                    out.flush()
                    print(render_board(row), file=log)
                    last_key = key
            ticks += 1
            if max_ticks is None or ticks < max_ticks:
                time.sleep(interval)
    except KeyboardInterrupt:
        print("\n[emulate_stream] stopped.", file=log)
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="python -m security.emulate_stream",
        description="Convert the device_status row into serial STATE frames for Dev 3's emulator.",
    )
    src = ap.add_argument_group("source (pick one; default: $PREVENT_DEVICE_ROW_FILE)")
    src.add_argument("--row-file", help="path to the JSON row file device-service writes")
    src.add_argument("--base-url", help="device-service base URL; polls GET <url>/device/_truth")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="emit one frame from the current row and exit")
    mode.add_argument("--watch", action="store_true", help="emit a frame on every row change (default)")
    ap.add_argument("--interval", type=float, default=DEFAULT_INTERVAL, help="watch poll interval seconds (default %(default)s)")
    args = ap.parse_args(argv)

    row_file = args.row_file or (None if args.base_url else os.environ.get("PREVENT_DEVICE_ROW_FILE", "").strip() or None)
    if not row_file and not args.base_url:
        ap.error("no source: pass --row-file or --base-url (or set PREVENT_DEVICE_ROW_FILE)")

    reader = make_reader(row_file=row_file, base_url=args.base_url)

    if args.once:
        return emit_once(reader)
    return watch(reader, interval=args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
