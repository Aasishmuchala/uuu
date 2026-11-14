// The kit's avatar (CONTRACTS-V2 13.1): the initials' vectors, and the stylesheet's rules. Split out of kit-a
// (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT } from "./_dom.mjs";
import { primitiveSheetTests } from "./_rules.mjs";

const kit = { avatar: await import(pathToFileURL(join(KIT, "avatar.js")).href) };

test("initials: the pinned vectors", () => {
  const { initials } = kit.avatar;
  assert.equal(initials("Chief of staff"), "CS");
  assert.equal(initials("Artist"), "A");
  assert.equal(initials(""), "?");
  assert.equal(initials(undefined), "?");
  assert.equal(initials("sales agent"), "SA");
});

primitiveSheetTests("avatar");
