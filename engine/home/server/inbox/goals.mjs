// Inbox source "goals": finished goals the owner has not acknowledged yet (CONTRACTS 9.3).
import { agentNames, commentsOf, goalsOf, loadIssues, needIds, pickResult } from "../lib/goals.mjs";

const ackKey = (id) => `acknowledged:goal:${id}`;

async function list(ctx) {
  const ids = needIds(ctx);
  const issues = await loadIssues(ctx, ids.companyId);
  const done = goalsOf(issues, ids).filter((g) => g.status === "done" && !ctx.decisions.get(ackKey(g.id)));
  if (!done.length) return { items: [] };
  const names = await agentNames(ctx, ids.companyId);
  const items = await Promise.all(done.map(async (g) => {
    const result = pickResult(await commentsOf(ctx, g.id), names);
    const text = result?.text ? result.text.replace(/\s+/g, " ").trim() : "";
    const item = {
      id: `goal:${g.id}`,
      source: "goal",
      kind: "result",
      title: `Finished: ${g.title}`,
      raisedBy: "Chief of staff",
      when: g.updatedAt || g.createdAt,
      summary: text ? (text.length > 280 ? `${text.slice(0, 279)}…` : text) : "The Chief of staff says this goal is finished.",
      severity: "normal",
      details: [],
      actions: [
        { id: "acknowledge", label: "Got it", style: "primary", needsNote: false },
        { id: "reopen", label: "Reopen", style: "plain", needsNote: true },
      ],
      link: { page: "goals", id: g.id },
    };
    Object.defineProperty(item, "_goalId", { enumerable: false, value: g.id });
    return item;
  }));
  return { items };
}

async function act(ctx, itemId, action, note) {
  const goalId = ctx.item._goalId;
  if (action === "acknowledge") {
    ctx.decisions.set(ackKey(goalId), new Date().toISOString());
    return { message: "Marked as seen." };
  }
  if (action === "reopen") {
    const path = `/api/issues/${encodeURIComponent(goalId)}`;
    await ctx.board.post(`${path}/comments`, { body: note });
    await ctx.board.patch(path, { status: "todo" });
    return { message: "The goal is open again with your note. The Chief of staff will pick it up." };
  }
  throw ctx.fail(400, "That action is not offered for this item.", "Refresh the inbox and pick one of the buttons shown.", "bad_action");
}

export default { id: "goals", list, act };
