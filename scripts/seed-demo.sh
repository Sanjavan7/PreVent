#!/usr/bin/env bash
# Seed PreVent demo states by calling SpacetimeDB reducers directly.
# Lets Dev 3 (and anyone else) watch the dashboard + Pixi monitor react
# without the real orchestrator or security loop having to run.
#
# Usage:
#   scripts/seed-demo.sh <phase> [server]
#
#   phase  = healthy | attack | mayday | scanning | patch-pending | verified | reset
#   server = local (default) | maincloud
#
# Examples:
#   scripts/seed-demo.sh healthy
#   scripts/seed-demo.sh attack           # the device starts LYING
#   scripts/seed-demo.sh mayday           # alarm fires + telemetry snaps red
#   scripts/seed-demo.sh patch-pending    # awaiting-approval card appears
#   scripts/seed-demo.sh verified         # all green, loop done
#   scripts/seed-demo.sh reset            # wipe + back to healthy
#
# Nothing here is a secret -- the state goes to whichever module your frontend
# is pointed at via VITE_SPACETIMEDB_URI (local for solo dev, maincloud for team).

set -euo pipefail

PHASE="${1:-healthy}"
SERVER="${2:-local}"
MODULE="prevent"

call() {
  spacetime call --server "$SERVER" "$MODULE" "$@" >/dev/null
}

say() { printf "\033[36m• %s\033[0m\n" "$*"; }

case "$PHASE" in
  healthy)
    say "healthy baseline — fan on, vitals 72/98, nothing compromised"
    call update_device_status true 72 98 72 98 false false "healthy"
    ;;

  scanning)
    say "scanner finds the real CWE-306 + a Bandit decoy"
    call record_finding "semgrep" "CVE-2019-6538" "device-service/app.py" 42 "ERROR" "Missing authentication on POST /device/command (CWE-306) — the real exploitable flaw" true
    call record_finding "bandit" "" "device-service/app.py" 12 "LOW" "debug=True flagged, but not the exploitable issue" false
    call update_agent_status "scan-agent" "scan" "running" "Reading app.py; semgrep rule missing-auth tripped on line 42; bandit flagged debug=True — likely a decoy. Cross-checking POST /device/command for an auth decorator..." 0.72 "could still be a false positive; need to confirm no middleware is intercepting"
    call log_event "orchestrator" "SemGrep + Bandit scan complete; Claude triaging 2 findings"
    ;;

  attack)
    say "attacker fires the unauthenticated POST — device LIES"
    # Fan STOPS (true), but reported vitals and alarm stay healthy = the deception
    call update_device_status false 35 82 72 98 false true "stop_fan (unauthenticated)"
    call update_agent_status "deliver-agent" "deliver" "done" "POST /device/command 200 OK — fan actuator responded to unsigned payload. True vitals degrading. Reported telemetry still green." 0.97 ""
    call log_event "orchestrator" "Exploit delivered; device obeyed unauthenticated command"
    ;;

  mayday)
    say "device finally admits the alarm — telemetry snaps red"
    call update_device_status false 32 76 72 98 true true "mayday"
    call log_event "monitor" "ALARM: respiration flat, SpO2 falling fast"
    ;;

  self-correct)
    say "patch agent catches its own mistake"
    call update_agent_status "patch-agent" "patch" "running" "REJECTED my own patch — v1 broke the emergency override path. Revising: scope the auth check to /device/command only." 0.58 "need to re-run the full test matrix before resubmitting"
    call log_event "patch-agent" "Self-correction: v1 broke emergency override; revising"
    ;;

  guardrail)
    say "sandbox refuses an out-of-scope action"
    call log_event "guardrail" "ACTION REFUSED — reach at a second device outside incident scope"
    ;;

  patch-pending)
    say "Factory Droid wrote the fix; awaiting human approval"
    call update_agent_status "patch-agent" "patch" "waiting_for_human" "Patch written and sandboxed: require X-Device-Token on POST /device/command; drop reportedOverrides. 41/41 unit tests green. Exploit proof captured." 0.91 "needs human sign-off before deployment"
    call log_event "patch-agent" "Diff ready in device-service/app.py — awaiting APPROVE"
    ;;

  verified)
    say "patch deployed; same exploit now bounces off 401; vitals restored"
    call update_agent_status "verify-agent" "verify" "done" "Replayed the exact exploit payload: server returned 401 Unauthorized. Fan state unchanged. true_state matches reported. No lie detected." 0.99 ""
    call update_agent_status "restore-agent" "restore" "done" "Device restored to healthy baseline; incident report generated." 0.99 ""
    call update_device_status true 72 98 72 98 false false "verified"
    call log_event "orchestrator" "Loop closed: find → exploit → patch → verify → restore"
    ;;

  reset)
    say "wipe demo state (reset_healthy clears tables; may require module support)"
    call reset_healthy || say "(reset_healthy failed — module may not implement it; use 'healthy' instead)"
    ;;

  *)
    cat <<EOF
Unknown phase: $PHASE

Phases:
  healthy        baseline
  scanning       SemGrep + Bandit findings + Claude triage
  attack         exploit fires; DEVICE IS LYING
  mayday         alarm finally fires; telemetry snaps red
  self-correct   patch agent rejects its own output
  guardrail      sandbox refuses an out-of-scope action
  patch-pending  Awaiting approval card appears
  verified       Loop closed; vitals restored
  reset          wipe + back to healthy
EOF
    exit 1
    ;;
esac

say "done ($PHASE)"
