// The kit's new parts (CONTRACTS-V3 28, M12): the pinned names and root classes, the pure helpers
// (splitMarks, fillPreview, checkForm, checkAnswers, refusePick, segStep, ringShare), the states of JobStart,
// AnswerView and FilePicker, agents' words kept as text, and each stylesheet held to the rules of 27.3.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TREE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = join(TREE, "kit");
const STYLES = join(TREE, "styles", "kit");
const NEW = ["segmented", "job", "answer", "ring", "forms", "upload"];
const PINNED = {
  segmented: ["Segmented"],
  job: ["HandoffTag", "StageMark", "WhyNot", "JobRow", "JobChip", "JobStart", "fillPreview"],
  answer: ["AnswerView", "splitMarks"],
  ring: ["Ring"],
  forms: ["FormFields", "checkForm"],
  upload: ["FilePicker"],
};
const ROOTS = { segmented: "k-seg", job: "k-job", answer: "k-answer", ring: "k-ring", forms: "k-form", upload: "k-upload" };

// Load every module before any fake document exists: nothing may touch document or window at load.
const kit = {};
for (const m of NEW) kit[m] = await import(pathToFileURL(join(KIT, `${m}.js`)).href);
const { html, render } = await import(pathToFileURL(join(TREE, "vendor", "preact-htm.js")).href);

// The shapes `job` and `ask` of the home server's tests, found by walking up from this tree.
function shapesDir() {
  for (let d = TREE; d !== dirname(d); d = dirname(d)) {
    const s = join(d, "server", "test", "shapes");
    if (existsSync(join(s, "job.json"))) return s;
  }
  return null;
}
const SHAPES = shapesDir();
const shape = (name) => JSON.parse(readFileSync(join(SHAPES, `${name}.json`), "utf8"));


// ---- A very small DOM, enough for Preact to render into and for us to walk. ----
class FakeNode {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  get nextSibling() {
    const p = this.parentNode;
    return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null;
  }
  appendChild(c) {
    return this.insertBefore(c, null);
  }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c);
    else this.childNodes.splice(i, 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  contains(n) {
    for (let x = n; x; x = x.parentNode) if (x === this) return true;
    return false;
  }
}
class FakeText extends FakeNode {
  constructor(d) {
    super();
    this.nodeType = 3;
    this.data = String(d);
  }
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
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null;
  }
  removeAttribute(k) {
    delete this.attrs[k];
  }
  addEventListener(t, f) {
    (this.listeners[t] ||= []).push(f);
  }
  removeEventListener(t, f) {
    this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f);
  }
  focus() {
    globalThis.document.activeElement = this;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
}
function installDom() {
  const doc = {
    title: "",
    activeElement: null,
    createElement: (t) => new FakeElement(t),
    createElementNS: (_ns, t) => new FakeElement(t),
    createTextNode: (d) => new FakeText(d),
    addEventListener() {},
    removeEventListener() {},
  };
  doc.body = new FakeElement("body");
  globalThis.document = doc;
}
function* walk(node) {
  yield node;
  for (const c of node.childNodes) yield* walk(c);
}
const elements = (root) => [...walk(root)].filter((n) => n.nodeType === 1);
const textOf = (root) => [...walk(root)].filter((n) => n.nodeType === 3).map((n) => n.data).join("");

// Preact runs effects after a 100 ms timer when there is no requestAnimationFrame.
const settle = () => new Promise((r) => setTimeout(r, 110));

async function mount(Component, props) {
  const root = new FakeElement("div");
  globalThis.document.body.appendChild(root);
  render(html`<${Component} ...${props} />`, root);
  await settle();
  return root;
}
function unmount(root) {
  render(null, root);
  root.remove();
}
function fire(el, type, extra = {}) {
  const key = Object.keys(el.listeners).find((k) => k.toLowerCase() === type);
  assert.ok(key, `${el.localName} listens for ${type}`);
  const ev = { type: key, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, ...extra };
  for (const f of el.listeners[key]) f.call(el, ev);
}
const classesOf = (el) => (el.getAttribute("class") || "").split(/\s+/).filter(Boolean);
const byClass = (root, c) => elements(root).filter((e) => classesOf(e).includes(c));
const isVNode = (v) => v !== null && typeof v === "object" && "type" in v && "props" in v;

