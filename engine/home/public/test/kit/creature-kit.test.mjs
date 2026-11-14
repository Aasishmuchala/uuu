// The kit's V3 gallery page, which shows the creatures and the V3 parts on the canvas. Split out of kit-c (T01 of
// PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KIT } from "./_dom.mjs";
import { NEW } from "./_fixtures.mjs";

test("gallery-c.html sits on the canvas, links the new sheets and has no inline script", () => {
  const page = readFileSync(join(KIT, "gallery-c.html"), "utf8");
  for (const s of ["../styles/tokens.css", "../styles/canvas.css", "../styles/creature.css", ...NEW.map((m) => `../styles/kit/${m}.css`)]) {
    assert.ok(page.includes(`href="${s}"`), `links ${s}`);
  }
  assert.match(page, /class="s-canvas" aria-hidden="true"/);
  assert.match(page, /<script src="\.\.\/lib\/theme-boot\.js"><\/script>/);
  assert.match(page, /<script type="module" src="\.\/gallery-c\.boot\.js"><\/script>/);
  for (const s of page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) assert.equal(s[1].trim(), "", "no inline script");
  assert.doesNotMatch(page, /\son[a-z]+\s*=/i, "no inline handler");
});
