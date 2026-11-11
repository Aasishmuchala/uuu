// Quotations ride the bench inbox source and the Books page (CONTRACTS-V3 35, "The home server").
import { test } from "node:test";
import assert from "node:assert/strict";
import { IDS } from "../../../test/stubs/seed.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { actAsSeen, call } from "../lib/testing.mjs";

async function withHome(fn) {
  const h = await startStubsHome({ port: 0 });
  try { return await fn(h); } finally { await h.close(); }
}
const QTN = "bench:Quotation:SAL-QTN-2026-00001";
const FINAL = "bench:Quotation:SAL-QTN-2026-00002";
const items = async (h) => (await call(h.url, "GET", "/api/inbox")).json.items;
const doc = (h, name) => h.bench.state.docs.Quotation.find((d) => d.name === name);
const writes = (h) => h.bench.requests.filter((r) => r.method !== "GET");

test("the draft quotation is listed in plain words; the final one is not", async () => {
  await withHome(async (h) => {
    const all = await items(h);
    const q = all.find((i) => i.id === QTN);
    assert.ok(q);
    assert.equal(q.source, "books");
    assert.equal(q.kind, "draft");
    assert.equal(q.raisedBy, "Bookkeeper");
    assert.equal(q.title, "Draft quotation SAL-QTN-2026-00001");
    assert.match(q.summary, /^The Bookkeeper made a draft quotation for Asha Kitchens of /);
    assert.deepEqual(q.details.map((d) => d.label), ["Customer", "Date", "Valid until", "Total"]);
    assert.deepEqual(q.actions.map((a) => a.id), ["approve", "send_back"]);
    assert.ok(!all.some((i) => i.id === FINAL));
  });
});

test("approve submits it with the owner's key; a stale version is 409", async () => {
  await withHome(async (h) => {
    const seen = (await items(h)).find((i) => i.id === QTN);
    doc(h, "SAL-QTN-2026-00001").modified = "2030-01-01 00:00:00.000000";
    const stale = await call(h.url, "POST", "/api/inbox/act", { body: { id: QTN, action: "approve", version: seen.version } });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.error.code, "changed_since_seen");
    assert.equal(writes(h).length, 0);
    const r = await actAsSeen(h.url, { id: QTN, action: "approve" });
    assert.equal(r.status, 200);
    assert.equal(r.json.message, "The quotation SAL-QTN-2026-00001 is approved and final.");
    const w = writes(h);
    assert.equal(w.length, 1);
    assert.equal(w[0].path, "/api/method/frappe.client.submit");
    assert.equal(w[0].headers.authorization, "token owner:owner");
    assert.equal(w[0].body.doc.doctype, "Quotation");
    assert.equal(doc(h, "SAL-QTN-2026-00001").docstatus, 1);
    assert.ok(!(await items(h)).some((i) => i.id === QTN));
  });
});

test("send back comments on it and makes the fix task for the Bookkeeper", async () => {
  await withHome(async (h) => {
    await items(h);
    const r = await actAsSeen(h.url, { id: QTN, action: "send_back", note: "Use the new price." });
    assert.equal(r.status, 200);
    assert.equal(r.json.message, "Sent back to the Bookkeeper with your note.");
    const w = writes(h);
    assert.equal(w.length, 1);
    assert.equal(w[0].body.reference_doctype, "Quotation");
    assert.equal(w[0].body.reference_name, "SAL-QTN-2026-00001");
    const posts = h.board.requests.filter((q) => q.method === "POST");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.title, "Fix quotation SAL-QTN-2026-00001");
    assert.equal(posts[0].body.assigneeAgentId, IDS.agents.bookkeeper);
    assert.equal(doc(h, "SAL-QTN-2026-00001").docstatus, 0);
    assert.ok(!(await items(h)).some((i) => i.id === QTN));
  });
});

test("the Books answer has the quotations section with both rows", async () => {
  await withHome(async (h) => {
    const p = (await call(h.url, "GET", "/api/departments/books")).json;
    const s = p.sections.find((x) => x.id === "quotations");
    assert.ok(s);
    assert.equal(s.title, "Quotations");
    assert.deepEqual(s.columns.map((c) => c.key), ["name", "party", "valid", "amount", "status"]);
    const by = Object.fromEntries(s.rows.map((r) => [r.name, r]));
    assert.deepEqual(Object.keys(by).sort(), ["SAL-QTN-2026-00001", "SAL-QTN-2026-00002"]);
    assert.equal(by["SAL-QTN-2026-00001"].status, "Draft");
    assert.equal(by["SAL-QTN-2026-00001"].party, "Asha Kitchens");
    assert.equal(by["SAL-QTN-2026-00002"].status, "Final");
    assert.equal(by["SAL-QTN-2026-00002"].party, "Acme Interiors");
    assert.match(by["SAL-QTN-2026-00002"].amount, /88,500/);
    assert.match(by["SAL-QTN-2026-00002"].valid, /^\d+ [A-Z][a-z]{2} \d{4}$/);
    // the draft also waits in Drafts
    assert.ok(p.sections.find((x) => x.id === "drafts").rows.some((r) => r.name === "SAL-QTN-2026-00001" && r.type === "quotation"));
  });
});
