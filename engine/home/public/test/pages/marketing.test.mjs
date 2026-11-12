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
