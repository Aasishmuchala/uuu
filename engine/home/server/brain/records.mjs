// Records from the books for the brain's index, under the trust rule (PLAN-BRAIN B3).
//
// Books text is not all the owner's: agents create customers, leads and deals, and a customer writes a ticket's
// subject. Every agent will read what is indexed here, so only these go in: submitted documents (the owner
// approved them) and records whose creator and last editor are the owner's own books user. Everything else
// gives numbers, dates and a status from a fixed list, or is left out. No free-text field, no email address,
// no ticket subject is ever asked for.
//
// pullRecords(ctx) reads with listDocs (the owner's key through ctx.bench) and calls the pure recordsFrom.
import { HomeError } from "../lib/errors.mjs";
import { money } from "../lib/format.mjs";
import { istNow, listDocs, stampToIso } from "../routes/_departments.mjs";

export const TRUSTED_WRITERS = ["Administrator"];
export const MAX_ROWS = 2000;
export const MAX_STRING = 80;

// The fields asked for, per doctype, and nothing else (B3).
export const FIELDS = {
  Customer: ["name", "customer_name", "owner", "modified_by", "modified"],
  "Sales Invoice": ["name", "customer", "posting_date", "due_date", "grand_total", "outstanding_amount", "docstatus", "modified"],
  "CRM Deal": ["name", "organization", "status", "deal_value", "owner", "modified_by", "modified"],
  Project: ["name", "project_name", "customer", "status", "owner", "modified_by", "modified"],
  "HD Ticket": ["name", "customer", "status", "opening_date", "modified"],
  Contact: ["name", "first_name", "last_name", "company_name", "owner", "modified_by"],
  Employee: ["name", "employee_name", "designation", "status", "owner", "modified_by"],
};
export const DOCTYPES = Object.keys(FIELDS);

// Only submitted invoices are asked for; the rest are filtered again below.
const FILTERS = { "Sales Invoice": [["docstatus", "=", 1]] };

export const STATUSES = {
  "CRM Deal": ["Qualification", "Demo/Making", "Proposal/Quotation", "Negotiation", "Ready to Close", "Won", "Lost"],
  "HD Ticket": ["Open", "Replied", "Resolved", "Closed", "Paused"],
  Project: ["Open", "Completed", "Cancelled"],
};

