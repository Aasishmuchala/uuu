// The kit's money part: moneyParts' vectors from section 4 of PLAN-COOK, the block, the meter and the sum.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, installDom, show as showFresh, byClass, textOf, classesOf } from "./_dom.mjs";
import { ROOTS, newSheetTest, css } from "./_rules.mjs";

installDom();
const mod = await import(pathToFileURL(join(KIT, "money.js")).href);
const { moneyParts, MoneyBlock, Meter, Sum } = mod;
const show = showFresh;

test("money.js loads in Node and exports its parts as functions", () => {
  for (const name of ["moneyParts", "MoneyBlock", "Meter", "Sum"]) assert.equal(typeof mod[name], "function", `${name} is a function`);
});

test("moneyParts: a treatment that goes over today's limit", () => {
  const p = moneyParts({ base: 185, most: 370, daily: 300, dayLeft: 100, monthly: 1000, monthLeft: 630 });
  assert.equal(p.figure, "$1.85");
  assert.equal(p.upTo, "$3.70");
  assert.equal(p.spent, "$2.00");
  assert.equal(p.limit, "$3.00");
  assert.equal(p.left, "$1.00");
  assert.equal(p.overBy, "$0.85");
  assert.equal(p.month, "$6.30 of $10.00");
  assert.deepEqual(p.shares, { spent: 51.9, fits: 26.0, over: 22.1 });
  assert.equal(p.tick, 77.9);
  assert.equal(p.blocked, true);
});

test("moneyParts: the pinned shape fits", () => {
  const p = moneyParts({ base: 150, most: 300, daily: 300, dayLeft: 260, monthly: 1000, monthLeft: 960 });
  assert.equal(p.figure, "$1.50");
  assert.equal(p.upTo, "$3.00");
  assert.equal(p.spent, "$0.40");
  assert.equal(p.left, "$2.60");
  assert.equal(p.overBy, null);
  assert.equal(p.month, "$9.60 of $10.00");
  assert.deepEqual(p.shares, { spent: 13.3, fits: 50.0, over: 0 });
  assert.equal(p.tick, 100);
  assert.equal(p.blocked, false);
});

test("moneyParts: nothing left today, no retake figure, no month", () => {
  const p = moneyParts({ base: 25, most: 25, daily: 300, dayLeft: 0 });
  assert.equal(p.left, "$0.00");
  assert.equal(p.overBy, "$0.25");
  assert.equal(p.upTo, null);
  assert.equal(p.month, null);
  assert.deepEqual(p.shares, { spent: 92.3, fits: 0, over: 7.7 });
  assert.equal(p.tick, 92.3);
});

test("moneyParts: numbers that cannot draw the meter give null", () => {
  for (const bad of [{ base: 150 }, {}, null, { base: "x", daily: 300, dayLeft: 1 }, { base: -1, daily: 300, dayLeft: 1 }]) {
    assert.equal(moneyParts(bad), null, JSON.stringify(bad));
  }
});

const OVER = moneyParts({ base: 185, most: 370, daily: 300, dayLeft: 100, monthly: 1000, monthLeft: 630 });

test("MoneyBlock: the label, the figure with about, up to, the meter and the rows", async () => {
  const root = await show(MoneyBlock, { label: "Treatment A costs", parts: OVER, overWords: "Over by" });
  const text = textOf(root);
  for (const w of ["Treatment A costs", "about", "$1.85", "up to $3.70", "$2.00 spent", "limit $3.00", "Over by", "$0.85", "Left today", "$1.00", "Left this month", "$6.30 of $10.00"]) assert.ok(text.includes(w), w);
  assert.equal(byClass(root, "k-money--over").length, 1);
  assert.equal(byClass(root, "k-money__row--bad").length, 1);
  assert.equal(byClass(root, "k-money__row--quiet").length, 1);
});

test("MoneyBlock: a treatment that fits has no over row and no over class", async () => {
  const fits = moneyParts({ base: 150, most: 150, daily: 300, dayLeft: 260 });
  const root = await show(MoneyBlock, { label: "Treatment C costs", parts: fits });
  assert.equal(byClass(root, "k-money--over").length, 0);
  assert.equal(byClass(root, "k-money__row--bad").length, 0);
  assert.equal(byClass(root, "k-money__upto").length, 0);
  assert.equal(byClass(root, "k-money__row--quiet").length, 0);
});

