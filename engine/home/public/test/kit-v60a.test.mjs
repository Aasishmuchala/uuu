// V60a: DecisionCard answers an agent's questions one by one (an item with `questions`), in the kit's manner:
// choices as buttons that stay pressed, a text field where words are taken, keyboard reachable, Esc cancels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = join(PUBLIC, "kit");
const { html, render } = await import(pathToFileURL(join(PUBLIC, "vendor", "preact-htm.js")).href);
const decision = await import(pathToFileURL(join(KIT, "decision.js")).href);

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

async function showTree(Component, props) {
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
const buttonNamed = (root, words) => elements(root).find((e) => e.localName === "button" && textOf(e).trim() === words);
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

const QUESTIONS = [
  { id: "stage", prompt: "Which stage is the lead at?", help: null, mode: "single", required: true, options: [{ id: "new", label: "New" }, { id: "qualified", label: "Qualified" }], allowText: true },
  { id: "channels", prompt: "Where should we follow up?", help: null, mode: "multi", required: false, options: [{ id: "phone", label: "Phone" }, { id: "email", label: "Email" }], allowText: false },
  { id: "notes", prompt: "Anything to add?", help: null, mode: "text", required: true, options: [], allowText: true },
];
const ITEM = {
  id: "board:q1", kind: "question", title: "Two choices and a note", raisedBy: "Sales", when: "2026-11-11T09:00:00.000Z",
  summary: "The Sales asked you a question.", severity: "normal",
  details: [{ label: "Question 1", value: "Which stage is the lead at?" }],
  actions: [{ id: "answer", label: "Answer", style: "primary", needsNote: true }],
  questions: QUESTIONS,
};

test("pickOption and pickText: one choice replaces the other and the words; several choices toggle", () => {
  const [single, multi] = QUESTIONS;
  let p = decision.pickText({}, single, "Something else");
  p = decision.pickOption(p, single, "new");
  assert.deepEqual(p.stage, { optionIds: ["new"], text: "" });
  p = decision.pickOption(p, single, "qualified");
  assert.deepEqual(p.stage.optionIds, ["qualified"]);
  p = decision.pickText(p, single, "Warm, not yet qualified");
  assert.deepEqual(p.stage, { optionIds: [], text: "Warm, not yet qualified" });
  p = decision.pickOption(p, multi, "phone");
  p = decision.pickOption(p, multi, "email");
  p = decision.pickOption(p, multi, "phone");
  assert.deepEqual(p.channels.optionIds, ["email"]);
});

test("canSendAnswers and answersNote: every required question first; the note is what the server reads", () => {
  assert.equal(decision.canSendAnswers(QUESTIONS, {}), false);
  const p = { stage: { optionIds: ["qualified"], text: "" }, notes: { optionIds: [], text: " Call after 5. " } };
  assert.equal(decision.canSendAnswers(QUESTIONS, { stage: p.stage }), false);
  assert.equal(decision.canSendAnswers(QUESTIONS, p), true);
  assert.deepEqual(JSON.parse(decision.answersNote(QUESTIONS, p)), {
    answers: { stage: { optionIds: ["qualified"], text: "" }, notes: { optionIds: [], text: "Call after 5." } },
  });
  assert.deepEqual(decision.questionsOf({}), []);
});

test("DecisionCard with questions: each question, its choices and a text field; Send only when answered", async () => {
  installDom();
  const f = stubFetch(() => ({ status: 200, body: { ok: true, message: "Your answer was passed on." } }));
  try {
    const root = await showTree(decision.DecisionCard, { item: ITEM });
    assert.ok(!buttonNamed(root, "Accept"), "no Accept for a question");
    fire(buttonNamed(root, "Answer"), "click");
    await settle();
    const t = textOf(root);
    for (const words of ["1. Which stage is the lead at?", "2. Where should we follow up? (you may leave this one)", "3. Anything to add?", "Or write your own answer", "Your answer"]) {
      assert.ok(t.includes(words), words);
    }
    assert.equal(elements(root).filter((e) => e.localName === "fieldset").length, 3);
    assert.equal(elements(root).filter((e) => e.localName === "textarea").length, 2, "words only where they are taken");
    const send = () => buttonNamed(root, "Send");
    const off = (el) => el.disabled === true || (el.getAttribute("disabled") !== null && el.getAttribute("disabled") !== "false");
    assert.equal(off(send()), true);
    assert.equal(globalThis.document.activeElement, buttonNamed(root, "New"), "the first choice has the focus");
    fire(buttonNamed(root, "Qualified"), "click");
    await settle();
    assert.equal(buttonNamed(root, "Qualified").getAttribute("aria-pressed"), "true");
    fire(buttonNamed(root, "Email"), "click");
    await settle();
    const notes = elements(root).filter((e) => e.localName === "textarea")[1];
    fire(notes, "input", { currentTarget: { value: "Call after 5." } });
    await settle();
    assert.equal(off(send()), false);
    fire(send(), "click");
    await settle();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].path, "/api/inbox/act");
    assert.equal(f.calls[0].body.action, "answer");
    assert.deepEqual(JSON.parse(f.calls[0].body.note), {
      answers: { stage: { optionIds: ["qualified"], text: "" }, channels: { optionIds: ["email"], text: "" }, notes: { optionIds: [], text: "Call after 5." } },
    });
    assert.match(textOf(root), /Your answer was passed on\./);
    render(null, root);
  } finally {
    f.restore();
  }
});

test("DecisionCard with questions: Esc cancels and nothing is sent", async () => {
  installDom();
  const f = stubFetch(() => ({ status: 200, body: { ok: true, message: "Done." } }));
  try {
    const root = await showTree(decision.DecisionCard, { item: ITEM });
    fire(buttonNamed(root, "Answer"), "click");
    await settle();
    fire(buttonNamed(root, "New"), "click");
    await settle();
    fire(elements(root).find((e) => e.localName === "article"), "keydown", { key: "Escape" });
    await settle();
    assert.ok(!elements(root).some((e) => e.localName === "fieldset"), "the questions closed");
    assert.ok(buttonNamed(root, "Answer"), "the action is back");
    assert.equal(f.calls.length, 0);
    render(null, root);
  } finally {
    f.restore();
  }
});
