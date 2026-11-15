// The kit's composer (CONTRACTS-V2 13.2, V3 25 and 28, U2, M18): the trigger, the words, the two modes, the hint
// on a phone. Split out of kit-b, kit-v60a, kit-m55 and pages-u2 (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, FakeElement, html, render, installDom, elements, textOf, settle, show, showTree, fire } from "./_dom.mjs";
import { shape } from "./_fixtures.mjs";
import { css, compositeSheetTests } from "./_rules.mjs";

const load = (name) => import(join(KIT, `${name}.js`));
const composer = await import(pathToFileURL(join(KIT, "composer.js")).href);

test("trigger: '/' at the start of a line and '@' at the start of a word", async () => {
  const { trigger } = await load("composer");
  assert.deepEqual(trigger("/inv", 4), { kind: "/", query: "inv" });
  assert.deepEqual(trigger("hello @ma", 9), { kind: "@", query: "ma" });
  assert.equal(trigger("a/b", 3), null);
  assert.equal(trigger("mail@x", 6), null);
  assert.deepEqual(trigger("first line\n/dr", 14), { kind: "/", query: "dr" });
  assert.deepEqual(trigger("/", 1), { kind: "/", query: "" });
  assert.deepEqual(trigger("@", 1), { kind: "@", query: "" });
  assert.equal(trigger("/inv now", 8), null);
  assert.deepEqual(trigger("/invoice and more", 4), { kind: "/", query: "inv" });
  assert.equal(trigger("", 0), null);
});

// CONTRACTS-V3 25 and 28: the "/" list holds jobs now, so the placeholder names them; the ask box has its own words.
test("Composer has the pinned default placeholder, and the ask box's words", async () => {
  const src = readFileSync(join(KIT, "composer.js"), "utf8");
  assert.ok(src.includes('"Say what you want done.  /  for jobs,  @  to pick who."'));
  const m = await load("composer");
  assert.equal(m.ASK_PLACEHOLDER, "Ask the company brain, or say what you want done.");
  assert.equal(m.ASK_HINT, "Enter to send. A real agent reads your files, so an answer takes a minute or two.");
  assert.ok(!/ready-made/i.test(src.replace(/^\/\/.*$/gm, "")), "no \"ready-made\" on screen");
});

