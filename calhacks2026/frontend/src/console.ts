import { initScene } from "./twin.js";

declare const Chart: new (ctx: CanvasRenderingContext2D, config: unknown) => ChartInstance;
interface ChartInstance {
  data: { datasets: { data: Array<number | null> }[] };
  update(mode?: "none" | "active" | "resize" | "show" | "hide"): void;
}

const WS_URL: string = (() => {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const host = location.host || "localhost:8000";
  return `${scheme}://${host}/ws`;
})();
const API_BASE: string = location.origin && location.origin.startsWith("http")
  ? location.origin
  : "http://localhost:8000";

const MAX_POINTS = 60;

type SystemStatus =
  | "monitoring"
  | "anomaly_detected"
  | "llm_processing"
  | "flashing"
  | "patched";
type SensorKey = "temperature" | "pressure";
type AgentKey = "debugger" | "orchestrator" | "coder" | "verifier";
type AgentState = "idle" | "active" | "done" | "fail";
type LinkState = "connecting" | "connected" | "disconnected";

interface Sensors {
  temperature: number;
  pressure: number;
  fan?: number;
  alarm?: number;
}
interface TelemetryStats {
  temp_variance?: number;
  pressure_variance?: number;
}

interface TelemetryMsg {
  type: "telemetry";
  sensors: Sensors;
  anomaly: boolean;
  anomaly_confidence: number;
  stats?: TelemetryStats;
}
interface AnomalyMsg { type: "anomaly"; reason: string; compromised_sensor?: string; }
interface StatusMsg { type: "status"; status: SystemStatus; message?: string; }
interface LLMResponseMsg {
  type: "llm_response";
  used_fallback: boolean;
  analysis: string;
  code: string;
  timestamp: number;
}
interface FlashCompleteMsg {
  type: "flash_complete";
  success: boolean;
  message: string;
  output: string;
}
interface ConnectedMsg {
  type: "connected";
  simulate_serial: boolean;
  simulate_flash: boolean;
  force_fallback_llm: boolean;
  anomaly_count?: number;
  status?: SystemStatus;
}
interface ErrorMsg { type: "error"; message: string; }
interface LLMFailedMsg { type: "llm_failed"; message: string; timestamp?: number; }
interface AckMsg { type: "ack"; }

interface HardenStartedMsg { type: "harden_started"; timestamp: number; }
interface RedTeamPlanMsg {
  type: "red_team_plan";
  prose: string;
  code: string;
  lang: string;
  target: string;
  kind: string;
  magnitude: number;
  rationale?: string;
  used_fallback: boolean;
  timestamp: number;
}
interface HardenAttackLaunchedMsg {
  type: "harden_attack_launched";
  target: string;
  kind?: string;
  magnitude?: number;
  timestamp: number;
}
interface BlueTeamPatchMsg {
  type: "blue_team_patch";
  prose: string;
  code: string;
  lang: string;
  target: string;
  basis?: string[];
  intercept?: number;
  coefficients?: number[];
  r2?: number;
  used_fallback: boolean;
  timestamp: number;
}
interface HardenPatchAppliedMsg {
  type: "harden_patch_applied";
  target: string;
  intercept?: number;
  coefficients?: number[];
  basis?: string[];
  timestamp: number;
}
interface HardenExitedMsg { type: "harden_exited"; timestamp: number; }

type WsMessage =
  | TelemetryMsg | AnomalyMsg | StatusMsg | LLMResponseMsg
  | FlashCompleteMsg | LLMFailedMsg | ConnectedMsg | ErrorMsg | AckMsg
  | HardenStartedMsg | RedTeamPlanMsg | HardenAttackLaunchedMsg
  | BlueTeamPatchMsg | HardenPatchAppliedMsg | HardenExitedMsg;

function grab<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}
function grabOne<T extends Element>(selector: string): T {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`Missing element ${selector}`);
  return node as T;
}

function buildSpark(canvasId: string, color: string, yMin: number, yMax: number): ChartInstance {
  const canvas = grab<HTMLCanvasElement>(canvasId);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(`Canvas #${canvasId} has no 2d context`);
  return new Chart(ctx, {
    type: "line",
    data: {
      labels: Array(MAX_POINTS).fill(""),
      datasets: [{
        data: Array(MAX_POINTS).fill(null),
        borderColor: color,
        backgroundColor: `${color}22`,
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.35,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false, grid: { display: false } },
        y: { display: false, min: yMin, max: yMax, grid: { display: false } },
      },
    },
  });
}

const charts: Record<SensorKey, ChartInstance> = {
  temperature: buildSpark("tempChart", "#0d7a4f", 18, 32),
  pressure: buildSpark("pressureChart", "#0b5f8a", 990, 1040),
};

function feedChart(sensor: SensorKey, value: number): void {
  const series = charts[sensor].data.datasets[0];
  series.data.push(value);
  if (series.data.length > MAX_POINTS) series.data.shift();
  charts[sensor].update("none");
}

const ui = {
  systemStatus: grab<HTMLElement>("systemStatus"),
  anomalyCount: grab<HTMLElement>("anomalyCount"),
  linkStatus: grab<HTMLElement>("linkStatus"),
  clock: grab<HTMLElement>("clock"),
  tempReading: grab<HTMLElement>("tempReading"),
  pressureReading: grab<HTMLElement>("pressureReading"),
  fanReading: grab<HTMLElement>("fanReading"),
  alarmReading: grab<HTMLElement>("alarmReading"),
  alarmCard: grabOne<HTMLElement>('.sensor-mini[data-sensor="alarm"]'),
  tempTag: grab<HTMLElement>("tempTag"),
  pressureTag: grab<HTMLElement>("pressureTag"),
  modeBadge: grab<HTMLElement>("modeBadge"),
  btnAttack: grab<HTMLButtonElement>("btnAttack"),
  btnClear: grab<HTMLButtonElement>("btnClear"),
  btnHarden: grab<HTMLButtonElement>("btnHarden"),
  sidebarToggle: grab<HTMLButtonElement>("sidebarToggle"),
  layout: grab<HTMLElement>("layout"),
  canvas: grab<HTMLElement>("canvas"),

  detailBody: grab<HTMLElement>("detailBody"),
  detailName: grab<HTMLElement>("detailName"),
  detailTag: grab<HTMLElement>("detailTag"),
  detailDot: grab<HTMLElement>("detailDot"),

  incidentPanel: grab<HTMLElement>("incidentPanel"),
  incidentClose: grab<HTMLButtonElement>("incidentClose"),
  agentGraph: document.getElementById("agentGraph") as unknown as SVGSVGElement,
  graphViewport: document.getElementById("graphViewport") as unknown as SVGGElement,
  graphRecenter: grab<HTMLButtonElement>("graphRecenter"),
  graphEdges: document.getElementById("graphEdges") as unknown as SVGGElement,
  graphNodes: document.getElementById("graphNodes") as unknown as SVGGElement,

  redPanel: grab<HTMLElement>("redPanel"),
  bluePanel: grab<HTMLElement>("bluePanel"),
  redTag: grab<HTMLElement>("redTag"),
  blueTag: grab<HTMLElement>("blueTag"),
  redBody: grab<HTMLElement>("redBody"),
  blueBody: grab<HTMLElement>("blueBody"),
  btnRedAction: grab<HTMLButtonElement>("btnRedAction"),
  btnBlueAction: grab<HTMLButtonElement>("btnBlueAction"),
  btnExitHarden: grab<HTMLButtonElement>("btnExitHarden"),
};

