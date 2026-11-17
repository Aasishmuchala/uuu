import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { groupByWeek, draftIdOf, itemFor, conceptsOf, Concepts, Carousels, Recipes, SlidesLarge } from "../../pages/marketing.js";

const NEXT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { html, render } = await import(pathToFileURL(join(NEXT, "vendor", "preact-htm.js")).href);


const WED = new Date(2026, 10, 11);
const where = (planned) => {
  const g = groupByWeek([{ planned, title: "x" }], WED).find((x) => x.rows.length);
  return g.title;
};

test("groupByWeek: 12 Nov is this week", () => assert.equal(where("2026-11-12"), "This week"));
test("groupByWeek: 16 Nov is next week", () => assert.equal(where("2026-11-16"), "Next week"));
test("groupByWeek: 30 Nov is later", () => assert.equal(where("2026-11-30"), "Later"));
test("groupByWeek: no date and a bad date go under No date", () => {
  assert.equal(where(""), "No date");
  assert.equal(where(undefined), "No date");
  assert.equal(where("soon"), "No date");
});
test("groupByWeek: a past date is this week", () => {
  assert.equal(where("2026-11-03"), "This week");
  assert.equal(where("2025-01-01"), "This week");
});
test("groupByWeek: Monday and Sunday edges, and today as text", () => {
  assert.equal(where("2026-11-09"), "This week");
  assert.equal(where("2026-11-15"), "This week");
  assert.equal(where("2026-11-22"), "Next week");
  assert.equal(where("2026-11-23"), "Later");
  const g = groupByWeek([{ planned: "2026-11-16" }], "2026-11-15");
  assert.equal(g[1].rows.length, 1);
});
test("groupByWeek: always four groups in order, rows sorted by date", () => {
  const g = groupByWeek([{ planned: "2026-11-13" }, { planned: "2026-11-10" }], WED);
  assert.deepEqual(g.map((x) => x.title), ["This week", "Next week", "Later", "No date"]);
  assert.deepEqual(g[0].rows.map((r) => r.planned), ["2026-11-10", "2026-11-13"]);
  assert.deepEqual(groupByWeek(null, WED).map((x) => x.rows.length), [0, 0, 0, 0]);
});
test("draftIdOf and itemFor read the inbox id", () => {
  const row = { inboxId: "content:0123456789ab" };
  assert.equal(draftIdOf(row), "0123456789ab");
  assert.equal(draftIdOf({ inboxId: "content:../x" }), null);
  assert.equal(draftIdOf({}), null);
  const item = { id: "content:0123456789ab" };
  assert.equal(itemFor(row, { items: [item] }), item);
  assert.equal(itemFor(row, { items: [] }), null);
});

test("plannedLabel reads a planned day plainly", async () => {
  const { plannedLabel } = await import("../../pages/marketing.js");
  assert.equal(plannedLabel("2026-11-12"), "Thu 12 Nov");
  assert.equal(plannedLabel("2026-11-09"), "Mon 9 Nov");
  assert.equal(plannedLabel(""), "No date");
  assert.equal(plannedLabel("2026-02-30"), "No date");
});
test("waitingDrafts keeps only rows whose decision is in the inbox, by date", async () => {
  const { waitingDrafts } = await import("../../pages/marketing.js");
  const a = { id: "content:aaaaaaaaaaaa" };
  const b = { id: "content:bbbbbbbbbbbb" };
  const rows = [
    { planned: "2026-11-18", inboxId: b.id },
    { planned: "2026-11-12", inboxId: a.id },
    { planned: "2026-11-13", inboxId: "content:cccccccccccc" },
    { planned: "2026-11-14" },
  ];
  assert.deepEqual(waitingDrafts(rows, { items: [a, b] }).map((x) => x.item.id), [a.id, b.id]);
  assert.deepEqual(waitingDrafts(null, null), []);
});

