// PreVent SpacetimeDB server module (contract 2a). spacetimedb@2.13.0.
//
// Publish:   pnpm --filter @prevent/realtime dev:module
// Bindings:  pnpm --filter @prevent/realtime gen   -> realtime/src/module_bindings (GENERATED, gitignored)
//
// Conventions (verified against the 2.x TS server docs, 2026-10-24):
//  - tables are built with table(opts, cols); schema({ ... }) takes ONE object; default export.
//  - reducers/lifecycle hooks MUST be `export const` (bare calls are silently ignored).
//  - ids are u32 so the client sees plain `number` (matches @prevent/contracts); timestamps are
//    epoch-ms f64 so they match contracts too. Optional columns are t.option(...) -> undefined.
//  - auto-inc inserts pass id: 0.
//  - helper functions/constants are NOT exported (named exports are reserved for registered items).
//
// SEPARATION OF DUTIES (enforced with ctx.sender, never trusted from args):
//  - The publisher identity is stored as `owner` in `init`. The owner may grant roles to other
//    identities (grantRole) and always passes role checks.
//  - updateDeviceStatus is the ONLY writer of the device_status row -> role 'device'.
//  - recordFinding -> 'scanner'; recordExploitRun -> 'exploit'; recordPatchAttempt -> 'patcher';
//  - approvePatch -> 'human', and the approver may NOT be the identity that proposed the patch.
//  - pushIrEvent -> 'bridge'; updateAgentStatus -> any pipeline role.
// TODO(dev): in the demo, grant each service identity its role once after publish
//   (`spacetime call prevent grantRole <identity> <role>`), or run everything as the owner.

import { schema, table, t, SenderError } from 'spacetimedb/server';

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

// Private (no `public: true`): never sent to clients.
const config = table(
  { name: 'config' },
  {
    id: t.u32().primaryKey(), // always 1
    owner: t.identity(),
  }
);

const roleGrant = table(
  { name: 'role_grant' },
  {
    id: t.u32().primaryKey().autoInc(),
    identity: t.identity().index('btree'),
    role: t.string(),
  }
);

/** SINGLE SOURCE OF TRUTH - exactly one row, id = 1. Drives hardware + both panels. */
const deviceStatus = table(
  { name: 'device_status', public: true },
  {
    id: t.u32().primaryKey(), // always 1
    fanOn: t.bool(), // TRUE state -> physical fan
    trueHr: t.u32(),
    trueSpo2: t.u32(),
    reportedHr: t.u32(), // what the device DISPLAYS (can lie)
    reportedSpo2: t.u32(),
    alarmActive: t.bool(),
    compromised: t.bool(),
    lastCommand: t.string(),
    updatedAt: t.f64(),
  }
);

const agentStatus = table(
  { name: 'agent_status', public: true },
  {
    id: t.u32().primaryKey().autoInc(),
    agentName: t.string().unique(),
    stage: t.string(), // Stage
    state: t.string(), // AgentState
    reasoning: t.string(), // accumulated streamed text_delta
    confidence: t.f64(), // 0..1
    uncertainty: t.string(),
    updatedAt: t.f64(),
  }
);

const findings = table(
  { name: 'findings', public: true },
  {
    id: t.u32().primaryKey().autoInc(),
    scanner: t.string(), // 'semgrep' | 'bandit'
    cveRef: t.string(),
    file: t.string(),
    line: t.u32(),
    severity: t.string(),
    claudeVerdict: t.string(),
    isTheRealOne: t.bool(),
    createdAt: t.f64(),
  }
);

const exploitRuns = table(
  { name: 'exploit_runs', public: true },
  {
    id: t.u32().primaryKey().autoInc(),
    findingId: t.u32(),
    modelId: t.string(),
    payloadRef: t.string(),
    deliveredAt: t.f64(),
    deviceImpact: t.string(),
    success: t.bool(),
  }
);

const patchAttempts = table(
  { name: 'patch_attempts', public: true },
  {
    id: t.u32().primaryKey().autoInc(),
    findingId: t.u32(),
    diffRef: t.string(),
    droidSession: t.string(),
    proposedAt: t.f64(),
    humanApproved: t.bool(),
    appliedAt: t.option(t.f64()), // contract: number | null
    proposedBy: t.identity(), // for separation of duties (extra vs contract)
  }
);

const eventLog = table(
  { name: 'event_log', public: true },
  {
    id: t.u32().primaryKey().autoInc(),
    ts: t.f64(),
    actor: t.string(),
    text: t.string(),
  }
);

const irEvents = table(
  { name: 'ir_events', public: true },
  {
    id: t.u32().primaryKey().autoInc(),
    ts: t.f64(),
    code: t.u32(),
    consumed: t.bool(),
  }
);

const spacetimedb = schema({
  config,
  roleGrant,
  deviceStatus,
  agentStatus,
  findings,
  exploitRuns,
  patchAttempts,
  eventLog,
  irEvents,
});
export default spacetimedb;

// ---------------------------------------------------------------------------
// Helpers (not exported)
// ---------------------------------------------------------------------------

