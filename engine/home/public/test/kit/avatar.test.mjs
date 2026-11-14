// The kit's avatar (CONTRACTS-V2 13.1): the initials' vectors, and the stylesheet's rules. Split out of kit-a
// (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT } from "./_dom.mjs";
import { css, primitiveSheetTests } from "./_rules.mjs";

const kit = { avatar: await import(pathToFileURL(join(KIT, "avatar.js")).href) };

test("initials: the pinned vectors", () => {
  const { initials } = kit.avatar;
  assert.equal(initials("Chief of staff"), "CS");
  assert.equal(initials("Artist"), "A");
  assert.equal(initials(""), "?");
  assert.equal(initials(undefined), "?");
  assert.equal(initials("sales agent"), "SA");
});

test("an avatar is round with a hairline edge: no ring glow, no spaced initials", () => {
  const s = css("kit/avatar.css");
  const root = /\.k-avatar\s*\{([^}]*)\}/.exec(s)[1];
  assert.match(root, /border-radius: var\(--r-round\);/);
  assert.match(root, /box-shadow: inset 0 0 0 1px var\(--line\);/);
  for (const sh of s.matchAll(/box-shadow:\s*([^;]+);/g)) assert.doesNotMatch(sh[1], /\d+px \d+px [1-9]/, "no blurred shadow");
  assert.doesNotMatch(s, /letter-spacing/);
});

primitiveSheetTests("avatar");
