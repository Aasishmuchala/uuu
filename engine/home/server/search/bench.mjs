// Search source "books": party names, lead names, ticket subjects and staff names (CONTRACTS 9.10).
// One group holds the four departments; each result's link says which page it opens.
import { HomeError } from "../lib/errors.mjs";
import { listDocs } from "../routes/_departments.mjs";

// Document and field names in the books. Change them here if the books name them differently.
const WHERE = [
  { doctype: "Customer", field: "customer_name", fields: ["name", "customer_name"], page: "books", what: "Customer" },
  { doctype: "Supplier", field: "supplier_name", fields: ["name", "supplier_name"], page: "books", what: "Supplier" },
  { doctype: "CRM Lead", field: "lead_name", fields: ["name", "lead_name", "organization", "status"], page: "customers", what: "Lead" },
  { doctype: "HD Ticket", field: "subject", fields: ["name", "subject", "raised_by", "status"], page: "support", what: "Support request" },
  { doctype: "Employee", field: "employee_name", fields: ["name", "employee_name", "designation"], page: "people", what: "Staff" },
];
const PER_PAGE = 8;

export default {
  id: "books",
  label: "Books, customers, support and people",
  async search(ctx, q) {
    if (!ctx.bench.installed()) return { notSearched: "Books is not installed on this Mac yet." };
    const words = q.toLowerCase().split(/\s+/).map((w) => w.replace(/[%_\\]/g, "")).filter(Boolean);
    if (!words.length) return [];
    const lists = await Promise.all(WHERE.map(async (w) => {
      let rows;
      try {
        rows = await listDocs(ctx, w.doctype, {
          fields: w.fields, filters: words.map((x) => [w.field, "like", `%${x}%`]), order_by: "modified desc", limit: PER_PAGE,
        });
      } catch (e) {
        if (e instanceof HomeError && (e.upstreamStatus === 404 || e.excType === "DoesNotExistError")) return [];
        throw e;
      }
      return rows.slice(0, PER_PAGE).map((r) => ({
        title: String(r[w.field] || r.name),
        snippet: [w.what, r.organization, r.designation, r.raised_by, r.status].filter(Boolean).join(", "),
        link: { page: w.page, id: String(r.name) },
      }));
    }));
    // Mix the pages so a long list from one does not push the others out of the eight kept.
    const out = [];
    for (let i = 0; i < PER_PAGE; i++) for (const l of lists) if (l[i]) out.push(l[i]);
    return out;
  },
};
