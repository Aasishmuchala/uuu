import { test } from "node:test";
import assert from "node:assert/strict";

const { splitSections, itemFor, statusChip, dayOf, dueStatus, withStatus, jobsToStart, DEPARTMENTS, waitingItems } =
  await import("../../pages/dashboard.js");

const page = { sections: [
  { id: "drafts", rows: [{ name: "A", inboxId: "x" }] },
  { id: "lead_stages", rows: [{ stage: "New", count: 2 }] },
  { id: "leads", rows: [] },
  { id: "draft_replies", rows: [] },
] };

// Carried from the old department page's test (rule 13).
test("splitSections separates drafts, lead stages and tables", () => {
  const s = splitSections(page);
  assert.deepEqual(s.drafts.map((x) => x.id), ["drafts", "draft_replies"]);
  assert.equal(s.stages.id, "lead_stages");
  assert.deepEqual(s.tables.map((x) => x.id), ["leads"]);
  assert.deepEqual(splitSections(null), { drafts: [], stages: null, tables: [] });
});

test("itemFor finds the inbox item or returns null", () => {
  const inbox = { items: [{ id: "x", title: "T" }] };
  assert.equal(itemFor({ inboxId: "x" }, inbox).title, "T");
  assert.equal(itemFor({ inboxId: "y" }, inbox), null);
  assert.equal(itemFor({ name: "n" }, inbox), null);
  assert.equal(itemFor({ inboxId: "x" }, [{ id: "x" }]).id, "x");
  assert.equal(itemFor({ inboxId: "x" }, null), null);
});

test("Books keeps its quotations as a table of their own", () => {
  const books = { sections: [
    { id: "drafts", rows: [] },
    { id: "quotations", rows: [{ name: "SAL-QTN-2026-00001", status: "Draft" }] },
    { id: "unpaid_invoices", rows: [] },
  ] };
  assert.deepEqual(splitSections(books).tables.map((s) => s.id), ["quotations", "unpaid_invoices"]);
});

test("statusChip: the money words", () => {
  assert.deepEqual(statusChip("Draft"), { label: "Draft", tone: "off" });
  assert.deepEqual(statusChip("Unpaid"), { label: "Unpaid", tone: "warn" });
  assert.deepEqual(statusChip("Overdue by 12 days"), { label: "Overdue by 12 days", tone: "bad" });
  assert.deepEqual(statusChip("overdue 38d"), { label: "overdue 38d", tone: "bad" });
  assert.deepEqual(statusChip("Paid"), { label: "Paid", tone: "ok" });
  assert.deepEqual(statusChip("Final"), { label: "Final", tone: "ok" });
});

test("statusChip: the lead, deal and request stages, leave and attendance", () => {
  for (const w of ["New", "Contacted", "Qualified", "Qualification", "Negotiation"]) assert.equal(statusChip(w).tone, "sales", w);
  assert.equal(statusChip("Lost").tone, "bad");
  assert.equal(statusChip("Won").tone, "ok");
  assert.equal(statusChip("Converted").tone, "ok");
  assert.equal(statusChip("Open").tone, "warn");
  assert.equal(statusChip("Replied").tone, "off");
  assert.equal(statusChip("Resolved").tone, "ok");
  assert.equal(statusChip("Closed").tone, "ok");
  assert.equal(statusChip("Waiting for you").tone, "warn");
  assert.equal(statusChip("Approved").tone, "ok");
  assert.equal(statusChip("Rejected").tone, "bad");
  assert.equal(statusChip("Present").tone, "ok");
  assert.equal(statusChip("Absent").tone, "bad");
  assert.equal(statusChip("On Leave").tone, "off");
});

test("statusChip: unknown, empty and long words", () => {
  assert.deepEqual(statusChip("Something else"), { label: "Something else", tone: "off" });
  assert.equal(statusChip(""), null);
  assert.equal(statusChip("   "), null);
  assert.equal(statusChip(null), null);
  assert.equal(statusChip(undefined), null);
  assert.equal(statusChip("—"), null);
  assert.equal(statusChip("x".repeat(500)).label.length, 60);
  assert.equal(statusChip("  Paid\n ").label, "Paid");
});

