// The core: /healthz, module discovery (the seam for the next wave), ctx helpers, stubs mode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { benchSeed } from "../../../test/stubs/seed.mjs";
import { SERVER_DIR } from "../lib/app.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { call } from "../lib/testing.mjs";

const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "main.mjs");

// A module folder holding only the core's own modules (symlinked), so a test does not change when feature
// modules are added to routes/, inbox/ or search/. Remove it with rmSync when done.
const CORE_MODULES = {
  routes: ["company", "files", "goals", "health", "inbox", "search", "state"],
  inbox: ["board", "goals"],
  search: ["goals"],
};
function coreModuleDir() {
  const dir = mkdtempSync(join(tmpdir(), "uuu-home-core-"));
  for (const [kind, names] of Object.entries(CORE_MODULES)) {
    mkdirSync(join(dir, kind));
    for (const n of names) symlinkSync(join(SERVER_DIR, kind, `${n}.mjs`), join(dir, kind, `${n}.mjs`));
  }
  return dir;
}

function moduleDir(files) {
  const dir = mkdtempSync(join(tmpdir(), "uuu-home-mods-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

test("/healthz", async () => {
  const h = await startStubsHome({ port: 0 });
  try {
    const r = await call(h.url, "GET", "/healthz");
    assert.equal(r.status, 200);
    assert.equal(r.text, '{"status":"ok","part":"home"}');
  } finally { await h.close(); }
});

test("modules are discovered at start; broken ones are skipped and listed", async () => {
  const dir = moduleDir({
    "routes/extra.mjs": `export default function register(app) {
      app.get("/api/extra/:name", (ctx) => ({ hello: ctx.params.name, q: ctx.query.x || null }));
      app.post("/api/extra", (ctx) => ({ status: 201, body: { got: ctx.body } }));
      app.delete("/api/extra/:name", () => ({ ok: true }));
      app.get("/api/extra-fail", (ctx) => { throw ctx.fail(409, "Already there.", "Pick another name.", "taken"); });
      app.get("/api/extra-crash", () => { throw new Error("secret detail /Users/x"); });
    }\n`,
    "routes/syntax.mjs": "export default function register(app) { this is not javascript }\n",
    "routes/shape.mjs": "export default { notAFunction: true };\n",
    "routes/clash.mjs": `export default function register(app) {
      app.get("/api/clash-ok", () => ({}));
      app.get("/api/state", () => ({ stolen: true }));
    }\n`,
    "inbox/extra.mjs": `export default { id: "extra",
      async list() { return { items: [{ id: "extra:1", source: "marketing", kind: "draft", title: "A post", raisedBy: "Marketer",
        when: "2026-11-11T10:00:00.000Z", summary: "A draft post.", severity: "normal", details: [],
        actions: [{ id: "approve", label: "Approve", style: "primary", needsNote: false }], link: null }] }; },
      async act(ctx, itemId, action, note) { return { message: "Approved " + itemId + " via " + ctx.item.title + "." }; } };\n`,
    "inbox/bad.mjs": "export default { id: 'bad' };\n",
    "search/extra.mjs": `export default { id: "extra", label: "Extra", async search(ctx, q) { return Array.from({ length: 12 }, (_, i) => ({ title: q + i, snippet: "", link: { page: "x", id: String(i) } })); } };\n`,
    "search/off.mjs": `export default { id: "off", label: "Off", async search() { return { notSearched: "The books are not installed." }; } };\n`,
    "search/throws.mjs": `export default { id: "throws", label: "Throws", async search() { throw new Error("detail /Users/x"); } };\n`,
    "search/bad.mjs": "export default { id: 'bad', search() {} };\n",
  });
  const lines = [];
  const core = coreModuleDir();
  const h = await startStubsHome({ port: 0, moduleDirs: [core, dir], log: (l) => lines.push(l) });
  try {
    const health = (await call(h.url, "GET", "/api/health")).json;
    assert.deepEqual(health.modulesFailed.map((m) => m.file).sort(), ["inbox/bad.mjs", "routes/clash.mjs", "routes/shape.mjs", "routes/syntax.mjs", "search/bad.mjs"]);
    for (const m of health.modulesFailed) assert.equal(typeof m.error, "string");
    assert.ok(lines.some((l) => l.includes("routes/syntax.mjs")));

    // a module that failed half way has none of its routes
    assert.equal((await call(h.url, "GET", "/api/clash-ok")).status, 404);
    assert.ok(!("stolen" in (await call(h.url, "GET", "/api/state")).json));

    const g = await call(h.url, "GET", "/api/extra/bob?x=1");
    assert.deepEqual(g.json, { hello: "bob", q: "1" });
    const p = await call(h.url, "POST", "/api/extra", { body: { a: 1 } });
    assert.equal(p.status, 201);
    assert.deepEqual(p.json, { got: { a: 1 } });
    assert.equal((await call(h.url, "DELETE", "/api/extra/bob")).status, 200);
    assert.equal((await call(h.url, "DELETE", "/api/extra/bob", { bare: true })).status, 403);
    const f = await call(h.url, "GET", "/api/extra-fail");
    assert.equal(f.status, 409);
    assert.deepEqual(f.json, { error: { message: "Already there.", next: "Pick another name.", code: "taken" } });
    const c = await call(h.url, "GET", "/api/extra-crash");
    assert.equal(c.status, 500);
    assert.ok(!c.text.includes("secret detail"));
    assert.equal(c.json.error.code, "internal");

    const inbox = (await call(h.url, "GET", "/api/inbox")).json;
    assert.ok(inbox.items.some((i) => i.id === "extra:1"));
    assert.equal(inbox.counts.bySource.marketing, 1);
    const act = await call(h.url, "POST", "/api/inbox/act", { body: { id: "extra:1", action: "approve" } });
    assert.deepEqual(act.json, { ok: true, message: "Approved extra:1 via A post." });

    const s = (await call(h.url, "GET", "/api/search?q=ab")).json;
    const extra = s.groups.find((x) => x.source === "extra");
    assert.equal(extra.label, "Extra");
    assert.equal(extra.results.length, 8);
    const ns = Object.fromEntries(s.notSearched.map((n) => [n.source, n.reason]));
    assert.equal(ns.off, "The books are not installed.");
    assert.ok(ns.throws && !ns.throws.includes("/Users/x"));
  } finally {
    await h.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(core, { recursive: true, force: true });
  }
});

test("ctx.bench: reads the owner key at call time, never shows or logs it", async () => {
  const KEY = "K3Yzzqq", SECRET = "S3CRETzzqq";
  const seed = benchSeed();
  seed.users[`${KEY}:${SECRET}`] = { ...seed.users["owner:owner"] };
  seed.missingDoctypes = ["HD Ticket"];
  const dir = moduleDir({
    "routes/probe.mjs": `export default function register(app) {
      app.get("/api/probe", async (ctx) => ({
        installed: ctx.bench.installed(),
        hasInvoice: await ctx.bench.has("Sales Invoice"),
        hasTicket: await ctx.bench.has("HD Ticket"),
        list: await ctx.bench.get("/api/resource/Sales Invoice", { fields: ["name", "docstatus"], filters: [["docstatus", "=", 1]], limit_page_length: 10 }),
      }));
      app.get("/api/probe-missing", async (ctx) => ctx.bench.get("/api/resource/Sales Invoice/NOPE"));
      app.get("/api/probe-ids", (ctx) => ({ ids: ctx.ids(), dec: ctx.decisions.set("k", "v") && ctx.decisions.get("k") }));
    }\n`,
  });
  const lines = [];
  const h = await startStubsHome({ port: 0, benchSeed: seed, moduleDirs: [SERVER_DIR, dir], log: (l) => lines.push(l) });
  try {
    writeFileSync(join(h.state, "secrets", "bench-owner-api.txt"), `${KEY}\n${SECRET}\n`, { mode: 0o600 });
    const r = await call(h.url, "GET", "/api/probe");
    assert.equal(r.status, 200);
    assert.equal(r.json.installed, true);
    assert.equal(r.json.hasInvoice, true);
    assert.equal(r.json.hasTicket, false);
    assert.equal(r.json.list.data.length, 3);
    const sent = h.bench.requests.filter((x) => x.path.startsWith("/api/resource/"));
    assert.ok(sent.every((x) => x.headers.authorization === `token ${KEY}:${SECRET}` && x.headers["x-frappe-site-name"] === "engine.localhost"));
    const m = await call(h.url, "GET", "/api/probe-missing");
    assert.equal(m.status, 404);
    rmSync(join(h.state, "secrets", "bench-owner-api.txt"));
    const nokey = await call(h.url, "GET", "/api/probe");
    assert.equal(nokey.status, 502);
    assert.equal(nokey.json.error.code, "bench_no_key");
    for (const text of [r.text, m.text, nokey.text, ...lines]) {
      assert.ok(!text.includes(KEY) && !text.includes(SECRET), text);
    }
    const ids = (await call(h.url, "GET", "/api/probe-ids")).json;
    assert.equal(ids.ids.projectFolder, join(h.state, "tasks", "company-work"));
    assert.equal(ids.dec, "v");
    assert.equal(JSON.parse(readFileSync(join(h.state, "home", "decisions.json"), "utf8")).k, "v");
  } finally {
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
  const off = await startStubsHome({ port: 0, benchInstalled: false });
  try {
    assert.equal(off.app.home.urls.gate, null);
    const s = (await call(off.url, "GET", "/api/state")).json;
    assert.equal(s.engine.books, "not_installed");
  } finally { await off.close(); }
});

test("main.mjs --stubs serves on its own temp state and stops on TERM", async () => {
  const child = spawn(process.execPath, [MAIN, "--stubs", "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const url = await new Promise((resolve, reject) => {
      let out = "";
      const t = setTimeout(() => reject(new Error(`no start line: ${out}`)), 10000);
      child.stdout.on("data", (c) => {
        out += c;
        const m = /on (http:\/\/127\.0\.0\.1:\d+)/.exec(out);
        if (m) { clearTimeout(t); resolve(m[1]); }
      });
      child.on("exit", () => reject(new Error(`exited: ${out}`)));
    });
    assert.equal((await call(url, "GET", "/healthz")).status, 200);
    const inbox = (await call(url, "GET", "/api/inbox")).json;
    assert.ok(inbox.items.length >= 4);
  } finally {
    const done = new Promise((r) => child.on("exit", r));
    child.kill("SIGTERM");
    assert.equal(await done, 0);
  }
});

test("main.mjs refuses unknown options", async () => {
  const child = spawn(process.execPath, [MAIN, "--nonsense"], { stdio: "ignore" });
  const code = await new Promise((r) => child.on("exit", r));
  assert.equal(code, 64);
});