// Derive the reducer ctx type from the module itself (works for init and reducers).
type Ctx = Parameters<Parameters<typeof spacetimedb.init>[0]>[0];

type Role = 'device' | 'scanner' | 'exploit' | 'patcher' | 'human' | 'bridge';
const PIPELINE_ROLES: Role[] = ['device', 'scanner', 'exploit', 'patcher', 'human', 'bridge'];
const STAGES = ['ground', 'scan', 'generate', 'deliver', 'patch', 'verify', 'restore'] as const;

function nowMs(ctx: Ctx): number {
  return Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);
}

function isOwner(ctx: Ctx): boolean {
  const cfg = ctx.db.config.id.find(1);
  return !!cfg && cfg.owner.equals(ctx.sender);
}

function hasRole(ctx: Ctx, allowed: Role[]): boolean {
  if (isOwner(ctx)) return true;
  for (const g of ctx.db.roleGrant.identity.filter(ctx.sender)) {
    if ((allowed as string[]).includes(g.role)) return true;
  }
  return false;
}

function requireRole(ctx: Ctx, what: string, ...allowed: Role[]): void {
  if (!hasRole(ctx, allowed)) {
    throw new SenderError(`${what}: sender lacks required role (${allowed.join('|')})`);
  }
}

function log(ctx: Ctx, actor: string, text: string): void {
  ctx.db.eventLog.insert({ id: 0, ts: nowMs(ctx), actor, text });
}

