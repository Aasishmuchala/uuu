// The bench inbox source: what is listed, and the guarded approve and send back (CONTRACTS 9.3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { benchSeed, IDS } from "../../../test/stubs/seed.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { call } from "../lib/testing.mjs";

async function withHome(fn, opts = {}) {
  const h = await startStubsHome({ port: 0, ...opts });
  try { return await fn(h); } finally { await h.close(); }
}
const inbox = async (h) => (await call(h.url, "GET", "/api/inbox")).json;
const benchItems = async (h) => (await inbox(h)).items.filter((i) => ["books", "people", "support"].includes(i.source));
const actOn = (h, id, action, note) => call(h.url, "POST", "/api/inbox/act", { body: note === undefined ? { id, action } : { id, action, note } });
const SINV = "bench:Sales Invoice:ACC-SINV-2026-00001";
const LEAVE = "bench:Leave Application:HR-LAP-2026-00001";
const REPLY = "bench:HD Ticket Comment:HD-COMMENT-00001";
const doc = (h, dt, name) => h.bench.state.docs[dt].find((d) => d.name === name);
const benchWrites = (h) => h.bench.requests.filter((r) => r.method !== "GET");

test("lists the agents' drafts as plain items, and none made by the owner", async () => {
  const s = benchSeed();
  s.docs["Sales Invoice"].push({ doctype: "Sales Invoice", name: "ACC-SINV-2026-00099", owner: "Administrator", docstatus: 0, customer: "Z", grand_total: 5, modified: "2026-11-11 10:00:00" });
  await withHome(async (h) => {
    const items = await benchItems(h);
    assert.deepEqual(items.map((i) => i.id).sort(), [
      REPLY, LEAVE, "bench:Purchase Invoice:ACC-PINV-2026-00001", SINV, "bench:Sales Invoice:ACC-SINV-2026-00002",
    ].sort());
    const inv = items.find((i) => i.id === SINV);
    assert.equal(inv.source, "books");
    assert.equal(inv.kind, "draft");
    assert.equal(inv.raisedBy, "Bookkeeper");
    assert.equal(inv.title, "Draft invoice ACC-SINV-2026-00001");
    assert.match(inv.summary, /^The Bookkeeper made a draft invoice for Acme Interiors of ₹ 11,800\.00\./);
    assert.deepEqual(inv.actions.map((a) => [a.id, a.needsNote]), [["approve", false], ["send_back", true]]);
    assert.ok(inv.details.some((d) => d.label === "Total" && d.value === "₹ 11,800.00"));
    assert.deepEqual(inv.link, { page: "books", id: "ACC-SINV-2026-00001" });
    assert.ok(!JSON.stringify(inv).includes("_doctype"));
    assert.equal(items.find((i) => i.id === LEAVE).source, "people");
    const reply = items.find((i) => i.id === REPLY);
    assert.equal(reply.source, "support");
    assert.equal(reply.raisedBy, "Support");
    assert.match(reply.summary, /nothing is sent/);
    assert.ok(!items.some((i) => i.id.includes("00099")));
  }, { benchSeed: s });
});

test("approve submits with the owner's key, the document just read", async () => {
  await withHome(async (h) => {
    await inbox(h);
    const r = await actOn(h, SINV, "approve");
    assert.equal(r.status, 200);
    assert.equal(r.json.message, "The invoice ACC-SINV-2026-00001 is approved and final.");
    const w = benchWrites(h);
    assert.equal(w.length, 1);
    assert.equal(w[0].path, "/api/method/frappe.client.submit");
    assert.equal(w[0].headers.authorization, "token owner:owner");
    assert.equal(w[0].headers["x-frappe-site-name"], "engine.localhost");
    assert.equal(w[0].body.doc.name, "ACC-SINV-2026-00001");
    assert.equal(w[0].body.doc.doctype, "Sales Invoice");
    assert.equal(w[0].body.doc.owner, "bookkeeper@engine.localhost");
    assert.equal(doc(h, "Sales Invoice", "ACC-SINV-2026-00001").docstatus, 1);
    assert.ok(!(await benchItems(h)).some((i) => i.id === SINV));
    assert.equal((await actOn(h, SINV, "approve")).status, 409);
  });
});