test("dayOf reads the server's dates", () => {
  assert.equal(dayOf("11 Dec 2026"), dayOf("2026-12-11"));
  assert.equal(dayOf("1 Apr 2025") + 1, dayOf("2025-04-02"));
  assert.equal(dayOf("someday"), null);
  assert.equal(dayOf("11 Foo 2026"), null);
  assert.equal(dayOf(null), null);
});

test("dueStatus: Unpaid until the due date, then Overdue by n days", () => {
  const now = new Date(2026, 11, 20, 15, 0);
  assert.equal(dueStatus("11 Dec 2026", now), "Overdue by 9 days");
  assert.equal(dueStatus("19 Dec 2026", now), "Overdue by 1 day");
  assert.equal(dueStatus("20 Dec 2026", now), "Unpaid");
  assert.equal(dueStatus("2027-01-05", now), "Unpaid");
  assert.equal(dueStatus("", now), "Unpaid");
});

test("withStatus adds a Status column to the unpaid sections only", () => {
  const now = new Date(2026, 11, 20);
  const s = withStatus({ id: "unpaid_invoices", columns: [{ key: "name", label: "Number" }, { key: "due", label: "Due" }],
    rows: [{ name: "A", due: "11 Dec 2026" }, { name: "B", due: "30 Dec 2026" }] }, now);
  assert.deepEqual(s.columns.map((c) => c.label), ["Number", "Due", "Status"]);
  assert.deepEqual(s.rows.map((r) => r._status), ["Overdue by 9 days", "Unpaid"]);
  const bills = withStatus({ id: "unpaid_bills", columns: [], rows: [{ due: "1 Jan 2027" }] }, now);
  assert.equal(bills.rows[0]._status, "Unpaid");
  const leads = { id: "leads", columns: [{ key: "stage", label: "Stage" }], rows: [] };
  assert.equal(withStatus(leads, now), leads);
  const has = { id: "unpaid_invoices", columns: [{ key: "status", label: "Status" }], rows: [] };
  assert.equal(withStatus(has, now), has);
  assert.equal(withStatus(null, now), null);
});

test("jobsToStart puts ready jobs first and keeps three", () => {
  const map = { clusters: [
    { id: "a", jobs: [{ id: "books/one", ready: false }, { id: "books/two", ready: true }] },
    { id: "b", jobs: [{ id: "books/three", ready: true }, { id: "books/four", ready: true }] },
    { id: "c" },
  ] };
  assert.deepEqual(jobsToStart(map).map((j) => j.id), ["books/two", "books/three", "books/four"]);
  assert.deepEqual(jobsToStart(map, 5).map((j) => j.id), ["books/two", "books/three", "books/four", "books/one"]);
  assert.deepEqual(jobsToStart(null), []);
});

test("each record dashboard belongs to its department", () => {
  assert.deepEqual(DEPARTMENTS, { books: "books", customers: "sales", support: "support", people: "people" });
});

test("the page serves the four dashboards from route.parts[1] and links to its department", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../pages/dashboard.js", import.meta.url), "utf8");
  assert.match(src, /route\?\.parts\?\.\[1\]/);
  assert.match(src, /All dashboards/);
  assert.match(src, /Open the department/);
  assert.match(src, /#\/departments\/\$\{dept\}/);
});

test("waitingItems: a non-draft row that waits in Needs you can be acted on in place (M51 F5)", () => {
  const leave = { id: "leave", title: "Leave", columns: [{ key: "name", label: "Name" }], rows: [
    { name: "Priya Nair", status: "Waiting for you", inboxId: "bench:Leave Application:HR-LAP-2026-00001" },
    { name: "Asha Rao", status: "Approved" },
    { name: "Gone", inboxId: "bench:Leave Application:HR-LAP-2026-00009" },
  ] };
  const inbox = { items: [{ id: "bench:Leave Application:HR-LAP-2026-00001", title: "Leave for Priya Nair" }] };
  assert.deepEqual(waitingItems(leave, inbox).map((i) => i.id), ["bench:Leave Application:HR-LAP-2026-00001"]);
  assert.deepEqual(waitingItems(leave, null), []);
  assert.deepEqual(waitingItems(null, inbox), []);
});

