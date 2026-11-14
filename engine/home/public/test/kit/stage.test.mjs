// The kit's stage parts (T33 of PLAN-COOK): Shot, Frames, Frame, StageBar, Pin, Finds, PicTag, Pair and Verdict.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, installDom, mount, unmount, elements, textOf, byClass, fire, walkDom } from "./_dom.mjs";
import { HOSTILE } from "./_fixtures.mjs";
import { css, ROOTS, newSheetTest } from "./_rules.mjs";

const mod = await import(pathToFileURL(join(KIT, "stage.js")).href);
const { Shot, Frames, Frame, Pin, Finds, PicTag, Pair, Verdict } = mod;

const texts = (root) => [...walkDom(root)].filter((n) => n.nodeType === 3).map((n) => n.data);

test("stage.js loads in Node and exports its parts as functions", () => {
  for (const name of ["Shot", "Frames", "Frame", "StageBar", "Pin", "Finds", "PicTag", "Pair", "Verdict"]) assert.equal(typeof mod[name], "function", `${name} is a function`);
});

test("a Shot shows its picture as given, its tags at the corners and its caption, all words as text", async () => {
  installDom();
  const root = await mount(Shot, { src: "/api/view/abc", alt: HOSTILE, tags: ["Storyboard", { text: "16:9", at: "tr" }], children: HOSTILE });
  const img = elements(root).find((e) => e.localName === "img");
  assert.equal(img.getAttribute("src"), "/api/view/abc");
  assert.equal(img.getAttribute("alt"), HOSTILE);
  assert.deepEqual(byClass(root, "k-pictag").map((t) => t.getAttribute("class")), ["k-pictag k-pictag--tl", "k-pictag k-pictag--tr"]);
  assert.ok(texts(root).includes(HOSTILE), "the caption is a text node");
  assert.equal(elements(root).filter((e) => e.localName === "img").length, 1);
  unmount(root);
  const bare = await mount(Shot, { src: { evil: 1 } });
  assert.equal(elements(bare).filter((e) => e.localName === "img").length, 0, "no address, no picture");
  unmount(bare);
});

test("a Frame's label says the width it was given", async () => {
  installDom();
  let root = await mount(Frame, { width: 1280, src: "/api/sites/shot/x/desk.png", label: "Desktop" });
  assert.match(textOf(byClass(root, "k-frame__label")[0]), /^Desktop1280 px wide/);
  assert.ok(byClass(root, "k-frame--desk").length === 1);
  unmount(root);
  root = await mount(Frame, { width: 390, label: "Phone" });
  assert.equal(textOf(byClass(root, "k-frame__label")[0]), "Phone390 px wide");
  assert.ok(byClass(root, "k-frame--phone").length === 1);
  unmount(root);
});

test("Frames draw their pages at one scale: each grows by its true width", async () => {
  installDom();
  const root = await mount(Frames, { items: [{ width: 1280, label: "Desktop" }, { width: 390, label: "Phone" }] });
  const cells = byClass(root, "k-frames__cell");
  assert.equal(cells.length, 2);
  assert.deepEqual(cells.map((c) => c.style.cssText || c.getAttribute("style")), ["flex-grow:1280", "flex-grow:390"]);
  unmount(root);
  const fixed = await mount(Frames, { scale: 0.5, items: [{ width: 1280 }, { width: 390 }] });
  assert.deepEqual(byClass(fixed, "k-frames__cell").map((c) => c.style.cssText || c.getAttribute("style")), ["width:640px", "width:195px"]);
  unmount(fixed);
});

test("a Frame's pins sit in the gutter, a pin below its height goes further down, and a pin with no place is in the label", async () => {
  installDom();
  let picked = null;
  const root = await mount(Frame, {
    width: 1280, height: 1048, selected: 3, onPin: (n) => { picked = n; },
    pins: [{ n: 1, x: 18, y: 0, side: "top" }, { n: 3, x: 56, y: 449, w: 562, h: 78 }, { n: 4, y: 1400 }, { n: 5 }],
  });
  const gutter = byClass(root, "k-frame__pin");
  assert.deepEqual(gutter.map((g) => g.getAttribute("class")), ["k-frame__pin k-frame__pin--top", "k-frame__pin k-frame__pin--left"]);
  assert.equal(byClass(root, "k-frame__mark").length, 1);
  assert.ok(byClass(root, "k-frame__mark--on").length === 1, "the chosen finding's mark is shown");
  assert.match(textOf(byClass(root, "k-frame__below")[0]), /^4further down/);
  assert.equal(textOf(byClass(root, "k-frame__loose")[0]), "5");
  const pins = elements(root).filter((e) => e.localName === "button" && (e.getAttribute("class") || "").includes("k-pin"));
  assert.deepEqual(pins.map((p) => p.getAttribute("aria-label")), ["Finding 1", "Finding 3", "Finding 4", "Finding 5"]);
  assert.equal(pins[1].getAttribute("aria-pressed"), "true");
  fire(pins[2], "click");
  assert.equal(picked, 4);
  unmount(root);
});

