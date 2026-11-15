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

test("an OptionCard with many boards draws one picture, the chosen board, with how many there are on its corner", async () => {
  installDom();
  let board = null;
  const boards = [0, 1, 2, 3, 4, 5].map((i) => ({ src: `/api/view/b${i}`, alt: "", label: `s0${i + 1}`, on: i === 2, onClick: () => { board = i; } }));
  const root = await mount(OptionCard, { checked: true, title: "A", boards });
  const imgs = elements(root).filter((e) => e.localName === "img");
  assert.deepEqual(imgs.map((e) => e.src ?? e.getAttribute("src")), ["/api/view/b2"], "one picture: the chosen board");
  assert.equal(byClass(root, "k-opt__count").length, 1);
  assert.equal(textOf(byClass(root, "k-opt__count")[0]), "6");
  assert.equal(byClass(root, "k-opt__board").length, 0, "no row of board buttons");
  assert.ok(!elements(root).some((e) => e.localName === "button"), "nothing pressable inside the radio");
  assert.match(radios(root)[0].getAttribute("class"), /\bk-opt--side\b/);
  fire(radios(root)[0], "click");
  assert.equal(board, null, "a board's onClick is harmless: the card never calls it");
  unmount(root);
  // None chosen: the first; one picture given as an object, not a list: drawn the same, with no count.
  const first = await mount(OptionCard, { title: "B", boards: boards.map((b) => ({ ...b, on: false })) });
  assert.deepEqual(elements(first).filter((e) => e.localName === "img").map((e) => e.src ?? e.getAttribute("src")), ["/api/view/b0"]);
  unmount(first);
  const single = await mount(OptionCard, { title: "C", boards: { src: "/api/view/one", alt: "" } });
  assert.deepEqual(elements(single).filter((e) => e.localName === "img").map((e) => e.src ?? e.getAttribute("src")), ["/api/view/one"]);
  assert.equal(byClass(single, "k-opt__count").length, 0);
  unmount(single);
});

// Fix round A3 (T117): the Artist's tool draws a band of words under every board; the server passes the picture's box.
test("cropOf reads a board's checked picture box as a crop, and anything else as none; cropVars sets it for the sheet", () => {
  assert.deepEqual(mod.cropOf({ box: [0, 0, 1280, 619], size: [1280, 720] }), { ratio: 2.0679, w: 100, h: 116.3166, x: 0, y: 0 });
  assert.deepEqual(mod.cropOf({ box: [0, 0, 720, 1101], size: [720, 1280] }), { ratio: 0.654, w: 100, h: 116.2579, x: 0, y: 0 }, "an upright film");
  for (const bad of [{ box: [0, 0, 1281, 619], size: [1280, 720] }, { box: [-1, 0, 1280, 619], size: [1280, 720] }, { box: ["0", "0", "1280", "619"], size: [1280, 720] },
    { box: "/etc/passwd", size: [1280, 720] }, { box: [0, 0, 1280, 359], size: [1280, 720] }, { box: [0, 0, 1280, 619.5], size: [1280, 720] },
    { box: [5, 0, 5, 619], size: [1280, 720] }, { box: [0, 0, 1280, 619], size: null }, { box: [0, 0, 1280, 619] }, null, {}]) {
    assert.equal(mod.cropOf(bad), null, JSON.stringify(bad));
  }
  assert.equal(mod.cropVars(mod.cropOf({ box: [0, 0, 1280, 619], size: [1280, 720] })),
    "--k-crop-r: 2.0679; --k-crop-w: 100%; --k-crop-h: 116.3166%; --k-crop-x: 0%; --k-crop-y: 0%;");
  assert.equal(mod.cropVars(null), undefined);
  assert.equal(mod.cropVars({ ratio: "2; background: url(x)", w: 1, h: 1, x: 0, y: 0 }), undefined, "numbers only");
});

