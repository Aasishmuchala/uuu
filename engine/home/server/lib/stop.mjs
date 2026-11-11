// Stopping a task (CONTRACTS 9.4), one way for every place that offers it: the Tasks page (routes/goals.mjs),
// "A task stopped" in Needs you (inbox/board.mjs) and the staged items (inbox/staged.mjs).
// The goal is cancelled first, so a failure on a step never leaves the goal itself running. Then its open steps,
// as the board lists them under it: a step that cannot be stopped is logged and the rest go on; the answer says
// how many could not be stopped. An agent can move an idle task under a goal, so a step that is itself a task the
// owner gave (made by the owner, not by an agent and not by an agent's suggestion) is left alone, with what is
// under it, and named in the log.
// Every id sent is the goal's own (from a board record) or one the board listed under it.
import { HomeError } from "./errors.mjs";
import { loadIssues } from "./goals.mjs";

const enc = encodeURIComponent;
const OPEN = (i) => i && i.status !== "done" && i.status !== "cancelled";

// A task the owner gave: made by the owner (the home server acts as the owner), not by an agent, and not created
// from an agent's suggestion (those carry the run that suggested them).
export function isOwnerGoal(issue) {
  return !!issue && !issue.createdByAgentId && !!issue.createdByUserId && !issue.originRunId;
}

// Sets one task to cancelled. When the board's answer does not arrive in time, the task is read again: it counts
// as stopped when the board shows it cancelled.
async function cancel(ctx, issueId) {
  const path = `/api/issues/${enc(issueId)}`;
  try {
    await ctx.board.patch(path, { status: "cancelled" });
  } catch (e) {
    if (!(e instanceof HomeError) || e.status < 500) throw e;
    let now = null;
    try { now = await ctx.board.get(path); } catch { throw e; }
    if (now?.status !== "cancelled") throw e;
  }
}

// The open steps under a goal, as the board lists them, without the owner's own tasks grafted under it (and
// what is under those). Returns { steps, grafted }.
export function stepsToStop(issues, goalId) {
  const byParent = new Map();
  for (const i of issues) {
    if (!i?.parentId) continue;
    if (!byParent.has(i.parentId)) byParent.set(i.parentId, []);
    byParent.get(i.parentId).push(i);
  }
  const steps = [];
  const grafted = [];
  const seen = new Set([goalId]);
  const queue = [goalId];
  while (queue.length) {
    for (const child of byParent.get(queue.shift()) || []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      if (isOwnerGoal(child)) { grafted.push(child); continue; }
      if (OPEN(child)) steps.push(child);
      queue.push(child.id);
    }
  }
  return { steps, grafted };
}

// stopTask(ctx, goalId, { issues }) -> { message, stopped, failed, left }. Throws when the goal itself could not be
// stopped. `issues` is the board's list when the caller has just read it.
export async function stopTask(ctx, goalId, { issues = null } = {}) {
  const log = (line) => { try { ctx.log?.(line); } catch { /* logging never fails a stop */ } };
  let list = issues;
  if (!list) {
    try { list = await loadIssues(ctx, ctx.ids().companyId); } catch { list = null; }
  }
  await cancel(ctx, goalId);
  const goal = list?.find((i) => i.id === goalId);
  const ref = goal?.identifier || "a task";
  if (!list) {
    log(`stop: ${ref} was stopped, but its steps could not be read`);
    return { message: "Stopped. Its steps could not be checked just now: stop it again in a minute to stop them too.", stopped: 0, failed: null, left: 0 };
  }
  const { steps, grafted } = stepsToStop(list, goalId);
  for (const g of grafted) log(`stop: left ${g.identifier || "a task"} running under ${ref}: it is a task you gave, not one of its steps`);
  let stopped = 0;
  let failed = 0;
  for (const step of steps) {
    try {
      await cancel(ctx, step.id);
      stopped += 1;
    } catch (e) {
      failed += 1;
      log(`stop: step ${step.identifier || "of a task"} of ${ref} could not be stopped: ${String(e?.code || e?.message || e).split("\n")[0]}`);
    }
  }
  let message = "Stopped. The task will not go on.";
  if (failed === 1) message = "Stopped, but one of its steps could not be stopped. Stop it again in a minute.";
  else if (failed > 1) message = `Stopped, but ${failed} of its steps could not be stopped. Stop it again in a minute.`;
  return { message, stopped, failed, left: grafted.length };
}
