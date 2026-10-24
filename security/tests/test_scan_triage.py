"""SCAN: scanners produce the right signal+noise, the live probe distinguishes
patched from vulnerable, and deterministic triage self-corrects onto CWE-306."""

from __future__ import annotations

from scan.run_scanners import reproduce_probe, run_scanners
from scan.triage import deterministic_triage


def test_scanners_signal_and_noise():
    scans = run_scanners()
    # Exactly one SemGrep CWE-306 finding...
    assert len(scans["semgrep"]) == 1
    assert scans["semgrep"][0]["cveRef"] == "CVE-2019-6538"
    # ...and Bandit noise that is NOT missing-auth (the decoys).
    assert len(scans["bandit"]) >= 1
    rule_ids = {f["ruleId"] for f in scans["bandit"]}
    assert "B324" in rule_ids  # the scary HIGH decoy


def test_live_probe_reproduces_on_vulnerable(vulnerable_url):
    scans = run_scanners()
    probe = reproduce_probe(scans["semgrep"][0], base_url=vulnerable_url)
    assert probe["reproduced"] is True
    assert probe["live"] is True


def test_live_probe_does_not_reproduce_on_patched(patched_url):
    scans = run_scanners()
    probe = reproduce_probe(scans["semgrep"][0], base_url=patched_url)
    assert probe["reproduced"] is False  # auth enforced -> not reproduced
    assert probe["live"] is True


def test_bandit_findings_never_reproduce(vulnerable_url):
    scans = run_scanners()
    for f in scans["bandit"]:
        assert reproduce_probe(f, base_url=vulnerable_url)["reproduced"] is False


def test_triage_self_corrects_to_cwe306(vulnerable_url):
    scans = run_scanners()
    result = deterministic_triage(scans["semgrep"], scans["bandit"], base_url=vulnerable_url)
    assert result["selfCorrected"] is True
    assert result["chosen"] is not None
    assert result["chosen"]["scanner"] == "semgrep"
    assert result["chosen"]["cveRef"] == "CVE-2019-6538"
    assert result["chosen"]["isTheRealOne"] is True
    # The first thing it considered was a Bandit decoy it then discarded.
    assert result["considered"][0]["scanner"] == "bandit"
    assert result["considered"][0]["isTheRealOne"] is False
