"""Parse a pasted proof into a signable record, or refuse."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional

from ..evidence import build_sbom_vex, build_signed_manifest


def _field(text: str, name: str) -> Optional[str]:
    match = re.search(rf"(?i)\b{name}\s*[:=]\s*(\S+)", text)
    return match.group(1) if match else None


def parse_record(text: str) -> tuple[Optional[dict], str]:
    """Return (manifest, error). Manifest is present only when the replay status is 401 or 403."""
    deliver = _field(text, "deliver")
    verify = _field(text, "verify")
    digest = _field(text, "sha256")
    run_id = _field(text, "run") or "pasted"
    cve_id = _field(text, "cve") or "CVE-2019-6538"
    request = _field(text, "request") or ""
    if not deliver or not verify or not digest:
        return None, "Need deliver=<http status>, verify=<http status>, and sha256=<request hash> from a finished PreVent run."
    try:
        deliver_i = int(deliver)
        verify_i = int(verify)
    except ValueError:
        return None, "deliver and verify have to be HTTP status numbers."
    if verify_i not in (401, 403):
        return None, f"Refusing to sign a closed-fix claim when verify is {verify_i}. The replay has to be 401 or 403."
    sbom = build_sbom_vex(
        cve_id=cve_id,
        exploitable=False,
        deliver_status=deliver_i,
        verify_status=verify_i,
        ts=datetime.now(timezone.utc).isoformat(),
    )
    manifest = build_signed_manifest(
        run_id=run_id,
        cve_id=cve_id,
        canonical_request=request or "(request body withheld; hash supplied by the caller)",
        request_sha256=digest,
        deliver_status=deliver_i,
        verify_status=verify_i,
        pre_patch_row=None,
        post_patch_row=None,
        sbom=sbom,
    )
    return manifest, ""
