// CONTRACTS 9.6, the Customers page: leads and deals from the customer records.
import { money } from "../lib/format.mjs";
import { ageText, departmentPage, figure, istNow, listDocs, offSwitch, section } from "./_departments.mjs";

// Document and field names in the books. Change them here if the books name them differently.
const T = {
  lead: { doctype: "CRM Lead", fields: ["name", "lead_name", "organization", "status", "converted", "creation"] },
  deal: { doctype: "CRM Deal", fields: ["name", "organization", "status", "deal_value", "modified"] },
};
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
      section("deals", "Open deals", "No open deals.", [["name", "Name"], ["stage", "Stage"], ["value", "Value"]],
        deals.map((d) => ({ name: d.organization || d.name, stage: d.status, value: money(d.deal_value) }))),
    ],
  };
}

export default function register(app) {
  app.get("/api/departments/customers", (ctx) => departmentPage(ctx, DEF, build));
}