ui.sidebarToggle.addEventListener("click", () => {
  ui.layout.classList.toggle("collapsed");
});

type AgentColorKey = "cyan" | "violet" | "accent" | "warn";

interface AgentInfo {
  state: AgentState;
  status: string;
  color: AgentColorKey;
  payload: AgentPayload | null;
}

interface AgentPayload {

  kind: "prose" | "code" | "stats" | "log" | "result";
  title: string;
  meta?: string;
  text?: string;
  code?: string;
  stats?: { k: string; v: string }[];
  lines?: string[];
  ok?: boolean;
}

const roster: Record<AgentKey, AgentInfo> = {
  debugger: { state: "idle", status: "MONITORING", color: "cyan", payload: null },
  orchestrator: { state: "idle", status: "IDLE", color: "violet", payload: null },
  coder: { state: "idle", status: "IDLE", color: "accent", payload: null },
  verifier: { state: "idle", status: "IDLE", color: "warn", payload: null },
};

const SVG_NS = "http://www.w3.org/2000/svg";

interface NodeSlot {
  key: AgentKey;
  x: number; y: number;
  parent: AgentKey | null;
  label: string;
  role: string;
}

const GRAPH_LAYOUT: Record<AgentKey, NodeSlot> = {
  debugger: { key: "debugger", x: 165, y: 70, parent: null, label: "Debugger", role: "reads sensor logs" },
  orchestrator: { key: "orchestrator", x: 210, y: 175, parent: "debugger", label: "Orchestrator", role: "plans response" },
  coder: { key: "coder", x: 130, y: 285, parent: "orchestrator", label: "Coding Agent", role: "synthesises patch" },
  verifier: { key: "verifier", x: 195, y: 395, parent: "coder", label: "Verifier", role: "compiles & flashes" },
};

const NODE_RADIUS = 22;

interface ViewTransform { x: number; y: number; k: number }
interface PanSession {
  startX: number; startY: number;
  origX: number; origY: number;
  dragging: boolean;
}

class AgentGraph {
  private spawned = new Set<AgentKey>();
  private view: ViewTransform = { x: 0, y: 0, k: 1 };
  private pan: PanSession | null = null;
  private swallowClick = false;

  constructor(
    private svg: SVGSVGElement,
    private viewport: SVGGElement,
    private edgesHost: SVGGElement,
    public readonly nodesHost: SVGGElement,
  ) {
    this.bind();
    this.paint();
  }

  private paint(): void {
    const { x, y, k } = this.view;
    this.viewport.setAttribute("transform", `translate(${x} ${y}) scale(${k})`);
  }

  home(): void {
    this.view = { x: 0, y: 0, k: 1 };
    this.paint();
  }

  private toSvg(clientX: number, clientY: number): { x: number; y: number } {
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const inv = ctm.inverse();
    return {
      x: clientX * inv.a + clientY * inv.c + inv.e,
      y: clientX * inv.b + clientY * inv.d + inv.f,
    };
  }

  private bind(): void {
    this.svg.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      const p = this.toSvg(e.clientX, e.clientY);
      this.pan = { startX: p.x, startY: p.y, origX: this.view.x, origY: this.view.y, dragging: false };
      this.svg.classList.add("is-panning");
    });
    window.addEventListener("mousemove", (e: MouseEvent) => {
      if (!this.pan) return;
      const cur = this.toSvg(e.clientX, e.clientY);
      const dx = cur.x - this.pan.startX;
      const dy = cur.y - this.pan.startY;
      if (!this.pan.dragging && Math.hypot(dx, dy) > 4) this.pan.dragging = true;
      this.view.x = this.pan.origX + dx;
      this.view.y = this.pan.origY + dy;
      this.paint();
    });
    const release = (): void => {
      if (!this.pan) return;
      this.svg.classList.remove("is-panning");
      if (this.pan.dragging) {
        this.swallowClick = true;
        setTimeout(() => { this.swallowClick = false; }, 0);
      }
      this.pan = null;
    };
    window.addEventListener("mouseup", release);
    window.addEventListener("mouseleave", release);
    this.svg.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        const cur = this.toSvg(e.clientX, e.clientY);
        const step = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const k = Math.max(0.4, Math.min(3.5, this.view.k * step));
        if (k === this.view.k) return;
        const localX = (cur.x - this.view.x) / this.view.k;
        const localY = (cur.y - this.view.y) / this.view.k;
        this.view.x = cur.x - localX * k;
        this.view.y = cur.y - localY * k;
        this.view.k = k;
        this.paint();
      },
      { passive: false },
    );
  }

  raise(key: AgentKey): void {
    if (this.spawned.has(key)) return;
    this.spawned.add(key);
    const slot = GRAPH_LAYOUT[key];
    if (slot.parent) this.drawEdge(slot);
    this.spawnNode(key, slot);
  }

  private drawEdge(slot: NodeSlot): void {
    const parent = GRAPH_LAYOUT[slot.parent as AgentKey];
    const path = document.createElementNS(SVG_NS, "path");
    path.classList.add("graph-edge");
    path.setAttribute("data-edge-to", slot.key);

    const dx = slot.x - parent.x;
    const c1x = parent.x + dx * 0.25;
    const c1y = parent.y + (slot.y - parent.y) * 0.5;
    const c2x = parent.x + dx * 0.75;
    const c2y = parent.y + (slot.y - parent.y) * 0.5;

    const heading = Math.atan2(slot.y - parent.y, slot.x - parent.x);
    const sx = parent.x + Math.cos(heading) * NODE_RADIUS;
    const sy = parent.y + Math.sin(heading) * NODE_RADIUS;
    const ex = slot.x - Math.cos(heading) * NODE_RADIUS;
    const ey = slot.y - Math.sin(heading) * NODE_RADIUS;
    path.setAttribute("d", `M ${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey}`);
    this.edgesHost.appendChild(path);

    const len = (path as SVGPathElement).getTotalLength();
    path.setAttribute("stroke-dasharray", String(len));
    path.setAttribute("stroke-dashoffset", String(len));
    requestAnimationFrame(() => path.setAttribute("stroke-dashoffset", "0"));
  }

  private spawnNode(key: AgentKey, slot: NodeSlot): void {

    const node = document.createElementNS(SVG_NS, "g");
    node.classList.add("graph-node");
    node.setAttribute("data-agent", key);
    node.setAttribute("data-state", "idle");
    node.setAttribute("data-spawned", "false");
    node.setAttribute("transform", `translate(${slot.x} ${slot.y})`);

    const animWrap = document.createElementNS(SVG_NS, "g");
    animWrap.classList.add("graph-node-anim");
    node.appendChild(animWrap);

    const ring = document.createElementNS(SVG_NS, "circle");
    ring.classList.add("node-halo");
    ring.setAttribute("r", String(NODE_RADIUS + 2));
    animWrap.appendChild(ring);

    const disc = document.createElementNS(SVG_NS, "circle");
    disc.classList.add("node-bg");
    disc.setAttribute("r", String(NODE_RADIUS));
    animWrap.appendChild(disc);

    const caption = document.createElementNS(SVG_NS, "text");
    caption.classList.add("node-label");
    caption.setAttribute("y", String(NODE_RADIUS + 16));
    caption.textContent = slot.label;
    animWrap.appendChild(caption);

    const subtitle = document.createElementNS(SVG_NS, "text");
    subtitle.classList.add("node-role");
    subtitle.setAttribute("y", String(NODE_RADIUS + 30));
    subtitle.textContent = slot.role;
    animWrap.appendChild(subtitle);

    node.addEventListener("click", (ev) => {
      if (this.swallowClick) { ev.stopPropagation(); return; }
      focusAgent(key);
    });

    this.nodesHost.appendChild(node);

    requestAnimationFrame(() => node.setAttribute("data-spawned", "true"));
  }

  node(key: AgentKey): SVGGElement | null {
    return this.nodesHost.querySelector<SVGGElement>(`[data-agent="${key}"]`);
  }

  wipe(): void {
    this.spawned.clear();
    this.edgesHost.innerHTML = "";
    this.nodesHost.innerHTML = "";
    this.home();
  }
}

