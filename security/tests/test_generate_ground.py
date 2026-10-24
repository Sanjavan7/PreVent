"""GENERATE (Bitdeer client + cached failover) and GROUND (NVD cache)."""

from __future__ import annotations

from generate.exploit import PAYLOADS, generate_poc
from ground.ground import ground


def test_payloads_map_the_three_ir_choices():
    ids = {p["id"] for p in PAYLOADS.values()}
    assert ids == {"stop-breathing", "max-pressure", "falsify-vitals"}
    for p in PAYLOADS.values():
        assert p["command"]["action"] in {"stop_fan", "set_rate", "resume"}


def test_generate_falls_back_to_cache_without_key(monkeypatch):
    monkeypatch.delenv("BITDEER_API_KEY", raising=False)
    finding = {"scanner": "semgrep", "cveRef": "CVE-2019-6538", "file": "device-service/app.py", "line": 1}
    poc = generate_poc("stop-breathing", finding)
    assert poc["source"] == "pre_cached_fallback"
    assert poc["modelId"] == "pre_cached"
    assert "device/command" in poc["pocText"]


def test_generate_rejects_unknown_payload():
    import pytest

    with pytest.raises(ValueError):
        generate_poc("not-a-payload", {})


def test_ground_card_from_cache_is_honest():
    card = ground()  # reads the committed cache; no network
    assert card["cveId"] == "CVE-2019-6538"
    assert "CWE-306" in card["cwe"]
    # Every CVSS entry names its source (the honesty requirement).
    assert card["cvss"], "expected at least one CVSS entry"
    for entry in card["cvss"].values():
        assert entry["source"]
        assert isinstance(entry["score"], float)
    # Both the v3.1/CISA CRITICAL and the much lower v2 score are present.
    scores = {round(e["score"], 1) for e in card["cvss"].values()}
    assert 9.3 in scores
