// Inbox source "bench": drafts the agents made in the books, waiting for the owner (CONTRACTS 9.3).
//
// The owner's approval is the only thing that makes a draft final, so approve is strict:
//  - it only ever touches a document of a known draft type that is still a draft and was made by one of
//    the four agent users (never something the owner or anyone else made);
//  - every item carries `version`, the document's `modified` stamp; the inbox core refuses an action whose
//    version is not the one the owner's screen showed (CONTRACTS 9.3a), and approve re-reads the document
//    and refuses again when its stamp is not that version, or it is no longer a draft; the document
//    submitted is the one just read (the books also refuse a stale copy);
//  - an approved support reply is only recorded: nothing is sent to anyone.
import { closeFixTasks, fixLine, recordFixTask } from "../lib/draftfix.mjs";
import { HomeError } from "../lib/errors.mjs";
import {
  AGENT_BY_EMAIL, AGENTS, DRAFT_TYPES, decidedKey, inboxIdOf, isDraftReply, listDocs, listDrafts, plainType, sentBackKey, stampToIso,
} from "../routes/_departments.mjs";

const act = (id, label, style, needsNote = false) => ({ id, label, style, needsNote });

// Role names the company file gives with no article ("Support", "People", "Sales"). Every other role reads
// "the Builder" / "The Builder".
const NO_ARTICLE = new Set(["Support", "People", "Sales"]);
export function agentRef(name, { start = true } = {}) {
  if (NO_ARTICLE.has(name)) return name;
  return `${start ? "The" : "the"} ${name}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ymd = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };

// "Casual leave, 14 to 15 November"; the year only when it is not this year (or the two dates differ in year).
export function leaveText(type, from, to, thisYear = new Date().getFullYear()) {
  const a = ymd(from), b = ymd(to) || a;
  const kind = String(type || "").trim();
  let dates = "";
  if (a) {
    const yr = (x) => (x.y === thisYear && a.y === b.y ? "" : ` ${x.y}`);
    if (a.y === b.y && a.m === b.m && a.d === b.d) dates = `${a.d} ${MONTHS[a.m - 1]}${yr(a)}`;
    else if (a.y === b.y && a.m === b.m) dates = `${a.d} to ${b.d} ${MONTHS[a.m - 1]}${yr(a)}`;
    else dates = `${a.d} ${MONTHS[a.m - 1]}${a.y === b.y ? "" : ` ${a.y}`} to ${b.d} ${MONTHS[b.m - 1]}${yr(b)}`;
  }
  return [kind, dates].filter(Boolean).join(", ");
}

// What the owner reads when the books refuse an approval with a reason of their own.
export function refusalText(doctype, reason) {
  if (doctype === "Leave Application" && (!reason || /holiday/i.test(reason))) {
    return { message: "Making this leave final needs a holiday list in the books. The draft is kept.",
      next: "Add a holiday list for the company or the person in the books, then approve again." };
  }
  return { message: reason ? `The books did not accept this: ${reason}` : "The books did not accept this.",
    next: "The draft is kept. Fix what the books say, or send it back with a note." };
}

function describe(d) {
  const t = DRAFT_TYPES[d.doctype];
  const who = agentRef(d.agent.name);
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
    version: String(d.modified ?? ""),
    summary: describe(d), severity: "normal",
    details: [...t.details(d.doc).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([label, value]) => ({ label, value: String(value) })),
      ...(d.doctype === "Leave Application" && d.leaveType ? [{ label: "Leave", value: leaveText(d.leaveType, d.doc.from_date, d.doc.to_date) }] : [])],
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
  // The leave type is not among the fields the shared list asks for; one more read adds it.
  const leaves = drafts.filter((d) => d.doctype === "Leave Application");
  if (leaves.length) {
    try {
      const rows = await listDocs(ctx, "Leave Application", { fields: ["name", "leave_type"], filters: [["name", "in", leaves.map((d) => d.name)]], limit: 200 });
      const byName = new Map(rows.map((r) => [String(r.name), r.leave_type]));
      for (const d of leaves) d.leaveType = byName.get(d.name) || "";
    } catch (e) {
      if (!(e instanceof HomeError)) throw e;
    }
  }
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
  // The core already matched the owner's version against the list it re-read; the document may still have
  // changed between that list and this read.
  if (String(doc.modified ?? "") !== ctx.item.version) {
    throw refuse(ctx, 409, "This changed after you looked at it. Nothing was done.", "Look at it again, then decide.", "changed_since_seen");
  }
  const label = plainType(doctype);
  if (doctype === "HD Ticket Comment") {
    if (!isDraftReply(doc.content)) throw refuse(ctx, 409, "This is not a draft reply.", "Refresh the inbox.", "not_a_draft");
    if (ctx.decisions.get(decidedKey(doctype, name))) throw refuse(ctx, 409, "This reply was already decided.", "Refresh the inbox.", "already_handled");
    ctx.decisions.set(decidedKey(doctype, name), new Date().toISOString());
    await closeFixTasks(ctx, inboxIdOf(doctype, name));
    return { message: "Reply approved. Sending is switched off, so nothing was sent to the customer." };
  }
  const toSubmit = { ...doc, doctype };
  if (doctype === "Leave Application" && (!doc.status || doc.status === "Open")) toSubmit.status = "Approved";
  try {
    await ctx.bench.post("/api/method/frappe.client.submit", { doc: toSubmit });
  } catch (e) {
    if (e instanceof HomeError && e.code === "bench_invalid") {
      const r = refusalText(doctype, e.reason);
      throw refuse(ctx, 409, r.message, r.next, "bench_invalid");
    }
    throw e;
  }
  await closeFixTasks(ctx, inboxIdOf(doctype, name));
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
    throw refuse(ctx, 409, `${agentRef(AGENTS[slug].name)} is not set up yet, so this could not be sent back.`, "Run engine setup first.", "not_set_up");
  }
  const label = plainType(doctype);
  await closeFixTasks(ctx, inboxIdOf(doctype, name));
  await ctx.bench.post("/api/method/frappe.desk.form.utils.add_comment", {
    reference_doctype: doctype, reference_name: name, content: note, comment_email: "Administrator", comment_by: "Administrator",
  });
  const created = await ctx.board.post(`/api/companies/${encodeURIComponent(ids.companyId)}/issues`, {
    title: `Fix ${label} ${name}`,
    description: `${note}\n\nThis is about the draft ${label} ${name} in the books. Change the draft as asked and leave it as a draft.\n\n${fixLine(inboxIdOf(doctype, name))}`,
    assigneeAgentId: agentId, projectId: ids.projectId, status: "todo", priority: "medium",
  });
  recordFixTask(ctx, inboxIdOf(doctype, name), created);
  ctx.decisions.set(sentBackKey(doctype, name), doc.modified);
  return { message: `Sent back to ${agentRef(AGENTS[slug].name, { start: false })} with your note.` };
}

async function actOn(ctx, itemId, action, note) {
  const doctype = ctx.item._doctype;
  const name = ctx.item._name;
  if (inboxIdOf(doctype, name) !== itemId) throw refuse(ctx, 404, "This item is no longer waiting for you.", "Refresh the inbox.", "not_found");
  if (action === "approve") return approve(ctx, doctype, name);
  if (action === "send_back") return sendBack(ctx, doctype, name, note);
  throw refuse(ctx, 400, "That action is not offered for this item.", "Refresh the inbox and use one of the buttons on it.", "bad_action");
}

export default { id: "bench", list, act: actOn };