const graph = new AgentGraph(ui.agentGraph, ui.graphViewport, ui.graphEdges, ui.graphNodes);

ui.graphRecenter.addEventListener("click", (e) => {
  e.stopPropagation();
  graph.home();
});

function raiseAgent(key: AgentKey): void {
  graph.raise(key);
}

function findNode(key: AgentKey): SVGGElement | null {
  return graph.node(key);
}

function flagAgent(key: AgentKey, state: AgentState, status?: string): void {
  roster[key].state = state;
  if (status) roster[key].status = status;
  const node = findNode(key);
  if (node) node.setAttribute("data-state", state);
  syncFeedRow(key);
  if (state === "active") focusAgent(key);
  else if (focused === key) paintDetail(key);
}

function wipeGraph(): void {
  graph.wipe();
}

function previewOf(payload: AgentPayload | null): string {
  if (!payload) return "—";
  const chunks: string[] = [];
  if (payload.text) chunks.push(String(payload.text));
  if (payload.code) chunks.push(String(payload.code).split("\n").slice(0, 4).join("\n"));
  if (Array.isArray(payload.lines)) chunks.push(payload.lines.slice(-4).join("\n"));
  if (Array.isArray(payload.stats)) chunks.push(payload.stats.map((s) => `${s.k}=${s.v}`).join("  "));
  return chunks.join("\n").trim() || "—";
}

function syncFeedRow(key: AgentKey): void {
  const agent = roster[key];
  const stateEl = document.getElementById(`feedState_${key}`);
  const textEl = document.getElementById(`feedText_${key}`);
  const rowEl = document.querySelector<HTMLElement>(`.agent-feed-row[data-agent="${key}"]`);
  if (!stateEl || !textEl || !rowEl) return;
  stateEl.textContent = (agent.status || agent.state || "idle").toLowerCase();
  rowEl.dataset.state = agent.state;
  textEl.textContent = previewOf(agent.payload);
}

function syncAllFeeds(): void {
  (Object.keys(roster) as AgentKey[]).forEach(syncFeedRow);
}

function showIncident(): void {
  ui.incidentPanel.dataset.open = "true";
}
function hideIncident(): void {
  ui.incidentPanel.dataset.open = "false";
  markIncident("active");
}
function markIncident(phase: "active" | "patched"): void {

  ui.incidentPanel.dataset.status = phase;
  const title = document.getElementById("incidentTitleText");
  if (title) title.textContent = phase === "patched" ? "Patched" : "Incident Response";
}
ui.incidentClose.addEventListener("click", () => {
  hideIncident();
  fullReset();
});

function fullReset(): void {
  roster.debugger = { state: "idle", status: "MONITORING", color: "cyan", payload: null };
  roster.orchestrator = { state: "idle", status: "IDLE", color: "violet", payload: null };
  roster.coder = { state: "idle", status: "IDLE", color: "accent", payload: null };
  roster.verifier = { state: "idle", status: "IDLE", color: "warn", payload: null };
  wipeGraph();
  focusAgent(null);
  syncAllFeeds();
}

let focused: AgentKey | null = null;

const AGENT_TITLES: Record<AgentKey, string> = {
  debugger: "Debugger Agent",
  orchestrator: "Orchestrator Agent",
  coder: "Coding Agent",
  verifier: "Verifier Agent",
};

function focusAgent(key: AgentKey | null): void {
  focused = key;
  graph.nodesHost.querySelectorAll<SVGGElement>(".graph-node").forEach((n) => {
    n.classList.toggle("selected", n.getAttribute("data-agent") === key);
  });
  paintDetail(key);
}

function paintDetail(key: AgentKey | null): void {
  if (!key) {
    ui.detailName.textContent = "Awaiting incident";
    ui.detailTag.textContent = "STANDBY";
    ui.detailTag.removeAttribute("data-c");
    ui.detailDot.removeAttribute("data-c");
    ui.detailBody.innerHTML = `
      <div class="detail-placeholder">
        The mesh is monitoring telemetry. When the Debugger flags an anomaly,
        the Orchestrator dispatches the Coding Agent to synthesise a virtual-sensor
        patch, and the Verifier compiles and flashes it.
      </div>`;
    return;
  }

  const agent = roster[key];
  ui.detailName.textContent = AGENT_TITLES[key];
  ui.detailDot.dataset.c = agent.color;
  ui.detailTag.textContent = agent.status;
  ui.detailTag.dataset.c = agent.color;

  if (!agent.payload) {
    ui.detailBody.innerHTML = `<div class="detail-placeholder">No output yet from ${AGENT_TITLES[key]}.</div>`;
    return;
  }

  const p = agent.payload;
  if (p.kind === "code" && p.code) {
    const filename = (p as AgentPayload & { filename?: string }).filename || "virtual_sensor.ino";
    ui.detailBody.innerHTML = `
      <div class="detail-prose">
        ${p.meta ? `<div class="meta">${htmlSafe(p.meta)}</div>` : ""}
        ${p.text ? `<p>${htmlSafe(p.text)}</p>` : ""}
      </div>
      <div class="editor" data-lang="cpp">
        <div class="editor-tabs">
          <span class="editor-dot" data-c="r"></span>
          <span class="editor-dot" data-c="y"></span>
          <span class="editor-dot" data-c="g"></span>
          <span class="editor-tab active">${htmlSafe(filename)}</span>
          <span class="editor-lang">C++ · Arduino</span>
        </div>
        <div class="editor-pane">
          <pre class="editor-gutter" id="editorGutter">1</pre>
          <pre class="editor-code"><code id="liveCode"></code></pre>
        </div>
      </div>
    `;
    mountCode(grab<HTMLElement>("liveCode"), p.code);
    return;
  }

  if (p.kind === "stats" && p.stats) {
    const meta = p.meta ? `<div class="meta">${htmlSafe(p.meta)}</div>` : "";
    const text = p.text ? `<p>${htmlSafe(p.text)}</p>` : "";
    const cells = p.stats.map((s) =>
      `<div class="stat"><span class="stat-k">${htmlSafe(s.k)}</span><span class="stat-v">${htmlSafe(s.v)}</span></div>`
    ).join("");
    ui.detailBody.innerHTML = `
      <div class="detail-prose">
        ${meta}
        ${text}
        <div class="stats">${cells}</div>
      </div>`;
    return;
  }

  if (p.kind === "log" && p.lines) {
    const meta = p.meta ? `<div class="meta">${htmlSafe(p.meta)}</div>` : "";
    const text = p.text ? `<p>${htmlSafe(p.text)}</p>` : "";
    const body = p.lines.map(htmlSafe).join("\n");
    ui.detailBody.innerHTML = `
      <div class="detail-prose">
        ${meta}
        ${text}
        <pre class="detail-log">${body}</pre>
      </div>`;
    return;
  }

  if (p.kind === "result") {
    ui.detailTag.dataset.c = p.ok ? "accent" : "danger";
    ui.detailBody.innerHTML = `
      <div class="detail-prose">
        ${p.meta ? `<div class="meta">${htmlSafe(p.meta)}</div>` : ""}
        <p>${htmlSafe(p.text ?? "")}</p>
        ${p.code ? `<pre class="detail-code">${htmlSafe(p.code)}</pre>` : ""}
      </div>`;
    return;
  }

  ui.detailBody.innerHTML = `
    <div class="detail-prose">
      ${p.meta ? `<div class="meta">${htmlSafe(p.meta)}</div>` : ""}
      ${p.text ? `<p>${htmlSafe(p.text)}</p>` : ""}
    </div>`;
}

