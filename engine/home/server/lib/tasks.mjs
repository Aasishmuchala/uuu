// The task model (CONTRACTS-V2 16.3): one read of the board per request, turned into the columns,
// cards and Needs-you items every v2 page shows. A task is a goal (CONTRACTS 9.4): a top task in the
// project "Company work". Comments are read only as the contract says (unfinished tasks, at most 40)
// and kept for 15 seconds, so a page that polls every 10 seconds does not read every comment again.
// Shared by routes/shell.mjs and the Home, Tasks, Task, Team and Routines features; they never edit it.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isFixTask } from "./draftfix.mjs";
import { departmentOf, itemDepartment } from "./departments.mjs";
import { goalsOf, isFinished, isGoal, loadIssues, needIds, plainState, rootOf } from "./goals.mjs";
import { aboutOf, mergeInbox, waitsOnOwner } from "./inbox.mjs";
import { loadCatalogue } from "./jobs.mjs";
import { roundsOf, sizeOf, textOf } from "./staged.mjs";
import { readTaskText } from "./taskfiles.mjs";
import { loadRoles } from "./team.mjs";

const COMMENT_TTL = 15000;
const COMMENT_CACHE_MAX = 2000;
const OPEN_GOALS_MAX = 40;
const ALL_GOALS_MAX = 200;
const RESULT_GOALS_MAX = 20;  // finished tasks whose result comment is read for their outcome (CONTRACTS-V3 33.2)
const OUTCOME_MAX = 140;
const PARALLEL = 8;
const ROUTINE_ID = /^[a-z][a-z0-9-]{1,40}$/;

const STAGE_LABELS = { brief: "Brief", plan: "Plan", work: "Work", summary: "Summary", check: "Check" };
const WORKING = new Set(["in_progress", "in_review"]);

// ---- comments, cached 15 seconds per board and task
const commentCache = new Map(); // `${board}\n${issueId}` -> { at, value: Promise<comment[]> }

function readComments(ctx, issueId) {
  const key = `${ctx.home?.urls?.board || ""}\n${issueId}`;
  const now = Date.now();
  const hit = commentCache.get(key);
  if (hit && now - hit.at < COMMENT_TTL) return hit.value;
  const value = ctx.board.get(`/api/issues/${encodeURIComponent(issueId)}/comments`)
    .then((list) => (Array.isArray(list) ? list : []).slice()
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))));
  commentCache.set(key, { at: now, value });
  value.catch(() => { if (commentCache.get(key)?.value === value) commentCache.delete(key); });
  if (commentCache.size > COMMENT_CACHE_MAX) {
    for (const [k, v] of commentCache) {
      if (now - v.at >= COMMENT_TTL || commentCache.size > COMMENT_CACHE_MAX) commentCache.delete(k);
      if (commentCache.size <= COMMENT_CACHE_MAX / 2) break;
    }
  }
  return value;
}

// Forget cached comments (all, or one task's), for a feature that has just written a comment, and for tests.
export function forgetComments(issueId) {
  if (!issueId) { commentCache.clear(); return; }
  for (const k of commentCache.keys()) if (k.endsWith(`\n${issueId}`)) commentCache.delete(k);
}

async function inBatches(items, fn) {
  for (let i = 0; i < items.length; i += PARALLEL) await Promise.all(items.slice(i, i + PARALLEL).map(fn));
}

// ---- routines: the board's routines joined to the routine files (section 18)
function routineFiles(config) {
  const dir = join(config.engineDir, "company", "routines");
  let names = [];
  try { names = readdirSync(dir).filter((f) => f.endsWith(".json")).sort(); } catch { return []; }
  const out = [];
  for (const f of names) {
    const id = f.slice(0, -5);
    if (!ROUTINE_ID.test(id)) continue;
    try {
      const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
      out.push({ id, title: typeof d?.title === "string" ? d.title : null, plain: typeof d?.when?.plain === "string" ? d.when.plain : null });
    } catch { /* a broken file is reported by the Routines page, not here */ }
  }
  return out;
}

function slugOfTitle(title) {
  const s = String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 41);
  return ROUTINE_ID.test(s) ? s : null;
}