test("Finds: rows are buttons, the chosen one shows its detail, Up and Down move", async () => {
  installDom();
  let chosen = null;
  const items = [{ n: 1, title: "A file is missing", detail: "1 error" }, { n: 2, title: HOSTILE, detail: HOSTILE, code: "#8A8278 on #FBFAF7" }];
  const root = await mount(Finds, { items, selected: 2, onSelect: (n) => { chosen = n; } });
  const rows = byClass(root, "k-finds__row");
  assert.ok(rows.every((r) => r.localName === "button"));
  assert.deepEqual(rows.map((r) => r.getAttribute("aria-pressed")), ["false", "true"]);
  assert.equal(byClass(root, "k-finds__detail").length, 1, "only the chosen row shows its detail");
  assert.ok(texts(root).filter((t) => t === HOSTILE).length === 2, "a finding's words are text nodes");
  assert.equal(textOf(byClass(root, "k-finds__code")[0]), "#8A8278 on #FBFAF7");
  fire(rows[0], "click");
  assert.equal(chosen, 1);
  const [list] = byClass(root, "k-finds");
  let focused = null;
  rows[1].focus = () => { focused = rows[1]; };
  globalThis.document.activeElement = rows[0];
  fire(list, "keydown", { key: "ArrowDown", currentTarget: { querySelectorAll: () => rows } });
  assert.equal(focused, rows[1]);
  assert.equal(chosen, 2);
  unmount(root);
});

test("Pin, PicTag, Pair and Verdict draw what they are given", async () => {
  installDom();
  let root = await mount(Pin, { n: 3 });
  assert.equal(elements(root)[1].localName, "span", "a pin without an action is a mark");
  assert.equal(textOf(root), "3");
  unmount(root);
  root = await mount(PicTag, { at: "nowhere", children: "s01" });
  assert.equal(byClass(root, "k-pictag--tl").length, 1, "an unknown corner is the top left");
  unmount(root);
  root = await mount(Pair, { items: [{ src: "/api/view/a", title: "Your render", sub: HOSTILE }, { src: "/api/view/b", title: "The board" }] });
  assert.equal(elements(root).filter((e) => e.localName === "img").length, 2);
  assert.ok(texts(root).includes(HOSTILE));
  unmount(root);
  root = await mount(Verdict, { tone: "warn", title: "Kept, with a note", by: "The Art director" });
  assert.equal(byClass(root, "k-verdict--warn").length, 1);
  assert.equal(textOf(byClass(root, "k-verdict__title")[0]), "Kept, with a note");
  assert.doesNotMatch(byClass(root, "k-verdict")[0].getAttribute("class"), /k-verdict--(inline|stack)/, "unset: the sheet decides");
  unmount(root);
});

test("T97: a verdict in one line: the word in its tone, then the grey by words after a middle dot; the default in a rail", async () => {
  installDom();
  let root = await mount(Verdict, { tone: "good", title: "Keep", by: "the Art director's verdict", inline: true });
  const v = byClass(root, "k-verdict")[0];
  assert.match(v.getAttribute("class"), /\bk-verdict--inline\b/);
  assert.equal(textOf(v), "Keepthe Art director's verdict", "the dot is drawn, not read");
  assert.equal(byClass(v, "k-verdict__by").length, 1);
  unmount(root);
  root = await mount(Verdict, { tone: "warn", title: "Retake", by: "the Art director's verdict", inline: false });
  assert.match(byClass(root, "k-verdict")[0].getAttribute("class"), /\bk-verdict--stack\b/, "the two-line form stays available");
  unmount(root);
  const sheet = css("kit/stage.css");
  assert.match(sheet, /\.k-verdict--inline \.k-verdict__text,\s*\.k-rail \.k-verdict:not\(\.k-verdict--stack\) \.k-verdict__text \{[^}]*display: flex;[^}]*align-items: baseline;/);
  assert.match(sheet, /\.k-verdict--inline \.k-verdict__by::before,\s*\.k-rail \.k-verdict:not\(\.k-verdict--stack\) \.k-verdict__by::before \{[^}]*content: "\\00B7" \/ "";/);
  assert.match(sheet, /\.k-verdict--inline\.k-verdict--warn \.k-verdict__title,[^{]*\{ color: var\(--warn\); \}/, "the word in its tone");
});

