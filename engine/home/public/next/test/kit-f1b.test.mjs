// F1b: DecisionCard with an agent's question ids that are also the names of an object's own machinery
// ("constructor", "__proto__", "toString") can still be answered, and every card can still be hidden; a card for
// suggested tasks lists each task and who it is for.
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

const TRICKY = ["constructor", "__proto__", "toString"];
const QUESTIONS = [
  { id: "constructor", prompt: "Which stage is the lead at?", help: null, mode: "single", required: true, options: [{ id: "new", label: "New" }, { id: "qualified", label: "Qualified" }], allowText: false },
  { id: "__proto__", prompt: "Where should we follow up?", help: null, mode: "multi", required: true, options: [{ id: "phone", label: "Phone" }, { id: "email", label: "Email" }], allowText: false },
  { id: "toString", prompt: "Anything to add?", help: null, mode: "text", required: true, options: [], allowText: true },
];
const ITEM = {
  id: "board:q1", kind: "question", title: "Three questions", raisedBy: "Sales", when: "2026-11-11T09:00:00.000Z",
  summary: "The Sales asked you a question.", severity: "normal", version: "abcd",
  details: [{ label: "Question 1", value: "Which stage is the lead at?" }],
  actions: [{ id: "answer", label: "Answer", style: "primary", needsNote: true }, { id: "dismiss", label: "Hide", style: "plain", needsNote: false }],
  questions: QUESTIONS,
};

test("picks: question ids constructor, __proto__ and toString are plain keys", () => {
  const none = decision.noPicks();
  for (const id of TRICKY) assert.equal(decision.pickOf(none, id), null, id);
  for (const id of TRICKY) assert.equal(decision.pickOf({}, id), null, `${id} on a plain object`);
  assert.equal(decision.canSendAnswers(QUESTIONS, none), false);
  assert.equal(decision.canSendAnswers(QUESTIONS, {}), false);
  let p = decision.pickOption(none, QUESTIONS[0], "qualified");
  p = decision.pickOption(p, QUESTIONS[1], "phone");
  p = decision.pickOption(p, QUESTIONS[1], "email");
  assert.equal(decision.canSendAnswers(QUESTIONS, p), false, "the text question is still required");
  p = decision.pickText(p, QUESTIONS[2], " Call after 5. ");
  assert.equal(decision.canSendAnswers(QUESTIONS, p), true);
  assert.equal(Object.getPrototypeOf(p), null, "the picks have no prototype to reach");
  assert.deepEqual(decision.pickOf(p, "__proto__").optionIds, ["phone", "email"]);
  const note = JSON.parse(decision.answersNote(QUESTIONS, p));
  assert.ok(Object.hasOwn(note.answers, "__proto__"), "__proto__ is an answer of its own");
  assert.deepEqual(note.answers.constructor, { optionIds: ["qualified"], text: "" });
  assert.deepEqual(note.answers.__proto__, { optionIds: ["phone", "email"], text: "" });
  assert.deepEqual(note.answers.toString, { optionIds: [], text: "Call after 5." });
});

test("DecisionCard answers questions named constructor, __proto__ and toString, and sends each answer", async () => {
  installDom();
  const f = stubFetch(() => ({ status: 200, body: { ok: true, message: "Your answer was passed on." } }));
  try {
    const root = await showTree(decision.DecisionCard, { item: ITEM });
    fire(buttonNamed(root, "Answer"), "click");
    await settle();
    assert.equal(elements(root).filter((e) => e.localName === "fieldset").length, 3, "the form shows all three questions");
    fire(buttonNamed(root, "Qualified"), "click");
    await settle();
    fire(buttonNamed(root, "Phone"), "click");
    await settle();
    const words = elements(root).find((e) => e.localName === "textarea");
    fire(words, "input", { currentTarget: { value: "Call after 5." } });
    await settle();
    fire(buttonNamed(root, "Send"), "click");
    await settle();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].body.version, "abcd");
    const sent = JSON.parse(f.calls[0].body.note).answers;
    assert.deepEqual(Object.keys(sent).sort(), [...TRICKY].sort());
    assert.deepEqual(sent.__proto__, { optionIds: ["phone"], text: "" });
    render(null, root);
  } finally {
    f.restore();
  }
});

test("a card that offers only Answer and Hide still offers Hide, outside the answer form", () => {
  const { primary, rest } = decision.splitActions(ITEM.actions);
  assert.equal(primary.id, "answer");
  assert.deepEqual(rest.map((a) => a.id), ["dismiss"]);
});

test("DecisionCard lists every suggested task and who it is for, as text", async () => {
  installDom();
  const item = {
    id: "board:s1", kind: "question", title: "Follow-ups", raisedBy: "Sales", when: "2026-11-11T09:00:00.000Z",
    summary: "The Sales asked you a question.", severity: "normal", version: "v1",
    details: [{ label: "If you accept", value: "2 new tasks are made, as if you made them:" }],
    suggested: [{ title: "Call <b>Asha</b>", who: "Sales" }, { title: "Send the price list", who: "Nobody yet" }],
    actions: [{ id: "accept", label: "Accept", style: "primary" }, { id: "reject", label: "Decline", style: "plain" }, { id: "dismiss", label: "Hide", style: "plain" }],
  };
  const root = await showTree(decision.DecisionCard, { item });
  const list = elements(root).find((e) => e.localName === "ol");
  assert.ok(list, "an ordered list of the tasks");
  assert.equal(list.getAttribute("aria-label"), "Tasks it would make");
  assert.equal(elements(list).filter((e) => e.localName === "li").length, 2);
  const t = textOf(list);
  for (const words of ["Call <b>Asha</b>", "For: Sales", "Send the price list", "For: Nobody yet"]) assert.ok(t.includes(words), words);
  assert.ok(!elements(list).some((e) => e.localName === "b"), "a title is text, never markup");
  assert.ok(buttonNamed(root, "Accept"));
  assert.deepEqual(decision.suggestedOf({ suggested: [null, { title: "" }, { title: "x", who: "y" }] }), [{ title: "x", who: "y" }]);
  render(null, root);
});
