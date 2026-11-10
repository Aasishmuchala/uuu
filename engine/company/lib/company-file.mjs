// Reads engine/company/company.json (CONTRACTS section 5), checks it, and works out what
// every agent should look like on the board and in its fence policy (section 4).
// Nothing here touches the board or writes a file.
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

export class FileProblem extends Error {}

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RIGHT_KEYS = ["canAssignTasks", "canCreateAgents", "canCreateSkills"];
// Grants no agent in this engine may hold: they let an agent change agents, skills,
// tools, people or settings. The company file is refused if it asks for one.
const FORBIDDEN_GRANT = /^(agents:|skills:|tools:manage|tools:admin|users:|joins:|environments:)/;
const TOOLS = {
  claude: { adapterType: "claude_local", command: "claude" },
  codex: { adapterType: "codex_local", command: "codex" },
};

function problem(what) {
  throw new FileProblem(`The company file is not usable: ${what}.`);
}

const inside = (child, parent) => child === parent || child.startsWith(parent + sep);

function fill(value, state, slug) {
  if (typeof value === "string") return value.split("{state}").join(state).split("{slug}").join(slug);
  if (Array.isArray(value)) return value.map((v) => fill(v, state, slug));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, state, slug)]));
  }
  return value;
}

// Section 4 rules, checked before anything is written, so a bad policy never reaches the fence.
function checkPolicy(slug, p, state, fence) {
  const bad = (what) => problem(`the fence policy for agent ${slug} ${what}`);
  if (!Array.isArray(p.localServices)) bad("needs localServices as a list");
  for (const s of p.localServices) {
    const m = typeof s === "string" ? /^127\.0\.0\.1:(\d{1,5})$/.exec(s) : null;
    if (!m) bad(`names a local service that is not 127.0.0.1:<port> (${s})`);
    if (!fence.policyPortsAllowed.includes(Number(m[1]))) bad(`names port ${m[1]}, which agents may not reach`);
  }
  if (!Array.isArray(p.readFolders)) bad("needs readFolders as a list");
  const roots = fence.readRootsAllowed.map((r) => join(state, r));
  for (const f of p.readFolders) {
    if (typeof f !== "string" || !isAbsolute(f) || resolve(f) !== f) bad(`has a read folder that is not a plain full path (${f})`);
    if (!roots.some((r) => inside(f, r))) bad(`has a read folder outside the allowed folders (${f})`);
  }
  if (p.lessonsFile !== null) {
    const f = p.lessonsFile;
    if (typeof f !== "string" || !isAbsolute(f) || resolve(f) !== f || dirname(f) !== join(state, "lessons")) {
      bad("has a lessons file that is not directly inside the lessons folder");
    }
  }
  if (p.envFile !== null) {
    const f = p.envFile;
    if (typeof f !== "string" || !isAbsolute(f) || resolve(f) !== f || dirname(f) !== join(state, "secrets", "agents")) {
      bad("has a key file that is not directly inside secrets/agents");
    }
  }
  if (!["read-write", "read-only"].includes(p.taskFolder)) bad('needs taskFolder "read-write" or "read-only"');
}