function htmlSafe(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] ?? c));
}

const KW_SET = new Set([
  "if", "else", "return", "for", "while", "do", "switch", "case", "break", "continue",
  "const", "constexpr", "static", "extern", "struct", "class", "enum", "public", "private", "protected",
  "namespace", "using", "typedef", "sizeof", "new", "delete", "this", "template",
  "true", "false", "nullptr", "NULL", "inline", "virtual", "override", "final",
]);
const TYPE_SET = new Set([
  "void", "int", "float", "double", "bool", "char", "long", "short", "unsigned", "signed",
  "auto", "uint8_t", "uint16_t", "uint32_t", "int8_t", "int16_t", "int32_t",
  "size_t", "byte", "word", "String", "HardwareSerial",
]);

interface CppToken { cls: string | null; text: string }

function lexCpp(src: string): CppToken[] {
  const tokens: CppToken[] = [];
  const end = src.length;
  let i = 0;
  let lineStart = true;

  const emit = (cls: string | null, text: string): void => { tokens.push({ cls, text }); };
  const run = (re: RegExp, from: number): number => {
    let j = from;
    while (j < end && re.test(src[j])) j++;
    return j;
  };

  while (i < end) {
    const ch = src[i];
    if (ch === "\n") { emit(null, "\n"); i++; lineStart = true; continue; }
    if (ch === " " || ch === "\t" || ch === "\r") { emit(null, ch); i++; continue; }

    if (ch === "/" && src[i + 1] === "/") {
      const j = run(/[^\n]/, i);
      emit("tok-com", src.slice(i, j));
      i = j; lineStart = false; continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      let j = i + 2;
      while (j < end - 1 && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(end, j + 2);
      emit("tok-com", src.slice(i, j));
      i = j; lineStart = false; continue;
    }
    if (ch === "#" && lineStart) {
      const j = run(/[^\n]/, i);
      emit("tok-prep", src.slice(i, j));
      i = j; continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < end && src[j] !== quote) {
        j += (src[j] === "\\" && j + 1 < end) ? 2 : 1;
      }
      j = Math.min(end, j + 1);
      emit("tok-str", src.slice(i, j));
      i = j; lineStart = false; continue;
    }
    if (ch >= "0" && ch <= "9") {
      const j = run(/[0-9.fFxXa-fA-FuUlL]/, i);
      emit("tok-num", src.slice(i, j));
      i = j; lineStart = false; continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < end && /[A-Za-z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      let k = j;
      while (k < end && (src[k] === " " || src[k] === "\t")) k++;
      let cls: string | null = null;
      if (KW_SET.has(word)) cls = "tok-kw";
      else if (TYPE_SET.has(word)) cls = "tok-type";
      else if (src[k] === "(") cls = "tok-fn";
      emit(cls, word);
      i = j; lineStart = false; continue;
    }
    if ("+-*/%=<>!&|^~?:".includes(ch)) {
      emit("tok-op", ch);
      i++; lineStart = false; continue;
    }
    emit(null, ch);
    i++; lineStart = false;
  }
  return tokens;
}

function colorizeCpp(src: string): string {
  return lexCpp(src)
    .map((t) => (t.cls ? `<span class="${t.cls}">${htmlSafe(t.text)}</span>` : htmlSafe(t.text)))
    .join("");
}

function lineNumbers(text: string): string {
  const count = text.split("\n").length;
  const rows: string[] = new Array(count);
  for (let n = 0; n < count; n++) rows[n] = String(n + 1);
  return rows.join("\n");
}

function mountCode(target: HTMLElement, code: string): void {

  target.innerHTML = colorizeCpp(code);
  const gutter = document.getElementById("editorGutter");
  if (gutter) gutter.textContent = lineNumbers(code);

  const pre = target.closest("pre") as HTMLElement | null;
  if (pre) pre.scrollTop = 0;
  if (gutter) gutter.scrollTop = 0;
  const body = target.closest(".detail-body") as HTMLElement | null;
  if (body) body.scrollTop = 0;
}

function paintSystemState(status: SystemStatus): void {
  ui.systemStatus.textContent = status.toUpperCase().replace(/_/g, " ");
  ui.systemStatus.dataset.state = status;
}
function paintLink(state: LinkState): void {
  ui.linkStatus.textContent = state.toUpperCase();
  ui.linkStatus.dataset.state = state;
}

interface HighlightRoute {
  card?: string;
  mini?: string;
  tagId?: string;
  label: string;
}
let flaggedSensor: string | null = null;
let incidentOn = false;
let lastBadgeKey: string | null = null;

const HIGHLIGHT_ROUTES: Record<string, HighlightRoute> = {
  temperature: { card: '.sensor-card[data-sensor="temperature"]', tagId: "tempTag", label: "TEMPERATURE" },
  pressure: { card: '.sensor-card[data-sensor="pressure"]', tagId: "pressureTag", label: "PRESSURE" },
};

function resetSensorBadges(): void {
  document.querySelectorAll<HTMLElement>('.sensor-card[data-flatlined="true"]').forEach((el) => {
    el.dataset.flatlined = "false";
  });
  document.querySelectorAll<HTMLElement>('.sensor-mini[data-state="compromised"]').forEach((el) => {
    el.dataset.state = "";
  });
  ["tempTag", "pressureTag"].forEach((id) => {
    const tag = document.getElementById(id);
    if (!tag) return;
    tag.textContent = "NOMINAL";
    tag.dataset.state = "";
  });
}

function flagCompromised(active: boolean): void {

  const key = active ? (flaggedSensor || "temperature") : null;
  if (key === lastBadgeKey) return;
  lastBadgeKey = key;
  resetSensorBadges();
  if (!key) return;
  const route = HIGHLIGHT_ROUTES[key] || HIGHLIGHT_ROUTES.temperature;
  if (route.card) {
    const card = document.querySelector<HTMLElement>(route.card);
    if (card) card.dataset.flatlined = "true";
  }
  if (route.tagId) {
    const tag = document.getElementById(route.tagId);
    if (tag) {
      tag.textContent = "FLATLINED";
      tag.dataset.state = "anomaly";
    }
  }
  if (route.mini) {
    const mini = document.querySelector<HTMLElement>(route.mini);
    if (mini) mini.dataset.state = "compromised";
  }
}

function onTelemetry(msg: TelemetryMsg): void {
  const { sensors, anomaly, stats } = msg;

  feedChart("temperature", sensors.temperature);
  feedChart("pressure", sensors.pressure);

  ui.tempReading.innerHTML = `${sensors.temperature.toFixed(2)} <span>°C</span>`;
  ui.pressureReading.innerHTML = `${sensors.pressure.toFixed(2)} <span>hPa</span>`;

  if (sensors.fan !== undefined) {
    const duty = Math.max(0, Math.min(255, sensors.fan));
    const speed = Math.round((duty / 255) * 100);
    ui.fanReading.innerHTML = `${speed} <em>%</em>`;
  }
  if (sensors.alarm !== undefined) {
    const tripped = sensors.alarm !== 0;
    ui.alarmReading.textContent = tripped ? "ACTIVE" : "CLEAR";
    ui.alarmCard.dataset.state = tripped ? "active" : "";
  }

  flagCompromised(anomaly || incidentOn);
  if (twin) {
    twin.setBenchState({
      fan: sensors.fan,
      alarm: (sensors.alarm ?? 0) !== 0,
      pressure: sensors.pressure,
    });
    twin.setSensorFailure(
      "spa",
      (anomaly || incidentOn) && (flaggedSensor === "pressure" || flaggedSensor === "temperature"),
    );
    twin.setSensorFailure(
      "buzzer",
      (anomaly || incidentOn) && flaggedSensor === "temperature",
    );
  }

  if (stats && roster.debugger.state !== "active") {
    const stamp = new Date().toISOString().slice(11, 19);
    const fmt = (v: number | undefined, d: number) =>
      v === undefined ? "—" : v.toFixed(d);
    roster.debugger.payload = {
      kind: "log",
      title: "Telemetry",
      meta: "live channel variances",
      text: anomaly ? "Variance collapse detected — escalating." : "All channels nominal.",
      lines: [
        `[${stamp}] [LOG:Temp]   variance=${fmt(stats.temp_variance, 4)}`,
        `[${stamp}] [LOG:Press]  variance=${fmt(stats.pressure_variance, 2)}`,
      ],
    };
    syncFeedRow("debugger");
    if (focused === "debugger") paintDetail("debugger");
  }
}

function onAnomaly(msg: AnomalyMsg): void {
  paintSystemState("anomaly_detected");
  flaggedSensor = msg.compromised_sensor || "temperature";
  incidentOn = true;
  flagCompromised(true);

  wipeGraph();
  showIncident();
  markIncident("active");
  raiseAgent("debugger");
  flagAgent("debugger", "active", "ANALYSING");
  const sensorLabel = HIGHLIGHT_ROUTES[flaggedSensor]?.label || flaggedSensor.toUpperCase();
  roster.debugger.payload = {
    kind: "prose",
    title: "Debugger",
    meta: `anomaly_detected · ${sensorLabel} · ${new Date().toISOString().slice(11, 19)}`,
    text: msg.reason,
  };
  syncFeedRow("debugger");
  if (focused === "debugger") paintDetail("debugger");
}

function onStatus(msg: StatusMsg): void {
  paintSystemState(msg.status);
  switch (msg.status) {
    case "monitoring":

      incidentOn = false;
      flaggedSensor = null;
      flagCompromised(false);
      break;
    case "anomaly_detected":
      showIncident();
      raiseAgent("debugger");
      flagAgent("debugger", "active", "ANALYSING");
      break;
    case "llm_processing":
      flagAgent("debugger", "done", "REPORTED");

      setTimeout(() => {
        raiseAgent("orchestrator");
        flagAgent("orchestrator", "active", "REASONING");
        playReasoning();
      }, 250);
      break;
    case "flashing":
      flagAgent("coder", "done", "PATCH READY");
      setTimeout(() => {
        raiseAgent("verifier");
        flagAgent("verifier", "active", "FLASHING");
        roster.verifier.payload = {
          kind: "prose",
          title: "Verifier",
          meta: "compiling firmware patch",
          text: msg.message ?? "Compiling and flashing the synthesised virtual-sensor patch onto the target MCU…",
        };
        syncFeedRow("verifier");
        if (focused === "verifier") paintDetail("verifier");
      }, 250);
      break;
    case "patched":
      flagAgent("verifier", "done", "VERIFIED");
      break;
  }
}

let logTimer: ReturnType<typeof setInterval> | null = null;
function playReasoning(): void {
  if (logTimer) {
    clearInterval(logTimer);
    logTimer = null;
  }
  const stamp = (): string => new Date().toISOString().slice(11, 19);
  const script = [
    "received variance-collapse signal from Debugger",
    "classifying incident: SPA06 channel stopped tracking",
    "selecting strategy: synthesise virtual sensor (regression)",
    "packaging telemetry window (60 samples, temperature and pressure)",
    "dispatching prompt to air-gapped coder model",
    "awaiting candidate patch…",
  ];
  const lines: string[] = [];
  roster.orchestrator.payload = {
    kind: "log",
    title: "Orchestrator",
    meta: "log of reasoning",
    lines,
  };
  syncFeedRow("orchestrator");
  if (focused === "orchestrator") paintDetail("orchestrator");
  let i = 0;
  logTimer = setInterval(() => {
    if (i >= script.length || roster.orchestrator.state !== "active") {
      if (logTimer) clearInterval(logTimer);
      logTimer = null;
      return;
    }
    lines.push(`[${stamp()}] [LOR] ${script[i++]}`);
    syncFeedRow("orchestrator");
    if (focused === "orchestrator") paintDetail("orchestrator");
  }, 650);
}

const DEMO_FIRMWARE_NAME = "virtual_temperature.ino";
const DEMO_FIRMWARE = `const float K0 = 18.423100f;
const float K1 = 0.006120f;

float virtualTemperature(float pressureHpa) {
  return K0 + K1 * pressureHpa;
}

void setup() {
  Serial.begin(115200);
  Serial.println("CALHACKS PATCH LOADED");
}

void loop() {
  float pressureHpa = 1013.25f;
  float temp = virtualTemperature(pressureHpa);
  Serial.print("VIRTUAL_SENSOR_ACTIVE T=");
  Serial.println(temp, 2);
  delay(1000);
}
`;

function onPatchDraft(msg: LLMResponseMsg): void {
  flagAgent("orchestrator", "done", "PLAN READY");
  setTimeout(() => {
    raiseAgent("coder");
    flagAgent("coder", "active", "SYNTHESISING");
    roster.coder.payload = {
      kind: "code",
      title: "Coding Agent",
      filename: DEMO_FIRMWARE_NAME,
      meta: `${msg.used_fallback ? "fallback" : "ai"} · bedside · ${DEMO_FIRMWARE.length} bytes · ${new Date(msg.timestamp * 1000).toISOString().slice(11, 19)}`,
      text: msg.analysis,
      code: DEMO_FIRMWARE,
    } as AgentPayload & { filename: string };
    syncFeedRow("coder");
    focusAgent("coder");
  }, 250);
}

function onFlashDone(msg: FlashCompleteMsg): void {
  if (msg.success) {
    flagAgent("verifier", "done", "COMPILED ✓");
    roster.verifier.payload = {
      kind: "result",
      title: "Verifier",
      meta: "flash_complete · success",
      text: msg.message,
      code: msg.output.split("\n").slice(0, 12).join("\n"),
      ok: true,
    };
    syncFeedRow("verifier");
    if (focused === "verifier") paintDetail("verifier");

    markIncident("patched");
    incidentOn = false;
    flaggedSensor = null;
    flagCompromised(false);
  } else {
    flagAgent("verifier", "fail", "FLASH FAILED");
    roster.verifier.payload = {
      kind: "result",
      title: "Verifier",
      meta: "flash_complete · failure",
      text: msg.message,
      code: msg.output,
      ok: false,
    };
    syncFeedRow("verifier");
    if (focused === "verifier") paintDetail("verifier");
  }
}

function onModelDown(msg: LLMFailedMsg): void {
  flagAgent("orchestrator", "fail", "LLM UNREACHABLE");
  roster.orchestrator.payload = {
    kind: "prose",
    title: "Orchestrator",
    meta: "llm_failed",
    text: msg.message || "Local LLM unreachable.",
  };
  syncFeedRow("orchestrator");
  if (focused === "orchestrator") paintDetail("orchestrator");
}

function onHello(msg: ConnectedMsg): void {
  ui.modeBadge.textContent = msg.simulate_serial ? "SIMULATION" : "LIVE HARDWARE";
  ui.anomalyCount.textContent = String(msg.anomaly_count ?? 0);
  paintSystemState(msg.status ?? "monitoring");
}

let sock: WebSocket | null = null;
let backoff = 500;

function dial(): void {
  paintLink("connecting");
  sock = new WebSocket(WS_URL);

  sock.onopen = () => {
    paintLink("connected");
    backoff = 500;
  };

  sock.onmessage = (ev: MessageEvent<string>) => {
    let msg: WsMessage;
    try { msg = JSON.parse(ev.data) as WsMessage; }
    catch { return; }

    switch (msg.type) {
      case "telemetry": onTelemetry(msg); break;
      case "anomaly":
        onAnomaly(msg);
        ui.anomalyCount.textContent = String(parseInt(ui.anomalyCount.textContent ?? "0", 10) + 1);
        break;
      case "status": onStatus(msg); break;
      case "llm_response": onPatchDraft(msg); break;
      case "flash_complete": onFlashDone(msg); break;
      case "llm_failed": onModelDown(msg); break;
      case "connected": onHello(msg); break;
      case "harden_started": break;
      case "red_team_plan": onRedPlan(msg); break;
      case "harden_attack_launched": onAttackLive(msg); break;
      case "blue_team_patch": onBluePatch(msg); break;
      case "harden_patch_applied": onPatchLive(msg); break;
      case "harden_exited": disarmHarden(); break;
      case "error": case "ack": break;
    }
  };

  sock.onclose = () => {
    paintLink("disconnected");
    setTimeout(dial, backoff);
    backoff = Math.min(backoff * 2, 5000);
  };

  sock.onerror = () => {  };
}

async function postAction(path: string): Promise<void> {
  try { await fetch(`${API_BASE}${path}`, { method: "POST" }); }
  catch {  }
}

type HardenPhase = "idle" | "armed" | "planning" | "planned" | "attacking" | "patching" | "patched";
type HardenStep = "recon" | "attack" | "analysis" | "patch";
type StepState = "idle" | "active" | "done";
let hardenPhase: HardenPhase = "idle";

const PIPELINE_ORDER: HardenStep[] = ["recon", "attack", "analysis", "patch"];
const PIPELINE_TEAMS: Record<HardenStep, "red" | "blue"> = {
  recon: "red", attack: "red", analysis: "blue", patch: "blue",
};
const litSteps: HardenStep[] = [];

function pipelineCard(step: HardenStep): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#hardenStepsNodes .step-card[data-step="${step}"]`);
}

