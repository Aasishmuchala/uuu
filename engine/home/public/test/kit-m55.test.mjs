// M55, builder A: the fixes from the browser checks (M18, M50, M51, M52) that lie in the kit, the shell and the
// shared styles, each held by a test so it does not come back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TREE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = (p) => import(pathToFileURL(join(TREE, p)).href);
const css = (p) => readFileSync(join(TREE, "styles", p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const src = (p) => readFileSync(join(TREE, p), "utf8");

const answer = await load("kit/answer.js");
const job = await load("kit/job.js");
const table = await load("kit/table.js");
const taskCard = await load("kit/task-card.js");
const conversation = await load("kit/conversation.js");
const states = await load("kit/states.js");
const topbar = await load("shell/topbar.js");
const menu = await load("shell/command-menu.js");
const dock = await load("shell/dock.js");
const composer = await load("kit/composer.js");
const { html, render } = await load("vendor/preact-htm.js");

// ---- a very small DOM to render into ----
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
  focus() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
function show(Component, props) {
  globalThis.document = { createElement: (t) => new FakeElement(t), createElementNS: (_n, t) => new FakeElement(t), createTextNode: (x) => new FakeText(x), addEventListener() {}, removeEventListener() {} };
  const root = new FakeElement("div");
  render(html`<${Component} ...${props} />`, root);
  return root;
}
function* walk(node) { yield node; for (const c of node.childNodes) yield* walk(c); }
const elements = (root) => [...walk(root)].filter((n) => n.nodeType === 1);
const classOf = (el) => String(el.getAttribute("class") ?? el.className ?? "");
const withClass = (root, c) => elements(root).filter((e) => classOf(e).split(/\s+/).includes(c));
const textOf = (root) => [...walk(root)].filter((n) => n.nodeType === 3).map((n) => n.data).join("");

test("one name for one button: the error notice says Try again (M51 F18, C3 25)", () => {
  const root = show(states.ErrorNotice, { error: new Error("The board did not answer."), onRetry() {} });
  assert.match(textOf(root), /Try again/);
  assert.doesNotMatch(textOf(root), /Retry/);
});

test("the Health dot is never 'everything is on' while the gate is off (M52 F4)", () => {
  assert.deepEqual(topbar.engineDot({ board: "on", books: "on", gate: "off" }), { tone: "bad", words: "the gate is off" });
  assert.equal(topbar.engineDot({ board: "on", books: "on", gate: "on" }).tone, "ok");
  assert.equal(topbar.engineDot({ board: "on", books: "on" }).tone, "ok", "a shell without the key reads as before");
  assert.equal(topbar.engineDot({ board: "off", gate: "off" }).words, "the engine is off");
});

test("citation marks stay with the word before them and the stop after them (M50 F7, M18-28)", () => {
  const parts = answer.glueMarks(answer.splitMarks("for a full refund [1]. Custom orders cannot be returned [1][2]."));
  assert.deepEqual(parts, [
    { text: "for a full " }, { word: "refund", marks: [1], after: "." },
    { text: " Custom orders cannot be " }, { word: "returned", marks: [1, 2], after: "." },
  ]);
  assert.deepEqual(answer.glueMarks(answer.splitMarks("[1] first")), [{ word: "", marks: [1], after: "" }, { text: " first" }]);
  assert.deepEqual(answer.glueMarks([]), []);
  const marks = css("kit/answer.css");
  assert.match(marks, /\.k-answer__glue\s*\{\s*white-space: nowrap;/);
  assert.doesNotMatch(marks, /vertical-align: super/);
});

test("a figure never breaks over two lines; a long one is drawn smaller (M51 F13)", () => {
  assert.equal(table.figureClass("12"), "k-figures__value");
  assert.equal(table.figureClass("₹ 1,18,000.00"), "k-figures__value k-figures__value--long");
  assert.equal(table.figureClass("₹ 1,18,00,000.00 due"), "k-figures__value k-figures__value--longer");
  const t = css("kit/table.css");
  assert.match(t, /\.k-figures__value\s*\{[^}]*white-space: nowrap;/);
  assert.doesNotMatch(t, /overflow-wrap: break-word/);
  assert.match(t, /\.k-table__table td > \*\s*\{\s*justify-self: start;/, "a chip in a stacked cell keeps its width (M51 F21)");
});

test("a job: why-not link words, optional reads, blanks in the preview, a job that follows another (M51 F6, F7, F22, F26)", () => {
  const why = show(job.WhyNot, { why: { text: 'Fill in "Terms" first.', link: { page: "files", id: "x" } } });
  assert.match(textOf(why), /Fill it in/);
  const files = show(job.WhyNot, { why: { text: "The brain has no price list.", link: { page: "files", id: "x" } } });
  assert.match(textOf(files), /Open Files/);

  const lead = { id: "sales/call-write-up", title: "Call write-up", text: "Write up the call with [who] from [notes]. [extra]",
    asks: [{ id: "who", label: "Who was the call with?", kind: "line", required: true }, { id: "notes", label: "Which notes?", kind: "line", required: true },
      { id: "extra", label: "Anything else?", kind: "text", required: false }] };
  assert.deepEqual(job.previewParts(lead, { notes: "the [who] file" }), [
    { text: "Write up the call with " }, { blank: "Who was the call with" }, { text: " from the [who] file." },
  ], "an answer is never read for blanks");
  assert.equal(job.fillPreview(lead, {}), "Write up the call with [who] from [notes].", "what is sent keeps its ids");

  assert.deepEqual(job.nameAndRef("STH-20 · Call write-up: Asha"), { name: "Call write-up: Asha", ref: "STH-20" });
  assert.deepEqual(job.nameAndRef("Call write-up: Asha · 11 Nov 2026"), { name: "Call write-up: Asha · 11 Nov 2026", ref: "" });

  const after = job.followsOf({ takes: { from: ["marketing/five-concepts"], after: [{ id: "marketing/five-concepts", title: "Five concepts before any design" }], waiting: { taskId: "t23", title: "Five concepts" } } });
  assert.equal(after.sentence, 'This follows "Five concepts before any design". Accept the task that waits from it first.');
  assert.equal(after.href, "#/jobs/marketing/five-concepts");
  assert.equal(after.waiting.href, "#/tasks/t23");
  const bare = job.followsOf({ takes: { from: ["sales/call-write-up"] } });
  assert.equal(bare.sentence, "This follows an earlier job. Run that job and accept what it makes first.");
  assert.equal(bare.waiting, null);

  const reads = show(job.JobStart, { job: { id: "sales/proposal-from-a-call", title: "Proposal", ready: true, asks: [],
    reads: [{ file: "packs/proposal.md", title: "The proposal pack", state: "missing", need: "may" }, { file: "pricing/terms.md", title: "Terms", state: "empty", need: "must" }] } });
  assert.match(textOf(reads), /The proposal packNot added yet\. Optional\./);
  assert.match(textOf(reads), /TermsNot filled in yet\. Needed\./);
  assert.equal(withClass(reads, "k-job__read-dot").length, 1, "only the needed file carries the warning mark");

  const blocked = show(job.JobStart, { job: { id: "marketing/carousel-from-a-concept", title: "A carousel", ready: true,
    asks: [{ id: "earlier", label: "Which set of concepts?", kind: "task", required: true, options: [] }],
    takes: { from: ["marketing/five-concepts"], after: [{ id: "marketing/five-concepts", title: "Five concepts before any design" }], waiting: null } } });
  assert.match(textOf(blocked), /This follows "Five concepts before any design"\./);
  assert.doesNotMatch(textOf(blocked), /Start/, "no Start that could only be refused");
});

test("task rows: the name first and the ref quietly after; no raw marks; the job named once (M50 F3, F8, F15; M51 F8, F12)", () => {
  assert.equal(taskCard.rowLine({ outcome: "A full refund [1]. Custom orders cannot be returned [1][2]." }), "A full refund. Custom orders cannot be returned.");
  const root = show(taskCard.TaskRow, { task: { id: "t1", identifier: "STH-20", title: "Proposal from a call write-up: Asha", job: { title: "Proposal from a call write-up" }, outcome: "Sent." } });
  const top = withClass(root, "k-task-row__top")[0];
  assert.deepEqual(top.childNodes.map(classOf), ["k-task-row__title", "k-task-row__ref"]);
  assert.equal(withClass(root, "k-task-row__job").length, 0, "the job's name is left out when the title starts with it");
  const other = show(taskCard.TaskRow, { task: { id: "t2", identifier: "STH-21", title: "Asha's proposal", job: { title: "Proposal from a call write-up" } } });
  assert.equal(withClass(other, "k-task-row__job").length, 1);
  const card = show(taskCard.TaskCard, { task: { id: "t3", identifier: "STH-22", title: "Walk cycle", column: "done" } });
  assert.equal(withClass(withClass(card, "k-task-card__top")[0], "k-mono").length, 0, "the board card leads with its name");
  assert.equal(withClass(card, "k-task-card__ref").length, 1);
});

test("file cards and evidence show a file's own name, never its folder; each Open says which file (M50 F17, M52 K9, K10)", () => {
  const root = show(conversation.FileCard, { file: { name: "art/walker/walker-sheet.png", kind: "image", viewUrl: "/api/x", size: 1200 } });
  assert.doesNotMatch(textOf(root), /art\/walker/);
  assert.equal(withClass(root, "k-file__folder").length, 0);
  assert.ok(elements(root).some((e) => e.getAttribute("aria-label") === "Open walker-sheet.png"));
  const checks = src("kit/checks.js");
  assert.doesNotMatch(checks, /alt=\$\{`Evidence: \$\{name\}`\}/);
  assert.match(checks, /split\("\/"\)\.pop\(\)/);
});

test("the command menu leads with Start and the departments, pages last, and does not say Search twice (M18-14)", () => {
  const empty = menu.localItems("", []);
  assert.deepEqual([...new Set(empty.map((i) => i.group))], ["Start", "Departments", "Pages"]);
  assert.doesNotMatch(menu.PLACEHOLDER, /^Search/);
  assert.ok(menu.PLACEHOLDER_SHORT.length <= 34, "the phone's placeholder fits 390 px");
  assert.match(css("shell.css"), /\.s-cmd-list\.has-more\s*\{[^}]*mask-image/);
});

test("the dock: the briefcase at its foot, each item's words on hover, labels give way on a short window (M18-23, M18-33, C1)", () => {
  const root = show(dock.Dock, { dock: [{ id: "sales", title: "Sales", creature: "sales", working: 1, needsYou: 2 }], current: null, onCompose() {} });
  const item = withClass(root, "s-dock-item")[0];
  assert.equal(item.getAttribute("title"), "Sales, 1 working, 2 need you");
  assert.match(src("shell/dock.js"), /<\$\{Icon\} name="jobs" \/>\s*<\/a>/);
  assert.match(css("shell.css"), /@media \(max-height: 699px\)\s*\{\s*\.s-dock-label\s*\{\s*display: none;/);
});

test("the top bar: the right group never slides under the capsule, and a band fades in once scrolled (M18-01, M50 F12)", () => {
  const s = css("shell.css");
  // Up to 1399 px since the capsule holds a fifth section, App Studio (PLAN-V5 T80); 1259 px let it overlap at 1280.
  assert.match(s, /@media \(min-width: 860px\) and \(max-width: 1399px\)\s*\{\s*\.s-topbar\s*\{\s*grid-template-columns: auto minmax\(0, 1fr\) auto;/);
  assert.match(s, /@media \(min-width: 860px\) and \(max-width: 1099px\)\s*\{\s*\.s-topbar \.s-capsule-item \.k-icon\s*\{\s*display: none;/, "the five sections' words alone up to 1099 px");
  assert.match(s, /\.s-needs\s*\{\s*flex: none;/);
  assert.match(s, /\.s-topbar\.is-scrolled::before\s*\{\s*opacity: 1;/);
  assert.match(s, /@media \(min-width: 860px\) and \(max-width: 979px\)\s*\{\s*\.s-topbar \.s-brand-name\s*\{\s*display: none;/);
});

test("the tab bar lives in the pages' layer, so a page's dialog lies over it (M52 F2)", () => {
  const shell = src("shell/app-shell.js");
  const open = shell.indexOf("<div class=${cls}>");
  const bar = shell.indexOf("<${TabBar}");
  const drawer = shell.indexOf("<${NeedsDrawer}");
  const close = shell.lastIndexOf("</div>", drawer);
  assert.ok(open > 0 && bar > open && bar < close, "the TabBar is inside .s-app");
});

test("drawers: full width below 860 px, focus on Close first, no paused opening animation with motion off (M18-13, M50 F13, M52 K1)", () => {
  const o = css("kit/overlays.css");
  assert.match(o, /@media \(max-width: 859px\)[\s\S]*\.k-drawer__panel\s*\{\s*width: 100%;/);
  assert.match(o, /\[data-motion="off"\] \.k-drawer__panel\s*\{\s*animation: none;/);
  const js = src("kit/overlays.js");
  assert.match(js, /useFocusTrap\(ref, onClose, true\)/);
  assert.match(js, /data-overlay-close/);
  assert.doesNotMatch(css("base.css"), /animation-play-state: paused/);
});

test("motion off stops the live dot and the loading lines too", () => {
  assert.match(css("kit/status.css"), /\[data-motion="off"\] \.k-dot--pulse \.k-dot__mark::after\s*\{\s*animation: none;/);
  assert.match(css("kit/states.css"), /\[data-motion="off"\] \.k-loading__line\s*\{\s*animation: none;/);
});

test("the warm tint lies over glass; urgent says so once; drawer cards line up (M18-11, M18-12)", () => {
  assert.match(css("kit/card.css"), /\.k-card--warm\s*\{\s*background: linear-gradient\(var\(--bg-warm\), var\(--bg-warm\)\), var\(--glass\);/);
  const d = css("kit/decision.css");
  assert.match(d, /\.k-decision--high\s*\{\s*border-color: var\(--border-warm\);/);
  assert.match(d, /\.k-decision--compact \.k-decision__details\s*\{\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(d, /dd::first-letter\s*\{\s*text-transform: uppercase;/);
});

test("a switched-off primary is a solid fill, not half the white pill (M18-27)", () => {
  const b = css("kit/button.css");
  assert.match(b, /\.k-btn--primary:disabled:not\(\.k-btn--busy\)[^{]*\{\s*opacity: 1;\s*background: color-mix/);
});

test("fold-outs use the kit's chevron, not the browser's triangle (M18-26)", () => {
  assert.match(css("kit/job.css"), /\.k-job__preview-head::-webkit-details-marker\s*\{\s*display: none;/);
  assert.match(css("kit/answer.css"), /\.k-answer__sources-head::-webkit-details-marker\s*\{\s*display: none;/);
  assert.match(src("kit/job.js"), /class="k-job__fold"/);
  assert.match(src("kit/answer.js"), /class="k-answer__fold"/);
});

test("the rows form stays inside its box and stacks when its columns do not fit (M18-21, M52 F3)", () => {
  const f = css("kit/forms.css");
  assert.match(f, /\.k-form__rows\s*\{\s*position: relative;/);
  assert.match(f, /\.k-form__rows-box\s*\{\s*container-type: inline-size;/);
  for (const n of [2, 3, 4, 5, 6]) assert.match(f, new RegExp(`@container \\(max-width: \\d+px\\)\\s*\\{\\s*\\.k-form__rows--c${n}`));
});

test("job rows on a phone: two lines for the name, the stage kept, bullets in the text colour (M18-03, M18-10, M18-16, M51 F11)", () => {
  const j = css("kit/job.css");
  assert.doesNotMatch(j, /\.k-job__marks \.k-job--stage\s*\{\s*display: none;/);
  assert.match(j, /\.k-job--row > \.k-job__title\s*\{[^}]*-webkit-line-clamp: 2;/);
  assert.match(j, /\.k-job--row\s*\{\s*--k-job-dot: var\(--text\);/);
  assert.match(j, /grid-template-columns: 104px 112px;/);
});

test("the pill control fades its cut edge and drops icons on a phone (M18-29, M52 F10)", () => {
  const s = css("kit/segmented.css");
  assert.match(s, /\.k-seg--more\s*\{[^}]*mask-image/);
  assert.match(s, /@media \(max-width: 479px\)\s*\{\s*\.k-seg__item:has\(\.k-seg__label:not\(:empty\)\) \.k-icon\s*\{\s*display: none;/);
});

test("the ask box on a phone: a placeholder that fits, the hint only while in use (M18-04, M18-31)", () => {
  assert.ok(composer.ASK_SHORT_PLACEHOLDER.length < composer.ASK_PLACEHOLDER.length);
  const c = css("kit/composer.css");
  assert.match(c, /\.k-composer--ask:not\(:focus-within\) \.k-composer__note\s*\{\s*display: none;/);
  assert.match(c, /text-wrap: balance;/);
});

test("the light theme's strong glass and the working colour for words (M18-30, M50 F10)", () => {
  const t = css("tokens.css");
  assert.match(t, /:root\[data-theme="light"\]\s*\{[^}]*--glass-strong: rgba\(255,255,255,\.97\);/);
  assert.match(t, /--live-text: #15803d;/);
});