test("approve is refused when nobody has been shown the draft", async () => {
  await withHome(async (h) => {
    // The action re-reads the list itself, but that never counts as the owner having looked.
    const r = await actOn(h, SINV, "approve");
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "changed");
    assert.equal(benchWrites(h).length, 0);
    assert.equal(doc(h, "Sales Invoice", "ACC-SINV-2026-00001").docstatus, 0);
  });
});

test("approve is refused when the draft changed after it was listed, and works after a fresh look", async () => {
  await withHome(async (h) => {
    await inbox(h);
    const d = doc(h, "Sales Invoice", "ACC-SINV-2026-00001");
    d.grand_total = 999999; d.modified = "2030-01-01 00:00:00.000000";
    const r = await actOn(h, SINV, "approve");
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "changed");
    assert.match(r.json.error.message, /changed/);
    assert.equal(benchWrites(h).length, 0);
    assert.equal(d.docstatus, 0);
    const item = (await benchItems(h)).find((i) => i.id === SINV);
    assert.ok(item.details.some((x) => x.value === "₹ 9,99,999.00"));
    assert.equal((await actOn(h, SINV, "approve")).status, 200);
    assert.equal(d.docstatus, 1);
  });
});

test("approve is refused when it stopped being a draft or its maker is not an agent", async () => {
  await withHome(async (h) => {
    await inbox(h);
    doc(h, "Sales Invoice", "ACC-SINV-2026-00001").docstatus = 1;
    const r = await actOn(h, SINV, "approve");
    assert.ok([404, 409].includes(r.status));
    assert.equal(benchWrites(h).length, 0);
  });
  // the item is still listed when the owner changes between the list and the re-read inside approve
  await withHome(async (h) => {
    await inbox(h);
    const d = doc(h, "Sales Invoice", "ACC-SINV-2026-00001");
    const real = h.bench.state.docs["Sales Invoice"];
    d.owner = "Administrator";
    const r = await actOn(h, SINV, "approve");
    assert.ok([404, 409].includes(r.status));
    assert.equal(real.find((x) => x.name === d.name).docstatus, 0);
    assert.equal(benchWrites(h).length, 0);
  });
  // an id that names a document the owner made is never approvable
  await withHome(async (h) => {
    const r = await actOn(h, "bench:Sales Invoice:ACC-SINV-2026-00003", "approve");
    assert.equal(r.status, 404);
    assert.equal(benchWrites(h).length, 0);
  });
});

test("approve never reaches a document that is not in the draft list", async () => {
  await withHome(async (h) => {
    await inbox(h);
    for (const id of ["bench:Customer:Acme Interiors", "bench:Sales Invoice:nope", "bench:HD Ticket:1", "bench:Sales Invoice:ACC-SINV-2026-00004"]) {
      const r = await actOn(h, id, "approve");
      assert.equal(r.status, 404, id);
    }
    assert.equal(benchWrites(h).length, 0);
  });
});

test("a leave request is made Approved, then submitted", async () => {
  await withHome(async (h) => {
    await inbox(h);
    const r = await actOn(h, LEAVE, "approve");
    assert.equal(r.status, 200);
    assert.match(r.json.message, /leave request for Priya Nair is approved/);
    const w = benchWrites(h);
    assert.equal(w[0].body.doc.status, "Approved");
    assert.equal(doc(h, "Leave Application", "HR-LAP-2026-00001").docstatus, 1);
  });
});

test("an approved support reply is only recorded: nothing is sent and nothing is written to the books", async () => {
  await withHome(async (h) => {
    await inbox(h);
    const r = await actOn(h, REPLY, "approve");
    assert.equal(r.status, 200);
    assert.match(r.json.message, /nothing was sent/i);
    assert.equal(benchWrites(h).length, 0);
    assert.ok(!(await benchItems(h)).some((i) => i.id === REPLY));
    assert.equal((await actOn(h, REPLY, "approve")).status, 409);
    assert.ok(h.board.requests.every((q) => q.method === "GET"));
  });
});

