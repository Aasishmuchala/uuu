// The Brain section of Settings: the tidy-up switch (the owner's answer 1) shows the server's own words, capped as
// plain text, and only when the server sends them; it posts to its own route. Pure helpers and the source only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Section, { tidyOf } from "../../pages/settings-brain.js";
import { TIDY_WORDS } from "../../../server/routes/brain-door.mjs";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = readFileSync(join(PUBLIC, "pages", "settings-brain.js"), "utf8");

test("brain: the section is a component", () => {
  assert.equal(typeof Section, "function");
});

test("brain: the tidy-up switch takes the server's words, off and on", () => {
  assert.deepEqual(tidyOf({ tidy: { on: false, label: TIDY_WORDS.label, say: TIDY_WORDS.off } }),
    { on: false, label: "Agents may suggest tidy-ups", say: TIDY_WORDS.off });
  assert.deepEqual(tidyOf({ tidy: { on: true, label: TIDY_WORDS.label, say: TIDY_WORDS.on } }),
    { on: true, label: TIDY_WORDS.label, say: TIDY_WORDS.on });
});

test("brain: no tidy block (an older server) draws no row; odd values are plain and capped", () => {
  assert.equal(tidyOf({}), null);
  assert.equal(tidyOf(null), null);
  assert.equal(tidyOf({ tidy: "on" }), null);
  const odd = tidyOf({ tidy: { on: "yes", label: `a‮${"b".repeat(200)}`, say: `<b>x</b>\u0000${"y".repeat(900)}` } });
  assert.equal(odd.on, false, "only true is on");
  assert.equal(odd.label.length, 80);
  assert.ok(!odd.label.includes("‮"));
  assert.equal(odd.say.length, 400);
  assert.ok(odd.say.startsWith("<b>x</b>"), "kept as text, never as HTML");
});

test("brain: the switch posts to its own route and nothing is set as HTML", () => {
  assert.ok(SRC.includes('"/api/brain-door/tidy"'));
  assert.equal((SRC.match(/innerHTML|dangerouslySetInnerHTML/g) || []).length, 0);
});
