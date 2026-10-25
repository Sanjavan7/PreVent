"""Cal Hacks 2026 — orchestration bridge.

FastAPI service that streams telemetry from the edge (real or simulated),
raises incidents on the firmware alarm line, routes remediation work through
the air-gapped model cluster, and delivers the resulting firmware patch back
to the microcontroller. The dashboard talks to this module over one WebSocket
(/ws) plus a handful of REST endpoints.
"""

import asyncio
import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, List, Optional, Set
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

load_dotenv(Path(__file__).parent / ".env")
from watchdog_agent import AnomalyWatchdog, IncidentReport
from flash_agent import SketchFlasher
from patch_writer_agent import LocalLLMPipeline
from sensor_fit import fit_ols
from telemetry import SensorSimulator, SerialTelemetrySource


def _env_flag(name: str, default: str) -> bool:
    return os.getenv(name, default).strip().lower() == "true"


SIMULATE_SERIAL = _env_flag("SIMULATE_SERIAL", "true")
SIMULATE_FLASH = _env_flag("SIMULATE_FLASH", "true")
FORCE_FALLBACK_LLM = _env_flag("FORCE_FALLBACK_LLM", "false")
SERIAL_PORT = os.getenv("SERIAL_PORT", "/dev/cu.usbmodemE83DC1E348A42")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_ANALYSIS_MODEL = os.getenv(
    "OLLAMA_ANALYSIS_MODEL",
    os.getenv("OLLAMA_MODEL", "llama3.1:70b"),
)
OLLAMA_CODER_MODEL = os.getenv("OLLAMA_CODER_MODEL", "qwen2.5-coder")
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
MODELS_DIR = Path(__file__).parent.parent / "arduino" / "Models"
PIN_MAP = {"temperature": "SPA06 temperature", "pressure": "SPA06 pressure"}
CHANNELS = ("temperature", "pressure")
BASELINE_DEFAULTS = {"temperature": 25.0, "pressure": 1013.0}
PROMPTS: Dict[str, str] = {
    "red_plan": (
        "You are an authorized red-team operator targeting an Arduino Uno R4 "
        "ventilator bench. One SPA06-003 on I2C reports TEMPERATURE and "
        "PRESSURE. The fan speed follows pressure through an L293D. "
        "Choose ONE target to spoof, the modulation kind, and a magnitude. "
        "Respond with ONLY a JSON object, no commentary, no code fences. Schema:\n"
        '{"target":"temperature"|"pressure",'
        '"kind":"flatline"|"spike"|"drift",'
        '"magnitude":<float between 0.4 and 2.0>,'
        '"rationale":"<one-sentence reason for picking this target/kind>"}'
    ),
    "red_prose": (
        "You are an authorized red-team operator. You have selected a structured "
        "attack against an Arduino sensor: target={target}, kind={kind}, "
        "magnitude={magnitude}. Author a tight markdown plan with sections: "
        "**Target**, **Vector**, **Indicators**, **Success Criteria**. "
        "Stay under 200 words. Do not output source code — that goes in a separate response."
    ),
    "red_code": (
        "Describe the simulated sensor fault already selected: target={target}, "
        "kind={kind}, magnitude={magnitude}. Emit ONLY a short Python script that "
        "prints those three values. No hardware control, no radio, no extra prose."
    ),
    "blue_prose": (
        "You are a blue-team operator. The red team has spoofed the {target} channel "
        "with a {kind} attack. We have fit a least-squares regression on the live "
        "rolling telemetry window using the surviving sensors as predictors. "
        "Coefficients (computed server-side, do NOT recompute): "
        "intercept={intercept:.5f}, basis={basis}, coefficients={coefficients}, "
        "fit R²={r2:.3f} on n={n} samples.\n\n"
        "Author a tight markdown countermeasure with sections: **What the patch does**, "
        "**Why it neutralizes the attack**, **Risk during flight**. Reference the "
        "fitted numbers literally in your text. Stay under 220 words. End with "
        "'PATCH_READY' on its own line."
    ),
    "blue_code": (
        "Emit ONLY an Arduino .ino sketch (no markdown, no prose) that stops "
        "trusting the spoofed SPA06 {target} value and substitutes "
        "{target} = {intercept:.5f} + {basis_coef_terms} from the surviving "
        "SPA06 channel. Log 'VIRTUAL_SENSOR_ACTIVE' to Serial at 115200 baud "
        "once per second. Use the literal coefficients above as `const float`. "
        "Keep under 80 lines."
    ),
}