function pipelineSlot(i: number, n: number): { x: number; y: number } {
  return {
    x: n <= 1 ? 50 : 14 + (i / (n - 1)) * 72,
    y: i % 2 === 0 ? 35 : 70,
  };
}

function reflowPipeline(): void {
  const n = litSteps.length;
  ui.canvas.setAttribute("data-pipeline-active", n > 0 ? "true" : "false");
  for (const step of PIPELINE_ORDER) {
    const card = pipelineCard(step);
    if (!card) continue;
    const idx = litSteps.indexOf(step);
    if (idx === -1) {
      card.removeAttribute("data-visible");
      continue;
    }
    const { x, y } = pipelineSlot(idx, n);
    card.style.left = `${x}%`;
    card.style.top = `${y}%`;
    card.setAttribute("data-visible", "true");
  }

  const wireHost = document.getElementById("hardenStepsEdges");
  if (!wireHost) return;
  while (wireHost.firstChild) wireHost.removeChild(wireHost.firstChild);
  for (let i = 0; i < n - 1; i++) {
    const a = pipelineSlot(i, n);
    const b = pipelineSlot(i + 1, n);
    const wire = document.createElementNS(SVG_NS, "line");
    wire.classList.add("step-edge");
    wire.setAttribute("data-from", litSteps[i]);
    wire.setAttribute("data-to", litSteps[i + 1]);
    wire.setAttribute("x1", String(a.x));
    wire.setAttribute("y1", String(a.y));
    wire.setAttribute("x2", String(b.x));
    wire.setAttribute("y2", String(b.y));
    wireHost.appendChild(wire);
  }
  syncWires();
}

