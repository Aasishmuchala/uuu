// CONTRACTS 9.4: give a goal, list goals, one goal's detail, a note, stop.
import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { firstLine } from "../lib/format.mjs";
import {
  agentNames, authorOf, commentsOf, descendants, goalsOf, isFinished, isGoal, loadIssues, needIds,
  pickResult, pickVerdict, plainState, summary,
} from "../lib/goals.mjs";

const MAX_TEXT = 4000;
const MAX_FILES = 200;

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
  app.post("/api/goals", async (ctx) => {
    const text = readText(ctx);
    const ids = needIds(ctx);
    const chief = ids.agents?.["chief-of-staff"];
    if (!chief) throw ctx.fail(409, "The Chief of staff is not set up yet.", "Run engine setup first.", "not_set_up");
    const created = await ctx.board.post(`/api/companies/${encodeURIComponent(ids.companyId)}/issues`, {
      title: firstLine(text, 80), description: text, assigneeAgentId: chief, projectId: ids.projectId,
      status: "todo", priority: "medium",
    });
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
    const { goal } = await findGoal(ctx, ids, ctx.params.id);
    await ctx.board.patch(`/api/issues/${encodeURIComponent(goal.id)}`, { status: "cancelled" });
    return { ok: true };
  });
}