test("conceptsOf keeps five headlines per task and a link to the task", async () => {
  const { conceptsOf } = await import("../../pages/marketing.js");
  const rows = [
    { identifier: "STH-23", title: "Diwali offer", headlines: ["a", "b", "c", "d", "e", "f"] },
    { identifier: "STH-9", headlines: [] },
  ];
  const out = conceptsOf({ rows });
  assert.equal(out.length, 1);
  assert.equal(out[0].headlines.length, 5);
  assert.equal(out[0].href, "#/tasks/STH-23");
  assert.deepEqual(conceptsOf(null), []);
});
test("scoreList reads a list or the text form, and drops the rest", async () => {
  const { scoreList, scoreTone } = await import("../../pages/marketing.js");
  // A label an agent wrote is never shown: every piece is "piece <n>" (M63 item 26).
  assert.deepEqual(scoreList("concept-1 9, concept-2 8"), [{ label: "piece 1", score: 9 }, { label: "piece 2", score: 8 }]);
  assert.deepEqual(scoreList([{ slug: "a", score: 7 }, { slug: "b", score: 11 }]), [{ label: "piece 1", score: 7 }]);
  assert.deepEqual(scoreList([{ label: "piece 1", score: 9 }, { label: "saturday-short", score: 8 }]), [{ label: "piece 1", score: 9 }, { label: "piece 2", score: 8 }]);
  assert.deepEqual(scoreList("a b, 9"), []);
  assert.equal(scoreList(Array.from({ length: 30 }, (_, i) => ({ slug: `s${i}`, score: 8 }))).length, 20);
  assert.equal(scoreTone(8), "ok");
  assert.equal(scoreTone(7), "warn");
});
test("verdictTone and checksLine say it plainly", async () => {
  const { verdictTone, checksLine } = await import("../../pages/marketing.js");
  assert.equal(verdictTone("Accepted"), "ok");
  assert.equal(verdictTone("Sent back"), "warn");
  assert.equal(verdictTone("x"), "neutral");
  assert.equal(checksLine({ checks: { ok: true } }), "Count and sizes are right");
  assert.equal(checksLine({ checks: { ok: false, countMatches: false, sizesMatch: false } }), "Needs a look: the count is wrong and the sizes differ");
  assert.equal(checksLine({}), "Not checked");
});
test("slideSetById finds a set by goal and name; only view addresses are shown", async () => {
  const { slideSetById, slideSets } = await import("../../pages/marketing.js");
  const data = { sets: [{ id: "STH-24/launch" }, null, { id: 5 }] };
  assert.equal(slideSets(data).length, 1);
  assert.equal(slideSetById(data, "STH-24/launch").id, "STH-24/launch");
  assert.equal(slideSetById(data, "STH-24/other"), null);
  assert.equal(slideSetById(null, "x"), null);
});