function routineMap(boardRoutines, ids, config) {
  const map = new Map();
  if (!boardRoutines.length) return map;
  const files = routineFiles(config);
  const byBoardId = new Map(Object.entries(ids?.routines || {}).map(([id, boardId]) => [boardId, id]));
  for (const r of boardRoutines) {
    if (!r || typeof r.id !== "string") continue;
    const file = files.find((f) => f.id === byBoardId.get(r.id)) || files.find((f) => f.title && f.title === r.title) || null;
    const id = byBoardId.get(r.id) || file?.id || slugOfTitle(r.title);
    if (!id) continue;
    const trigger = (Array.isArray(r.triggers) ? r.triggers : []).find((t) => t?.kind === "schedule" && typeof t.label === "string" && t.label);
    map.set(r.id, { id, plain: file?.plain || trigger?.label || "On a schedule" });
  }
  return map;
}

// ---- the context
function agentMap(list, ids, roles) {
  const slugs = new Map(Object.entries(ids?.agents || {}).map(([slug, id]) => [id, slug]));
  return new Map(list.filter((a) => a && a.id).map((a) => {
    const slug = slugs.get(a.id) || roles.find((r) => r.name === a.name)?.slug || a.urlKey || null;
    return [a.id, { slug, name: a.name }];
  }));
}

function isOpen(goal, accepted) {
  if (goal.status === "cancelled") return false;
  return !(goal.status === "done" && accepted(goal.id));
}

// loadTaskContext(ctx, { withInbox = true, withComments = "open" }) -> tctx. `withComments`: "open"
// (unfinished tasks, newest first, at most 40), "all" (at most 200), or false (none). Unless it is false, the
// newest 20 finished tasks' own comments are read too, for their outcome only (`tctx.outcomes`). Throws a
// HomeError when the board is off or the company is not set up. An inbox source must pass withInbox: false.
export async function loadTaskContext(ctx, { withInbox = true, withComments = "open" } = {}) {
  const ids = needIds(ctx);
  const companyId = ids.companyId;
  const enc = encodeURIComponent(companyId);
  const [issues, agentList, liveRuns, boardRoutines] = await Promise.all([
    loadIssues(ctx, companyId),
    ctx.board.get(`/api/companies/${enc}/agents`).then((l) => (Array.isArray(l) ? l : [])),
    ctx.board.get(`/api/companies/${enc}/live-runs`).then((l) => (Array.isArray(l) ? l : [])).catch(() => []),
    ctx.board.get(`/api/companies/${enc}/routines`).then((l) => (Array.isArray(l) ? l : [])).catch(() => []),
  ]);
  const roles = loadRoles(ctx.config, { log: ctx.log });
  const goals = goalsOf(issues, ids);

  const liveByIssue = new Map();
  const liveByAgent = new Map();
  for (const r of liveRuns) {
    if (r?.issueId && !liveByIssue.has(r.issueId)) liveByIssue.set(r.issueId, r);
    if (r?.agentId && !liveByAgent.has(r.agentId)) liveByAgent.set(r.agentId, r);
  }

  const children = new Map();
  for (const i of issues) {
    if (!i.parentId) continue;
    if (!children.has(i.parentId)) children.set(i.parentId, []);
    children.get(i.parentId).push(i);
  }
  const stepsMemo = new Map();
  // Every step (descendant task) of a task, oldest first.
  const stepsOf = (goalId) => {
    if (stepsMemo.has(goalId)) return stepsMemo.get(goalId);
    const out = [];
    const seen = new Set([goalId]);
    const queue = [goalId];
    while (queue.length) {
      for (const c of children.get(queue.shift()) || []) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(c);
        queue.push(c.id);
      }
    }
    out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    stepsMemo.set(goalId, out);
    return out;
  };

  // A fix task the home server made for a draft (lib/draftfix.mjs) counts as accepted: the owner decides on
  // the draft, not on the fix task, so a finished one never waits for the owner on the Tasks board.
  const accepted = (goalId) => !!ctx.decisions.get(`acknowledged:goal:${goalId}`) || isFixTask(ctx, goalId);

  const tctx = {
    ids, issues, goals, roles, agentList,
    agents: agentMap(agentList, ids, roles),
    liveByIssue, liveByAgent,
    needsYou: [],
    accepted,
    commentsOf: (issueId) => readComments(ctx, issueId),
    routines: routineMap(boardRoutines, ids, ctx.config),
    stepsOf,
    config: ctx.config,
    comments: new Map(),     // goal id -> the comments of its whole tree, oldest first (only for goals read)
    decisions: ctx.decisions || null,
    outcomes: new Map(),     // goal id -> the first line of its newest result (finished tasks read for it)
  };
  let catalogue;
  // The job catalogue (lib/jobs.mjs), read once per context and only when a card needs it.
  Object.defineProperty(tctx, "catalogue", { enumerable: true, get() { if (catalogue === undefined) catalogue = catalogueOf(ctx.config); return catalogue; } });

  let wanted = [];
  if (withComments === "open") wanted = goals.filter((g) => isOpen(g, accepted)).slice(0, OPEN_GOALS_MAX);
  else if (withComments === "all") wanted = goals.slice(0, ALL_GOALS_MAX);
  const inboxRead = withInbox
    ? mergeInbox(ctx, ctx.home.inboxSources).then((m) => m.items)
    : Promise.resolve([]);
  const commentsRead = inBatches(wanted, async (g) => {
    tctx.comments.set(g.id, await treeComments(tctx, g));
  });
  const finished = withComments ? goals.filter((g) => g.status === "done").slice(0, RESULT_GOALS_MAX) : [];
  const resultsRead = inBatches(finished, async (g) => {
    let own = [];
    try { own = await tctx.commentsOf(g.id); } catch { own = []; } // an outcome is a nicety: never fail the read for it
    const outcome = outcomeOf(own);
    if (outcome) tctx.outcomes.set(g.id, outcome);
  });
  const [items] = await Promise.all([inboxRead, commentsRead, resultsRead]);
  tctx.needsYou = decorateInbox(items, tctx);
  return tctx;
}