test("the ask box on a phone: a placeholder that fits, the hint only while in use (M18-04, M18-31)", () => {
  assert.ok(composer.ASK_SHORT_PLACEHOLDER.length < composer.ASK_PLACEHOLDER.length);
  const c = css("kit/composer.css");
  assert.match(c, /\.k-composer--ask:not\(:focus-within\) \.k-composer__note\s*\{\s*display: none;/);
  assert.match(c, /text-wrap: balance;/);
});

test("T97: the box carries the 2 px accent ring with a 2 px offset while its field has focus; the field draws none", () => {
  const c = css("kit/composer.css");
  assert.match(c, /\.k-composer__box:has\(\.k-composer__field:focus\) \{\s*outline: 2px solid var\(--focus\);\s*outline-offset: 2px;/);
  assert.doesNotMatch(c, /\.k-composer__box:focus-within \{[^}]*border-color: var\(--accent\)/, "no 1 px accent border for focus");
  assert.match(c, /\.k-composer__field:focus,\s*\.k-composer__field:focus-visible \{\s*outline: none;/, "no second ring on the field");
});

// ---- The Composer's two modes (CONTRACTS-V3 28), in the small DOM (kit-v60a).
const JOB = shape("job");
const textarea = (root) => elements(root).find((e) => e.localName === "textarea");
// The Composer puts the caret back after a pick.
FakeElement.prototype.setSelectionRange ||= function () {};
const type = (el, value) => fire(el, "input", { currentTarget: { value, selectionStart: value.length } });

test("Composer in ask mode: one box, a round send button, the hint under it; Enter sends only the text", async () => {
  installDom();
  const sent = [];
  const root = await showTree(composer.Composer, { mode: "ask", onSend: async (body) => { sent.push(body); }, agents: [{ slug: "artist", name: "Artist" }], templates: [JOB] });
  assert.ok(elements(root).some((e) => /\bk-composer--ask\b/.test(e.getAttribute("class") || "")));
  const field = textarea(root);
  assert.equal(field.getAttribute("placeholder") ?? field.placeholder, composer.ASK_PLACEHOLDER);
  assert.ok(textOf(root).includes(composer.ASK_HINT), "the hint is under the box");
  assert.ok(!textOf(root).includes("Plan first"), "no Plan first box");
  const send = elements(root).find((e) => e.localName === "button" && /k-composer__send/.test(e.getAttribute("class") || ""));
  assert.ok(send, "a round send button");
  assert.equal(send.getAttribute("aria-label"), "Send");
  // "/" and "@" open nothing here.
  type(field, "/");
  await settle();
  assert.ok(!elements(root).some((e) => e.getAttribute("role") === "listbox"));
  type(field, "@");
  await settle();
  assert.ok(!elements(root).some((e) => e.getAttribute("role") === "listbox"));
  type(field, "  What is our returns policy?  ");
  await settle();
  fire(textarea(root), "keydown", { key: "Enter", shiftKey: true });
  await settle();
  assert.equal(sent.length, 0, "Shift+Enter is a new line");
  fire(textarea(root), "keydown", { key: "Enter", shiftKey: false });
  await settle();
  assert.deepEqual(sent, [{ text: "What is our returns policy?" }]);
  render(null, root);
});

test("Composer in ask mode takes its own hint and placeholder", async () => {
  installDom();
  const root = await showTree(composer.Composer, { mode: "ask", hint: "A minute or two.", placeholder: "Ask Sales.", onSend: async () => {} });
  assert.ok(textOf(root).includes("A minute or two."));
  assert.ok(!textOf(root).includes(composer.ASK_HINT));
  const field = textarea(root);
  assert.equal(field.getAttribute("placeholder") ?? field.placeholder, "Ask Sales.");
  render(null, root);
});

test("Composer in task mode: '/' lists jobs; picking one calls onPickJob and fills no text", async () => {
  installDom();
  const picked = [];
  const sent = [];
  const dim = { ...JOB, id: "books/quotation-from-a-call", title: "Quotation from a call write-up", department: { id: "books", title: "Books" }, ready: false };
  const root = await showTree(composer.Composer, { onSend: async (b) => { sent.push(b); }, onPickJob: (job) => picked.push(job), templates: [JOB, dim], hint: "Started jobs take a few minutes." });
  assert.ok(!elements(root).some((e) => /\bk-composer--ask\b/.test(e.getAttribute("class") || "")), "task is the default mode");
  assert.ok(textOf(root).includes("Plan first"));
  assert.ok(textOf(root).includes("Started jobs take a few minutes."), "the hint replaces the keys line");
  type(textarea(root), "/");
  await settle();
  const list = elements(root).find((e) => e.getAttribute("role") === "listbox");
  assert.ok(list, "the list opens");
  assert.equal(list.getAttribute("aria-label"), "Jobs");
  assert.ok(textOf(list).includes(JOB.title) && textOf(list).includes(dim.title));
  const options = elements(list).filter((e) => e.getAttribute("role") === "option");
  assert.ok(/k-composer__option--dim/.test(options[1].getAttribute("class")), "a job that cannot start is dim");
  assert.ok(elements(options[0]).some((e) => e.getAttribute("data-dept") === "sales" && /k-composer__option-icon/.test(e.getAttribute("class") || "")
    && elements(e).some((s) => s.localName === "svg")), "the department's line icon, not a coloured dot (O7)");
  fire(options[0], "click");
  await settle();
  assert.deepEqual(picked.map((j) => j.id), [JOB.id]);
  assert.ok(!textOf(root).includes("Job") || !elements(root).some((e) => /k-composer__template/.test(e.getAttribute("class") || "")), "no template chip");
  assert.ok(!elements(root).some((e) => e.getAttribute("role") === "listbox"), "the list closed");
  assert.equal(sent.length, 0, "nothing was sent");
  render(null, root);
});

test("Composer in task mode without onPickJob: a job's text fills the line, as in version 2", async () => {
  installDom();
  const goal = { id: "books/draft-an-invoice", title: "Draft an invoice", summary: "An invoice.", text: "Draft an invoice for [customer].", to: "bookkeeper", planFirst: false };
  const root = await showTree(composer.Composer, { onSend: async () => {}, templates: [goal], agents: [{ slug: "bookkeeper", name: "Bookkeeper" }] });
  type(textarea(root), "/dr");
  await settle();
  const option = elements(root).find((e) => e.getAttribute("role") === "option");
  fire(option, "click");
  await settle();
  assert.ok(elements(root).some((e) => /k-composer__template/.test(e.getAttribute("class") || "")), "the job chip shows");
  assert.ok(textOf(root).includes("For") && textOf(root).includes("Bookkeeper"));
  render(null, root);
});

// ---- U2: the composer's hint is short on a phone (pages-u2).

test("composer: the full hint at wide sizes, the short one below 480 px, and never both", async () => {
  const find = (root) => elements(root).find((e) => e.localName === "textarea");
  const prev = globalThis.matchMedia;
  try {
    for (const [matches, want] of [[false, composer.DEFAULT_PLACEHOLDER], [true, composer.SHORT_PLACEHOLDER]]) {
      globalThis.matchMedia = () => ({ matches, addEventListener() {}, removeEventListener() {} });
      const root = await show(composer.Composer, {});
      assert.equal(find(root).getAttribute("placeholder"), want);
    }
    assert.equal(composer.SHORT_PLACEHOLDER, "Say what you want done.");
    // A placeholder the page chose itself is never swapped.
    const root = await show(composer.Composer, { placeholder: "Write to Sam." });
    assert.equal(find(root).getAttribute("placeholder"), "Write to Sam.");
  } finally {
    if (prev === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = prev;
  }
});

// PLAN-COOK T37: one outlined box on the panel step, 15 px words, the round send button in the accent fill in both
// modes, the hint at 13 px; nothing blurs and nothing is glass.
test("Composer: one outlined box on the panel, 15 px words, a round send button in the accent fill in both modes", async () => {
  const c = css("kit/composer.css");
  assert.match(c, /\.k-composer__box\s*\{[^}]*border: 1px solid var\(--line-2\);[^}]*background: var\(--panel\);/);
  assert.match(c, /\.k-composer__field\s*\{[^}]*font-size: var\(--fs-fact\);/);
  assert.match(c, /\.k-composer__send\s*\{[^}]*border-radius: var\(--r-round\);[^}]*background: var\(--accent-fill\);/);
  assert.match(c, /\.k-composer__hint\s*\{[^}]*font-size: var\(--fs-note\);/);
  assert.doesNotMatch(c, /--glass|--highlight|--r-pill|--r-5|var\(--dept|--primary/);
  installDom();
  const root = await showTree(composer.Composer, { onSend: async () => {} });
  const send = elements(root).find((e) => e.localName === "button" && /k-composer__send/.test(e.getAttribute("class") || ""));
  assert.ok(send, "task mode has the round send button too");
  assert.equal(send.getAttribute("aria-label"), "Send");
  assert.equal(send.getAttribute("disabled"), "true", "inert until there are words");
  render(null, root);
});

// ---- T118: what a host needs to draw its own foot without reaching inside.

test("heightLimit: px or a share of the window, else the 240 px default", () => {
  assert.equal(composer.heightLimit(320), "320px");
  assert.equal(composer.heightLimit("320px"), "320px");
  assert.equal(composer.heightLimit("40vh"), "40vh");
  for (const bad of [undefined, null, 0, -5, NaN, "", "40%", "calc(1px)", "red", "0vh"]) assert.equal(composer.heightLimit(bad), null, String(bad));
});

test("Composer, a host's foot: the bare look, a worded Send, the host's controls at the left and its keys before Send", async () => {
  installDom();
  const sent = [];
  let edit = null;
  const root = await showTree(composer.Composer, {
    onSend: async (b) => { sent.push(b); }, agents: [{ slug: "artist", name: "Artist" }], bare: true, sendLabel: "Send", maxHeight: "40vh",
    keys: "Enter to send",
    controls: (api) => { edit = api.edit; return html`<button type="button" class="host-key">key</button>`; },
  });
  const outer = elements(root).find((e) => /\bk-composer\b/.test(e.getAttribute("class") || ""));
  assert.match(outer.getAttribute("class"), /k-composer--bare/);
  assert.ok(!elements(root).some((e) => /k-composer__send(\s|$)/.test(e.getAttribute("class") || "")), "no round send button");
  const bar = elements(root).find((e) => /k-composer__bar/.test(e.getAttribute("class") || ""));
  const order = elements(bar).map((e) => e.getAttribute("class") || "").filter((c) => /k-check |k-check$|host-key|k-composer__keys|k-composer__send-word/.test(c));
  assert.equal(order.length, 4, order.join(" | "));
  assert.match(order[0], /k-check/, "Plan first, the kit's check box, first");
  assert.match(order[1], /host-key/, "then the host's controls");
  assert.match(order[2], /k-composer__keys/, "then the keys hint");
  assert.match(order[3], /k-btn--primary/, "then Send, the kit's primary");
  assert.match(order[3], /k-btn--sm/);
  const send = elements(bar).find((e) => /k-composer__send-word/.test(e.getAttribute("class") || ""));
  assert.equal(textOf(send), "Send");
  assert.ok(send.getAttribute("disabled") === "true" || send.disabled === true, "disabled with nothing typed");
  assert.ok(textOf(bar).includes("Enter to send"));
  assert.ok(!textOf(bar).includes("for a new line"), "the host's keys in place of the default hint");
  const field = textarea(root);
  assert.equal(field.style.maxHeight, "40vh", "the host's largest height");
  // The host's edit puts words in as if typed: the "@" list opens.
  field.selectionStart = 0;
  edit((v, c) => ({ text: `${v.slice(0, c)}@${v.slice(c)}`, caret: c + 1 }));
  await settle();
  const list = elements(root).find((e) => e.getAttribute("role") === "listbox");
  assert.ok(list, "the list opens");
  const box = elements(root).find((e) => /k-composer__box/.test(e.getAttribute("class") || ""));
  assert.ok(elements(box).includes(list), "in the bare look the list is in the flow, under the words");
  type(textarea(root), "Draft the price list");
  await settle();
  const ready = elements(root).find((e) => /k-composer__send-word/.test(e.getAttribute("class") || ""));
  assert.ok(!(ready.getAttribute("disabled") === "true" || ready.disabled === true), "enabled once there are words");
  fire(ready, "click");
  await settle();
  assert.deepEqual(sent, [{ text: "Draft the price list", to: null, planFirst: false, template: null }]);
  render(null, root);
});

test("Composer: the bare look is the kit's: no edge, no fill, no ring round it, a 2 px accent bar at the field's left", () => {
  const c = css("kit/composer.css");
  const box = /\.k-composer--bare \.k-composer__box \{([^}]*)\}/.exec(c)[1];
  assert.match(box, /border: 0;/);
  assert.match(box, /background: transparent;/);
  assert.match(box, /box-shadow: none;/);
  assert.match(c, /\.k-composer--bare \.k-composer__box:has\(\.k-composer__field:focus\) \{\s*outline: none;/);
  assert.match(c, /\.k-composer--bare \.k-composer__field:focus \{\s*box-shadow: inset 2px 0 0 var\(--accent\);/);
});

compositeSheetTests("composer");
