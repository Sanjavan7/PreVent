"""Two-stage generation pipeline against the air-gapped Ollama cluster.

Stage 1 (analyst) reads a telemetry window and writes a natural-language
remediation brief. Stage 2 (coder) takes that brief plus the window and
emits the Arduino patch. The two stages are composed as explicit steps over a
shared context, so the chain's shape is the code. Any failure aborts the call
so the dashboard can report the model as unreachable rather than pretend a
patch was synthesised (except when `force_fallback` is set, for offline demos).
"""

import json
import re
import statistics
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
import httpx

ANALYST_PROMPT = """You are an embedded-systems security analyst working in an
air-gapped SOC for networked medical hardware. You inspect short telemetry
windows from an Arduino Uno R4 bedside monitor and identify sensor-tampering
signatures (a SPA06 temperature or pressure value that stops tracking the other). You do NOT
write code.

Output a tight remediation brief: 3–5 short paragraphs (or terse bullets),
total under 180 words. Cover, in order:
  1. The attack signature you see in the data.
  2. Which physical sensor is compromised and why you're confident.
  3. The mitigation strategy (virtual sensor synthesised from correlated
     channels — name the channels and how they relate to the missing one).
  4. Any caveats the coder should account for (saturation, units, drift).

No markdown headers. No code blocks. Plain prose."""
ANALYST_USER_TMPL = """Telemetry window (last {n} of {total} readings):
{telemetry_json}

Statistical summary:
- Temperature variance: {temp_var:.4f}  (FLATLINED if near zero)
- Pressure variance:    {pres_var:.2f}

Suspected compromised channel (from on-device alarm + correlation): {compromised_sensor}

Produce the remediation brief."""
CODER_PROMPT = """You are an embedded firmware engineer. Given a security
analyst's brief and a telemetry window, you synthesise an Arduino C++ patch
that virtualises the compromised sensor.

RULES:
1. Output ONLY a complete, compilable Arduino sketch (.ino). No markdown. No
   backticks. No prose. No explanations. Just the .ino source.
2. Stop trusting the compromised SPA06 channel and replace it with a virtual sensor.
3. Derive the failed channel from the surviving SPA06 channel using a linear
   regression model whose coefficients you fit from the provided telemetry.
4. Leave the L293D fan on D5, D7, and D8. Fan speed follows pressure.
5. Log "VIRTUAL_SENSOR_ACTIVE" to Serial at 115200 baud once per second."""
CODER_USER_TMPL = """Analyst remediation brief:
{analysis}

Telemetry window (last {n} of {total} readings):
{telemetry_json}

Generate the .ino patch per your system rules. Output the code only."""
CANNED_FIRMWARE = """const float K0 = 18.423100f;
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
"""
CANNED_BRIEF = (
    "Temperature variance has collapsed while pressure from the SPA06-003 "
    "keeps moving. Mitigation: stop trusting the SPA06 temperature value and "
    "synthesise temperature from pressure using a regression fit over the "
    "pre-attack window."
)
_FENCE_RE = re.compile(r"```(?:cpp|arduino|c\+\+|c|ino|python|py|json|markdown|md)?")


@dataclass
class PatchResult:
    firmware: str
    brief: str
    transcript: str
    is_fallback: bool


@dataclass
class _GenSpec:
    """One call to /api/generate."""

    model: str
    system: str
    prompt: str
    num_predict: int
    temperature: float = 0.1
    as_json: bool = False


@dataclass
class _ChainCtx:
    """Mutable state threaded through the analyst → coder chain."""

    window: List[dict]
    compromised: str
    telemetry_json: str = ""
    counts: Dict[str, int] = field(default_factory=dict)
    stats: Dict[str, float] = field(default_factory=dict)
    brief: str = ""
    analyst_raw: str = ""
    firmware: str = ""
    coder_raw: str = ""


def _strip_fences(text: str) -> str:
    return _FENCE_RE.sub("", text).replace("```", "").strip()


