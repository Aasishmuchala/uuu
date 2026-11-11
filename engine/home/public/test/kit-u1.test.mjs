// U1: the last layout flaws of the live pass. Markdown files (an agent's instructions, a check's evidence, a staged
// document's sections) are shown as readable text built from elements, never as HTML; a board card's "Working" is
// never cut to a stub; a task the board raised itself shows a plain mark, not made-up initials; a danger action
// that leads an item looks like one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = join(PUBLIC, "kit");
const { html, render } = await import(pathToFileURL(join(PUBLIC, "vendor", "preact-htm.js")).href);
const doc = await import(pathToFileURL(join(KIT, "doc.js")).href);
const decision = await import(pathToFileURL(join(KIT, "decision.js")).href);
const taskCard = await import(pathToFileURL(join(KIT, "task-card.js")).href);
const { parseMarkdown, parseInline, Markdown } = doc;
// An address in a Markdown file, put together here so this file names no other host itself (static.test.mjs).
const WEB = ["https:", "", "x.test"].join("/");

// ---- A very small DOM, enough for Preact to render into and for us to walk (as in kit-v60a). ----
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
const tags = (root) => elements(root).map((e) => e.localName);

// ---- Markdown, parsed

test("parseMarkdown: headings, paragraphs, a rule, a quote and fenced code", () => {
  const b = parseMarkdown("# Title\n\nOne line\nand the next.\n\n---\n\n> quoted **words**\n\n```js\nconst a = '<b>';\n```\n#hashtag stays words");
  assert.deepEqual(b.map((x) => x.type), ["heading", "paragraph", "rule", "quote", "code", "paragraph"]);
  assert.deepEqual(b[0], { type: "heading", level: 1, text: "Title" });
  assert.equal(b[1].text, "One line\nand the next.");
  assert.equal(b[3].blocks[0].text, "quoted **words**");
  assert.equal(b[4].text, "const a = '<b>';");
  assert.equal(b[5].text, "#hashtag stays words");
  assert.deepEqual(parseMarkdown("## Closed ##")[0], { type: "heading", level: 2, text: "Closed" });
});

test("parseMarkdown: lists, ordered from their own number, nested, with tasks; loose when gaps", () => {
  const [ul] = parseMarkdown("- one\n- two\n  - two a\n  - two b\n- [x] done\n- [ ] not yet");
  assert.equal(ul.type, "list");
  assert.equal(ul.ordered, false);
  assert.equal(ul.loose, false);
  assert.equal(ul.items.length, 4);
  assert.deepEqual(ul.items[1].blocks.map((x) => x.type), ["paragraph", "list"]);
  assert.equal(ul.items[1].blocks[1].items.length, 2);
  assert.deepEqual([ul.items[2].done, ul.items[3].done, ul.items[0].done], [true, false, null]);
  assert.equal(ul.items[2].blocks[0].text, "done");
  const [ol] = parseMarkdown("3. third\n   needs: nothing\n4. fourth");
  assert.equal(ol.ordered, true);
  assert.equal(ol.start, 3);
  assert.equal(ol.items[0].blocks[0].text, "third\nneeds: nothing");
  assert.equal(parseMarkdown("- a\n\n- b")[0].loose, true);
  const mixed = parseMarkdown("- a\n1. b");
  assert.deepEqual(mixed.map((x) => x.ordered), [false, true], "a bullet list and a numbered list are two lists");
});

test("parseMarkdown: a table with its alignment; a | after a backslash stays in its cell", () => {
  const [t] = parseMarkdown("| Field | Value | Sum |\n|:---|:---:|---:|\n| `a` | b \\| c | 3 |\n| short |");
  assert.equal(t.type, "table");
  assert.deepEqual(t.head, ["Field", "Value", "Sum"]);
  assert.deepEqual(t.align, [null, "center", "right"]);
  assert.deepEqual(t.rows, [["`a`", "b | c", "3"], ["short"]]);
});

test("parseInline: bold, emphasis, code, struck words; links and images as their words only", () => {
  assert.deepEqual(parseInline("a **b** and *c* and `d` and ~~e~~"), [
    "a ", { t: "strong", c: ["b"] }, " and ", { t: "em", c: ["c"] }, " and ", { t: "code", c: "d" }, " and ", { t: "del", c: ["e"] },
  ]);
  assert.deepEqual(parseInline("see [the **docs**](javascript:alert(1)) now"), ["see ", { t: "link", c: ["the ", { t: "strong", c: ["docs"] }] }, " now"]);
  assert.deepEqual(parseInline(`![a cat](${WEB}/cat.png)`), [{ t: "link", c: ["a cat"] }]);
  assert.deepEqual(parseInline(`<${WEB}/a>`), [{ t: "link", c: [`${WEB}/a`] }]);
  assert.deepEqual(parseInline("snake_case_name and 2 * 3 * 4"), ["snake_case_name and 2 * 3 * 4"]);
  assert.deepEqual(parseInline("**not closed"), ["**not closed"]);
  assert.deepEqual(parseInline("\\*plain\\*"), ["*plain*"]);
  assert.deepEqual(parseInline("``a ` b``"), [{ t: "code", c: "a ` b" }]);
  assert.deepEqual(parseInline("one  \ntwo\nthree"), ["one", { t: "br" }, "two three"]);
});

test("parseMarkdown and parseInline stay quick on hostile text", () => {
  const start = Date.now();
  parseMarkdown(`${"*".repeat(20000)}\n${"[".repeat(20000)}\n${"_a".repeat(20000)}\n${"> ".repeat(500)}x\n${"- ".repeat(500)}x`);
  parseInline("**a".repeat(20000));
  assert.ok(Date.now() - start < 3000, `took ${Date.now() - start} ms`);
});

