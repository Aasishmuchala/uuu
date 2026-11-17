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

test("files: a row's tile is the kit's Tile in its kind's tint, its size short, its facts one group at the right of a flat list on the column's width (R5-H, R6)", async () => {
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
  assert.match(css, /\.p-files:not\(\.p-files--file\) \.k-doc__main \{\s*max-width: calc\(1040px \+ var\(--s-12\) \+ var\(--s-10\)\);/, "one column as wide as the pane up to 1040 px");
  assert.match(css, /\.p-files \.p-files__card \{\s*border-top: 1px solid var\(--line-2\);\s*border-bottom: 1px solid var\(--line\);\s*\}/, "the list flat: rules, no card");
  assert.doesNotMatch(SOURCE, /<\$\{Card\}/, "no card on the page's lists");
  assert.match(/\.p-files \.p-files__row-link \{([^}]*)\}/.exec(css)[1], /min-height: var\(--s-12\);/, "rows 48 px");
  assert.match(css, /grid-template-columns: 0 28px minmax\(0, max-content\) minmax\(var\(--s-10\), 1fr\) auto auto 0;/, "the size and the time one group at the list's right edge");
  assert.match(/\.p-files \.p-files__place-name \{([^}]*)\}/.exec(css)[1], /flex: 0 1 auto;/, "a place's count beside its name");
});

// ---- Mounted in the test DOM with a fake fetch (PLAN-3D-ALL U9). ----
const { FakeElement, html, render, installDom, elements, classesOf, walkDom } = await import("../kit/_dom.mjs");
const { AppContext } = await import("../../lib/context.js");
const LESSONS = { roles: [{ slug: "writer", name: "Writer", lessons: ["2026-11-09: Say the price before the offer.", "Keep a caption under twelve words."] }] };
const DOC = "# Brand\n\nWe sound calm and plain.\n\n## Colours\n\nInk and sand.";
// The answers by path, from the pinned shapes (a folder's answer is the brain's recent files and no forms).
export function filesAnswers({ brainData = brain, fileData = file, text = DOC, lessons = LESSONS, web = shape("web"), kit = shape("brand-kit") } = {}) {
  return (path) => {
    const p = String(path);
    if (p === "/api/brain") return brainData;
    if (p === "/api/web") return web;
    if (p.startsWith("/api/brain/file/")) return { file: fileData, text, truncated: false };
    if (p.startsWith("/api/brain/folder/")) return { files: brainData.recent, forms: [] };
    if (p.startsWith("/api/brain/search")) return { results: brainData.recent.map((f) => ({ ...f, snippet: f.name })) };
    if (p.startsWith("/api/brain/forms/")) return { form: { id: "about", title: "About the company", folder: "company", file: "about.md", fields: [] }, exists: false, values: {} };
    if (p === "/api/lessons") return lessons;
    if (p.startsWith("/api/brand/kit")) return kit;
    return {};
  };
}

export async function mountFiles(parts, query = "", answer = filesAnswers()) {
  installDom();
  globalThis.document.visibilityState = "visible";
  const hash = `#/${parts.join("/")}${query ? `?${query}` : ""}`;
  globalThis.location = { hash, href: `/${hash}`, search: "", replace() {} };
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts = {}) => {
    calls.push(`${opts.method || "GET"} ${path}${opts.body === undefined ? "" : ` ${opts.body}`}`);
    const data = answer(path);
    return { ok: true, status: 200, json: async () => data };
  };
  const tops = [];
  const ctx = { shell: { team: shape("shell").team, dock: [] }, setTop: (t) => tops.push(t), announce() {}, openComposer() {}, settings: { motion: "off", theme: "dark" } };
  const root = new FakeElement("div");
  globalThis.document.body.appendChild(root);
  render(html`<${AppContext.Provider} value=${ctx}><${mod.default} route=${{ id: "files", parts, query: new URLSearchParams(query) }} /><//>`, root);
  await new Promise((r) => setTimeout(r, 400));
  return { root, calls, tops, done: () => { render(null, root); root.remove(); globalThis.fetch = real; delete globalThis.location; } };
}

export const FILES_STATES = [
  [["files"], ""], [["files", "brand"], ""], [["files"], `file=${file.token}`], [["files"], "tab=lessons"], [["files"], "shared=1"],
  [["files"], "q=brand"], [["files"], "new=paste"], [["files", "brand"], "new=upload"], [["files"], "new=form:about"],
];

