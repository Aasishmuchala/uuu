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

test("a ledger, flat (round B2, R6): the small part split, never rounded; the party column found; columns in reading order, as wide as their content", async () => {
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
  assert.match(src, /<div class="p-dashboard-sheet">/, "a table stands flat on the ground, no card (R6)");
  assert.doesNotMatch(src, /<\$\{Card\} padding="none" class="p-dashboard-sheet">/);
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
  assert.match(src, /<span class="p-dashboard-kind"><\$\{Tag\}>\$\{text\(value\)\}<\/\/><\/span>/, "a type's chip the kit's one neutral chip (R6)");
  assert.doesNotMatch(src, /tintFor/, "no tint per type");
  const css = readFileSync(new URL("../../styles/pages/dashboard.css", import.meta.url), "utf8");
  assert.match(css, /\.p-dashboard\.p-dashboard--records \.k-section \{ margin-bottom: var\(--s-6\); \}/, "sections 24 px apart");
  assert.match(css, /\.p-dashboard-sheet \.k-table__table td \{ height: var\(--s-10\);/, "rows 40 px");
  assert.match(css, /\.p-dashboard\.p-dashboard--records \{ gap: 0; max-width: 1040px; \}/, "one column as wide as the pane up to 1040 px: every block on its two edges (R6)");
  assert.doesNotMatch(css, /width: fit-content/, "no table as wide as its own columns: each at the column's whole width");
  assert.match(css, /\.p-dashboard \.p-dashboard-sheet \.k-table__table \.k-table__fit \{ width: auto; \}/, "the slack shared among the columns");
  assert.match(/\.p-dashboard \.p-dashboard-filter \.k-menu__trigger \{([^}]*)\}/.exec(css)[1], /border-color: var\(--line-2\);[\s\S]*background: var\(--card\)/, "Show and Status edged on the card's surface");
});

// ---- Mounted in the shared test DOM with a fake fetch (PLAN-3D-ALL U12). ----
const dom = await import("../kit/_dom.mjs");
const { AppContext } = await import("../../lib/context.js");
const board = await import("../../pages/dashboard.js");
const { html, render } = dom;
const fire = (el, type, ev = {}) => { for (const f of el.listeners[type] || []) f.call(el, { type, preventDefault() {}, stopPropagation() {}, ...ev }); };
const cols = (pairs) => pairs.map(([key, label]) => ({ key, label }));
const OFF = "Connect an account to turn this on.";
const agentOf = (name, state = "working", plainState = "Working") => ({ slug: name.toLowerCase(), name, state, plainState });