test("a ledger's amounts: the unit apart from the figure, failed rows struck, money in coloured (R07)", async () => {
  const { moneyParts, rowFailed, rowCameIn, figureTone, MONEY_IN } = await import("../../pages/dashboard.js");
  assert.deepEqual(moneyParts("₹ 1,18,000.00"), { sign: "", unit: "₹", figure: "1,18,000.00" });
  assert.deepEqual(moneyParts("-$213.11"), { sign: "−", unit: "$", figure: "213.11" });
  assert.deepEqual(moneyParts("Rs. 500"), { sign: "", unit: "Rs.", figure: "500" });
  assert.equal(moneyParts("4"), null);
  assert.equal(moneyParts("14 Dec 2026"), null);
  assert.equal(moneyParts(null), null);
  assert.equal(rowFailed({ status: "Failed" }), true);
  assert.equal(rowFailed({ status: "Cancelled" }), true);
  assert.equal(rowFailed({ status: "Unpaid" }), false);
  assert.equal(rowCameIn({ status: "Paid" }), true);
  assert.equal(rowCameIn({ _status: "Unpaid" }), false);
  assert.equal(figureTone({ id: "owed_to_you" }), "plain");
  assert.equal(figureTone({ id: MONEY_IN[0] }), "in");
  assert.equal(figureTone({ id: "money_in", failed: true }), "failed");
  assert.equal(figureTone(null), "plain");
});

test("the filters: read from the address, written back, and applied to the tables", async () => {
  const { filtersOf, dashboardAddress, statusChoices, filterTables } = await import("../../pages/dashboard.js");
  assert.deepEqual(filtersOf(new URLSearchParams("s=quotations&st=Draft")), { s: "quotations", st: "draft" });
  assert.deepEqual(filtersOf(undefined), { s: "", st: "" });
  assert.equal(dashboardAddress("books", {}), "#/dashboards/books");
  assert.equal(dashboardAddress("books", { s: "quotations", st: "draft" }), "#/dashboards/books?s=quotations&st=draft");
  const tables = [
    { id: "quotations", columns: [{ key: "status" }], rows: [{ status: "Draft" }, { status: "Final" }, { status: "Draft" }] },
    { id: "unpaid_invoices", columns: [{ key: "_status" }], rows: [{ _status: "Overdue by 2 days" }] },
    { id: "staff", columns: [{ key: "name" }], rows: [{ name: "A" }] },
  ];
  assert.deepEqual(statusChoices(tables), [
    { value: "draft", label: "Draft" }, { value: "final", label: "Final" }, { value: "overdue by 2 days", label: "Overdue by 2 days" },
  ]);
  assert.deepEqual(filterTables(tables, {}).map((t) => t.id), ["quotations", "unpaid_invoices", "staff"]);
  assert.deepEqual(filterTables(tables, { s: "staff" }).map((t) => t.id), ["staff"]);
  const draft = filterTables(tables, { st: "draft" });
  assert.deepEqual(draft.map((t) => [t.id, t.rows.length]), [["quotations", 2], ["unpaid_invoices", 0]]);
});

test("the record dashboard: agents at the top right, filters as menus, drafts as rows into Needs you", async () => {
  const { readFileSync } = await import("node:fs");
  const { DASHBOARD_WORDS } = await import("../../pages/dashboard.js");
  const src = readFileSync(new URL("../../pages/dashboard.js", import.meta.url), "utf8");
  assert.match(src, /openNeeds\(\{ department: dept \}\)/);
  assert.match(src, /<\$\{Menu\} /);
  assert.match(src, /<\$\{DataTable\} /);
  assert.match(src, /<\$\{NotConnected\} reason=\$\{d\.notConnected\?\.reason\}/);
  assert.doesNotMatch(src, /DecisionCard|Creature|over=/);
  assert.equal(DASHBOARD_WORDS.queue, "Open in Needs you");
  assert.equal(DASHBOARD_WORDS.waitsMany(3), "3 rows here wait for you.");
  const css = readFileSync(new URL("../../styles/pages/dashboard.css", import.meta.url), "utf8");
  assert.match(css, /font-variant-numeric: tabular-nums/);
  assert.doesNotMatch(css, /--dept\b|--glass|--warn-text/);
});