// ---- Components rendered into a very small DOM (as in pages-u2). ----
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
}
class FakeText extends FakeNode { constructor(d) { super(); this.nodeType = 3; this.data = String(d); } }
class FakeElement extends FakeNode {
  constructor(tag) { super(); this.nodeType = 1; this.localName = tag; this.attrs = {}; this.style = { cssText: "", setProperty(k, v) { this[k] = v; } }; this.listeners = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
  focus() { globalThis.document.activeElement = this; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
function installDom() {
  const d = {
    title: "", activeElement: null,
    createElement: (t) => new FakeElement(t), createElementNS: (_ns, t) => new FakeElement(t), createTextNode: (x) => new FakeText(x),
    addEventListener() {}, removeEventListener() {},
  };
  d.body = new FakeElement("body");
  globalThis.document = d;
}
function* walk(node) { yield node; for (const c of node.childNodes) yield* walk(c); }
const elements = (root) => [...walk(root)].filter((n) => n.nodeType === 1);
const textOf = (root) => [...walk(root)].filter((n) => n.nodeType === 3).map((n) => n.data).join("");
const classOf = (el) => String(el.getAttribute("class") ?? el.className ?? "");
const hasClass = (root, c) => elements(root).some((e) => classOf(e).split(/\s+/).includes(c));
const settle = () => new Promise((r) => setTimeout(r, 110));
async function show(Component, props) {
  installDom();
  const root = new FakeElement("div");
  render(html`<${Component} ...${props} />`, root);
  await settle();
  return root;
}

test("conceptsOf: the task may be a text or an object, and the headlines are cut to five", () => {
  const six = ["a", "b", "c", "d", "e", "f"];
  const rows = [
    { task: { id: "t1", identifier: "STH-7", title: "Diwali" }, headlines: six },
    { task: "STH-8", list: ["x"] },
    { identifier: "STH-9", items: [{ headline: "y" }] },
    { task: "STH-10", headlines: [] },
  ];
  const list = conceptsOf({ rows });
  assert.equal(list.length, 3);
  assert.equal(list[0].href, "#/tasks/STH-7");
  assert.equal(list[0].title, "Diwali");
  assert.equal(list[0].headlines.length, 5);
  assert.equal(list[1].href, "#/tasks/STH-8");
  assert.deepEqual(list[2].headlines, ["y"]);
  assert.ok(!JSON.stringify(list).includes("[object Object]"));
});

test("Concepts: an empty section shows its sentence, a full one links to the task", async () => {
  let root = await show(Concepts, { section: { rows: [] } });
  assert.match(textOf(root), /No concepts yet/);
  root = await show(Concepts, { section: { rows: [{ task: { identifier: "STH-7" }, headlines: ["One", "Two"] }] } });
  assert.match(textOf(root), /One/);
  assert.ok(elements(root).some((e) => e.localName === "a" && e.getAttribute("href") === "#/tasks/STH-7"));
});

test("Carousels: not connected shows the line instead of crashing", async () => {
  const slides = { data: { notConnected: { reason: "The slide tool is not installed.", next: "Run the installer." } } };
  const root = await show(Carousels, { slides, current: "", onOpen() {} });
  assert.match(textOf(root), /Not connected yet/);
  assert.match(textOf(root), /slide tool is not installed/);
});

test("Carousels: empty sentence, and a set opens through its button", async () => {
  let root = await show(Carousels, { slides: { data: { sets: [] } }, current: "", onOpen() {} });
  assert.match(textOf(root), /No carousels yet/);
  let opened = "";
  const sets = [{ id: "g/one", title: "One", count: 5, checks: { ok: true }, contact: { viewUrl: "/api/view/x.png" } }];
  root = await show(Carousels, { slides: { data: { sets } }, current: "", onOpen: (id) => { opened = id; } });
  const btn = elements(root).find((e) => e.localName === "button");
  (btn.listeners.click || btn.listeners.Click)[0].call(btn, { type: Object.keys(btn.listeners)[0] });
  assert.equal(opened, "g/one");
});

test("Recipes: empty sentence and score chips", async () => {
  let root = await show(Recipes, { section: { rows: [] } });
  assert.match(textOf(root), /Nothing made and answered yet/);
  root = await show(Recipes, { section: { rows: [{ date: "2026-11-01", job: "Post", rounds: 2, scores: "concept-1 9, concept-2 6", verdict: "Accepted" }] } });
  // The Checker's labels are its own words: every piece is shown as "piece <n>" (M63 item 26).
  assert.match(textOf(root), /piece 1: 9/);
  assert.match(textOf(root), /piece 2: 6/);
  assert.doesNotMatch(textOf(root), /concept-1/);
  assert.match(textOf(root), /Accepted/);
  root = await show(Recipes, { section: { rows: [{ date: "12 Nov 2026", job: "Post", rounds: 1, scores: [{ label: "piece 1", score: 9 }, { slug: "saturday-short", score: 8 }], verdict: "Sent back" }] } });
  assert.match(textOf(root), /piece 1: 9/);
  assert.match(textOf(root), /piece 2: 8/);
  assert.doesNotMatch(textOf(root), /saturday-short/);
});

test("SlidesLarge: shows only pictures from /api/view/", async () => {
  const set = { id: "g/one", slides: [{ viewUrl: "/api/view/a.png" }, { viewUrl: "https://evil/x.png" }], texts: ["First"] };
  const root = await show(SlidesLarge, { set });
  const imgs = elements(root).filter((e) => e.localName === "img");
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].getAttribute("src"), "/api/view/a.png");
  assert.match(textOf(root), /cannot be shown/);
});

test("marketing: a ?slides= for a carousel that is not there is said, once the carousels are read (M51 F26)", async () => {
  const m = await import("../../pages/marketing.js");
  const data = { sets: [{ id: "STH-24/launch", title: "Launch" }] };
  assert.equal(m.slidesMissing(data, "STH-24/gone"), true);
  assert.equal(m.slidesMissing(data, "STH-24/launch"), false);
  assert.equal(m.slidesMissing(null, "STH-24/gone"), false, "not before the answer");
  assert.equal(m.slidesMissing(data, ""), false);
});

test("marketing: no old ready-made goals strip and no read of the gallery route (M51 F3)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../pages/marketing.js", import.meta.url), "utf8");
  assert.ok(!/\/api\/gallery/.test(src));
  assert.ok(!/[Rr]eady-made/.test(src.replace(/^\s*\/\/.*$/gm, "")));
  assert.match(src, /<\$\{Jobs\} dept="marketing"/);
});

