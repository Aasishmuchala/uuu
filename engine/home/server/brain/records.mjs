// Records from the books for the brain's index, under the trust rule (PLAN-BRAIN B3).
//
// Books text is not all the owner's: agents create customers, leads and deals, and a customer writes a ticket's
// subject. Every agent will read what is indexed here, so only these go in: submitted documents (the owner
// approved them) and records whose creator, last editor and every writer in the books' change history are the
// owner's own books user. Everything else gives numbers, dates and a status from a fixed list, or is left out.
// No free-text field, no email address, no ticket subject is ever asked for. An id is printed only when it is
// the books' own naming (a naming series, or the record's own trusted name).
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

// The books' change history (the Version doctype; `owner` is who wrote that version). An agent may change a
// Customer (the Bookkeeper) or an Employee (People), and a later save by the owner makes the record's owner and
// modified_by the owner's again, with the agent's words still in it (T18's finding 1). So every record whose
// name is printed is checked against its history: a version by anyone outside TRUSTED_WRITERS leaves it out.
// Project and Contact are asked for too, so a right given to an agent later is covered without a change here.
export const VERSIONED = ["Customer", "Project", "Contact", "Employee"];
export const VERSION_FIELDS = ["ref_doctype", "docname", "owner"];
export const MAX_VERSIONS = 5000;

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

// A Contact's id as the books name one: the full name, then "-" and its company or a trusted customer's id, then
// at most a "-<n>" the books add to keep names apart. Nothing but these trusted names is printed.
function contactIdOk(id, full, company, customers) {
  const base = id.replace(/-\d{1,4}$/, "");
  return [id, base].some((b) => {
    if (b === full) return true;
    if (!b.startsWith(`${full}-`)) return false;
    const rest = b.slice(full.length + 1);
    return rest !== "" && (rest === company || customers.has(rest));
  });
}

const alias = (name) => {
  const a = name.toLowerCase();
  return a.length >= 3 ? [a] : [];
};

// The history as { ok, tainted }: `tainted` holds "<doctype>\u0000<name>" of every record with a version written
// by someone outside TRUSTED_WRITERS. Not ok (nothing of VERSIONED is trusted) when it is not a list, when it is
// as long as the cap (it may have been cut short), or when any row is of another shape.
function historyOf(rows) {
  const tainted = new Set();
  if (!Array.isArray(rows) || rows.length >= MAX_VERSIONS) return { ok: false, tainted };
  for (const v of rows) {
    if (!v || typeof v !== "object" || typeof v.ref_doctype !== "string" || typeof v.docname !== "string") return { ok: false, tainted };
    if (!TRUSTED_WRITERS.includes(v.owner)) tainted.add(`${v.ref_doctype}\u0000${v.docname}`);
  }
  return { ok: true, tainted };
}

// recordsFrom({ [doctype]: rows, Version: history rows }, { today: "YYYY-MM-DD" }) -> { records, leftOut }. Pure.
// With no readable `Version` list, no record of VERSIONED is trusted.
export function recordsFrom(rowsByDoctype, { today } = {}) {
  const day = typeof today === "string" && DATE.test(today) ? today.slice(0, 10) : istNow().today;
  let leftOut = 0;
  const history = historyOf(rowsByDoctype?.Version);
  // The owner made it, last changed it and wrote every version of it.
  const trusted = (doctype, row) => TRUSTED_WRITERS.includes(row.owner) && TRUSTED_WRITERS.includes(row.modified_by)
    && (!VERSIONED.includes(doctype) || (history.ok && !history.tainted.has(`${doctype}\u0000${String(row.name)}`)));
  // The id as the books sent it, unchanged by cleaning (else it would not name the record).
  const asSent = (row, r) => r && (typeof row.name === "string" || typeof row.name === "number") && String(row.name) === r.name;

  // Trusted customers, by id. Their own customer_name is the only name printed for them anywhere.
  const customers = new Map();
  const byName = new Map();
  for (const row of rowsOf(rowsByDoctype, "Customer")) {
    const c = trusted("Customer", row) ? cleanRow(row, ["name", "customer_name"]) : null;
    // The id is printed only when it is the customer's own name or a naming series.
    const idFits = asSent(row, c) && (c.name === c.customer_name || idOk(c.name));
    if (!c || !c.name || !c.customer_name || !idFits || customers.has(c.name)) { leftOut += 1; continue; }
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
    const r = trusted("Project", row) ? cleanRow(row, ["name", "project_name", "customer", "status"]) : null;
    if (!r || !asSent(row, r) || !idOk(r.name) || !r.project_name) { leftOut += 1; continue; }
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
    const r = trusted("Contact", row) ? cleanRow(row, ["name", "first_name", "last_name", "company_name"]) : null;
    const full = r ? `${r.first_name} ${r.last_name}`.trim() : "";
    if (!r || !asSent(row, r) || !full || !contactIdOk(r.name, full, r.company_name, customers)) { leftOut += 1; continue; }
    const cust = r.company_name ? byName.get(r.company_name) || null : null;
    out.contacts.push(record("Contact", r.name, full, `Contact: ${full}${cust ? ` of ${cust.name}` : ""}.`, null,
      { type: "person", key: `person:${r.name}`, name: full, aliases: alias(full) },
      cust ? [{ type: "contact_of", toKey: cust.key }] : []));
  }

  for (const row of rowsOf(rowsByDoctype, "Employee")) {
    const r = trusted("Employee", row) ? cleanRow(row, ["name", "employee_name", "designation", "status"]) : null;
    if (r && r.status !== "Active") continue; // not on the staff now: not a trust question
    if (!r || !asSent(row, r) || !idOk(r.name) || !r.employee_name) { leftOut += 1; continue; }
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
  // The history: only versions by others than the owner are asked for, and recordsFrom checks each again. One that
  // cannot be read for any reason but the books being off is left null, and no record of VERSIONED is trusted.
  rows.Version = null;
  try {
    rows.Version = await listDocs(ctx, "Version", {
      fields: VERSION_FIELDS, filters: [["ref_doctype", "in", VERSIONED], ["owner", "not in", TRUSTED_WRITERS]],
      order_by: "modified desc", limit: MAX_VERSIONS,
    });
  } catch (e) {
    if (e instanceof HomeError && e.code === "bench_off") return { state: "off", records: [], leftOut: 0 };
  }
  return { state: "ok", ...recordsFrom(rows, { today: istNow().today }) };
}