export function loadCompanyFile(file, config) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    problem(e.code === "ENOENT" ? `${file} does not exist` : `${file} is not valid JSON`);
  }
  const state = config.paths.state;
  const baseDir = realpathSync(dirname(file));
  const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

  if (!obj(doc.company) || typeof doc.company.name !== "string" || !doc.company.name) problem("company.name is missing");
  if (typeof doc.company.requireOwnerApprovalForNewAgents !== "boolean") problem("company.requireOwnerApprovalForNewAgents must be true or false");
  if (!obj(doc.project) || typeof doc.project.name !== "string" || typeof doc.project.folder !== "string") problem("project needs a name and a folder");
  const projectFolder = fill(doc.project.folder, state, "");
  if (!isAbsolute(projectFolder) || resolve(projectFolder) !== projectFolder || !inside(projectFolder, config.paths.tasks) || projectFolder === config.paths.tasks) {
    problem("the project folder must be a folder inside the engine's task folders");
  }
  const d = doc.defaults;
  if (!obj(d) || !obj(d.limits) || !obj(d.rights) || !Array.isArray(d.grants) || !obj(d.fencePolicy)) problem("defaults need limits, rights, grants and fencePolicy");
  if (!Array.isArray(doc.agents) || doc.agents.length === 0) problem("there are no agents");

  const seen = new Set();
  const names = new Set();
  const agents = [];
  for (const a of doc.agents) {
    if (!obj(a) || typeof a.slug !== "string" || !SLUG.test(a.slug)) problem(`an agent has a bad slug (${a && a.slug})`);
    const slug = a.slug;
    if (seen.has(slug)) problem(`the slug ${slug} is used twice`);
    for (const k of ["name", "role", "paperclipRole", "title", "capabilities", "instructions"]) {
      if (typeof a[k] !== "string" || !a[k]) problem(`agent ${slug} needs ${k}`);
    }
    if (names.has(a.name)) problem(`the name ${a.name} is used twice`);
    const tool = TOOLS[a.tool];
    if (!tool) problem(`agent ${slug} has tool ${a.tool}; use claude or codex`);
    if (a.model !== null && (typeof a.model !== "string" || !/^[a-z0-9.-]+$/.test(a.model))) problem(`agent ${slug} has a bad model`);
    if (a.reportsTo !== null && !seen.has(a.reportsTo)) problem(`agent ${slug} reports to ${a.reportsTo}, which is not listed before it`);

    const limits = { ...d.limits, ...(a.limits || {}) };
    for (const k of ["maxConcurrentRuns", "runMinutes", "maxTurns"]) {
      if (!Number.isInteger(limits[k]) || limits[k] < 1) problem(`agent ${slug} needs a whole number for ${k}`);
    }
    const rights = { ...d.rights, ...(a.rights || {}) };
    for (const k of RIGHT_KEYS) if (typeof rights[k] !== "boolean") problem(`agent ${slug} needs true or false for ${k}`);
    if (rights.canCreateAgents || rights.canCreateSkills) problem(`agent ${slug} may not create agents or skills`);
    const grants = a.grants || d.grants;
    if (!Array.isArray(grants) || grants.some((g) => typeof g !== "string" || !g)) problem(`agent ${slug} has a bad grants list`);
    for (const g of grants) if (FORBIDDEN_GRANT.test(g)) problem(`agent ${slug} asks for the grant ${g}, which no agent may hold`);
    if (grants.includes("tasks:assign") !== rights.canAssignTasks) problem(`agent ${slug}: the grant tasks:assign must match canAssignTasks`);

    const policy = fill({ ...d.fencePolicy, ...(a.fencePolicy || {}) }, state, slug);
    for (const k of ["localServices", "readFolders", "lessonsFile", "envFile", "taskFolder"]) {
      if (!(k in policy)) problem(`the fence policy for agent ${slug} needs ${k}`);
    }
    checkPolicy(slug, policy, state, config.fence);

    const instrPath = resolve(baseDir, a.instructions);
    if (!inside(instrPath, baseDir)) problem(`the instructions of agent ${slug} are outside the company folder`);
    let instructions;
    try {
      instructions = readFileSync(instrPath, "utf8");
    } catch {
      problem(`the instructions file ${a.instructions} of agent ${slug} cannot be read`);
    }

    seen.add(slug);
    names.add(a.name);
    agents.push({
      slug, name: a.name, role: a.paperclipRole, title: a.title, capabilities: a.capabilities,
      tool: a.tool, adapterType: tool.adapterType, command: tool.command, model: a.model,
      reportsTo: a.reportsTo, limits, rights: Object.fromEntries(RIGHT_KEYS.map((k) => [k, rights[k]])),
      grants: [...new Set(grants)], policy, instructionsTemplate: instructions,
      cwd: join(config.paths.agentFolders, slug),
    });
  }

  const team = agents.map((a) => `- ${a.name}: ${a.capabilities}`).join("\n");
  for (const a of agents) {
    a.instructions = a.instructionsTemplate.split("{{TEAM}}").join(team);
    delete a.instructionsTemplate;
  }
  return {
    company: { name: doc.company.name, requireApproval: doc.company.requireOwnerApprovalForNewAgents },
    project: { name: doc.project.name, folder: projectFolder },
    agents,
  };
}

// The adapter settings apply owns, from the trial: runner legacy (sent on create), engine cli,
// command claude or codex, the model alias, the run limit and the agent's default folder.
export function desiredAdapterConfig(a) {
  const c = { cwd: a.cwd, engine: "cli", command: a.command, timeoutSec: a.limits.runMinutes * 60 };
  if (a.model) c.model = a.model;
  if (a.tool === "claude") c.maxTurnsPerRun = a.limits.maxTurns;
  return c;
}