test("marketing: posts filtered by kind and status, through the address", async () => {
  const m = await import("../../pages/marketing.js");
  const rows = [
    { title: "a", kind: "Post", status: "Waiting for you" },
    { title: "b", kind: "Newsletter", status: "Approved" },
    { title: "c", kind: "post", status: "Approved" },
  ];
  assert.deepEqual(m.postChoices(rows, "kind"), [{ value: "post", label: "Post" }, { value: "newsletter", label: "Newsletter" }]);
  assert.deepEqual(m.filterPosts(rows, { kind: "post" }).map((r) => r.title), ["a", "c"]);
  assert.deepEqual(m.filterPosts(rows, { kind: "post", st: "approved" }).map((r) => r.title), ["c"]);
  assert.deepEqual(m.filterPosts(null, {}), []);
  assert.deepEqual(m.postFilters(new URLSearchParams("kind=Post&st=approved&slides=x")), { kind: "post", st: "approved" });
  assert.equal(m.marketingAddress({}), "#/dashboards/marketing");
  assert.equal(m.marketingAddress({ kind: "post", st: "approved" }), "#/dashboards/marketing?kind=post&st=approved");
  assert.equal(m.MARKETING_WORDS.noMatch, "No posts match these filters.");
});

test("marketing: a post's picture only from /api/view/, else its kind's line icon", async () => {
  const m = await import("../../pages/marketing.js");
  assert.equal(m.rowPicture({ picture: { viewUrl: "/api/view/a.png" } }), "/api/view/a.png");
  assert.equal(m.rowPicture({ viewUrl: "/api/view/b.png" }), "/api/view/b.png");
  assert.equal(m.rowPicture({ picture: { viewUrl: "https://evil/x.png" } }), null);
  assert.equal(m.rowPicture({}), null);
  assert.equal(m.kindIcon("Post"), "image");
  assert.equal(m.kindIcon("Newsletter"), "send");
  assert.equal(m.kindIcon("anything"), "docs");
});

test("marketing: a shotlist or a card of versions waiting is the compact card; drafts link to Needs you", async () => {
  const m = await import("../../pages/marketing.js");
  const inbox = { items: [
    { id: "s", kind: "shotlist", department: "marketing" },
    { id: "p", kind: "pick", department: "marketing", variants: [{ id: "a" }] },
    { id: "o", kind: "shotlist", department: "studio" },
    { id: "d", kind: "draft", department: "marketing" },
  ] };
  assert.deepEqual(m.cardsWaiting(inbox).map((i) => i.id), ["s", "p"]);
  assert.deepEqual(m.cardsWaiting(null), []);
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../pages/marketing.js", import.meta.url), "utf8");
  assert.match(src, /<\$\{DecisionCard\} item=\$\{item\} compact onDone=\$\{onDone\} \/>/);
  assert.match(src, /<\$\{QueueLink\} dept="marketing" \/>/);
  assert.match(src, /<\$\{St\} tone=\$\{STATUS_TONE\[row\.status\] \|\| "neutral"\}>/);
  assert.doesNotMatch(src, /creature=|over=/);
});

