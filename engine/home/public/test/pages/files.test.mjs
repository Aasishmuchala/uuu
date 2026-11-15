// The Files page's pure helpers (CONTRACTS-V3 30 "Files", 33.6), on the pinned `brain` and `brain-file` shapes.
// Dropped from the old Docs page's test, with the reason: cleanName and canRead (adding a file is now
// brain/new-file.js, M29, which checks names and kinds with the kit's FilePicker and the server's refusals).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The shape files sit beside the server, outside this tree: found by walking up from this file.
const SHAPES = (() => { let d = dirname(fileURLToPath(import.meta.url)); for (;;) { const c = join(d, "server", "test", "shapes"); if (existsSync(c)) return c; const p = dirname(d); if (p === d) throw new Error("shape files not found"); d = p; } })();
const shape = (name) => JSON.parse(readFileSync(resolve(SHAPES, `${name}.json`), "utf8"));
const SOURCE = readFileSync(new URL("../../pages/files.js", import.meta.url), "utf8");

const mod = await import("../../pages/files.js");
const brain = shape("brain");
const file = shape("brain-file");

test("files: the page is a component", () => {
  assert.equal(typeof mod.default, "function");
});

test("files: filesHref keeps every state in the address", () => {
  assert.equal(mod.filesHref(), "#/files");
  assert.equal(mod.filesHref({ folder: "brand" }), "#/files/brand");
  assert.equal(mod.filesHref({ folder: "brand", file: file.token }), `#/files/brand?file=${file.token}`);
  assert.equal(mod.filesHref({ q: " returns " }), "#/files?q=returns");
  assert.equal(mod.filesHref({ tab: "lessons" }), "#/files?tab=lessons");
  assert.equal(mod.filesHref({ folder: "pricing", mode: "form:services" }), "#/files/pricing?new=form%3Aservices");
  assert.equal(mod.filesHref({ folder: "../x", file: "a/b", mode: "html" }), "#/files");
});

test("files: newMode reads ?new= and refuses anything else", () => {
  assert.deepEqual(mod.newMode("paste"), { mode: "paste" });
  assert.deepEqual(mod.newMode("upload"), { mode: "upload" });
  assert.deepEqual(mod.newMode("form:brand"), { mode: "form", form: "brand" });
  assert.equal(mod.newMode("form:"), null);
  assert.equal(mod.newMode("form:../x"), null);
  assert.equal(mod.newMode(""), null);
  assert.equal(mod.newMode(null), null);
});

test("files: withoutKey takes one key out of an address", () => {
  assert.equal(mod.withoutKey("#/files/brand?file=abc&q=x", "file"), "#/files/brand?q=x");
  assert.equal(mod.withoutKey("#/files?file=abc", "file"), "#/files");
  assert.equal(mod.withoutKey("#/files", "file"), "#/files");
});

test("files: readCsv reads plain rows, quotes and commas inside quotes", () => {
  assert.deepEqual(mod.readCsv("a,b,c\n1,2,3\n").rows, [["a", "b", "c"], ["1", "2", "3"]]);
  assert.deepEqual(mod.readCsv('name,note\n"Lee, Asha","said ""hi"""\r\n').rows, [["name", "note"], ["Lee, Asha", 'said "hi"']]);
  assert.deepEqual(mod.readCsv('a,"two\nlines"').rows, [["a", "two\nlines"]]);
  assert.deepEqual(mod.readCsv("﻿x,y\n\n1,").rows, [["x", "y"], ["1", ""]]);
  assert.deepEqual(mod.readCsv('"open').rows, [["open"]]);
  assert.deepEqual(mod.readCsv("").rows, []);
  assert.deepEqual(mod.readCsv(null).rows, []);
});

