# PLAN — HARDWARE: Physical Actuation + Serial Bridge + Emulator

> Project **PreVent** · Cal Hacks 13.0. Master: `plans/PLAN-MASTER.md`. Foundation first: `plans/PLAN-FOUNDATION.md`.
> **You own:** the Arduino **UNO R3** firmware, the Node **serial bridge** (SpacetimeDB client → serial), and the **software emulator** (same serial schema, no board). Sponsor: **Best Hardware**.
> **The device is driven by real software state:** a host service (Dev 2) writes `device_status`; the bridge subscribes and sends `STATE,...` lines; the UNO actuates. No scripting — the hardware always reflects the real row. A judge presses the **IR remote** → the UNO sends `IR,code=` → the bridge pushes `pushIrEvent` → the orchestrator fires the chosen exploit.

## Kit (Elegoo UNO R3 Super Starter Kit) + verified pins
- UNO R3 (no WiFi — USB serial only), LCD1602 (parallel), 5V relay, Fan blade + 3-6V motor, **L293D** driver, ULN2003+stepper, Servo SG90, active + passive buzzer, RGB LED ×2, 7-seg 1-digit & 4-digit, 74HC595, DHT11, HC-SR04, joystick, **IR receiver + remote**, photoresistor, thermistor, tilt switch, buttons, pot, 830-pt breadboard, jumpers, 9V battery, PSU module. **No soldering (venue rule).**
- Node serial: `npm i serialport@13.0.0` (Node ≥20) — **dry-run `node -e "require('serialport')"` pre-event** to confirm the native prebuild loads on Node 26/Windows. Arduino IDE 2.x + `IRremote` v4.

## Serial contract (frozen in `contracts/`)
```
115200 baud, line-based \n, colon/comma, NO JSON, fixed char buffer + strtok.
OUT host→UNO:  STATE,fan=<0|1>,rate=<0-255>,hr=<int>,spo2=<int>,alarm=<0|1>,rgb=<0|1|2>\n   (rgb 0=green 1=red 2=amber)
               SRV,angle=<0-180>\n
IN  UNO→host:  READY\n (once after setup)   IR,code=<uint32>\n (judge pick)   HB\n (~1/s heartbeat)
Mapping: fan=true_state.fan_on, rate=true, hr/spo2=reported_*, alarm=alarm_active, rgb from compromised.
```

## Tasks

### 1. Bench-test the SKU unknowns FIRST (burns time if wrong) — H0–H2
RGB common-anode vs cathode; IR module pin order (silkscreen + multimeter); whether the 4-digit 7-seg needs external multiplexing. Flash the hello-world `READY` sketch; confirm host reads `READY` at 115200.

### 2. Wiring — H0–H10
- Power rails first (board OFF). **Fan runs off the PSU 5V rail / 9V, NEVER an Arduino pin.** Common ground mandatory.
- **Conflict-free pin map** (avoid Servo-Timer1 / `tone()`-Timer2 clashes): fan PWM via **L293D 1,2EN→D6**; LCD RS/EN=D12/D13, D4–D7=A0–A3; 74HC595 DS/SH_CP/ST_CP=D7/D5/D3; passive buzzer=D4; RGB=D8/D10/D11; servo=D9; IR OUT=D2.

### 3. Firmware (`firmware/uno_actuator.ino`) — H2–H10
- Libs: LiquidCrystal, Servo, IRremote v4, `tone()`, raw L293D PWM (`analogWrite` on D6 for breathing rhythm).
- Parse `STATE,...` with a fixed buffer + `strtok` (no Arduino `String`); drive fan speed, LCD text (`HR nn SpO2 nn`), 4-digit 7-seg hero number, buzzer (silent unless `alarm=1`), RGB (green/red/amber), optional servo bellows.
- Emit `READY` once after `setup()`, `HB` ~1/s, and `IR,code=<uint32>` on each remote keypress.

### 4. Serial bridge (`serial-bridge/`, Node) — H2–H22
- SpacetimeDB client (`spacetimedb@2.13.0`) subscribes to `device_status`; open the port once, **wait for `READY` before sending** (opening the port resets the UNO via DTR); send `STATE,...` on every row update.
- On inbound `IR,code=` call the `pushIrEvent(code)` reducer (→ orchestrator fires the judge's payload).
- **Auto-reconnect + heartbeat watchdog** on USB disconnect.

### 5. Software emulator (`emulator/`) — H2–H10
- A drop-in that consumes `device_status` and logs/visualizes the same `STATE,...` stream (and can inject `IR` events), honoring the exact serial schema — so Dev 1/2/3 integrate without the board and the whole demo survives a dead board.

### 6. Bench airflow test at the mask — early
If a 3-6V fan through CPAP tubing can't be felt, lead the demo moment with the visual/audible cues (LCD lying, buzzer silent, RGB red, 7-seg crash number) and don't promise felt airflow.

## Acceptance
A `device_status` change drives fan/LCD/7-seg/buzzer/RGB correctly; the true-vs-reported mapping is right (fan follows TRUE state, vitals show REPORTED); an IR press reaches the orchestrator; the rig survives a USB unplug/replug; the emulator is a true drop-in for the board.
