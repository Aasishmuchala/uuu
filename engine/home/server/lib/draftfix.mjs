// The task made when the owner sends a draft back. The draft stays the only thing the owner decides on: the
// fix task is not listed in Needs you, and it is closed when the owner approves the draft or sends it back
// again.
//
// Which tasks are fix tasks is known only from the home server's own record in the decisions store, written
// when it makes the task: `fixtask:<issue id>` holds the draft's item id and `fixtasks:<item id>` the issue
// ids made for that draft. Agents can edit task text, so the "DRAFT-FIX: <item id>" line at the end of the
// task is there for readers only and has no effect.
export const FIX_MARK = "DRAFT-FIX:";

const byIssue = (issueId) => `fixtask:${issueId}`;
const byItem = (itemId) => `fixtasks:${itemId}`;
const ackKey = (issueId) => `acknowledged:goal:${issueId}`;

export function fixLine(itemId) {
  return `${FIX_MARK} ${itemId}`;
}

// True when the home server made this task as a draft's fix task and has not closed it yet.
export function isFixTask(ctx, issueId) {
  return Boolean(issueId && typeof ctx.decisions.get(byIssue(issueId)) === "string");
}

const idsFor = (ctx, itemId) => {
  const list = ctx.decisions.get(byItem(itemId));
  return Array.isArray(list) ? list.filter((x) => typeof x === "string" && x) : [];
};

// Records the task the board just made for this draft (`created`: the board's answer to the POST).
export function recordFixTask(ctx, itemId, created) {
  const id = created && typeof created.id === "string" ? created.id : null;
  if (!id || !itemId) return null;
  ctx.decisions.set(byIssue(id), itemId);
  ctx.decisions.set(byItem(itemId), [...idsFor(ctx, itemId).filter((x) => x !== id), id]);
  return id;
}

// Sets every recorded fix task of this draft to done and forgets it. A closed fix task is marked accepted, so
// the Tasks board shows it as done, not as waiting for the owner. Never throws; returns how many it closed.
// A task that could not be closed stays recorded and is tried again next time.
export async function closeFixTasks(ctx, itemId) {
  let closed = 0;
  try {
    if (!itemId) return 0;
    const keep = [];
    for (const id of idsFor(ctx, itemId)) {
      try {
        const issue = await ctx.board.get(`/api/issues/${encodeURIComponent(id)}`);
        if (issue && issue.status !== "done" && issue.status !== "cancelled") {
          await ctx.board.patch(`/api/issues/${encodeURIComponent(id)}`, { status: "done" });
          closed += 1;
        }
        if (issue?.status !== "cancelled") ctx.decisions.set(ackKey(id), new Date().toISOString());
        ctx.decisions.set(byIssue(id), null);
      } catch (e) {
        // Gone from the board: nothing to close. Anything else: try again next time.
        if (e?.code === "board_not_found") ctx.decisions.set(byIssue(id), null);
        else keep.push(id);
      }
    }
    ctx.decisions.set(byItem(itemId), keep.length ? keep : null);
  } catch { /* best effort */ }
  return closed;
}