test("files: the page sends what it sent before (PLAN-3D-ALL)", async () => {
  const seen = [];
  for (const [parts, query] of FILES_STATES) {
    const m = await mountFiles(parts, query);
    try { seen.push(`# ${parts.join("/")}?${query}`, ...m.calls); } finally { m.done(); }
  }
  // Recorded on the page before PLAN-3D-ALL U9 changed it.
  const RECORDED = [
    "# files?",
    "GET /api/brain",
    "GET /api/web",
    "# files/brand?",
    "GET /api/brain/folder/brand",
    "GET /api/brain",
    "GET /api/web",
    "# files?file=YnJhbmQvYnJhbmQubWQ",
    "GET /api/brain",
    "GET /api/web",
    "GET /api/brain/file/YnJhbmQvYnJhbmQubWQ",
    "GET /api/web",
    "# files?tab=lessons",
    "GET /api/lessons",
    "GET /api/brain",
    "GET /api/web",
    "# files?shared=1",
    "GET /api/web",
    "GET /api/brain",
    "GET /api/web",
    "# files?q=brand",
    "GET /api/brain/search?q=brand",
    "GET /api/brain",
    "GET /api/web",
    "# files?new=paste",
    "GET /api/brain",
    "GET /api/web",
    "GET /api/brain",
    "# files/brand?new=upload",
    "GET /api/brain/folder/brand",
    "GET /api/brain",
    "GET /api/web",
    "GET /api/brain",
    "# files?new=form:about",
    "GET /api/brain",
    "GET /api/web",
    "GET /api/brain/forms/about",
    "GET /api/brain",
  ];
  assert.deepEqual(seen, RECORDED);
  for (const c of seen) assert.ok(!/\/assets\/world\/|\/vendor\/three-/.test(c), c);
});

const { fire, textOf } = await import("../kit/_dom.mjs");
const settle = () => new Promise((r) => setTimeout(r, 400));
const buttonWith = (root, words) => elements(root).find((e) => e.localName === "button" && textOf(e).trim() === words);

test("files: an opened file's actions send what they sent before: share, move, delete (PLAN-3D-ALL)", async () => {
  const sent = [];
  for (const act of ["share", "move", "delete"]) {
    const m = await mountFiles(["files"], `file=${file.token}`);
    try {
      if (act === "share") fire(elements(m.root).find((e) => e.localName === "button" && e.getAttribute("role") === "switch"), "click");
      if (act === "move") { fire(buttonWith(m.root, "Move to..."), "click"); await settle(); fire(buttonWith(m.root, "Move"), "click"); }
      if (act === "delete") { fire(buttonWith(m.root, "Delete"), "click"); await settle(); fire(buttonWith(m.root, "Delete"), "click"); }
      await settle();
      sent.push(...m.calls.filter((c) => !c.startsWith("GET ")));
    } finally { m.done(); }
  }
  // Recorded on the page before PLAN-3D-ALL U9 changed it.
  const RECORDED = [
    "POST /api/web/share {\"token\":\"YnJhbmQvYnJhbmQubWQ\",\"share\":true}",
    "POST /api/brain/move {\"token\":\"YnJhbmQvYnJhbmQubWQ\",\"folder\":\"company\",\"version\":\"1794472200000\"}",
    "DELETE /api/brain/file/YnJhbmQvYnJhbmQubWQ?version=1794472200000 {}",
  ];
  assert.deepEqual(sent, RECORDED);
});

const { glimpseSrc, GLIMPSES } = await import("../../kit/room.js");
const { HOSTILE } = await import("../../world/fixtures.js");
const byCls = (root, c) => elements(root).filter((e) => classesOf(e).includes(c));
const within = (el, root) => { for (let p = el; p; p = p.parentNode) if (p === root) return true; return false; };
const paperOf = (el) => { for (let p = el; p; p = p.parentNode) if (p.getAttribute && p.getAttribute("data-surface") === "paper") return p; return null; };

