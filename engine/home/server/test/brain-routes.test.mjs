// The company brain's routes (CONTRACTS-V3 33.6), on the version 3 seed with only this feature's modules:
// the overview and its shape, a folder, a file, its bytes (pictures sandboxed with their real type, PDF and
// text as attachments, never HTML), adding with the 14 MB body limit and every refusal, moving, deleting,
// searching. The old /api/knowledge routes are not touched (knowledge.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brainToken } from "../brain/store.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n");

async function withHome(fn) {
  const h = await startV2({ routes: ["brain", "search"], search: ["brain"] });
  h.config.minFreeDiskGb = 0;
  try { return await fn(h); } finally { await h.close(); }
}
const docs = (h) => join(h.state, "knowledge", "docs");
const add = (h, body) => call(h.url, "POST", "/api/brain/files", { body });
const get = (h, path) => call(h.url, "GET", path);
const isHtml = (r) => String(r.headers["content-type"] || "").includes("html");

test("GET /api/brain fits its shape: ten folders, nine basics, the starters, totals and limits", async () => {
  await withHome(async (h) => {
    const r = await get(h, "/api/brain");
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("brain"), r.json), []);
    assert.deepEqual(r.json.folders.map((f) => f.id), ["company", "brand", "pricing", "policies", "people", "customers", "calls", "references", "packs", "loose"]);
    const count = Object.fromEntries(r.json.folders.map((f) => [f.id, f.files]));
    assert.deepEqual(count, { company: 1, brand: 2, pricing: 1, policies: 0, people: 0, customers: 0, calls: 1, references: 1, packs: 1, loose: 2 });
    assert.equal(r.json.basics.total, 9);
    assert.equal(r.json.basics.items.length, 9);
    for (const b of r.json.basics.items) assert.equal(b.token, brainToken(b.file));
    assert.equal(r.json.basics.items.find((b) => b.form === "about").state, "empty");
    assert.equal(r.json.basics.items.find((b) => b.form === "brand").state, "filled");
    assert.equal(r.json.basics.filled, r.json.basics.items.filter((b) => b.state === "filled").length);
    assert.equal(r.json.totals.files, 9);
    assert.ok(r.json.totals.bytes > 0);
    assert.deepEqual(r.json.limits, {
      imageBytes: 10485760, textBytes: 2097152, files: 500, totalBytes: 209715200,
      endings: [".md", ".txt", ".csv", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"],
    });
    assert.ok(r.json.recent.length >= 1 && r.json.recent.length <= 10);
    for (const f of r.json.recent) assert.deepEqual(sameShape(readShape("brain-file"), f), []);
  });
});

test("the starters come from the repo's pages; a page already in Packs shows as added", async () => {
  await withHome(async (h) => {
    const r = await get(h, "/api/brain");
    const ids = r.json.starters.map((s) => s.id);
    const repo = join(h.config.engineDir, "company", "brain", "starters", "packs");
    if (existsSync(join(repo, "carousel.md"))) {
      assert.ok(ids.includes("carousel"));
      assert.equal(r.json.starters.find((s) => s.id === "carousel").added, true);
      for (const s of r.json.starters) {
        assert.ok(s.title.length > 0 && s.about.length > 0 && s.about.length <= 140, s.id);
        if (s.id !== "carousel") assert.equal(s.added, false, s.id);
      }
      assert.ok(ids.indexOf("call-write-up") < ids.indexOf("carousel"));
    }
  });
});

test("the two root documents of the seed show under loose", async () => {
  await withHome(async (h) => {
    const r = await get(h, "/api/brain/folder/loose");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.files.map((f) => f.name).sort(), ["payment-terms.md", "returns-policy.md"]);
    for (const f of r.json.files) { assert.equal(f.folder, "loose"); assert.equal(f.path, f.name); assert.equal(f.form, null); }
    assert.deepEqual(r.json.forms, []);
    assert.equal(r.json.folder.title, "Loose files");
  });
});

test("GET /api/brain/folder/:id: files newest first, the forms of that folder, 404 for any other id", async () => {
  await withHome(async (h) => {
    const r = await get(h, "/api/brain/folder/brand");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.files.map((f) => f.name).sort(), ["brand.md", "cant-say.md"]);
    for (const f of r.json.files) assert.deepEqual(sameShape(readShape("brain-file"), f), []);
    const times = r.json.files.map((f) => Date.parse(f.changedAt));
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
    assert.deepEqual(r.json.forms.map((f) => f.id), ["brand", "cant-say"]);
    for (const f of r.json.forms) assert.ok(["filled", "empty", "missing"].includes(f.state));
    for (const bad of ["nope", "..", "%2e%2e", "brand%2F..", "Brand"]) {
      const x = await get(h, `/api/brain/folder/${bad}`);
      assert.equal(x.status, 404, bad);
      assert.equal(x.json.error.code, "folder_not_found");
    }
  });
});