const ID_PATTERNS = [/^[A-Z][A-Z-]{1,12}-(\d{4}-)?\d{1,8}$/, /^\d{1,10}$/];
const DATE = /^\d{4}-\d{2}-\d{2}/;
const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/;
const REFUSED = /[<>`]/;

// A refused string: the record that holds it is left out.
const BAD = Symbol("refused");

// One string from the books: one line, control and format characters removed, runs of spaces squeezed, at most
// 80 characters. A line break, `<`, `>` or a backtick refuses it. null and undefined are "".
export function cleanString(v) {
  if (v === null || v === undefined) return "";
  if (typeof v !== "string" && typeof v !== "number") return BAD;
  let s = String(v);
  if (LINE_BREAK.test(s)) return BAD;
  s = s.replace(/\t/g, " ").replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();
  s = [...s].slice(0, MAX_STRING).join("").trim();
  if (REFUSED.test(s) || LINE_BREAK.test(s)) return BAD;
  return s;
}

const trusted = (row) => TRUSTED_WRITERS.includes(row.owner) && TRUSTED_WRITERS.includes(row.modified_by);
const idOk = (id) => ID_PATTERNS.some((re) => re.test(id));
const dateOf = (v) => (typeof v === "string" && DATE.test(v) ? v.slice(0, 10) : "");
const statusOf = (doctype, s) => (STATUSES[doctype].includes(s) ? s : "Other");
const atOf = (row) => stampToIso(row.modified);
const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const rowsOf = (rowsByDoctype, dt) => (Array.isArray(rowsByDoctype?.[dt]) ? rowsByDoctype[dt] : [])
  .filter((r) => r && typeof r === "object" && !Array.isArray(r));

// Clean the named fields of a row; null when any is refused.
function cleanRow(row, keys) {
  const out = {};
  for (const k of keys) {
    const v = cleanString(row[k]);
    if (v === BAD) return null;
    out[k] = v;
  }
  return out;
}

const alias = (name) => {
  const a = name.toLowerCase();
  return a.length >= 3 ? [a] : [];
};

// recordsFrom({ [doctype]: rows }, { today: "YYYY-MM-DD" }) -> { records, leftOut }. Pure.
export function recordsFrom(rowsByDoctype, { today } = {}) {
  const day = typeof today === "string" && DATE.test(today) ? today.slice(0, 10) : istNow().today;
  let leftOut = 0;

  // Trusted customers, by id. Their own customer_name is the only name printed for them anywhere.
  const customers = new Map();
  const byName = new Map();
  for (const row of rowsOf(rowsByDoctype, "Customer")) {
    const c = trusted(row) ? cleanRow(row, ["name", "customer_name"]) : null;
    if (!c || !c.name || !c.customer_name || customers.has(c.name)) { leftOut += 1; continue; }
    const cust = { id: c.name, name: c.customer_name, key: `customer:${c.name}`, at: atOf(row), invoices: 0, billed: 0, unpaid: 0, deals: 0 };
    customers.set(c.name, cust);
    if (!byName.has(c.customer_name)) byName.set(c.customer_name, cust);
  }
  // A link field names a customer by id.
  const linked = (v) => (v ? customers.get(v) || null : null);

  const out = { invoices: [], deals: [], projects: [], tickets: [], contacts: [], staff: [] };
  const record = (doctype, id, title, text, at, entity, links) => ({
    doctype, id, passage: { source: `books:${doctype}:${id}`, title, text, at: at || null }, entity, links,
  });

  for (const row of rowsOf(rowsByDoctype, "Sales Invoice")) {
    if (Number(row.docstatus) !== 1) continue;
    const r = cleanRow(row, ["name", "customer"]);
    const cust = r && idOk(r.name) ? linked(r.customer) : null;
    if (!cust) { leftOut += 1; continue; }
    const total = num(row.grand_total), left = num(row.outstanding_amount);
    const due = dateOf(row.due_date);
    const status = left === 0 ? "Paid" : left > 0 && due && due < day ? "Overdue" : "Unpaid";
    const date = dateOf(row.posting_date);
    cust.invoices += 1; cust.billed = round2(cust.billed + total); cust.unpaid = round2(cust.unpaid + left);
    out.invoices.push(record("Sales Invoice", r.name, `Invoice ${r.name}`,
      `Invoice ${r.name} for ${cust.name}.${date ? ` Date: ${date}.` : ""} Total: ${money(total)}. Unpaid: ${money(left)}. Status: ${status}.`,
      atOf(row), { type: "invoice", key: `invoice:${r.name}`, name: r.name, aliases: [] },
      [{ type: "invoice_of", toKey: cust.key }]));
  }

  for (const row of rowsOf(rowsByDoctype, "CRM Deal")) {
    const r = cleanRow(row, ["name", "organization", "status"]);
    if (!r || !idOk(r.name)) { leftOut += 1; continue; }
    const cust = r.organization ? byName.get(r.organization) || null : null;
    const tail = `Stage: ${statusOf("CRM Deal", r.status)}. Value: ${money(num(row.deal_value))}.`;
    if (cust) {
      cust.deals += 1;
      out.deals.push(record("CRM Deal", r.name, `Deal ${r.name}`, `Deal ${r.name} with ${cust.name}. ${tail}`, atOf(row),
        { type: "deal", key: `deal:${r.name}`, name: r.name, aliases: [] }, [{ type: "deal_of", toKey: cust.key }]));
    } else {
      out.deals.push(record("CRM Deal", r.name, `Deal ${r.name}`, `Deal ${r.name}. ${tail}`, atOf(row), null, []));
    }
  }

  for (const row of rowsOf(rowsByDoctype, "Project")) {
    const r = trusted(row) ? cleanRow(row, ["name", "project_name", "customer", "status"]) : null;
    if (!r || !r.name || !r.project_name) { leftOut += 1; continue; }
    const cust = linked(r.customer);
    const text = `Project: ${r.project_name}${cust ? ` for ${cust.name}` : ""}. Status: ${statusOf("Project", r.status)}.`;
    out.projects.push(record("Project", r.name, r.project_name, text, atOf(row),
      cust ? { type: "project", key: `project:${r.name}`, name: r.project_name, aliases: [] } : null,
      cust ? [{ type: "project_of", toKey: cust.key }] : []));
  }

  for (const row of rowsOf(rowsByDoctype, "HD Ticket")) {
    const r = cleanRow(row, ["name", "customer", "status"]);
    if (!r || !idOk(r.name)) { leftOut += 1; continue; }
    const cust = linked(r.customer);
    const opened = dateOf(row.opening_date);
    const text = `Support request ${r.name}${cust ? ` from ${cust.name}` : ""}. Status: ${statusOf("HD Ticket", r.status)}.${opened ? ` Opened: ${opened}.` : ""}`;
    out.tickets.push(record("HD Ticket", r.name, `Support request ${r.name}`, text, atOf(row),
      cust ? { type: "ticket", key: `ticket:${r.name}`, name: `Support request ${r.name}`, aliases: [] } : null,
      cust ? [{ type: "ticket_of", toKey: cust.key }] : []));
  }

  for (const row of rowsOf(rowsByDoctype, "Contact")) {
    const r = trusted(row) ? cleanRow(row, ["name", "first_name", "last_name", "company_name"]) : null;
    const full = r ? `${r.first_name} ${r.last_name}`.trim() : "";
    if (!r || !r.name || !full) { leftOut += 1; continue; }
    const cust = r.company_name ? byName.get(r.company_name) || null : null;
    out.contacts.push(record("Contact", r.name, full, `Contact: ${full}${cust ? ` of ${cust.name}` : ""}.`, null,
      { type: "person", key: `person:${r.name}`, name: full, aliases: alias(full) },
      cust ? [{ type: "contact_of", toKey: cust.key }] : []));
  }

  for (const row of rowsOf(rowsByDoctype, "Employee")) {
    const r = trusted(row) ? cleanRow(row, ["name", "employee_name", "designation", "status"]) : null;
    if (r && r.status !== "Active") continue; // not on the staff now: not a trust question
    if (!r || !r.name || !r.employee_name) { leftOut += 1; continue; }
    out.staff.push(record("Employee", r.name, r.employee_name,
      `Staff: ${r.employee_name}${r.designation ? `, ${r.designation}` : ""}.`, null,
      { type: "person", key: `person:${r.name}`, name: r.employee_name, aliases: alias(r.employee_name) }, []));
  }

  const custRecords = [...customers.values()].map((c) => record("Customer", c.id, c.name,
    `Customer: ${c.name}. Invoices: ${c.invoices}. Billed: ${money(c.billed)}. Unpaid: ${money(c.unpaid)}. Deals: ${c.deals}.`,
    c.at, { type: "customer", key: c.key, name: c.name, aliases: alias(c.name) }, []));

  return {
    records: [...custRecords, ...out.invoices, ...out.deals, ...out.projects, ...out.tickets, ...out.contacts, ...out.staff],
    leftOut,
  };
}

const notThere = (e) => e instanceof HomeError && (e.upstreamStatus === 404 || e.excType === "DoesNotExistError");

// pullRecords(ctx) -> { state: "ok"|"off"|"not_installed", records, leftOut }. A doctype the books do not have
// is skipped. Any other error from the books than "switched off" is thrown to the caller.
export async function pullRecords(ctx) {
  if (!ctx.bench.installed()) return { state: "not_installed", records: [], leftOut: 0 };
  const rows = {};
  for (const dt of DOCTYPES) {
    try {
      rows[dt] = await listDocs(ctx, dt, { fields: FIELDS[dt], filters: FILTERS[dt], order_by: "modified desc", limit: MAX_ROWS });
    } catch (e) {
      if (e instanceof HomeError && e.code === "bench_off") return { state: "off", records: [], leftOut: 0 };
      if (notThere(e)) continue;
      throw e;
    }
  }
  return { state: "ok", ...recordsFrom(rows, { today: istNow().today }) };
}