class Runtime:
    def __init__(self):
        self.mode = "monitoring"
        self.incidents = 0
        self.latest_firmware = ""
        self.patched_at = 0.0
        self.sockets: Set[WebSocket] = set()
        self.source = (
            SensorSimulator() if SIMULATE_SERIAL else SerialTelemetrySource(SERIAL_PORT)
        )
        self.watchdog = AnomalyWatchdog()
        self.models = LocalLLMPipeline(
            base_url=OLLAMA_URL,
            analysis_model=OLLAMA_ANALYSIS_MODEL,
            coder_model=OLLAMA_CODER_MODEL,
            force_fallback=FORCE_FALLBACK_LLM,
        )
        self.burner = SketchFlasher(port=SERIAL_PORT, simulate=SIMULATE_FLASH)
        self.pipeline_busy = False
        self.harden_on = False
        self.red_plan: Optional[dict] = None
        self.blue_patch: Optional[dict] = None
        self.pre_attack_window: Optional[List[dict]] = None

    def reset_slate(self) -> None:
        """Return to a clean monitoring state (used on client connect/exit)."""
        self.mode = "monitoring"
        self.pipeline_busy = False
        self.harden_on = False
        self.pre_attack_window = None
        self.watchdog.rearm()
        if isinstance(self.source, SensorSimulator):
            self.source.disengage_spoof()
            self.source.remove_shadow()


rt = Runtime()


@asynccontextmanager
async def app_lifespan(app: FastAPI):
    pump = asyncio.create_task(pump_telemetry())
    yield
    pump.cancel()
    try:
        await pump
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Cal Hacks 2026", lifespan=app_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


async def emit_all(msg: dict) -> None:
    if not rt.sockets:
        return
    frame = json.dumps(msg)
    stale = set()
    for ws in list(rt.sockets):
        try:
            await ws.send_text(frame)
        except Exception:
            stale.add(ws)
    rt.sockets.difference_update(stale)


async def pump_telemetry() -> None:
    while True:
        try:
            sample = await rt.source.next_sample()
            rt.watchdog.observe(sample)
            report = rt.watchdog.poll()
            if (
                report.flagged
                and isinstance(rt.source, SensorSimulator)
                and rt.source.spoof is not None
            ):
                report.suspect = rt.source.spoof.target
                report.summary = (
                    "SENSOR FAULT DETECTED — firmware alarm bit raised. "
                    f"Suspected spoofing vector: {report.suspect.upper()} channel."
                )
            await emit_all(
                {
                    "type": "telemetry",
                    "timestamp": sample.timestamp,
                    "sensors": {
                        "temperature": sample.temperature,
                        "pressure": sample.pressure,
                        "fan": sample.fan,
                        "alarm": sample.alarm,
                    },
                    "anomaly": report.flagged,
                    "anomaly_confidence": report.score,
                    "stats": report.metrics,
                    "status": rt.mode,
                }
            )
            if report.flagged and not rt.pipeline_busy and not rt.harden_on:
                rt.pipeline_busy = True
                asyncio.create_task(remediate(report))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await emit_all({"type": "error", "message": str(exc)})
            await asyncio.sleep(1)