// The four answers as the home server words them (routes/books.mjs, customers.mjs, support.mjs, people.mjs).
const ANSWERS = {
  books: () => ({
    id: "books", title: "Books", connected: true, notConnected: null, agent: agentOf("Bookkeeper"),
    inFlight: [{ goalId: "e0000000-0000-4000-8000-000000000031", title: "Chase the Northwind invoice", plainState: "Being worked on" }],
    switches: [{ id: "einvoice", label: "Send e-invoices to the GST portal", on: false, explain: OFF }],
    figures: [
      { id: "owed_to_you", label: "You are owed", value: "₹ 1,18,000.00", hint: "1 unpaid invoice" },
      { id: "you_owe", label: "You owe", value: "₹ 9,440.00", hint: "1 unpaid bill" },
      { id: "sales_month", label: "Sales this month", value: "₹ 1,43,000.00", hint: "2 invoices" },
      { id: "spend_month", label: "Spend this month", value: "₹ 12,980.00", hint: "2 bills" },
    ],
    sections: [
      { id: "drafts", title: "Drafts waiting for you", emptyText: "No drafts waiting.",
        columns: cols([["name", "Number"], ["type", "Type"], ["party", "Party"], ["amount", "Amount"], ["madeBy", "Made by"]]),
        rows: [
          { name: "ACC-SINV-2026-00007", type: "invoice", party: "Acme Interiors", amount: "₹ 11,800.00", madeBy: "Bookkeeper", inboxId: "bench:Sales Invoice:ACC-SINV-2026-00007" },
          { name: "ACC-PINV-2026-00003", type: "bill", party: "Timber Supply Co", amount: "₹ 4,720.00", madeBy: "Bookkeeper", inboxId: "bench:Purchase Invoice:ACC-PINV-2026-00003" },
        ] },
      { id: "quotations", title: "Quotations", emptyText: "No quotations yet.",
        columns: cols([["name", "Number"], ["party", "Customer"], ["valid", "Valid until"], ["amount", "Amount"], ["status", "Status"]]),
        rows: [
          { name: "SAL-QTN-2026-00001", party: "Asha Kitchens", valid: "16 Dec 2026", amount: "₹ 2,36,000.00", status: "Draft" },
          { name: "SAL-QTN-2026-00002", party: "Acme Interiors", valid: "20 Dec 2026", amount: "₹ 59,000.00", status: "Final" },
        ] },
      { id: "unpaid_invoices", title: "Invoices not paid yet", emptyText: "Nothing is waiting to be paid to you.",
        columns: cols([["name", "Number"], ["party", "Customer"], ["due", "Due"], ["left", "Amount left"]]),
        rows: [{ name: "ACC-SINV-2026-00004", party: "Northwind Traders", due: "16 Dec 2026", left: "₹ 1,18,000.00" }] },
      { id: "unpaid_bills", title: "Bills not paid yet", emptyText: "You have no bills to pay.",
        columns: cols([["name", "Number"], ["party", "Supplier"], ["due", "Due"], ["left", "Amount left"]]),
        rows: [{ name: "ACC-PINV-2026-00001", party: "Timber Supply Co", due: "1 Nov 2026", left: "₹ 9,440.00" }] },
    ],
  }),
  customers: () => ({
    id: "customers", title: "Customers", connected: true, notConnected: null, agent: agentOf("Sales", "free", "Free"), inFlight: [],
    switches: [{ id: "email", label: "Send email to customers", on: false, explain: OFF }, { id: "whatsapp", label: "Send WhatsApp messages", on: false, explain: OFF }],
    figures: [
      { id: "leads_open", label: "Open leads", value: "3", hint: "" },
      { id: "deals_open", label: "Open deals", value: "2", hint: "" },
      { id: "deals_won_month", label: "Deals won this month", value: "1", hint: "" },
    ],
    sections: [
      { id: "lead_stages", title: "Leads by stage", emptyText: "No open leads.", columns: cols([["stage", "Stage"], ["count", "How many"]]),
        rows: [{ stage: "Lead", count: 2 }, { stage: "Contacted", count: 1 }] },
      { id: "leads", title: "Open leads", emptyText: "No open leads.", columns: cols([["name", "Name"], ["organisation", "Organisation"], ["stage", "Stage"], ["age", "Age"]]),
        rows: [{ name: "Asha Rao", organisation: "Asha Kitchens", stage: "Lead", age: "3 days" }, { name: "Vikram Shah", organisation: "", stage: "Contacted", age: "Today" }] },
      { id: "deals", title: "Open deals", emptyText: "No open deals.", columns: cols([["name", "Name"], ["stage", "Stage"], ["value", "Value"]]),
        rows: [{ name: "Acme Interiors", stage: "Negotiation", value: "₹ 3,40,000.00" }] },
    ],
  }),
  support: () => ({
    id: "support", title: "Support", connected: true, notConnected: null, agent: agentOf("Support", "waiting_for_you", "Waiting for your approval"), inFlight: [],
    switches: [{ id: "email", label: "Send replies to customers by email", on: false, explain: OFF }],
    figures: [
      { id: "open", label: "Open requests", value: "2", hint: "" },
      { id: "oldest", label: "Oldest waiting", value: "4 days", hint: "" },
      { id: "drafts", label: "Replies waiting for you", value: "1", hint: "" },
    ],
    sections: [
      { id: "open_requests", title: "Open requests", emptyText: "No customer is waiting.", columns: cols([["subject", "Subject"], ["from", "From"], ["status", "Status"], ["age", "Age"]]),
        rows: [{ subject: "Delivery is late", from: "meera@example.com", status: "Open", age: "4 days" }, { subject: "Hinge is loose", from: "", status: "Replied", age: "1 day" }] },
      { id: "draft_replies", title: "Replies waiting for you", emptyText: "No replies waiting.", columns: cols([["request", "Request"], ["reply", "Reply"]]),
        rows: [{ request: "#1 Delivery is late", reply: "We are sorry for the delay. Your order ships on Friday, and we will write again.", inboxId: "bench:HD Ticket Comment:c1" }] },
    ],
  }),
  people: () => ({
    id: "people", title: "People", connected: true, notConnected: null, agent: agentOf("People", "paused", "Paused"), inFlight: [], switches: [],
    figures: [
      { id: "staff", label: "People", value: "3", hint: "" },
      { id: "on_leave_today", label: "On leave today", value: "0", hint: "" },
      { id: "leave_waiting", label: "Leave requests waiting", value: "1", hint: "" },
    ],
    sections: [
      { id: "staff", title: "People", emptyText: "No one has been added yet.", columns: cols([["name", "Name"], ["job", "Job"], ["joined", "Joined"]]),
        rows: [{ name: "Priya Nair", job: "Designer", joined: "1 Apr 2025" }, { name: "Asha Rao", job: "Fitter", joined: "2 Jun 2025" }] },
      { id: "leave", title: "Leave", emptyText: "No leave requests.", columns: cols([["who", "Who"], ["from", "From"], ["to", "To"], ["status", "Status"]]),
        rows: [{ who: "Priya Nair", from: "20 Nov 2026", to: "21 Nov 2026", status: "Waiting for you", inboxId: "bench:Leave Application:HR-LAP-2026-00001" }] },
      { id: "attendance", title: "Attendance, last 7 days", emptyText: "No attendance marked this week.", columns: cols([["who", "Who"], ["date", "Date"], ["status", "Status"]]),
        rows: [{ who: "Asha Rao", date: "16 Nov 2026", status: "Present" }] },
    ],
  }),
};
// The answer when the books cannot be read (routes/_departments.mjs: the books switched off).
const BOOKS_OFF = () => ({
  id: "books", title: "Books", connected: false, notConnected: { reason: "The books are switched off.", next: "Open Health to see how to start them." },
  agent: null, inFlight: [], figures: [], sections: [], switches: [{ id: "einvoice", label: "Send e-invoices to the GST portal", on: false, explain: OFF }],
});
const INBOX = () => ({ items: [{ id: "bench:Leave Application:HR-LAP-2026-00001", title: "Leave for Priya Nair", department: "people" }, { id: "bench:HD Ticket Comment:c1", title: "Reply to #1", department: "support" }] });
const MAP = (dept) => ({ id: dept, clusters: [{ id: "c", title: "C", jobs: [
  { id: `${dept}/one`, title: "Send a payment reminder", summary: "A polite reminder for one unpaid invoice.", ready: true, department: { id: dept, title: dept }, runs: { total: 0 } },
] }] });

