// The Brain page's routes (PLAN-BRAIN T11, B10, B7), over HTTP through startV2 with the stub bench and a temp
// brain holding the fixture's files. No live state, no fixed port. The brain switch is on for all but the last test,
// which shows that with it off (as it starts) nothing is built and nothing is asked of the books.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { brainToken } from "../brain/store.mjs";
import { updateDoors } from "../lib/doors.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { FILES } from "../../../brain/test/fixture.mjs";

const ADMIN = "Administrator";
const STAMP = "2026-11-11 14:30:00.000000";
const RAVI = {
  doctype: "Contact", name: "Ravi Menon-Acme Interiors", owner: ADMIN, modified_by: ADMIN, docstatus: 0,
  creation: STAMP, modified: STAMP, first_name: "Ravi", last_name: "Menon", company_name: "Acme Interiors",
};
const FORBIDDEN = ["Asha Rao", "Rao Interiors", "Singh Homes", "Delivery is late", "buyer@example.com", "DRAFT REPLY"];
const b64 = (s) => Buffer.from(s, "utf8").toString("base64url");

async function home() {
  const t = await startV2({ routes: ["brain", "brain-index", "search"], search: ["brain"] });
  t.config.minFreeDiskGb = 0;
  t.bench.state.docs.Contact = [structuredClone(RAVI)];
  const docs = join(t.state, "knowledge", "docs");
  for (const [rel, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(docs, rel)), { recursive: true });
    writeFileSync(join(docs, rel), text);
  }
  return t;
}

let h;
before(async () => {
  h = await home();
  updateDoors(h.config, (s) => { s.brain.on = true; });
});
after(async () => { await h?.close(); });

const get = (path) => call(h.url, "GET", path);
const find = (q) => get(`/api/brain/find?q=${encodeURIComponent(q)}`);
const sourcesOf = (r) => r.json.results.map((x) => x.source);

test("before the first build: the index is all null and find is empty, and a build starts", async () => {
  const s = await get("/api/brain/index");
  assert.equal(s.status, 200);
  assert.equal(s.json.builtAt, null);
  assert.equal(s.json.passages, null);
  const r = await find("refunds");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { results: [], links: [], notFound: [], entities: [], builtAt: null });
});

test("refresh builds the index now and answers its status; a second refresh at once is 429 brain_busy", async () => {
  const r = await call(h.url, "POST", "/api/brain/index/refresh", { body: {} });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.building, false);
  assert.equal(typeof r.json.builtAt, "string");
  assert.equal(r.json.books, "ok");
  assert.ok(r.json.files >= 5);
  assert.ok(r.json.records >= 10);
  assert.ok(r.json.passages > r.json.records);
  assert.ok(Array.isArray(r.json.truncated));
  const again = await call(h.url, "POST", "/api/brain/index/refresh", { body: {} });
  assert.equal(again.status, 429);
  assert.equal(again.json.error.code, "brain_busy");
  assert.match(again.text, /The brain was refreshed a moment ago\./);
  const s = await get("/api/brain/index");
  assert.equal(s.json.builtAt, r.json.builtAt);
});

test("find: what did we promise Acme -> the call first, Acme's record, the invoice link, nothing missing", async () => {
  const r = await find("what did we promise Acme");
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.results[0].source, "calls/acme-call.md");
  assert.ok(sourcesOf(r).includes("books:Customer:Acme Interiors"));
  assert.ok(r.json.links.some((l) => l.type === "invoice_of" && l.from.name === "ACC-SINV-2026-00003" && l.to.name === "Acme Interiors"));
  assert.deepEqual(r.json.notFound, []);
  assert.equal(typeof r.json.builtAt, "string");
  const named = await find("what did we promise Acme Interiors");
  assert.deepEqual(named.json.entities.find((e) => e.key === "customer:Acme Interiors"), { type: "customer", key: "customer:Acme Interiors", name: "Acme Interiors" });
  for (const x of r.json.results) {
    assert.deepEqual(Object.keys(x).sort(), ["at", "kind", "link", "locator", "n", "source", "text", "title"]);
  }
});

test("find: a word the brain does not hold is named; nothing found is empty", async () => {
  const a = await find("warranty for Acme");
  assert.deepEqual(a.json.notFound, ["warranty"]);
  assert.ok(a.json.results.length > 0);
  const z = await find("zebra quantum");
  assert.deepEqual(z.json.results, []);
  assert.deepEqual(z.json.notFound, ["zebra", "quantum"]);
});

test("find: refunds shows both files, and no source more than twice; no outsider's words anywhere", async () => {
  const r = await find("refunds");
  const sources = sourcesOf(r);
  assert.ok(sources.includes("policies/refunds.md") && sources.includes("policies/terms.md"));
  for (const s of new Set(sources)) assert.ok(sources.filter((x) => x === s).length <= 2, s);
  for (const q of ["Acme", "refunds", "Ravi", "what is unpaid", "support request"]) {
    const t = (await find(q)).text;
    for (const bad of FORBIDDEN) assert.ok(!t.includes(bad), `${q}: ${bad}`);
  }
});

