// Stub of paperclip's board (port 3100) for tests. In memory, built-in modules only.
// Shapes follow the real board 2026.1106.0 as read from the running instance.
import http from "node:http";
import { randomUUID, randomBytes } from "node:crypto";

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

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const nowIso = () => new Date().toISOString();
const clone = (v) => (v === undefined ? v : structuredClone(v));

function emptyState() {
  return {
    companies: [], agents: [], projects: [], issues: [], comments: [], approvals: [], attention: [],
    liveRuns: [], tokens: {}, instructions: {}, memberGrants: {},
    wakes: [], interactions: [], keys: [], heartbeatRuns: [],
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

export async function startStubBoard({ port = 0, seed } = {}) {
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
      adapterType: body.adapterType ?? "claude_local", adapterConfig: clone(body.adapterConfig) ?? {},
      runtimeConfig: clone(body.runtimeConfig) ?? {}, permissions, pauseReason: null, pausedAt: null,
      lastHeartbeatAt: null, metadata: clone(body.metadata) ?? null,
      urlKey: String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      createdAt: t, updatedAt: t, membershipId: randomUUID(),
    };
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
    for (const k of ["name", "role", "title", "reportsTo", "capabilities", "metadata", "adapterType"]) if (k in body) a[k] = clone(body[k]);
    if (body.adapterConfig) a.adapterConfig = { ...a.adapterConfig, ...clone(body.adapterConfig) };
    if (body.runtimeConfig) a.runtimeConfig = { ...a.runtimeConfig, ...clone(body.runtimeConfig) };
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
  route("POST", "/api/issues/:id/interactions/:iid/:verb", ({ params, body, actor }) => {
    needOwner(actor);
    const issue = issueById(params.id);
    if (!["accept", "reject", "respond"].includes(params.verb)) throw new HttpError(404, "Not found");
    state.interactions.push({ issueId: issue.id, interactionId: params.iid, action: params.verb, body: clone(body) ?? null });
    dropAttention((i) => i.subject?.metadata?.interactionId === params.iid || i.subject?.id === params.iid);
    return { ok: true, interactionId: params.iid, action: params.verb };
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