// ---- Markdown, shown

test("Markdown: built as elements; an agent's HTML is shown as words and nothing can be followed", async () => {
  const UNTRUSTED = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const md = `# Head ${UNTRUSTED}\n\n- **bold** item\n- [link](javascript:alert(3))\n\n| A | B |\n|---|---|\n| ${UNTRUSTED} | \`x\` |\n\n\`\`\`\n${UNTRUSTED}\n\`\`\``;
  const root = await show(Markdown, { text: md });
  const t = textOf(root);
  assert.ok(t.includes(UNTRUSTED), "the HTML is a text node");
  assert.ok(!t.includes("**") && !t.includes("# Head") && !t.includes("|---"), "no raw marks");
  assert.ok(!t.includes("javascript:"), "a link's address is not shown");
  const names = tags(root);
  for (const tag of ["h3", "ul", "li", "strong", "table", "th", "td", "code", "pre"]) assert.ok(names.includes(tag), `has <${tag}>`);
  for (const bad of ["img", "script", "a", "iframe"]) assert.ok(!names.includes(bad), `no <${bad}>`);
  assert.ok(elements(root).every((e) => e.getAttribute("href") === null && e.getAttribute("src") === null && !e.dangerouslySetInnerHTML));
  const src = readFileSync(join(KIT, "doc.js"), "utf8");
  assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(src));
});

test("Markdown: an empty text is an empty block; a task list says done or not done in words", async () => {
  const empty = await show(Markdown, { text: "" });
  assert.equal(textOf(empty), "");
  const root = await show(Markdown, { text: "- [x] sent\n- [ ] paid" });
  assert.ok(textOf(root).includes("Done: ") && textOf(root).includes("Not done: "));
});

test("DocView shows a section's Markdown as readable text", async () => {
  const root = await show(doc.DocView, { doc: { name: "01-plan.md", sections: [{ heading: "Steps", text: "1. Draft it - Marketer\n2. Check it - Checker\n\nUses `welcome-note.md`." }] } });
  assert.ok(tags(root).includes("ol"));
  assert.ok(tags(root).includes("code"));
  assert.ok(!textOf(root).includes("`"));
});

test("Evidence shows a Markdown file through Markdown, another text file as it is", () => {
  const src = readFileSync(join(KIT, "checks.js"), "utf8");
  assert.match(src, /import \{ Markdown \} from "\.\/doc\.js"/);
  assert.match(src, /MARKDOWN_NAME\.test\(name\)/);
  assert.match(src, /<pre class="k-evidence__text u-mono">/);
});

// ---- the board card, the tabs, a board item

test("TaskCard: Working sits in the bottom row with the date, never squeezed beside the identifier", async () => {
  const root = await show(taskCard.TaskCard, { task: {
    id: "t1", identifier: "STH-15", title: "Write three captions", column: "in_progress", live: true,
    who: { slug: "marketer", name: "Marketer" }, stage: { id: "work", label: "Work" }, stepsDone: 0, stepsTotal: 1,
    updatedAt: "2026-11-11T09:00:00.000Z",
  } });
  const top = elements(root).find((e) => classOf(e) === "k-task-card__top");
  const bottom = elements(root).find((e) => classOf(e) === "k-task-card__bottom");
  assert.ok(!textOf(top).includes("Working"));
  assert.ok(textOf(bottom).includes("Working"));
  const css = readFileSync(join(PUBLIC, "styles", "kit", "task-card.css"), "utf8");
  assert.ok(!/k-task-card__live[^}]*text-overflow/.test(css), "Working is never cut with an ellipsis");
});

test("Tabs wrap onto a second line instead of hiding tabs off the edge", () => {
  const css = readFileSync(join(PUBLIC, "styles", "kit", "tabs.css"), "utf8");
  const row = /\.k-tabs\s*\{([^}]*)\}/.exec(css)[1];
  assert.match(row, /flex-wrap:\s*wrap/);
  assert.doesNotMatch(row, /overflow-x:\s*auto/);
});

test("DecisionCard: an item the board raised shows a plain mark; a leading danger action looks like one", async () => {
  const item = {
    id: "board:hold:x", source: "board", kind: "problem", title: "A task stopped", raisedBy: "The board", when: "2026-11-11T08:20:00.000Z",
    summary: "This task stopped and the board will not start it again by itself.", severity: "high",
    details: [{ label: "Task", value: "Reconcile the October bills" }, { label: "What you can do", value: "Stop the task, or reply." }],
    actions: [{ id: "stop", label: "Stop this task", style: "danger", needsNote: false }, { id: "answer", label: "Reply", style: "plain", needsNote: true }],
  };
  const root = await show(decision.DecisionCard, { item });
  assert.ok(hasClass(root, "k-decision__source"));
  assert.ok(!hasClass(root, "k-avatar"), "no initials made up from \"The board\"");
  assert.ok(!textOf(root).includes("TB"));
  const stop = elements(root).find((e) => e.localName === "button" && textOf(e).trim() === "Stop this task");
  assert.ok(classOf(stop).includes("k-btn--danger"));
  const withAgent = await show(decision.DecisionCard, { item: { ...item, agent: { slug: "builder", name: "Builder" }, raisedBy: "Builder" } });
  assert.ok(hasClass(withAgent, "k-avatar"));
  assert.ok(!hasClass(withAgent, "k-decision__source"));
});
