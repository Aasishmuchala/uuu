// Inbox source "goals": finished goals the owner has not accepted yet (CONTRACTS 9.3, CONTRACTS-V2 17.4).
// Each item's `version` (CONTRACTS 9.3a) is a hash of the newest result and the newest check, read from the
// board on every list (never cached), so Accept acts only on the delivery the owner read.
import { agentNames, commentsOf, descendants, goalsOf, loadIssues, needIds, pickResult } from "../lib/goals.mjs";
import { versionOf } from "../lib/inbox.mjs";
import { roundsOf } from "../lib/staged.mjs";
import { listTaskFiles } from "../lib/taskfiles.mjs";

const ackKey = (id) => `acknowledged:goal:${id}`;

// "Passed in round <n>" for the newest round that passed, else "Not checked".
function checkedOf(treeComments) {
  const passed = roundsOf(treeComments).filter((r) => r.outcome === "pass").at(-1);
  return passed ? `Passed in round ${passed.n}` : "Not checked";
}

async function list(ctx) {
  const ids = needIds(ctx);
  const issues = await loadIssues(ctx, ids.companyId);
  const done = goalsOf(issues, ids).filter((g) => g.status === "done" && !ctx.decisions.get(ackKey(g.id)));
  if (!done.length) return { items: [] };
  const names = await agentNames(ctx, ids.companyId);
  const items = await Promise.all(done.map(async (g) => {
    const own = await commentsOf(ctx, g.id);
    const steps = await Promise.all(descendants(issues, g.id).map((s) => commentsOf(ctx, s.id)));
    const tree = [...own, ...steps.flat()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const result = pickResult(own, names);
    const text = result?.text ? result.text.replace(/\s+/g, " ").trim() : "";
    const files = listTaskFiles(ctx.config, g.identifier).length;
    const resultComment = [...own].reverse().find((x) => /^\s*RESULT:/.test(x.body || "")) || null;
    const check = roundsOf(tree).at(-1)?.comment || null;
    const item = {
      id: `goal:${g.id}`,
      source: "goal",
      kind: "result",
      title: `Finished: ${g.title}`,
      raisedBy: "Chief of staff",
      when: g.updatedAt || g.createdAt,
      version: versionOf(resultComment?.id, resultComment?.body, check?.id, check?.body),
      summary: text ? (text.length > 280 ? `${text.slice(0, 279)}…` : text) : "The Chief of staff says this task is finished.",
      severity: "normal",
      details: [
        { label: "Checked", value: checkedOf(tree) },
        { label: "Files", value: files === 1 ? "1 file" : `${files} files` },
      ],
      actions: [
        { id: "acknowledge", label: "Accept", style: "primary", needsNote: false },
        { id: "reopen", label: "Send back", style: "plain", needsNote: true },
      ],
      link: { page: "tasks", id: g.id },
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
    return { message: "Accepted." };
  }
  if (action === "reopen") {
    const path = `/api/issues/${encodeURIComponent(goalId)}`;
    await ctx.board.post(`${path}/comments`, { body: String(note).trim() });
    await ctx.board.patch(path, { status: "todo" });
    return { message: "Sent back with your note. The Chief of staff will pick it up." };
  }
  throw ctx.fail(400, "That action is not offered for this item.", "Refresh the inbox and pick one of the buttons shown.", "bad_action");
}

export default { id: "goals", list, act };
