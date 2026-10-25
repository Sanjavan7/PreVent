const app = document.querySelector("#app");
let state = null;
let pending = false;
let error = "";

function h(tag, props = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value);
  }
  for (const kid of [].concat(kids)) {
    if (kid == null || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

async function openIncident() {
  booted = true;
  pending = true;
  error = "";
  render();
  try {
    state = await api("/api/session", { method: "POST", body: "{}" });
  } catch (err) {
    error = err.message;
  } finally {
    pending = false;
    render();
  }
}

async function decide(actionId, decision) {
  pending = true;
  error = "";
  render();
  try {
    state = await api("/api/session/decide", {
      method: "POST",
      body: JSON.stringify({ action_id: actionId, decision }),
    });
  } catch (err) {
    error = err.message;
  } finally {
    pending = false;
    render();
    const log = document.querySelector(".log");
    if (log) log.scrollTop = log.scrollHeight;
  }
}

function statusClass(status) {
  return status === "needs you" ? "needs" : status.replace(/\s+/g, "-");
}

function renderEmpty() {
  const agents = [
    ["Incident Command", "Orders care, containment, and restore so they do not collide."],
    ["Containment", "Isolates affected IT and leaves telemetry and nurse call up."],
    ["Clinical Continuity", "Switches the house to paper, then certifies the chart."],
    ["Recovery", "Restores a clean backup: directory, pharmacy and lab, EHR, imaging."],
    ["Communications", "Sends one notice to staff, leadership, and responders."],
    ["Compliance and Evidence", "Preserves logs and starts the HIPAA assessment clock."],
  ];
  return h("main", { className: "shell" }, [
    header(),
    h("section", { className: "hero" }, [
      h("h2", { text: "Tabletop" }),
      h("p", { className: "lede", text: "Six agents share one picture of a hospital ransomware incident. They propose recovery steps. You approve each one. Care stays up while the record systems come back from a clean backup." }),
      h("div", { className: "hero-grid" }, [
        h("div", {}, [
          h("h2", { text: "What this rehearses" }),
          h("ul", { className: "rehearse" }, [
            h("li", { text: "Keep ICU telemetry and nurse call in service." }),
            h("li", { text: "Put every unit on downtime procedures before changing the network." }),
            h("li", { text: "Isolate only the IT segments that are affected." }),
            h("li", { text: "Restore from a verified offline copy, in clinical order." }),
            h("li", { text: "Leave evidence and notification decisions on the record." }),
          ]),
          h("div", { className: "buttons", style: "margin-top: 18px" }, [
            h("button", {
              className: "primary",
              text: pending ? "Opening…" : "Open the Northbridge incident",
              disabled: pending,
              onClick: openIncident,
            }),
          ]),
          h("p", { className: "error", text: error }),
        ]),
        h("div", { className: "mandates" }, agents.map(([name, mandate]) => (
          h("div", { className: "mandate" }, [
            h("strong", { text: name }),
            h("span", { text: mandate }),
          ])
        ))),
      ]),
    ]),
    h("p", { className: "footnote", text: "Fictional hospital, fictional strain. For defense planning and education. Not a medical device." }),
  ]);
}

function header() {
  return h("header", { className: "top" }, [
    h("div", { className: "brand" }, [
      h("div", { className: "mark", text: "H" }),
      h("div", {}, [
        h("h1", { text: "Harbor" }),
        h("p", { className: "eyebrow", text: "Multi-agent recovery for a hospital ransomware incident" }),
      ]),
    ]),
    h("p", { className: "disclaimer", text: "Simulation only. Nothing here connects to a live hospital network, scans systems, or talks to malware." }),
  ]);
}

function renderSession() {
  const command = state.agents.find((agent) => agent.id === "command");
  const council = state.agents.filter((agent) => agent.id !== "command");
  const ready = state.plan.filter((step) => step.state === "ready" || step.state === "held");
  const phaseIndex = state.phases.findIndex((phase) => phase.id === state.phase);

  return h("main", { className: "shell" }, [
    header(),
    h("section", { className: "strip" }, [
      h("div", { className: "phase-row" }, state.phases.map((phase, index) => (
        h("span", {
          className: "phase" + (phase.id === state.phase ? " on" : index < phaseIndex ? " done" : ""),
          text: phase.label,
        })
      ))),
      h("div", { className: "meter-row" }, [
        h("strong", { text: `Care capacity ${state.care_capacity}%` }),
        h("div", { className: "capacity" }, [
          h("span", { style: `width:${state.care_capacity}%` }),
        ]),
        h("span", { className: "ops", text: `${state.incident.id} · ${state.clock} · ${state.operations}` }),
      ]),
      h("div", { className: "milestone-row" }, state.milestones.map((item) => (
        h("span", {
          className: "pill " + (item.done ? "recovered" : "waiting"),
          text: item.label,
        })
      ))),
    ]),
    h("section", { className: "layout" }, [
      h("div", { className: "col" }, [
        h("h2", { text: "House systems" }),
        h("div", { className: "systems" }, state.systems.map((system) => (
          h("article", { className: "system" }, [
            h("div", {}, [
              h("strong", { text: system.name }),
              h("small", { text: system.zone }),
            ]),
            h("span", { className: `pill ${system.status}`, text: system.status }),
          ])
        ))),
        h("p", { className: "ops", text: "Isolated means contained on purpose. Life-safety systems stay online." }),
      ]),
      h("div", { className: "col" }, [
        h("h2", { text: "Incident picture" }),
        h("article", { className: "card brief" }, [
          h("header", {}, [
            h("strong", { text: command.name }),
            h("span", { className: `pill ${statusClass(command.status)}`, text: command.status }),
          ]),
          h("p", { text: command.summary }),
          h("ul", { className: "findings" }, command.findings.map((item) => h("li", { text: item }))),
        ]),
        h("h2", { text: "Council" }),
        h("div", { className: "agents" }, council.map((agent) => (
          h("article", { className: "agent" }, [
            h("header", {}, [
              h("strong", { text: agent.name }),
              h("span", { className: `pill ${statusClass(agent.status)}`, text: agent.status }),
            ]),
            h("p", { text: agent.summary }),
          ])
        ))),
        h("h2", { text: "Council transcript" }),
        h("div", { className: "log" }, state.transcript.map((line) => (
          h("article", { className: "line" }, [
            h("div", { className: "who", text: `${line.time} · ${line.speaker_name} to ${line.to_name}` }),
            h("p", { text: line.text }),
          ])
        ))),
      ]),
      h("div", { className: "col" }, [
        h("h2", { text: "Your decisions" }),
        state.done
          ? h("div", { className: "done-note" }, [
              h("strong", { text: "Clinical systems are back in this simulation." }),
              h("p", { text: "Downtime is lifted. Email stays quarantined. The HIPAA assessment file stays open for counsel." }),
            ])
          : null,
        ...ready.map((step) => (
          h("article", {
            className: "action" + (step.id === state.recommended_id ? " recommended" : ""),
          }, [
            h("header", {}, [
              h("strong", { text: step.state === "held" ? "On hold" : step.id === state.recommended_id ? "Recommended" : "Also open" }),
              h("small", { text: step.owner_name }),
            ]),
            h("p", { text: step.title }),
            step.id === state.recommended_id || step.state === "held"
              ? h("p", { className: "ops", text: step.detail })
              : null,
            h("div", { className: "buttons" }, [
              h("button", {
                className: "primary",
                text: "Approve",
                disabled: pending,
                onClick: () => decide(step.id, "approve"),
              }),
              step.state === "held"
                ? h("button", {
                    className: "ghost",
                    text: "Release",
                    disabled: pending,
                    onClick: () => decide(step.id, "release"),
                  })
                : h("button", {
                    className: "ghost",
                    text: "Hold",
                    disabled: pending,
                    onClick: () => decide(step.id, "hold"),
                  }),
            ]),
          ])
        )),
        h("p", { className: "error", text: error }),
        h("h2", { text: "Full plan" }),
        h("div", { className: "plan" }, state.plan.map((step) => (
          h("div", { className: "plan-item" }, [
            h("div", {}, [
              h("strong", { text: step.title }),
              h("small", { text: step.owner_name }),
            ]),
            h("span", {
              className: "pill " + (step.state === "done" ? "recovered" : step.state === "ready" ? "needs" : "waiting"),
              text: step.state,
            }),
          ])
        ))),
        h("button", {
          className: "ghost",
          text: "Reset tabletop",
          disabled: pending,
          onClick: openIncident,
        }),
      ]),
    ]),
    h("p", {
      className: "footnote",
      text: `${state.incident.hospital} · ${state.incident.beds} beds · strain ${state.incident.strain}. Detected ${state.incident.detected} when EHR workstations showed lock screens. Education and defense planning only.`,
    }),
  ]);
}

function render() {
  app.replaceChildren(state && state.active ? renderSession() : renderEmpty());
}

let booted = false;
render();
fetch("/api/session")
  .then((response) => response.json())
  .then((payload) => {
    if (booted) return;
    booted = true;
    state = payload.active ? payload : null;
    render();
  })
  .catch(() => {
    booted = true;
  });