test("MoneyBlock: with parts null it shows only the server's sentences, one per line, as text", async () => {
  const root = await show(MoneyBlock, { label: "Cost", parts: null, words: ["About $1.50.", "<b>x</b> never markup"] });
  const lines = byClass(root, "k-money__say");
  assert.equal(lines.length, 2);
  assert.equal(textOf(lines[1]), "<b>x</b> never markup");
  assert.equal(byClass(root, "k-meter").length, 0);
  assert.equal(byClass(root, "k-money__figure").length, 0);
});

test("Meter: three parts, a tick, a legend, and an aria-label made of the legend's words", async () => {
  const root = await show(Meter, { shares: OVER.shares, tick: OVER.tick, legend: { spent: "$2.00 spent", limit: "limit $3.00" } });
  const meter = byClass(root, "k-meter")[0];
  assert.equal(meter.getAttribute("role"), "img");
  assert.equal(meter.getAttribute("aria-label"), "$2.00 spent, limit $3.00");
  for (const c of ["k-meter__spent", "k-meter__fits", "k-meter__over", "k-meter__tick"]) assert.equal(byClass(root, c).length, 1, c);
  assert.match(byClass(root, "k-meter__tick")[0].style.cssText, /left: calc\(77\.9% - 1\.56px\);/, "held inside the bar's ends");
  assert.match(byClass(root, "k-meter__spent")[0].style.cssText, /left: 0%; width: 51\.9%;/);
  // Fix round R5: this treatment from where spent ends, 2 px apart; the over part from the tick exactly, never before.
  assert.match(byClass(root, "k-meter__fits")[0].style.cssText, /left: calc\(51\.9% \+ 2px\); width: max\(0px, calc\(26% - 2px\)\);/);
  assert.match(byClass(root, "k-meter__over")[0].style.cssText, /^left: 77\.9%; width: 22\.1%;$/);
});

test("Fix round R5: a treatment that fits fills the bar to its limit at the end: no tick past the round end, the label ends at the end", async () => {
  const fits = moneyParts({ base: 185, most: 370, daily: 300, dayLeft: 260 });
  assert.equal(fits.tick, 100);
  assert.equal(mod.tickAtEnd(100), true);
  assert.equal(mod.tickAtEnd(77.9), false);
  assert.equal(mod.tickLeft(0), "calc(0% - 0px)");
  assert.equal(mod.tickLeft(100), "calc(100% - 2px)");
  const root = await show(Meter, { shares: fits.shares, tick: fits.tick, legend: { spent: "$0.40 spent", limit: "limit $3.00" } });
  assert.equal(byClass(root, "k-meter__tick").length, 0);
  const label = byClass(root, "k-meter__legend-limit")[0];
  assert.ok(classesOf(label).includes("k-meter__legend-limit--end"));
  assert.match(label.style.cssText, /left: 100%;/);
  assert.equal(byClass(root, "k-meter__over").length, 0, "nothing over");
});

test("Meter: the plain form is one part and has no tick", async () => {
  const root = await show(Meter, { plain: true, shares: { spent: 40 }, label: "$1.75 of $6.00" });
  assert.ok(classesOf(byClass(root, "k-meter")[0]).includes("k-meter--plain"));
  assert.equal(byClass(root, "k-meter__fill").length, 1);
  assert.equal(byClass(root, "k-meter__tick").length, 0);
  assert.equal(byClass(root, "k-meter")[0].getAttribute("aria-label"), "$1.75 of $6.00");
});

test("Sum: right-aligned values, and nothing for an empty value", async () => {
  const root = await show(Sum, { rows: [{ label: "Left today", value: "$1.00" }, { label: "Left this month", value: null }] });
  assert.equal(byClass(root, "k-money__row").length, 1);
  assert.match(css("kit/money.css"), /\.k-money__row dd \{[^}]*text-align: right/);
});

