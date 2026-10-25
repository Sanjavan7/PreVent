# Two-laptop demo: physical fan ⇄ 3D sim (SpacetimeDB)

The 3D simulation (laptop A) and the physical ELEGOO UNO + fan (laptop B) stay in sync by both
being **clients of one shared `device_status` row** in SpacetimeDB. Nothing connects laptop-to-laptop
and nothing uses `localhost` across machines — both laptops reach the same cloud database over the
internet. When the device is compromised, the row flips (`fanOn=false, compromised=true`): the sim
freezes the ventilator and reddens the ward, and the bridge drives the real fan off + RGB red + buzzer.

```
                    SpacetimeDB Maincloud  (wss://maincloud.spacetimedb.com, module `prevent`)
                            device_status row (single source of truth)
                           /                 |                        \
          reads (no auth) /       writes (role `device`)               \ reads (no auth)
                         /                   |                          \
             Laptop A: 3D sim      TRIGGER (owner / security loop)   Laptop B: serial-bridge
             (app, browser)        seed-demo.sh | Command Center     → USB serial → UNO → fan
```

---

## Prerequisites (both laptops)
- Repo cloned, `pnpm install` run at the repo root.
- Internet on both laptops (any network — venue wifi or a phone hotspot; no shared LAN needed).
- Generated module bindings present: `pnpm --filter @prevent/realtime gen` (offline, from the module
  source). They're gitignored, so run this on any freshly-cloned machine.

## One-time, by the module OWNER (the person whose SpacetimeDB login published `prevent` to Maincloud)
Only the owner can publish, grant roles, or (via CLI) write the row. Do this once before the demo:

1. Publish / refresh the module on Maincloud:
   `spacetime publish --module-path realtime/spacetimedb --server maincloud prevent`
2. Decide who writes `device_status` during the demo and grant that identity the `device` role:
   - If the **owner** will trigger from the CLI, grant the owner's own identity:
     `spacetime call --server maincloud prevent grant_role 0x<owner-identity> device`
     (`spacetime login show` prints the identity.)
   - If the **security loop / device-service** writes the row, grant *its* identity instead.
   - Reading the row needs no role, so the sim and the bridge need no grant.

---

## Laptop A — the 3D simulation
Env (root `.env`, or `VITE_`-prefixed shell vars — Vite's `loadEnv` reads both):
```
VITE_REALTIME_BACKEND=spacetimedb
VITE_SPACETIMEDB_URI=wss://maincloud.spacetimedb.com
VITE_SPACETIMEDB_MODULE=prevent
```
Run: `pnpm --filter @prevent/app dev`
Open:
- **Patient Ward (3D sim):** `http://localhost:<port>/sim.html`
- **Command Center:** `http://localhost:<port>/`
  (Vite prints the port — 5173 by default, or the next free one.)

The sim is a *client* — it does not need to be reachable from laptop B.

## Laptop B — the hardware bridge
1. Plug the UNO into laptop B over USB. Find its COM port (Device Manager → Ports).
2. Run the bridge in **live** mode (it's a plain `tsx` process and does **not** auto-load `.env`,
   so pass the vars inline):

   **PowerShell:**
   ```powershell
   $env:BRIDGE_MODE='live'
   $env:VITE_SPACETIMEDB_URI='wss://maincloud.spacetimedb.com'
   $env:VITE_SPACETIMEDB_MODULE='prevent'
   $env:ARDUINO_SERIAL_PORT='COM3'   # <- your port
   pnpm --filter @prevent/serial-bridge dev
   ```
   **bash:**
   ```bash
   BRIDGE_MODE=live \
   VITE_SPACETIMEDB_URI=wss://maincloud.spacetimedb.com \
   VITE_SPACETIMEDB_MODULE=prevent \
   ARDUINO_SERIAL_PORT=COM3 \
   pnpm --filter @prevent/serial-bridge dev
   ```
3. Expect: `[realtime] connected as <identity>` then `[serial] opened COM3 … READY`. Once `READY`,
   the bridge sends a `STATE,…` frame on every row change (and re-sends the full state on each
   replug/reset).

> If the fan doesn't move but the bridge logs `[bridge] -> STATE,fan=1,…`, the serial native binding
> may not have built. Run `pnpm approve-builds` (select `@serialport/bindings-cpp`), reinstall, retry.
> `pushIrEvent` (physical IR remote → trigger) calls a role-`bridge` reducer; it needs a granted
> identity (`SPACETIMEDB_TOKEN`) and is optional — the fan-mirrors-sim path does not use it.

---

## Running the demo (the trigger)
With both laptops connected to the same Maincloud `prevent` module, drive the shared row from the
**owner's** laptop (or the security loop / Command Center). The helper script fires the scripted
phases against Maincloud:
```
scripts/seed-demo.sh healthy  maincloud   # calm baseline — fan ON, vitals green
scripts/seed-demo.sh attack   maincloud   # fan STOPS, device LIES (reported vitals still green)
scripts/seed-demo.sh mayday   maincloud   # alarm fires, true vitals go red
scripts/seed-demo.sh reset    maincloud   # back to healthy (recovery)
```
Each call → the sim (laptop A) and the physical fan (laptop B) react within ~1 second, together.
(Equivalent raw call: `spacetime call --server maincloud prevent update_device_status <fanOn> <trueHr> <trueSpo2> <reportedHr> <reportedSpo2> <alarm> <compromised> "<cmd>"`.)

## Pre-demo checklist
1. `pnpm --filter @prevent/serial-bridge typecheck` and `@prevent/realtime typecheck` pass.
2. Bridge in live mode (no UNO) prints `[realtime] connected as …` against Maincloud.
3. Sim on laptop A shows the ward; owner fires `attack` → ward freezes/reddens.
4. UNO plugged into laptop B; `attack` → physical fan spins down + RGB red + buzzer; `reset` → fan back on.
5. Full `healthy → attack → mayday → reset` dress rehearsal on the actual venue network once.

## Offline fallback (no internet at the venue)
Put both laptops on one phone hotspot. On a host laptop:
`spacetime start` (it binds `0.0.0.0:3000`), then
`spacetime publish --module-path realtime/spacetimedb --server local prevent`
and point **both** laptops' `VITE_SPACETIMEDB_URI` at `ws://<host-LAN-ip>:3000`. The host's login is
the owner of the local module, so grant/trigger with `--server local`. Everything else is identical.
