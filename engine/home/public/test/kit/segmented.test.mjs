// The kit's segmented control (CONTRACTS-V3 28, M12, M18), and the tests that run over every V3 part at once (they
// read segmented.js first): every module loads in Node, renders with its props and with none, keeps hostile words as
// text and uses only k- classes. Split out of kit-c and kit-m55 (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, installDom, elements, textOf, classesOf, isVNode, mount, unmount, fire } from "./_dom.mjs";
import { NEW, NEW_PINNED, HOSTILE, BRAND, SERVICES, LEAD } from "./_fixtures.mjs";
import { css, ROOTS, newSheetTest } from "./_rules.mjs";

const PINNED = NEW_PINNED;

// Load every module before any fake document exists: nothing may touch document or window at load.
const kit = {};
for (const m of NEW) kit[m] = await import(pathToFileURL(join(KIT, `${m}.js`)).href);

// ---- Loading and names ----

test("every new module loads in Node and exports its pinned names", () => {
  assert.equal(globalThis.document, undefined, "no document existed while the modules loaded");
  for (const [m, names] of Object.entries(PINNED)) {
    for (const name of names) assert.equal(typeof kit[m][name], "function", `kit/${m}.js exports ${name}`);
  }
});

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

test("the pill control marks its cut edge with a hairline and drops icons on a phone (M18-29, M52 F10)", () => {
  const s = css("kit/segmented.css");
  assert.match(s, /\.k-seg--more\s*\{[^}]*box-shadow: inset -1px 0 0 var\(--line-2\)/);
  assert.doesNotMatch(s, /mask-image|gradient\(/);
  assert.match(s, /@media \(max-width: 479px\)\s*\{\s*\.k-seg__item:has\(\.k-seg__label:not\(:empty\)\) \.k-icon\s*\{\s*display: none;/);
});

test("the pressed choice is lifted: the raised step with a hairline edge and strong words; the accent ring is the keyboard's alone", () => {
  const s = css("kit/segmented.css");
  const on = /\.k-seg__item--on,[^{]*\{([^}]*)\}/.exec(s);
  assert.ok(on, "the pressed choice is drawn");
  assert.match(on[1], /background: var\(--raise\);/);
  assert.match(on[1], /color: var\(--ink\);/);
  assert.match(on[1], /box-shadow: inset 0 0 0 1px var\(--line-2\);/);
  assert.match(on[1], /font-weight: var\(--fw-bold\);/);
  assert.doesNotMatch(on[1], /accent/, "a pressed choice has no accent ring or fill: that ring reads as a stuck focus");
  assert.match(s, /\.k-seg__item--on:focus-visible \{\s*box-shadow: inset 0 0 0 2px var\(--accent\);\s*\}/, "a pressed choice still shows the keyboard's ring when it has focus");
  assert.match(/\.k-seg\s*\{([^}]*)\}/.exec(s)[1], /border: 1px solid var\(--line-2\);[\s\S]*border-radius: var\(--r-2\);/, "one outlined track with the control corner");
  assert.match(/\.k-seg__item\s*\{([^}]*)\}/.exec(s)[1], /min-height: var\(--h-sm\);/, "28 px choices");
  assert.doesNotMatch(s, /\.k-seg:has\(/, "no ring round the track: the track scrolls");
  assert.match(s, /\.k-seg__item:focus-visible \{[^}]*outline: none;[^}]*box-shadow: inset 0 0 0 2px var\(--accent\);/, "the focused choice draws its own inset 2 px ring, which scrolling cannot cut");
  assert.doesNotMatch(s, /r-pill/);
});

newSheetTest("segmented");