test("send back: needs a note, comments on the draft, makes one task for that agent, hides the draft until it changes", async () => {
  await withHome(async (h) => {
    await inbox(h);
    const bare = await actOn(h, SINV, "send_back");
    assert.equal(bare.status, 400);
    assert.equal(bare.json.error.code, "needs_note");
    assert.equal(benchWrites(h).length, 0);

    const r = await actOn(h, SINV, "send_back", "The customer is Northwind, not Acme.");
    assert.equal(r.status, 200);
    assert.equal(r.json.message, "Sent back to the Bookkeeper with your note.");
    const w = benchWrites(h);
    assert.equal(w.length, 1);
    assert.equal(w[0].path, "/api/method/frappe.desk.form.utils.add_comment");
    assert.equal(w[0].body.reference_doctype, "Sales Invoice");
    assert.equal(w[0].body.reference_name, "ACC-SINV-2026-00001");
    assert.equal(w[0].body.content, "The customer is Northwind, not Acme.");
    assert.equal(h.bench.state.comments.length, 1);
    const posts = h.board.requests.filter((q) => q.method === "POST");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].path, `/api/companies/${IDS.company}/issues`);
    assert.equal(posts[0].body.title, "Fix invoice ACC-SINV-2026-00001");
    assert.equal(posts[0].body.assigneeAgentId, IDS.agents.bookkeeper);
    assert.equal(posts[0].body.projectId, IDS.project);
    assert.equal(posts[0].body.status, "todo");
    assert.match(posts[0].body.description, /^The customer is Northwind, not Acme\./);
    assert.ok(posts[0].headers.authorization === undefined);
    assert.equal(doc(h, "Sales Invoice", "ACC-SINV-2026-00001").docstatus, 0);

    assert.ok(!(await benchItems(h)).some((i) => i.id === SINV));
    doc(h, "Sales Invoice", "ACC-SINV-2026-00001").modified = "2031-01-01 00:00:00.000000";
    assert.ok((await benchItems(h)).some((i) => i.id === SINV));
  });
});

test("send back for a leave request goes to People, for a reply to Support", async () => {
  await withHome(async (h) => {
    await inbox(h);
    await actOn(h, LEAVE, "send_back", "Wrong dates.");
    await actOn(h, REPLY, "send_back", "Be warmer.");
    const posts = h.board.requests.filter((q) => q.method === "POST");
    assert.deepEqual(posts.map((p) => [p.body.title, p.body.assigneeAgentId]), [
      ["Fix leave request HR-LAP-2026-00001", IDS.agents.people], ["Fix reply HD-COMMENT-00001", IDS.agents.support],
    ]);
  });
});

test("not connected: the books not installed or off add one entry and no items", async () => {
  await withHome(async (h) => {
    const d = await inbox(h);
    assert.ok(d.notConnected.some((n) => n.source === "books" && /not installed/.test(n.reason)));
    assert.equal(d.items.filter((i) => ["books", "people", "support"].includes(i.source)).length, 0);
  }, { benchInstalled: false });
  await withHome(async (h) => {
    await h.bench.close();
    const r = await call(h.url, "GET", "/api/inbox");
    assert.equal(r.status, 200);
    assert.ok(r.json.notConnected.some((n) => n.source === "bench" && /not answering/.test(n.reason)));
    assert.ok(r.json.items.length > 0);
  });
});

test("an app left out hides only its drafts", async () => {
  const s = benchSeed();
  s.missingDoctypes.push("Leave Application", "Attendance");
  await withHome(async (h) => {
    const ids = (await benchItems(h)).map((i) => i.source);
    assert.ok(ids.includes("books") && ids.includes("support") && !ids.includes("people"));
  }, { benchSeed: s });
});

test("the owner's key never shows in any answer", async () => {
  await withHome(async (h) => {
    const a = await call(h.url, "GET", "/api/inbox");
    const b = await actOn(h, SINV, "approve");
    for (const r of [a, b]) assert.ok(!/owner:owner|token /.test(r.text));
  });
});
