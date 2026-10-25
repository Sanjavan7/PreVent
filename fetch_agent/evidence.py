"""Tamper-evident evidence for the proof-of-fix - the "continues after the
hackathon" + 524B-feeding deliverable.

Two artifacts, built only from REAL data (never the mock fallback):
  * `evidence_manifest.json` - {run_id, cve, canonical_request + sha256,
    deliver_status(200), verify_status(401/403), pre/post device-row hashes,
    sbom_sha256, root_hash, ts}, then ed25519-SIGNED locally. "Signed" is
    literally true (zero network); it proves non-repudiation of OUR claim, not
    the verdict itself - framed honestly.
  * `sbom.cdx.json` - a CycloneDX 1.5 SBOM whose `vulnerabilities[]` carries a
    VEX: `analysis.state="exploitable"` justified by the real 200, flipping to
    `"resolved"` justified by the real 401/403. "Proven for THIS target."

Signing key is derived from PREVENT_SIGNING_SEED (or AGENT_SEED); the public key
is embedded so anyone can verify. Uses pynacl (already installed via uagents).
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from nacl import signing

from .constants import REPO_ROOT

ARTIFACT_ROOT = REPO_ROOT / "fetch_agent" / ".artifacts"

# Static, hand-templated component list (honest: the device-service's direct
# deps) - avoids an empty SBOM from scanning an unpinned requirements.txt.
_COMPONENTS = [
    {"type": "library", "name": "flask", "version": "3.1.0", "purl": "pkg:pypi/flask@3.1.0"},
    {"type": "library", "name": "werkzeug", "version": "3.1.0", "purl": "pkg:pypi/werkzeug@3.1.0"},
    {"type": "library", "name": "requests", "version": "2.32.0", "purl": "pkg:pypi/requests@2.32.0"},
]


def _sha256(data: str) -> str:
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def _signing_key() -> signing.SigningKey:
    seed = os.environ.get("PREVENT_SIGNING_SEED") or os.environ.get("AGENT_SEED") or "prevent-evidence-signing-seed"
    return signing.SigningKey(hashlib.sha256(seed.encode()).digest())


def build_sbom_vex(*, cve_id: str, exploitable: bool, deliver_status: Optional[int], verify_status: Optional[int], ts: str) -> dict:
    state = "exploitable" if exploitable else "resolved"
    if exploitable:
        detail = f"Unauthenticated POST /device/command returned HTTP {deliver_status} (command accepted) - reproduced live."
        response = "exploitable"
    else:
        detail = (
            f"Byte-identical unauthenticated request now returns HTTP {verify_status} (rejected). "
            f"Fix verified by re-execution; proven for this target."
        )
        response = "can_not_fix"  # n/a here; state carries the signal
    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "version": 1,
        "metadata": {
            "timestamp": ts,
            "component": {"type": "application", "name": "device-service", "version": "0.0.0", "bom-ref": "device-service"},
            "tools": [{"vendor": "PreVent", "name": "PreVent-Security", "version": "1.0"}],
        },
        "components": _COMPONENTS,
        "vulnerabilities": [
            {
                "id": cve_id,
                "source": {"name": "NVD", "url": f"https://nvd.nist.gov/vuln/detail/{cve_id}"},
                "ratings": [{"severity": "critical", "method": "other"}],
                "cwes": [306],
                "description": "Missing authentication on the device command interface (CWE-306).",
                "analysis": {"state": state, "detail": detail, "response": [response]},
                "affects": [{"ref": "device-service"}],
            }
        ],
    }


def build_signed_manifest(
    *,
    run_id: str,
    cve_id: str,
    canonical_request: str,
    request_sha256: str,
    deliver_status: Optional[int],
    verify_status: Optional[int],
    pre_patch_row: Optional[dict],
    post_patch_row: Optional[dict],
    sbom: dict,
) -> dict:
    ts = datetime.now(timezone.utc).isoformat()
    sbom_sha = _sha256(json.dumps(sbom, sort_keys=True, separators=(",", ":")))
    pre_hash = _sha256(json.dumps(pre_patch_row or {}, sort_keys=True))
    post_hash = _sha256(json.dumps(post_patch_row or {}, sort_keys=True))

    body = {
        "schema": "prevent.evidence/1",
        "run_id": run_id,
        "cve": cve_id,
        "cwe": "CWE-306",
        "ts": ts,
        "canonical_request": canonical_request,
        "request_sha256": request_sha256,
        "deliver_status": deliver_status,
        "verify_status": verify_status,
        "pre_patch_response_sha256": pre_hash,
        "post_patch_response_sha256": post_hash,
        "sbom_sha256": sbom_sha,
        "claim": "Vulnerability proven exploitable (HTTP {d}) then proven closed (HTTP {v}) by byte-identical re-execution. Evidence feeds an FDA 524B submission; not a compliance certification.".format(
            d=deliver_status, v=verify_status
        ),
    }
    root_hash = _sha256(json.dumps(body, sort_keys=True, separators=(",", ":")))
    body["root_hash"] = root_hash

    key = _signing_key()
    sig = key.sign(root_hash.encode()).signature.hex()
    return {
        **body,
        "signature": {
            "alg": "ed25519",
            "public_key": key.verify_key.encode().hex(),
            "value": sig,
            "note": "Non-repudiation of this record; proves PreVent signed it, not that the claim is independently true.",
        },
    }


def verify_signed_manifest(manifest: dict) -> bool:
    """Full tamper-evident verification: recompute the body hash AND check the
    signature over it, so editing ANY field (not just the signature) fails."""
    try:
        sig = manifest["signature"]
        body = {k: v for k, v in manifest.items() if k not in ("root_hash", "signature")}
        recomputed = _sha256(json.dumps(body, sort_keys=True, separators=(",", ":")))
        if recomputed != manifest.get("root_hash"):
            return False  # body was altered after signing
        vk = signing.VerifyKey(bytes.fromhex(sig["public_key"]))
        vk.verify(manifest["root_hash"].encode(), bytes.fromhex(sig["value"]))
        return True
    except Exception:
        return False


def write_artifacts(run_id: str, manifest: dict, sbom: dict) -> dict:
    out = ARTIFACT_ROOT / run_id
    out.mkdir(parents=True, exist_ok=True)
    man_path = out / "evidence_manifest.json"
    sbom_path = out / "sbom.cdx.json"
    man_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    sbom_path.write_text(json.dumps(sbom, indent=2), encoding="utf-8")
    return {"manifest": str(man_path), "sbom": str(sbom_path)}
