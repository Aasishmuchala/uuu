// Stub of paperclip's board (port 3100) for tests. In memory, built-in modules only.
// Shapes follow the real board 2026.1106.0 as read from the running instance.
import http from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, basename, isAbsolute, join, relative, resolve } from "node:path";

// The grants a new agent receives when it becomes active (at creation, or at approval when
// it was hired waiting for approval), as in server/dist/lib/agent-permissions.js
// NEW_STANDARD_AGENT_DEFAULT_GRANT_KEYS. tasks:assign is among them for every agent.
export const DEFAULT_GRANT_KEYS = [
  "agents:configure", "agents:suggest-changes", "skills:create", "skills:suggest-changes",
  "tools:manage_connections", "tools:manage_profiles", "tools:view_audit", "audit:view_agent_actions",
  "tools:use", "tools:manage_runtime", "inbox:manage", "tasks:assign", "tasks:assign_scope",
  "tasks:manage_active_checkouts",
];
const defaultGrantScope = (key, agentId) => (key === "tasks:assign_scope" ? { subtreeRootAgentId: agentId }
  : key === "inbox:manage" ? { responsibleUserOnly: true } : null);
// The refusal both member-permission routes give for a member that is not a person
// (server/dist/routes/access.js getProtectedMemberReason): 403 through forbidden().
export const AGENT_MEMBER_REFUSAL = "Only human company members can be removed.";
const DEFAULT_REVISION_TEXT = "You are an agent in a Paperclip company.\n";
// Adapter settings the real board keeps for itself (server/dist/routes/agents.js
// KNOWN_INSTRUCTIONS_BUNDLE_KEYS) and carries over when an agent changes adapter
// (shared/dist/constants.js ADAPTER_AGNOSTIC_KEYS).
const INSTRUCTION_KEYS = ["instructionsBundleMode", "instructionsRootPath", "instructionsEntryFile", "instructionsFilePath", "agentsMdPath"];
const ADAPTER_AGNOSTIC_KEYS = ["env", "promptTemplate", "instructionsFilePath", "cwd", "timeoutSec", "graceSec", "bootstrapPromptTemplate", "paperclipSkillSync"];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const nowIso = () => new Date().toISOString();
const clone = (v) => (v === undefined ? v : structuredClone(v));

function emptyState() {
  return {
    companies: [], agents: [], projects: [], issues: [], comments: [], approvals: [], attention: [],
    liveRuns: [], tokens: {}, instructions: {}, memberGrants: {},
    wakes: [], interactions: [], threadInteractions: [], keys: [], heartbeatRuns: [],
    routines: [], routineTriggers: [], routineRuns: [],
  };
}

function loadState(seed) {
  const state = emptyState();
  if (seed) for (const [k, v] of Object.entries(clone(seed))) state[k] = v;
  return state;
}

function pathToRegex(pattern) {
  const names = [];
  const src = pattern.replace(/:([a-zA-Z]+)/g, (_, n) => { names.push(n); return "([^/]+)"; });
  return { re: new RegExp(`^${src}$`), names };
}

