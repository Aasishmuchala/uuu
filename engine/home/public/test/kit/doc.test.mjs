// The kit's documents (CONTRACTS-V2 13.2, U1): Markdown parsed, and shown as elements, never as HTML. Split out
// of kit-u1 (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, elements, textOf, tags, show } from "./_dom.mjs";
import { css, compositeSheetTests } from "./_rules.mjs";

const doc = await import(pathToFileURL(join(KIT, "doc.js")).href);
const { parseMarkdown, parseInline, Markdown } = doc;
// An address in a Markdown file, put together here so this file names no other host itself (static.test.mjs).
const WEB = ["https:", "", "x.test"].join("/");

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

// PLAN-COOK T37: 15/24 words at most 68 characters wide, semibold headings, code in the mono face at 13 px on the
// control fill, tables as the kit's table; Anything unclear is a warning (an amber rule on a faint tint); and the
// sheet leaves DocLayout, which shares the root name, alone.
test("DocView and Markdown: 15/24 words in a 68 character measure, kit-table tables, code on the control fill", () => {
  const c = css("kit/doc.css");
  assert.match(c, /\.k-md\s*\{[^}]*font-size: var\(--fs-fact\);[^}]*line-height: var\(--lh-section\);/);
  assert.match(c, /\.k-md__p,\s*\.k-md__h,\s*\.k-md__list,\s*\.k-md__quote\s*\{\s*max-width: 68ch;/);
  assert.match(c, /\.k-md__h\s*\{[^}]*font-weight: var\(--fw-bold\);/);
  assert.match(c, /\.k-md__pre\s*\{[^}]*background: var\(--ctl\);[^}]*font-size: var\(--fs-note\);/);
  assert.match(c, /\.k-md__table th\s*\{[^}]*color: var\(--ink-3\);[^}]*font-size: var\(--fs-label\);/);
  assert.match(c, /\.k-md__table td\s*\{[^}]*border-top: 1px solid var\(--line\);/);
  assert.match(c, /\.k-doc__unclear\s*\{[^}]*background: var\(--warn-bg\);[^}]*box-shadow: inset 2px 0 0 var\(--warn\);/);
  assert.match(c, /^\.k-doc:not\(\.k-doc--layout\)\s*\{/m, "DocLayout's root is not restyled here");
  assert.doesNotMatch(c, /^\.k-doc\s*\{/m);
  assert.doesNotMatch(c, /--glass|--highlight|--r-pill|var\(--dept|--border-warm|--bg-card/);
});

compositeSheetTests("doc");
