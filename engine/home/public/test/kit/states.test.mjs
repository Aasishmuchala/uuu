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

test("a warning is a thin amber rule on a faint tint, 13 px, the server's words as sent; other tones are a plain sentence (corrections after round 3, 5)", () => {
  const words = "Renders and prompts you approve go to Runway, which may train its models on them.";
  const root = show(states.Notice, { tone: "warn", title: "Training.", children: words });
  assert.match(textOf(root), new RegExp(words.replace(/[.,]/g, "\\$&")), "the words are shown as sent");
  const c = css("kit/states.css");
  assert.match(c, /\.k-notice \{[^}]*font-size: var\(--fs-note\);/, "13 px words");
  assert.match(c, /\.k-notice--warn \{[^}]*border-left: 2px solid var\(--warn\);[^}]*background: color-mix\(in srgb, var\(--warn-bg\) 70%, transparent\);/, "the amber rule on a faint tint");
  assert.doesNotMatch(c, /\.k-notice--(warn|bad|ok) \{[^}]*border: 1px/, "no boxed callout");
  assert.match(c, /\.k-notice__title \{[^}]*display: inline;/, "the title runs on into its words, one line where it can be");
  assert.doesNotMatch(c, /\.k-notice--(info|ok|bad) \{[^}]*background/, "only the warning has a tint");
  assert.equal((c.match(/var\(--warn/g) || []).length, 3, "amber appears only in the warning's rule, tint and icon");
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
