// The seven departments around the map (CONTRACTS-V3 31.1, 33.2): engine/company/departments.json read
// through loadDepartmentFile, cached until the file or the company file changes. Read-only.
// Shared by routes/map.mjs, lib/tasks.mjs and the shell, jobs and dashboard features; they never edit it.
import { statSync } from "node:fs";
import { join } from "node:path";
import { loadDepartmentFile } from "../../../company/lib/department-file.mjs";
import { descendants } from "./goals.mjs";
import { loadRoles } from "./team.mjs";

// The table of 31.1 (ids, agents, dashboards), used by departmentOf until the file has been read once.
const PINNED = [
  { id: "operations", agents: ["chief-of-staff", "builder", "checker"], dashboard: null },
  { id: "sales", agents: ["sales"], dashboard: "customers" },
  { id: "marketing", agents: ["marketer"], dashboard: "marketing" },
  { id: "studio", agents: ["drafter", "artist"], dashboard: "studio" },
  { id: "support", agents: ["support"], dashboard: "support" },
  { id: "people", agents: ["people"], dashboard: "people" },
  { id: "books", agents: ["bookkeeper"], dashboard: "books" },
];

let cache = { key: null, roles: null, value: null };
let current = PINNED;

const fileOf = (config) => join(config.engineDir, "company", "departments.json");

function stamp(file) {
  try { const s = statSync(file); return `${s.mtimeMs}:${s.size}`; } catch { return "-"; }
}

// loadDepartments(config) -> { departments, problems }. Never throws: a file that cannot be read is one problem.
export function loadDepartments(config) {
  const roles = loadRoles(config, { log: () => {} });
  const file = fileOf(config);
  const key = `${file}|${stamp(file)}`;
  if (cache.key === key && cache.roles === roles) return cache.value;
  let value;
  try {
    value = loadDepartmentFile(file, roles);
  } catch {
    value = { departments: [], problems: [{ file: "departments.json", problem: "It could not be read." }] };
  }
  cache = { key, roles, value };
  if (value.departments.length) current = value.departments;
  return value;
}

// departmentOf(slugOrSource) -> id | null: the department of an agent's slug, of a Needs-you source (a
// dashboard id, such as `customers` for Sales), or a department's own id.
export function departmentOf(slugOrSource) {
  if (typeof slugOrSource !== "string" || !slugOrSource) return null;
  const s = slugOrSource;
  return (current.find((d) => d.agents.includes(s)) || current.find((d) => d.dashboard === s) || current.find((d) => d.id === s))?.id || null;
}

// What a department is doing, counted as the shell's dock counts it (26.4): `working` is the number of its
// agents with a live run; `needsYou` the Needs-you items that belong to it. An item the task model decorated
// carries its `department` (lib/tasks.mjs decorateInbox: a task's item counts for the task's department, not
// for the Chief of staff who raised it); an item without that key counts by its agent or its dashboard. An
// answer to a question to the company brain counts on the brain, not on a department (26.4), as on the dock.
// tctx: the task model (lib/tasks.mjs), or null when the board is off (then both are 0).
export function departmentLoad(dept, tctx) {
  if (!tctx) return { working: 0, needsYou: 0 };
  const ids = new Set(dept.agents.map((slug) => tctx.ids?.agents?.[slug]).filter(Boolean));
  for (const a of tctx.agentList || []) {
    const slug = tctx.agents?.get(a.id)?.slug;
    if (slug && dept.agents.includes(slug)) ids.add(a.id);
  }
  let working = 0;
  for (const id of ids) if (tctx.liveByAgent?.has(id)) working += 1;
  const isAsk = (i) => !!(i.taskId && tctx.decisions?.get?.(`ask:${i.taskId}`));
  const needsYou = (tctx.needsYou || []).filter((i) => !isAsk(i) && (Object.hasOwn(i, "department") ? i.department === dept.id
    : (i.agent && dept.agents.includes(i.agent.slug)) || (dept.dashboard && i.source === dept.dashboard))).length;
  return { working, needsYou };
}

// The task a Needs-you item is about, from the item's id (`goal:<id>`, `staged:<kind>:<id>[:...]`,
// `board:hold:<id>`), or null.
const TASK_OF_ITEM = /^(?:goal|staged:[a-z_]+|board:hold):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::|$)/;
export const taskOfItem = (id) => (typeof id === "string" && TASK_OF_ITEM.exec(id)?.[1]) || null;
const PLANNERS = new Set(["chief-of-staff", "checker"]);

// The department a Needs-you item belongs to (M51 F4, M50 F2): a task's item belongs to the department of the
// job it came from, else of the agent who did the work (the newest step given to an agent other than the
// Chief of staff and the Checker, else any agent's step); an item that is not about a task belongs to its
// dashboard, else to the agent who raised it. Operations only when nothing else is known. The one rule for the
// dock (routes/shell.mjs), the map's count lines and warm marks (lib/tasks.mjs decorateInbox) and Needs you.
export function itemDepartment(item, { decisions, catalogue, issues, slugOfAgentId } = {}) {
  const taskId = item.taskId || taskOfItem(item.id);
  if (taskId) {
    const ref = decisions?.get?.(`template:${taskId}`);
    const job = typeof ref === "string" ? catalogue?.jobs?.get(ref) : null;
    if (job?.department) return job.department;
    const steps = descendants(issues || [], taskId).filter((st) => st.assigneeAgentId)
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
    const slugs = steps.map((st) => (typeof slugOfAgentId === "function" ? slugOfAgentId(st.assigneeAgentId) : null)).filter(Boolean);
    const doer = slugs.find((sl) => !PLANNERS.has(sl)) || slugs[0];
    const d = doer ? departmentOf(doer) : null;
    if (d) return d;
  }
  const bySource = item.source && !["goal", "board", "staged"].includes(item.source) ? departmentOf(item.source) : null;
  return bySource || (item.agent?.slug ? departmentOf(item.agent.slug) : null) || "operations";
}
