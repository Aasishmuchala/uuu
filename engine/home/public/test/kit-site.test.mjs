// PLAN-V5 K15, K16, T54: a site on its task's page (kit/site.js). Its pure helpers (the state sentences, the preview
// address check, the shot address check, the report's layout, the names), and SiteView mounted in a very small DOM:
// nothing for a task with no sites; a ready site with its two pictures from the server's own addresses only; an
// agent's words only ever as text; the preview opened only at its own address, in a new tab with noopener and
// noreferrer; the zip as a link with `download`; the states off (linked to Settings), working, failed and left out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = join(PUBLIC, "kit");
const { html, render } = await import(pathToFileURL(join(PUBLIC, "vendor", "preact-htm.js")).href);
const site = await import(pathToFileURL(join(KIT, "site.js")).href);
const index = await import(pathToFileURL(join(KIT, "index.js")).href);
const SRC = readFileSync(join(KIT, "site.js"), "utf8");
// The shape file sits beside the server, outside this tree: found by walking up from this file.
const SHAPES = (() => { let d = dirname(fileURLToPath(import.meta.url)); for (;;) { const c = join(d, "server", "test", "shapes"); if (existsSync(c)) return c; const p = dirname(d); if (p === d) throw new Error("shape files not found"); d = p; } })();
const SITES = JSON.parse(readFileSync(join(SHAPES, "sites.json"), "utf8"));
// Addresses are built from parts, so this file names no host (test/static.test.mjs).
const LOOP = "http:" + "//" + "127.0.0.1";