async def remediate(report: IncidentReport) -> None:
    ctx = _RemediateCtx(report)
    stages = [
        _stage_raise_alarm,
        _stage_ask_model,
        _stage_flash_patch,
        _stage_restore,
    ]
    try:
        for stage in stages:
            early = await stage(ctx)
            if early is not None:
                await emit_all(early)
                return
    finally:
        rt.pipeline_busy = False


class _RemediateCtx:
    """Per-incident state threaded through the remediation stages."""

    def __init__(self, report: IncidentReport):
        self.report = report
        self.firmware = ""
        self.brief = ""
        self.is_fallback = False
        self.flash_ok = False
        self.flash_note = ""
        self.flash_log = ""


async def _stage_raise_alarm(ctx: _RemediateCtx) -> Optional[dict]:
    rt.mode = "anomaly_detected"
    rt.incidents += 1
    await emit_all(
        {
            "type": "anomaly",
            "reason": ctx.report.summary,
            "confidence": ctx.report.score,
            "stats": ctx.report.metrics,
            "compromised_sensor": ctx.report.suspect,
            "timestamp": time.time(),
        }
    )
    await asyncio.sleep(1)
    return None


async def _stage_ask_model(ctx: _RemediateCtx) -> Optional[dict]:
    rt.mode = "llm_processing"
    await emit_all(
        {
            "type": "status",
            "status": "llm_processing",
            "message": "Dispatching telemetry to air-gapped intelligence layer…",
        }
    )
    try:
        outcome = await rt.models.craft_patch(
            ctx.report.window,
            compromised_sensor=ctx.report.suspect,
        )
    except Exception as exc:
        rt.mode = "error"
        await emit_all(
            {
                "type": "llm_failed",
                "message": f"Local LLM unreachable: {exc}",
                "timestamp": time.time(),
            }
        )
        await asyncio.sleep(3)
        rt.mode = "monitoring"
        rt.watchdog.rearm()
        return {
            "type": "status",
            "status": "monitoring",
            "message": "Pipeline aborted — restart Ollama and re-trigger the attack.",
        }
    ctx.firmware = outcome.firmware
    ctx.brief = outcome.brief
    ctx.is_fallback = outcome.is_fallback
    rt.latest_firmware = ctx.firmware
    await emit_all(
        {
            "type": "llm_response",
            "code": ctx.firmware,
            "analysis": ctx.brief,
            "used_fallback": ctx.is_fallback,
            "timestamp": time.time(),
        }
    )
    return None


async def _stage_flash_patch(ctx: _RemediateCtx) -> Optional[dict]:
    rt.mode = "flashing"
    await emit_all(
        {
            "type": "status",
            "status": "flashing",
            "message": "Compiling and flashing virtual sensor firmware…",
        }
    )
    result = await rt.burner.deploy(ctx.firmware)
    ctx.flash_ok = result.ok
    ctx.flash_note = result.note
    ctx.flash_log = result.transcript
    await emit_all(
        {
            "type": "flash_complete",
            "success": result.ok,
            "message": result.note,
            "output": result.transcript,
            **({"timestamp": time.time()} if result.ok else {}),
        }
    )
    if not result.ok:
        rt.mode = "error"
    return None


async def _stage_restore(ctx: _RemediateCtx) -> Optional[dict]:
    if not ctx.flash_ok:
        return None
    rt.mode = "patched"
    rt.patched_at = time.time()
    await asyncio.sleep(5)
    rt.mode = "monitoring"
    if isinstance(rt.source, SensorSimulator):
        rt.source.disengage_spoof()
    rt.watchdog.rearm()
    return {
        "type": "status",
        "status": "monitoring",
        "message": "System restored — virtual sensor active",
    }


def _auto_red_plan() -> dict:
    """Deterministic target rotation so each run hits a different channel."""
    target = CHANNELS[rt.incidents % len(CHANNELS)]
    return {
        "target": target,
        "kind": "flatline",
        "magnitude": 1.0,
        "rationale": (
            f"{target} is read from the SPA06-003. The bedside monitor and "
            f"the fan command both depend on that chip."
        ),
    }


