// Knowledge and lessons (CONTRACTS 9.7): upload, search (safe query), names, 409, 413, hand-dropped files, delete, lessons.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startStubsHome } from "../lib/stubs.mjs";
import { call } from "../lib/testing.mjs";

async function withHome(fn) {
  const h = await startStubsHome({ port: 0 });
  try { return await fn(h); } finally { await h.close(); }
}
const docsDir = (h) => join(h.state, "knowledge", "docs");
const post = (h, body) => call(h.url, "POST", "/api/knowledge", { body });
const search = (h, q) => call(h.url, "GET", `/api/knowledge/search?q=${encodeURIComponent(q)}`);

test("the seed lists two documents, and the stub server's list matches", async () => {
  await withHome(async (h) => {
    const r = await call(h.url, "GET", "/api/knowledge");
    assert.equal(r.status, 200);
    assert.equal(r.json.docs.length, 2);
    assert.deepEqual(r.json.docs.map((d) => d.id), ["payment-terms.md", "returns-policy.md"]);
    for (const d of r.json.docs) { assert.equal(d.id, d.name); assert.ok(d.size > 0); assert.ok(!Number.isNaN(Date.parse(d.addedAt))); }
  });
});

test("upload then search finds it with a plain snippet; the index is in the home data folder", async () => {
  await withHome(async (h) => {
    const r = await post(h, { name: "warranty.md", text: "Our warranty is 27 months." });
    assert.equal(r.status, 201);
    assert.equal(r.json.doc.id, "warranty.md");
    const s = await search(h, "warranty");
    assert.equal(s.status, 200);
    assert.equal(s.json.results.length, 1);
    assert.equal(s.json.results[0].docId, "warranty.md");
    assert.match(s.json.results[0].snippet, /27 months/);
    assert.ok(!/[<>]/.test(s.json.results[0].snippet));
    assert.ok(existsSync(join(h.state, "home", "knowledge.sqlite")));
    const g = await call(h.url, "GET", "/api/knowledge/doc/warranty.md");
    assert.equal(g.json.text, "Our warranty is 27 months.");
    const all = await call(h.url, "GET", "/api/search?q=warranty");
    assert.equal(all.json.groups.find((x) => x.source === "knowledge"), undefined, "the brain source replaced it (CONTRACTS-V3 24.2)");
    const grp = all.json.groups.find((x) => x.source === "brain");
    assert.equal(grp.results[0].title, "warranty.md");
    assert.equal(grp.results[0].link.page, "files");
  });
});

test("search words that are quotes, operators or odd characters never break the query", async () => {
  await withHome(async (h) => {
    await post(h, { name: "a.md", text: 'He said "hello" AND (world) NEAR OR NOT * ^ col:x' });
    for (const q of ['"', "AND (", "*", "a OR", 'NEAR("x" "y")', "col:x", "'; DROP TABLE docs_fts; --", '""', "^", "-", "\\", "name:warranty*", "é ü 日本"]) {
      const r = await search(h, q);
      assert.equal(r.status, 200, q);
      assert.ok(Array.isArray(r.json.results), q);
    }
    assert.equal((await search(h, "NEAR")).json.results.length, 1);
    assert.equal((await search(h, "hello AND")).json.results.length, 1);
    assert.equal((await search(h, "hello nonexistentword")).json.results.length, 0);
    const g = await call(h.url, "GET", `/api/search?q=${encodeURIComponent('AND (')}`);
    assert.equal(g.status, 200);
  });
});

test("names: path parts and dots are dropped, a missing ending becomes .md, bad types are refused", async () => {
  await withHome(async (h) => {
    const before = readdirSync(join(h.state, "knowledge"));
    const cases = [
      ["../x.md", "x.md"], ["..\\..\\y.md", "y.md"], ["/etc/passwd", "passwd.md"], [".hidden.md", "hidden.md"],
      ["notes", "notes.md"], ["my notes!.TXT", "my notes.txt"], ["..", null], ["", null], ["***", null], ["evil.sh", null], ["a.pdf", null],
      ["v1.2", "v1.2.md"], ["a\0b.md", "ab.md"],
    ];
    for (const [input, want] of cases) {
      const r = await post(h, { name: input, text: "hello there" });
      if (want) { assert.equal(r.status, 201, input); assert.equal(r.json.doc.name, want, input); }
      else assert.equal(r.status, 400, input);
    }
    const long = await post(h, { name: `${"a".repeat(300)}.md`, text: "x" });
    assert.equal(long.status, 201);
    assert.ok(long.json.doc.name.length <= 100 && long.json.doc.name.endsWith(".md"));
    for (const bad of [{ text: "x" }, { name: "a.md" }, { name: "a.md", text: "   " }, { name: 5, text: "x" }, { name: "a.md", text: 5 }]) {
      assert.equal((await post(h, bad)).status, 400, JSON.stringify(bad));
    }
    // nothing escaped the folder
    assert.deepEqual(readdirSync(join(h.state, "knowledge")), before);
    assert.ok(!existsSync(join(h.state, "x.md")) && !existsSync(join(h.state, "knowledge", "x.md")));
    // reading with hostile ids
    for (const id of ["..%2Fids.json", ".hidden.md", "a%2F..%2Fb.md", "ids.json", "%00.md"]) {
      const r = await call(h.url, "GET", `/api/knowledge/doc/${id}`);
      assert.equal(r.status, 404, id);
      const d = await call(h.url, "DELETE", `/api/knowledge/doc/${id}`);
      assert.equal(d.status, 404, id);
    }
    assert.ok(existsSync(join(h.state, "ids.json")));
  });
});

