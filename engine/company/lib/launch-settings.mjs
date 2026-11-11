// Compares how the board would launch an agent with what the company file says (CONTRACTS 5.2,
// plan revision R2). The whole adapter configuration, the adapter type (which also carries the
// runner: paperclip's own runner shows as the type "paperclip_runner"), the run settings
// (runtimeConfig) and the run environment are compared. Only the keys in BOARD_MANAGED may hold
// something the company file does not produce. Nothing here prints a value: a value may be a secret.
import { join } from "node:path";

// The keys paperclip 2026.1106.0 writes into an agent's adapter configuration by itself, and the
// one value each may hold. Read from engine/node_modules/@paperclipai/server/dist.
const instructionsRoot = (ctx) => join(ctx.instanceRoot, "companies", ctx.companyId, "agents", ctx.agentId, "instructions");
export const BOARD_MANAGED = {
  // routes/agents.js materializeDefaultInstructionsBundleForNewAgent and services/agent-instructions.js
  // applyBundleConfig: every new agent gets its managed AGENTS.md folder under the instance root.
  instructionsBundleMode: { tools: ["claude", "codex"], value: () => "managed" },
  instructionsRootPath: { tools: ["claude", "codex"], value: instructionsRoot },
  instructionsEntryFile: { tools: ["claude", "codex"], value: () => "AGENTS.md" },
  instructionsFilePath: { tools: ["claude", "codex"], value: (ctx) => join(instructionsRoot(ctx), "AGENTS.md") },
  // routes/agents.js applyCreateDefaultsByAdapterType: every codex_local create and adapter update
  // sets it to DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX (true) when no bypass flag is given.
  dangerouslyBypassApprovalsAndSandbox: { tools: ["codex"], value: () => true },
  // services/agent-runner-selection.js resolveNewAgentRunner persists it as true when a runner is
  // chosen; adapter-claude-local documents true as the default, so true launches the same as absent.
  dangerouslySkipPermissions: { tools: ["claude"], value: () => true },
};

// The run settings apply sets; the board fills in only these two (routes/agents.js
// normalizeNewAgentRuntimeConfig), so anything else in runtimeConfig is a difference.
export const desiredRuntimeConfig = (a) => ({ heartbeat: { enabled: false, maxConcurrentRuns: a.limits.maxConcurrentRuns } });

const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// A setting's name is printed; a name that is not plain is not.
export const settingName = (k) => (/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(k) ? k : "a setting with an unusual name");

// What differs between the agent on the board (`found`) and the company file (`a`, `want`).
// owned: adapter settings apply sets that differ; extra: names of settings the file does not have;
// reset: board-managed settings with another value; run: run-setting names that differ;
// typeDiffers: the tool or runner differs; environment: a run environment is set.
export function launchDifferences(a, want, found, ctx) {
  const have = isObj(found.adapterConfig) ? found.adapterConfig : {};
  const out = { owned: [], extra: [], reset: [], run: [], typeDiffers: false, runnerDiffers: false, environment: false };
  if (found.adapterType !== a.adapterType) out.typeDiffers = true;
  if (found.adapterType === "paperclip_runner" || (found.runner !== undefined && found.runner !== "legacy")) out.runnerDiffers = true;
  for (const [k, v] of Object.entries(want)) if (!same(have[k], v)) out.owned.push(k);
  for (const k of Object.keys(have)) {
    if (k in want) continue;
    const managed = BOARD_MANAGED[k];
    if (managed && managed.tools.includes(a.tool)) {
      if (!same(have[k], managed.value(ctx))) out.reset.push(k);
    } else out.extra.push(k);
  }
  const rcWant = desiredRuntimeConfig(a);
  const rc = isObj(found.runtimeConfig) ? found.runtimeConfig : {};
  for (const k of Object.keys(rc)) {
    if (k !== "heartbeat") { out.run.push(k); continue; }
    const hb = isObj(rc.heartbeat) ? rc.heartbeat : {};
    for (const h of Object.keys(hb)) if (!(h in rcWant.heartbeat)) out.run.push(`heartbeat.${h}`);
  }
  const hb = isObj(rc.heartbeat) ? rc.heartbeat : {};
  for (const [h, v] of Object.entries(rcWant.heartbeat)) if (hb[h] !== v) out.run.push(`heartbeat.${h}`);
  if (found.defaultEnvironmentId !== undefined && found.defaultEnvironmentId !== null) out.environment = true;
  return out;
}

export const anyDifference = (d) => d.typeDiffers || d.runnerDiffers || d.environment
  || d.owned.length + d.extra.length + d.reset.length + d.run.length > 0;

// The whole adapter configuration to send with replaceAdapterConfig: what the file produces, plus
// each board-managed key the board already holds, at its one expected value. Leaving out the
// instructions keys would make the board drop the agent's AGENTS.md (syncInstructionsBundleConfigFromFilePath).
export function fullAdapterConfig(a, want, found, ctx) {
  const have = isObj(found.adapterConfig) ? found.adapterConfig : {};
  const out = { ...want };
  for (const [k, managed] of Object.entries(BOARD_MANAGED)) {
    if (k in have && !(k in want) && managed.tools.includes(a.tool)) out[k] = managed.value(ctx);
  }
  return out;
}