test("files: the title, the grey line and + New stand in the room header with the shelves' glimpse; one h1, the frame draws no head (PLAN-3D-ALL U9)", async () => {
  for (const [parts, query, title] of [[["files"], "", "Files"], [["files", "brand"], "", null], [["files"], "tab=lessons", "What agents learned"], [["files"], `file=${file.token}`, "brand.md"]]) {
    const m = await mountFiles(parts, query);
    try {
      const band = elements(m.root).filter((e) => e.localName === "header" && classesOf(e).includes("k-room"));
      assert.equal(band.length, 1, query);
      assert.equal(band[0].getAttribute("data-glimpse"), "shelves");
      const h1 = elements(m.root).filter((e) => e.localName === "h1");
      assert.equal(h1.length, 1, "one h1");
      assert.equal(h1[0].getAttribute("id"), "page-title");
      assert.ok(within(h1[0], band[0]), "the h1 is the band's");
      if (title) assert.equal(textOf(h1[0]), title);
      assert.equal(byCls(m.root, "k-doc__head").length, 0, "DocLayout draws no head");
      const img = elements(m.root).filter((e) => e.localName === "img");
      assert.equal(img.length, 1, "one picture: the band's");
      assert.equal(img[0].getAttribute("src"), glimpseSrc("shelves", { theme: "dark", width: 1280 }));
      assert.equal(img[0].getAttribute("alt"), "");
      assert.equal(elements(m.root).filter((e) => e.localName === "canvas").length, 0, "a surface screen has no canvas");
      const isFile = query.startsWith("file=");
      assert.equal(byCls(band[0], "p-files__new").length, isFile ? 0 : 1, "+ New is the band's action, not on an opened file");
      if (!isFile) assert.ok(byCls(band[0], "k-page-header__lede").length === 1, "the grey line is the band's lede");
      assert.equal(m.tops.at(-1).crumbs[0].label, "Files", "the crumbs as before");
    } finally { m.done(); }
  }
  installDom();
  globalThis.location = { hash: "#/files?glimpse=off", href: "/#/files?glimpse=off", search: "", replace() {} };
  const bare = await (async () => {
    const real = globalThis.fetch;
    const data = filesAnswers();
    globalThis.fetch = async (p) => ({ ok: true, status: 200, json: async () => data(p) });
    const root = new FakeElement("div");
    globalThis.document.body.appendChild(root);
    render(html`<${AppContext.Provider} value=${{ setTop() {}, announce() {}, settings: {} }}><${mod.default} route=${{ id: "files", parts: ["files"], query: new URLSearchParams() }} /><//>`, root);
    await settle();
    const out = { img: elements(root).filter((e) => e.localName === "img").length, bare: byCls(root, "k-room--bare").length };
    render(null, root); root.remove(); globalThis.fetch = real; delete globalThis.location;
    return out;
  })();
  assert.deepEqual(bare, { img: 0, bare: 1 }, "glimpse=off: the band alone");
});