// ---- The whole page, mounted in the shared test DOM with a fake fetch (PLAN-3D-ALL U12). ----
const dom = await import("../kit/_dom.mjs");
const { AppContext } = await import("../../lib/context.js");
const page = await import("../../pages/marketing.js");
const { existsSync: there, readFileSync: readText } = await import("node:fs");
const SHAPES = (() => {
  let d = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const c = join(d, "server", "test", "shapes");
    if (there(c)) return c;
    const p = dirname(d);
    if (p === d) throw new Error("shape files not found");
    d = p;
  }
})();
const shape = (name) => JSON.parse(readText(resolve(SHAPES, `${name}.json`), "utf8"));
const fire = (el, type, ev = {}) => { for (const f of el.listeners[type] || []) f.call(el, { type, preventDefault() {}, stopPropagation() {}, ...ev }); };
const iso = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// The Marketing answer as routes/marketing.mjs words it.
const MARKETING = () => ({
  id: "marketing", title: "Marketing", connected: true, notConnected: null,
  agent: { slug: "marketer", name: "Marketer", state: "working", plainState: "Working" },
  figures: [
    { id: "drafts", label: "Drafts waiting", value: "1", hint: "Waiting for you" },
    { id: "approved", label: "Approved", value: "1", hint: "Approved, not published" },
    { id: "this_week", label: "Planned this week", value: "2", hint: "16 to 22 Nov" },
  ],
  sections: [
    { id: "calendar", title: "Content calendar", emptyText: "No drafts yet. Give the Marketer a goal to get some.",
      columns: [{ key: "planned", label: "Planned" }, { key: "title", label: "Title" }, { key: "kind", label: "Kind" }, { key: "status", label: "Status" }],
      rows: [
        { planned: iso(1), title: "Winter kitchens: three layouts that save steps", kind: "Post", status: "Waiting for you", inboxId: "content:aaaaaaaaaaaa" },
        { planned: iso(9), title: "November newsletter", kind: "Newsletter", status: "Approved" },
        { planned: "", title: "A carousel on hinges", kind: "Carousel", status: "Sent back" },
      ] },
    { id: "concepts", title: "Concepts", emptyText: "No concepts yet.", columns: [], rows: [{ identifier: "STH-23", title: "Diwali offer", headlines: ["Light the kitchen", "Cabinets made to measure"] }] },
    { id: "carousels", title: "Carousels", emptyText: "No carousels yet.", columns: [], rows: [] },
    { id: "recipes", title: "What was made and how it did", emptyText: "Nothing made and answered yet.", columns: [],
      rows: [{ date: "12 Nov 2026", job: "Post", rounds: 2, scores: "concept-1 9, concept-2 7", verdict: "Accepted" }] },
    { id: "problems", title: "Files that could not be used", emptyText: "", columns: [{ key: "file", label: "File" }, { key: "problem", label: "What is wrong" }],
      rows: [{ file: "drafts/broken.md", problem: "It has no title line." }] },
  ],
  inFlight: [{ goalId: "e0000000-0000-4000-8000-000000000024", title: "A carousel on hinges", plainState: "Being worked on" }],
  switches: [{ id: "publishing", label: "Publish posts and newsletters", on: false, explain: "Connect an account to turn this on." }],
});
const DRAFT_ITEM = () => ({
  id: "content:aaaaaaaaaaaa", source: "content", kind: "draft", department: "marketing", version: "v1",
  title: "Approve a post: Winter kitchens", when: "2026-11-16T09:00:00.000Z", summary: "A post for Thursday.",
  actions: [{ id: "approve", label: "Approve", style: "primary", needsNote: false }, { id: "reject", label: "Send back", style: "secondary", needsNote: true }],
});
const INBOX = () => ({ items: [DRAFT_ITEM(), { ...shape("shotlist-item"), department: "marketing" }] });
const CONTENT = () => ({ draft: { id: "aaaaaaaaaaaa", title: "Winter kitchens", body: "Three layouts that save steps.\n\nOne: the triangle.", note: "" } });
const MAP = () => ({ id: "marketing", clusters: [{ id: "c", title: "C", jobs: [
  { id: "marketing/a-post", title: "A post on one subject", summary: "One post.", ready: true, department: { id: "marketing", title: "Marketing" }, runs: { total: 0 } },
] }] });
const seeded = (over = {}) => (path, method) => {
  if (method === "POST" && path === "/api/inbox/act") return { ok: true, message: "Approved." };
  const all = {
    "/api/departments/marketing": MARKETING(), "/api/studio/slides": shape("studio-slides"), "/api/inbox": INBOX(),
    "/api/content/aaaaaaaaaaaa": CONTENT(), "/api/map/marketing": MAP(), ...over,
  };
  return Object.hasOwn(all, path) ? all[path] : null;
};