test("a second upload of the same name is 409 and keeps the first", async () => {
  await withHome(async (h) => {
    assert.equal((await post(h, { name: "dup.md", text: "first" })).status, 201);
    const r = await post(h, { name: "dup", text: "second" });
    assert.equal(r.status, 409);
    assert.match(r.json.error.message, /already/);
    assert.equal((await call(h.url, "GET", "/api/knowledge/doc/dup.md")).json.text, "first");
  });
});

test("text over 2 MB is 413, just under is accepted", async () => {
  await withHome(async (h) => {
    const big = await post(h, { name: "big.md", text: "é".repeat(1024 * 1024 + 1) });
    assert.equal(big.status, 413);
    assert.ok(!existsSync(join(docsDir(h), "big.md")));
    const huge = await post(h, { name: "huge.md", text: "x".repeat(2 * 1024 * 1024 + 10) });
    assert.equal(huge.status, 413);
    assert.equal((await post(h, { name: "ok.md", text: "x".repeat(1024 * 1024) })).status, 201);
  });
});

test("a file dropped in by hand is listed and found; a changed file is found by its new text; links and odd names are ignored", async () => {
  await withHome(async (h) => {
    writeFileSync(join(docsDir(h), "handmade.txt"), "The showroom opens at nine in the morning.");
    writeFileSync(join(docsDir(h), "ignore.pdf"), "pdf text zebra");
    writeFileSync(join(docsDir(h), ".secret.md"), "zebra secret");
    symlinkSync(join(h.state, "ids.json"), join(docsDir(h), "link.md"));
    const l = await call(h.url, "GET", "/api/knowledge");
    assert.deepEqual(l.json.docs.map((d) => d.id), ["handmade.txt", "payment-terms.md", "returns-policy.md"]);
    assert.equal((await search(h, "showroom")).json.results[0].docId, "handmade.txt");
    assert.equal((await search(h, "zebra")).json.results.length, 0);
    assert.equal((await search(h, "company")).json.results.length, 0);
    writeFileSync(join(docsDir(h), "handmade.txt"), "The showroom is closed on Sundays, always.");
    assert.equal((await search(h, "Sundays")).json.results.length, 1);
    assert.equal((await search(h, "nine")).json.results.length, 0);
  });
});

test("delete removes the file and the index row", async () => {
  await withHome(async (h) => {
    await post(h, { name: "gone.md", text: "ephemeral platypus" });
    assert.equal((await search(h, "platypus")).json.results.length, 1);
    const d = await call(h.url, "DELETE", "/api/knowledge/doc/gone.md");
    assert.deepEqual(d.json, { ok: true });
    assert.ok(!existsSync(join(docsDir(h), "gone.md")));
    assert.equal((await search(h, "platypus")).json.results.length, 0);
    assert.equal((await call(h.url, "DELETE", "/api/knowledge/doc/gone.md")).status, 404);
    assert.equal((await call(h.url, "GET", "/api/knowledge/doc/gone.md")).status, 404);
  });
});

test("a damaged index is rebuilt; the folders are created when missing", async () => {
  await withHome(async (h) => {
    await call(h.url, "GET", "/api/knowledge");
    writeFileSync(join(h.state, "home", "knowledge.sqlite"), "this is not a database");
    const s = await search(h, "returns");
    assert.equal(s.status, 200);
    assert.equal(s.json.results[0].docId, "returns-policy.md");
  });
});

test("search results are best first, at most 20, and the snippet is about 160 characters", async () => {
  await withHome(async (h) => {
    for (let i = 0; i < 25; i++) await post(h, { name: `bulk${i}.md`, text: `${"filler ".repeat(60)}needle ${"more ".repeat(60)}` });
    const s = await search(h, "needle");
    assert.equal(s.json.results.length, 20);
    assert.ok(s.json.results[0].snippet.length <= 170);
    assert.match(s.json.results[0].snippet, /needle/);
  });
});

test("lessons from the seed are listed by role", async () => {
  await withHome(async (h) => {
    writeFileSync(join(h.state, "lessons", "sales.md"), "");
    writeFileSync(join(h.state, "lessons", "chief-of-staff.md"), "notes\n- 2026-11-01: Ask first.\n  - indented\n-no space\n");
    const r = await call(h.url, "GET", "/api/lessons");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.roles.map((x) => x.slug), ["builder", "chief-of-staff", "sales"]);
    const b = r.json.roles[0];
    assert.equal(b.name, "Builder");
    assert.equal(b.lessons.length, 2);
    assert.match(b.lessons[0], /^2026-11-09: Keep each goal/);
    assert.equal(r.json.roles[1].name, "Chief of staff");
    assert.deepEqual(r.json.roles[1].lessons, ["2026-11-01: Ask first."]);
    assert.deepEqual(r.json.roles[2].lessons, []);
  });
});
