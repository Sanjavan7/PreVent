"""SCAN as a fleet of agents: {semgrep,bandit} x {server,firmware} = 4 agents.

Real scanner invocations over the real targets (needs semgrep + bandit on PATH,
which the suite already requires). Asserts the fleet shape, the two genuine
CWE-306 findings (server HTTP handler + firmware serial control channel), and
that Bandit is honestly empty on the C/C++ firmware.
"""

from __future__ import annotations

from scan.run_scanners import run_scan_agents


def test_fleet_is_four_agents_in_stable_order():
    r = run_scan_agents()
    agents = r["agents"]
    assert [a["agentId"] for a in agents] == [
        "semgrep/device-service",
        "bandit/device-service",
        "semgrep/firmware",
        "bandit/firmware",
    ]
    assert [a["id"] for a in agents] == [1, 2, 3, 4]


def test_both_real_cwe306_findings_present():
    r = run_scan_agents()
    rules = {(f["scanner"], f.get("target"), f["ruleId"]) for f in r["findings"]}
    # server: missing auth on the HTTP command handler
    assert ("semgrep", "device-service", "flask-missing-auth-decorator") in rules
    # firmware: unauthenticated serial control channel (device-side analog)
    assert ("semgrep", "firmware", "firmware-unauth-serial-control") in rules
    # both are ERROR severity (the two that will rank at the top)
    errors = [f for f in r["findings"] if f["severity"] == "ERROR"]
    assert len(errors) == 2


def test_bandit_has_no_jurisdiction_on_firmware():
    r = run_scan_agents()
    fw_bandit = next(a for a in r["agents"] if a["agentId"] == "bandit/firmware")
    assert fw_bandit["findings"] == []  # Python linter, C/C++ firmware -> honestly empty


def test_global_ids_are_unique_and_contiguous():
    r = run_scan_agents()
    ids = [f["id"] for f in r["findings"]]
    assert ids == list(range(1, len(ids) + 1))


def test_firmware_can_be_excluded():
    r = run_scan_agents(include_firmware=False)
    assert [a["agentId"] for a in r["agents"]] == [
        "semgrep/device-service",
        "bandit/device-service",
    ]