test("files: what is read is on paper (an opened text or Markdown file, each agent's lessons); the lists, a table and the forms are not (PLAN-3D-ALL U9, D4)", async () => {
  const m = await mountFiles(["files"], `file=${file.token}`);
  try {
    const doc = byCls(m.root, "k-doc").filter((e) => !classesOf(e).includes("k-doc--layout"));
    assert.equal(doc.length, 1, "the Markdown file is the kit's document");
    const sheet = paperOf(doc[0]);
    assert.ok(sheet && classesOf(sheet).includes("k-sheet"), "on a sheet of paper");
    assert.equal(byCls(m.root, "k-sheet").length, 1, "only the document");
    assert.equal(paperOf(byCls(m.root, "p-files__rail")[0]), null, "the facts and actions stay off paper");
  } finally { m.done(); }
  const plain = await mountFiles(["files"], `file=${file.token}`, filesAnswers({ fileData: { ...file, name: "notes.txt" }, text: "One line.\nTwo." }));
  try {
    const pre = byCls(plain.root, "p-files__text");
    assert.equal(pre.length, 1);
    assert.ok(paperOf(pre[0]), "a plain text file on paper too");
  } finally { plain.done(); }
  const table = await mountFiles(["files"], `file=${file.token}`, filesAnswers({ fileData: { ...file, name: "prices.csv", kind: "table" }, text: "a,b\n1,2" }));
  try {
    assert.equal(byCls(table.root, "k-sheet").length, 0, "a table is never on paper");
    assert.equal(elements(table.root).filter((e) => e.getAttribute("data-surface") === "paper").length, 0);
  } finally { table.done(); }
  const lessons = await mountFiles(["files"], "tab=lessons");
  try {
    const lists = byCls(lessons.root, "p-files__lesson-list");
    assert.equal(lists.length, 1);
    assert.ok(paperOf(lists[0]), "a lesson's words on paper");
  } finally { lessons.done(); }
  for (const [parts, query] of [[["files"], ""], [["files", "brand"], ""], [["files"], "q=brand"], [["files"], "new=paste"]]) {
    const l = await mountFiles(parts, query);
    try {
      assert.equal(elements(l.root).filter((e) => e.getAttribute("data-surface") === "paper").length, 0, `no paper: ${parts.join("/")}?${query}`);
    } finally { l.done(); }
  }
  const css = readFileSync(new URL("../../styles/pages/files.css", import.meta.url), "utf8");
  assert.match(css, /\.p-files \.k-sheet > \.p-files__doc--paper \{\s*padding: 0;\s*border: 0;\s*border-radius: 0;\s*background: none;\s*box-shadow: none;/, "the sheet is the frame: the document draws no card of its own");
  assert.match(css, /\.p-files \.p-files__doc \.k-doc \{\s*max-width: 68ch;/, "a reading measure");
});

test("files: the band stands above the frame, a short strip with no picture on a phone; rows answer in the lamp's pool (PLAN-3D-ALL U9)", () => {
  const css = readFileSync(new URL("../../styles/pages/files.css", import.meta.url), "utf8");
  const [wide, phone] = [...css.matchAll(/\.p-files > \.k-room \{([^}]*)\}/g)].map((x) => x[1]);
  // PLAN-3D-ALL U17: the layer (+ New's open menu covers the frame under the band) and the phone's title strip with
  // no picture are the kit's (U16): the band is given `strip` and the page's own width switch is gone
  // ("glimpse=${wide ? glimpseFor("files") : null}" → "glimpse=${glimpseFor("files")} strip").
  assert.doesNotMatch(wide, /z-index/);
  assert.match(wide, /min-height: 120px;/);
  assert.match(phone, /min-height: 56px;/, "a phone: a title strip");
  assert.match(SOURCE, /<\$\{RoomHeader\} glimpse=\$\{glimpseFor\("files"\)\} strip\b/, "no picture asked for below 860 px");
  assert.doesNotMatch(SOURCE, /const WIDE = /);
  // The quiet look's control fill under the pointer was replaced by the lamp's pool (PLAN-3D-ALL U9, as U5).
  assert.match(css, /\.p-files a\.p-files__row-link:hover,\s*\.p-files a\.p-files__row-link:focus-visible \{\s*background: var\(--lamp-pool\);/);
  assert.match(css, /\.p-files a\.p-files__row-link:focus-visible \{\s*outline: 2px solid var\(--accent\);/, "the 2 px ring");
  assert.match(css, /\.p-files > \.k-room \.k-page-header__title \{\s*overflow-wrap: anywhere;/, "a file's name never runs out of the band");
  assert.ok(!/<\$\{PageHeader\}/.test(SOURCE), "PageHeader is replaced");
});

test("files: hostile server text stays text: no script, img, iframe or object beyond the band's; no on* attribute; no fixture text in href, src or style (PLAN-3D-ALL)", async () => {
  const tags = (root) => ["script", "img", "iframe", "object"].map((t) => elements(root).filter((e) => e.localName === t).length);
  const bad = (i) => HOSTILE[i % HOSTILE.length];
  const hostileBrain = {
    ...brain,
    folders: brain.folders.map((f, i) => ({ ...f, title: bad(i), about: bad(i + 1) })),
    basics: { ...brain.basics, items: brain.basics.items.map((b, i) => ({ ...b, title: bad(i + 2) })) },
    starters: brain.starters.map((s, i) => ({ ...s, title: bad(i), about: bad(i + 3) })),
    recent: brain.recent.map((f, i) => ({ ...f, name: bad(i), changedAt: bad(i + 1) })),
  };
  const hostile = filesAnswers({
    brainData: hostileBrain,
    fileData: { ...file, name: bad(0), addedAt: bad(1), changedAt: bad(2), size: bad(3) },
    text: HOSTILE.map((h) => `# ${h}\n\n${h}`).join("\n\n"),
    lessons: { roles: [{ slug: "writer", name: bad(1), lessons: HOSTILE }, { slug: bad(2), name: bad(3), lessons: [bad(4)] }] },
  });
  const brandToken = hostileBrain.folders.find((f) => f.id === "brand") ? "brand" : hostileBrain.folders[0].id;
  for (const [parts, query] of [[["files"], ""], [["files", brandToken], ""], [["files"], `file=${file.token}`], [["files"], "tab=lessons"], [["files"], "q=brand"]]) {
    const s = await mountFiles(parts, query);
    let base;
    try { base = tags(s.root); } finally { s.done(); }
    const m = await mountFiles(parts, query, hostile);
    try {
      assert.deepEqual(tags(m.root), base, `${parts.join("/")}?${query}`);
      for (const e of elements(m.root)) {
        for (const k of Object.keys(e.attrs)) assert.ok(!/^on/i.test(k), `no ${k}`);
        for (const h of HOSTILE) {
          for (const a of ["href", "src", "style"]) assert.ok(!String(e.getAttribute(a) || "").includes(h), `${a} holds no fixture text`);
        }
        if (e.localName === "img") {
          assert.ok(GLIMPSES.some((k) => [1280, 390].some((w) => ["dark", "light"].some((theme) => glimpseSrc(k, { theme, width: w }) === e.getAttribute("src")))), "the band's picture is a table key's");
        }
      }
      const nodes = [...walkDom(m.root)].filter((n) => n.nodeType === 3).map((n) => n.data);
      if (!query && parts.length === 1) assert.ok(nodes.includes(bad(0)), "a hostile file name is a text node");
      if (query.startsWith("file=")) assert.ok(nodes.includes(bad(0)), "a hostile name is the band's title, as text");
    } finally { m.done(); }
  }
});