function revealStep(step: HardenStep): void {
  if (litSteps.includes(step)) return;
  litSteps.push(step);
  reflowPipeline();
}

function markStep(step: HardenStep, state: StepState): void {
  if (state === "active" || state === "done") revealStep(step);
  const card = pipelineCard(step);
  if (card) card.setAttribute("data-state", state);
  syncWires();
}

function syncWires(): void {
  document.querySelectorAll<SVGLineElement>("#hardenStepsEdges .step-edge").forEach((wire) => {
    const from = wire.dataset.from as HardenStep;
    const to = wire.dataset.to as HardenStep;
    const fromState = pipelineCard(from)?.getAttribute("data-state") ?? "idle";
    const toState = pipelineCard(to)?.getAttribute("data-state") ?? "idle";
    wire.removeAttribute("data-active");
    wire.removeAttribute("data-upstream-done");
    if (fromState === "done" && toState === "active") {
      wire.setAttribute("data-active", "true");
    } else if (fromState === "done") {
      wire.setAttribute("data-upstream-done", PIPELINE_TEAMS[from]);
    }
  });
}

function wipePipeline(): void {
  litSteps.length = 0;
  for (const step of PIPELINE_ORDER) {
    const card = pipelineCard(step);
    if (!card) continue;
    card.setAttribute("data-state", "idle");
    card.removeAttribute("data-visible");
  }
  ui.canvas.setAttribute("data-pipeline-active", "false");
  const wireHost = document.getElementById("hardenStepsEdges");
  if (wireHost) while (wireHost.firstChild) wireHost.removeChild(wireHost.firstChild);
}

