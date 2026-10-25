# Arduino — Cal Hacks 2026 Ventilator

Firmware for the Arduino UNO R4 WiFi that streams SPA06 temperature, SPA06
pressure, and fan duty as JSON over USB serial. Hardware wiring is in `WIRING.md`.

## Layout

```
arduino/
├── shell.nix             # FHS env with arduino-cli + avrdude
├── WIRING.md             # bill of materials, pin map, wiring
├── SETUP.md              # this file
└── bedside/
    └── bedside.ino       # the sketch
```

## Prerequisites

- Nix (the `shell.nix` builds an FHS env so arduino-cli's prebuilt AVR
  toolchain can find `/lib/ld-linux*`).
- An Arduino UNO R4 WiFi plugged in. On macOS it enumerates as `/dev/cu.usbmodem…`. Find the exact name with `arduino-cli board list`.
- On Linux, a udev rule + group membership so non-root can write the port.
  On NixOS:
  ```nix
  services.udev.extraRules = ''
    SUBSYSTEM=="tty", ATTRS{idVendor}=="2341", GROUP="dialout", MODE="0660"
    SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", GROUP="dialout", MODE="0660"
  '';
  users.users.<you>.extraGroups = [ "dialout" ];
  ```
  Re-plug the board after `nixos-rebuild switch`.

## One-time setup

Enter the FHS shell from this directory:

```sh
nix-shell
```

Install the R4 core and the library the sketch uses:

```sh
arduino-cli core install arduino:renesas_uno
arduino-cli lib install LiquidCrystal
```

### Fix executable bits (NixOS-only quirk)

`arduino-cli` downloads prebuilt ELF binaries (discovery, avrdude, avr-gcc,
ctags…) into `~/.arduino15/packages/`. On NixOS those land **without** the
`+x` bit, so any compile/upload fails with `permission denied`. Run this
once after any `arduino-cli core install` or `lib install`:

```sh
find ~/.arduino15/packages -path '*/tools/*' -type f ! -perm -u+x \
  -exec chmod +x {} +
```

## Build

```sh
arduino-cli compile --fqbn arduino:renesas_uno:unor4wifi bedside
```

Expected output ends with the size summary, e.g.
`Sketch uses 7562 bytes (23%) of program storage space.`

## Flash

```sh
arduino-cli upload --fqbn arduino:renesas_uno:unor4wifi --port /dev/cu.usbmodemE83DC1E348A42 bedside
```

A successful upload prints `New upload port: /dev/cu.usbmodem… (serial)` and
exits 0. The board resets and the sketch starts running immediately.

### One-shot (build + flash)

```sh
arduino-cli compile --fqbn arduino:renesas_uno:unor4wifi --upload --port /dev/cu.usbmodemE83DC1E348A42 bedside
```

## Watch the telemetry

Reading the serial port from **inside** the bwrap FHS sandbox returns 0 bytes
— bwrap doesn't pass the tty through. Open a second terminal **outside**
`nix-shell`:

```sh
stty -f /dev/cu.usbmodemE83DC1E348A42 115200 cs8 -cstopb -parenb -ixon raw -echo
cat /dev/cu.usbmodemE83DC1E348A42
```

You should see one JSON line per ~100 ms:

```json
{"t":1524,"temp_c":26.6,"press":1014.9,"fan":192,"alarm":0}
```

Field reference:

| field   | type   | meaning |
| :------ | :----- | :------ |
| `t`     | uint32 | board uptime, ms |
| `temp_c`| float  | SPA06-003 temperature, °C. Prints `0.0` when the sensor is not answering |
| `press` | float  | SPA06-003 barometric pressure, hPa. Prints `0.0` when the sensor is not answering |
| `fan`   | int    | motor duty on the L293D enable pin, 0–255 |
| `alarm` | 0\|1   | 1 while the SPA06-003 cannot be read |

The Python bridge in `../backend/` consumes this stream — schema must stay
in sync with whatever it parses.

## Troubleshooting

| Symptom | Cause / fix |
| :--- | :--- |
| `fork/exec …: permission denied` during compile or upload | Re-run the `find … -exec chmod +x` from setup. |
| `Error starting discovery: …serial-discovery: permission denied` | Same as above — discovery binaries need `+x`. |
| `No boards found` from `arduino-cli board list` | The USB cable is unplugged, or discovery failed. Re-plug and run `arduino-cli board list`. |
| `Platform 'arduino:renesas_uno' not found` | `arduino-cli core install arduino:renesas_uno`. |
| `LiquidCrystal.h: No such file or directory` | `arduino-cli lib install LiquidCrystal`. The IDE-bundled copy in `~/.arduino15/libraries/` is **not** on arduino-cli's search path. |
| Upload fails with `No device found` | The port name changed or the cable is out. Use the port from `arduino-cli board list`. |
| `temp_c` stays `0.0` and `alarm` stays `1` | The SPA06-003 is not answering. Check 3.3V, GND, SDA on A4, and SCL on A5. |
| `press` sits near 1013 and barely moves | That is a room barometer. It reads the air around the chip. |
| Fan doesn't spin even at a high `fan` value | Motor supply missing, L293D notch reversed, or the motor-supply ground is not tied to Arduino GND. The motor is not powered from an Arduino pin. |
