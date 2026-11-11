// CONTRACTS 9.4: give a goal, list goals, one goal's detail, a note, stop.
import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { buildText } from "../lib/staged.mjs";
import { stopTask } from "../lib/stop.mjs";
import { loadRoles } from "../lib/team.mjs";
import {
  agentNames, authorOf, commentsOf, descendants, goalsOf, isFinished, isGoal, loadIssues, needIds,
  pickResult, pickVerdict, plainState, summary,
} from "../lib/goals.mjs";

// The task's title: the first line of the owner's text, cut at a word boundary so that it, with "…", is at most
// 80 characters. The "…" is added only when something was cut. The full text stays in the description.
export function titleOf(text, max = 80) {
  const line = String(text || "").trim().split("\n")[0].trim();
  if (line.length <= max) return line;
  const room = line.slice(0, max);
  const at = room.search(/\s\S*$/);
  return `${(at > 0 ? room.slice(0, at) : room.slice(0, max - 1)).trimEnd()}…`;
}

const MAX_TEXT = 4000;
const MAX_FILES = 200;
const TEMPLATE = /^[a-z0-9][a-z0-9-]{0,39}\/[a-z0-9][a-z0-9-]{0,79}$/;

export function fileToken(rel) {
  return Buffer.from(rel, "utf8").toString("base64url");
}

function readText(ctx, field = "text") {
  const text = ctx.body && typeof ctx.body[field] === "string" ? ctx.body[field].trim() : "";
  if (!text) throw ctx.fail(400, "There is nothing written yet.", "Write it in your own words, then send it.", "empty_text");
  if (text.length > MAX_TEXT) throw ctx.fail(400, "That is too long.", `Keep it under ${MAX_TEXT} characters.`, "text_too_long");
  return text;
}

// Files of one goal: tasks/company-work/<identifier>/, real paths only inside that folder, at most 200.
function goalFiles(projectFolder, identifier) {
  if (!identifier || !/^[A-Za-z0-9_-]+$/.test(identifier)) return [];
  let root;
  try { root = realpathSync(projectFolder); } catch { return []; }
  let base;
  try { base = realpathSync(join(root, identifier)); } catch { return []; }
  if (!base.startsWith(root + sep)) return [];
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return; }
    for (const e of entries) {
      if (out.length >= MAX_FILES || e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(full, r); continue; }
      if (!e.isFile()) continue;
      let size = 0;
      try { size = statSync(full).size; } catch { continue; }
      out.push({ name: r, size, url: `/api/files/${fileToken(`${identifier}/${r}`)}` });
    }
  };
  walk(base, "");
  return out;
}

async function findGoal(ctx, ids, id) {
  const issues = await loadIssues(ctx, ids.companyId);
  const goal = issues.find((i) => (i.id === id || i.identifier === id) && isGoal(i, ids));
  if (!goal) throw ctx.fail(404, "That goal is not here.", "Go back to the list of goals.", "goal_not_found");
  return { goal, issues };
}

export default function register(app) {
  // CONTRACTS-V2 17.4: `planFirst`, `to` and `template` are optional. The task always goes to the Chief of
  // staff; `to` only adds a "FOR: <name>" line, with the name taken from the company file, never from the body.
  app.post("/api/goals", async (ctx) => {
    const text = readText(ctx);
    const body = ctx.body && typeof ctx.body === "object" ? ctx.body : {};
    const planFirst = body.planFirst === true;
    let toName = null;
    if (body.to !== undefined && body.to !== null && body.to !== "") {
      const role = typeof body.to === "string" ? loadRoles(ctx.config, { log: ctx.log }).find((r) => r.slug === body.to) : null;
      if (!role) throw ctx.fail(400, "That agent is not part of the company.", "Pick an agent from the list, or leave it to the Chief of staff.", "bad_to");
      if (role.slug !== "chief-of-staff") toName = role.name;
    }
    const template = typeof body.template === "string" && TEMPLATE.test(body.template) ? body.template : null;
    const ids = needIds(ctx);
    const chief = ids.agents?.["chief-of-staff"];
    if (!chief) throw ctx.fail(409, "The Chief of staff is not set up yet.", "Run engine setup first.", "not_set_up");
    const created = await ctx.board.post(`/api/companies/${encodeURIComponent(ids.companyId)}/issues`, {
      title: titleOf(text), description: buildText({ text, to: toName, planFirst }), assigneeAgentId: chief,
      projectId: ids.projectId, status: "todo", priority: "medium",
    });
    if (template && created && typeof created.id === "string") ctx.decisions.set(`template:${created.id}`, template);
    return { status: 201, body: { goal: summary(created, [created]) } };
  });

  app.get("/api/goals", async (ctx) => {
    const show = ctx.query.show || "active";
    if (!["active", "finished", "all"].includes(show)) {
      throw ctx.fail(400, "The home screen asked for a list it does not know.", "Pick active, finished or all.", "bad_show");
    }
    const ids = needIds(ctx);
    const issues = await loadIssues(ctx, ids.companyId);
    const goals = goalsOf(issues, ids).filter((g) => show === "all" || (show === "finished") === isFinished(g));
    return { goals: goals.map((g) => summary(g, issues)) };
  });

  app.get("/api/goals/:id", async (ctx) => {
    const ids = needIds(ctx);
    const { goal, issues } = await findGoal(ctx, ids, ctx.params.id);
    const steps = descendants(issues, goal.id);
    const names = await agentNames(ctx, ids.companyId);
    const goalComments = await commentsOf(ctx, goal.id);
    const stepComments = await Promise.all(steps.map((s) => commentsOf(ctx, s.id)));
    const all = [...goalComments, ...stepComments.flat()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return {
      goal: { ...summary(goal, issues), text: goal.description || goal.title },
      steps: steps.map((s) => ({
        id: s.id, identifier: s.identifier, title: s.title,
        who: s.assigneeAgentId ? names.get(s.assigneeAgentId) || "An agent" : "Nobody yet",
        ...plainState(s.status), updatedAt: s.updatedAt,
      })),
      result: pickResult(goalComments, names),
      verdict: pickVerdict(stepComments.flat(), names),
      updates: all.map((c) => ({ who: authorOf(c, names), text: c.body, at: c.createdAt })),
      files: goalFiles(ctx.config.paths.projectFolder, goal.identifier),
    };
  });

  app.post("/api/goals/:id/note", async (ctx) => {
    const text = readText(ctx);
    const ids = needIds(ctx);
    const { goal } = await findGoal(ctx, ids, ctx.params.id);
    const path = `/api/issues/${encodeURIComponent(goal.id)}`;
    await ctx.board.post(`${path}/comments`, { body: text });
    if (goal.status === "done" || goal.status === "blocked") await ctx.board.patch(path, { status: "todo" });
    return { ok: true };
  });

  app.post("/api/goals/:id/stop", async (ctx) => {
    const ids = needIds(ctx);
    const { goal, issues } = await findGoal(ctx, ids, ctx.params.id);
    // The goal first, then its open steps (lib/stop.mjs), so no step of a stopped task still waits for the owner or an agent.
    const out = await stopTask(ctx, goal.id, { issues });
    ctx.home?.unstick?.forget?.(goal.id);
    return { ok: true, message: out.message };
  });
}