function tell(action: string, extra: Record<string, unknown> = {}): void {
  if (!sock || sock.readyState !== WebSocket.OPEN) return;
  sock.send(JSON.stringify({ action, ...extra }));
}

function mdInline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|\W)_([^_\n]+)_(\W|$)/g, "$1<em>$2</em>$3");
}

type MdState = "flow" | "code";
type MdRule = (line: string, row: string) => MdState | null;

function mdRender(src: string): string {

  const out: string[] = [];
  const buf = {
    para: [] as string[],
    listTag: null as "ul" | "ol" | null,
    fenceLang: "",
    fenceBuf: [] as string[],
  };

  const flush = {
    para(): void {
      if (!buf.para.length) return;
      out.push(`<p>${mdInline(htmlSafe(buf.para.join(" ")))}</p>`);
      buf.para = [];
    },
    list(): void {
      if (!buf.listTag) return;
      out.push(`</${buf.listTag}>`);
      buf.listTag = null;
    },
    fence(closed: boolean): void {
      const lang = (buf.fenceLang || "plaintext").replace(/[^a-z0-9_+-]/gi, "");
      const body = htmlSafe(buf.fenceBuf.join("\n"));
      const caret = closed ? "" : '<span class="md-cursor md-cursor-inline">▌</span>';
      out.push(
        `<pre class="md-code language-${lang}"><code class="language-${lang}">${body}${caret}</code></pre>`,
      );
    },
  };

  const openList = (tag: "ul" | "ol"): void => {
    if (buf.listTag !== tag) {
      flush.list();
      out.push(`<${tag}>`);
      buf.listTag = tag;
    }
  };

  const flowRules: MdRule[] = [
    (line, row) => {
      const m = row.match(/^\s*```\s*([a-zA-Z0-9_+-]*)\s*$/);
      if (!m) return null;
      flush.para(); flush.list();
      buf.fenceLang = m[1];
      buf.fenceBuf = [];
      return "code";
    },
    (line) => {
      if (line) return null;
      flush.para(); flush.list();
      return "flow";
    },
    (line) => {
      const m = line.match(/^(#{1,3})\s+(.*)$/);
      if (!m) return null;
      flush.para(); flush.list();
      out.push(`<h${m[1].length}>${mdInline(htmlSafe(m[2]))}</h${m[1].length}>`);
      return "flow";
    },
    (line) => {
      const m = line.match(/^[-*]\s+(.*)$/);
      if (!m) return null;
      flush.para(); openList("ul");
      out.push(`<li>${mdInline(htmlSafe(m[1]))}</li>`);
      return "flow";
    },
    (line) => {
      const m = line.match(/^\d+\.\s+(.*)$/);
      if (!m) return null;
      flush.para(); openList("ol");
      out.push(`<li>${mdInline(htmlSafe(m[1]))}</li>`);
      return "flow";
    },
    (line) => {
      flush.list();
      buf.para.push(line);
      return "flow";
    },
  ];

  const states: Record<MdState, (row: string) => MdState> = {
    flow(row) {
      const line = row.trim();
      for (const rule of flowRules) {
        const next = rule(line, row);
        if (next) return next;
      }
      return "flow";
    },
    code(row) {
      const fenceEdge = row.match(/^\s*```\s*([a-zA-Z0-9_+-]*)\s*$/);
      if (!fenceEdge) {
        buf.fenceBuf.push(row);
        return "code";
      }
      flush.fence(true);
      buf.fenceLang = "";
      buf.fenceBuf = [];
      return "flow";
    },
  };

  let state: MdState = "flow";
  for (const row of src.split("\n")) {
    state = states[state](row);
  }
  if (state === "code") flush.fence(false);
  flush.para();
  flush.list();
  return out.join("");
}

declare const Prism: { highlightAllUnder?: (root: HTMLElement) => void } | undefined;
interface StreamHandle { cancel(): void; }
function streamType(target: HTMLElement, text: string, onDone?: () => void): StreamHandle {
  let i = 0;
  let stopped = false;
  const finalize = () => {
    target.innerHTML = mdRender(text);
    if (typeof Prism !== "undefined" && Prism?.highlightAllUnder) {
      try { Prism.highlightAllUnder(target); } catch {  }
    }
    onDone?.();
  };
  const timer = window.setInterval(() => {
    if (stopped) { clearInterval(timer); return; }
    const stride = 3 + Math.floor(Math.random() * 4);
    i = Math.min(text.length, i + stride);
    if (i >= text.length) {
      clearInterval(timer);
      finalize();
      return;
    }

    target.innerHTML = mdRender(text.slice(0, i)) + '<span class="md-cursor">▌</span>';
  }, 22);
  window.setTimeout(() => {
    if (!stopped && i < text.length) { stopped = true; clearInterval(timer); finalize(); }
  }, 50_000);
  return {
    cancel() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      finalize();
    },
  };
}

let redStream: StreamHandle | null = null;
let blueStream: StreamHandle | null = null;

function paintRed(label: string, body?: string): void {
  ui.redTag.textContent = label;
  ui.redPanel.setAttribute("data-state", hardenPhase);
  if (body !== undefined) {
    redStream?.cancel();
    ui.redBody.classList.add("md");
    ui.redBody.innerHTML = "";
    redStream = streamType(ui.redBody, body);
  }
}

function paintBlue(label: string, body?: string): void {
  ui.blueTag.textContent = label;
  ui.bluePanel.setAttribute("data-state", hardenPhase);
  if (body !== undefined) {
    blueStream?.cancel();
    ui.blueBody.classList.add("md");
    ui.blueBody.innerHTML = "";
    blueStream = streamType(ui.blueBody, body);
  }
}

function armHarden(): void {
  if (hardenPhase !== "idle") return;

  hardenPhase = "armed";
  ui.layout.classList.add("harden");
  ui.canvas.setAttribute("data-harden", "true");
  ui.redPanel.setAttribute("data-open", "true");
  ui.bluePanel.setAttribute("data-open", "false");
  ui.btnHarden.disabled = true;
  paintRed("READY");
  ui.btnRedAction.textContent = "Review fault";
  ui.btnRedAction.disabled = false;
  ui.btnBlueAction.textContent = "Prepare safeguard";
  ui.btnBlueAction.disabled = true;
  ui.btnBlueAction.removeAttribute("data-state");
  paintBlue("STANDBY");
  wipePipeline();
  hideIncident();
  tell("start_harden");
}

function disarmHarden(): void {
  hardenPhase = "idle";
  ui.layout.classList.remove("harden");
  ui.canvas.removeAttribute("data-harden");
  ui.redPanel.setAttribute("data-open", "false");
  ui.bluePanel.setAttribute("data-open", "false");
  ui.btnHarden.disabled = false;
  if (twin && litPart) twin.setSensorFailure(litPart, false);
  litPart = null;
  wipePipeline();
  paintSystemState("monitoring");
}

function bundleMd(prose: string, code: string, lang: string): string {
  const fence = code ? `\n\n\`\`\`${lang || "plaintext"}\n${code.trim()}\n\`\`\`\n` : "";
  return `${prose.trim()}${fence}`;
}

