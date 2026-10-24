"""The custom CWE-306 SemGrep rule: fires only on the vuln, silent on the patch
and on read-only GETs. Skips cleanly if semgrep isn't installed."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
RULES_DIR = REPO_ROOT / "device-service" / "rules"
RULE_FILE = RULES_DIR / "missing-auth.yaml"
FIXTURE = REPO_ROOT / "security" / "tests" / "semgrep_fixtures" / "missing-auth.py"

semgrep = shutil.which("semgrep")
needs_semgrep = pytest.mark.skipif(semgrep is None, reason="semgrep not installed")


@needs_semgrep
def test_rule_validates():
    proc = subprocess.run(
        [semgrep, "scan", "--config", str(RULES_DIR), "--validate"],
        capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, proc.stderr


@needs_semgrep
def test_rule_test_fixtures_pass():
    """semgrep --test proves fires-on-vuln / silent-on-patched / silent-on-GET
    against the annotated fixture."""
    proc = subprocess.run(
        [semgrep, "--test", "--config", str(RULE_FILE), str(FIXTURE)],
        capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, f"stdout={proc.stdout}\nstderr={proc.stderr}"
    assert "All tests passed" in proc.stdout


@needs_semgrep
def test_fires_exactly_once_on_real_app():
    proc = subprocess.run(
        [semgrep, "scan", "--config", str(RULES_DIR), "--json", "--metrics", "off",
         "--disable-version-check", "--quiet", str(REPO_ROOT / "device-service")],
        capture_output=True, text=True, timeout=120,
    )
    data = json.loads(proc.stdout)
    results = data["results"]
    assert len(results) == 1, [r["start"]["line"] for r in results]
    assert results[0]["check_id"].endswith("flask-missing-auth-decorator")
