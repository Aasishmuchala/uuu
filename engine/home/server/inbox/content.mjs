// Inbox source "content": drafts the Marketer made, waiting for the owner (CONTRACTS 9.3, "content draft").
// Approving changes only the draft's status. Nothing is published, posted or sent.
// Each item's `version` is a hash of the draft's text (CONTRACTS 9.3a): the core refuses an action on any
// other version, and the action checks it again against the draft it re-reads.
// A draft is listed only once the task whose folder holds it has been checked: its newest check round passed,
// or it has no check and is in review or done. Until then the work is not finished and the owner is not asked.
// A task that cannot be found for the folder keeps its drafts unlisted.
// Sending a draft back makes one fix task for the Marketer, recorded by the home server (lib/draftfix.mjs), so it
// is not listed again as a result; approving the draft or sending it back again closes the recorded fix tasks
// for it, best effort.
// After its own work, the list brings the recipe log up to date (lib/recipes.mjs, CONTRACTS-V3 36.4): at most
// once a minute, and never allowed to fail the list.
import { storeOf } from "../content/context.mjs";
import { plainDay } from "../content/plain-date.mjs";
import { isDraftId } from "../content/store.mjs";
import { closeFixTasks, fixLine, recordFixTask } from "../lib/draftfix.mjs";
import { capText } from "../lib/format.mjs";
import { commentsOf, descendants, goalsOf, loadIssues, needIds } from "../lib/goals.mjs";
import { versionOf } from "../lib/inbox.mjs";
import { refreshRecipeLog } from "../lib/recipes.mjs";
import { roundsOf } from "../lib/staged.mjs";
import { plainSummary } from "./goals.mjs";

const draftVersion = (d) => versionOf(d.title, d.channel, d.planned, d.body);

const KIND = { post: "post", newsletter: "newsletter" };

const NO_CHECK_READY = new Set(["in_review", "done"]);
const folderOf = (d) => String(d.sourcePath || "").split("/")[0];

// The goal folders (task identifiers) whose drafts may be shown: the task's newest check passed, or it has no
// check and is in review or done.
async function checkedFolders(ctx, folders) {
  const out = new Set();
  if (!folders.size) return out;
  const ids = ctx.ids();
  if (!ids?.companyId || !ids?.projectId) return out;
  const issues = await loadIssues(ctx, ids.companyId);
  const goals = goalsOf(issues, ids).filter((g) => folders.has(g.identifier));
  await Promise.all(goals.map(async (g) => {
    const lists = await Promise.all([g, ...descendants(issues, g.id)].map((i) => commentsOf(ctx, i.id)));
    const tree = lists.flat().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const newest = roundsOf(tree, ids.agents?.checker || null).at(-1);
    if (newest ? newest.outcome === "pass" : NO_CHECK_READY.has(g.status)) out.add(g.identifier);
  }));
  return out;
}

// What the owner reads of a draft: its words without the draft marking line, the repeated title or Markdown marks.
export function draftSummary(d) {
  const title = String(d.title || "").trim().toLowerCase();
  const lines = capText(d.body).replace(/\r/g, "").split("\n");
  let i = 0;
  for (; i < lines.length; i += 1) {
    const l = lines[i].replace(/^[#>*_\s]+|[*_\s]+$/g, "").trim();
    if (!l || /^draft\b.*not (published|sent)/i.test(l) || (title && l.toLowerCase() === title)) continue;
    break;
  }
  return plainSummary(lines.slice(i).join("\n"));
}

async function list(ctx) {
  const waiting = storeOf(ctx).sync().drafts.filter((d) => d.status === "draft");
  const ready = await checkedFolders(ctx, new Set(waiting.map(folderOf)));
  const items = waiting.filter((d) => ready.has(folderOf(d))).map((d) => {
    const text = draftSummary(d);
    return {
      id: `content:${d.id}`,
      source: "marketing",
      kind: "draft",
      title: `New ${KIND[d.channel]}: ${d.title}`,
      raisedBy: "Marketer",
      when: d.createdAt,
      version: draftVersion(d),
      summary: text ? (text.length > 280 ? `${text.slice(0, 279)}…` : text) : "The draft has no text yet.",
      severity: "normal",
      details: [
        { label: "Kind", value: d.channel === "post" ? "Post" : "Newsletter" },
        { label: "Planned for", value: plainDay(d.planned) },
        { label: "Publishing", value: "Off. Approving does not publish anything." },
      ],
      actions: [
        { id: "approve", label: "Approve", style: "primary", needsNote: false },
        { id: "send_back", label: "Send back", style: "plain", needsNote: true },
      ],
      link: { page: "marketing", id: d.id },
    };
  });
  try { await refreshRecipeLog(ctx); } catch { /* the recipe log never fails the inbox */ }
  return { items };
}

async function act(ctx, itemId, action, note) {
  const id = String(itemId).slice("content:".length);
  const store = storeOf(ctx);
  store.sync();
  const d = isDraftId(id) ? store.read(id) : null;
  if (!d) throw ctx.fail(404, "That draft is not there any more.", "Refresh the inbox.", "draft_not_found");
  if (d.status !== "draft") throw ctx.fail(409, "That draft was already handled.", "Refresh the inbox.", "already_handled");
  if (draftVersion(d) !== ctx.item?.version) {
    throw ctx.fail(409, "This changed after you looked at it. Nothing was done.", "Look at it again, then decide.", "changed_since_seen");
  }
  if (action === "approve") {
    store.decide(id, "approved");
    await closeFixTasks(ctx, itemId);
    return { message: "Approved. Nothing is published: publishing stays off until you connect an account." };
  }
  if (action === "send_back") {
    const ids = needIds(ctx);
    const marketer = ids.agents?.marketer;
    if (!marketer) throw ctx.fail(409, "The Marketer is not set up yet.", "Open Health to see how to set up the engine.", "not_set_up");
    const where = d.sourcePath.split("/");
    // An earlier fix task for this draft is replaced by this one (best effort; never fails the send-back).
    await closeFixTasks(ctx, itemId);
    // Board first: when it is off, the draft stays as it was and the owner can simply try again.
    const created = await ctx.board.post(`/api/companies/${encodeURIComponent(ids.companyId)}/issues`, {
      title: `Fix content draft: ${d.title}`.slice(0, 200),
      description: `The owner sent this draft back.\n\nWhat to change: ${note}\n\nThe draft is the file content/${where[2]} in the goal folder ${where[0]} (inside your current working folder). Edit it there.\n\n${fixLine(itemId)}`,
      assigneeAgentId: marketer, projectId: ids.projectId, status: "todo", priority: "medium",
    });
    recordFixTask(ctx, itemId, created);
    store.decide(id, "sent_back", note);
    return { message: "Sent back to the Marketer with your note." };
  }
  throw ctx.fail(400, "That action is not offered for this item.", "Refresh the inbox and pick one of the buttons shown.", "bad_action");
}

export default { id: "content", list, act };
