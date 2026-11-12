// The four department pages against the stub bench and stub board: figures and rows computed from the seed,
// money format, every not-connected case, and one missing app turning one page off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { benchSeed } from "../../../test/stubs/seed.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { call } from "../lib/testing.mjs";

async function withHome(fn, opts = {}) {
  const h = await startStubsHome({ port: 0, ...opts });
  try { return await fn(h); } finally { await h.close(); }
}
const page = async (h, id) => (await call(h.url, "GET", `/api/departments/${id}`)).json;
const sec = (p, id) => p.sections.find((s) => s.id === id);
const fig = (p, id) => p.figures.find((f) => f.id === id);

// the same arithmetic as the pages, written out from the seed
const seed = benchSeed();
const docs = (dt) => seed.docs[dt];
const sumOf = (rows, k) => rows.reduce((t, r) => t + r[k], 0);
const inr = (n) => `₹ ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const final = (dt) => docs(dt).filter((d) => d.docstatus === 1);

test("books: figures, sections and the switch", async () => {
  await withHome(async (h) => {
    const p = await page(h, "books");
    assert.equal(p.id, "books");
    assert.equal(p.connected, true);
    assert.equal(p.notConnected, null);
    assert.deepEqual(p.figures.map((f) => f.id), ["owed_to_you", "you_owe", "sales_month", "spend_month"]);
    const owed = final("Sales Invoice").filter((d) => d.outstanding_amount > 0);
    const owe = final("Purchase Invoice").filter((d) => d.outstanding_amount > 0);
    assert.equal(fig(p, "owed_to_you").value, inr(sumOf(owed, "outstanding_amount")));
    assert.equal(fig(p, "owed_to_you").value, "₹ 1,18,000.00");
    assert.equal(fig(p, "owed_to_you").hint, "1 unpaid invoice");
    assert.equal(fig(p, "you_owe").value, inr(9440));
    const month = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
    const inMonth = (rows) => rows.filter((d) => d.posting_date.startsWith(month));
    assert.equal(fig(p, "sales_month").value, inr(sumOf(inMonth(final("Sales Invoice")), "grand_total")));
    assert.equal(fig(p, "spend_month").value, inr(sumOf(inMonth(final("Purchase Invoice")), "grand_total")));
    assert.deepEqual(sec(p, "drafts").columns.map((c) => c.key), ["name", "type", "party", "amount", "madeBy"]);
    const drafts = sec(p, "drafts").rows;
    assert.deepEqual(drafts.map((r) => r.name).sort(), ["ACC-PINV-2026-00001", "ACC-SINV-2026-00001", "ACC-SINV-2026-00002", "SAL-QTN-2026-00001"]);
    const first = drafts.find((r) => r.name === "ACC-SINV-2026-00001");
    assert.equal(first.type, "invoice");
    assert.equal(first.party, "Acme Interiors");
    assert.equal(first.amount, "₹ 11,800.00");
    assert.equal(first.madeBy, "Bookkeeper");
    assert.equal(first.inboxId, "bench:Sales Invoice:ACC-SINV-2026-00001");
    assert.equal(drafts.find((r) => r.name === "ACC-PINV-2026-00001").type, "bill");
    assert.deepEqual(sec(p, "unpaid_invoices").rows.map((r) => [r.name, r.party, r.left]), [["ACC-SINV-2026-00004", "Northwind Traders", "₹ 1,18,000.00"]]);
    assert.deepEqual(sec(p, "unpaid_bills").rows.map((r) => r.party), ["Timber Supply Co"]);
    assert.equal(p.switches.length, 1);
    assert.equal(p.switches[0].id, "einvoice");
    assert.equal(p.switches[0].on, false);
    assert.equal(p.agent.name, "Bookkeeper");
    assert.equal(p.agent.state, "free");
    assert.deepEqual(p.inFlight, []);
  });
});

test("books: a draft made by the owner is not listed", async () => {
  const s = benchSeed();
  s.docs["Sales Invoice"].push({ doctype: "Sales Invoice", name: "ACC-SINV-2026-00099", owner: "Administrator", docstatus: 0, customer: "Z", grand_total: 5, outstanding_amount: 5, posting_date: "2026-11-01", due_date: "2026-12-01", modified: "2026-11-11 10:00:00" });
  await withHome(async (h) => {
    const p = await page(h, "books");
    assert.ok(!sec(p, "drafts").rows.some((r) => r.name === "ACC-SINV-2026-00099"));
  }, { benchSeed: s });
});

test("customers: figures and rows", async () => {
  await withHome(async (h) => {
    const p = await page(h, "customers");
    assert.equal(p.connected, true);
    assert.deepEqual(p.figures.map((f) => f.id), ["leads_open", "deals_open", "deals_won_month"]);
    assert.equal(fig(p, "leads_open").value, String(docs("CRM Lead").filter((l) => l.converted === 0).length));
    assert.equal(fig(p, "deals_open").value, String(docs("CRM Deal").filter((d) => !["Won", "Lost"].includes(d.status)).length));
    assert.equal(fig(p, "deals_won_month").value, "1");
    assert.deepEqual(sec(p, "lead_stages").rows, [{ stage: "New", count: "1" }, { stage: "Contacted", count: "2" }, { stage: "Qualified", count: "1" }]);
    assert.equal(sec(p, "leads").rows.length, 4);
    assert.deepEqual(sec(p, "leads").columns.map((c) => c.key), ["name", "organisation", "stage", "age"]);
    assert.ok(sec(p, "leads").rows.some((r) => r.name === "Asha Rao" && r.organisation === "Rao Interiors" && r.age === "Today"));
    assert.deepEqual(sec(p, "deals").rows, [{ name: "Singh Homes", stage: "Qualification", value: "₹ 2,50,000.00" }]);
    assert.deepEqual(p.switches.map((s) => [s.id, s.on]), [["email", false], ["whatsapp", false]]);
  });
});

test("support: figures, open requests, draft replies", async () => {
  await withHome(async (h) => {
    const p = await page(h, "support");
    assert.deepEqual(p.figures.map((f) => f.id), ["open", "oldest", "drafts"]);
    assert.equal(fig(p, "open").value, "2");
    assert.equal(fig(p, "oldest").value, "Today");
    assert.equal(fig(p, "drafts").value, "1");
    assert.deepEqual(sec(p, "open_requests").rows.map((r) => r.subject).sort(), ["Delivery is late", "Wrong colour received"]);
    const r = sec(p, "draft_replies").rows;
    assert.equal(r.length, 1);
    assert.equal(r[0].request, "#1 Delivery is late");
    assert.equal(r[0].reply, "We are sorry for the delay. Your order ships on Friday.");
    assert.ok(r[0].reply.length <= 140);
    assert.equal(r[0].inboxId, "bench:HD Ticket Comment:HD-COMMENT-00001");
    assert.deepEqual(p.switches.map((s) => [s.id, s.on]), [["email", false]]);
  });
});

test("people: figures and rows", async () => {
  await withHome(async (h) => {
    const p = await page(h, "people");
    assert.deepEqual(p.figures.map((f) => f.id), ["staff", "on_leave_today", "leave_waiting"]);
    assert.equal(fig(p, "staff").value, "3");
    assert.equal(fig(p, "on_leave_today").value, "0");
    assert.equal(fig(p, "leave_waiting").value, "1");
    assert.deepEqual(sec(p, "staff").rows.map((r) => [r.name, r.job]), [["Priya Nair", "Carpenter"], ["Rohan Das", "Designer"], ["Sana Khan", "Accountant"]]);
    assert.equal(sec(p, "staff").rows[0].joined, "1 Apr 2025");
    const leave = sec(p, "leave").rows;
    assert.equal(leave.length, 1);
    assert.equal(leave[0].who, "Priya Nair");
    assert.equal(leave[0].status, "Waiting for you");
    assert.equal(leave[0].inboxId, "bench:Leave Application:HR-LAP-2026-00001");
    assert.deepEqual(sec(p, "attendance").rows, []);
    assert.deepEqual(p.switches, []);
  });
});

test("people: someone on leave today is counted once, only when the leave is final", async () => {
  const s = benchSeed();
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const l = (name, docstatus) => ({ doctype: "Leave Application", name, owner: "people@engine.localhost", docstatus, employee_name: "Rohan Das", from_date: today, to_date: today, status: "Approved", modified: "2026-11-11 10:00:00" });
  s.docs["Leave Application"].push(l("HR-LAP-2026-00002", 1), l("HR-LAP-2026-00003", 1), l("HR-LAP-2026-00004", 0));
  await withHome(async (h) => {
    assert.equal(fig(await page(h, "people"), "on_leave_today").value, "1");
  }, { benchSeed: s });
});

test("not connected: the books are not installed", async () => {
  await withHome(async (h) => {
    for (const id of ["books", "customers", "support", "people"]) {
      const r = await call(h.url, "GET", `/api/departments/${id}`);
      assert.equal(r.status, 200);
      assert.equal(r.json.connected, false);
      assert.equal(r.json.notConnected.reason, "Books is not installed on this Mac yet.");
      assert.equal(r.json.notConnected.next, "Run: engine/books/install.sh");
      assert.deepEqual(r.json.figures, []);
      assert.ok(Array.isArray(r.json.switches));
    }
    assert.equal(h.bench.requests.length, 0);
  }, { benchInstalled: false });
});

test("not connected: the books are off", async () => {
  await withHome(async (h) => {
    await h.bench.close();
    const r = await call(h.url, "GET", "/api/departments/books");
    assert.equal(r.status, 200);
    assert.equal(r.json.connected, false);
    assert.equal(r.json.notConnected.reason, "The books are switched off.");
    assert.equal(r.json.notConnected.next, "Open Health to see how to start them.");
  });
});

test("not connected: an app left out turns that page off and the others stay on", async () => {
  const s = benchSeed();
  s.missingDoctypes.push("CRM Lead", "CRM Deal");
  await withHome(async (h) => {
    const c = await page(h, "customers");
    assert.equal(c.connected, false);
    assert.equal(c.notConnected.reason, "This part was left out when Books was installed, because the disk was nearly full.");
    for (const id of ["books", "support", "people"]) assert.equal((await page(h, id)).connected, true, id);
  }, { benchSeed: s });
});

test("the board being off does not break a page", async () => {
  await withHome(async (h) => {
    await h.board.close();
    const p = await page(h, "books");
    assert.equal(p.connected, true);
    assert.equal(p.agent, null);
    assert.deepEqual(p.inFlight, []);
  });
});

test("inFlight lists open goals with a step for the agent", async () => {
  await withHome(async (h) => {
    const ids = h.board.state;
    const bk = Object.values(ids.agents).find((a) => a.name === "Bookkeeper").id;
    const step = ids.issues.find((i) => i.parentId && i.status !== "done" && i.status !== "cancelled");
    assert.ok(step, "seed has an open step");
    step.assigneeAgentId = bk;
    const p = await page(h, "books");
    assert.equal(p.inFlight.length, 1);
    assert.deepEqual(Object.keys(p.inFlight[0]).sort(), ["goalId", "identifier", "plainState", "title"]);
    assert.deepEqual((await page(h, "support")).inFlight, []);
  });
});

test("search finds party, lead, ticket and staff names", async () => {
  await withHome(async (h) => {
    const find = async (q) => (await call(h.url, "GET", `/api/search?q=${encodeURIComponent(q)}`)).json;
    const acme = (await find("acme")).groups.find((g) => g.source === "books");
    assert.deepEqual(acme.results.map((r) => [r.title, r.link.page]), [["Acme Interiors", "books"]]);
    assert.equal((await find("asha")).groups.find((g) => g.source === "books").results[0].link.page, "customers");
    assert.equal((await find("late")).groups.find((g) => g.source === "books").results[0].link.page, "support");
    assert.equal((await find("priya")).groups.find((g) => g.source === "books").results[0].link.page, "people");
    assert.ok(!(await find("zzzzzz")).groups.some((g) => g.source === "books"));
  });
  await withHome(async (h) => {
    const r = (await call(h.url, "GET", "/api/search?q=acme")).json;
    assert.ok(r.notSearched.some((n) => n.source === "books" && /not installed/.test(n.reason)));
  }, { benchInstalled: false });
});

test("the modules load without failures", async () => {
  await withHome(async (h) => {
    const r = await call(h.url, "GET", "/api/health");
    assert.deepEqual((r.json.modulesFailed || []).filter((m) => /books|customers|support|people|bench|_departments/.test(m.file)), []);
  });
});
