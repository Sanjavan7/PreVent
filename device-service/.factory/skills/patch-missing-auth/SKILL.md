---
name: patch-missing-auth
description: Fix a missing-authentication (CWE-306) flaw on a device control HTTP endpoint by adding token auth and refusing untrusted reported-state overrides, without changing the endpoint's legitimate behavior.
---

# Patching missing authentication (CWE-306) on the device control service

When asked to fix the missing-auth vulnerability on `POST /device/command`:

1. **Add authentication.** Require a valid bearer token / shared secret on the endpoint. Reject unauthenticated or invalid-token requests with HTTP 401/403. Read the expected secret from an env var (e.g. `DEVICE_CONTROL_TOKEN`); never hard-code it.
2. **Stop trusting client-supplied state.** Ignore `reported_overrides` from unauthenticated callers, and never let a caller desync `reported_state` from `true_state`. The device's reported vitals must reflect reality.
3. **Scope.** Edit ONLY `app.py` (plus a tiny auth helper if needed). Do not add endpoints, do not touch other files, and do not change the healthy-path behavior of `stop_fan` / `set_rate` / `resume` for authenticated callers.
4. **Preserve the emergency path.** A legitimate authenticated operator must still be able to control and recover the device. Never block the resume/recover action.
5. **Keep it minimal and reviewable.** The smallest diff that closes the exploit; leave a one-line comment citing CWE-306.

**Done =** the exact unauthenticated exploit request now returns 401/403, `true_state` is unchanged by it, and `reported_state == true_state` (no lie can be injected). A deterministic verifier re-runs the exploit to confirm.
