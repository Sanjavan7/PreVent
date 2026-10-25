"""Six recovery agents. Each one only speaks for its own mandate."""

AGENTS = [
    {
        "id": "command",
        "name": "Incident Command",
        "mandate": "Sequence care, containment, and restore so those workstreams stay in one order.",
        "owns": {"stand_down"},
    },
    {
        "id": "containment",
        "name": "Containment",
        "mandate": "Stop spread at the IT boundary and keep life-safety networks in service.",
        "owns": {"isolate"},
    },
    {
        "id": "clinical",
        "name": "Clinical Continuity",
        "mandate": "Keep treatment going and certify the chart before downtime lifts.",
        "owns": {"declare", "validate_care"},
    },
    {
        "id": "recovery",
        "name": "Recovery",
        "mandate": "Restore from a clean copy in clinical order, directory through imaging.",
        "owns": {
            "recovery_path",
            "restore_identity",
            "restore_ancillary",
            "restore_ehr",
            "restore_pacs",
        },
    },
    {
        "id": "comms",
        "name": "Communications",
        "mandate": "Give staff, leadership, and responders one accurate notice.",
        "owns": {"notify"},
    },
    {
        "id": "compliance",
        "name": "Compliance and Evidence",
        "mandate": "Preserve logs and keep the HIPAA assessment on the clock.",
        "owns": {"legal_hold"},
    },
]

NAMES = {agent["id"]: agent["name"] for agent in AGENTS}


def _has(done, action_id):
    return action_id in done


def command_view(done):
    if _has(done, "stand_down"):
        return (
            "Tabletop closed. Clinical systems are on the clean 01:10 copy, downtime is lifted, and the assessment file stays open.",
            [
                "Email remains quarantined for a separate rebuild.",
                "Counsel still owns any patient or regulator notification decision.",
                "Telemetry and nurse call stayed online through the drill.",
            ],
        )
    if _has(done, "validate_care"):
        return (
            "Care is validated on the pilot units. Lift downtime once staff notice and the assessment file are both on the record.",
            [
                "Chartwell, pharmacy, lab, and imaging are restored.",
                "The stand-down note goes out by phone tree. Email is still quarantined.",
            ],
        )
    if _has(done, "restore_ehr"):
        return (
            "The EHR is back in pilot. Hold the house on downtime until two units reconcile medications and results.",
            ["Imaging follows the EHR.", "Paper from the gap still has to be entered."],
        )
    if _has(done, "recovery_path"):
        return (
            "Restore path is the 01:10 copy. Order is directory, pharmacy and lab, EHR, then imaging.",
            ["Encrypted hosts stay on the evidence hold.", "Life-safety networks stay as they are."],
        )
    if _has(done, "isolate"):
        return (
            "Spread is contained and care is on paper. Next, preserve evidence if that file is still open, then verify the backup.",
            ["Telemetry and nurse call stay in service.", "Restores wait on a verified offline copy."],
        )
    if _has(done, "declare"):
        return (
            "Downtime is the house mode. Isolate affected IT next, and open the evidence file in parallel.",
            ["ED stays open. Elective surgery is paused.", "Staff notice can go as soon as you approve it."],
        )
    return (
        "Life safety is up. EHR and imaging are encrypted. Declare downtime before isolation or any restore.",
        [
            "280 beds in this drill. ED is open. Operating mode is not declared yet.",
            "Agents propose steps. You approve every one.",
        ],
    )


def containment_view(done):
    if _has(done, "isolate"):
        return (
            "Affected IT is isolated. Life-safety networks stayed up, and vendor remote access is disabled.",
            [
                "EHR, imaging, pharmacy servers, lab, and email are at the boundary.",
                "Email stays quarantined after clinical systems return.",
            ],
        )
    if _has(done, "declare"):
        return (
            "Ready to isolate EHR, imaging, pharmacy servers, lab, and email.",
            [
                "ICU telemetry and nurse call stay on the life-safety networks.",
                "The 01:40 vendor remote-access account gets disabled in the same step.",
            ],
        )
    return (
        "Waiting for downtime so units have one operating mode before the network change.",
        ["I will leave telemetry and nurse call in place when isolation is approved."],
    )