function catalogueOf(config) {
  try { return config && config.engineDir ? loadCatalogue(config) : null; } catch { return null; }
}

// The first line of the newest result an agent wrote (comments oldest first): the text after "RESULT:", with an
// answer's source marks ("[1]") taken out, cut to 140 characters; null when there is none. Shown as text only.
export function outcomeOf(comments) {
  const list = Array.isArray(comments) ? comments : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const c = list[i];
    if (!c || !c.authorAgentId || typeof c.body !== "string") continue;
    const m = /^\s*RESULT:/.exec(c.body.slice(0, 64));
    if (!m) continue;
    const rest = c.body.slice(m[0].length, m[0].length + 8000);
    // White space is collapsed first, so no pattern below ever walks a long run of it again (S8 F1: quadratic).
    const line = rest.split("\n").map((l) => l.replace(/\s+/g, " ").replace(/ ?\[\d{1,3}\]/g, "").replace(/ {2,}/g, " ").trim()).find(Boolean) || "";
    if (!line) return null;
    return line.length > OUTCOME_MAX ? `${line.slice(0, OUTCOME_MAX - 1).trimEnd()}…` : line;
  }
  return null;
}

// The comments of a task and all its steps, oldest first (cached 15 seconds per task).
export async function treeComments(tctx, goal) {
  const all = [];
  const tree = [goal, ...tctx.stepsOf(goal.id)];
  await inBatches(tree, async (i) => { all.push(...await tctx.commentsOf(i.id)); });
  return all.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// ---- Needs you
function agentByName(tctx, name) {
  const want = String(name || "").replace(/^the\s+/i, "").trim().toLowerCase();
  if (!want) return null;
  for (const a of tctx.agents.values()) if (a.slug && String(a.name).toLowerCase() === want) return { slug: a.slug, name: a.name };
  const role = (tctx.roles || []).find((r) => r.name.toLowerCase() === want);
  return role ? { slug: role.slug, name: role.name } : null;
}

function whoOfAgentId(tctx, agentId) {
  const a = agentId ? tctx.agents.get(agentId) : null;
  return a ? { slug: a.slug, name: a.name } : null;
}

// decorateInbox(items, tctx): each item with taskId, identifier, agent and department added. Hidden keys the
// inbox sources keep on an item (for acting on it) are kept. `department` follows lib/departments.mjs
// itemDepartment, the one rule the dock, the map's counts and the Needs you filter all count by: a task's item
// belongs to the department that did the task, not to the Chief of staff who raised it.
export function decorateInbox(items, tctx) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const out = Object.create(Object.getPrototypeOf(item));
    Object.defineProperties(out, Object.getOwnPropertyDescriptors(item));
    let root = null;
    const link = item.link;
    if (link && (link.page === "goals" || link.page === "tasks") && typeof link.id === "string") {
      const r = rootOf(tctx.issues, link.id);
      if (r && isGoal(r, tctx.ids)) root = r;
    }
    out.taskId = root ? root.id : null;
    out.identifier = root ? root.identifier || null : null;
    out.agent = agentByName(tctx, item.raisedBy);
    out.department = itemDepartment({ id: item.id, source: item.source, taskId: out.taskId, agent: out.agent }, {
      decisions: tctx.decisions, catalogue: tctx.catalogue, issues: tctx.issues,
      slugOfAgentId: (id) => tctx.agents?.get(id)?.slug || null, chiefId: tctx.ids?.agents?.["chief-of-staff"] || null,
    });
    return out;
  });
}