// `instanceRoot` is paperclip's instance folder as the board would resolve it; it is only used to
// write the managed instructions paths into adapter settings, never to touch a file.
export async function startStubBoard({ port = 0, seed, instanceRoot = join(homedir(), ".paperclip", "instances", "default") } = {}) {
  const state = loadState(seed);
  const requests = [];
  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, ...pathToRegex(pattern), handler });

  // ---- helpers
  const company = (id) => {
    const c = state.companies.find((x) => x.id === id);
    if (!c) throw new HttpError(404, "Company not found");
    return c;
  };
  const agentById = (id) => {
    const a = state.agents.find((x) => x.id === id);
    if (!a) throw new HttpError(404, "Agent not found");
    return a;
  };
  const issueById = (id) => {
    const i = state.issues.find((x) => x.id === id || x.identifier === id);
    if (!i) throw new HttpError(404, "Issue not found");
    return i;
  };
  const needOwner = (actor) => { if (actor.kind !== "owner") throw new HttpError(403, "Board access required"); };
  const needAgent = (actor) => { if (actor.kind !== "agent") throw new HttpError(401, "Agent authentication required"); };
  const needBody = (b) => {
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new HttpError(400, "Invalid request body");
    return b;
  };
  const publicAgent = (a) => { const { membershipId, ...rest } = a; return clone(rest); };
  const grantsOf = (a) => state.memberGrants[a.membershipId] || [];
  // Adds the default grants an agent lacks (the real board inserts them "on conflict do nothing").
  const giveDefaultGrants = (a) => {
    const list = (state.memberGrants[a.membershipId] ||= []);
    for (const k of DEFAULT_GRANT_KEYS) {
      if (!list.some((g) => g.permissionKey === k)) list.push({ permissionKey: k, scope: defaultGrantScope(k, a.id) });
    }
  };
  // As routes/agents.js buildAgentAccessState: every active member may assign ("simple_default"),
  // so access.canAssignTasks says little; only the tasks:assign grant itself shows the right.
  const assignSource = (a) => (a.role === "ceo" ? "ceo_role" : a.permissions?.canCreateAgents ? "agent_creator"
    : grantsOf(a).some((g) => g.permissionKey === "tasks:assign") ? "explicit_grant" : "simple_default");
  const withAccess = (a) => {
    const out = publicAgent(a);
    out.access = {
      canAssignTasks: true,
      taskAssignSource: assignSource(a),
      membership: {
        id: a.membershipId, companyId: a.companyId, principalType: "agent", principalId: a.id,
        status: "active", membershipRole: "member", createdAt: a.createdAt, updatedAt: a.updatedAt,
      },
      grants: grantsOf(a).map((g) => ({
        id: randomUUID(), companyId: a.companyId, principalType: "agent", principalId: a.id,
        permissionKey: g.permissionKey, scope: g.scope ?? null,
      })),
    };
    return out;
  };
  const addComment = (issue, body, actor) => {
    const c = {
      id: randomUUID(), issueId: issue.id, body: String(body),
      authorAgentId: actor.kind === "agent" ? actor.agentId : null,
      authorUserId: actor.kind === "owner" ? "local-board" : null,
      createdAt: nowIso(),
    };
    state.comments.push(c);
    return c;
  };
  const wake = (agentId, issueId, reason) => {
    if (agentId) state.wakes.push({ agentId, issueId, reason, at: nowIso() });
  };
  const dropAttention = (pred) => { state.attention = state.attention.filter((i) => !pred(i)); };
  // Adapter settings, stored whole as the real board stores them. As routes/agents.js
  // applyCreateDefaultsByAdapterType: a codex_local agent gets the bypass flag unless one is given.
  const adapterDefaults = (type, config) => {
    const next = { ...config };
    if (type === "codex_local" && typeof next.dangerouslyBypassApprovalsAndSandbox !== "boolean"
      && typeof next.dangerouslyBypassSandbox !== "boolean") next.dangerouslyBypassApprovalsAndSandbox = true;
    return next;
  };
  const managedRoot = (a) => join(instanceRoot, "companies", a.companyId, "agents", a.id, "instructions");
  const bundleConfig = (config, mode, rootPath, entryFile) => ({
    ...config, instructionsBundleMode: mode, instructionsRootPath: rootPath, instructionsEntryFile: entryFile,
    instructionsFilePath: resolve(rootPath, entryFile),
  });
  // As services/agent-instructions.js syncInstructionsBundleConfigFromFilePath.
  const syncInstructions = (a, config) => {
    const file = typeof config.instructionsFilePath === "string" ? config.instructionsFilePath.trim() : "";
    if (!file) {
      const next = { ...config };
      delete next.instructionsBundleMode; delete next.instructionsRootPath; delete next.instructionsEntryFile;
      return next;
    }
    const full = isAbsolute(file) ? file : resolve(typeof config.cwd === "string" ? config.cwd : "/", file);
    const rel = relative(managedRoot(a), full);
    const managed = rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
    return managed ? bundleConfig(config, "managed", managedRoot(a), rel) : bundleConfig(config, "external", dirname(full), basename(full));
  };

  // ---- health, companies
  route("GET", "/api/health", () => ({ status: "ok", version: "stub", deploymentMode: "local_trusted" }));
  route("GET", "/api/companies", () => clone(state.companies));
  route("POST", "/api/companies", ({ body, actor }) => {
    needOwner(actor); needBody(body);
    if (!body.name) throw new HttpError(400, "name is required");
    const c = {
      id: randomUUID(), name: body.name, description: body.description ?? null, status: "active",
      issuePrefix: String(body.name).replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "CMP",
      issueCounter: 0, requireBoardApprovalForNewAgents: false, createdAt: nowIso(), updatedAt: nowIso(),
    };
    state.companies.push(c);
    return [201, clone(c)];
  });
  route("GET", "/api/companies/:id", ({ params }) => clone(company(params.id)));
  route("PATCH", "/api/companies/:id", ({ params, body, actor }) => {
    needOwner(actor); needBody(body);
    const c = company(params.id);
    for (const k of ["name", "description", "requireBoardApprovalForNewAgents", "status"]) if (k in body) c[k] = body[k];
    c.updatedAt = nowIso();
    return clone(c);
  });

  // ---- agents
  route("GET", "/api/companies/:id/agents", ({ params }) => {
    company(params.id);
    return state.agents.filter((a) => a.companyId === params.id).map(publicAgent);
  });
  route("POST", "/api/companies/:id/agents", ({ params, body }) => {
    const c = company(params.id); needBody(body);
    if (!body.name) throw new HttpError(400, "name is required");
    const id = randomUUID();
    // As normalizeAgentPermissions(..., { context: "create" }): both default to true when not given.
    const given = body.permissions && typeof body.permissions === "object" ? clone(body.permissions) : {};
    const permissions = {
      ...given,
      canCreateAgents: typeof given.canCreateAgents === "boolean" ? given.canCreateAgents : true,
      canCreateSkills: typeof given.canCreateSkills === "boolean" ? given.canCreateSkills : true,
    };
    const t = nowIso();
    const agent = {
      id, companyId: c.id, name: body.name, role: body.role ?? "general", title: body.title ?? null,
      icon: null, status: c.requireBoardApprovalForNewAgents ? "pending_approval" : "idle",
      reportsTo: body.reportsTo ?? null, capabilities: body.capabilities ?? null,
      adapterType: body.adapterType ?? "claude_local", adapterConfig: {},
      runtimeConfig: clone(body.runtimeConfig) ?? {}, permissions, pauseReason: null, pausedAt: null,
      lastHeartbeatAt: null, metadata: clone(body.metadata) ?? null,
      urlKey: String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      createdAt: t, updatedAt: t, membershipId: randomUUID(),
    };
    // As materializeDefaultInstructionsBundleForNewAgent: the managed AGENTS.md folder, unless given.
    const config = adapterDefaults(agent.adapterType, clone(body.adapterConfig) ?? {});
    agent.adapterConfig = INSTRUCTION_KEYS.some((k) => typeof config[k] === "string" && config[k].trim())
      ? config : bundleConfig(config, "managed", managedRoot(agent), "AGENTS.md");
    state.agents.push(agent);
    // Grants come at activation: now, or at approval for an agent waiting for it.
    state.memberGrants[agent.membershipId] = [];
    if (agent.status !== "pending_approval") giveDefaultGrants(agent);
    state.instructions[id] = { "AGENTS.md": { content: DEFAULT_REVISION_TEXT, revisionId: randomUUID() } };
    return [201, publicAgent(agent)];
  });
  route("GET", "/api/agents/me", ({ actor }) => {
    needAgent(actor);
    return withAccess(agentById(actor.agentId));
  });
  route("GET", "/api/agents/:id", ({ params }) => withAccess(agentById(params.id)));
  route("PATCH", "/api/agents/:id", ({ params, body }) => {
    const a = agentById(params.id); needBody(body);
    const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
    if ("adapterConfig" in body && !isObj(body.adapterConfig)) throw new HttpError(422, "adapterConfig must be an object");
    if ("runtimeConfig" in body && !isObj(body.runtimeConfig)) throw new HttpError(422, "runtimeConfig must be an object");
    for (const k of ["name", "role", "title", "reportsTo", "capabilities", "metadata", "defaultEnvironmentId"]) if (k in body) a[k] = clone(body[k]);
    // As PATCH /agents/:id in routes/agents.js: adapterConfig is merged into what is there unless
    // replaceAdapterConfig is true or the adapter changes; a new adapter keeps the adapter-agnostic
    // settings and the instructions settings the request leaves out; the instructions settings
    // are then worked out again from instructionsFilePath.
    if ("adapterType" in body || "adapterConfig" in body) {
      const existing = a.adapterConfig || {};
      const type = typeof body.adapterType === "string" ? body.adapterType : a.adapterType;
      const changingType = type !== a.adapterType;
      const requested = "adapterConfig" in body ? clone(body.adapterConfig) : null;
      let config = requested ?? (changingType ? {} : existing);
      if (requested && !changingType && body.replaceAdapterConfig !== true) config = { ...existing, ...requested };
      if (changingType) {
        for (const k of ADAPTER_AGNOSTIC_KEYS) {
          if (!INSTRUCTION_KEYS.includes(k) && config[k] === undefined && existing[k] !== undefined) config[k] = existing[k];
        }
        if (!INSTRUCTION_KEYS.some((k) => k in config)) for (const k of INSTRUCTION_KEYS) if (existing[k] !== undefined) config[k] = existing[k];
      }
      a.adapterType = type;
      a.adapterConfig = syncInstructions(a, adapterDefaults(type, config));
    }
    // runtimeConfig is replaced whole, as the real board does for the owner.
    if ("runtimeConfig" in body) a.runtimeConfig = clone(body.runtimeConfig);
    a.updatedAt = nowIso();
    return publicAgent(a);
  });
  // As routes/agents.js PATCH /agents/:id/permissions: canCreateAgents and canAssignTasks are
  // required, canCreateSkills optional (400 otherwise); an agent waiting for approval gets 409.
  // Only the tasks:assign grant changes: added when the agent may assign, removed when not.
  // The answer is the agent with `access`, as GET /agents/:id gives it.
  route("PATCH", "/api/agents/:id/permissions", ({ params, body, actor }) => {
    const bool = (v) => typeof v === "boolean";
    if (!body || typeof body !== "object" || Array.isArray(body) || !bool(body.canCreateAgents) || !bool(body.canAssignTasks)
      || ("canCreateSkills" in body && !bool(body.canCreateSkills))) throw new HttpError(400, "Validation error");
    const a = agentById(params.id);
    if (actor.kind === "agent" && agentById(actor.agentId).role !== "ceo") throw new HttpError(403, "Only CEO can manage permissions");
    if (a.status === "pending_approval") throw new HttpError(409, "Pending approval agent permissions cannot be changed before board approval");
    for (const k of ["canAssignTasks", "canCreateAgents", "canCreateSkills"]) if (k in body) a.permissions[k] = body[k];
    const assign = a.role === "ceo" || a.permissions.canCreateAgents || body.canAssignTasks;
    const list = (state.memberGrants[a.membershipId] ||= []);
    const has = list.some((g) => g.permissionKey === "tasks:assign");
    if (assign && !has) list.push({ permissionKey: "tasks:assign", scope: null });
    if (!assign) state.memberGrants[a.membershipId] = list.filter((g) => g.permissionKey !== "tasks:assign");
    a.updatedAt = nowIso();
    return withAccess(a);
  });
  // The member routes refuse every agent (all members in this stub are agents). Order as in
  // routes/access.js: body check (400), then the member (404), then the refusal (403).
  const memberRoute = (method, suffix, needsGrants) => route(method, `/api/companies/:id/members/:memberId${suffix}`, ({ params, body, actor }) => {
    needOwner(actor);
    if (needsGrants && (!body || !Array.isArray(body.grants) || body.grants.some((g) => !g || typeof g.permissionKey !== "string"))) {
      throw new HttpError(400, "Validation error");
    }
    company(params.id);
    if (!state.agents.some((x) => x.membershipId === params.memberId && x.companyId === params.id)) throw new HttpError(404, "Member not found");
    throw new HttpError(403, AGENT_MEMBER_REFUSAL);
  });
  memberRoute("PATCH", "/permissions", true);
  memberRoute("PATCH", "/role-and-grants", false);
  memberRoute("PATCH", "", false);
  memberRoute("POST", "/archive", false);
  route("POST", "/api/agents/:id/pause", ({ params, body }) => {
    const a = agentById(params.id);
    a.status = "paused"; a.pauseReason = body?.reason ?? "manual"; a.pausedAt = nowIso(); a.updatedAt = nowIso();
    return publicAgent(a);
  });
  route("POST", "/api/agents/:id/resume", ({ params }) => {
    const a = agentById(params.id);
    a.status = "idle"; a.pauseReason = null; a.pausedAt = null; a.updatedAt = nowIso();
    return publicAgent(a);
  });
  route("POST", "/api/agents/:id/approve", ({ params, actor }) => {
    needOwner(actor);
    const a = agentById(params.id);
    if (a.status !== "pending_approval") throw new HttpError(409, "Agent is not waiting for approval");
    a.status = "idle"; a.updatedAt = nowIso();
    giveDefaultGrants(a);
    return publicAgent(a);
  });
  route("POST", "/api/agents/:id/keys", ({ params, body, actor }) => {
    needOwner(actor); agentById(params.id);
    const id = randomUUID();
    const token = "pcp_" + randomBytes(24).toString("hex");
    state.tokens[token] = params.id;
    state.keys.push({ id, agentId: params.id, name: body?.name ?? null, token });
    return [201, { id, token, name: body?.name ?? null }];
  });
  route("DELETE", "/api/agents/:id/keys/:keyId", ({ params, actor }) => {
    needOwner(actor);
    const k = state.keys.find((x) => x.id === params.keyId && x.agentId === params.id);
    if (!k) throw new HttpError(404, "Key not found");
    delete state.tokens[k.token];
    state.keys = state.keys.filter((x) => x !== k);
    return { ok: true };
  });

  // ---- instructions bundle
  const bundleFile = (agentId, file) => ({
    path: "AGENTS.md", content: file.content, size: Buffer.byteLength(file.content),
    revision: { agentId, id: file.revisionId, entryFile: "AGENTS.md", byteLength: Buffer.byteLength(file.content) },
  });
  route("GET", "/api/agents/:id/instructions-bundle/file", ({ params, query }) => {
    agentById(params.id);
    const file = state.instructions[params.id]?.[query.path];
    if (!file) throw new HttpError(404, "File not found");
    return bundleFile(params.id, file);
  });
  route("PUT", "/api/agents/:id/instructions-bundle/file", ({ params, query, body }) => {
    agentById(params.id); needBody(body);
    if (!query.path) throw new HttpError(400, "path is required");
    if (typeof body.content !== "string") throw new HttpError(400, "content must be text");
    const files = (state.instructions[params.id] ||= {});
    const current = files[query.path];
    const base = body.baseRevisionId ?? null;
    if ((current ? current.revisionId : null) !== base) throw new HttpError(409, "baseRevisionId does not match the current revision");
    files[query.path] = { content: body.content, revisionId: randomUUID() };
    return bundleFile(params.id, files[query.path]);
  });

  // ---- projects
  route("GET", "/api/companies/:id/projects", ({ params }) => state.projects.filter((p) => p.companyId === params.id).map(clone));
  route("POST", "/api/companies/:id/projects", ({ params, body }) => {
    company(params.id); needBody(body);
    if (!body.name) throw new HttpError(400, "name is required");
    const ws = body.workspace ? { id: randomUUID(), ...clone(body.workspace) } : null;
    const p = {
      id: randomUUID(), companyId: params.id, name: body.name, description: body.description ?? null,
      status: "backlog", workspaces: ws ? [ws] : [], primaryWorkspace: ws, createdAt: nowIso(), updatedAt: nowIso(),
    };
    state.projects.push(p);
    return [201, clone(p)];
  });

  // ---- issues
  route("GET", "/api/companies/:id/issues", ({ params, query }) => {
    company(params.id);
    let list = state.issues.filter((i) => i.companyId === params.id);
    if ("parentId" in query) list = list.filter((i) => i.parentId === query.parentId);
    if (query.projectId) list = list.filter((i) => i.projectId === query.projectId);
    if (query.status) { const s = query.status.split(","); list = list.filter((i) => s.includes(i.status)); }
    if (query.assigneeAgentId) list = list.filter((i) => i.assigneeAgentId === query.assigneeAgentId);
    list = [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : b.issueNumber - a.issueNumber));
    const limit = Number(query.limit);
    if (limit > 0) list = list.slice(0, limit);
    return list.map(clone);
  });
  // Makes a task as POST /issues does; also used by a routine's manual run.
  const makeIssue = (c, body, actor) => {
    c.issueCounter += 1;
    const t = nowIso();
    const issue = {
      id: randomUUID(), companyId: c.id, projectId: body.projectId ?? null, goalId: body.goalId ?? null,
      parentId: body.parentId ?? null, title: body.title, description: body.description ?? null,
      status: body.status ?? "todo", priority: body.priority ?? "medium",
      assigneeAgentId: body.assigneeAgentId ?? null, assigneeUserId: body.assigneeUserId ?? null,
      identifier: `${c.issuePrefix}-${c.issueCounter}`, issueNumber: c.issueCounter,
      createdByUserId: actor.kind === "owner" ? "local-board" : null,
      createdByAgentId: actor.kind === "agent" ? actor.agentId : null,
      createdAt: t, updatedAt: t,
    };
    for (const k of ["originKind", "originId", "startedAt", "completedAt"]) if (k in body) issue[k] = body[k];
    state.issues.push(issue);
    wake(issue.assigneeAgentId, issue.id, "assigned");
    return issue;
  };
  route("POST", "/api/companies/:id/issues", ({ params, body, actor }) => {
    const c = company(params.id); needBody(body);
    if (!body.title) throw new HttpError(400, "title is required");
    return [201, clone(makeIssue(c, body, actor))];
  });
  route("GET", "/api/issues/:id", ({ params }) => clone(issueById(params.id)));
  route("PATCH", "/api/issues/:id", ({ params, body, actor }) => {
    const issue = issueById(params.id); needBody(body);
    const before = issue.assigneeAgentId;
    for (const k of ["title", "description", "status", "priority", "assigneeAgentId", "assigneeUserId", "projectId", "parentId", "startedAt", "completedAt"]) if (k in body) issue[k] = body[k];
    if (typeof body.comment === "string" && body.comment) addComment(issue, body.comment, actor);
    issue.updatedAt = nowIso();
    if (issue.assigneeAgentId !== before) wake(issue.assigneeAgentId, issue.id, "assigned");
    return clone(issue);
  });
  route("GET", "/api/issues/:id/comments", ({ params }) => {
    const issue = issueById(params.id);
    return state.comments.filter((c) => c.issueId === issue.id).map(clone);
  });
  route("POST", "/api/issues/:id/comments", ({ params, body, actor }) => {
    const issue = issueById(params.id); needBody(body);
    if (typeof body.body !== "string" || !body.body) throw new HttpError(400, "body is required");
    const c = addComment(issue, body.body, actor);
    issue.updatedAt = nowIso();
    return [201, clone(c)];
  });
  route("POST", "/api/issues/:id/retry", ({ params, actor }) => {
    needOwner(actor);
    const issue = issueById(params.id);
    issue.status = "todo"; issue.updatedAt = nowIso();
    wake(issue.assigneeAgentId, issue.id, "retry");
    dropAttention((i) => i.sourceKind === "failed_run" && i.relatedIssue?.id === issue.id);
    return clone(issue);
  });
  // ---- execution holds, as routes/agents.js GET /issues/:issueId/execution, services/execution-projection.js,
  // routes/issues.js GET /issues/:id/recovery-actions and POST /issues/:id/recovery-actions/resolve take them.
  // `state.recoveryActions` holds the records (seeded by a test); `state.resolves` logs every resolve the board took.
  state.recoveryActions ||= [];
  state.resolves ||= [];
  const HOLD_CAUSES = new Set(["uncertain_provider_action", "uncertain_external_action", "uncertain_control_plane_action",
    "completed_action_context_missing", "continuation_evidence_incomplete", "execution_finalization_deadline_exceeded",
    "execution_recovery_budget_exhausted", "provider_effect_inventory_unavailable", "provider_failure_meaning_unverified",
    "provider_ownership_unverified", "native_provider_terminal_failed", "native_event_replay_conflict",
    "native_session_cleanup_quarantined", "native_session_retry_exhausted", "native_restart_recovery_blocked",
    "native_continuation_requires_reconciliation", "legacy_execution_requires_reconciliation"]);
  const ISSUE_STATUSES = ["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"];
  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const runIssueId = (r) => r.issueId ?? r.contextSnapshot?.issueId ?? null;
  const openAction = (a) => a.status === "active" || a.status === "escalated";
  const actionsOf = (issue) => state.recoveryActions.filter((a) => a.sourceIssueId === issue.id)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  const projection = (issue, run) => {
    const matching = actionsOf(issue).filter((a) => (a.status !== "resolved" || a.evidence?.executionReconciliation || a.evidence?.automaticRecovery)
      && (a.evidence?.runId === run.id || a.evidence?.sourceRunId === run.id));
    const action = matching.find((a) => a.status !== "resolved") ?? matching[0];
    const p = { phase: "queued", label: "Queued", cause: run.errorCode ?? null, lastConfirmedActivityAt: run.lastOutputAt ?? run.startedAt ?? null,
      retryAt: null, attempt: 1, maxAttempts: 3, recoveryOwner: null, nextAction: null, permittedActions: ["inspect_run"],
      predecessorRunId: null, successorRunId: null };
    const set = (phase, label) => Object.assign(p, { phase, label });
    if (action?.status === "resolved" && action.evidence?.automaticRecovery) {
      Object.assign(p, { cause: action.cause, nextAction: action.nextAction });
      return set("recovery_needed", "Stopped");
    }
    if (action?.status === "resolved" && action.evidence?.executionReconciliation) return set("queued", "Continuation queued");
    if (action) {
      Object.assign(p, { recoveryOwner: "board", cause: action.cause, nextAction: action.nextAction });
      p.permittedActions.push("inspect_recovery");
      return set("recovery_needed", "Recovery needed");
    }
    if (run.status === "succeeded") return set("completed", "Completed");
    if (["failed", "cancelled", "timed_out", "interrupted"].includes(run.status)) return set("failed", run.status === "cancelled" ? "Cancelled" : "Failed");
    if (run.status === "running") return set("running", "Running");
    return p;
  };
  route("GET", "/api/issues/:id/execution", ({ params }) => {
    const issue = issueById(params.id);
    const runs = state.heartbeatRuns.filter((r) => runIssueId(r) === issue.id).sort((a, b) => {
      const rank = (r) => (r.id === issue.executionRunId ? 0 : r.status === "running" ? 1 : 2);
      return rank(a) - rank(b) || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);
    });
    const run = runs[0];
    if (!run) return null;
    const active = actionsOf(issue).find(openAction) ?? null;
    return { runId: run.id, agentId: run.agentId, recoveryAction: clone(active), execution: projection(issue, run) };
  });
  route("GET", "/api/heartbeat-runs/:id", ({ params }) => {
    const run = state.heartbeatRuns.find((r) => r.id === params.id);
    if (!run) throw new HttpError(404, "Heartbeat run not found");
    return clone(run);
  });
  route("GET", "/api/issues/:id/recovery-actions", ({ params }) => {
    const issue = issueById(params.id);
    const active = actionsOf(issue).find(openAction) ?? null;
    const retained = actionsOf(issue).filter((a) => a.evidence?.automaticRecovery?.replay === "blocked" && HOLD_CAUSES.has(a.cause) && a.id !== active?.id);
    return { active: clone(active), actions: [...(active ? [active] : []), ...retained].map(clone) };
  });
  // resolveIssueRecoveryActionSchema (shared/dist/validators/issue.js), as far as a resolve with an execution
  // reconciliation meets it: 400 for a body the schema refuses.
  const checkResolve = (b) => {
    const bad = () => { throw new HttpError(400, "Validation error"); };
    if (!b || typeof b !== "object" || Array.isArray(b)) bad();
    for (const k of Object.keys(b)) if (!["workspaceBaseRef", "executionReconciliation", "actionId", "outcome", "sourceIssueStatus", "resolutionNote"].includes(k)) bad();
    if (!["restored", "false_positive", "blocked", "cancelled"].includes(b.outcome) || !ISSUE_STATUSES.includes(b.sourceIssueStatus)) bad();
    if (b.actionId !== undefined && !(typeof b.actionId === "string" && GUID.test(b.actionId))) bad();
    if (b.resolutionNote !== undefined && b.resolutionNote !== null && typeof b.resolutionNote !== "string") bad();
    if (b.workspaceBaseRef !== undefined) bad(); // branch repair is not stubbed
    const r = b.executionReconciliation;
    if (r !== undefined) {
      if (!r || typeof r !== "object" || Array.isArray(r)) bad();
      for (const k of Object.keys(r)) if (!["runId", "providerStopped", "actionOutcome", "outcomeEvidence", "workspaceRepairEvidence"].includes(k)) bad();
      if (!(typeof r.runId === "string" && GUID.test(r.runId)) || r.providerStopped !== true) bad();
      if (!["completed", "not_performed", "mixed"].includes(r.actionOutcome)) bad();
      const len = (v) => (typeof v === "string" ? v.trim().length : -1);
      if (len(r.outcomeEvidence) < 20 || len(r.outcomeEvidence) > 12000) bad();
      if (r.workspaceRepairEvidence !== undefined && (len(r.workspaceRepairEvidence) < 20 || len(r.workspaceRepairEvidence) > 12000)) bad();
    }
    if (b.outcome === "restored" && !r?.workspaceRepairEvidence && !["todo", "done", "in_review"].includes(b.sourceIssueStatus)) bad();
    if (b.outcome === "blocked" && b.sourceIssueStatus !== "blocked") bad();
    if (["false_positive", "cancelled"].includes(b.outcome) && !["done", "in_review"].includes(b.sourceIssueStatus)) bad();
  };
  route("POST", "/api/issues/:id/recovery-actions/resolve", ({ params, body, actor }) => {
    checkResolve(body);
    const issue = issueById(params.id);
    if (["false_positive", "cancelled"].includes(body.outcome)) needOwner(actor);
    const { actionId, outcome, sourceIssueStatus, resolutionNote, executionReconciliation: decision } = body;
    let active = actionsOf(issue).find(openAction) ?? null;
    if (actionId && active?.id !== actionId) {
      const settled = actionsOf(issue).find((a) => a.id === actionId && ["resolved", "cancelled"].includes(a.status));
      if (settled) {
        if (settled.evidence?.automaticRecovery?.replay === "blocked" && decision) {
          needOwner(actor);
          if (active || sourceIssueStatus !== "todo" || outcome !== "restored") {
            throw new HttpError(409, "Verified outcomes must restore this source recovery without replacing another active recovery action.");
          }
          Object.assign(settled, { status: "active", outcome: null, resolvedAt: null });
          active = settled;
        } else {
          return { issue: clone(issue), recoveryAction: clone(settled) };
        }
      }
    }
    if (!active || (actionId && active.id !== actionId)) throw new HttpError(404, "Active recovery action not found");
    if (sourceIssueStatus === "todo" && HOLD_CAUSES.has(active.cause)) {
      needOwner(actor);
      // services/execution-recovery-resolution.js validateExecutionReconciliation
      const sourceRunId = active.evidence?.runId ?? active.evidence?.sourceRunId;
      if (!decision || decision.runId !== sourceRunId || !issue.assigneeAgentId) {
        throw new HttpError(409, "Reconcile the recorded execution and its action outcomes before continuing this task.");
      }
      const run = state.heartbeatRuns.find((r) => r.id === decision.runId);
      if (!run || run.agentId !== issue.assigneeAgentId || runIssueId(run) !== issue.id || !["failed", "interrupted", "timed_out", "cancelled"].includes(run.status)) {
        throw new HttpError(409, "The recovery source or task owner changed. Inspect the current execution before continuing.");
      }
    } else if (decision) {
      throw new HttpError(409, "An execution reconciliation must target the current execution recovery action and continue the task.");
    }
    const handBack = outcome === "restored" && sourceIssueStatus === "todo" && active.returnOwnerAgentId != null
      && issue.assigneeAgentId === active.returnOwnerAgentId;
    if (sourceIssueStatus !== issue.status && handBack) {
      // assertSafeRecoveryHandBackGates: the recorded owner is still assigned and no run holds the task.
      if (issue.checkoutRunId || issue.executionRunId) throw new HttpError(409, "Safe recovery hand-back is locked by another active checkout or run");
    }
    if (decision) {
      const evidence = { ...active.evidence, executionReconciliation: { ...decision, actorId: "local-board", recordedAt: nowIso() }, continuationDelivery: "pending" };
      delete evidence.automaticRecovery;
      active.evidence = evidence;
    }
    issue.status = sourceIssueStatus; issue.updatedAt = nowIso();
    Object.assign(active, {
      status: outcome === "cancelled" ? "cancelled" : "resolved",
      outcome: handBack ? "handed_back" : outcome,
      resolutionNote: resolutionNote ?? null, resolvedAt: nowIso(), updatedAt: nowIso(),
    });
    state.resolves.push({ issueId: issue.id, body: clone(body) });
    if (handBack) wake(issue.assigneeAgentId, issue.id, "issue_recovery_action_restored");
    dropAttention((i) => i.sourceKind === "recovery_action" && i.subject?.id === active.id);
    return { issue: { ...clone(issue), activeRecoveryAction: null }, recoveryAction: clone(active) };
  });
  route("POST", "/api/issues/:id/stalled-review-decision", ({ params, body, actor }) => {
    needOwner(actor); needBody(body);
    const issue = issueById(params.id);
    const map = { approve: "done", request_changes: "in_progress", send_back: "todo" };
    if (!map[body.action]) throw new HttpError(400, "action must be approve, request_changes or send_back");
    issue.status = map[body.action]; issue.updatedAt = nowIso();
    if (body.note) addComment(issue, body.note, actor);
    dropAttention((i) => i.sourceKind === "review" && i.relatedIssue?.id === issue.id);
    return clone(issue);
  });
  // ---- issue-thread interactions, as routes/issues.js and services/issue-thread-interactions.js take them.
  // `state.threadInteractions` holds the records (GET /api/issues/:id/interactions); `state.interactions` logs
  // every resolution the owner made. A seed without records gets one per attention item of this kind, with the
  // kind from its metadata, else from the verbs it offers (respond -> ask_user_questions, else request_confirmation).
  state.threadInteractions ||= [];
  for (const a of state.attention) {
    if (a?.sourceKind !== "issue_thread_interaction") continue;
    const iid = a.subject?.metadata?.interactionId || a.subject?.id;
    const issueId = a.subject?.metadata?.issueId || a.relatedIssue?.id;
    if (!iid || !issueId || state.threadInteractions.some((r) => r.id === iid)) continue;
    const verbs = (a.decisionVerbs || []).map((v) => v?.id);
    const kind = a.subject?.metadata?.kind || (verbs.includes("respond") ? "ask_user_questions" : "request_confirmation");
    state.threadInteractions.push({
      id: iid, companyId: a.companyId, issueId, kind, status: "pending", title: a.subject?.title ?? null,
      payload: kind === "ask_user_questions"
        ? { version: 1, questions: [{ id: "answer", prompt: a.subject?.title || "A question", selectionMode: "single", required: true, allowOther: true, options: [{ id: "paperclip_text_answer", label: "Type an answer", freeText: true }] }],
          questionSet: { schema: "paperclip.question_set.v1", questions: [{ id: "answer", prompt: a.subject?.title || "A question", required: true, answerMode: "text" }] } }
        : { version: 1, prompt: a.subject?.title || "Confirm" },
      result: null, createdAt: a.createdAt || nowIso(), updatedAt: a.updatedAt || nowIso(),
    });
  }
  const ACCEPTS = ["request_confirmation", "request_checkbox_confirmation", "suggest_tasks"];
  const REJECTS = ["request_confirmation", "request_checkbox_confirmation", "suggest_tasks"];
  const isStr = (v) => typeof v === "string";
  // respondIssueThreadInteractionSchema, normalizeQuestionAnswers and parsePaperclipQuestionResponse, as far as
  // the home screen can meet them. Throws 400 for a body the schema refuses, 422 for answers the board refuses.
  const checkAnswers = (record, body) => {
    if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray(body.answers) || body.answers.length > 20) throw new HttpError(400, "Validation error");
    if (body.summaryMarkdown !== undefined && body.summaryMarkdown !== null && !isStr(body.summaryMarkdown)) throw new HttpError(400, "Validation error");
    for (const a of body.answers) {
      if (!a || typeof a !== "object" || !isStr(a.questionId) || !a.questionId.trim() || !Array.isArray(a.optionIds) || !a.optionIds.every(isStr)) throw new HttpError(400, "Validation error");
      if (a.otherText !== undefined && a.otherText !== null && !isStr(a.otherText)) throw new HttpError(400, "Validation error");
    }
    const questions = record.payload?.questions || [];
    const byId = new Map(questions.map((q) => [q.id, q]));
    const seen = new Map();
    for (const a of body.answers) {
      const q = byId.get(a.questionId);
      if (!q) throw new HttpError(422, `Unknown questionId: ${a.questionId}`);
      if (seen.has(a.questionId)) throw new HttpError(422, `Duplicate answer for questionId: ${a.questionId}`);
      const ids = [...new Set(a.optionIds)];
      for (const o of ids) if (!q.options.some((x) => x.id === o)) throw new HttpError(422, `Unknown optionId for question ${a.questionId}: ${o}`);
      if (q.selectionMode === "single" && ids.length > 1) throw new HttpError(422, `Question ${a.questionId} only allows one answer`);
      seen.set(a.questionId, { optionIds: ids, otherText: String(a.otherText ?? "").trim() });
    }
    for (const q of questions) {
      const a = seen.get(q.id);
      if (q.required && (!a || (!a.optionIds.length && !a.otherText))) throw new HttpError(422, `Question ${q.id} requires an answer`);
    }
    for (const c of record.payload?.questionSet?.questions || []) {
      const a = seen.get(c.id);
      const storage = byId.get(c.id);
      const freeIds = new Set((storage?.options || []).filter((o) => o.freeText).map((o) => o.id));
      if (!a) { if (c.required) throw new HttpError(422, `/response/answers/${c.id}: is required`); continue; }
      if (c.answerMode === "text") {
        if (a.optionIds.some((o) => !freeIds.has(o))) throw new HttpError(422, `/response/answers/${c.id}/selectedOptionIds: contains unknown option`);
        if (c.required && !a.otherText) throw new HttpError(422, `/response/answers/${c.id}: is required`);
      } else {
        const chosen = a.optionIds.filter((o) => !freeIds.has(o));
        const custom = c.customAnswer?.enabled === true || storage?.allowOther === true || freeIds.size > 0;
        if (a.otherText && !custom) throw new HttpError(422, `/response/answers/${c.id}/customText: custom answers are not enabled for this question`);
        if (c.answerMode === "single_select" && a.otherText && chosen.length) throw new HttpError(422, `/response/answers/${c.id}: single-select answers cannot select an option and a custom answer`);
        if (c.required && !chosen.length && !a.otherText) throw new HttpError(422, `/response/answers/${c.id}: is required`);
      }
    }
    return questions.map((q) => seen.get(q.id) && { questionId: q.id, ...seen.get(q.id) }).filter(Boolean);
  };
  route("GET", "/api/issues/:id/interactions", ({ params }) => {
    const issue = issueById(params.id);
    return state.threadInteractions.filter((r) => r.issueId === issue.id).map(clone);
  });
  route("POST", "/api/issues/:id/interactions/:iid/:verb", ({ params, body, actor }) => {
    needOwner(actor);
    const issue = issueById(params.id);
    if (!["accept", "reject", "respond"].includes(params.verb)) throw new HttpError(404, "Not found");
    const record = state.threadInteractions.find((r) => r.id === params.iid && r.issueId === issue.id);
    if (!record) throw new HttpError(404, "Interaction not found");
    let result = null;
    if (params.verb === "respond") {
      if (record.kind !== "ask_user_questions") throw new HttpError(422, "Only ask_user_questions interactions can be answered");
      if (record.status !== "pending") throw new HttpError(409, "Interaction has already been resolved");
      result = { version: 1, answers: checkAnswers(record, body), summaryMarkdown: body.summaryMarkdown ?? null };
    } else {
      if (body !== null && (typeof body !== "object" || Array.isArray(body))) throw new HttpError(400, "Validation error");
      if (["done", "cancelled"].includes(issue.status)) throw new HttpError(409, "Interaction is no longer actionable because the issue is closed");
      if (record.status !== "pending") throw new HttpError(409, "Interaction has already been resolved");
      if (params.verb === "accept" && !ACCEPTS.includes(record.kind)) throw new HttpError(422, `Interactions of kind ${record.kind} cannot be accepted`);
      if (params.verb === "reject" && !REJECTS.includes(record.kind)) throw new HttpError(422, `Interactions of kind ${record.kind} cannot be rejected`);
    }
    record.status = { accept: "accepted", reject: "rejected", respond: "answered" }[params.verb];
    record.result = result;
    record.updatedAt = nowIso();
    state.interactions.push({ issueId: issue.id, interactionId: params.iid, action: params.verb, body: clone(body) ?? null });
    dropAttention((i) => i.subject?.metadata?.interactionId === params.iid || i.subject?.id === params.iid);
    return clone(record);
  });

  // ---- routines (version 2). Shapes as paperclip 2026.1106.0 gives them (CONTRACTS-V2 17.6); writes are owner only.
  const ROUTINE_STATUSES = ["active", "paused", "archived"];
  const routineById = (id) => {
    const r = state.routines.find((x) => x.id === id);
    if (!r) throw new HttpError(404, "Routine not found");
    return r;
  };
  const withIssue = (run) => {
    const out = clone(run);
    const i = state.issues.find((x) => x.id === run.linkedIssueId);
    out.linkedIssue = i ? { id: i.id, identifier: i.identifier, title: i.title, status: i.status } : null;
    return out;
  };
  const runsOf = (r) => state.routineRuns.filter((x) => x.routineId === r.id)
    .sort((a, b) => (a.triggeredAt < b.triggeredAt ? 1 : a.triggeredAt > b.triggeredAt ? -1 : 0));
  const publicRoutine = (r) => {
    const out = clone(r);
    out.triggers = state.routineTriggers.filter((t) => t.routineId === r.id).map(clone);
    const last = runsOf(r)[0];
    out.lastRun = last ? withIssue(last) : null;
    return out;
  };
  route("GET", "/api/companies/:id/routines", ({ params }) => {
    company(params.id);
    return state.routines.filter((r) => r.companyId === params.id).map(publicRoutine);
  });
  route("POST", "/api/companies/:id/routines", ({ params, body, actor }) => {
    needOwner(actor); company(params.id); needBody(body);
    if (!body.title) throw new HttpError(400, "title is required");
    const status = body.status ?? "active";
    if (!ROUTINE_STATUSES.includes(status)) throw new HttpError(400, "Validation error");
    const t = nowIso();
    const r = {
      id: randomUUID(), companyId: params.id, title: body.title, description: body.description ?? null,
      assigneeAgentId: body.assigneeAgentId ?? null, projectId: body.projectId ?? null, priority: body.priority ?? "medium",
      status, concurrencyPolicy: body.concurrencyPolicy ?? "coalesce_if_active", catchUpPolicy: body.catchUpPolicy ?? "skip_missed",
      createdAt: t, updatedAt: t,
    };
    state.routines.push(r);
    return [201, publicRoutine(r)];
  });
  route("GET", "/api/routines/:id", ({ params }) => {
    const r = routineById(params.id);
    return { ...publicRoutine(r), recentRuns: runsOf(r).slice(0, 20).map(withIssue) };
  });
  route("PATCH", "/api/routines/:id", ({ params, body, actor }) => {
    needOwner(actor); needBody(body);
    const r = routineById(params.id);
    if ("status" in body && !ROUTINE_STATUSES.includes(body.status)) throw new HttpError(400, "Validation error");
    for (const k of ["title", "description", "assigneeAgentId", "projectId", "priority", "status", "concurrencyPolicy", "catchUpPolicy"]) if (k in body) r[k] = body[k];
    r.updatedAt = nowIso();
    return publicRoutine(r);
  });
  route("POST", "/api/routines/:id/triggers", ({ params, body, actor }) => {
    needOwner(actor); needBody(body);
    const r = routineById(params.id);
    if (body.kind !== "schedule" || typeof body.cronExpression !== "string" || !body.cronExpression) throw new HttpError(400, "Validation error");
    const trigger = {
      id: randomUUID(), routineId: r.id, kind: "schedule", label: body.label ?? null, enabled: body.enabled !== false,
      cronExpression: body.cronExpression, timezone: body.timezone ?? "UTC", nextRunAt: null, lastFiredAt: null,
    };
    state.routineTriggers.push(trigger);
    return [201, clone(trigger)];
  });
  route("PATCH", "/api/routine-triggers/:id", ({ params, body, actor }) => {
    needOwner(actor); needBody(body);
    const t = state.routineTriggers.find((x) => x.id === params.id);
    if (!t) throw new HttpError(404, "Trigger not found");
    for (const k of ["label", "enabled", "cronExpression", "timezone"]) if (k in body) t[k] = body[k];
    return clone(t);
  });
  route("GET", "/api/routines/:id/runs", ({ params, query }) => {
    const r = routineById(params.id);
    let list = runsOf(r);
    const limit = Number(query.limit);
    if (limit > 0) list = list.slice(0, limit);
    return list.map(withIssue);
  });
  // An archived routine refuses (409); any other starts one task now, a run linked to it, and a wake.
  route("POST", "/api/routines/:id/run", ({ params, actor }) => {
    needOwner(actor);
    const r = routineById(params.id);
    if (r.status === "archived") throw new HttpError(409, "Routine is archived");
    const issue = makeIssue(company(r.companyId), {
      title: r.title, description: r.description, assigneeAgentId: r.assigneeAgentId, projectId: r.projectId,
      priority: r.priority, originKind: "routine_execution", originId: r.id,
    }, actor);
    const t = nowIso();
    const run = {
      id: randomUUID(), routineId: r.id, source: "manual", status: "issue_created", triggeredAt: t, completedAt: null,
      failureReason: null, linkedIssueId: issue.id,
    };
    state.routineRuns.push(run);
    return [201, withIssue(run)];
  });

  // ---- attention, approvals, runs, badges
  route("GET", "/api/companies/:id/attention", ({ params, actor }) => {
    needOwner(actor); company(params.id);
    const items = state.attention.map(clone);
    const counts = {};
    for (const k of ["approval", "decision", "issue_thread_interaction", "join_request", "recovery_action", "productivity_review", "blocker_attention", "review", "failed_run", "budget_alert", "agent_error_alert"]) counts[k] = 0;
    for (const i of items) counts[i.sourceKind] = (counts[i.sourceKind] || 0) + 1;
    return { companyId: params.id, generatedAt: nowIso(), totalCount: items.length, deskBadgeCount: items.length, nextCursor: null, countsBySourceKind: counts, items };
  });
  route("GET", "/api/companies/:id/approvals", ({ params, query }) => {
    company(params.id);
    let list = state.approvals.filter((a) => a.companyId === params.id);
    if (query.status) list = list.filter((a) => a.status === query.status);
    return list.map(clone);
  });
  route("POST", "/api/companies/:id/approvals", ({ params, body, actor }) => {
    company(params.id); needBody(body);
    const a = {
      id: randomUUID(), companyId: params.id, type: body.type ?? "request", status: "pending",
      requestedByAgentId: actor.kind === "agent" ? actor.agentId : null, payload: clone(body.payload) ?? {},
      decisionNote: null, createdAt: nowIso(), updatedAt: nowIso(),
    };
    state.approvals.push(a);
    return [201, clone(a)];
  });
  const decide = (verb, status) => route("POST", `/api/approvals/:id/${verb}`, ({ params, body, actor }) => {
    needOwner(actor);
    const a = state.approvals.find((x) => x.id === params.id);
    if (!a) throw new HttpError(404, "Approval not found");
    if (a.status !== "pending") throw new HttpError(409, "Approval was already decided");
    a.status = status; a.decisionNote = body?.decisionNote ?? null; a.decidedAt = nowIso(); a.updatedAt = nowIso();
    dropAttention((i) => i.sourceKind === "approval" && i.subject?.id === a.id);
    return clone(a);
  });
  decide("approve", "approved"); decide("reject", "rejected"); decide("request-revision", "revision_requested");
  route("GET", "/api/companies/:id/live-runs", ({ params }) => { company(params.id); return state.liveRuns.map(clone); });
  route("GET", "/api/companies/:id/heartbeat-runs", ({ params, query }) => {
    company(params.id);
    let list = state.heartbeatRuns;
    if (query.agentId) list = list.filter((r) => r.agentId === query.agentId);
    const limit = Number(query.limit);
    if (limit > 0) list = list.slice(0, limit);
    return list.map(clone);
  });
  route("GET", "/api/companies/:id/sidebar-badges", ({ params }) => {
    company(params.id);
    return {
      inbox: state.attention.length,
      approvals: state.approvals.filter((a) => a.status === "pending").length,
      failedRuns: state.attention.filter((i) => i.sourceKind === "failed_run").length,
      joinRequests: 0,
    };
  });

  // ---- server
  async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks).toString("utf8");
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://stub");
    const query = Object.fromEntries(url.searchParams);
    const raw = await readBody(req);
    let body = null;
    if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
    const record = { method: req.method, path: url.pathname, query, headers: { ...req.headers }, body };
    requests.push(record);
    const send = (status, payload) => {
      const text = JSON.stringify(payload);
      res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
      res.end(text);
    };
    try {
      // who is asking
      let actor = { kind: "owner" };
      const auth = req.headers.authorization;
      if (auth !== undefined) {
        const m = /^Bearer +(\S+)$/i.exec(auth);
        const agentId = m && Object.hasOwn(state.tokens, m[1]) ? state.tokens[m[1]] : null;
        if (!agentId) return send(401, { error: "Unauthorized" });
        actor = { kind: "agent", agentId };
      }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const params = {};
        r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
        if (typeof body === "string" && req.method !== "GET") throw new HttpError(400, "Invalid JSON");
        let out = await r.handler({ params, query, body, actor });
        let status = 200;
        if (Array.isArray(out) && out.length === 2 && typeof out[0] === "number") [status, out] = out;
        return send(status, out);
      }
      return send(404, { error: "Not found" });
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      return send(500, { error: "Stub failure: " + e.message });
    }
  });

  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const actualPort = server.address().port;
  return {
    url: `http://127.0.0.1:${actualPort}`, port: actualPort, state, requests,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