// `answers(path, method)`: an object answers 200, null a 500 with the server's sentence, undefined never answers.
function seeded(over = {}) {
  return (path) => {
    const all = {
      "/api/departments/books": ANSWERS.books(), "/api/departments/customers": ANSWERS.customers(), "/api/departments/support": ANSWERS.support(),
      "/api/departments/people": ANSWERS.people(), "/api/inbox": INBOX(),
      ...Object.fromEntries(["books", "sales", "support", "people"].map((d) => [`/api/map/${d}`, MAP(d)])), ...over,
    };
    return Object.hasOwn(all, path) ? all[path] : null;
  };
}

async function mountBoard(answers, { id = "books", query = "", opened = [] } = {}) {
  dom.installDom();
  globalThis.document.visibilityState = "visible";
  const hash = `#/dashboards/${id}${query ? `?${query}` : ""}`;
  globalThis.location = { hash, href: `/${hash}`, search: "" };
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts = {}) => {
    const m = opts.method || "GET";
    calls.push(`${m} ${path}${opts.body === undefined ? "" : ` ${opts.body}`}`);
    const data = answers(String(path), m);
    if (data === undefined) return new Promise(() => {});
    return data ? { ok: true, status: 200, json: async () => data }
      : { ok: false, status: 500, json: async () => ({ error: { code: "x", message: "The books did not answer.", next: "Try again." } }) };
  };
  const tops = [];
  const nothing = () => {};
  const ctx = {
    shell: { team: [], dock: [] }, announce: nothing, openComposer: nothing, openPanel: nothing, closePanel: nothing,
    openNeeds: (o) => opened.push(o), setTop: (t) => tops.push(t), settings: { motion: "off", theme: "dark" },
  };
  const root = new dom.FakeElement("div");
  globalThis.document.body.appendChild(root);
  render(html`<${AppContext.Provider} value=${ctx}><${board.default} route=${{ id: "dashboards", parts: ["dashboards", id], query: new URLSearchParams(query) }} /><//>`, root);
  // Long enough for the answer, then the jobs it asks for, on a busy machine.
  await dom.settle(700);
  return { root, calls, tops, done: async () => { render(null, root); root.remove(); await dom.settle(50); globalThis.fetch = real; delete globalThis.location; } };
}