function stubFetch(answer) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts) => {
    calls.push({ path, method: opts.method, headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : null });
    const a = answer(path, calls.length);
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const HOSTILE = '<script>alert("x")</script><img src=x onerror=alert(1)>';
const BRAND = {
  id: "brand", folder: "brand", file: "brand.md", title: "Brand", lead: "How your company looks and sounds.",
  fields: [
    { id: "tone", label: "Three to five words for how you sound", kind: "list", required: true, max: 5, hint: "Such as: warm, plain, exact." },
    { id: "colours", label: "Your colours", kind: "colour", required: true, max: 5 },
    { id: "fonts", label: "Your typeface", kind: "choice", required: false, options: ["Helvetica Neue", "Avenir Next", "Didot"] },
    { id: "signoff", label: "How you sign off", kind: "line", required: false },
    { id: "story", label: "Your story", kind: "text", required: true },
  ],
};
const SERVICES = {
  id: "services", folder: "pricing", file: "services.md", title: "Prices and services",
  fields: [{ id: "items", label: "What you sell", kind: "rows", required: true, columns: [{ id: "name", label: "Name" }, { id: "price", label: "Price" }] }],
};
const LEAD = {
  id: "sales/first-message-to-a-lead", department: { id: "sales", title: "Sales" }, cluster: { id: "leads", title: "Leads" },
  title: "Write a first message to a lead", summary: "A first message.", handoff: "you-lead", stage: 3, size: "S", planFirst: false,
  who: [{ slug: "sales", name: "Sales" }], reads: [], takes: null, ready: true, why: null, runs: null,
  asks: [
    { id: "lead", label: "Who is the lead?", kind: "line", required: true, options: null },
    { id: "when", label: "When did you meet?", kind: "date", required: false, options: null },
    { id: "count", label: "How many?", kind: "number", required: false, options: null },
    { id: "tone", label: "How should it sound?", kind: "choice", required: false, options: ["warm", "short"] },
    { id: "doc", label: "Which file?", kind: "file", required: false, options: [{ value: "calls/asha.md", label: "asha.md" }] },
    { id: "clip", label: "Which clip?", kind: "media", required: false, options: [{ value: "talk.mp4", label: "talk.mp4" }] },
    { id: "about", label: "What do they need?", kind: "text", required: false, options: null },
  ],
  text: "Write to [lead], met on [when]. Use [doc] and [clip]. Write [count] versions, [tone]. [about]",
};

// ---- Loading and names ----

test("every new module loads in Node and exports its pinned names", () => {
  assert.equal(globalThis.document, undefined, "no document existed while the modules loaded");
  for (const [m, names] of Object.entries(PINNED)) {
    for (const name of names) assert.equal(typeof kit[m][name], "function", `kit/${m}.js exports ${name}`);
  }
});

test("kit/index.js re-exports the new modules and creature.js, and exposes every new name", async () => {
  const src = readFileSync(join(KIT, "index.js"), "utf8");
  for (const m of [...NEW, "creature"]) assert.ok(src.includes(`export * from "./${m}.js";`), `index.js re-exports ${m}.js`);
  const index = await import(pathToFileURL(join(KIT, "index.js")).href);
  for (const n of ["Creature", "Segmented", "JobStart", "JobRow", "HandoffTag", "StageMark", "WhyNot", "AnswerView", "Ring", "FormFields", "FilePicker"]) {
    assert.equal(typeof index[n], "function", `index.js exports ${n}`);
  }
});

// ---- splitMarks ----

test("splitMarks: the pinned vector", () => {
  assert.deepEqual(kit.answer.splitMarks("A [1] b [2][3]."), [{ text: "A " }, { mark: 1 }, { text: " b " }, { mark: 2 }, { mark: 3 }, { text: "." }]);
});

test("splitMarks: text with no marks is one piece; nothing gives nothing", () => {
  assert.deepEqual(kit.answer.splitMarks("No marks here, only [brackets]."), [{ text: "No marks here, only [brackets]." }]);
  assert.deepEqual(kit.answer.splitMarks(""), []);
  assert.deepEqual(kit.answer.splitMarks(undefined), []);
  assert.deepEqual(kit.answer.splitMarks(42), []);
});

test("splitMarks: [0], [13] and [01] stay text; [12] is a mark", () => {
  assert.deepEqual(kit.answer.splitMarks("a [0] b"), [{ text: "a [0] b" }]);
  assert.deepEqual(kit.answer.splitMarks("a [13] b"), [{ text: "a [13] b" }]);
  assert.deepEqual(kit.answer.splitMarks("a [01] b"), [{ text: "a [01] b" }]);
  assert.deepEqual(kit.answer.splitMarks("[0][12][13]"), [{ text: "[0]" }, { mark: 12 }, { text: "[13]" }]);
  assert.deepEqual(kit.answer.splitMarks("[123]"), [{ text: "[123]" }]);
});

test("splitMarks runs in linear time on a long hostile text", () => {
  const long = "[".repeat(200000) + "1]" + "x [99] ".repeat(20000);
  const t = Date.now();
  const parts = kit.answer.splitMarks(long);
  assert.ok(Date.now() - t < 500, "fast");
  assert.equal(parts.filter((p) => p.mark).length, 1);
});

// ---- fillPreview ----

test("fillPreview: the shape's job with a task answer and an empty optional answer", { skip: SHAPES ? false : "no shapes" }, () => {
  // M55: the server no longer puts the short ref in an option's label (it is not shown); it sends it as `ref`.
  const asks = shape("job").asks.map((a) => (a.kind === "task"
    ? { ...a, options: a.options.map((o) => ({ ...o, ref: /^[A-Z]+-\d+/.exec(o.label)?.[0] || "STH-20" })) } : a));
  const job = { ...shape("job"), asks: [...asks, { id: "extra", label: "Anything to add?", kind: "text", required: false, options: null }],
    text: "Write a proposal for the customer of the call write-up in [earlier]. Use our price list. [extra]" };
  assert.equal(
    kit.job.fillPreview(job, { earlier: "e0000000-0000-4000-8000-000000000020" }),
    "Write a proposal for the customer of the call write-up in the sub-folder STH-20 of your current working folder. Use our price list.",
  );
  assert.equal(
    kit.job.fillPreview(job, { earlier: "e0000000-0000-4000-8000-000000000020", extra: "They want it by Friday." }),
    "Write a proposal for the customer of the call write-up in the sub-folder STH-20 of your current working folder. Use our price list. They want it by Friday.",
  );
});

test("fillPreview: each kind, a missing required answer stays, and an answer is never read for [ids]", () => {
  const out = kit.job.fillPreview(LEAD, { lead: "Asha [when]", when: "2026-11-10", doc: "calls/asha.md", clip: "talk.mp4", count: "2", tone: "warm" });
  assert.equal(out, "Write to Asha [when], met on 2026-11-10. Use the company file calls/asha.md and the file talk.mp4 in the room. Write 2 versions, warm.");
  assert.equal(kit.job.fillPreview(LEAD, {}), "Write to [lead], met on. Use and. Write versions,.");
  assert.equal(kit.job.fillPreview(null, {}), "");
});

// ---- checkForm ----

const good = { tone: ["warm", "plain", "exact"], colours: ["#2f6f5e"], fonts: "Didot", signoff: "With thanks", story: "We fit kitchens." };

test("checkForm: good values pass", () => {
  assert.deepEqual(kit.forms.checkForm(BRAND, good), { ok: true, errors: {} });
  assert.deepEqual(kit.forms.checkForm(SERVICES, { items: [{ name: "Survey", price: "2500" }] }), { ok: true, errors: {} });
});

test("checkForm: line and text", () => {
  const f = kit.forms.checkForm;
  assert.match(f(BRAND, { ...good, story: "  " }).errors.story, /Fill this in/);
  assert.match(f(BRAND, { ...good, story: "x".repeat(4001) }).errors.story, /4000/);
  assert.equal(f(BRAND, { ...good, story: "x".repeat(4000) }).ok, true);
  assert.equal(f(BRAND, { ...good, signoff: "" }).ok, true, "an empty optional line is fine");
  assert.match(f(BRAND, { ...good, signoff: "x".repeat(201) }).errors.signoff, /200/);
  assert.match(f(BRAND, { ...good, signoff: "one\ntwo" }).errors.signoff, /one line/);
});

test("checkForm: list", () => {
  const f = kit.forms.checkForm;
  assert.match(f(BRAND, { ...good, tone: [] }).errors.tone, /Fill this in/);
  assert.match(f(BRAND, { ...good, tone: ["", "  "] }).errors.tone, /Fill this in/, "blank lines do not count");
  assert.match(f(BRAND, { ...good, tone: ["a", "b", "c", "d", "e", "f"] }).errors.tone, /at most 5/);
  assert.equal(f(BRAND, { ...good, tone: ["a", "", "b"] }).ok, true);
  assert.match(f(BRAND, { ...good, tone: ["x".repeat(201)] }).errors.tone, /200/);
  assert.match(f(BRAND, { ...good, tone: "warm" }).errors.tone, /Fill this in/, "a list that is not a list is empty");
});

test("checkForm: rows", () => {
  const f = kit.forms.checkForm;
  assert.match(f(SERVICES, { items: [] }).errors.items, /at least one row/);
  assert.match(f(SERVICES, { items: [{ name: " ", price: "" }] }).errors.items, /at least one row/);
  assert.match(f(SERVICES, { items: Array.from({ length: 61 }, (_, i) => ({ name: `n${i}` })) }).errors.items, /60 rows/);
  assert.match(f(SERVICES, { items: [{ name: "x".repeat(201) }] }).errors.items, /200/);
});

test("checkForm: colour", () => {
  const f = kit.forms.checkForm;
  assert.match(f(BRAND, { ...good, colours: [] }).errors.colours, /at least one colour/);
  assert.match(f(BRAND, { ...good, colours: ["teal"] }).errors.colours, /six letters or numbers/);
  assert.match(f(BRAND, { ...good, colours: ["#fff"] }).errors.colours, /six letters or numbers/);
  assert.match(f(BRAND, { ...good, colours: ["#000000", "#111111", "#222222", "#333333", "#444444", "#555555"] }).errors.colours, /at most 5/);
  assert.equal(f(BRAND, { ...good, colours: ["#ABCDEF", ""] }).ok, true);
});

test("checkForm: choice, and nothing given at all", () => {
  const f = kit.forms.checkForm;
  assert.match(f(BRAND, { ...good, fonts: "Comic" }).errors.fonts, /Pick one of the choices/);
  assert.equal(f(BRAND, { ...good, fonts: "" }).ok, true, "an optional choice may be left");
  const req = { ...BRAND, fields: [{ ...BRAND.fields[2], required: true }] };
  assert.match(f(req, {}).errors.fonts, /Pick one/);
  const none = f(BRAND, null);
  assert.equal(none.ok, false);
  assert.deepEqual(Object.keys(none.errors).sort(), ["colours", "story", "tone"]);
  assert.deepEqual(f(null, {}), { ok: true, errors: {} });
});

// ---- checkAnswers ----

test("checkAnswers: each kind of a job's question", () => {
  const c = kit.job.checkAnswers;
  assert.deepEqual(c(LEAD, {}).missing, ["Who is the lead?"]);
  assert.equal(c(LEAD, { lead: "Asha" }).ok, true);
  assert.match(c(LEAD, { lead: "x".repeat(201) }).errors.lead, /200/);
  assert.match(c(LEAD, { lead: "a", when: "2026-02-30" }).errors.when, /date/);
  assert.equal(c(LEAD, { lead: "a", when: "2026-02-28" }).ok, true);
  assert.match(c(LEAD, { lead: "a", count: "-1" }).errors.count, /whole number/);
  assert.match(c(LEAD, { lead: "a", count: "1000001" }).errors.count, /whole number/);
  assert.equal(c(LEAD, { lead: "a", count: "1000000" }).ok, true);
  assert.match(c(LEAD, { lead: "a", tone: "loud" }).errors.tone, /Pick one/);
  assert.match(c(LEAD, { lead: "a", doc: "../etc/passwd" }).errors.doc, /Pick one/);
  assert.match(c(LEAD, { lead: "a", about: "x".repeat(2001) }).errors.about, /2000/);
});

// ---- Segmented and Ring ----

test("Segmented loads in Node: links carry aria-current, buttons aria-pressed, and the arrows wrap", async () => {
  const { Segmented, segStep } = kit.segmented;
  const v = Segmented({ items: [{ id: "a", label: "A", href: "#/map" }], current: "a", label: "Sections" });
  assert.ok(isVNode(v));
  assert.equal(v.props.class, "k-seg k-seg--md");
  installDom();
  let root = await mount(Segmented, { label: "Sections", current: "map", items: [{ id: "map", label: "Map", icon: "map", href: "#/map" }, { id: "tasks", label: "Tasks", href: "#/tasks", count: 3 }, { id: "bad", label: "Bad", href: "javascript:alert(1)" }] });
  const links = elements(root).filter((e) => e.localName === "a");
  assert.deepEqual(links.map((a) => a.getAttribute("href")), ["#/map", "#/tasks"]);
  assert.equal(links[0].getAttribute("aria-current"), "page");
  assert.equal(links[1].getAttribute("aria-current"), null);
  assert.match(textOf(root), /Tasks3/);
  unmount(root);
  let picked = null;
  root = await mount(Segmented, { size: "sm", current: "list", onChange: (id) => { picked = id; }, items: [{ id: "list", label: "List" }, { id: "board", label: "Board" }] });
  const buttons = elements(root).filter((e) => e.localName === "button");
  assert.deepEqual(buttons.map((b) => b.getAttribute("aria-pressed")), ["true", "false"]);
  fire(buttons[1], "click");
  assert.equal(picked, "board");
  unmount(root);
  assert.equal(segStep(0, 3, "ArrowRight"), 1);
  assert.equal(segStep(2, 3, "ArrowRight"), 0);
  assert.equal(segStep(0, 3, "ArrowLeft"), 2);
  assert.equal(segStep(1, 3, "Home"), 0);
  assert.equal(segStep(1, 3, "End"), 2);
  assert.equal(segStep(1, 3, "a"), -1);
  assert.equal(segStep(0, 0, "ArrowRight"), -1);
});

test("Ring loads in Node: the count inside, the words for screen readers, the share drawn", () => {
  const { Ring, ringShare } = kit.ring;
  const v = Ring({ value: 4, total: 9 });
  assert.ok(isVNode(v));
  assert.equal(v.props.class, "k-ring");
  assert.equal(v.props.role, "img");
  assert.equal(v.props["aria-label"], "4 of 9");
  assert.match(v.props.style, /--k-ring-size: 40px;/);
  assert.equal(Ring({ value: 9, total: 9, label: "All nine", size: 56 }).props.class, "k-ring k-ring--full");
  assert.equal(ringShare(4, 8), 0.5);
  assert.equal(ringShare(12, 9), 1);
  assert.equal(ringShare(-1, 9), 0);
  assert.equal(ringShare(3, 0), 0);
  assert.equal(ringShare("x", 9), 0);
});

// ---- Rendering: every part with its props and with none, agents' words as text, k- classes ----

function cases(h) {
  const job = { ...LEAD, title: h, summary: h, text: `${h} [lead]`, why: { text: h, link: { page: "health" } } };
  const ask = {
    id: "e1", identifier: "STH-19", question: h, state: "answered", plainState: h, askedAt: "2026-11-12T08:00:00.000Z",
    answer: { text: `${h} [1] [2]`, sources: [{ n: 1, path: h, note: h, found: true, link: { page: "files", id: "eA" } }, { n: 2, path: h, note: "", found: false, link: { page: "files", id: "eA" } }], notInFiles: [h], checked: false, at: "2026-11-12T08:02:00.000Z" },
    needsYou: null, taskId: "e1",
  };
  return [
    ["Segmented", kit.segmented.Segmented, {}],
    ["Segmented", kit.segmented.Segmented, { label: h, items: [{ id: "a", label: h, count: h }], current: "a" }],
    ["HandoffTag", kit.job.HandoffTag, { id: "you-approve" }],
    ["StageMark", kit.job.StageMark, { n: 2 }],
    ["WhyNot", kit.job.WhyNot, { why: h }],
    ["WhyNot", kit.job.WhyNot, { why: job.why }],
    ["JobRow", kit.job.JobRow, { job }],
    ["JobRow", kit.job.JobRow, { job: { ...job, ready: false } }],
    ["JobChip", kit.job.JobChip, { job }],
    ["JobStart", kit.job.JobStart, { job }],
    ["JobStart", kit.job.JobStart, { job: { ...job, ready: false } }],
    ["AnswerView", kit.answer.AnswerView, { ask }],
    ["AnswerView", kit.answer.AnswerView, { ask: { ...ask, answer: { ...ask.answer, wellFormed: false } } }],
    ...["reading", "became_task", "needs_you", "stopped", "odd"].map((state) => ["AnswerView", kit.answer.AnswerView, { ask: { ...ask, state, answer: null } }]),
    ["Ring", kit.ring.Ring, {}],
    ["Ring", kit.ring.Ring, { value: 3, total: 9, label: h }],
    ["FormFields", kit.forms.FormFields, {}],
    ["FormFields", kit.forms.FormFields, { form: { ...BRAND, fields: [...BRAND.fields, ...SERVICES.fields].map((f) => ({ ...f, label: h })) }, values: { tone: [h], colours: [h], signoff: h, items: [{ name: h }] }, errors: { tone: h }, onChange() {} }],
    ["FilePicker", kit.upload.FilePicker, {}],
    ["FilePicker", kit.upload.FilePicker, { accept: [".md"], maxBytes: 100, error: h, onPick() {} }],
  ];
}

test("every new part renders with its documented props and with none", async () => {
  installDom();
  for (const [name, Component, props] of cases("Plain words")) {
    const root = await mount(Component, props);
    assert.ok(elements(root).length > 1, `${name}(${Object.keys(props).join(", ")}) draws something`);
    unmount(root);
  }
  for (const n of ["JobRow", "JobChip", "AnswerView"]) {
    assert.equal(kit[n === "AnswerView" ? "answer" : "job"][n]({}), null, `${n} with nothing draws nothing`);
  }
  const root = await mount(kit.job.JobStart, {});
  assert.equal(elements(root).length, 1, "JobStart with no job draws nothing");
  unmount(root);
});

test("hostile words stay text: no script, no handler attribute, no script link, the words shown as written", async () => {
  installDom();
  for (const [name, Component, props] of cases(HOSTILE)) {
    const root = await mount(Component, props);
    for (const el of elements(root)) {
      assert.notEqual(el.localName, "script", `${name} made no script element`);
      assert.notEqual(el.localName, "img", `${name} made no image from text`);
      for (const a of Object.keys(el.attrs)) assert.ok(!/^on/i.test(a), `${name} set no ${a} attribute`);
      if (el.attrs.href !== undefined) assert.match(el.attrs.href, /^#\//, `${name}: every link stays in the app`);
    }
    const all = textOf(root) + elements(root).map((e) => Object.values(e.attrs).join(" ")).join(" ");
    if (!["Segmented", "Ring", "FilePicker", "HandoffTag", "StageMark"].includes(name) || Object.keys(props).length > 1) {
      if (Object.keys(props).length) assert.ok(all.includes("<script>"), `${name} shows the hostile words as text`);
    }
    unmount(root);
  }
});

test("every class the new parts use starts with k-, and each module's root class is used", async () => {
  installDom();
  const seen = new Set();
  for (const [name, Component, props] of cases("Words")) {
    const root = await mount(Component, props);
    for (const el of elements(root)) for (const c of classesOf(el)) { seen.add(c); assert.ok(c.startsWith("k-"), `${name} uses class "${c}"`); }
    unmount(root);
  }
  for (const r of Object.values(ROOTS)) assert.ok(seen.has(r), `the root class ${r} is used`);
});

// ---- AnswerView ----

test("AnswerView: the shape's answer with marks, the label, a found source as a link and a missing one as text", { skip: SHAPES ? false : "no shapes" }, async () => {
  installDom();
  const ask = shape("ask");
  const root = await mount(kit.answer.AnswerView, { ask });
  const text = textOf(root);
  assert.match(text, /What is our returns policy/);
  assert.match(text, /Answered from your files\. Not checked\./);
  assert.match(text, /2 sources/);
  assert.match(text, /not in your files/);
  assert.match(text, /Not in your files/);
  assert.match(text, /When the policy last changed\./);
  assert.equal(byClass(root, "k-answer__mark").length, 3, "three marks: [1], [1] and [2]");
  const links = elements(root).filter((e) => e.localName === "a").map((a) => a.getAttribute("href"));
  assert.ok(links.length >= 2, "the found source and its marks are links");
  assert.ok(links.every((h) => h.startsWith("#/files")), "links go to Files only");
  const missing = byClass(root, "k-answer__source--missing");
  assert.equal(missing.length, 1);
  assert.equal(elements(missing[0]).some((e) => e.localName === "a"), false, "a source not found is plain text");
  // M55 (M50 F17): a source is named by its own file name; its folder stays off screen.
  assert.match(textOf(missing[0]), /custom-orders\.md/);
  assert.doesNotMatch(textOf(missing[0]), /policies\//);
  unmount(root);
});

test("AnswerView: reading, became a task, could not be read", async () => {
  installDom();
  const base = { id: "e1", identifier: "STH-19", question: "Do we deliver?", askedAt: "2026-11-12T08:00:00.000Z", taskId: "e1" };
  let root = await mount(kit.answer.AnswerView, { ask: { ...base, state: "reading", answer: null } });
  assert.match(textOf(root), /Reading your files\. This takes a minute or two\./);
  unmount(root);
  // M63: other work ahead in the Chief of staff's line: its turn, and no time promised.
  root = await mount(kit.answer.AnswerView, { ask: { ...base, state: "reading", answer: null, queue: { ahead: 3 } } });
  assert.match(textOf(root), /Waiting its turn: 3 tasks are ahead of it\./);
  assert.doesNotMatch(textOf(root), /minute/);
  unmount(root);
  root = await mount(kit.answer.AnswerView, { ask: { ...base, state: "reading", answer: null, queue: { ahead: 1 } } });
  assert.match(textOf(root), /Waiting its turn: 1 task is ahead of it\./);
  unmount(root);
  root = await mount(kit.answer.AnswerView, { ask: { ...base, state: "reading", answer: null, queue: { ahead: 0 } } });
  assert.match(textOf(root), /Reading your files\. This takes a minute or two\./, "nothing ahead: the words of section 25");
  unmount(root);
  root = await mount(kit.answer.AnswerView, { ask: { ...base, state: "became_task", answer: null } });
  assert.match(textOf(root), /became a task/);
  assert.ok(elements(root).some((e) => e.localName === "a" && e.getAttribute("href") === "#/tasks/STH-19"));
  unmount(root);
  root = await mount(kit.answer.AnswerView, { ask: { ...base, state: "answered", answer: { text: "Yes [1].", sources: [{ n: 1, path: "a.md", found: true, link: { page: "files", id: "YS5tZA" } }], notInFiles: [], wellFormed: false } } });
  assert.match(textOf(root), /Answered\. The sources could not be read\./);
  assert.match(textOf(root), /Yes \[1\]\./, "the text is shown with no marks");
  assert.equal(byClass(root, "k-answer__mark").length, 0);
  unmount(root);
});

// ---- JobStart ----

const formOf = (root) => elements(root).find((e) => e.localName === "form");
const inputsOf = (root) => elements(root).filter((e) => ["input", "textarea", "select"].includes(e.localName));

test("JobStart: a job that cannot start says why and its Start is off", async () => {
  installDom();
  const job = { ...LEAD, ready: false, why: { name: "quotations", text: "The books do not let the Bookkeeper draft quotations yet.", link: { page: "health" } } };
  const root = await mount(kit.job.JobStart, { job });
  assert.match(textOf(root), /The books do not let the Bookkeeper draft quotations yet\./);
  const start = elements(root).find((e) => e.localName === "button" && /Start/.test(textOf(e)));
  assert.equal(start.getAttribute("disabled"), "true");
  assert.ok(elements(root).some((e) => e.localName === "a" && e.getAttribute("href") === "#/health"));
  unmount(root);
});

// M63 item 13: a job that cannot start yet keeps its questions switched off, with the one sentence that says why.
test("JobStart: a job that cannot start yet cannot be typed into; neither can one that follows work not accepted yet", async () => {
  installDom();
  const dim = { ...LEAD, ready: false, why: { name: "internet", text: "Agents have no internet, and this job needs it.", link: null } };
  let root = await mount(kit.job.JobStart, { job: dim });
  const fields = inputsOf(root);
  assert.equal(fields.length, LEAD.asks.length);
  for (const f of fields) assert.equal(f.getAttribute("disabled"), "true", `${f.localName} is switched off`);
  assert.ok(byClass(root, "k-job__asks--off").length === 1, "the questions look switched off");
  assert.equal((textOf(root).match(/Agents have no internet, and this job needs it\./g) || []).length, 1, "one sentence says why");
  unmount(root);
  const follows = {
    ...LEAD, asks: [{ id: "earlier", label: "Which call write-up?", kind: "task", required: true, options: [] }, LEAD.asks[0]],
    takes: { from: ["sales/call-write-up"], after: [{ id: "sales/call-write-up", title: "Call write-up" }] },
  };
  root = await mount(kit.job.JobStart, { job: follows });
  for (const f of inputsOf(root)) assert.equal(f.getAttribute("disabled"), "true", `${f.localName} is switched off`);
  assert.match(textOf(root), /This follows "Call write-up"\./);
  unmount(root);
  root = await mount(kit.job.JobStart, { job: LEAD });
  assert.ok(inputsOf(root).every((f) => f.getAttribute("disabled") !== "true"), "a ready job's questions can be typed into");
  unmount(root);
});

test("JobStart: a job with craft (timed off) promises no time under Start; a job without craft keeps today's line", async () => {
  installDom();
  assert.equal(kit.job.underStart(null, false), "It is checked before it reaches you.");
  assert.equal(kit.job.underStart({ ahead: 2 }, false), "2 tasks are ahead, so it waits its turn. It is checked before it reaches you.");
  let root = await mount(kit.job.JobStart, { job: LEAD, timed: false });
  assert.match(textOf(root), /It is checked before it reaches you\./);
  assert.doesNotMatch(textOf(root), /few minutes/);
  unmount(root);
  root = await mount(kit.job.JobStart, { job: LEAD, timed: false, queue: { ahead: 2 } });
  assert.match(textOf(root), /2 tasks are ahead, so it waits its turn\. It is checked before it reaches you\./);
  unmount(root);
  root = await mount(kit.job.JobStart, { job: LEAD });
  assert.match(textOf(root), /Takes a few minutes\. It is checked before it reaches you\./);
  unmount(root);
});

// M63 items 15 and 21: when other work is ahead in the Chief of staff's line, no time is promised.
test("JobStart: the line under Start names the work ahead, from the server's count only", async () => {
  installDom();
  assert.equal(kit.job.underStart(null), "Takes a few minutes. It is checked before it reaches you.");
  assert.equal(kit.job.underStart({ ahead: 0 }), "Takes a few minutes. It is checked before it reaches you.");
  assert.equal(kit.job.underStart({ ahead: 1 }), "1 task is ahead, so it waits its turn. It is checked before it reaches you.");
  assert.equal(kit.job.underStart({ ahead: 3 }), "3 tasks are ahead, so it waits its turn. It is checked before it reaches you.");
  assert.equal(kit.job.underStart({ ahead: "3" }), "Takes a few minutes. It is checked before it reaches you.", "not a number the server sent");
  const root = await mount(kit.job.JobStart, { job: LEAD, queue: { ahead: 2 } });
  assert.match(textOf(root), /2 tasks are ahead, so it waits its turn\. It is checked before it reaches you\./);
  assert.doesNotMatch(textOf(root), /few minutes/);
  unmount(root);
});

test("JobStart: a required answer missing sends nothing; then it sends the answers and shows the started line", async () => {
  installDom();
  const f = stubFetch(() => ({ status: 201, body: { goal: { id: "g1", identifier: "STH-31" }, message: "Started. The Chief of staff has it. It takes a few minutes and is checked before it reaches you." } }));
  let started = null;
  try {
    const root = await mount(kit.job.JobStart, { job: LEAD, onStarted: (r) => { started = r; } });
    assert.match(textOf(root), /Takes a few minutes\. It is checked before it reaches you\./);
    assert.match(textOf(root), /What will be asked/);
    fire(formOf(root), "submit");
    await settle();
    assert.equal(f.calls.length, 0, "nothing was sent");
    assert.match(textOf(root), /Fill in: Who is the lead\?/);
    const lead = inputsOf(root)[0];
    fire(lead, "input", { target: { value: "Asha Kitchens" } });
    await settle();
    fire(formOf(root), "submit");
    await settle();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].path, "/api/jobs/sales/first-message-to-a-lead/start");
    assert.equal(f.calls[0].method, "POST");
    assert.equal(f.calls[0].headers["X-Engine"], "1");
    assert.deepEqual(f.calls[0].body, { answers: { lead: "Asha Kitchens" } });
    assert.match(textOf(root), /Started\. The Chief of staff has it\./);
    assert.ok(elements(root).some((e) => e.localName === "a" && e.getAttribute("href") === "#/tasks/STH-31"));
    assert.equal(started.goal.identifier, "STH-31");
    unmount(root);
  } finally {
    f.restore();
  }
});

test("JobStart: with `from` the task question is answered by the server; a refusal shows the server's sentence", async () => {
  installDom();
  const f = stubFetch(() => ({ status: 409, body: { error: { code: "from_not_accepted", message: "That earlier task is not accepted yet.", next: "Accept it first, then start this one." } } }));
  try {
    const job = { ...LEAD, asks: [{ id: "earlier", label: "Which call write-up?", kind: "task", required: true, options: [{ value: "t20", label: "STH-20 · Call write-up: Asha" }] }], text: "Write from [earlier]." };
    const root = await mount(kit.job.JobStart, { job, from: "t20" });
    // M55 (M51 F8, F9): the answered question is one quiet line, the task's name first and its ref after.
    assert.match(textOf(root), /Already answered: from the earlier task, Call write-up: Asha STH-20\./);
    assert.match(textOf(root), /Write from the sub-folder STH-20 of your current working folder\./);
    fire(formOf(root), "submit");
    await settle();
    assert.deepEqual(f.calls[0].body, { answers: {}, from: "t20" });
    assert.match(textOf(root), /That earlier task is not accepted yet\./);
    assert.match(textOf(root), /Accept it first/);
    unmount(root);
  } finally {
    f.restore();
  }
});

test("JobStart: the board off is shown as not connected, with the next step", async () => {
  installDom();
  const f = stubFetch(() => ({ status: 502, body: { error: { code: "board_off", message: "The board is not answering.", next: "Run: engine start" } } }));
  try {
    const root = await mount(kit.job.JobStart, { job: { ...LEAD, asks: [], text: "Write a short first message to the lead." } });
    fire(formOf(root), "submit");
    await settle();
    assert.match(textOf(root), /Not connected yet/);
    assert.match(textOf(root), /The board is not answering\./);
    assert.match(textOf(root), /engine start/);
    unmount(root);
  } finally {
    f.restore();
  }
});

test("JobRow, JobChip, HandoffTag, StageMark: the words of section 25, dim when not ready, a link to the job", async () => {
  installDom();
  let root = await mount(kit.job.JobRow, { job: { ...LEAD, ready: false, why: "Agents have no internet, and this job needs it." } });
  const a = root.firstChild;
  assert.equal(a.localName, "a");
  assert.equal(a.getAttribute("href"), "#/jobs/sales/first-message-to-a-lead");
  assert.equal(a.getAttribute("data-dept"), "sales");
  assert.ok(classesOf(a).includes("k-job--dim"));
  assert.match(textOf(root), /You lead/);
  assert.match(textOf(root), /Make/);
  assert.match(textOf(root), /Cannot start yet: Agents have no internet/);
  unmount(root);
  root = await mount(kit.job.JobChip, { job: { ...LEAD, id: "../x" } });
  assert.equal(root.firstChild.localName, "span", "an odd id gives no link");
  unmount(root);
  assert.equal(kit.job.HandoffTag({ id: "nope" }), null);
  assert.equal(kit.job.StageMark({ n: 9 }), null);
  for (const [id, words] of [["you-lead", "You lead"], ["you-approve", "You approve"], ["on-its-own", "On its own"]]) {
    root = await mount(kit.job.HandoffTag, { id });
    assert.match(textOf(root), new RegExp(words));
    unmount(root);
  }
  for (const [n, words] of [[1, "Foundations"], [2, "Take in"], [3, "Make"], [4, "Hand on"]]) {
    root = await mount(kit.job.StageMark, { n });
    assert.match(textOf(root), new RegExp(`Stage ${n}: ${words}`));
    unmount(root);
  }
});

// ---- FilePicker ----

test("FilePicker refuses by ending and by size before anything is read; a good file is read and handed on", async () => {
  installDom();
  let readers = 0;
  const realReader = globalThis.FileReader;
  globalThis.FileReader = class {
    constructor() { readers++; }
    readAsDataURL() { this.result = "data:text/markdown;base64,SGVsbG8="; setTimeout(() => this.onload(), 0); }
  };
  const { refusePick, endingsOf, FilePicker } = kit.upload;
  try {
    assert.deepEqual(endingsOf(".md, .PNG ,x, .tar.gz"), [".md", ".png"]);
    assert.deepEqual(endingsOf([".md", "javascript:"]), [".md"]);
    assert.match(refusePick({ name: "a.svg", size: 10 }, { accept: [".png"], maxBytes: 100 }), /cannot be added/);
    assert.match(refusePick({ name: ".png", size: 10 }, { accept: [".png"], maxBytes: 100 }), /cannot be added/);
    assert.match(refusePick({ name: "a.png", size: 101 }, { accept: [".png"], maxBytes: 100 }), /too large\. The limit is 100 bytes\./);
    assert.match(refusePick({ name: "a.png", size: 0 }, { accept: [".png"], maxBytes: 100 }), /empty/);
    assert.equal(refusePick({ name: "A.PNG", size: 100 }, { accept: [".png"], maxBytes: 100 }), null);
    assert.match(refusePick(null, {}), /Pick a file/);

    const picks = [];
    const root = await mount(FilePicker, { accept: [".md"], maxBytes: 1000, onPick: (p) => picks.push(p) });
    const input = elements(root).find((e) => e.localName === "input");
    assert.equal(input.getAttribute("type"), "file");
    assert.equal(input.getAttribute("accept"), ".md");
    assert.ok(elements(root).some((e) => e.localName === "label" && e.getAttribute("for") === input.getAttribute("id")), "the area is the input's label");
    fire(input, "change", { target: { files: [{ name: "huge.md", size: 5000 }], value: "x" } });
    await settle();
    assert.match(textOf(root), /That file is too large/);
    fire(input, "change", { target: { files: [{ name: "page.html", size: 10 }], value: "x" } });
    await settle();
    assert.match(textOf(root), /cannot be added here/);
    assert.equal(readers, 0, "nothing was read");
    assert.equal(picks.length, 0);
    fire(input, "change", { target: { files: [{ name: "notes.md", size: 5 }], value: "x" } });
    await settle();
    assert.equal(readers, 1);
    assert.deepEqual(picks, [{ name: "notes.md", base64: "SGVsbG8=", size: 5 }]);
    unmount(root);
  } finally {
    globalThis.FileReader = realReader;
  }
});

// ---- FormFields, mounted ----

test("FormFields: each kind draws its control and an edit hands back the whole set of values", async () => {
  installDom();
  const changes = [];
  const form = { ...BRAND, fields: [...BRAND.fields, ...SERVICES.fields] };
  const root = await mount(kit.forms.FormFields, { form, values: { tone: ["warm"], colours: ["#2f6f5e"], fonts: "Didot" }, errors: { tone: "Fill this in." }, onChange: (v) => changes.push(v) });
  const els = elements(root);
  assert.ok(els.some((e) => e.localName === "textarea"), "list and text are text areas");
  assert.ok(els.some((e) => e.localName === "input" && e.getAttribute("type") === "color"), "a colour picker");
  assert.ok(els.some((e) => e.localName === "select"), "a choice");
  assert.ok(els.some((e) => e.localName === "fieldset"), "rows and colours are fieldsets");
  assert.match(textOf(root), /Fill this in\./);
  assert.match(textOf(root), /\(optional\)/);
  const line = els.find((e) => e.localName === "input" && e.getAttribute("type") === "text" && e.getAttribute("maxlength") === "200" && !e.getAttribute("aria-label"));
  fire(line, "input", { target: { value: "With thanks" } });
  assert.deepEqual(changes.at(-1), { tone: ["warm"], colours: ["#2f6f5e"], fonts: "Didot", signoff: "With thanks" });
  const list = els.find((e) => e.localName === "textarea");
  fire(list, "input", { target: { value: "warm\nplain" } });
  assert.deepEqual(changes.at(-1).tone, ["warm", "plain"]);
  unmount(root);
});

// ---- Stylesheets (27.3) ----

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
function rulesOf(css) {
  const selectors = [];
  const keyframes = [];
  let i = 0;
  const skip = () => { let d = 1; while (i < css.length && d) { if (css[i] === "{") d++; else if (css[i] === "}") d--; i++; } };
  (function block(nested) {
    let pre = "";
    while (i < css.length) {
      const ch = css[i++];
      if (ch === "{") {
        const p = pre.trim();
        pre = "";
        if (p.startsWith("@keyframes")) { keyframes.push(p.slice(10).trim()); skip(); }
        else if (p.startsWith("@media") || p.startsWith("@supports") || p.startsWith("@container")) block(true);
        else { selectors.push(...p.split(",").map((s) => s.trim())); skip(); }
      } else if (ch === "}") { if (nested) return; }
      else pre += ch;
    }
  })(false);
  return { selectors, keyframes };
}

for (const m of NEW) {
  test(`stylesheet ${m}.css follows 27.3`, () => {
    const file = join(STYLES, `${m}.css`);
    assert.ok(existsSync(file), `styles/kit/${m}.css exists`);
    const css = stripComments(readFileSync(file, "utf8"));
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, "no hex colour");
    assert.doesNotMatch(css, /\brgba?\(|\bhsla?\(/i, "no rgb( or hsl(");
    assert.doesNotMatch(css, /font-family/i, "no font-family");
    assert.doesNotMatch(css, /font-size\s*:\s*[\d.]+px/i, "no font size in px");
    assert.doesNotMatch(css, /@import|url\(/i, "no import and no url()");
    assert.doesNotMatch(css, /backdrop-filter/, "no backdrop-filter");
    assert.doesNotMatch(css, /filter\s*:\s*blur|will-change|mix-blend-mode/, "no blur, will-change or blend");
    for (const z of css.matchAll(/z-index\s*:\s*(\d+)/g)) assert.ok(Number(z[1]) <= 50, `z-index ${z[1]}`);
    for (const t of css.matchAll(/transition\s*:\s*([^;]+);/g)) {
      for (const part of t[1].split(",")) {
        const [prop, time] = part.trim().split(/\s+/);
        if (prop === "none") continue;
        assert.ok(["transform", "opacity", "color", "background-color", "border-color"].includes(prop), `transition of ${prop}`);
        if (!["transform", "opacity"].includes(prop)) assert.match(time, /^var\(--t-(fast|med)\)$/, `${prop} changes within --t-med`);
      }
    }
    for (const kf of css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?\})\s*\}/g)) {
      for (const p of kf[1].matchAll(/([a-z-]+)\s*:/g)) assert.ok(["transform", "opacity"].includes(p[1]), `keyframes move only ${p[1]}`);
    }
    // An endless animation only for the live dot (the answer's "reading" mark), and it stops when motion is off.
    const endless = [...css.matchAll(/animation\s*:[^;]*infinite/g)];
    if (endless.length) {
      assert.equal(m, "answer", "only the live dot runs for ever");
      assert.match(css, /\[data-motion="off"\] \.k-answer__live\s*\{\s*animation: none;/);
      assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.k-answer__live\s*\{\s*animation: none;/);
    }
    const { selectors, keyframes } = rulesOf(css);
    assert.ok(selectors.length > 0, "it has rules");
    for (const s of selectors) assert.match(s, /^(a|\[data-motion="off"\] )?\.k-/, `selector "${s}" is the kit's`);
    for (const k of keyframes) assert.ok(k.startsWith("k-"), `keyframes "${k}" are named k-...`);
    assert.ok(selectors.some((s) => s.startsWith(`.${ROOTS[m]}`)), `the root class .${ROOTS[m]} is styled`);
  });
}

test("gallery-c.html sits on the canvas, links the new sheets and has no inline script", () => {
  const page = readFileSync(join(KIT, "gallery-c.html"), "utf8");
  for (const s of ["../styles/tokens.css", "../styles/canvas.css", "../styles/creature.css", ...NEW.map((m) => `../styles/kit/${m}.css`)]) {
    assert.ok(page.includes(`href="${s}"`), `links ${s}`);
  }
  assert.match(page, /class="s-canvas" aria-hidden="true"/);
  assert.match(page, /<script src="\.\.\/lib\/theme-boot\.js"><\/script>/);
  assert.match(page, /<script type="module" src="\.\/gallery-c\.boot\.js"><\/script>/);
  for (const s of page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) assert.equal(s[1].trim(), "", "no inline script");
  assert.doesNotMatch(page, /\son[a-z]+\s*=/i, "no inline handler");
});
