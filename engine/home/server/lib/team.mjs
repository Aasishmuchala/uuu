// The roles (CONTRACTS-V2 16.4): the company file read through loadCompanyFile, the six departments,
// the agent cards of the Team page and the shell, and the plain profile of what each agent may do.
// Shared by routes/shell.mjs and the Team, Home and Studio features. Nothing here writes a file.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadCompanyFile } from "../../../company/lib/company-file.mjs";
import { isGoal, rootOf } from "./goals.mjs";

export const DEPARTMENTS = [
  { id: "books", title: "Books", agents: ["bookkeeper"] },
  { id: "customers", title: "Customers", agents: ["sales"] },
  { id: "support", title: "Support", agents: ["support"] },
  { id: "people", title: "People", agents: ["people"] },
  { id: "marketing", title: "Marketing", agents: ["marketer"] },
  { id: "studio", title: "Studio", agents: ["drafter", "artist"] },
];
// The departments whose records live in the books (the bench); the other two need nothing switched on.
export const BENCH_DEPARTMENTS = new Set(["books", "customers", "support", "people"]);
const BENCH_ROLES = new Set(["bookkeeper", "sales", "support", "people"]);

// Agent states as in CONTRACTS 9.5.
export const AGENT_PLAIN = { free: "Free", working: "Working", paused: "Paused", problem: "Has a problem", waiting_for_you: "Waiting for your approval" };

export function agentState(agent, live) {
  if (agent.status === "pending_approval") return "waiting_for_you";
  if (agent.status === "error") return "problem";
  if (agent.status === "paused") return "paused";
  if (live || agent.status === "running") return "working";
  return "free";
}

const TOOL_LABELS = {
  "chief-of-staff": "Planning and handing out work", builder: "Documents and files", checker: "Reading and checking",
  bookkeeper: "The books (drafts only)", sales: "The customer records", support: "The support desk",
  people: "The staff records", marketer: "The content calendar", drafter: "CAD tools", artist: "Drawing tools",
};

function defaultLog(line) {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
}

function companyDir(config) {
  return join(config.engineDir, "company");
}

// The modified times of every file that goes into the roles: company.json, the role files, the shared texts.
function filesKey(config) {
  const dir = companyDir(config);
  const parts = [config.paths.state];
  const stamp = (f) => { try { const s = statSync(f); parts.push(`${f}:${s.mtimeMs}:${s.size}`); } catch { parts.push(`${f}:-`); } };
  stamp(join(dir, "company.json"));
  for (const sub of ["roles", "shared"]) {
    let names = [];
    try { names = readdirSync(join(dir, sub)).sort(); } catch { names = []; }
    for (const n of names) stamp(join(dir, sub, n));
  }
  return parts.join("|");
}

let cache = { key: null, roles: [], logged: null };

// loadRoles(config) -> [Role] in company-file order. A company file that cannot be read gives [] and one logged line.
export function loadRoles(config, { log = defaultLog } = {}) {
  const key = filesKey(config);
  if (cache.key === key) return cache.roles;
  let roles = [];
  try {
    const file = loadCompanyFile(join(companyDir(config), "company.json"), config);
    roles = file.agents.map((a) => ({
      slug: a.slug, name: a.name, title: a.title, summary: a.capabilities,
      department: a.department ?? null, reportsTo: a.reportsTo, toolId: a.tool, model: a.model,
      limits: a.limits, rights: a.rights, policy: a.policy, instructions: a.instructions,
    }));
  } catch (e) {
    if (cache.logged !== key) log(`the company file could not be read: ${String(e?.message || e).split("\n")[0].slice(0, 300)}`);
    cache = { key, roles: [], logged: key };
    return [];
  }
  cache = { key, roles, logged: null };
  return roles;
}

export function roleOf(roles, slug) {
  return roles.find((r) => r.slug === slug) || null;
}

function whoOf(roles, slug) {
  const r = slug ? roleOf(roles, slug) : null;
  return r ? { slug: r.slug, name: r.name } : null;
}