test("files: readCsv holds at most 200 rows and 30 columns", () => {
  const many = Array.from({ length: 250 }, (_, i) => `r${i},x`).join("\n");
  const r = mod.readCsv(many);
  assert.equal(r.rows.length, 200);
  assert.equal(r.moreRows, true);
  const wide = Array.from({ length: 40 }, (_, i) => `c${i}`).join(",");
  const w = mod.readCsv(wide);
  assert.equal(w.rows[0].length, 30);
  assert.equal(w.moreCols, true);
  assert.equal(mod.readCsv("a,b").moreRows, false);
  const long = mod.readCsv("x".repeat(5000));
  assert.equal(long.rows[0][0].length, 500);
});

test("files: readCsv runs in one pass over a large text", () => {
  const big = '"'.repeat(200000) + ",\n".repeat(200000);
  const t = Date.now();
  mod.readCsv(big);
  assert.ok(Date.now() - t < 1500);
});

test("files: tableOf names the columns from the first row", () => {
  const t = mod.tableOf([["Name", "", "Price"], ["Tile", "box", "120"], ["Grout"]]);
  assert.deepEqual(t.columns.map((c) => c.label), ["Name", "Column 2", "Price"]);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0].c2, "120");
  assert.equal(t.rows[1].c1, "");
  assert.deepEqual(mod.tableOf([]), { columns: [], rows: [] });
});

test("files: viewOf shows a picture only from the brain's own raw address", () => {
  assert.equal(mod.viewOf(file), "text");
  assert.equal(mod.viewOf({ ...file, kind: "table" }), "table");
  assert.equal(mod.viewOf({ ...file, kind: "pdf" }), "pdf");
  assert.equal(mod.viewOf({ ...file, kind: "image", rawUrl: `/api/brain/raw/${file.token}` }), "image");
  assert.equal(mod.viewOf({ ...file, kind: "image", rawUrl: "ftp:" + "//elsewhere/a.png" }), "none");
  assert.equal(mod.viewOf({ ...file, kind: "image", rawUrl: "javascript:alert(1)" }), "none");
  assert.equal(mod.viewOf({ ...file, kind: "html" }), "none");
  assert.equal(mod.safeBrainUrl(file.downloadUrl), file.downloadUrl);
  assert.equal(mod.safeBrainUrl("//elsewhere/x"), null);
});

test("files: kindLabel and basicsLine say it in words", () => {
  assert.equal(mod.kindLabel("image"), "Picture");
  assert.equal(mod.kindLabel("table"), "Table");
  assert.equal(mod.kindLabel("odd"), "File");
  assert.equal(mod.basicsLine(brain), `${brain.basics.filled} of ${brain.basics.total} basics filled`);
  assert.equal(mod.basicsLine(null), "0 of 9 basics filled");
});

test("files: sortFiles by date (newest first) and by name", () => {
  const a = { ...file, token: "a", name: "b.md", changedAt: "2026-11-10T00:00:00.000Z" };
  const b = { ...file, token: "b", name: "A.md", changedAt: "2026-11-12T00:00:00.000Z" };
  const c = { ...file, token: "c", name: "c.md", changedAt: null, addedAt: "2026-11-11T00:00:00.000Z" };
  assert.deepEqual(mod.sortFiles([a, b, c]).map((f) => f.token), ["b", "c", "a"]);
  assert.deepEqual(mod.sortFiles([a, b, c], "name").map((f) => f.token), ["b", "a", "c"]);
  assert.deepEqual(mod.sortFiles(null), []);
});

test("files: Move and Delete send the file's version", () => {
  assert.deepEqual(mod.moveBody(file, "policies"), { token: file.token, folder: "policies", version: file.version });
  assert.equal(mod.deleteUrl(file), `/api/brain/file/${file.token}?version=${file.version}`);
  const opts = mod.moveOptions(brain.folders, "brand");
  assert.ok(!opts.some((o) => o.value === "brand"));
  assert.ok(opts.some((o) => o.value === "company"));
});

test("files: a refusal shows the server's own sentence", () => {
  assert.equal(mod.refusal({ status: 409, message: "This file changed since you opened it." }), "This file changed since you opened it.");
  assert.equal(mod.refusal(null, "Fallback."), "Fallback.");
  assert.equal(mod.refusal({ message: "" }), "That did not work. Try again.");
});