test("dashboard: the page sends what it sent before (PLAN-3D-ALL)", async () => {
  const seen = [];
  for (const [answers, opts] of [
    [seeded(), { id: "books" }],
    [seeded(), { id: "customers" }],
    [seeded(), { id: "support" }],
    [seeded(), { id: "people" }],
    [seeded(), { id: "books", query: "s=quotations&st=draft" }],
    [seeded({ "/api/departments/books": BOOKS_OFF() }), { id: "books" }],
    [seeded({ "/api/departments/books": undefined }), { id: "books" }],
    [seeded(), { id: "../../x" }],
  ]) {
    const m = await mountBoard(answers, opts);
    try { seen.push(...m.calls); } finally { await m.done(); }
  }
  // The books not answering, then Try again; Open in Needs you asks the shell, not the server.
  const opened = [];
  const m = await mountBoard(seeded({ "/api/departments/books": null }), { id: "books" });
  try {
    const retry = dom.elements(m.root).find((e) => e.localName === "button" && dom.textOf(e).includes("Try again"));
    fire(retry, "Click");
    await dom.settle();
    seen.push(...m.calls);
  } finally { await m.done(); }
  const p = await mountBoard(seeded(), { id: "people", opened });
  try {
    const queue = dom.elements(p.root).find((e) => e.localName === "button" && dom.textOf(e).includes("Open in Needs you"));
    fire(queue, "Click");
    await dom.settle(50);
    seen.push(...p.calls);
  } finally { await p.done(); }
  assert.deepEqual(opened, [{ department: "people" }]);
  // Recorded on the page before PLAN-3D-ALL U12 changed it.
  const RECORDED = [
    "GET /api/departments/books",
    "GET /api/inbox",
    "GET /api/map/books",
    "GET /api/departments/customers",
    "GET /api/inbox",
    "GET /api/map/sales",
    "GET /api/departments/support",
    "GET /api/inbox",
    "GET /api/map/support",
    "GET /api/departments/people",
    "GET /api/inbox",
    "GET /api/map/people",
    "GET /api/departments/books",
    "GET /api/inbox",
    "GET /api/departments/books",
    "GET /api/inbox",
    "GET /api/departments/books",
    "GET /api/inbox",
    "GET /api/departments/books",
    "GET /api/inbox",
    "GET /api/map/books",
    "GET /api/departments/books",
    "GET /api/inbox",
    "GET /api/departments/books",
    "GET /api/departments/people",
    "GET /api/inbox",
    "GET /api/map/people",
  ];
  assert.deepEqual(seen, RECORDED);
  for (const c of seen) assert.ok(!/\/assets\/world\/|\/vendor\/three-/.test(c), c);
});