// The board agent of a role: by ids.json, else by name.
function boardAgentOf(role, tctx) {
  const list = tctx?.agentList || [];
  const id = tctx?.ids?.agents?.[role.slug];
  return (id && list.find((a) => a.id === id)) || list.find((a) => a.name === role.name) || null;
}

// agentCards(ctx, tctx) -> [AgentCard]. With tctx null (the board is off) the cards come from the file alone, and
// `applied` is null: not known, since only the board can say whether an agent is set up.
export function agentCards(ctx, tctx) {
  const roles = loadRoles(ctx.config, { log: ctx.log });
  return roles.map((role) => {
    const agent = tctx ? boardAgentOf(role, tctx) : null;
    const base = {
      id: agent?.id || null, slug: role.slug, name: role.name, title: role.title, summary: role.summary,
      department: role.department, reportsTo: whoOf(roles, role.reportsTo),
    };
    if (!agent) {
      return {
        ...base, state: "free", plainState: tctx ? "Not set up yet" : "Not known", doingNow: null,
        waitingForYou: false, lastActiveAt: null, applied: tctx ? false : null,
      };
    }
    const live = tctx.liveByAgent.get(agent.id) || null;
    const state = agentState(agent, live);
    let doingNow = null;
    if (live?.issueId) {
      const issue = tctx.issues.find((i) => i.id === live.issueId);
      const root = issue ? rootOf(tctx.issues, issue.id) : null;
      doingNow = { title: issue?.title || "A task", taskId: root && isGoal(root, tctx.ids) ? root.id : null };
    }
    const waitingForYou = (tctx.needsYou || []).some((i) => i.agent?.slug === role.slug);
    return {
      ...base, state, plainState: AGENT_PLAIN[state], doingNow, waitingForYou,
      lastActiveAt: agent.lastHeartbeatAt || null, applied: true,
    };
  });
}

// The books' port: the bench's web port, and the ports a fence policy may name (only the books today).
function listsBooksPort(policy, config) {
  const ports = new Set([config.ports?.benchWeb, ...(config.fence?.policyPortsAllowed || [])].filter(Boolean).map(Number));
  return (policy?.localServices || []).some((s) => {
    const m = /^127\.0\.0\.1:(\d{1,5})$/.exec(String(s));
    return m && ports.has(Number(m[1]));
  });
}

function toolInstalled(slug, config) {
  if (BENCH_ROLES.has(slug)) return existsSync(join(config.paths.books, "bench"));
  if (slug === "drafter") return existsSync(config.paths.cadPython);
  if (slug === "artist") return existsSync(join(config.paths.state, "art", "venv", "bin", "python"));
  return true;
}

// profileOf(role, config): what the agent may and may not do, in the owner's words.
export function profileOf(role, config) {
  const books = listsBooksPort(role.policy, config);
  const may = [
    "Works inside its task folder and nowhere else on this Mac.",
    "Reads the company's documents and its own lessons before it starts.",
  ];
  if (role.rights?.canAssignTasks) may.push("Hands tasks to the other agents.");
  if (books) may.push("Prepares drafts in the books. Nothing is final until you approve it.");
  if (role.policy?.taskFolder === "read-only") may.push("Reads the work it checks. It cannot change it.");
  if (role.slug === "drafter") may.push("Makes CAD parts with its own tools.");
  if (role.slug === "artist") may.push("Draws sprites, animations and simple images with its own tools.");
  const mayNot = [
    "Cannot send anything outside the company.",
    "Cannot read your own files.",
    "Cannot create or change agents.",
  ];
  if (books) mayNot.push("Cannot make a draft final, cancel it or delete it.");
  const limits = role.limits || {};
  return {
    tool: { label: TOOL_LABELS[role.slug] || "Its own tools", installed: toolInstalled(role.slug, config) },
    may,
    mayNot,
    limits: { runMinutes: limits.runMinutes ?? null, maxTurns: limits.maxTurns ?? null, oneAtATime: limits.maxConcurrentRuns === 1 },
  };
}