def _red_brief_md(target: str, kind: str, magnitude: float) -> str:
    return (
        f"## Attack Plan — {target.title()} {kind.title()} Spoofing\n\n"
        f"**Target.** {PIN_MAP[target]} on the SPA06-003.\n\n"
        f"**Vector.** The console holds the {target} reading in a {kind} pattern "
        f"at magnitude {magnitude:.2f}. The other SPA06 channel keeps moving.\n\n"
        f"**Indicators.** {target} stream variance collapses while the surviving "
        f"channel remains active. The fan command follows pressure.\n\n"
        f"**Success.** Operator console shows nominal {target} for ≥30 s while "
        f"the controlled signal in the chamber is the opposite of reported."
    )


def _blue_brief_md(
    target: str,
    basis: List[str],
    intercept: float,
    coefs: List[float],
    r2: float,
    n: int,
) -> str:
    return (
        f"## Countermeasure — Virtual {target.title()} Sensor\n\n"
        f"**What the patch does.** Stops trusting {PIN_MAP[target]} and "
        f"substitutes `{target} = {_fit_expr(intercept, basis, coefs)}` — the "
        f"OLS fit computed against {n} samples of pre-attack telemetry "
        f"(R²={r2:.3f}).\n\n"
        f"**Why it neutralizes the attack.** The bad {target} value stays on "
        f"the SPA06 report. The monitor uses the value computed from "
        f"{', '.join(basis) or 'the intercept'}.\n\n"
        f"**Risk during flight.** The substitute follows "
        f"{', '.join(basis) or 'the intercept'}. If that channel degrades, "
        f"the synthesised value moves with it.\n\n"
        f"PATCH_READY"
    )


def _fit_expr(intercept: float, basis: List[str], coefs: List[float]) -> str:
    terms = " + ".join(
        f"{coef:.4f}·{name}" for coef, name in zip(coefs, basis)
    )
    if not terms:
        return f"{intercept:.4f}"
    return f"{intercept:.4f} + {terms}"


def _render_fault_note(target: str, kind: str, magnitude: float) -> str:
    pin = PIN_MAP.get(target, "SPA06")
    return f"""target = "{target}"
kind = "{kind}"
magnitude = {magnitude:.2f}
pin = "{pin}"

print(f"simulated {{kind}} fault on {{target}} ({{pin}}), magnitude {{magnitude:.2f}}")
"""


def _render_virtual_sketch(
    target: str, basis: List[str], intercept: float, coefficients: List[float]
) -> str:
    coef_decls = "\n".join(
        f"const float W{i + 1} = {c:.6f}f;"
        for i, c in enumerate(coefficients)
    )
    args = ", ".join(f"float {name}" for name in basis)
    weighted = " + ".join(
        f"W{i + 1} * {name}" for i, name in enumerate(basis)
    ) or "0"
    return f"""const float W0 = {intercept:.6f}f;
{coef_decls}
float virtual_{target}({args}) {{
  return W0 + {weighted};
}}
"""


async def stage_red_plan() -> None:
    """Red team is deterministic — no model round-trip. Plan and payload are
    pregenerated from the target rotation."""
    await emit_all(
        {
            "type": "status",
            "status": "llm_processing",
            "message": "Red team selecting target…",
        }
    )
    await asyncio.sleep(1.0)
    plan = _auto_red_plan()
    target, kind = plan["target"], plan["kind"]
    magnitude = float(plan["magnitude"])
    rt.red_plan = {
        "target": target,
        "kind": kind,
        "magnitude": magnitude,
        "prose": _red_brief_md(target, kind, magnitude),
        "code": _render_fault_note(target, kind, magnitude),
        "used_fallback": False,
    }
    await emit_all(
        {
            "type": "red_team_plan",
            "target": target,
            "kind": kind,
            "magnitude": magnitude,
            "rationale": plan["rationale"],
            "prose": rt.red_plan["prose"],
            "code": rt.red_plan["code"],
            "lang": "python",
            "used_fallback": False,
            "timestamp": time.time(),
        }
    )


