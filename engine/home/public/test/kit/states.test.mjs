// The kit's states (CONTRACTS-V2 13.1): the error notice's one word, and the stylesheet's rules. Split out of
// kit-a and kit-m55 (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, elements, textOf, showNow as show } from "./_dom.mjs";
import { css, primitiveSheetTests } from "./_rules.mjs";

const states = await import(pathToFileURL(join(KIT, "states.js")).href);

test("one name for one button: the error notice says Try again (M51 F18, C3 25)", () => {
  const root = show(states.ErrorNotice, { error: new Error("The board did not answer."), onRetry() {} });
  assert.match(textOf(root), /Try again/);
  assert.doesNotMatch(textOf(root), /Retry/);
});

test("fix round B2: a warning or a problem is a hairline in its tone on a 6 percent tint, a 14 px icon, the body in the second ink, the server's words as sent; info and ok are a plain sentence", () => {
  const words = "Renders and prompts you approve go to Runway, which may train its models on them.";
  const root = show(states.Notice, { tone: "warn", title: "Training.", children: words });
  assert.match(textOf(root), new RegExp(words.replace(/[.,]/g, "\\$&")), "the words are shown as sent");
  assert.equal(elements(root).find((e) => e.localName === "svg").getAttribute("width"), "14", "a 14 px icon");
  const c = css("kit/states.css");
  assert.match(c, /\.k-notice \{[^}]*color: var\(--ink-2\);[^}]*font-size: var\(--fs-note\);/, "13 px words in the second ink");
  assert.match(c, /\.k-notice--warn,\s*\.k-notice--bad \{[^}]*border: 1px solid;[^}]*border-radius: var\(--r-2\);/, "a hairline round it, inset");
  assert.match(c, /\.k-notice--warn \{[^}]*border-color: var\(--warn-line\);[^}]*background: color-mix\(in srgb, var\(--warn\) 6%, transparent\);/, "the warn hairline on a 6 percent tint");
  assert.match(c, /\.k-notice--bad \{[^}]*background: color-mix\(in srgb, var\(--bad\) 6%, transparent\);/);
  assert.doesNotMatch(c, /border-left: 2px/, "no amber bar at the left: it read as a quote");
  assert.match(c, /\.k-notice__title \{[^}]*display: inline;/, "the title runs on into its words, one line where it can be");
  assert.doesNotMatch(c, /\.k-notice--(info|ok) \{[^}]*background/, "info and ok have no tint");
});

test("fix round B2: a notice's one action sits at its right; the error notice's Try again is a small ghost", () => {
  const root = show(states.Notice, { tone: "warn", title: "The relay is off.", action: "Open Health" });
  const box = elements(root).find((e) => /\bk-notice__actions\b/.test(e.getAttribute("class") || ""));
  assert.ok(box, "the action has its place");
  assert.equal(textOf(box), "Open Health");
  const err = show(states.ErrorNotice, { error: "No answer.", onRetry() {} });
  const b = elements(err).find((e) => e.localName === "button");
  assert.match(b.getAttribute("class"), /k-btn--ghost/);
  assert.match(b.getAttribute("class"), /k-btn--sm/);
});

test("empty is a 16 px icon, one sentence, one line and the way on; loading is hairline rows that rest when motion is off", () => {
  const root = show(states.Empty, { title: "No films yet.", text: "A film appears here when Studio makes one." });
  const svg = elements(root).find((e) => e.localName === "svg");
  assert.ok(svg, "an icon");
  assert.equal(svg.getAttribute("width"), "16");
  assert.match(textOf(root), /No films yet\.A film appears here/);
  const c = css("kit/states.css");
  assert.match(c, /\.k-empty__title \{[^}]*font-size: var\(--fs-fact\);/, "the sentence is 15 px");
  assert.doesNotMatch(c, /\.k-empty \{[^}]*(border|background)/, "no frame of its own");
  assert.match(c, /\.k-loading__line \{[^}]*border-bottom: 1px solid var\(--line\);[^}]*animation: k-loading-fade[^;]*;/);
});

test("T97: Empty inline is one left-aligned line (16 px icon, the sentence at 14 px, the way on) with no padding; the default is unchanged", () => {
  const root = show(states.Empty, { inline: true, icon: "film", title: "No films yet.", children: "Open Studio" });
  const box = elements(root).find((e) => /\bk-empty\b/.test(e.getAttribute("class") || ""));
  assert.match(box.getAttribute("class"), /^k-empty k-empty--inline$/);
  assert.equal(elements(root).find((e) => e.localName === "svg").getAttribute("width"), "16");
  assert.match(textOf(root), /^No films yet\.Open Studio$/);
  const plain = show(states.Empty, { title: "No films yet." });
  assert.equal(elements(plain).find((e) => /\bk-empty\b/.test(e.getAttribute("class") || "")).getAttribute("class"), "k-empty");
  const c = css("kit/states.css");
  const inline = /\.k-empty--inline \{([^}]*)\}/.exec(c)[1];
  assert.match(inline, /flex-direction: row;/);
  assert.match(inline, /padding: 0;/);
  assert.match(inline, /text-align: left;/);
  assert.match(inline, /font-size: var\(--fs-ui\);/);
  assert.match(/\.k-empty--inline \.k-empty__title \{([^}]*)\}/.exec(c)[1], /font-size: var\(--fs-ui\);/, "the sentence at 14 px");
  assert.match(/\.k-empty \{([^}]*)\}/.exec(c)[1], /padding: var\(--s-10\) var\(--s-6\);/, "the default keeps its 40 px");
});

primitiveSheetTests("states");
