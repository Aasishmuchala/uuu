// CONTRACTS 9.6, the Customers page: leads and deals from the customer records.
import { HomeError } from "../lib/errors.mjs";
import { money } from "../lib/format.mjs";
import { ageText, departmentPage, figure, istNow, listDocs, offSwitch, plainText, plural, section } from "./_departments.mjs";

// Document and field names in the books. Change them here if the books name them differently.
const T = {
  lead: { doctype: "CRM Lead", fields: ["name", "lead_name", "organization", "status", "converted", "creation"] },
  deal: { doctype: "CRM Deal", fields: ["name", "organization", "status", "deal_value", "modified"] },
};
// Notes and follow-up tasks hang on a lead through reference_doctype / reference_docname.
const N = {
  note: { doctype: "FCRM Note", fields: ["name", "title", "content", "reference_docname", "creation"] },
  task: { doctype: "CRM Task", fields: ["name", "reference_docname", "status", "creation"] },
};
const NOTE_MAX = 120;

// The first line of a note (the books keep notes as HTML), plain, cut at about 120 characters.
export function noteLine(content, title = "") {
  const text = String(content || "").replace(/<br\s*\/?>|<\/(?:p|div|li|h\d)>/gi, "\n").replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  const line = text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).find(Boolean) || plainText(title);
  return line.length > NOTE_MAX ? `${line.slice(0, NOTE_MAX - 1).trimEnd()}…` : line;
}

// Per lead name: { notes, followUps, latest }. A failed read (no notes app, no right) means nothing to show.
async function leadNotes(ctx, names) {
  const out = new Map();
  if (!names.length) return out;
  const on = [["reference_doctype", "=", T.lead.doctype], ["reference_docname", "in", names]];
  const safe = (p) => p.catch((e) => { if (e instanceof HomeError) return []; throw e; });
  const [notes, tasks] = await Promise.all([
    safe(listDocs(ctx, N.note.doctype, { fields: N.note.fields, filters: on, order_by: "creation desc" })),
    safe(listDocs(ctx, N.task.doctype, { fields: N.task.fields, filters: [...on, ["status", "not in", ["Done", "Canceled", "Cancelled"]]] })),
  ]);
  const at = (n) => out.get(n) || out.set(n, { notes: 0, followUps: 0, latest: "" }).get(n);
  for (const n of notes) {
    const e = at(n.reference_docname);
    e.notes += 1;
    if (!e.latest) e.latest = noteLine(n.content, n.title);
  }
  for (const t of tasks) at(t.reference_docname).followUps += 1;
  return out;
}

const DEF = {
  id: "customers", title: "Customers", agentSlug: "sales", agentName: "Sales", mainDoctype: T.lead.doctype,
  switches: [offSwitch("email", "Send email to customers"), offSwitch("whatsapp", "Send WhatsApp messages")],
};

async function build(ctx) {
  const { monthStart, nextMonthStart } = istNow();
  const [leads, deals, won] = await Promise.all([
    listDocs(ctx, T.lead.doctype, { fields: T.lead.fields, filters: [["converted", "=", 0]], order_by: "creation desc" }),
    listDocs(ctx, T.deal.doctype, { fields: T.deal.fields, filters: [["status", "not in", ["Won", "Lost"]]], order_by: "modified desc" }),
    listDocs(ctx, T.deal.doctype, {
      fields: T.deal.fields, filters: [["status", "=", "Won"], ["modified", ">=", monthStart], ["modified", "<", nextMonthStart]],
    }),
  ]);
  const notes = await leadNotes(ctx, leads.map((l) => l.name));
  const noted = leads.filter((l) => notes.has(l.name));
  const stages = new Map();
  for (const l of leads) stages.set(l.status, (stages.get(l.status) || 0) + 1);
  return {
    figures: [
      figure("leads_open", "Open leads", String(leads.length)),
      figure("deals_open", "Open deals", String(deals.length)),
      figure("deals_won_month", "Deals won this month", String(won.length)),
    ],
    sections: [
      section("lead_stages", "Leads by stage", "No open leads.", [["stage", "Stage"], ["count", "How many"]],
        [...stages].map(([stage, count]) => ({ stage, count: String(count) }))),
      section("leads", "Open leads", "No open leads.",
        [["name", "Name"], ["organisation", "Organisation"], ["stage", "Stage"], ["age", "Age"]],
        leads.map((l) => ({ name: l.lead_name || l.name, organisation: l.organization || "", stage: l.status, age: ageText(l.creation) }))),
      // Only leads that have a note or a follow-up appear; with none, the section is left out.
      ...(noted.length ? [section("lead_notes", "Notes and follow-ups", "", [["name", "Lead"], ["follow_ups", "Follow-ups"], ["notes", "Notes"], ["latest", "Latest note"]],
        noted.map((l) => {
          const e = notes.get(l.name);
          return { name: l.lead_name || l.name, follow_ups: e.followUps ? plural(e.followUps, "open follow-up") : "", notes: e.notes ? plural(e.notes, "note") : "", latest: e.latest };
        }))] : []),
      section("deals", "Open deals", "No open deals.", [["name", "Name"], ["stage", "Stage"], ["value", "Value"]],
        deals.map((d) => ({ name: d.organization || d.name, stage: d.status, value: money(d.deal_value) }))),
    ],
  };
}

export default function register(app) {
  app.get("/api/departments/customers", (ctx) => departmentPage(ctx, DEF, build));
}