async def stage_blue_patch() -> None:
    """Blue team is deterministic — the OLS fit still runs live against the
    rolling window, so patch coefficients track whatever signal the simulator
    is actually producing."""
    await emit_all(
        {
            "type": "status",
            "status": "llm_processing",
            "message": "Blue team fitting virtual sensor…",
        }
    )
    window = rt.pre_attack_window or rt.watchdog.snapshot()
    plan = rt.red_plan or _auto_red_plan()
    target = plan["target"]
    basis = [c for c in CHANNELS if c != target]
    if len(window) >= 4 and basis:
        intercept, coefs, r2 = fit_ols(
            [row[target] for row in window],
            [[row[name] for name in basis] for row in window],
        )
    else:
        intercept = BASELINE_DEFAULTS[target]
        coefs = [0.0] * len(basis)
        r2 = 0.0
    await asyncio.sleep(1.2)
    rt.blue_patch = {
        "target": target,
        "basis": basis,
        "intercept": intercept,
        "coefficients": coefs,
        "r2": r2,
        "prose": _blue_brief_md(target, basis, intercept, coefs, r2, len(window)),
        "code": _render_virtual_sketch(target, basis, intercept, coefs),
        "used_fallback": False,
    }
    await emit_all(
        {
            "type": "blue_team_patch",
            "target": target,
            "basis": basis,
            "intercept": intercept,
            "coefficients": coefs,
            "r2": r2,
            "prose": rt.blue_patch["prose"],
            "code": rt.blue_patch["code"],
            "lang": "cpp",
            "used_fallback": False,
            "timestamp": time.time(),
        }
    )


async def _ack(ws: WebSocket, action: str) -> dict:
    return {"type": "ack", "action": action}


async def act_trigger_attack(ws: WebSocket, cmd: dict) -> Optional[dict]:
    if isinstance(rt.source, SensorSimulator):
        rt.source.engage_spoof()
        return await _ack(ws, "trigger_attack")
    return None


async def act_clear_attack(ws: WebSocket, cmd: dict) -> Optional[dict]:
    if isinstance(rt.source, SensorSimulator):
        rt.source.disengage_spoof()
        return await _ack(ws, "clear_attack")
    return None


async def act_start_harden(ws: WebSocket, cmd: dict) -> Optional[dict]:
    rt.harden_on = True
    rt.red_plan = None
    rt.blue_patch = None
    rt.pre_attack_window = None
    if isinstance(rt.source, SensorSimulator):
        rt.source.disengage_spoof()
        rt.source.remove_shadow()
    rt.watchdog.rearm()
    await emit_all({"type": "harden_started", "timestamp": time.time()})
    return None


async def act_request_red_plan(ws: WebSocket, cmd: dict) -> Optional[dict]:
    asyncio.create_task(stage_red_plan())
    return await _ack(ws, "request_red_plan")


async def act_launch_attack(ws: WebSocket, cmd: dict) -> Optional[dict]:
    plan = rt.red_plan or _auto_red_plan()
    target = plan["target"]
    kind = plan["kind"]
    magnitude = float(plan.get("magnitude", 1.0))
    rt.pre_attack_window = rt.watchdog.snapshot()
    if isinstance(rt.source, SensorSimulator):
        spec = rt.source.engage_spoof(target=target, kind=kind, magnitude=magnitude)
        target, kind, magnitude = spec.target, spec.kind, spec.magnitude
    rt.mode = "anomaly_detected"
    rt.incidents += 1
    await emit_all(
        {
            "type": "harden_attack_launched",
            "target": target,
            "kind": kind,
            "magnitude": magnitude,
            "timestamp": time.time(),
        }
    )
    return None


async def act_request_blue_patch(ws: WebSocket, cmd: dict) -> Optional[dict]:
    asyncio.create_task(stage_blue_patch())
    return await _ack(ws, "request_blue_patch")


