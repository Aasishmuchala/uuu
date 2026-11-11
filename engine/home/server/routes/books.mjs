// CONTRACTS 9.6, the Books page: what you are owed and owe, drafts waiting for you, unpaid invoices and bills.
import { money } from "../lib/format.mjs";
import {
  dateText, departmentPage, figure, inboxIdOf, istNow, listDocs, listDrafts, offSwitch, plural, plainType, section, sum, DRAFT_TYPES,
} from "./_departments.mjs";

// Document and field names in the books. Change them here if the books name them differently.
const T = {
  salesInvoice: { doctype: "Sales Invoice", fields: ["name", "customer", "posting_date", "due_date", "grand_total", "outstanding_amount", "docstatus", "owner", "modified"] },
  purchaseInvoice: { doctype: "Purchase Invoice", fields: ["name", "supplier", "posting_date", "due_date", "grand_total", "outstanding_amount", "docstatus", "owner", "modified"] },
};
const SUBMITTED = ["docstatus", "=", 1];
const DEF = {
  id: "books", title: "Books", agentSlug: "bookkeeper", agentName: "Bookkeeper", mainDoctype: T.salesInvoice.doctype,
  switches: [offSwitch("einvoice", "Send e-invoices to the GST portal")],
};

async function build(ctx) {
  const { monthStart, nextMonthStart } = istNow();
  const month = [["posting_date", ">=", monthStart], ["posting_date", "<", nextMonthStart]];
  const unpaid = (t) => listDocs(ctx, t.doctype, {
    fields: t.fields, filters: [SUBMITTED, ["outstanding_amount", ">", 0]], order_by: "due_date asc",
  });
  const monthly = (t) => listDocs(ctx, t.doctype, { fields: t.fields, filters: [SUBMITTED, ...month] });
  const [owed, owe, soldNow, boughtNow, drafts] = await Promise.all([
    unpaid(T.salesInvoice), unpaid(T.purchaseInvoice), monthly(T.salesInvoice), monthly(T.purchaseInvoice), listDrafts(ctx, "books"),
  ]);
  const inbox = new Set(drafts.map((d) => d.id));
  const row = (d, partyKey) => ({
    name: d.name, party: d[partyKey], due: dateText(d.due_date), left: money(d.outstanding_amount),
  });
  return {
    figures: [
      figure("owed_to_you", "You are owed", money(sum(owed, "outstanding_amount")), plural(owed.length, "unpaid invoice")),
      figure("you_owe", "You owe", money(sum(owe, "outstanding_amount")), plural(owe.length, "unpaid bill")),
      figure("sales_month", "Sales this month", money(sum(soldNow, "grand_total")), plural(soldNow.length, "invoice")),
      figure("spend_month", "Spend this month", money(sum(boughtNow, "grand_total")), plural(boughtNow.length, "bill")),
    ],
    sections: [
      section("drafts", "Drafts waiting for you", "No drafts waiting.",
        [["name", "Number"], ["type", "Type"], ["party", "Party"], ["amount", "Amount"], ["madeBy", "Made by"]],
        drafts.map((d) => ({
          name: d.name, type: plainType(d.doctype), party: DRAFT_TYPES[d.doctype].party(d.doc), amount: DRAFT_TYPES[d.doctype].amount(d.doc), madeBy: d.agent.name,
          inboxId: inbox.has(d.id) ? inboxIdOf(d.doctype, d.name) : undefined,
        }))),
      section("unpaid_invoices", "Invoices not paid yet", "Nothing is waiting to be paid to you.",
        [["name", "Number"], ["party", "Customer"], ["due", "Due"], ["left", "Amount left"]],
        owed.map((d) => row(d, "customer"))),
      section("unpaid_bills", "Bills not paid yet", "You have no bills to pay.",
        [["name", "Number"], ["party", "Supplier"], ["due", "Due"], ["left", "Amount left"]],
        owe.map((d) => row(d, "supplier"))),
    ],
  };
}

export default function register(app) {
  app.get("/api/departments/books", (ctx) => departmentPage(ctx, DEF, build));
}
