"""Plain-language restatement of the demo's lying monitor. Not medical advice."""

from __future__ import annotations

DISCLAIMER = (
    "This is a description of an instrumented demo, not a diagnosis, not a treatment "
    "recommendation, and not a substitute for clinical staff."
)

CANON = (
    "In the demo the ventilator fan is stopped while the device's own status still reports healthy. "
    "Staff looking only at that status would not see the failure. The gap is the missing alarm, not a prescription."
)


def explain(text: str) -> str:
    low = text.lower()
    heard = "Received the bench report. " if "prior from bench" in low else ""
    if any(word in low for word in ("healthy", "normal", "breathing fine", "stable")) and not any(
        word in low for word in ("stop", "stopped", "no air", "fan off", "fault", "lie", "lying")
    ):
        body = "The message you sent says the monitor looks healthy. That reading is only trustworthy if a separate check shows the fan is actually moving."
    else:
        body = CANON
    return f"{heard}{body}\n\n{DISCLAIMER}"
