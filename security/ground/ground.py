"""GROUND stage — PreVent security pipeline (Dev 2).

Fetches the grounding CVE (CVE-2019-6538 — missing authentication on a
medical-device command interface; CWE-306 / CWE-862) from the NVD CVE API
2.0, caches the raw JSON locally so later runs (and live demo judging) never
depend on the network, and renders a small "grounding card" dict that the
SCAN stage / dashboard can display next to Claude's triage verdict.

NVD CVE API 2.0: GET https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=<id>
  - works keyless (rate limit 5 requests / 30s without a key)
  - an API key, if you have one, goes in the HTTP header "apiKey:" — NOT a
    query parameter. See contracts/src/models.ts (NVD).

Run directly for a quick smoke test:
    python security/ground/ground.py
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, TypedDict

import requests

# Mirrors contracts/src/models.ts `NVD`.
NVD_CVE_URL_TEMPLATE = "https://services.nvd.nist.gov/rest/json/cves/2.0?cveId={cve_id}"
GROUNDING_CVE_ID = "CVE-2019-6538"

CACHE_DIR = Path(__file__).resolve().parent
CACHE_PATH = CACHE_DIR / "cve-2019-6538.cache.json"

# Known-good reference values for the CISA ICS medical-device advisory on this
# CVE. NVD's own CVSS score differs from CISA's — this stage names the SOURCE for
# each score rather than picking one silently.
# This is a hardcoded reference (not re-fetched live) because CISA's advisory
# isn't exposed by the NVD CVE API itself.
CISA_CVSS_SCORE = 9.3
CISA_CVSS_SEVERITY = "CRITICAL"
CISA_CWE = "CWE-284"  # CISA's advisory names CWE-284 (Improper Access Control)

# Fallback CVSS (NVD side) used only if the live/cached JSON can't be parsed —
# keeps the grounding card renderable offline during judging.
FALLBACK_NVD_CVSS_SCORE = 6.5
FALLBACK_NVD_CVSS_SEVERITY = "MEDIUM"


class CvssEntry(TypedDict):
    score: float
    severity: str
    source: str


class GroundingCard(TypedDict):
    cveId: str
    cwe: list[str]
    cvss: dict[str, CvssEntry]
    summary: str
    fetchedAt: int
    fromCache: bool


def _nvd_headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    # TODO(dev): set NVD_API_KEY in .env for a higher rate limit (50/30s).
    # The API key header is literally named "apiKey" (NOT "Authorization" /
    # "X-Api-Key") — see contracts/src/models.ts NVD.
    api_key = os.environ.get("NVD_API_KEY", "").strip()
    if api_key:
        headers["apiKey"] = api_key
    return headers


def fetch_nvd_cve(cve_id: str = GROUNDING_CVE_ID, *, force_refresh: bool = False, timeout: float = 10.0) -> dict[str, Any]:
    """Return the raw NVD CVE API 2.0 JSON for `cve_id`, using the local cache
    unless `force_refresh=True`. Writes/refreshes the cache on a live fetch.
    """
    if not force_refresh and CACHE_PATH.exists():
        try:
            return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass  # fall through to a live fetch

    url = NVD_CVE_URL_TEMPLATE.format(cve_id=cve_id)
    # TODO(dev): wrap in retry/backoff for the keyless 5-req/30s rate limit
    # if this is ever called in a loop (GROUND normally runs once).
    resp = requests.get(url, headers=_nvd_headers(), timeout=timeout)
    resp.raise_for_status()
    data = resp.json()

    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return data


def _extract_cwe_ids(nvd_json: dict[str, Any]) -> list[str]:
    cwe_ids: list[str] = []
    try:
        vulnerabilities = nvd_json["vulnerabilities"]
        for vuln in vulnerabilities:
            for weakness in vuln.get("cve", {}).get("weaknesses", []):
                for desc in weakness.get("description", []):
                    value = desc.get("value")
                    if value and value not in cwe_ids:
                        cwe_ids.append(value)
    except (KeyError, IndexError, TypeError):
        pass
    return cwe_ids or ["CWE-306", "CWE-862"]  # documented fallback (see module docstring)


_CVSS_LABEL = {
    "cvssMetricV31": "NVD CVSS v3.1",
    "cvssMetricV30": "NVD CVSS v3.0",
    "cvssMetricV2": "NVD CVSS v2.0",
}


def _severity_for_v2(score: float) -> str:
    # CVSS v2 has no baseSeverity field; derive the conventional band.
    if score >= 7.0:
        return "HIGH"
    if score >= 4.0:
        return "MEDIUM"
    return "LOW"


def _extract_all_nvd_cvss(nvd_json: dict[str, Any]) -> dict[str, CvssEntry]:
    """Return EVERY CVSS metric NVD publishes for this CVE, keyed by version.
    CVE-2019-6538 (live NVD data, cached) is scored 9.3 CRITICAL under CVSS v3.1
    but only 3.3 under CVSS v2.0 (vector AV:A — adjacent, not remote) — surfacing
    both (rather than silently picking one) is the honest way to show 'how bad
    this is depends on who scored it and under which rubric'."""
    out: dict[str, CvssEntry] = {}
    try:
        metrics = nvd_json["vulnerabilities"][0]["cve"]["metrics"]
    except (KeyError, IndexError, TypeError):
        metrics = {}
    for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        entries = metrics.get(key) or []
        if not entries:
            continue
        try:
            cvss_data = entries[0]["cvssData"]
            score = float(cvss_data["baseScore"])
        except (KeyError, IndexError, TypeError, ValueError):
            continue
        severity = str(cvss_data.get("baseSeverity", "")).upper()
        if not severity:
            severity = _severity_for_v2(score) if key == "cvssMetricV2" else "UNKNOWN"
        short = "nvd_v31" if key == "cvssMetricV31" else "nvd_v30" if key == "cvssMetricV30" else "nvd_v2"
        out[short] = {"score": score, "severity": severity, "source": _CVSS_LABEL[key]}
    if not out:
        out["nvd"] = {
            "score": FALLBACK_NVD_CVSS_SCORE,
            "severity": FALLBACK_NVD_CVSS_SEVERITY,
            "source": "NVD (fallback — cached/offline value, see ground.py)",
        }
    return out