const { glimpseSrc, GLIMPSES } = await import("../../kit/room.js");
const { HOSTILE } = await import("../../world/fixtures.js");
const { readFileSync: readCss } = await import("node:fs");
const byCls = (root, c) => dom.elements(root).filter((e) => dom.classesOf(e).includes(c));
const textNodes = (root) => [...dom.walkDom(root)].filter((n) => n.nodeType === 3).map((n) => n.data);

test("dashboard: the title, the agent and the filters stand in the room header of the board's room; one h1, crumbs as before; no paper (PLAN-3D-ALL U12)", async () => {
  for (const [id, key] of [["books", "room-books"], ["customers", "room-sales"], ["support", "room-support"], ["people", "room-people"], ["../../x", "room-books"]]) {
    const m = await mountBoard(seeded(), { id });
    try {
      const band = dom.elements(m.root).filter((e) => e.localName === "header" && dom.classesOf(e).includes("k-room"));
      assert.equal(band.length, 1, id);
      assert.equal(band[0].getAttribute("data-glimpse"), key, id);
      const h1 = dom.elements(m.root).filter((e) => e.localName === "h1");
      assert.equal(h1.length, 1);
      assert.equal(h1[0].getAttribute("id"), "page-title");
      const img = dom.elements(m.root).filter((e) => e.localName === "img");
      assert.equal(img.length, 1, "one picture: the band's");
      assert.equal(img[0].getAttribute("src"), glimpseSrc(key, { theme: "dark", width: 1280 }));
      assert.equal(img[0].getAttribute("aria-hidden"), "true");
      assert.equal(byCls(band[0], "p-dashboard-bar").length, 1, "the filters in the band");
      assert.equal(byCls(band[0], "p-dashboard-agent").length, 1, "the agent in the band");
      const title = { "../../x": "Books" }[id] || board.DEPARTMENTS && { books: "Books", customers: "Customers", support: "Support", people: "People" }[id];
      assert.deepEqual(m.tops.at(-1), { crumbs: [{ label: "Dashboards", href: "#/dashboards" }, { label: title }] });
      assert.ok(!dom.elements(m.root).some((e) => e.getAttribute("data-surface")), "no paper on a record dashboard");
      assert.equal(dom.elements(m.root).filter((e) => e.localName === "canvas").length, 0);
    } finally { await m.done(); }
  }
  const css = readCss(new URL("../../styles/pages/dashboard.css", import.meta.url), "utf8");
  const band = /\.p-dashboard > \.k-room \{([^}]*)\}/.exec(css)[1];
  // PLAN-3D-ALL U17: the layer and the pull into the pane's margin are the kit's (`.k-room`, `pull`, U16); the page
  // gives the band `pull` instead of copying "z-index: 1; margin-top: calc(-1 * var(--s-6))".
  assert.doesNotMatch(band, /z-index|margin-top/, "an open filter covers what is under the band by the kit's layer");
  assert.match(readCss(new URL("../../pages/dashboard.js", import.meta.url), "utf8"), /<\$\{RoomHeader\} glimpse=\$\{[^}]*\} pull\b/, "up into the pane's margin by the kit's pull (D9)");
  assert.match(css, /\.p-dashboard \.k-room \.p-dashboard-filter \.k-menu__trigger \{ background: var\(--ctl\); \}/);
  // The quiet look's tables ran to the edge with no padding at their two ends; the head row is now filled with the
  // lamp's pool, so the first and last cells keep the kit's 8 px (PLAN-3D-ALL U12).
  assert.match(css, /td:first-child \{ padding-left: var\(--s-2\); \}/);
  assert.match(css, /td:last-child \{ padding-right: var\(--s-2\); \}/);
});