test("stage.css: pins in the gutter as tinted 18 px discs, a stage panel around the frames, no blur, and the phone frame alone below 860 px", () => {
  const sheet = css("kit/stage.css");
  assert.doesNotMatch(sheet, /backdrop-filter/);
  assert.match(sheet, /\.k-frames \{[^}]*padding: var\(--s-6\);[^}]*border: 1px solid var\(--line\);[^}]*border-radius: var\(--r-2\);[^}]*background: var\(--panel\);[^}]*box-shadow: var\(--shadow-card\)/, "the stage panel: a 1 px edge, an 8 px corner and the card shadow");
  assert.match(sheet, /\.k-frame__pin--left \{\s*left: -22px;/);
  assert.match(sheet, /\.k-pin \{[^}]*width: 18px;[^}]*background: color-mix\(in srgb, var\(--warn\) 20%, transparent\);[^}]*color: var\(--warn\);/, "an 18 px disc on a 20 percent amber tint, amber numerals");
  assert.match(sheet, /\.k-shot__frame \{[^}]*aspect-ratio: 16 \/ 9;[^}]*background: var\(--black\)/);
  assert.match(sheet, /@media \(max-width: 859px\)[\s\S]*\.k-frames__cell--desk:not\(:only-child\) \{\s*display: none;/);
});

test("T96: a shot is bounded by the stage's real height, not a raw allowance; frames that fill are bounded by their place's height", async () => {
  const sheet = css("kit/stage.css");
  const frame = /\.k-shot__frame \{([^}]*)\}/.exec(sheet)[1];
  assert.match(frame, /width: min\(100%, calc\(\(var\(--k-stage-h, 100vh - var\(--topbar-h\)\) - var\(--k-shot-room\)\) \* 16 \/ 9\)\);/);
  assert.doesNotMatch(sheet, /176px/, "no raw allowance");
  assert.match(sheet, /\.k-frames:not\(\.k-frames--fixed\) \{[^}]*max-width: calc\(\(100cqh - 106px\) \* var\(--k-frames-w\) \/ var\(--k-frames-h\)/);
  installDom();
  const root = await mount(mod.Frames, { items: [{ width: 1280 }, { width: 390, height: 900 }] });
  const frames = byClass(root, "k-frames")[0];
  assert.equal(frames.style.cssText || frames.getAttribute("style"), "--k-frames-w:1670;--k-frames-h:1048;--k-frames-gaps:1");
  unmount(root);
  const fixed = await mount(mod.Frames, { scale: 0.5, items: [{ width: 1280 }] });
  assert.ok(!(byClass(fixed, "k-frames")[0].getAttribute("style") || ""), "a fixed scale is not bounded by height");
  unmount(fixed);
});

test("T102: Finds with a limit shows that many rows and a Show all row that opens the rest in place; the rows are one Tab stop", async () => {
  installDom();
  const items = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ n, title: `Finding ${n}` }));
  let root = await mount(Finds, { items, limit: 4, more: "Show all 7" });
  let rows = byClass(root, "k-finds__row");
  assert.equal(rows.length, 4, "four rows");
  assert.deepEqual(rows.map((r) => r.getAttribute("tabindex")), ["0", "-1", "-1", "-1"], "one stop: the first row");
  const [more] = byClass(root, "k-finds__more");
  assert.equal(more.localName, "button");
  assert.equal(textOf(more), "Show all 7");
  fire(more, "click");
  await new Promise((r) => setTimeout(r, 150));
  rows = byClass(root, "k-finds__row");
  assert.equal(rows.length, 7, "the rest opened in place");
  assert.equal(byClass(root, "k-finds__more").length, 0);
  unmount(root);
  root = await mount(Finds, { items, limit: 4, selected: 6 });
  rows = byClass(root, "k-finds__row");
  assert.equal(rows.length, 7, "a chosen row further down opens the list");
  assert.deepEqual(rows.map((r) => r.getAttribute("tabindex")).indexOf("0"), 5, "the stop is the chosen row");
  unmount(root);
  root = await mount(Finds, { items: items.slice(0, 5), limit: 4 });
  assert.equal(byClass(root, "k-finds__row").length, 5, "one more than the limit is shown, never Show all 1");
  assert.equal(byClass(root, "k-finds__more").length, 0);
  unmount(root);
});

ROOTS.stage = "k-shot";
newSheetTest("stage");
