// Inbox source "bench": drafts the agents made in the books, waiting for the owner (CONTRACTS 9.3).
//
// The owner's approval is the only thing that makes a draft final, so approve is strict:
//  - it only ever touches a document of a known draft type that is still a draft and was made by one of
//    the four agent users (never something the owner or anyone else made);
//  - it re-reads the document and refuses when it changed since the owner was shown it, or is no longer
//    a draft; the document submitted is the one just read (the books also refuse a stale copy);
//  - an approved support reply is only recorded: nothing is sent to anyone.
import {
  AGENT_BY_EMAIL, AGENTS, DRAFT_TYPES, decidedKey, inboxIdOf, isDraftReply, listDrafts, plainType, sentBackKey, stampToIso,
} from "../routes/_departments.mjs";

const act = (id, label, style, needsNote = false) => ({ id, label, style, needsNote });

// What the owner was shown, per home server: item id -> the document's `modified` stamp at the time of a
// plain inbox read. An action's own re-read of the list never updates it.
const shown = new WeakMap();
const shownFor = (config) => {
  if (!shown.has(config)) shown.set(config, new Map());
  return shown.get(config);
};

function describe(d) {
  const t = DRAFT_TYPES[d.doctype];
  const who = `The ${d.agent.name}`;
  const party = t.party(d.doc);
  const amount = t.amount(d.doc);
  if (d.doctype === "HD Ticket Comment") {
    return `${who} wrote a reply to request ${d.doc.reference_ticket}. Approving it records your approval; nothing is sent to the customer yet.`;
  }
  const about = [party && `for ${party}`, amount && `of ${amount}`].filter(Boolean).join(" ");
  return `${who} made a draft ${t.plain}${about ? ` ${about}` : ""}. It is not final until you approve it.`;
}

function toItem(d) {
  const t = DRAFT_TYPES[d.doctype];
  const title = d.doctype === "HD Ticket Comment" ? `Reply to request ${d.doc.reference_ticket}` : `Draft ${t.plain} ${d.name}`;
  const item = {
    id: d.id, source: t.source, kind: "draft", title, raisedBy: d.agent.name,
    when: stampToIso(d.modified) || new Date().toISOString(),
    summary: describe(d), severity: "normal",
    details: [...t.details(d.doc).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([label, value]) => ({ label, value: String(value) })),
      ...(d.doctype === "Leave Application" && d.doc.status ? [{ label: "Status", value: String(d.doc.status) }] : [])],
    actions: [
      act("approve", d.doctype === "HD Ticket Comment" ? "Approve the reply" : "Approve", "primary"),
      act("send_back", "Send back", "plain", true),
    ],
    link: { page: t.source === "books" ? "books" : t.source, id: d.name },
  };
  for (const [k, v] of [["_doctype", d.doctype], ["_name", d.name], ["_slug", d.agent.slug]]) {
    Object.defineProperty(item, k, { enumerable: false, value: v });
  }
  return item;
}

async function list(ctx) {
  if (!ctx.bench.installed()) {
    return { items: [], notConnected: { source: "books", reason: "Books is not installed on this Mac yet." } };
  }
  const drafts = await listDrafts(ctx);
  // A plain inbox read is what the owner sees; an action's re-read (its body names an action) is not.
  const looking = !(ctx.body && typeof ctx.body.action === "string");
  const memory = shownFor(ctx.config);
  if (looking) for (const d of drafts) memory.set(d.id, d.modified);
  return { items: drafts.map(toItem) };
}

const refuse = (ctx, status, message, next, code) => ctx.fail(status, message, next, code);