const SCENE_TARGETS: Record<string, string> = {
  temperature: "spa",
  pressure: "spa",
};
let litPart: string | null = null;

function scheduleAdvance(expect: HardenPhase, delay: number, action: () => void): void {
  setTimeout(() => {
    if (hardenPhase !== expect) return;
    action();
  }, delay);
}

function onRedPlan(msg: RedTeamPlanMsg): void {
  hardenPhase = "planned";
  markStep("recon", "done");
  const header =
    `### Selected attack\n` +
    `- **Target:** ${msg.target}\n` +
    `- **Kind:** ${msg.kind}\n` +
    `- **Magnitude:** ${msg.magnitude.toFixed(2)}\n` +
    (msg.rationale ? `- **Rationale:** ${msg.rationale}\n` : "");
  paintRed(
    msg.used_fallback ? "PLAN (FALLBACK)" : "PLAN READY",
    bundleMd(`${header}\n${msg.prose}`, msg.code, msg.lang || "python"),
  );
  ui.btnRedAction.textContent = "Fault in progress…";
  ui.btnRedAction.disabled = true;

  scheduleAdvance("planned", 2800, () => {
    markStep("attack", "active");
    tell("launch_attack");
  });
}

function onAttackLive(msg: HardenAttackLaunchedMsg): void {
  hardenPhase = "attacking";
  markStep("attack", "done");
  ui.redPanel.setAttribute("data-state", "attacking");
  paintRed(`ATTACK LIVE · ${(msg.kind || "flatline").toUpperCase()}`);
  ui.btnRedAction.textContent = "Fault recorded";
  ui.btnRedAction.disabled = true;
  ui.bluePanel.setAttribute("data-open", "true");
  const sensorName = msg.target || "temperature";
  paintBlue(
    "READY",
    `Telemetry confirms the **${msg.kind || "flatline"}** signature on **${sensorName}**: ` +
    `variance pattern shifted while sibling channels remain active. ` +
    `Engage the local model to fit a virtual sensor and draft the patch.`,
  );
  ui.btnBlueAction.textContent = "Fitting replacement reading…";
  ui.btnBlueAction.disabled = true;

  if (twin && litPart) twin.setSensorFailure(litPart, false);
  litPart = SCENE_TARGETS[sensorName] ?? null;
  if (twin && litPart) twin.setSensorFailure(litPart, true);
  flaggedSensor = sensorName;
  incidentOn = true;
  flagCompromised(true);
  paintSystemState("anomaly_detected");

  scheduleAdvance("attacking", 2800, () => {
    hardenPhase = "planning";
    markStep("analysis", "active");
    ui.bluePanel.setAttribute("data-state", "planning");
    paintBlue("PLANNING…");
    tell("request_blue_patch");
  });
}

function onBluePatch(msg: BlueTeamPatchMsg): void {
  hardenPhase = "patching";
  markStep("analysis", "done");
  const fitReport =
    msg.basis && msg.coefficients && msg.intercept != null
      ? `### Fitted virtual sensor\n` +
      `- **Substituting:** ${msg.target}\n` +
      `- **Predictors:** ${msg.basis.join(", ")}\n` +
      `- **β₀ (intercept):** ${msg.intercept.toFixed(5)}\n` +
      msg.basis.map((b, i) => `- **β${i + 1} (${b}):** ${(msg.coefficients as number[])[i].toFixed(5)}`).join("\n") +
      (msg.r2 != null ? `\n- **R²:** ${msg.r2.toFixed(3)}` : "") +
      "\n"
      : "";
  paintBlue(
    msg.used_fallback ? "PATCH (FALLBACK)" : "PATCH READY",
    bundleMd(`${fitReport}\n${msg.prose}`, msg.code, msg.lang || "cpp"),
  );
  ui.btnBlueAction.textContent = "Applying safeguard…";
  ui.btnBlueAction.disabled = true;

  scheduleAdvance("patching", 3000, () => {
    markStep("patch", "active");
    tell("apply_patch");
  });
}

function onPatchLive(_msg: HardenPatchAppliedMsg): void {
  hardenPhase = "patched";
  markStep("patch", "done");
  if (twin && litPart) twin.setSensorFailure(litPart, false);
  litPart = null;
  paintBlue("PATCHED");
  ui.btnBlueAction.textContent = "Safeguard active";
  ui.btnBlueAction.disabled = true;
  ui.btnBlueAction.setAttribute("data-state", "patched");
  paintSystemState("patched");
  paintRed("NEUTRALIZED");
  ui.redPanel.setAttribute("data-state", "patched");
  incidentOn = false;
  flaggedSensor = null;
  flagCompromised(false);
}

ui.btnHarden.addEventListener("click", armHarden);

const RED_INTENTS: Partial<Record<HardenPhase, () => void>> = {
  armed() {
    hardenPhase = "planning";
    markStep("recon", "active");
    paintRed("PLANNING…");
    ui.btnRedAction.disabled = true;
    tell("request_red_plan");
  },
  planned() {
    markStep("attack", "active");
    tell("launch_attack");
  },
};

const BLUE_INTENTS: Partial<Record<HardenPhase, () => void>> = {
  attacking() {
    hardenPhase = "planning";
    markStep("analysis", "active");
    ui.bluePanel.setAttribute("data-state", "planning");
    paintBlue("PLANNING…");
    ui.btnBlueAction.disabled = true;
    tell("request_blue_patch");
  },
  patching() {
    markStep("patch", "active");
    tell("apply_patch");
  },
};

ui.btnRedAction.addEventListener("click", () => RED_INTENTS[hardenPhase]?.());
ui.btnBlueAction.addEventListener("click", () => BLUE_INTENTS[hardenPhase]?.());

ui.btnExitHarden.addEventListener("click", () => {
  tell("exit_harden");
  disarmHarden();
});

ui.btnAttack.addEventListener("click", () => { void postAction("/api/simulate/attack"); });
ui.btnClear.addEventListener("click", () => {

  hideIncident();
  fullReset();
  paintSystemState("monitoring");
  incidentOn = false;
  flaggedSensor = null;
  flagCompromised(false);
  void postAction("/api/simulate/clear");
});

setInterval(() => {
  ui.clock.textContent = new Date().toISOString().slice(11, 19);
}, 1000);

document.querySelectorAll<HTMLElement>(".agent-feed-row").forEach((row) => {
  const key = row.dataset.agent as AgentKey | undefined;
  if (!key) return;
  row.style.cursor = "pointer";
  row.addEventListener("click", () => focusAgent(key));
});

paintDetail(null);
syncAllFeeds();
dial();

const twinCanvas = document.getElementById("twinCanvas") as HTMLCanvasElement | null;
const twinTag = document.getElementById("twinTag");
const twinPanel = document.getElementById("twinPanel");
const twinCollapse = document.getElementById("twinCollapse");

let twin: any = null;

if (twinPanel && twinCollapse) {
  twinCollapse.addEventListener("click", () => {
    twinPanel.classList.toggle("collapsed");
  });
}

if (twinCanvas && twinTag) {
  initScene(twinCanvas, (msg) => { twinTag.textContent = msg; })
    .then((api) => { twin = api; })
    .catch((err: Error) => { twinTag.textContent = `ERR: ${err.message}`; });
}
