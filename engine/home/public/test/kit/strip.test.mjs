// The kit's strip (T33 of PLAN-COOK): Strip, OptionCard and TakeCard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, html, installDom, mount, unmount, elements, textOf, byClass, fire, walkDom } from "./_dom.mjs";
import { HOSTILE } from "./_fixtures.mjs";
import { css, ROOTS, newSheetTest } from "./_rules.mjs";

const mod = await import(pathToFileURL(join(KIT, "strip.js")).href);
const { Strip, OptionCard, TakeCard } = mod;

const texts = (root) => [...walkDom(root)].filter((n) => n.nodeType === 3).map((n) => n.data);
const radios = (root) => elements(root).filter((e) => e.getAttribute("role") === "radio");

test("strip.js loads in Node and exports its parts as functions", () => {
  for (const name of ["Strip", "OptionCard", "TakeCard"]) assert.equal(typeof mod[name], "function", `${name} is a function`);
});

function Three({ chosen, onPick, say = "calm and exact" }) {
  return html`<${Strip} label="The three treatments">
    ${["A", "B", "C"].map((t) => html`<${OptionCard} key=${t} checked=${chosen === t} onPick=${() => onPick && onPick(t)}
      title=${`${t} · Slow approach`} amount="$1.85" sub="30 s · 6 clips" say=${say}
      state=${t === "C" ? { tone: "good", text: "Fits today" } : { tone: "bad", icon: "lock", text: "Over today's limit" }}
      boards=${[{ src: "/api/view/a1", alt: "" }]} />`)}
  <//>`;
}

test("an OptionCard group is a radiogroup with exactly one aria-checked=\"true\", and it is the one Tab stop", async () => {
  installDom();
  const root = await mount(Three, { chosen: "B" });
  const [group] = elements(root).filter((e) => e.getAttribute("role") === "radiogroup");
  assert.ok(group, "a radiogroup");
  assert.equal(group.getAttribute("aria-label"), "The three treatments");
  const all = radios(root);
  assert.equal(all.length, 3);
  assert.equal(all.filter((r) => r.getAttribute("aria-checked") === "true").length, 1);
  assert.equal(all[1].getAttribute("aria-checked"), "true");
  assert.deepEqual(all.map((r) => r.getAttribute("tabindex")), ["-1", "0", "-1"]);
  assert.ok(all.every((r) => byClass(r, "k-opt__radio").length === 1), "each card draws its radio");
  unmount(root);
});

test("Space and Enter take a card; the arrows move the choice to the next card", async () => {
  installDom();
  const picks = [];
  const root = await mount(Three, { chosen: "A", onPick: (t) => picks.push(t) });
  const all = radios(root);
  fire(all[2], "keydown", { key: " ", target: all[2], currentTarget: all[2] });
  fire(all[1], "keydown", { key: "Enter", target: all[1], currentTarget: all[1] });
  fire(all[0], "click");
  assert.deepEqual(picks, ["C", "B", "A"]);
  const [group] = elements(root).filter((e) => e.getAttribute("role") === "radiogroup");
  let focused = null;
  all[1].focus = () => { focused = all[1]; };
  all[1].click = () => fire(all[1], "click");
  all[0].getAttribute = all[0].getAttribute.bind(all[0]);
  fire(group, "keydown", { key: "ArrowRight", target: all[0], currentTarget: { querySelectorAll: () => all } });
  assert.equal(focused, all[1], "the next card takes focus");
  assert.deepEqual(picks, ["C", "B", "A", "B"], "and is picked");
  unmount(root);
});

test("an OptionCard renders its words as text, one chip, and its amount at the right", async () => {
  installDom();
  const root = await mount(Three, { chosen: "A", say: HOSTILE });
  assert.equal(texts(root).filter((t) => t === HOSTILE).length, 3);
  assert.ok(!elements(root).some((e) => e.localName === "script"));
  for (const card of radios(root)) assert.equal(byClass(card, "k-strip__chip").length, 1, "one chip a card");
  assert.equal(byClass(radios(root)[0], "k-strip__chip--bad").length, 1);
  assert.equal(textOf(byClass(radios(root)[0], "k-opt__amount")[0]), "$1.85");
  assert.match(radios(root)[0].getAttribute("class"), /\bk-opt--side\b/, "one picture sits at the left");
  unmount(root);
});

test("an OptionCard with many boards draws two and a +n tile; a board can be chosen", async () => {
  installDom();
  let board = null;
  const boards = [0, 1, 2, 3, 4, 5].map((i) => ({ src: `/api/view/b${i}`, alt: "", label: `s0${i + 1}`, on: i === 0, onClick: () => { board = i; } }));
  const root = await mount(OptionCard, { checked: true, title: "A", boards });
  const shown = byClass(root, "k-opt__board");
  assert.equal(shown.length, 3);
  assert.equal(textOf(shown[2]), "+4");
  assert.equal(shown[0].getAttribute("aria-pressed"), "true");
  fire(shown[1], "click");
  assert.equal(board, 1);
  unmount(root);
});

test("a strip of TakeCards is a plain group of pressable buttons", async () => {
  installDom();
  let pressed = null;
  const Takes = () => html`<${Strip} label="The takes">
    <${TakeCard} pressed=${true} thumb=${{ src: "/api/view/t1", alt: "" }} title="Take 1" amount="$0.25" sub="5 s" state=${{ tone: "good", text: "Kept" }} />
    <${TakeCard} thumb=${{ src: "/api/view/t2", alt: "", making: true }} title=${HOSTILE} state="Being made" onPick=${() => { pressed = 2; }} />
  <//>`;
  const root = await mount(Takes, {});
  assert.equal(elements(root).filter((e) => e.getAttribute("role") === "radiogroup").length, 0);
  assert.equal(elements(root).filter((e) => e.getAttribute("role") === "group").length, 1);
  const takes = byClass(root, "k-take");
  assert.ok(takes.every((t) => t.localName === "button"));
  assert.deepEqual(takes.map((t) => t.getAttribute("aria-pressed")), ["true", "false"]);
  assert.equal(byClass(root, "k-take__thumb--making").length, 1);
  assert.ok(texts(root).includes(HOSTILE));
  fire(takes[1], "click");
  assert.equal(pressed, 2);
  unmount(root);
});

test("strip.css: the chosen card is lifted with an accent edge, cards are 96 px with 16 px padding, stacked below 860 px", () => {
  const sheet = css("kit/strip.css");
  assert.match(sheet, /\.k-opt \{[^}]*min-height: 96px;[^}]*padding: var\(--s-4\);[^}]*border-radius: var\(--r-3\)/);
  assert.match(sheet, /\.k-opt--on \{[^}]*border-color: var\(--accent\);[^}]*background: var\(--raise\);[^}]*box-shadow: 0 0 0 1px var\(--accent\)/);
  assert.match(sheet, /\.k-take__thumb \{\s*width: 96px;\s*height: 54px;/);
  assert.match(sheet, /\.k-strip__thumb \{[^}]*width: 72px;[^}]*height: 48px;/);
  assert.match(sheet, /@media \(max-width: 859px\)[\s\S]*\.k-strip \{\s*flex-direction: column;/);
  assert.doesNotMatch(sheet, /backdrop-filter/);
});

ROOTS.strip = "k-strip";
newSheetTest("strip");