def clinical_view(done):
    if _has(done, "validate_care"):
        return (
            "Pilot units match the downtime forms, including medications, allergies, and critical results.",
            ["Documentation can return to Chartwell when command lifts downtime."],
        )
    if _has(done, "restore_ehr"):
        return (
            "Chartwell is in pilot. About 70 minutes of care is only on paper.",
            [
                "Reconcile medications and critical results on two units before go-live.",
                "Pharmacy cabinet pulls have to match the restored record.",
            ],
        )
    if _has(done, "declare"):
        return (
            "House is on paper orders, read-back, and phone criticals. The ED is open.",
            [
                "Automated cabinets still dispense from local inventory.",
                "Elective surgery is paused. Emergency cases continue.",
            ],
        )
    return (
        "The house is between electronic and paper workflows. Lock screens are up on EHR workstations.",
        ["ICU monitoring is live.", "Declare downtime so every unit shares one mode."],
    )


def recovery_view(done):
    if _has(done, "restore_pacs"):
        return (
            "Directory, pharmacy, lab, EHR, and imaging are on the 01:10 copy.",
            ["Gap imaging studies still need a check on the modality consoles."],
        )
    if _has(done, "restore_ehr"):
        return (
            "EHR pilot is up. Imaging is the remaining clinical system on my list.",
            ["Clean segment stays separate from the quarantined email system."],
        )
    if _has(done, "restore_ancillary"):
        return (
            "Pharmacy and lab are restored. EHR is next, as a pilot rather than a house cutover.",
            ["Paper from the downtime window will need to be entered back."],
        )
    if _has(done, "restore_identity"):
        return (
            "Directory services are on the clean segment and administrator passwords are reset.",
            ["Pharmacy and lab are the next restore, before the EHR."],
        )
    if _has(done, "recovery_path"):
        return (
            "01:10 copy verified. No public decryptor is listed for the fictional strain LOCKNOTE-SIM.",
            ["Next restore is the staff directory, onto a clean segment."],
        )
    if _has(done, "isolate") and _has(done, "legal_hold"):
        return (
            "Segments are isolated and logs are preserved. I can verify the offline 01:10 copy.",
            ["Encrypted hosts stay disconnected while that check runs."],
        )
    return (
        "Candidate restore point is the immutable copy from 01:10, stored off the hospital network.",
        [
            "I will verify it after isolation and the evidence hold.",
            "Planned order: directory, pharmacy and lab, EHR, imaging.",
        ],
    )


def comms_view(done):
    if _has(done, "notify") and _has(done, "validate_care"):
        return (
            "Responders already have the incident notice. The stand-down note is ready for the phone tree.",
            ["Email is still quarantined, so the house channel stays the phone tree."],
        )
    if _has(done, "notify"):
        return (
            "Charge nurses, the executive on call, law enforcement, and the insurer have the notice.",
            ["Staff alert: care continues on paper. Payment stays with counsel and law enforcement."],
        )
    if _has(done, "declare"):
        return (
            "Notice is ready to send. It matches the downtime mode now in effect.",
            [
                "Audience: charge nurses, executive on call, law enforcement, cyber insurer.",
                "Payment is outside the staff alert.",
            ],
        )
    return (
        "Holding the staff notice until downtime is the official house mode.",
        ["The draft says care continues and documentation moves to paper."],
    )


def compliance_view(done):
    if _has(done, "legal_hold") and _has(done, "stand_down"):
        return (
            "Evidence hold and the assessment clock stayed in place through restore.",
            ["Notification to patients or regulators is undecided in this drill."],
        )
    if _has(done, "legal_hold"):
        return (
            "Logs are on the evidence drive. The HIPAA clock is running. Hosts stay intact.",
            ["Restores belong on the clean segment, separate from the evidence hosts."],
        )
    if _has(done, "declare"):
        return (
            "Ready to preserve logs and open the breach-assessment file.",
            ["Rebuilds wait until this hold is in place.", "Hosts stay intact."],
        )
    return (
        "The assessment clock should start once the incident is formally in downtime.",
        ["I want firewall, EHR, and directory logs copied before any rebuild."],
    )


VIEWS = {
    "command": command_view,
    "containment": containment_view,
    "clinical": clinical_view,
    "recovery": recovery_view,
    "comms": comms_view,
    "compliance": compliance_view,
}


def agent_status(agent, done, ready_ids):
    owns = agent["owns"]
    if owns & ready_ids:
        return "needs you"
    if agent["id"] == "command" and "stand_down" not in done:
        return "coordinating"
    if owns <= done:
        return "clear"
    if owns & done:
        return "advising"
    return "waiting"


def reports(done, ready_ids):
    done = set(done)
    ready_ids = set(ready_ids)
    rows = []
    for agent in AGENTS:
        summary, findings = VIEWS[agent["id"]](done)
        rows.append(
            {
                "id": agent["id"],
                "name": agent["name"],
                "mandate": agent["mandate"],
                "status": agent_status(agent, done, ready_ids),
                "summary": summary,
                "findings": findings,
            }
        )
    return rows
