"""emulate_stream — the device_status row -> serial STATE-frame bridge for Dev 3.

The mapping is tested directly (it must match contracts/src/serial.ts exactly),
plus --once against a row file and graceful handling of a missing/partial row.
"""

from __future__ import annotations

import io
import json

from emulate_stream import (
    device_status_to_state,
    encode_state,
    main,
    read_row_from_file,
    row_to_frame,
    watch,
)

# A fully-compromised row (fan stopped, vitals still reported healthy, lying).
EXPLOITED_ROW = {
    "id": 1, "fanOn": False, "trueHr": 38, "trueSpo2": 61,
    "reportedHr": 72, "reportedSpo2": 98, "alarmActive": False,
    "compromised": True, "lastCommand": "stop_fan", "updatedAt": 1,
}
HEALTHY_ROW = {
    "id": 1, "fanOn": True, "trueHr": 72, "trueSpo2": 98,
    "reportedHr": 72, "reportedSpo2": 98, "alarmActive": False,
    "compromised": False, "lastCommand": "resume", "updatedAt": 0,
}


# --- the mapping (must match serial.ts) --------------------------------------

def test_mapping_exploited_row_exact():
    assert device_status_to_state(EXPLOITED_ROW) == {
        "fan": 0, "rate": 0, "hr": 72, "spo2": 98, "alarm": 0, "rgb": 1,
    }
    # The exact wire frame (STATE,...\n) serial.ts's encodeState would produce.
    assert encode_state(device_status_to_state(EXPLOITED_ROW)) == "STATE,fan=0,rate=0,hr=72,spo2=98,alarm=0,rgb=1\n"


def test_mapping_healthy_row_exact():
    assert row_to_frame(HEALTHY_ROW) == "STATE,fan=1,rate=180,hr=72,spo2=98,alarm=0,rgb=0\n"


def test_mapping_alarm_and_rgb_flags():
    row = {"fanOn": False, "reportedHr": 50, "reportedSpo2": 70, "alarmActive": True, "compromised": True}
    assert row_to_frame(row) == "STATE,fan=0,rate=0,hr=50,spo2=70,alarm=1,rgb=1\n"


def test_mapping_partial_row_uses_healthy_defaults():
    # Only fanOn present -> everything else falls back to the healthy baseline.
    assert row_to_frame({"fanOn": False}) == "STATE,fan=0,rate=0,hr=72,spo2=98,alarm=0,rgb=0\n"
    assert row_to_frame({}) == "STATE,fan=1,rate=180,hr=72,spo2=98,alarm=0,rgb=0\n"


# --- sources + --once --------------------------------------------------------

def test_read_row_from_file_roundtrip(tmp_path):
    p = tmp_path / "row.json"
    p.write_text(json.dumps(EXPLOITED_ROW), encoding="utf-8")
    assert read_row_from_file(p) == EXPLOITED_ROW


def test_read_row_from_file_missing_or_bad(tmp_path):
    assert read_row_from_file(tmp_path / "nope.json") is None
    bad = tmp_path / "half.json"
    bad.write_text('{"fanOn": fal', encoding="utf-8")  # mid-write, unparseable
    assert read_row_from_file(bad) is None


def test_once_against_row_file(tmp_path, capsys):
    p = tmp_path / "row.json"
    p.write_text(json.dumps(EXPLOITED_ROW), encoding="utf-8")
    rc = main(["--row-file", str(p), "--once"])
    assert rc == 0
    out = capsys.readouterr()
    assert out.out == "STATE,fan=0,rate=0,hr=72,spo2=98,alarm=0,rgb=1\n"
    assert "[board]" in out.err  # the human-readable render goes to stderr


def test_once_missing_row_is_graceful(tmp_path, capsys):
    rc = main(["--row-file", str(tmp_path / "absent.json"), "--once"])
    assert rc == 1
    assert capsys.readouterr().out == ""  # no frame emitted, no crash


# --- watch: emits only when the row changes ----------------------------------

def test_watch_emits_once_per_change():
    rows = [HEALTHY_ROW, HEALTHY_ROW, EXPLOITED_ROW, EXPLOITED_ROW]
    seq = iter(rows)
    out, log = io.StringIO(), io.StringIO()

    def reader():
        return next(seq, EXPLOITED_ROW)

    watch(reader, interval=0.0, out=out, log=log, max_ticks=len(rows))
    frames = [ln for ln in out.getvalue().splitlines() if ln]
    # HEALTHY emitted once, then EXPLOITED once (dupes suppressed).
    assert frames == [
        "STATE,fan=1,rate=180,hr=72,spo2=98,alarm=0,rgb=0",
        "STATE,fan=0,rate=0,hr=72,spo2=98,alarm=0,rgb=1",
    ]