const HEALTHY = {
  fanOn: true,
  trueHr: 72,
  trueSpo2: 98,
  reportedHr: 72,
  reportedSpo2: 98,
  alarmActive: false,
  compromised: false,
  lastCommand: 'resume',
} as const;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const init = spacetimedb.init((ctx) => {
  const ts = nowMs(ctx);
  ctx.db.config.insert({ id: 1, owner: ctx.sender });
  // Seed the single device row (id = 1).
  ctx.db.deviceStatus.insert({ id: 1, ...HEALTHY, updatedAt: ts });
  // Seed one agent_status row per stage so the timeline has stable ids.
  for (const stage of STAGES) {
    ctx.db.agentStatus.insert({
      id: 0,
      agentName: stage,
      stage,
      state: 'idle',
      reasoning: '',
      confidence: 0,
      uncertainty: '',
      updatedAt: ts,
    });
  }
  log(ctx, 'orchestrator', 'Pipeline idle. Device healthy.');
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const grantRole = spacetimedb.reducer(
  { identity: t.identity(), role: t.string() },
  (ctx, { identity, role }) => {
    if (!isOwner(ctx)) throw new SenderError('grantRole: owner only');
    if (!(PIPELINE_ROLES as string[]).includes(role)) {
      throw new SenderError(`grantRole: unknown role '${role}'`);
    }
    ctx.db.roleGrant.insert({ id: 0, identity, role });
    log(ctx, 'admin', `granted role '${role}'`);
  }
);

// ---------------------------------------------------------------------------
// Reducers (contract 2a). Each also inserts an event_log row.
// ---------------------------------------------------------------------------

/** ONLY writer of the device_status row. Called by the device-service / serial bridge. */
export const updateDeviceStatus = spacetimedb.reducer(
  {
    fanOn: t.bool(),
    trueHr: t.u32(),
    trueSpo2: t.u32(),
    reportedHr: t.u32(),
    reportedSpo2: t.u32(),
    alarmActive: t.bool(),
    compromised: t.bool(),
    lastCommand: t.string(),
  },
  (ctx, args) => {
    requireRole(ctx, 'updateDeviceStatus', 'device');
    const cur = ctx.db.deviceStatus.id.find(1);
    const next = { id: 1, ...args, updatedAt: nowMs(ctx) };
    if (cur) ctx.db.deviceStatus.id.update(next);
    else ctx.db.deviceStatus.insert(next);
    log(
      ctx,
      'device',
      `${args.lastCommand}: fan=${args.fanOn ? 'on' : 'off'} true=${args.trueHr}/${args.trueSpo2} ` +
        `reported=${args.reportedHr}/${args.reportedSpo2} alarm=${args.alarmActive} compromised=${args.compromised}`
    );
  }
);

/** Upsert by agentName (one row per pipeline stage). Streamed reasoning is accumulated by caller. */
export const updateAgentStatus = spacetimedb.reducer(
  {
    agentName: t.string(),
    stage: t.string(),
    state: t.string(),
    reasoning: t.string(),
    confidence: t.f64(),
    uncertainty: t.string(),
  },
  (ctx, args) => {
    requireRole(ctx, 'updateAgentStatus', ...PIPELINE_ROLES);
    const cur = ctx.db.agentStatus.agentName.find(args.agentName);
    const row = { ...args, updatedAt: nowMs(ctx) };
    if (cur) ctx.db.agentStatus.id.update({ ...row, id: cur.id });
    else ctx.db.agentStatus.insert({ ...row, id: 0 });
    log(ctx, args.agentName, `${args.stage} -> ${args.state} (confidence ${args.confidence.toFixed(2)})`);
  }
);

export const recordFinding = spacetimedb.reducer(
  {
    scanner: t.string(),
    cveRef: t.string(),
    file: t.string(),
    line: t.u32(),
    severity: t.string(),
    claudeVerdict: t.string(),
    isTheRealOne: t.bool(),
  },
  (ctx, args) => {
    requireRole(ctx, 'recordFinding', 'scanner');
    ctx.db.findings.insert({ ...args, id: 0, createdAt: nowMs(ctx) });
    log(ctx, 'scanner', `finding ${args.scanner} ${args.file}:${args.line} ${args.severity}${args.isTheRealOne ? ' (REAL)' : ''}`);
  }
);

export const recordExploitRun = spacetimedb.reducer(
  {
    findingId: t.u32(),
    modelId: t.string(),
    payloadRef: t.string(),
    deviceImpact: t.string(),
    success: t.bool(),
  },
  (ctx, args) => {
    requireRole(ctx, 'recordExploitRun', 'exploit');
    ctx.db.exploitRuns.insert({ ...args, id: 0, deliveredAt: nowMs(ctx) });
    log(ctx, 'exploit', `exploit by ${args.modelId} on finding ${args.findingId}: ${args.success ? 'SUCCESS' : 'failed'} - ${args.deviceImpact}`);
  }
);

/**
 * Insert a new proposed patch, or (when patchId is given) update an existing one - e.g. after a
 * rejected v1 is revised, or to stamp appliedAt once approved + applied.
 * Never sets humanApproved: only approvePatch may do that.
 */
export const recordPatchAttempt = spacetimedb.reducer(
  {
    patchId: t.option(t.u32()),
    findingId: t.u32(),
    diffRef: t.string(),
    droidSession: t.string(),
    appliedAt: t.option(t.f64()),
  },
  (ctx, { patchId, findingId, diffRef, droidSession, appliedAt }) => {
    requireRole(ctx, 'recordPatchAttempt', 'patcher');
    if (patchId !== undefined && patchId !== null) {
      const cur = ctx.db.patchAttempts.id.find(patchId);
      if (!cur) throw new SenderError(`recordPatchAttempt: no patch ${patchId}`);
      ctx.db.patchAttempts.id.update({ ...cur, diffRef, droidSession, appliedAt });
      log(ctx, 'patcher', `patch ${patchId} updated${appliedAt !== undefined && appliedAt !== null ? ' (applied)' : ''}`);
      return;
    }
    ctx.db.patchAttempts.insert({
      id: 0,
      findingId,
      diffRef,
      droidSession,
      proposedAt: nowMs(ctx),
      humanApproved: false,
      appliedAt,
      proposedBy: ctx.sender,
    });
    log(ctx, 'patcher', `patch proposed for finding ${findingId} (${droidSession})`);
  }
);

/** Human-in-the-loop gate. The approver must differ from the proposer. */
export const approvePatch = spacetimedb.reducer(
  { patchId: t.u32() },
  (ctx, { patchId }) => {
    requireRole(ctx, 'approvePatch', 'human');
    const cur = ctx.db.patchAttempts.id.find(patchId);
    if (!cur) throw new SenderError(`approvePatch: no patch ${patchId}`);
    // Separation of duties: the proposer cannot approve its own patch (owner included).
    if (cur.proposedBy.equals(ctx.sender)) {
      throw new SenderError('approvePatch: proposer cannot approve its own patch');
    }
    ctx.db.patchAttempts.id.update({ ...cur, humanApproved: true });
    log(ctx, 'human', `patch ${patchId} APPROVED`);
  }
);

/** Free-form event_log entry for any pipeline actor. */
export const logEvent = spacetimedb.reducer(
  { actor: t.string(), text: t.string() },
  (ctx, { actor, text }) => {
    requireRole(ctx, 'logEvent', ...PIPELINE_ROLES);
    log(ctx, actor, text);
  }
);

/** IR remote press forwarded by the serial bridge (the physical "approve"/"reset" trigger). */
export const pushIrEvent = spacetimedb.reducer(
  { code: t.u32() },
  (ctx, { code }) => {
    requireRole(ctx, 'pushIrEvent', 'bridge');
    ctx.db.irEvents.insert({ id: 0, ts: nowMs(ctx), code, consumed: false });
    log(ctx, 'bridge', `IR code ${code}`);
  }
);

/** Reset the demo: healthy device row + all agents idle. Does not clear history tables. */
export const resetHealthy = spacetimedb.reducer((ctx) => {
  requireRole(ctx, 'resetHealthy', 'device', 'human');
  const ts = nowMs(ctx);
  const next = { id: 1, ...HEALTHY, updatedAt: ts };
  if (ctx.db.deviceStatus.id.find(1)) ctx.db.deviceStatus.id.update(next);
  else ctx.db.deviceStatus.insert(next);
  for (const a of ctx.db.agentStatus.iter()) {
    ctx.db.agentStatus.id.update({
      ...a,
      state: 'idle',
      reasoning: '',
      confidence: 0,
      uncertainty: '',
      updatedAt: ts,
    });
  }
  log(ctx, 'orchestrator', 'Reset: device healthy, agents idle.');
});