test("find: a result's link opens a real brain file; a record's link names its page", async () => {
  const r = await find("what did we promise Acme");
  const file = r.json.results.find((x) => x.source === "calls/acme-call.md");
  assert.deepEqual(file.link, { page: "files", id: brainToken("calls/acme-call.md") });
  const opened = await get(`/api/brain/file/${file.link.id}`);
  assert.equal(opened.status, 200);
  assert.equal(opened.json.file.path, "calls/acme-call.md");
  assert.match(opened.json.text, /drawings by Friday/);
  const rec = r.json.results.find((x) => x.source === "books:Customer:Acme Interiors");
  assert.deepEqual(rec.link, { page: "books", id: "Acme Interiors" });
  const deal = (await find("Won deal Acme")).json.results.find((x) => x.source.startsWith("books:CRM Deal:"));
  if (deal) assert.equal(deal.link.page, "customers");
  const t = (await find("support request")).json.results.find((x) => x.source.startsWith("books:HD Ticket:"));
  if (t) assert.equal(t.link.page, "support");
  const staff = (await find("Priya Nair")).json.results.find((x) => x.source.startsWith("books:Employee:"));
  if (staff) assert.equal(staff.link.page, "people");
});

test("find: a short query and a long query are refused in the search route's words", async () => {
  const short = await find("a");
  assert.equal(short.status, 400);
  assert.equal(short.json.error.code, "query_too_short");
  assert.match(short.text, /Type at least two letters to search\./);
  const long = await find("x".repeat(201));
  assert.equal(long.status, 400);
  assert.equal(long.json.error.code, "query_too_long");
  assert.match(long.text, /That search is too long\./);
  const none = await get("/api/brain/find");
  assert.equal(none.json.error.code, "query_too_short");
});

test("find: hostile queries are plain words, never syntax", async () => {
  for (const q of ['") OR 1=1 --', "NEAR(", "**", '""', "(".repeat(150)]) {
    const r = await find(q);
    assert.equal(r.status, 200, q);
    assert.deepEqual(Object.keys(r.json).sort(), ["builtAt", "entities", "links", "notFound", "results"]);
  }
});

test("links: Acme's view holds Ravi (contact_of, from), records, and starts with its own passage; every passage has a link", async () => {
  const r = await get(`/api/brain/links/${b64("customer:Acme Interiors")}`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.entity, { type: "customer", key: "customer:Acme Interiors", name: "Acme Interiors" });
  assert.ok(r.json.linked.some((l) => l.type === "contact_of" && l.direction === "from" && l.entity.name === "Ravi Menon"));
  assert.ok(r.json.linked.length >= 3);
  assert.equal(r.json.passages[0].source, "books:Customer:Acme Interiors");
  for (const p of r.json.passages) assert.ok("link" in p);
  assert.ok(r.json.passages.some((p) => p.link?.page === "files"));
});

test("links: an unknown key, an odd key and a long key are 404 entity_not_found", async () => {
  for (const key of [b64("customer:Nobody"), b64("x".repeat(201)), "not*base64", b64("customer:A\u0000B"), "A".repeat(500)]) {
    const r = await get(`/api/brain/links/${key}`);
    assert.equal(r.status, 404, key.slice(0, 20));
    assert.equal(r.json.error.code, "entity_not_found");
    assert.match(r.text, /That is not in the brain's index\./);
  }
});

test("a key that looks like SQL is only a bound value", async () => {
  const r = await get(`/api/brain/links/${b64("customer:x' OR '1'='1")}`);
  assert.equal(r.status, 404);
});

// T18's finding 4: everything is off until the owner switches it on.
test("with the brain switch off: every route answers the server's one sentence; no index is built, the books are not asked", async () => {
  const t = await home();
  try {
    const OFF = "The brain is off. Switch it on in Settings.";
    const answers = [
      await call(t.url, "GET", "/api/brain/index"),
      await call(t.url, "POST", "/api/brain/index/refresh", { body: {} }),
      await call(t.url, "GET", `/api/brain/find?q=${encodeURIComponent("what did we promise Acme")}`),
      await call(t.url, "GET", `/api/brain/links/${b64("customer:Acme Interiors")}`),
    ];
    for (const r of answers) {
      assert.equal(r.status, 409, r.text);
      assert.deepEqual(r.json.error, { message: OFF, next: "", code: "brain_off" });
    }
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(existsSync(t.config.paths.brainIndex), false, "no index was built");
    assert.deepEqual(t.bench.requests.filter((r) => r.path.startsWith("/api/resource/")), [], "the books were not asked");
    // Switched on, the same address starts the first build.
    updateDoors(t.config, (s) => { s.brain.on = true; });
    assert.equal((await call(t.url, "GET", "/api/brain/index")).status, 200);
  } finally { await t.close(); }
});