test("files: splitLesson reads a dated lesson line as words and a plain date", () => {
  assert.deepEqual(mod.splitLesson("2026-11-09: Keep files in the goal folder."), { date: "9 Nov 2026", text: "Keep files in the goal folder." });
  assert.deepEqual(mod.splitLesson("No date here"), { date: "", text: "No date here" });
  assert.deepEqual(mod.splitLesson("2026-13-01: odd"), { date: "", text: "2026-13-01: odd" });
});

test("files: text is shown as text, never as HTML", () => {
  assert.doesNotMatch(SOURCE, /dangerouslySetInnerHTML|innerHTML/);
  assert.match(SOURCE, /<pre class="p-files__text">\$\{str\(data\.text\)\}<\/pre>/);
});

test("files: a folder's token opens that folder, not a file", async () => {
  const { fileToken } = await import("../../lib/format.js");
  const tok = fileToken("references/");
  assert.equal(tok, "cmVmZXJlbmNlcy8");
  assert.equal(mod.tokenPath(tok), "references/");
  assert.deepEqual(mod.fileTarget(tok, brain), { to: "folder", href: "#/files/references" });
  assert.deepEqual(mod.fileTarget(fileToken("policies/"), null), { to: "folder", href: "#/files/policies" });
  assert.equal(mod.fileTarget(fileToken("brand/brand.md"), null).to, "file");
  assert.equal(mod.fileTarget(fileToken("../etc/"), null).to, "file");
  assert.equal(mod.tokenPath("not*a*token"), "");
  assert.equal(mod.tokenPath(fileToken("prix/café.md")), "prix/café.md");
});

test("files: a must-read basic that does not exist yet leads to its form", async () => {
  const { fileToken } = await import("../../lib/format.js");
  const b = { basics: { items: [
    { form: "services", title: "Services", file: "pricing/services.md", state: "missing", token: fileToken("pricing/services.md") },
    { form: "brand", title: "Brand", file: "brand/brand.md", state: "filled", token: fileToken("brand/brand.md") },
  ] } };
  assert.deepEqual(mod.fileTarget(fileToken("pricing/services.md"), b), { to: "form", href: "#/files/pricing?new=form%3Aservices" });
  assert.equal(mod.fileTarget(fileToken("brand/brand.md"), b).to, "file");
  // When the file view answers file_not_found, any basic leads to its form.
  assert.equal(mod.fileTarget(fileToken("brand/brand.md"), b, { missingOnly: false }).to, "form");
});

test("files: a Markdown file is read as the kit's document, split at its top headings", () => {
  assert.deepEqual(mod.docOf("# Brand\n\n## Tone\n- warm\n- plain\n\n## Colours\n#1f3a34\n"), { sections: [
    { heading: "Brand", text: "" }, { heading: "Tone", text: "- warm\n- plain" }, { heading: "Colours", text: "#1f3a34" },
  ] });
  assert.deepEqual(mod.docOf("Just words.\n### Deeper\nstays"), { sections: [{ heading: "", text: "Just words.\n### Deeper\nstays" }] });
  assert.deepEqual(mod.docOf("```\n# not a heading\n```"), { sections: [{ heading: "", text: "```\n# not a heading\n```" }] });
  assert.deepEqual(mod.docOf(""), { sections: [] });
  assert.deepEqual(mod.docOf(null), { sections: [] });
  assert.equal(mod.docOf("## <b>x</b>").sections[0].heading, "<b>x</b>", "a heading is kept as text, to be shown as text");
  assert.equal(mod.isMarkdown(file), true);
  assert.equal(mod.isMarkdown({ ...file, name: "notes.txt" }), false);
  assert.equal(mod.isMarkdown({ ...file, kind: "table", name: "a.md" }), false);
  assert.match(SOURCE, /<\$\{DocView\} doc=\$\{docOf\(data\.text\)\} \/>/);
});