test("GET /api/brain/file/:token: text as JSON, a picture with no text, 404 for a token not in the listing", async () => {
  await withHome(async (h) => {
    const t = await get(h, `/api/brain/file/${brainToken("brand/brand.md")}`);
    assert.equal(t.status, 200);
    assert.match(t.headers["content-type"], /^application\/json/);
    assert.equal(t.json.text, readFileSync(join(docs(h), "brand", "brand.md"), "utf8"));
    assert.equal(t.json.truncated, false);
    assert.deepEqual(sameShape(readShape("brain-file"), t.json.file), []);
    const img = await get(h, `/api/brain/file/${brainToken("references/sample.png")}`);
    assert.equal(img.json.text, null);
    assert.equal(img.json.file.kind, "image");
    for (const p of ["brand/nope.md", "../ids.json", "home/decisions.json", "brand/../brand/brand.md"]) {
      const x = await get(h, `/api/brain/file/${brainToken(p)}`);
      assert.equal(x.status, 404, p);
      assert.equal(x.json.error.code, "file_not_found");
    }
  });
});

test("GET /api/brain/raw: a picture inline with its real type and the sandbox policy; ?download=1 is an attachment", async () => {
  await withHome(async (h) => {
    const tok = brainToken("references/sample.png");
    const r = await get(h, `/api/brain/raw/${tok}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "image/png");
    assert.match(r.headers["content-disposition"], /^inline; filename="sample.png"$/);
    assert.equal(r.headers["content-security-policy"], "default-src 'none'; sandbox");
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.deepEqual(r.buffer, readFileSync(join(docs(h), "references", "sample.png")));
    const d = await get(h, `/api/brain/raw/${tok}?download=1`);
    assert.equal(d.headers["content-type"], "application/octet-stream");
    assert.match(d.headers["content-disposition"], /^attachment; /);
  });
});

test("GET /api/brain/raw: a PDF, a table and text are always attachments; nothing is ever answered as HTML", async () => {
  await withHome(async (h) => {
    const pdf = await add(h, { folder: "references", name: "brochure.pdf", base64: PDF.toString("base64") });
    const csv = await add(h, { folder: "pricing", name: "list.csv", text: "a,b\n1,2\n" });
    const html = await add(h, { folder: "calls", name: "looks-like-a-page.md", text: "<!doctype html><script>alert(1)</script>" });
    mkdirSync(join(docs(h), "references"), { recursive: true });
    writeFileSync(join(docs(h), "references", "fake.png"), "<html><body onload=alert(1)>");
    const tokens = [pdf.json.file.token, csv.json.file.token, html.json.file.token, brainToken("references/fake.png"), brainToken("brand/brand.md")];
    for (const t of tokens) {
      const r = await get(h, `/api/brain/raw/${t}`);
      assert.equal(r.status, 200, t);
      assert.equal(r.headers["content-type"], "application/octet-stream", t);
      assert.match(r.headers["content-disposition"], /^attachment; filename="[^"]+"$/, t);
      assert.ok(!isHtml(r), t);
    }
    for (const p of ["/api/brain", "/api/brain/folder/calls", `/api/brain/file/${html.json.file.token}`, "/api/brain/search?q=doctype",
      `/api/brain/raw/${brainToken("nope.md")}`]) {
      assert.ok(!isHtml(await get(h, p)), p);
    }
  });
});

test("POST /api/brain/files: pasted text is 201 with a brain-file; a second file of the same name is 409 and the first is untouched", async () => {
  await withHome(async (h) => {
    const r = await add(h, { folder: "policies", name: "warranty", text: "Two years on every cabinet." });
    assert.equal(r.status, 201);
    assert.deepEqual(sameShape(readShape("brain-file"), r.json.file), []);
    assert.equal(r.json.file.path, "policies/warranty.md");
    const p = join(docs(h), "policies", "warranty.md");
    assert.equal(statSync(p).mode & 0o111, 0);
    const again = await add(h, { folder: "policies", name: "warranty.md", text: "Something else." });
    assert.equal(again.status, 409);
    assert.equal(again.json.error.code, "file_exists");
    assert.equal(readFileSync(p, "utf8"), "Two years on every cabinet.");
    const seed = await add(h, { folder: "loose", name: "returns-policy.md", text: "replaced?" });
    assert.equal(seed.status, 409);
    assert.notEqual(readFileSync(join(docs(h), "returns-policy.md"), "utf8"), "replaced?");
  });
});

test("POST /api/brain/files: a file in base64; refusals with their pinned sentences", async () => {
  await withHome(async (h) => {
    const ok = await add(h, { folder: "references", name: "site.png", base64: PNG.toString("base64") });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.file.rawUrl, `/api/brain/raw/${ok.json.file.token}`);
    const cases = [
      [{ folder: "references", name: "photo.jpg", base64: PNG.toString("base64") }, 400, "kind_mismatch", "That file is not what its name says."],
      [{ folder: "brand", name: "logo.svg", base64: Buffer.from("<svg/>").toString("base64") }, 400, "name_type", "Only text, tables, pictures and PDF files can be added."],
      [{ folder: "brand", name: "page.html", text: "<p>hi</p>" }, 400, "name_type", null],
      [{ folder: "calls", name: "a.md", text: "a \0 b" }, 400, "kind_mismatch", null],
      [{ folder: "references", name: "d.pdf", base64: Buffer.from("not a pdf").toString("base64") }, 400, "kind_mismatch", null],
      [{ folder: "nowhere", name: "a.md", text: "hello" }, 404, "folder_not_found", null],
      [{ folder: "calls", name: "a.md", text: "x", base64: "eA==" }, 400, "bad_request", null],
      [{ folder: "calls", name: "a.png", base64: "not base64 at all!" }, 400, "bad_request", null],
      [{ folder: "calls", name: "a.md" }, 400, "bad_request", null],
    ];
    for (const [body, status, code, message] of cases) {
      const r = await add(h, body);
      assert.equal(r.status, status, JSON.stringify(body).slice(0, 80));
      assert.equal(r.json.error.code, code);
      if (message) assert.equal(r.json.error.message, message);
      assert.ok(r.json.error.next.length > 0);
    }
    assert.equal(existsSync(join(docs(h), "references", "photo.jpg")), false);
    assert.equal(existsSync(join(docs(h), "brand", "logo.svg")), false);
  });
});

test("the upload route takes a body over 2 MB (its own 14 MB limit), refuses text over 2 MB and a body over 14 MB", async () => {
  await withHome(async (h) => {
    const bigPng = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024, 7)]);
    const r = await add(h, { folder: "references", name: "big.png", base64: bigPng.toString("base64") });
    assert.equal(r.status, 201);
    assert.equal(r.json.file.size, bigPng.length);
    const t = await add(h, { folder: "calls", name: "long.md", text: "a".repeat(2 * 1024 * 1024 + 10) });
    assert.equal(t.status, 413);
    assert.equal(t.json.error.code, "too_large");
    const over = await add(h, { folder: "references", name: "huge.png", base64: Buffer.alloc(11 * 1024 * 1024).toString("base64") });
    assert.equal(over.status, 413);
    assert.equal(over.json.error.code, "too_large");
    assert.equal(existsSync(join(docs(h), "references", "huge.png")), false);
    const other = await call(h.url, "POST", "/api/brain/move", { body: { token: "x".repeat(3 * 1024 * 1024), folder: "calls", version: "1" } });
    assert.equal(other.status, 413);
  });
});

test("the 501st file is 409 brain_full; a disk under the floor is 409 disk_low", async () => {
  await withHome(async (h) => {
    h.config.minFreeDiskGb = 1e9;
    const low = await add(h, { folder: "calls", name: "a.md", text: "hello" });
    assert.equal(low.status, 409);
    assert.equal(low.json.error.code, "disk_low");
    h.config.minFreeDiskGb = 0;
    mkdirSync(join(docs(h), "customers"), { recursive: true });
    for (let i = 0; i < 491; i++) writeFileSync(join(docs(h), "customers", `c${i}.md`), "x");
    assert.equal((await get(h, "/api/brain")).json.totals.files, 500);
    const full = await add(h, { folder: "calls", name: "a.md", text: "hello" });
    assert.equal(full.status, 409);
    assert.equal(full.json.error.code, "brain_full");
  });
});

test("POST /api/brain/move: a stale version is 409; the right one moves the file; a name taken is 409", async () => {
  await withHome(async (h) => {
    const f = (await add(h, { folder: "calls", name: "visit.md", text: "visit notes" })).json.file;
    const move = (body) => call(h.url, "POST", "/api/brain/move", { body });
    const stale = await move({ token: f.token, folder: "customers", version: "1" });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.error.code, "changed_since_seen");
    assert.ok(existsSync(join(docs(h), "calls", "visit.md")));
    await add(h, { folder: "customers", name: "visit.md", text: "taken" });
    const taken = await move({ token: f.token, folder: "customers", version: f.version });
    assert.equal(taken.status, 409);
    assert.equal(taken.json.error.code, "file_exists");
    const ok = await move({ token: f.token, folder: "people", version: f.version });
    assert.equal(ok.status, 200);
    assert.deepEqual(sameShape(readShape("brain-file"), ok.json.file), []);
    assert.equal(ok.json.file.path, "people/visit.md");
    assert.equal(existsSync(join(docs(h), "calls", "visit.md")), false);
    assert.equal((await move({ token: f.token, folder: "people", version: f.version })).status, 404);
    assert.equal((await move({ folder: "people" })).status, 400);
  });
});

test("DELETE /api/brain/file/:token: a stale version is 409 and the file stays; the right one removes it", async () => {
  await withHome(async (h) => {
    const f = (await add(h, { folder: "calls", name: "old.md", text: "old notes" })).json.file;
    const stale = await call(h.url, "DELETE", `/api/brain/file/${f.token}?version=123`);
    assert.equal(stale.status, 409);
    assert.equal(stale.json.error.code, "changed_since_seen");
    const none = await call(h.url, "DELETE", `/api/brain/file/${f.token}`);
    assert.equal(none.status, 409);
    assert.ok(existsSync(join(docs(h), "calls", "old.md")));
    const ok = await call(h.url, "DELETE", `/api/brain/file/${f.token}?version=${f.version}`);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, { ok: true });
    assert.equal(existsSync(join(docs(h), "calls", "old.md")), false);
    const gone = await call(h.url, "DELETE", `/api/brain/file/${f.token}?version=${f.version}`);
    assert.equal(gone.status, 404);
    const bare = await call(h.url, "DELETE", `/api/brain/file/${f.token}?version=${f.version}`, { bare: true });
    assert.equal(bare.status, 403);
  });
});

test("GET /api/brain/search: words in the seed's files; at most 20; the global search has a Files group", async () => {
  await withHome(async (h) => {
    const r = await get(h, "/api/brain/search?q=Asha");
    assert.equal(r.status, 200);
    assert.ok(r.json.results.some((x) => x.path === "calls/2026-11-10-asha-kitchens.md"));
    for (const x of r.json.results) {
      assert.deepEqual(Object.keys(x).sort(), ["name", "path", "snippet", "token"]);
      assert.equal(x.token, brainToken(x.path));
    }
    assert.deepEqual((await get(h, "/api/brain/search?q=sample")).json.results.map((x) => x.path), ["references/sample.png"]);
    assert.deepEqual((await get(h, "/api/brain/search")).json.results, []);
    assert.equal((await get(h, `/api/brain/search?q=${encodeURIComponent('AND ( "')}`)).status, 200);
    for (let i = 0; i < 25; i++) await add(h, { folder: "calls", name: `c${i}.md`, text: "veneer sample" });
    assert.equal((await get(h, "/api/brain/search?q=veneer")).json.results.length, 20);
    const g = await get(h, "/api/search?q=veneer");
    const grp = g.json.groups.find((x) => x.source === "brain");
    assert.equal(grp.label, "Files");
    assert.equal(grp.results.length, 8);
    assert.equal(grp.results[0].link.page, "files");
    assert.ok(/^[A-Za-z0-9_-]+$/.test(grp.results[0].link.id));
  });
});

test("a folder that is a link: its files are not shown, and nothing is written through it", async () => {
  await withHome(async (h) => {
    const outside = join(h.state, "home");
    rmSync(join(docs(h), "brand"), { recursive: true, force: true });
    symlinkSync(outside, join(docs(h), "brand"));
    const r = await get(h, "/api/brain/folder/brand");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.files, []);
    const up = await add(h, { folder: "brand", name: "x.md", text: "through a link" });
    assert.equal(up.status, 404);
    assert.equal(up.json.error.code, "folder_not_found");
    assert.equal(existsSync(join(outside, "x.md")), false);
    const d = await get(h, `/api/brain/file/${brainToken("brand/decisions.json")}`);
    assert.equal(d.status, 404);
  });
});