// ---- A very small DOM, enough for Preact to render into and for us to walk. ----
class FakeNode {
  constructor() { this.childNodes = []; this.parentNode = null; }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
}
class FakeText extends FakeNode {
  constructor(d) { super(); this.nodeType = 3; this.data = String(d); }
}
class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.localName = tag;
    this.attrs = {};
    this.style = { cssText: "", setProperty(k, v) { this[k] = v; } };
    this.listeners = {};
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
  focus() { globalThis.document.activeElement = this; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  set innerHTML(v) { throw new Error(`innerHTML was set: ${v}`); }
}
function installDom() {
  const doc = {
    title: "", activeElement: null,
    createElement: (t) => new FakeElement(t),
    createElementNS: (_ns, t) => new FakeElement(t),
    createTextNode: (d) => new FakeText(d),
    addEventListener() {}, removeEventListener() {},
  };
  doc.body = new FakeElement("body");
  globalThis.document = doc;
}
function* walk(node) { yield node; for (const c of node.childNodes) yield* walk(c); }
const elements = (root) => [...walk(root)].filter((n) => n.nodeType === 1);
const textOf = (root) => [...walk(root)].filter((n) => n.nodeType === 3).map((n) => n.data).join("");
const settle = () => new Promise((r) => setTimeout(r, 110));
async function showTree(Component, props) {
  installDom();
  const root = new FakeElement("div");
  render(html`<${Component} ...${props} />`, root);
  await settle();
  return root;
}
function fire(el, type, extra = {}) {
  const key = Object.keys(el.listeners).find((k) => k.toLowerCase() === type);
  assert.ok(key, `${el.localName} listens for ${type}`);
  const ev = { type: key, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, ...extra };
  for (const f of el.listeners[key]) f.call(el, ev);
}
const attr = (e, k) => (e[k] !== undefined ? e[k] : e.getAttribute(k));
const buttons = (root, words) => elements(root).filter((e) => e.localName === "button" && textOf(e).trim() === words);
function stubFetch(answers) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts) => {
    calls.push({ path, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
    const a = answers(path, opts.method, calls.length);
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

// ---- Sites as the home server sends them (routes/sites.mjs) ----
const KEY = "0123456789abcdef".repeat(4);
const shot = (page, width, scheme) => ({ url: `/api/sites/shot/${KEY}/shot-${page.replace(/\.html$/, "")}-${width}-${scheme}.png`, page, width, scheme });
const READY = {
  ...SITES.sites[0],
  ref: "launch-a", variant: "a", direction: { id: "editorial", title: "<b>Editorial</b>" }, files: 6, bytes: 86016, left: [],
  pages: ["index.html", "about.html"],
  shots: {
    state: "ready", sentence: null, taken: "2026-11-13T10:00:00.000Z",
    images: [shot("index.html", 1280, "light"), shot("index.html", 1280, "dark"), shot("index.html", 390, "light"), shot("index.html", 390, "dark"),
      shot("about.html", 1280, "light"), shot("about.html", 390, "light"),
      { url: "/files/x.png", page: "index.html", width: 1280, scheme: "light" }],
    report: [
      { page: "index.html", lines: ["Wider than the screen at 390 px: div.too.wide (700 px)", "<img src=x onerror=alert(1)> did not load", "Drawn with: Inter"] },
      { page: "about.html", lines: ["Nothing to fix was found.", "Drawn with: Inter"] },
    ],
  },
};
const B = { ...READY, ref: "launch-b", variant: "b", direction: { id: "gallery", title: "Gallery" }, left: [{ name: "linked.css", why: "a link" }] };
const C = { ...READY, ref: "launch-c", variant: "c", direction: { id: "spec-sheet", title: "Spec sheet" } };
const answer = (sites, viewer = { on: true, state: "on" }) => ({ viewer, sites, problem: null });

// ---- Pure helpers ----

test("site: the preview's address is taken only when it is exactly the preview's own", () => {
  assert.equal(site.previewAddress(`${LOOP}:3160/`), `${LOOP}:3160/`);
  assert.equal(site.previewAddress(`${LOOP}:41234/`), `${LOOP}:41234/`);
  for (const bad of [`${LOOP}:3160`, `${LOOP}:3160/x`, `${LOOP}:3160/?a=1`, `${LOOP}:9/`, `${LOOP}:123456/`, "https:" + "//127.0.0.1:3160/",
    "http:" + "//localhost:3160/", "http:" + "//127.0.0.2:3160/", "javascript:alert(1)", "/preview", null, 3160]) {
    assert.equal(site.previewAddress(bad), null, String(bad));
  }
});

test("site: a picture's address is taken only when it is exactly a kept picture's (C21)", () => {
  const good = `/api/sites/shot/${KEY}/shot-index-1280-light.png`;
  assert.equal(site.shotUrl(good), good);
  assert.equal(site.shotUrl(`/api/sites/shot/${KEY}/shot-about.us-390-dark.png`), `/api/sites/shot/${KEY}/shot-about.us-390-dark.png`);
  for (const bad of [`${good}?x=1`, `${good}#a`, good.toUpperCase(), `/api/sites/shot/${KEY.slice(1)}/shot-index-1280-light.png`,
    `/api/sites/shot/${KEY}/shot-index-1024-light.png`, `/api/sites/shot/${KEY}/shot-index-1280-sepia.png`, `/api/sites/shot/${KEY}/../x.png`,
    `/api/view/${KEY}`, `/files/shot-index-1280-light.png`, `//elsewhere${good}`, `${good}\n`, null]) {
    assert.equal(site.shotUrl(bad), null, String(bad));
  }
});

test("site: the state sentences, the server's own first, and the button that goes with each", () => {
  const on = { on: true, state: "on" };
  assert.equal(site.stateLine(READY, on), null, "pictures there: no line");
  assert.deepEqual(site.stateLine({ shots: { state: "working", sentence: null } }, on), { state: "working", tone: "live", sentence: "Taking pictures. This takes about a minute.", retry: "" });
  assert.deepEqual(site.stateLine({ shots: { state: "off", sentence: null } }, { on: false, state: "on" }),
    { state: "off", tone: "off", sentence: "The page viewer is off, so there are no pictures of this site. Switch it on in Settings.", retry: "" });
  const failed = site.stateLine({ shots: { state: "failed", sentence: "The page viewer was busy. Try again in a minute." } }, on);
  assert.equal(failed.sentence, "The page viewer was busy. Try again in a minute.");
  assert.equal(failed.retry, "Try again");
  assert.equal(site.stateLine({ shots: { state: "failed", sentence: "x" } }, { on: false }).retry, "", "no Try again while the switch is off");
  const none = site.stateLine({ shots: { state: "none", sentence: "The page viewer is not running, so no pictures can be taken now." } }, { on: true, state: "off" });
  assert.equal(none.retry, "", "nothing to press while the viewer does not run");
  assert.deepEqual(site.settingsSplit("The page viewer is off, so there are no pictures of this site. Switch it on in Settings."),
    { before: "The page viewer is off, so there are no pictures of this site.", link: "Switch it on in Settings." });
  assert.deepEqual(site.settingsSplit("The page viewer was busy."), { before: "The page viewer was busy.", link: "" });
  assert.deepEqual(site.leftLines([{ name: "linked.css", why: "a link" }, { name: "x\u0000y.js", why: "" }, "junk"]),
    ["Left out of the site: linked.css (a link)", "Left out of the site: x y.js"]);
});

test("site: the report's layout: things to look at, nothing found, the faces apart, a cut page a problem", () => {
  const index = site.reportOf(READY, "index.html");
  assert.equal(index.fine, false);
  assert.deepEqual(index.lines.map((l) => l.text), ["Wider than the screen at 390 px: div.too.wide (700 px)", "<img src=x onerror=alert(1)> did not load"]);
  assert.ok(index.lines.every((l) => l.tone === "warn"));
  assert.equal(index.drawn, "Drawn with: Inter");
  const about = site.reportOf(READY, "about.html");
  assert.deepEqual([about.fine, about.lines, about.drawn], [true, [], "Drawn with: Inter"]);
  const cut = site.reportOf({ shots: { report: [{ page: "index.html", lines: ["This page was cut: it took too long to open."] }] } }, "index.html");
  assert.equal(cut.lines[0].tone, "bad");
  assert.deepEqual(site.reportLayout(READY).map((r) => r.page), ["index.html", "about.html"]);
  assert.deepEqual(site.reportOf(READY, "missing.html"), { page: "missing.html", fine: false, lines: [], drawn: "" });
});

test("site: the pictures of a page in a look, the looks there are, the pages, the names and the sizes", () => {
  assert.deepEqual(site.picturesOf(READY.shots.images, "index.html", "light"), { desktop: READY.shots.images[0].url, phone: READY.shots.images[2].url });
  assert.deepEqual(site.picturesOf(READY.shots.images, "about.html", "dark"), { desktop: null, phone: null });
  assert.deepEqual(site.picturesOf([{ url: "/files/x.png", page: "index.html", width: 1280, scheme: "light" }], "index.html"), { desktop: null, phone: null });
  assert.deepEqual(site.schemesOf(READY.shots.images), ["light", "dark"]);
  assert.deepEqual(site.schemesOf(READY.shots.images.filter((i) => i.scheme === "light")), ["light"]);
  assert.deepEqual(site.pagesOfSite(READY), ["index.html", "about.html"]);
  assert.deepEqual(site.siteName(READY), { letter: "A", title: "<b>Editorial</b>", label: "Version A: <b>Editorial</b>" });
  assert.deepEqual(site.siteName({ ref: "launch", variant: null, direction: null }), { letter: "", title: "launch", label: "launch" });
  assert.equal(site.siteName({ ref: "launch-b", variant: "b", direction: null }).title, "Version B");
  assert.equal(site.sizeWords(READY), "6 files, 84 KB");
  assert.equal(site.pageWords("index.html"), "Home page");
  assert.equal(site.pageWords("about.html"), "about");
  assert.deepEqual(site.sitesOf({ sites: [READY, { ...READY }, { ref: "../x" }, { ref: "Launch-A" }, null, B] }).map((s) => s.ref), ["launch-a", "launch-b"]);
  assert.equal(site.anyWorking(answer([READY, { ...B, shots: { state: "working" } }])), true);
  assert.equal(site.anyWorking(answer([READY])), false);
  assert.equal(site.siteAddress("STH-2", "launch-a", "zip"), "/api/tasks/STH-2/sites/launch-a/zip");
});

// ---- Mounted ----

test("SiteView: nothing for a task with no sites, nor when the route is missing", async () => {
  for (const [status, body] of [[200, answer([])], [404, { error: { message: "Not found." } }], [200, { sites: [{ ref: "../x" }] }]]) {
    const f = stubFetch(() => ({ status, body }));
    try {
      const root = await showTree(site.SiteView, { id: "STH-2" });
      assert.equal(root.childNodes.length, 0, `${status}`);
      assert.equal(f.calls[0].path, "/api/tasks/STH-2/sites");
    } finally {
      f.restore();
    }
  }
  assert.equal(typeof index.SiteView, "function", "the kit's index exports it");
});

test("SiteView: three versions behind a switch; the pictures only from kept addresses; an agent's words as text", async () => {
  const f = stubFetch(() => ({ status: 200, body: answer([READY, B, C]) }));
  try {
    const root = await showTree(site.SiteView, { id: "STH-2" });
    const all = textOf(root);
    assert.match(all, /How each version looks/);
    assert.match(all, /<b>Editorial<\/b>/, "the direction's title is shown as the characters it is");
    assert.ok(!elements(root).some((e) => e.localName === "b"), "no element was made from an agent's words");
    assert.match(all, /<img src=x onerror=alert\(1\)> did not load/);
    assert.ok(!elements(root).some((e) => e.localName === "img" && !/^\/api\/sites\/shot\//.test(attr(e, "src"))), "only kept pictures reach an img");
    assert.deepEqual(elements(root).filter((e) => e.localName === "img").map((e) => attr(e, "src")), [READY.shots.images[0].url, READY.shots.images[2].url]);
    assert.match(all, /Desktop1280 px/);
    assert.match(all, /Phone390 px/);
    assert.match(all, /What the page viewer found2 things to look at/);
    assert.match(all, /Drawn with: Inter/);
    assert.equal(buttons(root, "Dark").length, 1, "Dark is offered: the page has a dark look");
    assert.equal(buttons(root, "Home page").length, 1);
    assert.equal(buttons(root, "Take pictures again").length, 1);
    const versions = elements(root).filter((e) => e.localName === "button" && /^[ABC]/.test(textOf(e)) && e.getAttribute("aria-pressed") !== null);
    assert.equal(versions.length, 3);
    fire(versions[1], "click");
    await settle();
    assert.match(textOf(root), /Left out of the site: linked\.css \(a link\)/);
    const zip = elements(root).find((e) => e.localName === "a" && /\/zip$/.test(attr(e, "href")));
    assert.equal(attr(zip, "href"), "/api/tasks/STH-2/sites/launch-b/zip");
    assert.notEqual(zip.getAttribute("download") ?? zip.download, undefined, "the zip link downloads");
    assert.doesNotMatch(SRC, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  } finally {
    f.restore();
  }
});

test("SiteView: Open the preview loads the site, then opens only the preview's own address with noopener", async () => {
  const opened = [];
  const realWindow = globalThis.window;
  globalThis.window = { open: (...a) => { opened.push(a); return null; } };
  let previewAnswer = { url: `${LOOP}:3160/` };
  const f = stubFetch((path, method) => (method === "POST" ? { status: 200, body: previewAnswer } : { status: 200, body: answer([READY]) }));
  try {
    const root = await showTree(site.SiteView, { id: "STH-2" });
    assert.match(textOf(root), /How the site looks/);
    fire(buttons(root, "Open the preview")[0], "click");
    await settle();
    assert.deepEqual(f.calls.at(-1), { path: "/api/tasks/STH-2/sites/launch-a/preview", method: "POST", body: {} });
    assert.deepEqual(opened, [[`${LOOP}:3160/`, "_blank", "noopener,noreferrer"]]);
    const link = elements(root).find((e) => e.localName === "a" && attr(e, "href") === `${LOOP}:3160/`);
    assert.equal(attr(link, "rel"), "noopener noreferrer");
    assert.equal(attr(link, "target"), "_blank");
    previewAnswer = { url: "https:" + "//elsewhere.example/" };
    fire(buttons(root, "Open the preview")[0], "click");
    await settle();
    assert.equal(opened.length, 1, "another address is never opened");
    assert.match(textOf(root), /The preview gave an address this page does not open\./);
  } finally {
    f.restore();
    globalThis.window = realWindow;
  }
});

test("SiteView: preview not running says the server's sentence with its command set apart", async () => {
  const f = stubFetch((path, method) => (method === "POST"
    ? { status: 409, body: { error: { message: "The preview is not running. Run: engine start", code: "preview_off" } } }
    : { status: 200, body: answer([READY]) }));
  try {
    const root = await showTree(site.SiteView, { id: "STH-2" });
    fire(buttons(root, "Open the preview")[0], "click");
    await settle();
    assert.match(textOf(root), /The preview is not running\. Run: engine start/);
    assert.ok(elements(root).some((e) => e.localName === "code" && textOf(e) === "engine start"));
  } finally {
    f.restore();
  }
});

test("SiteView: the viewer off links to Settings; working says so; failed offers Try again, which asks again", async () => {
  const off = { ...READY, shots: { state: "off", sentence: "The page viewer is off, so there are no pictures of this site. Switch it on in Settings.", taken: null, images: [], report: [] } };
  let f = stubFetch(() => ({ status: 200, body: answer([off], { on: false, state: "on" }) }));
  try {
    const root = await showTree(site.SiteView, { id: "STH-2" });
    assert.match(textOf(root), /The page viewer is off, so there are no pictures of this site\. Switch it on in Settings\./);
    const link = elements(root).find((e) => e.localName === "a" && textOf(e) === "Switch it on in Settings.");
    assert.equal(attr(link, "href"), "#/settings");
    assert.equal(elements(root).filter((e) => e.localName === "img").length, 0);
    assert.equal(buttons(root, "Take pictures again").length, 0);
    assert.equal(buttons(root, "Open the preview").length, 1, "the preview works whatever the switch (C17)");
  } finally {
    f.restore();
  }
  const working = { ...READY, shots: { state: "working", sentence: "Taking pictures. This takes about a minute.", taken: null, images: [], report: [] } };
  f = stubFetch(() => ({ status: 200, body: answer([working]) }));
  try {
    const root = await showTree(site.SiteView, { id: "STH-2" });
    assert.match(textOf(root), /Taking pictures\. This takes about a minute\./);
  } finally {
    f.restore();
  }
  const failed = { ...READY, shots: { state: "failed", sentence: "The page viewer's answer was not what it sends.", taken: null, images: [], report: [] } };
  f = stubFetch((path, method) => (method === "POST" ? { status: 202, body: { state: "working", sentence: "Taking pictures. This takes about a minute." } } : { status: 200, body: answer([failed]) }));
  try {
    const root = await showTree(site.SiteView, { id: "STH-2" });
    assert.match(textOf(root), /The page viewer's answer was not what it sends\./);
    fire(buttons(root, "Try again")[0], "click");
    await settle();
    assert.ok(f.calls.some((c) => c.method === "POST" && c.path === "/api/tasks/STH-2/sites/launch-a/shots"));
    assert.equal(f.calls.at(-1).method, "GET", "the list is read again after asking");
  } finally {
    f.restore();
  }
});

test("site.css is tokens only, its selectors the kit's, and it is linked once", () => {
  const css = readFileSync(join(PUBLIC, "styles", "kit", "site.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\brgba?\(|hsla?\(/i);
  assert.doesNotMatch(css, /font-family|font-size\s*:\s*[\d.]+px|url\(/i);
  const blocks = css.replace(/@(?:media|supports|container)[^{]+\{/g, "");
  for (const m of blocks.matchAll(/([^{}@;]+)\{/g)) {
    for (const sel of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      assert.match(sel, /^(button)?\.k-/, `selector "${sel}" is the kit's`);
    }
  }
  const page = readFileSync(join(PUBLIC, "index.html"), "utf8");
  assert.equal(page.split('href="./styles/kit/site.css"').length - 1, 1);
});