def build_grounding_card(nvd_json: dict[str, Any], *, cve_id: str = GROUNDING_CVE_ID, from_cache: bool = False) -> GroundingCard:
    cwe_ids = _extract_cwe_ids(nvd_json)
    if CISA_CWE not in cwe_ids:
        cwe_ids.append(CISA_CWE)

    cvss: dict[str, CvssEntry] = _extract_all_nvd_cvss(nvd_json)
    cvss["cisa"] = {
        "score": CISA_CVSS_SCORE,
        "severity": CISA_CVSS_SEVERITY,
        "source": "CISA ICS medical-device advisory",
    }

    return {
        "cveId": cve_id,
        "cwe": cwe_ids,
        "cvss": cvss,
        "summary": (
            "Missing authentication on a medical-device command interface "
            "(CWE-306 / CWE-862) lets an unauthenticated network attacker "
            "issue device commands directly."
        ),
        "fetchedAt": int(time.time() * 1000),
        "fromCache": from_cache,
    }


def ground(cve_id: str = GROUNDING_CVE_ID, *, force_refresh: bool = False) -> GroundingCard:
    """Top-level entry point for the GROUND stage: fetch (or load from cache)
    + render the grounding card."""
    from_cache = not force_refresh and CACHE_PATH.exists()
    nvd_json = fetch_nvd_cve(cve_id, force_refresh=force_refresh)
    return build_grounding_card(nvd_json, cve_id=cve_id, from_cache=from_cache)


if __name__ == "__main__":
    card = ground(force_refresh="--refresh" in sys.argv)
    print(json.dumps(card, indent=2))
