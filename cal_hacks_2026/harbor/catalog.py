"""Response plan for the Northbridge tabletop.

Actions are defensive recovery steps. Earlier approvals unlock later ones.
Nothing here scans a network, talks to malware, or pays a ransom.
"""

SYSTEMS = [
    {"id": "telemetry", "name": "ICU telemetry", "zone": "Life safety", "status": "online"},
    {"id": "nursecall", "name": "Nurse call", "zone": "Life safety", "status": "online"},
    {"id": "ehr", "name": "Chartwell EHR", "zone": "Clinical", "status": "encrypted"},
    {"id": "pharmacy", "name": "Pharmacy server", "zone": "Clinical", "status": "degraded"},
    {"id": "lab", "name": "Lab system", "zone": "Clinical", "status": "suspected"},
    {"id": "pacs", "name": "Imaging (PACS)", "zone": "Clinical", "status": "encrypted"},
    {"id": "identity", "name": "Staff directory", "zone": "Identity", "status": "suspected"},
    {"id": "email", "name": "Email", "zone": "Corporate", "status": "suspected"},
    {"id": "backup", "name": "Immutable backup", "zone": "Recovery", "status": "unverified"},
]

OPENING = [
    {
        "speaker": "command",
        "to": "clinical",
        "text": "Chartwell EHR and imaging show lock screens. ICU telemetry and nurse call are still up. Declare downtime before any server is restored.",
    },
    {
        "speaker": "clinical",
        "to": "command",
        "text": "ED, ICU, pharmacy cabinets, and emergency surgery can keep going on paper. I will declare downtime as soon as you approve it.",
    },
    {
        "speaker": "containment",
        "to": "clinical",
        "text": "After downtime is the house mode, I will isolate EHR, imaging, pharmacy servers, lab, and email. Telemetry and nurse call stay on the life-safety networks.",
    },
    {
        "speaker": "compliance",
        "to": "command",
        "text": "Preserve firewall, EHR, and directory logs, and start the HIPAA assessment clock while the facts are fresh. Hosts stay intact.",
    },
    {
        "speaker": "recovery",
        "to": "command",
        "text": "The 01:10 immutable copy stays offline until the affected segments are isolated. That copy is the restore path I want to verify.",
    },
    {
        "speaker": "comms",
        "to": "command",
        "text": "The staff phone tree is ready: patients stay, documentation goes to paper, and payment questions stay with counsel and law enforcement.",
    },
]