async function mountMarketing(answers, { query = "", panels = [] } = {}) {
  dom.installDom();
  globalThis.document.visibilityState = "visible";
  const hash = `#/dashboards/marketing${query ? `?${query}` : ""}`;
  globalThis.location = { hash, href: `/${hash}`, search: "" };
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts = {}) => {
    const m = opts.method || "GET";
    calls.push(`${m} ${path}${opts.body === undefined ? "" : ` ${opts.body}`}`);
    const data = answers(String(path), m);
    if (data === undefined) return new Promise(() => {});
    return data ? { ok: true, status: 200, json: async () => data }
      : { ok: false, status: 500, json: async () => ({ error: { code: "x", message: "That did not answer.", next: "Try again." } }) };
  };
  const tops = [];
  const nothing = () => {};
  const ctx = {
    shell: { team: [], dock: [] }, announce: nothing, openComposer: nothing, openNeeds: nothing,
    openPanel: (_body, o) => panels.push(o), closePanel: nothing, setTop: (t) => tops.push(t), settings: { motion: "off", theme: "dark" },
  };
  const root = new dom.FakeElement("div");
  globalThis.document.body.appendChild(root);
  dom.render(dom.html`<${AppContext.Provider} value=${ctx}><${page.default} route=${{ id: "marketing", parts: ["dashboards", "marketing"], query: new URLSearchParams(query) }} /><//>`, root);
  await dom.settle();
  return { root, calls, tops, done: async () => { dom.render(null, root); root.remove(); await dom.settle(50); globalThis.fetch = real; delete globalThis.location; } };
}

test("marketing: the page sends what it sent before (PLAN-3D-ALL)", async () => {
  const seen = [];
  const panels = [];
  for (const [answers, opts] of [
    [seeded(), {}],
    [seeded(), { query: "kind=post&st=approved" }],
    [seeded(), { query: "slides=STH-24%2Flaunch", panels }],
    [seeded({ "/api/departments/marketing": undefined }), {}],
    [seeded({ "/api/departments/marketing": null }), {}],
  ]) {
    const m = await mountMarketing(answers, opts);
    try { seen.push(...m.calls); } finally { await m.done(); }
  }
  assert.deepEqual(panels.map((p) => p.title), ["Launch carousel"], "?slides= opens the set in the work panel");
  // A waiting post opened in place, then its draft approved there.
  const m = await mountMarketing(seeded());
  try {
    const row = dom.elements(m.root).find((e) => e.localName === "button" && dom.classOf(e).includes("p-marketing__head") && dom.textOf(e).includes("Winter kitchens"));
    fire(row, "Click");
    await dom.settle();
    const approve = dom.elements(m.root).find((e) => e.localName === "button" && dom.textOf(e) === "Approve");
    fire(approve, "Click", { currentTarget: approve });
    await dom.settle();
    seen.push(...m.calls);
  } finally { await m.done(); }
  // Recorded on the page before PLAN-3D-ALL U12 changed it: the page, its carousels, Needs you and the jobs (the
  // jobs not while the answer is missing or failed), the draft opened, approved, and the page and Needs you read again.
  const FOUR = ["GET /api/departments/marketing", "GET /api/studio/slides", "GET /api/inbox", "GET /api/map/marketing"];
  const THREE = FOUR.slice(0, 3);
  const RECORDED = [
    ...FOUR, ...FOUR, ...FOUR, ...THREE, ...THREE, ...FOUR,
    "GET /api/content/aaaaaaaaaaaa",
    `POST /api/inbox/act {"id":"content:aaaaaaaaaaaa","action":"approve","version":"v1"}`,
    "GET /api/departments/marketing",
    "GET /api/inbox",
  ];
  assert.deepEqual(seen, RECORDED);
  for (const c of seen) assert.ok(!/\/assets\/world\/|\/vendor\/three-/.test(c), c);
});