test("the figure is 40 px at 500 in tabular figures, the track is 6 px with round ends, the 2 px tick in the ink stands 2 px proud (fix rounds A3, R5)", () => {
  const c = css("kit/money.css");
  assert.match(c, /\.k-money__amount \{[^}]*var\(--fs-figure\)[^}]*font-weight: var\(--fw-medium\)/);
  assert.match(c, /\.k-money__figure \{[^}]*tabular-nums/);
  const tick = /\.k-meter__tick \{([^}]*)\}/.exec(c)[1];
  assert.match(tick, /top: -2px;/);
  assert.match(tick, /width: 2px;/);
  assert.match(tick, /height: 10px;/);
  assert.match(tick, /background: var\(--ink\);/);
  assert.doesNotMatch(tick, /margin-left/, "kit/money.js holds it inside the bar");
  assert.match(c, /\.k-meter__track \{[^}]*height: 6px; border-radius: 3px;[^}]*overflow: hidden;/);
  // "about", the amount and "up to" on one baseline, as one unit: nothing pushes "up to" to the far edge.
  assert.match(/\.k-money__figure \{([^}]*)\}/.exec(c)[1], /align-items: baseline;/);
  assert.doesNotMatch(/\.k-money__upto \{([^}]*)\}/.exec(c)[1], /margin[^;]*auto/);
});

test("Fix round R5: the limit's label stands at its tick: ending at it, or from it near the start; never past the bar's end", async () => {
  assert.equal(mod.limitAt(62), "k-meter__legend-limit--end", "it ends at the tick, never floats mid-bar");
  assert.equal(mod.limitAt(20), "k-meter__legend-limit--after");
  assert.equal(mod.limitAt(100), "k-meter__legend-limit--end", "never clipped at the right end");
  assert.equal(mod.limitAt(null), null);
  const root = await show(Meter, { shares: OVER.shares, tick: OVER.tick, legend: { spent: "$2.00 spent", limit: "limit $3.00" } });
  const label = byClass(root, "k-meter__legend-limit")[0];
  assert.ok(classesOf(label).includes("k-meter__legend-limit--end"));
  assert.match(label.style.cssText, /left: calc\(calc\(77\.9% - 1\.56px\) \+ 2px\);/, "its end on the tick's right edge");
  const c = css("kit/money.css");
  assert.match(/\.k-meter__legend-limit--end \{([^}]*)\}/.exec(c)[1], /transform: translateX\(-100%\);/);
  assert.doesNotMatch(/\.k-meter__legend-limit \{([^}]*)\}/.exec(c)[1], /translateX\(-50%\)/, "no longer centred under the tick");
});

test("Fix round A2 (T101): one problem colour, on figures only; the over row's words in the default ink; values in one weight", async () => {
  const c = css("kit/money.css");
  assert.match(c, /\.k-money__row--bad dt \{ color: var\(--ink\); \}/);
  assert.match(c, /\.k-money__row--bad dd \{ color: var\(--bad\); \}/);
  assert.doesNotMatch(c, /--warn/, "no second warning colour");
  assert.match(/\.k-meter__over \{([^}]*)\}/.exec(c)[1], /color-mix\(in srgb, var\(--bad\) \d+%, var\(--track\)\)/, "the over part a tint of the one danger hue, never full red");
  assert.doesNotMatch(c, /--bad-fill/, "one danger tone everywhere");
  assert.match(/\.k-meter__spent \{([^}]*)\}/.exec(c)[1], /var\(--spent\)/, "spent is neutral");
  assert.match(/\.k-meter__fits \{([^}]*)\}/.exec(c)[1], /var\(--accent-fg\)/, "this treatment is the accent");
  const weights = [...c.matchAll(/\.k-money__row dd \{[^}]*font-weight: ([^;]+);/g)].map((m) => m[1]);
  assert.deepEqual(weights, ["var(--fw-medium)"]);
  assert.doesNotMatch(c, /\.k-money__row--bad [^{]*\{[^}]*font-weight/, "the over row keeps the one weight");
  // The most it may cost sits on the figure's line.
  const root = await show(MoneyBlock, { label: "Treatment A costs", parts: OVER, overWords: "Over by" });
  const fig = byClass(root, "k-money__figure")[0];
  assert.match(textOf(fig), /about\$1\.85up to \$3\.70/);
});

ROOTS.money = "k-money";
newSheetTest("money");
