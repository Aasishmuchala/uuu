// The kit's check list and evidence (CONTRACTS-V2 13.2, U1). Split out of kit-b and kit-u1 (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KIT, walkVNode as walk } from "./_dom.mjs";
import { shape } from "./_fixtures.mjs";
import { compositeSheetTests } from "./_rules.mjs";

const load = (name) => import(join(KIT, `${name}.js`));

test("CheckList: a mark and a word for each check, and its evidence count", async () => {
  const { CheckList } = await load("checks");
  const checks = [
    { n: 1, question: "Does the work do what the brief asked?", answer: "yes", reason: "four frames", evidence: [shape("file-entry")] },
    { n: 2, question: "Is every must-have met?", answer: "no", reason: "the tag runs past", evidence: [] },
  ];
  const out = walk(CheckList({ checks, selected: 1, onSelect: () => {} }));
  assert.ok(out.classes.includes("k-checks"));
  assert.ok(out.text.includes("Passed") && out.text.includes("Failed"));
  assert.ok(out.text.includes("1 file") && out.text.includes("No evidence"));
  assert.ok(out.props.some((p) => p["aria-pressed"] === "true"));
});

test("Evidence shows a Markdown file through Markdown, another text file as it is", () => {
  const src = readFileSync(join(KIT, "checks.js"), "utf8");
  assert.match(src, /import \{ Markdown \} from "\.\/doc\.js"/);
  assert.match(src, /MARKDOWN_NAME\.test\(name\)/);
  assert.match(src, /<pre class="k-evidence__text u-mono">/);
});

compositeSheetTests("checks");