test("files: the places are the brain's parts, each folder with its count", () => {
  const p = mod.placesOf(brain, { shared: 2 });
  assert.deepEqual(p.map((x) => x.id), ["all", "brand-kit", ...brain.folders.map((f) => f.id), "shared", "lessons"]);
  assert.equal(p[0].count, brain.totals.files);
  assert.equal(p[0].href, "#/files");
  assert.equal(p[1].href, mod.BRAND_KIT_HREF, "the brand kit's entry hands over to #/files/brand-kit");
  assert.equal(p.find((x) => x.id === "brand").count, 2);
  assert.equal(p.find((x) => x.id === "brand").href, "#/files/brand");
  assert.equal(p.find((x) => x.id === "shared").count, 2);
  assert.equal(p.find((x) => x.id === "shared").href, "#/files?shared=1");
  assert.equal(p.find((x) => x.id === "lessons").href, "#/files?tab=lessons");
  assert.equal(mod.placesOf(null).find((x) => x.id === "shared").count, null);
  assert.deepEqual(mod.placesOf({ folders: [{ id: "../x", title: "x" }] }).map((x) => x.id), ["all", "brand-kit", "shared", "lessons"]);
  assert.equal(mod.placeOf({ folder: "brand" }), "brand");
  assert.equal(mod.placeOf({ shared: true }), "shared");
  assert.equal(mod.placeOf({ tab: "lessons" }), "lessons");
  assert.equal(mod.placeOf({}), "all");
});

test("files: the page's own words", () => {
  assert.equal(mod.FILES_WORDS.lead, "Your company's own files. Every agent reads them before it works.");
  assert.equal(mod.FILES_WORDS.all, "All files");
  assert.equal(mod.FILES_WORDS.lessons, "What agents learned");
  assert.equal(mod.FILES_WORDS.lessonsLead, "When an agent learns something from your answers, it shows here.");
  assert.equal(mod.FILES_WORDS.recent, "Recently changed");
  assert.equal(mod.FILES_WORDS.about, "About this file");
  assert.equal(mod.FILES_WORDS.byForm, "By you, in its form");
  // The Researcher switch keeps its words exactly: it is a safety choice.
  assert.equal(mod.SHARE_WORDS.label, "Fine to share with the Researcher");
  assert.equal(mod.SHARE_WORDS.explain, "The Researcher reads nothing else of your files. Switch it off to take this file back.");
  assert.match(SOURCE, /label=\$\{SHARE_WORDS\.label\} explain=\$\{SHARE_WORDS\.explain\}/);
});

