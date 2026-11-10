// Goals (CONTRACTS 9.4): a goal is a top task (no parent) in the project "Company work".
// Shared by routes/goals.mjs, inbox/goals.mjs, search/goals.mjs, routes/company.mjs and routes/state.mjs.
import { HomeError } from "./errors.mjs";

export const GOAL_STATES = {
  todo: ["waiting", "Waiting to start"], backlog: ["waiting", "Waiting to start"],
  in_progress: ["working", "Being worked on"], in_review: ["checking", "Being checked"],
  blocked: ["needs_you", "Stuck, needs you"], done: ["done", "Finished"], cancelled: ["stopped", "Stopped"],
};
const FINISHED = new Set(["done", "cancelled"]);

export function plainState(status) {
  const [state, plain] = GOAL_STATES[status] || ["waiting", "Waiting to start"];
  return { state, plainState: plain };
}

export function needIds(ctx) {
  const ids = ctx.ids();
  if (!ids || !ids.companyId || !ids.projectId) {
    throw new HomeError(409, "The company is not set up yet.", "Run engine setup first.", "not_set_up");
  }
  return ids;
}

// Every task of the company (the board's own cap is 1000).
export async function loadIssues(ctx, companyId) {
  const list = await ctx.board.get(`/api/companies/${encodeURIComponent(companyId)}/issues?limit=1000`);
  return Array.isArray(list) ? list : [];
}

export function isGoal(issue, ids) {
  return !!issue && !issue.parentId && issue.projectId === ids.projectId;
}

export function goalsOf(issues, ids) {
  return issues.filter((i) => isGoal(i, ids))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function descendants(issues, rootId) {
  const byParent = new Map();
  for (const i of issues) {
    if (!i.parentId) continue;
    if (!byParent.has(i.parentId)) byParent.set(i.parentId, []);
    byParent.get(i.parentId).push(i);
  }
  const out = [];
  const seen = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    for (const child of byParent.get(queue.shift()) || []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      queue.push(child.id);
    }
  }
  return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// The top ancestor of an issue id, or null when the id is unknown.
export function rootOf(issues, issueId) {
  const byId = new Map(issues.map((i) => [i.id, i]));
  let cur = byId.get(issueId);
  const seen = new Set();
  while (cur && cur.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parentId);
  }
  return cur || null;
}

export function isFinished(goal) {
  return FINISHED.has(goal.status);
}

export function summary(goal, issues) {
  const steps = descendants(issues, goal.id).filter((s) => s.status !== "cancelled");
  return {
    id: goal.id, identifier: goal.identifier, title: goal.title, ...plainState(goal.status),
    createdAt: goal.createdAt, updatedAt: goal.updatedAt,
    stepsDone: steps.filter((s) => s.status === "done").length, stepsTotal: steps.length,
  };
}

export async function agentNames(ctx, companyId) {
  const list = await ctx.board.get(`/api/companies/${encodeURIComponent(companyId)}/agents`);
  return new Map((Array.isArray(list) ? list : []).map((a) => [a.id, a.name]));
}

export async function commentsOf(ctx, issueId) {
  const list = await ctx.board.get(`/api/issues/${encodeURIComponent(issueId)}/comments`);
  return (Array.isArray(list) ? list : []).slice()
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function authorOf(comment, names) {
  if (comment.authorAgentId) return names.get(comment.authorAgentId) || "An agent";
  return "You";
}

// The newest comment starting "RESULT:", as { text, by, at }.
export function pickResult(comments, names) {
  const c = [...comments].reverse().find((x) => /^\s*RESULT:/.test(x.body || ""));
  if (!c) return null;
  return { text: c.body.replace(/^\s*RESULT:\s*/, "").trim(), by: authorOf(c, names), at: c.createdAt };
}

// The newest comment starting "VERDICT:", as { outcome, reason, by, at }.
export function pickVerdict(comments, names) {
  const sorted = [...comments].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  for (const c of sorted) {
    const m = /^\s*VERDICT:\s*(PASS|FAIL)\b\s*(?:-\s*)?([\s\S]*)$/i.exec(c.body || "");
    if (m) return { outcome: m[1].toLowerCase(), reason: m[2].trim(), by: authorOf(c, names), at: c.createdAt };
  }
  return null;
}