test("an OptionCard draws a board with a crop as only its picture box, covering the 72 by 48; one without, whole", async () => {
  installDom();
  const crop = mod.cropOf({ box: [0, 0, 1280, 619], size: [1280, 720] });
  const root = await mount(OptionCard, { checked: true, title: "A", boards: [{ src: "/api/view/b0", alt: "", crop }] });
  const [thumb] = byClass(root, "k-opt__thumb");
  assert.match(thumb.getAttribute("class"), /\bk-strip__thumb--crop\b/);
  const style = `${thumb.getAttribute("style") || ""} ${(thumb.style && thumb.style.cssText) || ""}`;
  assert.match(style, /--k-crop-r: 2\.0679;/);
  const [inner] = byClass(thumb, "k-strip__crop");
  assert.ok(inner && elements(inner).some((e) => e.localName === "img"), "the picture inside the crop");
  unmount(root);
  const whole = await mount(OptionCard, { checked: true, title: "B", boards: [{ src: "/api/view/b1", alt: "" }] });
  const [t] = byClass(whole, "k-opt__thumb");
  assert.doesNotMatch(t.getAttribute("class"), /k-strip__thumb--crop/);
  assert.equal(byClass(t, "k-strip__crop").length, 0);
  unmount(whole);
  const sheet = css("kit/strip.css");
  const c = /\.k-strip__crop \{([^}]*)\}/.exec(sheet)[1];
  assert.match(c, /width: max\(100cqw, calc\(100cqh \* var\(--k-crop-r\)\)\);/, "the box covers the thumb");
  assert.match(/\.k-strip__thumb \.k-strip__crop img \{([^}]*)\}/.exec(sheet)[1], /height: var\(--k-crop-h\);/);
});