CATALOG = [
    {
        "id": "declare",
        "owner": "clinical",
        "title": "Declare downtime and switch the house to paper",
        "detail": "One operating mode for every unit: paper orders, read-back of verbal orders, critical results by phone, and cabinet inventory for medications. Elective procedures pause. The ED stays open.",
        "minutes": 8,
        "requires": [],
        "status": {},
        "exchange": [
            {
                "speaker": "clinical",
                "to": "command",
                "text": "Downtime is active. Units have paper orders, phone criticals, and local cabinet inventory.",
            },
            {
                "speaker": "command",
                "to": "containment",
                "text": "Care has a stable mode. Isolate the affected IT segments and leave life-safety networks in place.",
            },
            {
                "speaker": "comms",
                "to": "clinical",
                "text": "I will wait for your approval before sending the house notice, so the words match the mode you just set.",
            },
        ],
    },
    {
        "id": "isolate",
        "owner": "containment",
        "title": "Isolate affected IT segments",
        "detail": "Cut EHR, imaging, pharmacy servers, lab, and email at the network boundary. Disable the vendor remote-access account that was signed in at 01:40. Leave ICU telemetry and nurse call online.",
        "minutes": 12,
        "requires": ["declare"],
        "status": {
            "ehr": "isolated",
            "pacs": "isolated",
            "pharmacy": "isolated",
            "lab": "isolated",
            "email": "isolated",
            "identity": "restricted",
        },
        "exchange": [
            {
                "speaker": "containment",
                "to": "clinical",
                "text": "EHR, imaging, pharmacy servers, lab, and email are isolated. Telemetry and nurse call are still online. Vendor remote access is disabled.",
            },
            {
                "speaker": "clinical",
                "to": "containment",
                "text": "Bedside monitoring is live. Cabinets still dispense from local inventory while the pharmacy server is isolated.",
            },
            {
                "speaker": "recovery",
                "to": "command",
                "text": "Affected segments are boxed in. I can inspect the offline 01:10 copy without reconnecting them.",
            },
        ],
    },
    {
        "id": "legal_hold",
        "owner": "compliance",
        "title": "Preserve evidence and start the HIPAA clock",
        "detail": "Copy firewall, EHR, and directory logs to the evidence drive before any rebuild. Keep encrypted hosts intact. Open the breach-assessment file. This drill records the assessment; it does not decide whether patients must be notified.",
        "minutes": 10,
        "requires": ["declare"],
        "status": {},
        "exchange": [
            {
                "speaker": "compliance",
                "to": "command",
                "text": "Logs are on the evidence drive and the HIPAA assessment clock is started. Hosts are intact.",
            },
            {
                "speaker": "command",
                "to": "recovery",
                "text": "Rebuilds use the verified backup on a clean segment. Encrypted hosts stay as evidence.",
            },
        ],
    },
    {
        "id": "notify",
        "owner": "comms",
        "title": "Notify staff, leadership, and responders",
        "detail": "Phone-tree the charge nurses and the executive on call. Contact law enforcement and the cyber insurer. Staff message: care continues on paper. Payment decisions stay with counsel and law enforcement, outside the staff alert.",
        "minutes": 9,
        "requires": ["declare"],
        "status": {},
        "exchange": [
            {
                "speaker": "comms",
                "to": "command",
                "text": "Charge nurses, the executive on call, law enforcement, and the insurer have the notice. The staff alert keeps payment questions out of the house channel.",
            },
            {
                "speaker": "clinical",
                "to": "comms",
                "text": "Units have the same instruction: patients stay, orders go on paper, speculation stays off the group chat.",
            },
        ],
    },
    {
        "id": "recovery_path",
        "owner": "recovery",
        "title": "Verify the backup and choose the restore path",
        "detail": "Check the 01:10 immutable copy offline. Look up the fictional strain LOCKNOTE-SIM on the public decryptor registry used with law enforcement. If none is listed, restore from the clean copy in this order: directory, pharmacy and lab, EHR, imaging.",
        "minutes": 14,
        "requires": ["isolate", "legal_hold"],
        "status": {"backup": "verified"},
        "exchange": [
            {
                "speaker": "recovery",
                "to": "command",
                "text": "The 01:10 copy is intact and was off the hospital network. No public decryptor is listed for LOCKNOTE-SIM. We restore from that copy, directory first.",
            },
            {
                "speaker": "command",
                "to": "clinical",
                "text": "Pharmacy and lab come back before the EHR so medication and results can be reconciled.",
            },
            {
                "speaker": "compliance",
                "to": "recovery",
                "text": "Encrypted hosts stay on the evidence hold while you build the clean segment.",
            },
        ],
    },
    {
        "id": "restore_identity",
        "owner": "recovery",
        "title": "Restore the staff directory on a clean segment",
        "detail": "Bring directory services back from the 01:10 copy onto a clean segment. Reset administrator passwords. Keep vendor remote access disabled and keep email quarantined.",
        "minutes": 16,
        "requires": ["recovery_path"],
        "status": {"identity": "recovered"},
        "exchange": [
            {
                "speaker": "recovery",
                "to": "containment",
                "text": "Directory services are up on the clean segment. Administrator passwords are reset. Vendor remote access stays disabled.",
            },
            {
                "speaker": "containment",
                "to": "recovery",
                "text": "Acknowledged. Email and the old EHR segment stay disconnected.",
            },
        ],
    },
    {
        "id": "restore_ancillary",
        "owner": "recovery",
        "title": "Restore pharmacy and lab",
        "detail": "Restore the pharmacy server and lab system from the 01:10 copy. Cabinets keep dispensing until pharmacy reconciles pulls against the restored record.",
        "minutes": 16,
        "requires": ["restore_identity"],
        "status": {"pharmacy": "recovered", "lab": "recovered"},
        "exchange": [
            {
                "speaker": "recovery",
                "to": "clinical",
                "text": "Pharmacy and lab are up from the 01:10 copy and ready for reconciliation.",
            },
            {
                "speaker": "clinical",
                "to": "recovery",
                "text": "Pharmacy will match cabinet pulls to the restored record before we put the EHR back into care.",
            },
        ],
    },
    {
        "id": "restore_ehr",
        "owner": "recovery",
        "title": "Restore the EHR from the clean copy",
        "detail": "Bring Chartwell back from the 01:10 copy into a pilot, not a house-wide cutover. About 70 minutes of care exists only on paper and has to be entered back.",
        "minutes": 20,
        "requires": ["restore_ancillary"],
        "status": {"ehr": "recovered"},
        "exchange": [
            {
                "speaker": "recovery",
                "to": "clinical",
                "text": "Chartwell is up from the clean copy, limited to a pilot. Paper from the gap still has to be entered.",
            },
            {
                "speaker": "clinical",
                "to": "command",
                "text": "I want two units to reconcile medications and critical results before we call the house recovered.",
            },
        ],
    },
    {
        "id": "restore_pacs",
        "owner": "recovery",
        "title": "Restore imaging",
        "detail": "Bring PACS back from the 01:10 copy. Studies taken during the gap stay on the modality consoles until radiology checks them in.",
        "minutes": 14,
        "requires": ["restore_ehr"],
        "status": {"pacs": "recovered"},
        "exchange": [
            {
                "speaker": "recovery",
                "to": "clinical",
                "text": "Imaging is back. Gap studies still need a check against the modality consoles.",
            },
            {
                "speaker": "clinical",
                "to": "recovery",
                "text": "Radiology can read again. The ED will hold non-urgent studies until the EHR pilot finishes.",
            },
        ],
    },
    {
        "id": "validate_care",
        "owner": "clinical",
        "title": "Validate care on two pilot units",
        "detail": "Charge nurses reconcile downtime forms with the restored chart: medications, allergies, and critical results. Imaging gap studies are checked. Downtime stays in effect until this passes.",
        "minutes": 18,
        "requires": ["restore_ehr", "restore_pacs"],
        "status": {},
        "exchange": [
            {
                "speaker": "clinical",
                "to": "command",
                "text": "Pilot units match the downtime forms, including medications and critical results. Safe to lift downtime once the notices and the assessment file are on the record.",
            },
            {
                "speaker": "command",
                "to": "comms",
                "text": "Prepare the stand-down note. Email is still quarantined, so the phone tree carries it.",
            },
        ],
    },
    {
        "id": "stand_down",
        "owner": "command",
        "title": "Lift downtime and close the tabletop",
        "detail": "Return documentation to the EHR. Leave email quarantined for a later rebuild. Keep the HIPAA assessment file open. This drill restores care systems; counsel still owns any notification decision.",
        "minutes": 8,
        "requires": ["validate_care", "notify", "legal_hold"],
        "status": {},
        "exchange": [
            {
                "speaker": "command",
                "to": "clinical",
                "text": "Downtime is lifted in this simulation. Chartwell, pharmacy, lab, and imaging are on the clean copy. Email stays quarantined.",
            },
            {
                "speaker": "compliance",
                "to": "command",
                "text": "The assessment file stays open. This tabletop does not decide patient or regulator notification.",
            },
            {
                "speaker": "clinical",
                "to": "command",
                "text": "Units are back on the EHR. Paper from the gap is entered. Telemetry and nurse call never left service.",
            },
        ],
    },
]

MILESTONES = [
    ("declare", "Downtime declared"),
    ("isolate", "Spread contained"),
    ("legal_hold", "Evidence preserved"),
    ("recovery_path", "Backup verified"),
    ("validate_care", "Care validated"),
    ("stand_down", "Downtime lifted"),
]

PHASES = [
    ("detect", "Detect"),
    ("contain", "Contain and sustain"),
    ("recover", "Recover"),
    ("close", "Close"),
]