class LocalLLMPipeline:
    """Analyst → coder chain against a local Ollama server."""

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        analysis_model: str = "llama3.1:70b",
        coder_model: str = "qwen2.5-coder",
        timeout: float = 300.0,
        force_fallback: bool = False,
    ):
        self.base_url = base_url.rstrip("/")
        self.analysis_model = analysis_model
        self.coder_model = coder_model
        self.timeout = timeout
        self.force_fallback = force_fallback

    async def _call(self, client: httpx.AsyncClient, spec: _GenSpec) -> str:
        body: Dict[str, Any] = {
            "model": spec.model,
            "prompt": spec.prompt,
            "system": spec.system,
            "stream": False,
            "options": {
                "temperature": spec.temperature,
                "num_predict": spec.num_predict,
            },
        }
        if spec.as_json:
            body["format"] = "json"
        resp = await client.post(f"{self.base_url}/api/generate", json=body)
        resp.raise_for_status()
        return resp.json().get("response", "")

    async def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=self.timeout)

    async def request_json(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        required_keys: List[str],
        fallback: dict,
        model: Optional[str] = None,
        temperature: float = 0.2,
        num_predict: int = 400,
    ) -> dict:
        """Ask for a JSON object; validate required keys; fall back on error."""
        if self.force_fallback:
            return {**fallback, "_used_fallback": True}
        spec = _GenSpec(
            model=model or self.analysis_model,
            system=system_prompt,
            prompt=user_prompt,
            num_predict=num_predict,
            temperature=temperature,
            as_json=True,
        )
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                raw = await self._call(client, spec)
            cleaned = _strip_fences(raw)
            lo, hi = cleaned.find("{"), cleaned.rfind("}")
            if lo == -1 or hi <= lo:
                raise ValueError(f"No JSON object in response: {raw[:120]!r}")
            obj = json.loads(cleaned[lo : hi + 1])
            missing = [k for k in required_keys if k not in obj]
            if missing:
                raise ValueError(f"Missing keys {missing!r} in {list(obj)}")
            obj["_used_fallback"] = False
            return obj
        except Exception as exc:
            return {**fallback, "_used_fallback": True, "_error": str(exc)}

    async def single_shot(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        fallback_code: str = "",
        fallback_analysis: str = "Local model unreachable",
        model: Optional[str] = None,
        temperature: float = 0.1,
        num_predict: int = 2048,
    ) -> PatchResult:
        """One-shot generation with fallback values returned on any error."""
        chosen = model or self.analysis_model
        if self.force_fallback:
            return PatchResult(
                firmware=fallback_code,
                brief="Demo mode — using deterministic fallback",
                transcript=fallback_code,
                is_fallback=True,
            )
        spec = _GenSpec(
            model=chosen,
            system=system_prompt,
            prompt=user_prompt,
            num_predict=num_predict,
            temperature=temperature,
        )
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                raw = await self._call(client, spec)
            cleaned = _strip_fences(raw)
            if not cleaned:
                raise ValueError("Empty LLM response")
            return PatchResult(
                firmware=cleaned,
                brief=f"Generated by {chosen}",
                transcript=raw,
                is_fallback=False,
            )
        except Exception as exc:
            return PatchResult(
                firmware=fallback_code,
                brief=f"{fallback_analysis} ({exc})",
                transcript=str(exc),
                is_fallback=True,
            )

    async def craft_patch(
        self,
        telemetry_window: List[dict],
        compromised_sensor: str = "temperature",
    ) -> PatchResult:
        if self.force_fallback:
            return PatchResult(
                firmware=CANNED_FIRMWARE,
                brief="Demo mode — using deterministic fallback patch",
                transcript=CANNED_FIRMWARE,
                is_fallback=True,
            )
        ctx = _ChainCtx(
            window=telemetry_window, compromised=compromised_sensor or "temperature"
        )
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            await self._prepare(ctx)
            await self._analyst(client, ctx)
            await self._coder(client, ctx)
        return PatchResult(
            firmware=ctx.firmware,
            brief=ctx.brief,
            transcript=f"[analyst]\n{ctx.analyst_raw}\n\n[coder]\n{ctx.coder_raw}",
            is_fallback=False,
        )

    async def _prepare(self, ctx: _ChainCtx) -> None:
        window = ctx.window
        recent = window[-10:]
        ctx.telemetry_json = json.dumps(recent, indent=2)
        ctx.counts = {"n": len(recent), "total": len(window)}
        if len(window) >= 2:
            ctx.stats = {
                "temp_var": statistics.variance([r["temperature"] for r in window]),
                "pres_var": statistics.variance([r["pressure"] for r in window]),
            }
        else:
            ctx.stats = {"temp_var": 0.0, "pres_var": 0.0}

    async def _analyst(self, client: httpx.AsyncClient, ctx: _ChainCtx) -> None:
        prompt = ANALYST_USER_TMPL.format(
            **ctx.counts,
            telemetry_json=ctx.telemetry_json,
            temp_var=ctx.stats["temp_var"],
            pres_var=ctx.stats["pres_var"],
            compromised_sensor=ctx.compromised,
        )
        ctx.analyst_raw = await self._call(
            client,
            _GenSpec(
                model=self.analysis_model,
                system=ANALYST_PROMPT,
                prompt=prompt,
                num_predict=512,
            ),
        )
        ctx.brief = ctx.analyst_raw.strip()
        if not ctx.brief:
            raise RuntimeError("Empty response from analyst model")

    async def _coder(self, client: httpx.AsyncClient, ctx: _ChainCtx) -> None:
        prompt = CODER_USER_TMPL.format(
            analysis=ctx.brief,
            **ctx.counts,
            telemetry_json=ctx.telemetry_json,
        )
        ctx.coder_raw = await self._call(
            client,
            _GenSpec(
                model=self.coder_model,
                system=CODER_PROMPT,
                prompt=prompt,
                num_predict=2048,
            ),
        )
        ctx.firmware = _strip_fences(ctx.coder_raw)
        if not ctx.firmware:
            raise RuntimeError("Empty response from coder model")
