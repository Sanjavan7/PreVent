
## Architecture Specification: Project "Cal Hacks 2026" (Zero-Shot Sensor Virtualization)

**System Objective:** Demonstrate an air-gapped, autonomous defense system that detects physical hardware tampering (sensor spoofing) and uses a localized frontier LLM to dynamically compile a mathematical patch, flashing it to the Arduino UNO R4 in real time.

### 1. Hardware Layer (The Edge)
* **Microcontroller:** Arduino UNO R4 WiFi.
* **Sensors:** SPA06-003 on I2C (SDA A4, SCL A5, 3.3V) reporting room temperature and barometric pressure.
* **Actuator:** L293D driving a small DC fan. Enable D5, inputs D7 and D8, motor supply on chip pin 8 from a separate 3–9 V pack.
* **Fault:** Raised from the console (Simulate sensor fault). One channel stops tracking the others.

### 2. Software Orchestration Layer (The Bridge)
* **Language:** Python 3.10+
* **Core Responsibilities:**
    * Read high-frequency telemetry from the Arduino via `pyserial`.
    * Maintain a rolling window of the last $N$ seconds of telemetry data.
    * Detect thresholds indicating an anomaly (e.g., Temperature delta is zero while Pressure delta is high).
    * Package the rolling window data and a strict system prompt to send to the local LLM.
    * Parse the LLM's response to extract the generated C++ code.
    * Invoke `arduino-cli` as a subprocess to compile and flash the new firmware via USB.

### 3. Intelligence Layer (The Air-Gapped SOC)
* **Engine:** Local 200B parameter model (e.g., accessed via Ollama, vLLM, or text-generation-webui API).
* **Core Responsibilities:**
    * Ingest the JSON telemetry payload.
    * Perform a zero-shot multivariate linear regression or generate a simple Multi-Layer Perceptron (MLP) mapping.
    * Output *strictly* valid Arduino C++ code containing the mathematical patch, with no markdown formatting or conversational filler.

---

## Attack Vectors & Vulnerabilities (Options for the Demo)

Here are three different technical vulnerabilities you can target, ranging from easiest to implement to most visually impressive.

### Option 1: EMI Sensor Spoofing (The Primary Recommendation)
* **The Vulnerability:** The SPA06 temperature value can be held or drifted while pressure keeps moving.
* **The Fault:** One SPA06 channel stops tracking the other, so the console no longer trusts that value.
* **The LLM Fix:** The safeguard stops using the bad SPA06 channel and calculates it from the surviving channel.

## Presentation Narratives (The Pitch)

When presenting to judges, adapt the framing of the architecture to fit the specific sponsor tracks.

| Context | The Threat Scenario | The Pitch Angle |
| :--- | :--- | :--- |
| **Tactical / Defense** | Forward Operating Base drone swarm under Electronic Warfare attack. | *"Air-Gapped Tactical Healer. In denied-comms environments, our localized model serves as an autonomous Cyber Command, patching embedded systems against RF zero-days without emitting outward network packets."* |
| **Healthcare / Medical** | Networked ICU life-support system or surgical robot. | *"Zero-Trust Autonomous Triage. Medical networks cannot send raw telemetry to the cloud due to HIPAA/compliance latency. Our model acts as an on-premise immune system, isolating sensor faults in real-time."* |
| **Industrial / SCADA** | Nuclear facility cooling system or water treatment plant. | *"Generative SCADA Defender. When physical air-gaps are breached, our isolated cluster dynamically reverse-engineers the industrial sabotage, calculating virtual sensor stand-ins to prevent physical infrastructure damage."* |

---
