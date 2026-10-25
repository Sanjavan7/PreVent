"""Health check for the link between this backend and the Spark's Ollama.

Usage:
    python probe_model.py             # honours OLLAMA_URL / OLLAMA_MODEL in .env
    python probe_model.py http://100.x.x.x:11434 qwen2.5-coder:32b

Runs the checks as a fixed probe sequence: reachability → model present →
sample generation → tok/s rate, stopping at the first failure.
"""

import os
import sys
import time
from pathlib import Path
from typing import Callable, List, Optional
import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")
PROBE_PROMPT = (
    "Write a one-line Arduino C++ statement that turns pin 13 on. "
    "No markdown, no explanation."
)
BASE = (
    sys.argv[1]
    if len(sys.argv) > 1
    else os.getenv("OLLAMA_URL", "http://localhost:11434")
)
MODEL = sys.argv[2] if len(sys.argv) > 2 else os.getenv("OLLAMA_MODEL", "llama3.1:70b")


class Probe:
    """One named check. `run` returns an exit code, or None to keep going."""

    def __init__(self, name: str, run: Callable[[httpx.Client], Optional[int]]):
        self.name = name
        self.run = run


def _check_reachable(state: dict) -> Probe:
    def run(client: httpx.Client) -> Optional[int]:
        try:
            resp = client.get(f"{BASE}/api/tags")
            resp.raise_for_status()
        except Exception as exc:
            print(f"FAIL: cannot reach {BASE} — {exc}")
            return 1
        state["installed"] = [m["name"] for m in resp.json().get("models", [])]
        print(f"✓ Reachable. {len(state['installed'])} model(s) installed:")
        for name in state["installed"]:
            print(f"    - {name}")
        return None

    return Probe("reachability", run)


def _check_model_pulled(state: dict) -> Probe:
    def run(client: httpx.Client) -> Optional[int]:
        if MODEL in state["installed"]:
            return None
        print(f"\nFAIL: model '{MODEL}' not in `ollama list` on the server.")
        print(f"      Run on the Spark: ollama pull {MODEL}")
        return 2

    return Probe("model-pulled", run)


def _check_generation(state: dict) -> Probe:
    def run(client: httpx.Client) -> Optional[int]:
        print("\n→ Generating sample (1 short C++ snippet)…")
        started = time.perf_counter()
        try:
            resp = client.post(
                f"{BASE}/api/generate",
                json={
                    "model": MODEL,
                    "prompt": PROBE_PROMPT,
                    "stream": False,
                    "options": {"temperature": 0.1, "num_predict": 64},
                },
            )
            resp.raise_for_status()
        except Exception as exc:
            print(f"FAIL: generation request errored — {exc}")
            return 3
        state["result"] = resp.json()
        state["wall_s"] = time.perf_counter() - started
        return None

    return Probe("generation", run)


def _report(state: dict) -> int:
    result = state.get("result", {})
    tokens = result.get("eval_count", 0)
    eval_ns = result.get("eval_duration", 0)
    rate = tokens / (eval_ns / 1e9) if eval_ns else 0
    print(
        f"✓ Response in {state.get('wall_s', 0):.1f}s ({tokens} tokens, {rate:.1f} tok/s)"
    )
    print(f"\n  >>> {result.get('response', '').strip()}")
    print("\nBackend ↔ LLM link is healthy.")
    return 0


def main() -> int:
    print(f"→ Ollama:  {BASE}")
    print(f"→ Model:   {MODEL}\n")
    state: dict = {}
    probes: List[Probe] = [
        _check_reachable(state),
        _check_model_pulled(state),
        _check_generation(state),
    ]
    with httpx.Client(timeout=180.0) as client:
        for probe in probes:
            code = probe.run(client)
            if code is not None:
                return code
    return _report(state)


if __name__ == "__main__":
    sys.exit(main())
