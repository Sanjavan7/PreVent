"""One in-memory tabletop. Agents reassess after every approval."""

from copy import deepcopy
from datetime import datetime, timedelta

from harbor.agents import NAMES, reports
from harbor.catalog import CATALOG, MILESTONES, OPENING, PHASES, SYSTEMS


class DecisionError(ValueError):
    pass


def _by_id():
    return {action["id"]: action for action in CATALOG}


ACTIONS = _by_id()


class Session:
    def __init__(self):
        self.systems = deepcopy(SYSTEMS)
        self.completed = []
        self.held = []
        self.clock = datetime(2026, 10, 23, 2, 14)
        self.transcript = []
        for line in OPENING:
            self._say(line["speaker"], line["to"], line["text"])

    def system_map(self):
        return {system["id"]: system for system in self.systems}

    def _say(self, speaker, to, text):
        self.transcript.append(
            {
                "time": self.clock.strftime("%H:%M"),
                "speaker": speaker,
                "speaker_name": "Incident owner" if speaker == "you" else NAMES[speaker],
                "to": to,
                "to_name": NAMES.get(to, "the council" if to == "all" else "Incident owner"),
                "text": text,
            }
        )

    def _phase(self):
        done = set(self.completed)
        if "stand_down" in done:
            return "close"
        if "recovery_path" in done:
            return "recover"
        if "declare" in done or "isolate" in done:
            return "contain"
        return "detect"

    def _operations(self):
        done = set(self.completed)
        if "stand_down" in done:
            return "ED open · normal scheduling · documentation in the EHR"
        if "validate_care" in done:
            return "ED open · pilot units on the restored EHR · paper still on hand"
        if "declare" in done:
            return "ED open · emergency surgery only · documentation on paper"
        return "ED open · operating mode not declared yet"

    def _capacity(self):
        done = set(self.completed)
        if "stand_down" in done:
            return 100
        if "validate_care" in done:
            return 96
        score = 24
        if "declare" in done:
            score = 50
        if "restore_ancillary" in done:
            score += 16
        if "restore_ehr" in done:
            score += 18
        if "restore_pacs" in done:
            score += 6
        return min(score, 100)

    def _plan(self):
        done = set(self.completed)
        held = set(self.held)
        rows = []
        for action in CATALOG:
            if action["id"] in done:
                state = "done"
            elif action["id"] in held:
                state = "held"
            elif all(req in done for req in action["requires"]):
                state = "ready"
            else:
                state = "later"
            rows.append(
                {
                    "id": action["id"],
                    "title": action["title"],
                    "detail": action["detail"],
                    "owner": action["owner"],
                    "owner_name": NAMES[action["owner"]],
                    "minutes": action["minutes"],
                    "state": state,
                }
            )
        return rows

    def view(self):
        plan = self._plan()
        ready_ids = [row["id"] for row in plan if row["state"] == "ready"]
        phase = self._phase()
        return {
            "active": True,
            "incident": {
                "id": "NB-2419",
                "hospital": "Northbridge Medical Center",
                "kind": "Simulated ransomware recovery",
                "strain": "LOCKNOTE-SIM (fictional)",
                "detected": "02:14",
                "beds": 280,
            },
            "clock": self.clock.strftime("%H:%M"),
            "phase": phase,
            "phases": [{"id": item[0], "label": item[1]} for item in PHASES],
            "operations": self._operations(),
            "care_capacity": self._capacity(),
            "milestones": [
                {"id": item[0], "label": item[1], "done": item[0] in self.completed}
                for item in MILESTONES
            ],
            "systems": self.systems,
            "agents": reports(self.completed, ready_ids),
            "plan": plan,
            "recommended_id": ready_ids[0] if ready_ids else None,
            "transcript": self.transcript,
            "done": "stand_down" in self.completed,
        }

    def decide(self, action_id, decision):
        action = ACTIONS.get(action_id)
        if action is None:
            raise DecisionError("Unknown step.")
        if action_id in self.completed:
            raise DecisionError("That step is already done.")

        if decision == "hold":
            if action_id not in self.held:
                missing = [req for req in action["requires"] if req not in self.completed]
                if missing:
                    raise DecisionError("That step is not open yet.")
                self.held.append(action_id)
                self._say("you", action["owner"], f"Held: {action['title']}.")
                self._say(
                    "command",
                    "you",
                    "That step stays open. I will keep recommending it until you approve it.",
                )
            return self.view()

        if decision == "release":
            if action_id in self.held:
                self.held.remove(action_id)
                self._say("you", action["owner"], f"Returned to the queue: {action['title']}.")
            return self.view()

        if decision != "approve":
            raise DecisionError("Use approve, hold, or release.")

        missing = [ACTIONS[req]["title"] for req in action["requires"] if req not in self.completed]
        if missing:
            raise DecisionError("Earlier steps still open: " + "; ".join(missing) + ".")

        if action_id in self.held:
            self.held.remove(action_id)

        self.clock += timedelta(minutes=action["minutes"])
        for system_id, status in action["status"].items():
            self.system_map()[system_id]["status"] = status
        self.completed.append(action_id)
        self._say("you", action["owner"], f"Approved: {action['title']}.")
        for line in action["exchange"]:
            self._say(line["speaker"], line["to"], line["text"])
        return self.view()


def walk_recommended():
    """Happy path: approve each recommended step until the tabletop closes."""
    session = Session()
    try:
        session.decide("restore_ehr", "approve")
    except DecisionError:
        pass
    else:
        raise AssertionError("out-of-order restore should have failed")

    view = session.view()
    while not view["done"]:
        recommended = view["recommended_id"]
        if not recommended:
            raise AssertionError("plan stalled before close")
        view = session.decide(recommended, "approve")

    systems = session.system_map()
    assert systems["telemetry"]["status"] == "online"
    assert systems["nursecall"]["status"] == "online"
    assert systems["ehr"]["status"] == "recovered"
    assert systems["pacs"]["status"] == "recovered"
    assert systems["pharmacy"]["status"] == "recovered"
    assert systems["lab"]["status"] == "recovered"
    assert systems["backup"]["status"] == "verified"
    assert systems["email"]["status"] == "isolated"
    assert view["phase"] == "close"
    assert view["care_capacity"] == 100
    assert len(session.completed) == len(CATALOG)
    return view


if __name__ == "__main__":
    closing = walk_recommended()
    print(f"closed at {closing['clock']} with care capacity {closing['care_capacity']}")