async def act_apply_patch(ws: WebSocket, cmd: dict) -> Optional[dict]:
    patch = rt.blue_patch
    if isinstance(rt.source, SensorSimulator) and patch:
        rt.source.install_shadow(
            target=patch["target"],
            basis=patch["basis"],
            intercept=patch["intercept"],
            coefficients=patch["coefficients"],
        )
    rt.mode = "patched"
    patch = patch or {}
    await emit_all(
        {
            "type": "harden_patch_applied",
            "target": patch.get("target", "temperature"),
            "intercept": patch.get("intercept"),
            "coefficients": patch.get("coefficients"),
            "basis": patch.get("basis"),
            "timestamp": time.time(),
        }
    )
    return None


async def act_exit_harden(ws: WebSocket, cmd: dict) -> Optional[dict]:
    rt.reset_slate()
    rt.red_plan = None
    rt.blue_patch = None
    await emit_all({"type": "harden_exited", "timestamp": time.time()})
    return None


WS_ACTIONS = {
    "trigger_attack": act_trigger_attack,
    "clear_attack": act_clear_attack,
    "start_harden": act_start_harden,
    "request_red_plan": act_request_red_plan,
    "launch_attack": act_launch_attack,
    "request_blue_patch": act_request_blue_patch,
    "apply_patch": act_apply_patch,
    "exit_harden": act_exit_harden,
}


async def dispatch_ws(ws: WebSocket, cmd: dict) -> None:
    """Route one decoded client command; broadcast any frame it returns."""
    handler = WS_ACTIONS.get(cmd.get("action"))
    if handler is None:
        return
    frame = await handler(ws, cmd)
    if frame is not None:
        await ws.send_text(json.dumps(frame))


@app.get("/api/status")
async def api_status():
    return {
        "status": rt.mode,
        "anomaly_count": rt.incidents,
        "simulate_serial": SIMULATE_SERIAL,
        "simulate_flash": SIMULATE_FLASH,
        "force_fallback_llm": FORCE_FALLBACK_LLM,
        "last_patch_time": rt.patched_at,
        "ollama_analysis_model": OLLAMA_ANALYSIS_MODEL,
        "ollama_coder_model": OLLAMA_CODER_MODEL,
    }


@app.post("/api/simulate/attack")
async def api_trigger_attack():
    if not isinstance(rt.source, SensorSimulator):
        return {"error": "Not in simulation mode"}
    rt.source.engage_spoof()
    return {"message": "EMI attack simulation engaged"}


@app.post("/api/simulate/clear")
async def api_clear_attack():
    if isinstance(rt.source, SensorSimulator):
        rt.source.disengage_spoof()
    return {"message": "Attack simulation cleared"}


@app.get("/api/patch/latest")
async def api_latest_patch():
    return {"code": rt.latest_firmware, "timestamp": rt.patched_at}


@app.websocket("/ws")
async def ws_channel(ws: WebSocket):
    await ws.accept()
    rt.sockets.add(ws)
    rt.reset_slate()
    await ws.send_text(
        json.dumps(
            {
                "type": "connected",
                "status": rt.mode,
                "anomaly_count": rt.incidents,
                "simulate_serial": SIMULATE_SERIAL,
                "simulate_flash": SIMULATE_FLASH,
                "force_fallback_llm": FORCE_FALLBACK_LLM,
            }
        )
    )
    try:
        async for raw in ws.iter_text():
            try:
                cmd = json.loads(raw)
            except Exception:
                continue
            await dispatch_ws(ws, cmd)
    except WebSocketDisconnect:
        pass
    finally:
        rt.sockets.discard(ws)


@app.get("/")
async def ward_home():
    return FileResponse(FRONTEND_DIR / "ward.html")


if MODELS_DIR.exists():
    app.mount("/models", StaticFiles(directory=str(MODELS_DIR)), name="models")
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