// What GET /api/inbox lists (additive keys on each item, CONTRACTS 9.3): `agent` ({ slug, name } or null) and
// `department` (an id), by lib/departments.mjs itemDepartment. Without the board (tctx null) items are placed by
// their id's task alone where a job record names it, else by their source and the agent's name in the role files.
// Plain objects: hidden keys are not listed.
export function inboxView(items, tctx, roles = []) {
  const list = Array.isArray(items) ? items : [];
  if (tctx) return decorateInbox(list, tctx).map(({ taskId, identifier, ...item }) => item);
  return list.map((item) => {
    const want = String(item.raisedBy || "").replace(/^the\s+/i, "").trim().toLowerCase();
    const role = want ? (roles || []).find((r) => String(r.name).toLowerCase() === want) : null;
    const agent = role ? { slug: role.slug, name: role.name } : null;
    return { ...item, agent, department: itemDepartment({ id: item.id, source: item.source, agent }) };
  });
}

// ---- columns and cards
export function columnOf(goal, tctx) {
  switch (goal.status) {
    case "todo": case "backlog": return "backlog";
    case "in_progress": case "in_review": return "in_progress";
    case "done": return tctx.accepted(goal.id) ? "done" : "pending_review";
    case "cancelled": return "canceled";
    case "blocked":
      if (waitsForOwner(goal, tctx)) return "pending_review";
      return isHeldTask(goal, tctx) || tctx.needsYou.some((i) => i.taskId === goal.id && i.kind === "problem" && i.source === "board") ? "failed" : "pending_review";
    default: return "backlog";
  }
}

// A task the Chief of staff blocked on purpose: Needs you holds a question about the task itself that can be
// answered or accepted (the staged source's or a board question card), or the staged source's plan to accept.
// The board's own "blocked" problem item beside it does not make it a failure. A question about one of its
// steps does not count: the goal itself is not waiting on it (lib/inbox.mjs uses the same rule).
export function waitsForOwner(goal, tctx) {
  return tctx.needsYou.some((i) => waitsOnOwner(i) && aboutOf(i) === goal.id);
}

// Needs you holds "A task stopped" for this task: the board will not start it again by itself.
export function isHeldTask(goal, tctx) {
  return tctx.needsYou.some((i) => i.taskId === goal.id && i.source === "board" && i.kind === "problem"
    && (i._raw?.sourceKind === "execution_hold" || String(i.id).startsWith("board:hold:")));
}

function hasDoc(tctx, goal, name) {
  return !!goal.identifier && readTaskText(tctx.config, goal.identifier, name, { maxBytes: 0 }) !== null;
}

function scheduleOf(goal, tctx, text) {
  if (goal.originKind === "routine_execution" && goal.originId && tctx.routines.has(goal.originId)) {
    const r = tctx.routines.get(goal.originId);
    return { label: r.plain, routineId: r.id };
  }
  if (text.routine && ROUTINE_ID.test(text.routine)) {
    const known = [...tctx.routines.values()].find((r) => r.id === text.routine);
    const plain = known?.plain || routineFiles(tctx.config).find((f) => f.id === text.routine)?.plain || "On a schedule";
    return { label: plain, routineId: text.routine };
  }
  return null;
}