async function readDraft(ctx, doctype, name) {
  const out = await ctx.bench.get(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`);
  const doc = out?.data;
  if (!doc || typeof doc !== "object") throw refuse(ctx, 404, "That draft is no longer in the books.", "Refresh the inbox.", "not_found");
  if (!DRAFT_TYPES[doctype]) throw refuse(ctx, 400, "This kind of document cannot be approved here.", "Refresh the inbox.", "bad_action");
  if (!AGENT_BY_EMAIL.has(doc.owner)) {
    throw refuse(ctx, 409, "This was not made by one of your agents, so it cannot be approved here.", "Open it in the books yourself.", "not_agent_draft");
  }
  if (Number(doc.docstatus) !== 0) {
    throw refuse(ctx, 409, "This is no longer a draft, so there is nothing to approve.", "Refresh the inbox.", "not_a_draft");
  }
  return doc;
}

async function approve(ctx, doctype, name) {
  const doc = await readDraft(ctx, doctype, name);
  const id = inboxIdOf(doctype, name);
  const seen = shownFor(ctx.config).get(id);
  if (seen === undefined || seen !== doc.modified) {
    throw refuse(ctx, 409, "This changed after it was listed, or has not been shown to you yet, so it was not approved.",
      "Refresh the inbox, read it again, then approve.", "changed");
  }
  const label = plainType(doctype);
  if (doctype === "HD Ticket Comment") {
    if (!isDraftReply(doc.content)) throw refuse(ctx, 409, "This is not a draft reply.", "Refresh the inbox.", "not_a_draft");
    if (ctx.decisions.get(decidedKey(doctype, name))) throw refuse(ctx, 409, "This reply was already decided.", "Refresh the inbox.", "already_handled");
    ctx.decisions.set(decidedKey(doctype, name), new Date().toISOString());
    return { message: "Reply approved. Sending is switched off, so nothing was sent to the customer." };
  }
  const toSubmit = { ...doc, doctype };
  if (doctype === "Leave Application" && (!doc.status || doc.status === "Open")) toSubmit.status = "Approved";
  await ctx.bench.post("/api/method/frappe.client.submit", { doc: toSubmit });
  shownFor(ctx.config).delete(id);
  return { message: doctype === "Leave Application"
    ? `The ${label} for ${doc.employee_name || "this person"} is approved and final.`
    : `The ${label} ${name} is approved and final.` };
}

async function sendBack(ctx, doctype, name, note) {
  const ids = ctx.ids();
  const doc = await readDraft(ctx, doctype, name);
  const slug = AGENT_BY_EMAIL.get(doc.owner).slug;
  const agentId = ids?.agents?.[slug];
  if (!ids?.companyId || !ids?.projectId || !agentId) {
    throw refuse(ctx, 409, `The ${AGENTS[slug].name} is not set up yet, so this could not be sent back.`, "Run engine setup first.", "not_set_up");
  }
  const label = plainType(doctype);
  await ctx.bench.post("/api/method/frappe.desk.form.utils.add_comment", {
    reference_doctype: doctype, reference_name: name, content: note, comment_email: "Administrator", comment_by: "Administrator",
  });
  await ctx.board.post(`/api/companies/${encodeURIComponent(ids.companyId)}/issues`, {
    title: `Fix ${label} ${name}`,
    description: `${note}\n\nThis is about the draft ${label} ${name} in the books. Change the draft as asked and leave it as a draft.`,
    assigneeAgentId: agentId, projectId: ids.projectId, status: "todo", priority: "medium",
  });
  ctx.decisions.set(sentBackKey(doctype, name), doc.modified);
  return { message: `Sent back to the ${AGENTS[slug].name} with your note.` };
}

async function actOn(ctx, itemId, action, note) {
  const doctype = ctx.item._doctype;
  const name = ctx.item._name;
  if (inboxIdOf(doctype, name) !== itemId) throw refuse(ctx, 404, "This item is no longer waiting for you.", "Refresh the inbox.", "not_found");
  if (action === "approve") return approve(ctx, doctype, name);
  if (action === "send_back") return sendBack(ctx, doctype, name, note);
  throw refuse(ctx, 400, "That action is not offered for this item.", "Refresh the inbox and pick one of the buttons shown.", "bad_action");
}

export default { id: "bench", list, act: actOn };
