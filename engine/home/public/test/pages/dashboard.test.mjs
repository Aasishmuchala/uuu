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

test("a ledger on cards (round B2): the small part split, never rounded; the party column found; columns in reading order, as wide as their content", async () => {
  const { figureSplit, partyKey, ledgerColumns, OWED_TO_YOU } = await import("../../pages/dashboard.js");
  assert.deepEqual(figureSplit("1,18,000.00"), ["1,18,000", ".00"]);
  assert.deepEqual(figureSplit("500"), ["500", ""]);
  assert.deepEqual(figureSplit("12.5"), ["12", ".5"]);
  assert.deepEqual(OWED_TO_YOU, ["owed_to_you"]);
  const cols = (pairs) => pairs.map(([key, label]) => ({ key, label }));
  const unpaid = { id: "unpaid_invoices", columns: [...cols([["name", "Number"], ["party", "Customer"], ["due", "Due"], ["left", "Amount left"]]), { key: "_status", label: "Status" }],
    rows: [{ name: "ACC-SINV-2026-00004", party: "Northwind Traders", due: "16 Dec 2026", left: "₹ 1,18,000.00", _status: "Unpaid" }] };
  assert.equal(partyKey(unpaid), "party");
  const out = ledgerColumns(unpaid);
  assert.deepEqual(out.map((c) => c.label), ["Number", "Customer", "Status", "Due", "Amount left"]);
  assert.deepEqual(out.map((c) => c.fit), [true, true, true, true, true], "no column takes all the room (R5-H)");
  const drafts = { id: "drafts", columns: cols([["name", "Number"], ["type", "Type"], ["party", "Party"], ["amount", "Amount"], ["madeBy", "Made by"]]),
    rows: [{ name: "A-1", type: "invoice", party: "Acme Interiors", amount: "₹ 11,800.00", madeBy: "Bookkeeper" }] };
  assert.deepEqual(ledgerColumns(drafts).map((c) => c.key), ["name", "party", "type", "madeBy", "amount"]);
  assert.equal(partyKey({ id: "staff", columns: cols([["name", "Name"], ["job", "Job"]]) }), "name");
  assert.equal(partyKey({ id: "open_requests", columns: cols([["subject", "Subject"], ["from", "From"]]) }), null);
  const replies = { id: "draft_replies", columns: cols([["request", "Request"], ["reply", "Reply"]]),
    rows: [{ request: "#1 Delivery is late", reply: "We are sorry for the delay. Your order ships on Friday, and we will write again." }] };
  assert.deepEqual(ledgerColumns(replies).map((c) => [c.key, c.fit]), [["request", true], ["reply", false]]);
  assert.deepEqual(ledgerColumns(null), []);
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../pages/dashboard.js", import.meta.url), "utf8");
  assert.match(src, /<\$\{Card\} padding="none" class="p-dashboard-sheet">/, "a table stands on a card");
  assert.match(src, /<\$\{Avatar\} name=\$\{String\(value\)\} size=\$\{24\} \/>/, "a party has a 24 px initials disc from its own name");
  assert.match(src, /<\$\{Button\} variant="ghost" size="sm" icon="inbox" class="p-dashboard-queue"/, "the way into Needs you is a small ghost");
  const css = readFileSync(new URL("../../styles/pages/dashboard.css", import.meta.url), "utf8");
  assert.match(css, /\.p-dashboard-cents \{ font-size: max\(0\.75em, var\(--fs-label\)\); \}/);
});

test("a column in which every row says the same thing is left out and said once in the section's head line (R5-H)", async () => {
  const { sameColumns, sameLine } = await import("../../pages/dashboard.js");
  const cols = (pairs) => pairs.map(([key, label]) => ({ key, label }));
  const drafts = { id: "drafts", columns: cols([["name", "Number"], ["type", "Type"], ["party", "Party"], ["amount", "Amount"], ["madeBy", "Made by"]]),
    rows: [
      { name: "A-1", type: "invoice", party: "Acme Interiors", amount: "₹ 11,800.00", madeBy: "Bookkeeper" },
      { name: "A-2", type: "bill", party: "Timber Supply Co", amount: "₹ 11,800.00", madeBy: "Bookkeeper" },
    ] };
  assert.deepEqual(sameColumns(drafts), [{ key: "madeBy", label: "Made by", value: "Bookkeeper" }], "money and the number are never left out");
  assert.equal(sameLine(sameColumns(drafts)), "Made by: Bookkeeper");
  const quotes = { id: "quotations", columns: cols([["name", "Number"], ["party", "Customer"], ["valid", "Valid until"], ["status", "Status"]]),
    rows: [{ name: "Q-1", party: "Asha Kitchens", valid: "16 Dec 2026", status: "Draft" }, { name: "Q-2", party: "Acme Interiors", valid: "16 Dec 2026", status: "Final" }] };
  assert.equal(sameLine(sameColumns(quotes)), "Valid until: 16 Dec 2026", "the value as the books send it");
  assert.deepEqual(sameColumns({ ...drafts, rows: drafts.rows.slice(0, 1) }), [], "one row says nothing about its column");
  assert.deepEqual(sameColumns({ ...drafts, rows: [{ ...drafts.rows[0], madeBy: "" }, { ...drafts.rows[1], madeBy: "" }] }), [], "an empty column is not a fact");
  assert.deepEqual(sameColumns(null), []);
  assert.equal(sameLine([]), "");
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../pages/dashboard.js", import.meta.url), "utf8");
  assert.match(src, /hint=\$\{sameLine\(same\) \|\| undefined\}/, "the fact in the section's head line");
  assert.match(src, /columns=\$\{ledgerColumns\(section\)\.filter\(\(c\) => !out\.has\(c\.key\)\)\}/, "and not as a column");
  assert.match(src, /data-tint=\$\{tintFor\(word\.toLowerCase\(\)\)\}><\$\{Tag\}>/, "a type's chip in the kit's tint for it");
  const css = readFileSync(new URL("../../styles/pages/dashboard.css", import.meta.url), "utf8");
  assert.match(css, /\.p-dashboard\.p-dashboard--records \.k-section \{ margin-bottom: var\(--s-6\); \}/, "sections 24 px apart");
  assert.match(css, /\.p-dashboard-sheet \.k-table__table td \{ height: var\(--s-10\);/, "rows 40 px");
  assert.match(css, /\.p-dashboard\.p-dashboard--records \{ gap: 0; max-width: 760px; \}/, "one 760 px column: every block on its two edges");
  assert.doesNotMatch(css, /width: fit-content/, "no table as wide as its own columns: each at the column's whole width");
  assert.match(css, /\.p-dashboard \.p-dashboard-sheet \.k-table__table \.k-table__fit \{ width: auto; \}/, "the slack shared among the columns");
  assert.match(/\.p-dashboard \.p-dashboard-filter \.k-menu__trigger \{([^}]*)\}/.exec(css)[1], /border-color: var\(--line-2\);[\s\S]*background: var\(--card\)/, "Show and Status edged on the card's surface");
});
