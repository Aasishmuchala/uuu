// CONTRACTS 9.6, the Support page: open customer requests and reply drafts waiting for you.
import { ageText, departmentPage, figure, inboxIdOf, listDocs, listDrafts, offSwitch, plainText, section, REPLY_MARK } from "./_departments.mjs";

// Document and field names in the books. Change them here if the books name them differently.
const T = {
  ticket: { doctype: "HD Ticket", fields: ["name", "subject", "raised_by", "status", "creation"] },
  comment: { doctype: "HD Ticket Comment", fields: ["name", "reference_ticket", "content", "commented_by", "creation"] },
};
const CLOSED = ["Closed", "Resolved"];
const DEF = {
  id: "support", title: "Support", agentSlug: "support", agentName: "Support", mainDoctype: T.ticket.doctype,
  switches: [offSwitch("email", "Send replies to customers by email")],
};

async function build(ctx) {
  const [open, drafts] = await Promise.all([
    listDocs(ctx, T.ticket.doctype, { fields: T.ticket.fields, filters: [["status", "not in", CLOSED]], order_by: "creation asc" }),
    listDrafts(ctx, "support"),
  ]);
  const wanted = [...new Set(drafts.map((d) => String(d.doc.reference_ticket)))];
  const known = new Map(open.map((t) => [String(t.name), t.subject]));
  const missing = wanted.filter((n) => !known.has(n));
  if (missing.length) {
    for (const t of await listDocs(ctx, T.ticket.doctype, { fields: ["name", "subject"], filters: [["name", "in", missing]] })) known.set(String(t.name), t.subject);
  }
  return {
    figures: [
      figure("open", "Open requests", String(open.length)),
      figure("oldest", "Oldest waiting", open.length ? ageText(open[0].creation) : "None waiting"),
      figure("drafts", "Replies waiting for you", String(drafts.length)),
    ],
    sections: [
      section("open_requests", "Open requests", "No customer is waiting.",
        [["subject", "Subject"], ["from", "From"], ["status", "Status"], ["age", "Age"]],
        open.map((t) => ({ subject: t.subject, from: t.raised_by || "", status: t.status, age: ageText(t.creation) }))),
      section("draft_replies", "Replies waiting for you", "No replies waiting.", [["request", "Request"], ["reply", "Reply"]],
        drafts.map((d) => {
          const text = plainText(d.doc.content).slice(REPLY_MARK.length).trim();
          const subject = known.get(String(d.doc.reference_ticket));
          return {
            request: subject ? `#${d.doc.reference_ticket} ${subject}` : `#${d.doc.reference_ticket}`,
            reply: text.length > 140 ? `${text.slice(0, 139)}…` : text,
            inboxId: inboxIdOf(d.doctype, d.name),
          };
        })),
    ],
  };
}

export default function register(app) {
  app.get("/api/departments/support", (ctx) => departmentPage(ctx, DEF, build));
}