test("dashboard: every figure and money sentence is shown whole, as the books send it; nothing cuts it (PLAN-3D-ALL U12, S1)", async () => {
  const flat = (s) => String(s).replace(/\s+/g, "").replace(/^-/, "−");
  for (const id of ["books", "customers", "support", "people"]) {
    const answer = ANSWERS[id]();
    const m = await mountBoard(seeded(), { id });
    try {
      const values = byCls(m.root, "p-dashboard-total-value").map((e) => flat(dom.textOf(e)));
      assert.deepEqual(values, answer.figures.map((f) => flat(f.value)), `${id}: the figures as sent, none made up, none rounded`);
      const nodes = textNodes(m.root);
      for (const f of answer.figures) {
        assert.ok(nodes.includes(f.label), `${id}: ${f.label}`);
        if (f.hint) assert.ok(nodes.includes(f.hint), `${id}: ${f.hint}`);
      }
      const amounts = byCls(m.root, "p-dashboard-amount").map((e) => flat(dom.textOf(e)));
      for (const s of answer.sections) for (const r of s.rows) for (const v of Object.values(r)) {
        if (board.moneyParts(v)) assert.ok(amounts.includes(flat(v)), `${id}: ${v} shown whole`);
      }
      for (const s of answer.switches) assert.ok(nodes.includes(s.explain), `${id}: the switch's sentence`);
    } finally { await m.done(); }
  }
  // The books cannot be read: the reason one text node, exactly as sent; the next step in words, its link Open Health.
  const off = await mountBoard(seeded({ "/api/departments/books": BOOKS_OFF() }), { id: "books" });
  try {
    assert.ok(textNodes(off.root).includes("The books are switched off."));
    assert.ok(dom.textOf(off.root).includes("Open Health to see how to start them."));
  } finally { await off.done(); }
  const failed = await mountBoard(seeded({ "/api/departments/books": null }), { id: "books" });
  try { assert.ok(textNodes(failed.root).includes("The books did not answer."), "the server's sentence when it fails"); } finally { await failed.done(); }
  const css = readCss(new URL("../../styles/pages/dashboard.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /text-overflow|line-clamp|overflow: hidden/, "no box of this page cuts a figure or a sentence");
  assert.doesNotMatch(/\.p-dashboard \.p-dashboard-total-value \{([^}]*)\}/.exec(css)[1], /white-space: nowrap|[^-]height:/);
  assert.match(css, /\.p-dashboard \.p-dashboard-amount \{ font-variant-numeric: tabular-nums;/, "amounts in tabular figures");
});

test("dashboard: hostile server text stays text: no script, img, iframe or object beyond the band's; no on* attribute; no fixture text in href, src or style (PLAN-3D-ALL)", async () => {
  const bad = (i) => HOSTILE[i % HOSTILE.length];
  const tags = (root) => ["script", "img", "iframe", "object"].map((t) => dom.elements(root).filter((e) => e.localName === t).length);
  // Every string the server sends replaced by the hostile set; ids and keys kept so the page still finds its parts.
  const poison = (v, k = 0, key = "") => {
    if (Array.isArray(v)) return v.map((x, i) => poison(x, k + i, key));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([kk, x], i) => [kk, ["id", "key", "inboxId", "goalId", "state", "connected"].includes(kk) ? x : poison(x, k + i, kk)]));
    return typeof v === "string" ? bad(k) : v;
  };
  for (const id of ["books", "customers", "support", "people"]) {
    const s = await mountBoard(seeded(), { id });
    let base;
    try { base = tags(s.root); } finally { await s.done(); }
    const hostile = poison(ANSWERS[id]());
    const m = await mountBoard(seeded({ [`/api/departments/${id}`]: hostile, "/api/inbox": poison(INBOX()) }), { id });
    try {
      assert.deepEqual(tags(m.root), base, id);
      for (const e of dom.elements(m.root)) {
        for (const k of Object.keys(e.attrs)) assert.ok(!/^on/i.test(k), `no ${k}`);
        for (const h of HOSTILE) for (const a of ["href", "src", "style"]) assert.ok(!String(e.getAttribute(a) || "").includes(h), `${a} holds no fixture text`);
        if (e.localName === "img") assert.ok(GLIMPSES.some((k) => glimpseSrc(k, { theme: "dark", width: 1280 }) === e.getAttribute("src")), "the band's picture is a table key's");
      }
      assert.ok(textNodes(m.root).some((t) => HOSTILE.includes(t)), "hostile words shown as text");
    } finally { await m.done(); }
  }
});
