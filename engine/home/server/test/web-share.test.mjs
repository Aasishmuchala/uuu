// Sharing a company file with the Researcher (PLAN-V5 K10, T32): POST /api/web/share copies a listed text or
// table file of the brain into <state>/knowledge/shared/ under its own clean name, within the caps, and the copy
// goes when it is unmarked or its brain file is deleted. A stub home; every file is made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { copyName, listShared, share, SHARE_MAX_FILES } from "../lib/shared-brain.mjs";

const token = (path) => Buffer.from(path, "utf8").toString("base64url");
const mode = (p) => statSync(p).mode & 0o777;

async function withHome(fn) {
  const h = await startV2({ routes: ["web", "brain"], inbox: [], search: [], port: 0 });
  try { return await fn(h); } finally { await h.close(); }
}
const shareFile = (h, path, on = true) => call(h.url, "POST", "/api/web/share", { body: { token: token(path), share: on } });
const sharedDir = (h) => h.config.paths.sharedBrain;
const docs = (h) => h.config.paths.knowledgeDocs;
function brainWrite(h, rel, content) {
  const file = join(docs(h), rel);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, content, { mode: 0o644 });
  return file;
}

test("a text file is copied under its own clean name, listed with where it came from, and removed when unmarked", async () => {
  await withHome(async (h) => {
    const r = await shareFile(h, "pricing/services.md");
    assert.equal(r.status, 200);
    const copy = join(sharedDir(h), "services.md");
    assert.equal(readFileSync(copy, "utf8"), readFileSync(join(docs(h), "pricing", "services.md"), "utf8"));
    assert.equal(mode(copy), 0o644);
    assert.equal(mode(sharedDir(h)), 0o755);
    const manifest = join(h.config.paths.homeData, "shared-brain.json");
    assert.equal(mode(manifest), 0o600, "which brain file each copy is, kept where the Researcher cannot read");
    assert.deepEqual(r.json.shared.map((f) => [f.name, f.source, f.path, f.token]), [["services.md", "brain", "pricing/services.md", token("pricing/services.md")]]);
    assert.equal(r.json.sharedTotals.files, 1);

    // Sharing again is the same copy; unsharing removes it; unsharing again is no error.
    assert.equal((await shareFile(h, "pricing/services.md")).json.shared.length, 1);
    const off = await shareFile(h, "pricing/services.md", false);
    assert.equal(off.status, 200);
    assert.deepEqual(off.json.shared, []);
    assert.equal(existsSync(copy), false);
    assert.equal((await shareFile(h, "pricing/services.md", false)).status, 200);

    // A table, and a loose file.
    assert.equal((await shareFile(h, "payment-terms.md")).status, 200);
    brainWrite(h, "pricing/rates.csv", "item,price\nvisit,500\n");
    assert.equal((await shareFile(h, "pricing/rates.csv")).status, 200);
    assert.deepEqual(readdirSync(sharedDir(h)).sort(), ["payment-terms.md", "rates.csv"]);
  });
});

test("sharing a picture or a PDF is refused, and so is a token that names no listed brain file", async () => {
  await withHome(async (h) => {
    let r = await shareFile(h, "references/sample.png");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "not_shareable");
    assert.equal(r.json.error.message, "Only text and table files can be shared with the Researcher.");
    brainWrite(h, "references/plan.pdf", "%PDF-1.4\n%made up\n");
    r = await shareFile(h, "references/plan.pdf");
    assert.equal(r.json.error.code, "not_shareable");
    // A file named as text that is not text.
    brainWrite(h, "company/odd.md", Buffer.from([0x41, 0x00, 0x42, 0xff]));
    r = await shareFile(h, "company/odd.md");
    assert.equal(r.json.error.code, "not_shareable");
    for (const path of ["../ids.json", "../../secrets/web-key", "tasks/company-work/STH-1/notes.md", "nothing/here.md", "pricing/missing.md", ".hidden.md"]) {
      r = await shareFile(h, path);
      assert.equal(r.status, 404, path);
      assert.equal(r.json.error.code, "file_not_found");
    }
    r = await call(h.url, "POST", "/api/web/share", { body: { token: "not base64 !", share: true } });
    assert.equal(r.status, 404);
    r = await call(h.url, "POST", "/api/web/share", { body: { token: token("pricing/services.md"), share: "yes" } });
    assert.equal(r.status, 400);
    // A link in the brain is not a listed file.
    writeFileSync(join(h.state, "outside.md"), "the owner's private notes");
    symlinkSync(join(h.state, "outside.md"), join(docs(h), "pricing", "linked.md"));
    r = await shareFile(h, "pricing/linked.md");
    assert.equal(r.status, 404);
    assert.equal(existsSync(sharedDir(h)) ? readdirSync(sharedDir(h)).length : 0, 0, "nothing was copied");
  });
});

