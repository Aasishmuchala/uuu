// Inbox source "content": drafts the Marketer made, waiting for the owner (CONTRACTS 9.3, "content draft").
// Approving changes only the draft's status. Nothing is published, posted or sent.
import { storeOf } from "../content/context.mjs";
import { isDraftId } from "../content/store.mjs";
import { needIds } from "../lib/goals.mjs";

const KIND = { post: "post", newsletter: "newsletter" };

async function list(ctx) {
  const items = storeOf(ctx).sync().drafts.filter((d) => d.status === "draft").map((d) => {
    const text = d.body.replace(/\s+/g, " ").trim();
    return {
      id: `content:${d.id}`,
      source: "marketing",
      kind: "draft",
      title: `New ${KIND[d.channel]}: ${d.title}`,
      raisedBy: "Marketer",
      when: d.createdAt,
      summary: text ? (text.length > 280 ? `${text.slice(0, 279)}…` : text) : "The draft has no text yet.",
      severity: "normal",
      details: [
        { label: "Kind", value: d.channel === "post" ? "Post" : "Newsletter" },
        { label: "Planned for", value: d.planned },
        { label: "Publishing", value: "Off. Approving does not publish anything." },
      ],
      actions: [
        { id: "approve", label: "Approve", style: "primary", needsNote: false },
        { id: "send_back", label: "Send back", style: "plain", needsNote: true },
      ],
      link: { page: "marketing", id: d.id },
    };
  });
  return { items };
}

async function act(ctx, itemId, action, note) {
  const id = String(itemId).slice("content:".length);
  const store = storeOf(ctx);
  store.sync();
  const d = isDraftId(id) ? store.read(id) : null;
  if (!d) throw ctx.fail(404, "That draft is not there any more.", "Refresh the inbox.", "draft_not_found");
  if (d.status !== "draft") throw ctx.fail(409, "That draft was already handled.", "Refresh the inbox.", "already_handled");
  if (action === "approve") {
    store.decide(id, "approved");
    return { message: "Approved. Nothing is published: publishing stays off until you connect an account." };
  }
  if (action === "send_back") {
    const ids = needIds(ctx);
    const marketer = ids.agents?.marketer;
    if (!marketer) throw ctx.fail(409, "The Marketer is not set up yet.", "Run engine setup first.", "not_set_up");
    const where = d.sourcePath.split("/");
    // Board first: when it is off, the draft stays as it was and the owner can simply try again.
    await ctx.board.post(`/api/companies/${encodeURIComponent(ids.companyId)}/issues`, {
      title: `Fix content draft: ${d.title}`.slice(0, 200),
      description: `The owner sent this draft back.\n\nWhat to change: ${note}\n\nThe draft is the file content/${where[2]} in the goal folder ${where[0]} (inside your current working folder). Edit it there.`,
      assigneeAgentId: marketer, projectId: ids.projectId, status: "todo", priority: "medium",
    });
    store.decide(id, "sent_back", note);
    return { message: "Sent back to the Marketer with your note." };
  }
  throw ctx.fail(400, "That action is not offered for this item.", "Refresh the inbox and pick one of the buttons shown.", "bad_action");
}

export default { id: "content", list, act };