// What the home server's records say about a task (CONTRACTS-V3 31.3, 33.2): the job it was started from
// (null when the record names a job no longer in the catalogue), whether it is a question, which task it follows.
function recordsOf(goal, tctx) {
  const get = (key) => (tctx.decisions && typeof tctx.decisions.get === "function" ? tctx.decisions.get(key) : null);
  const ref = get(`template:${goal.id}`);
  const file = typeof ref === "string" ? tctx.catalogue?.jobs?.get(ref) : null;
  const job = file ? { id: ref, title: file.title, department: file.department } : null;
  const fromId = get(`from:${goal.id}`);
  let follows = null;
  if (typeof fromId === "string" && fromId) {
    const earlier = (tctx.goals || []).find((g) => g.id === fromId);
    follows = { taskId: fromId, identifier: earlier ? earlier.identifier || null : null };
  }
  return { job, ask: !!get(`ask:${goal.id}`), follows };
}

// Who a task is with: the agent of its newest working step, else the agent its text is for, else its assignee.
function workerOf(goal, tctx, text) {
  const steps = tctx.stepsOf(goal.id);
  let who = null;
  const working = [...steps].reverse().find((s) => WORKING.has(s.status) && s.assigneeAgentId);
  if (working) who = whoOfAgentId(tctx, working.assigneeAgentId);
  if (!who && text.for) who = agentByName(tctx, text.for);
  if (!who) who = whoOfAgentId(tctx, goal.assigneeAgentId);
  return who;
}

export function taskCard(goal, tctx) {
  const steps = tctx.stepsOf(goal.id);
  const counted = steps.filter((s) => s.status !== "cancelled");
  const text = textOf(goal.description || "");
  const comments = tctx.comments.get(goal.id);
  // Only the Checker's VERDICT comments are check rounds (none when the Checker is not set up).
  const rounds = comments ? roundsOf(comments, tctx.ids?.agents?.checker || null) : null;

  const who = workerOf(goal, tctx, text);

  let stage = null;
  if (rounds && rounds.length) stage = "check";
  else if (hasDoc(tctx, goal, "04-summary.md")) stage = "summary";
  else if (steps.length) stage = "work";
  else if (hasDoc(tctx, goal, "01-plan.md")) stage = "plan";
  else if (hasDoc(tctx, goal, "00-brief.md")) stage = "brief";

  return {
    id: goal.id, identifier: goal.identifier, title: goal.title,
    column: columnOf(goal, tctx), ...plainState(goal.status),
    who,
    size: comments ? sizeOf(comments) : null,
    stage: goal.status === "blocked" && isHeldTask(goal, tctx) && !waitsForOwner(goal, tctx) ? { id: stage || "work", label: "Stopped" }
      : stage ? { id: stage, label: goal.status === "blocked" && waitsForOwner(goal, tctx) ? `${STAGE_LABELS[stage]}: waiting for you` : STAGE_LABELS[stage] } : null,
    round: rounds ? rounds.length : null,
    schedule: scheduleOf(goal, tctx, text),
    waitingForYou: tctx.needsYou.some((i) => i.taskId === goal.id),
    live: tctx.liveByIssue.has(goal.id) || steps.some((s) => tctx.liveByIssue.has(s.id)),
    stepsDone: counted.filter((s) => s.status === "done").length, stepsTotal: counted.length,
    createdAt: goal.createdAt, updatedAt: goal.updatedAt,
    ...v3Keys(goal, tctx, who),
  };
}

function v3Keys(goal, tctx, who) {
  const { job, ask, follows } = recordsOf(goal, tctx);
  const outcome = isFinished(goal) ? tctx.outcomes?.get(goal.id) || null : null;
  return {
    job: job ? { id: job.id, title: job.title } : null,
    department: job ? job.department : who ? departmentOf(who.slug) : null,
    outcome, ask, follows,
  };
}

export function findTask(tctx, idOrIdentifier) {
  if (typeof idOrIdentifier !== "string" || !idOrIdentifier) return null;
  return tctx.goals.find((g) => g.id === idOrIdentifier || g.identifier === idOrIdentifier) || null;
}