test("a shared file is removed when its brain file is deleted, and copied again when it changes", async () => {
  await withHome(async (h) => {
    await shareFile(h, "pricing/services.md");
    await shareFile(h, "company/about.md");
    const copy = join(sharedDir(h), "services.md");
    assert.ok(existsSync(copy));

    // Changed in the brain: the next listing copies it again.
    const src = join(docs(h), "company", "about.md");
    writeFileSync(src, "# About\n\nA new line about the company.\n");
    utimesSync(src, new Date(), new Date(Date.now() + 5000));
    let v = (await call(h.url, "GET", "/api/web")).json;
    assert.equal(readFileSync(join(sharedDir(h), "about.md"), "utf8"), "# About\n\nA new line about the company.\n");

    // Deleted through the brain's own route: gone from the shared folder at the next listing.
    const file = (await call(h.url, "GET", `/api/brain/file/${token("pricing/services.md")}`)).json.file;
    const del = await call(h.url, "DELETE", `/api/brain/file/${file.token}?version=${file.version}`);
    assert.equal(del.status, 200);
    v = (await call(h.url, "GET", "/api/web")).json;
    assert.deepEqual(v.shared.map((f) => f.name), ["about.md"]);
    assert.equal(existsSync(copy), false);
    // Unsharing a file the brain no longer has is still fine.
    assert.equal((await shareFile(h, "pricing/services.md", false)).status, 200);
  });
});

test("clean names: plain characters, never the brand kit's file, -2 when taken", async () => {
  assert.equal(copyName("Price List 2026.MD"), "price-list-2026.md");
  assert.equal(copyName("a  --  b.csv"), "a-b.csv");
  assert.equal(copyName("Notes.txt"), "notes.txt");
  assert.equal(copyName("plan.png"), null);
  await withHome(async (h) => {
    brainWrite(h, "services.md", "loose services\n");
    brainWrite(h, "brand-public.md", "a brain file of that name\n");
    brainWrite(h, "company/Site Visit Notes.md", "notes\n");
    mkdirSync(sharedDir(h), { recursive: true });
    writeFileSync(join(sharedDir(h), "brand-public.md"), "# Sthyra\n");
    await shareFile(h, "pricing/services.md");
    await shareFile(h, "services.md");
    await shareFile(h, "brand-public.md");
    const v = (await shareFile(h, "company/Site Visit Notes.md")).json;
    assert.deepEqual(v.shared.map((f) => [f.name, f.source]), [
      ["brand-public.md", "brand-kit"], ["brand-public-2.md", "brain"], ["services-2.md", "brain"], ["services.md", "brain"], ["site-visit-notes.md", "brain"],
    ]);
    assert.equal(readFileSync(join(sharedDir(h), "brand-public.md"), "utf8"), "# Sthyra\n", "the brand kit's file is never replaced");
    assert.equal(readFileSync(join(sharedDir(h), "services-2.md"), "utf8"), "loose services\n");
    assert.equal(v.shared[0].title, "The brand's public summary");
  });
});

test("at most 50 files and 5 MB in the shared folder", async () => {
  await withHome(async (h) => {
    for (let i = 0; i < SHARE_MAX_FILES; i += 1) brainWrite(h, `calls/note-${i}.md`, `note ${i}\n`);
    for (let i = 0; i < SHARE_MAX_FILES; i += 1) assert.equal((await shareFile(h, `calls/note-${i}.md`)).status, 200, String(i));
    brainWrite(h, "calls/one-more.md", "one more\n");
    let r = await shareFile(h, "calls/one-more.md");
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "share_full");
    assert.equal(existsSync(join(sharedDir(h), "one-more.md")), false);
    for (let i = 0; i < SHARE_MAX_FILES; i += 1) await shareFile(h, `calls/note-${i}.md`, false);

    const big = "x".repeat(2 * 1024 * 1024 - 10);
    for (const n of ["a", "b", "c"]) brainWrite(h, `calls/big-${n}.md`, big);
    assert.equal((await shareFile(h, "calls/big-a.md")).status, 200);
    assert.equal((await shareFile(h, "calls/big-b.md")).status, 200);
    r = await shareFile(h, "calls/big-c.md");
    assert.equal(r.json.error.code, "share_full");
    assert.equal(existsSync(join(sharedDir(h), "big-c.md")), false);
    const v = (await call(h.url, "GET", "/api/web")).json;
    assert.equal(v.sharedTotals.files, 2);
    assert.ok(v.sharedTotals.bytes <= 5 * 1024 * 1024);
  });
});

test("a shared folder that is a link is refused and nothing is written through it", async () => {
  await withHome(async (h) => {
    const elsewhere = join(h.state, "elsewhere");
    mkdirSync(elsewhere);
    mkdirSync(join(h.state, "knowledge"), { recursive: true });
    symlinkSync(elsewhere, sharedDir(h));
    const r = await shareFile(h, "pricing/services.md");
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "folder_unsafe");
    assert.deepEqual(readdirSync(elsewhere), []);
    const v = (await call(h.url, "GET", "/api/web")).json;
    assert.equal(v.problem, "folder_unsafe");
    assert.deepEqual(v.shared, []);
    assert.ok(lstatSync(sharedDir(h)).isSymbolicLink());
  });
});

test("the lib refuses alone too: share and listShared without the routes", async () => {
  await withHome(async (h) => {
    assert.throws(() => share(h.config, token("references/sample.png"), true), (e) => e.code === "not_shareable");
    share(h.config, token("pricing/services.md"), true);
    assert.deepEqual(listShared(h.config).files.map((f) => f.name), ["services.md"]);
    rmSync(join(docs(h), "pricing", "services.md"));
    assert.deepEqual(listShared(h.config).files, []);
  });
});