test("an OptionCard reads whole: the head across the card with the amount on the title's line, the sub and the chip beside the picture, then the reason", async () => {
  installDom();
  const root = await mount(Three, { chosen: "A", say: "a long reason that runs past one line in a card of 264 px" });
  const card = radios(root)[0];
  assert.equal(byClass(card, "k-opt__title")[0].getAttribute("title"), "A · Slow approach");
  assert.equal(byClass(card, "k-opt__sub")[0].getAttribute("title"), "30 s · 6 clips");
  // Head (radio, title, amount: fix round A3, the amount on the title's baseline), sub, state (the chip alone), then
  // the reason as its own line under both columns.
  const [head, sub, state] = byClass(card, "k-opt__line");
  assert.match(head.getAttribute("class"), /k-opt__line--head/);
  assert.equal(byClass(head, "k-opt__radio").length, 1);
  assert.equal(byClass(head, "k-opt__amount").length, 1, "the amount sits on the title's line");
  assert.equal(byClass(sub, "k-opt__amount").length, 0);
  assert.match(sub.getAttribute("class"), /k-opt__line--sub/);
  assert.match(state.getAttribute("class"), /k-opt__line--state/);
  assert.equal(byClass(state, "k-strip__chip").length, 1);
  assert.equal(byClass(state, "k-tag--bad").length, 1, "the chip is the kit's Tag in its tone (one chip system)");
  assert.equal(state.childNodes.length, 1, "the chip is alone on its line");
  const say = byClass(card, "k-opt__say")[0];
  assert.equal(say.parentNode, card, "the reason is the card's own line, not beside the chip");
  assert.equal(byClass(state, "k-opt__say").length, 0);
  // A reader hears the chip before the reason.
  assert.match(textOf(card), /Over today's limita long reason/);
  unmount(root);
});

test("fitTitle: the reason's full words go in its title only when they do not fit", () => {
  const el = (sw, cw, sh = 18, ch = 18) => {
    const at = {};
    return { scrollWidth: sw, clientWidth: cw, scrollHeight: sh, clientHeight: ch, at,
      setAttribute: (k, v) => { at[k] = v; }, removeAttribute: (k) => { delete at[k]; } };
  };
  const fits = el(200, 230);
  assert.equal(mod.fitTitle(fits, "52 of 70, meets the bar"), false);
  assert.equal(fits.at.title, undefined, "a reason that fits keeps no tooltip");
  const cut = el(400, 230);
  assert.equal(mod.fitTitle(cut, "52 of 70, meets the bar and calm on a phone"), true);
  assert.equal(cut.at.title, "52 of 70, meets the bar and calm on a phone");
  const two = el(230, 230, 54, 36);
  assert.equal(mod.fitTitle(two, "past two lines"), true, "past its two lines on a narrow window");
  cut.scrollWidth = 200;
  mod.fitTitle(cut, "52 of 70");
  assert.equal(cut.at.title, undefined, "the tooltip goes when the words fit again");
  assert.equal(mod.fitTitle(null, "x"), false);
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

test("strip.css: the chosen card is lifted with an accent edge, cards are 96 px at the least with 16 px padding, stacked below 860 px", () => {
  const sheet = css("kit/strip.css");
  assert.match(sheet, /\.k-opt \{[^}]*min-height: 96px;[^}]*padding: var\(--s-4\);[^}]*border-radius: var\(--r-3\)/);
  // Fix round A3: the head runs the card's width (the title whole, the amount on its line); the picture under it with the
  // sub and the chip beside it; the reason under both.
  assert.match(sheet, /\.k-opt--side \{[^}]*grid-template-columns: 72px minmax\(0, 1fr\);[^}]*"head head" "pic sub" "pic state" "say say"/);
  assert.match(sheet, /\.k-opt__line--head \{[^}]*align-items: baseline;/, "the amount on the title's baseline");
  assert.match(sheet, /\.k-opt__say::first-letter \{\s*text-transform: uppercase;/, "the reason starts with a capital at display");
  assert.match(sheet, /\.k-opt__say \{[^}]*min-height: calc\(2 \* var\(--lh-note\)\);/, "it holds two lines");
  assert.match(sheet, /\.k-opt__line--state \{[^}]*grid-area: state;[^}]*min-height: 20px;/);
  assert.doesNotMatch(sheet, /\.k-opt__line--state \.k-strip__chip \{[^}]*margin-left: auto/, "the chip sits at the left");
  assert.match(sheet, /\.k-opt__title \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;[^}]*font-size: var\(--fs-ui\);[^}]*font-weight: var\(--fw-bold\)/);
  assert.match(sheet, /\.k-opt \.k-opt__amount \{[^}]*font-size: var\(--fs-fact\);[^}]*font-weight: var\(--fw-bold\);[^}]*tabular-nums/);
  assert.match(sheet, /\.k-opt__say \{[^}]*grid-area: say;[^}]*-webkit-line-clamp: 2;[^}]*white-space: normal;[^}]*font-size: var\(--fs-note\);[^}]*color: var\(--ink-2\);/, "the reason reads on up to two lines at every width: a cut reason read as a fault to every critic");
  assert.doesNotMatch(sheet, /order: -1/, "the reason is drawn where it is heard, after the chip");
  // The chosen card: a 2 px accent ring (the edge and 1 px round it) on a faint accent fill.
  assert.match(sheet, /\.k-opt--on \{[^}]*border-color: var\(--accent\);[^}]*background: color-mix\(in srgb, var\(--accent\) \d+%, var\(--raise\)\);[^}]*box-shadow: 0 0 0 1px var\(--accent\)/);
  assert.doesNotMatch(sheet, /\.k-strip__chip--(good|warn|bad) \{/, "no chip colours of the strip's own: the kit's Tag draws them");
  assert.match(sheet, /\.k-take__thumb \{\s*width: 96px;\s*height: 54px;/);
  assert.match(sheet, /\.k-strip__thumb \{[^}]*width: 72px;[^}]*height: 48px;/);
  assert.match(sheet, /@media \(max-width: 859px\)[\s\S]*\.k-strip \{\s*flex-direction: column;/);
  assert.doesNotMatch(sheet, /backdrop-filter/);
});

ROOTS.strip = "k-strip";
newSheetTest("strip");