test("files: a file's address is built only by filesHref, and its name is shown as text", () => {
  assert.doesNotMatch(SOURCE, /href=\$\{`#\/files/);
  assert.doesNotMatch(SOURCE, /\?file=\$\{/);
  assert.match(SOURCE, /const href = filesHref\(\{ folder, file: file\.token, shared \}\);/);
  assert.match(SOURCE, /<span class="p-files__row-name" title=\$\{name\}>\$\{name\}<\/span>/);
});

test("files: a row's second line is what /api/brain already says of the file, and no more", () => {
  const about = { name: "about.md", path: "company/about.md", folder: "company", form: "about" };
  const b = { ...brain, basics: { ...brain.basics, items: [{ form: "about", title: "About the company", file: "company/about.md", state: "filled" }] } };
  assert.equal(mod.rowLine(about, b), "About the company · Company basics");
  assert.equal(mod.rowLine(about, b, { inFolder: true }), "About the company", "in a folder the place is the page's own title");
  assert.equal(mod.rowLine({ name: "notes.md", folder: "calls" }, b), "Calls and meetings");
  assert.equal(mod.rowLine({ name: "notes.md", folder: "calls" }, b, { inFolder: true }), "");
  assert.equal(mod.rowLine({ name: "x.md", folder: "brand", form: "brand" }, { folders: [{ id: "brand", title: "Brand" }], basics: { items: [{ form: "brand", title: "Brand" }] } }), "Brand", "a fact is said once");
  assert.equal(mod.rowLine(null, b), "");
  // The server sends no heading or first words in a list, so the page reads no file to make one up.
  assert.doesNotMatch(SOURCE, /useResource\(`\/api\/brain\/file\/\$\{encodeURIComponent\(f/);
});

test("files: a row's time says how long ago, and its glyph is the kit's for the file's kind", () => {
  const now = new Date(2026, 10, 16, 12, 0);
  const at = (ms) => new Date(now.getTime() - ms).toISOString();
  assert.equal(mod.ago(at(10 * 1000), now), "just now");
  assert.equal(mod.ago(at(12 * 60000), now), "12 min ago");
  assert.equal(mod.ago(at(3 * 3600000), now), "3 h ago");
  assert.equal(mod.ago(new Date(2026, 10, 15, 9, 0).toISOString(), now), "yesterday");
  assert.equal(mod.ago(new Date(2026, 10, 12, 9, 0).toISOString(), now), "4 days ago");
  assert.equal(mod.ago(new Date(2026, 9, 2, 9, 0).toISOString(), now), "2 Oct");
  assert.equal(mod.ago("", now), "");
  assert.equal(mod.ago("not a time", now), "");
  assert.equal(mod.glyphOf({ name: "about.md" }), "docs");
  assert.equal(mod.glyphOf({ name: "prices.csv" }), "grid");
  assert.equal(mod.glyphOf({ name: "logo.png" }), "image");
  assert.equal(mod.glyphOf({ name: "noending" }), "file");
  assert.match(SOURCE, /FILE_ICONS, fileKind,[^}]*\} from "\.\.\/kit\/index\.js";/, "the kit's own glyphs, through kit/index.js");
});

test("files: an empty place shows no count", () => {
  const p = mod.placesOf({ ...brain, folders: [{ id: "people", title: "People", files: 0 }, { id: "brand", title: "Brand", files: 2 }] });
  assert.equal(mod.shownCount(p.find((x) => x.id === "people")), false);
  assert.equal(mod.shownCount(p.find((x) => x.id === "brand")), true);
  assert.equal(mod.shownCount(p.find((x) => x.id === "lessons")), false);
});

test("files: a row's tile is the kit's Tile in its kind's tint, its size short, its facts one group after the names (R5-H)", async () => {
  const { tintFor } = await import("../../kit/index.js");
  assert.equal(mod.tintOf({ name: "about.md", kind: "text" }), tintFor("text"));
  assert.equal(mod.tintOf({ name: "prices.csv", kind: "table" }), tintFor("data"));
  assert.equal(mod.tintOf({ name: "logo", kind: "image" }), tintFor("picture"), "a picture is a picture, whatever its name");
  assert.equal(mod.tintOf({ name: "about.md" }), mod.tintOf({ name: "brand.md" }), "the same tint for the same kind");
  assert.equal(mod.sizeShort(250), "250 B");
  assert.equal(mod.sizeShort(1), "1 B");
  assert.equal(mod.sizeShort(0), "0 B");
  assert.equal(mod.sizeShort(3174), "3.1 KB", "a kilobyte and over as the kit writes it");
  assert.match(SOURCE, /<\$\{Tile\} icon=\$\{name\} tint=\$\{tint \|\| "neutral"\} \/>/);
  assert.match(SOURCE, /<span class="p-files__row-size">\$\{sizeShort\(file\.size\)\}<\/span>/);
  const css = readFileSync(new URL("../../styles/pages/files.css", import.meta.url), "utf8");
  assert.match(css, /\.p-files \.p-files__card \{\s*overflow: hidden;\s*width: fit-content;\s*max-width: min\(100%, 760px\);/, "the card as wide as its rows, at most 760 px");
  assert.match(css, /grid-template-columns: 4px 28px minmax\(0, max-content\) minmax\(var\(--s-10\), 160px\) auto auto 4px;/, "the facts 40 to 160 px after the longest name");
  assert.match(/\.p-files \.p-files__place-name \{([^}]*)\}/.exec(css)[1], /flex: 0 1 auto;/, "a place's count beside its name");
});
