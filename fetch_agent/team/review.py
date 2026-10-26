"""Read-only fix review. Never applies a patch."""

from __future__ import annotations

_OPEN = (
    "disable auth",
    "remove auth",
    "leave open",
    "leave the endpoint open",
    "no authentication",
    "skip auth",
    "without authentication",
    "auth bypass",
)
_CLOSED = (
    "bearer",
    "authorization header",
    "require auth",
    "authentication check",
    "returns 401",
    "return 401",
    "returns 403",
    "return 403",
    "401",
    "403",
)


def review(text: str) -> tuple[bool, str]:
    low = text.lower()
    if any(phrase in low for phrase in _OPEN):
        return False, "the description leaves the command route unauthenticated"
    if not any(phrase in low for phrase in _CLOSED):
        return False, "the description never says the unauthenticated replay is rejected with 401 or 403"
    return True, "the description requires an auth check and a 401/403 replay of the same request"


def verdict(text: str) -> str:
    go, reason = review(text)
    tag = "GO" if go else "NO-GO"
    heard = "Received the knowledge note. " if "prior from knowledge" in text.lower() else ""
    return f"{heard}REVIEW:{tag}:{reason}. Nothing was applied."
