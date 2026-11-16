// kit/index.js: it re-exports every module and exposes every pinned name. Split out of kit-a, kit-b and kit-c
// (T01 of PLAN-COOK); each group keeps its own tables, so its tests read as they did.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT } from "./_dom.mjs";
import { PRIMITIVES, COMPOSITE_MODULES, COMPOSITE_PINNED, NEW } from "./_fixtures.mjs";

// ---- kit-a: the primitives ----
{
  const PINNED = PRIMITIVES;
  const MODULES = Object.keys(PINNED);
  const COMPOSITES = COMPOSITE_MODULES;

  test("kit/index.js re-exports every primitive and composite module", () => {
    const src = readFileSync(join(KIT, "index.js"), "utf8");
    for (const m of [...MODULES, ...COMPOSITES]) assert.ok(src.includes(`export * from "./${m}.js";`), `index.js re-exports ${m}.js`);
  });

  const compositesReady = COMPOSITES.every((m) => existsSync(join(KIT, `${m}.js`)));
  test("kit/index.js loads and exposes every primitive name", { skip: compositesReady ? false : "the composites (V10) do not exist yet" }, async () => {
    const index = await import(pathToFileURL(join(KIT, "index.js")).href);
    for (const names of Object.values(PINNED)) for (const name of names) assert.ok(name in index, `index.js exports ${name}`);
  });
}

// ---- kit-b: the composites ----
{
  const PINNED = COMPOSITE_PINNED;
  const MODULES = Object.keys(PINNED);

  test("kit/index.js re-exports every composite name", async () => {
    const index = await import(join(KIT, "index.js"));
    for (const name of MODULES) for (const exp of PINNED[name]) assert.equal(typeof index[exp], "function", `index exports ${exp}`);
  });
}

// ---- kit-c: the V3 parts ----

test("kit/index.js re-exports the new modules and creature.js, and exposes every new name", async () => {
  const src = readFileSync(join(KIT, "index.js"), "utf8");
  for (const m of [...NEW, "creature"]) assert.ok(src.includes(`export * from "./${m}.js";`), `index.js re-exports ${m}.js`);
  const index = await import(pathToFileURL(join(KIT, "index.js")).href);
  for (const n of ["Creature", "Segmented", "JobStart", "JobRow", "HandoffTag", "StageMark", "WhyNot", "AnswerView", "Ring", "FormFields", "FilePicker"]) {
    assert.equal(typeof index[n], "function", `index.js exports ${n}`);
  }
});

// PLAN-3D-ALL U2: the room header, its picture's address, the lamp and paper.
test("kit/index.js re-exports room.js and sheet.js with their new names", async () => {
  const src = readFileSync(join(KIT, "index.js"), "utf8");
  for (const m of ["room", "sheet"]) assert.ok(src.includes(`export * from "./${m}.js";`), `index.js re-exports ${m}.js`);
  const index = await import(pathToFileURL(join(KIT, "index.js")).href);
  for (const n of ["RoomHeader", "glimpseFor", "glimpseSrc", "Lamp", "Sheet", "usePageHeader"]) assert.equal(typeof index[n], "function", `index.js exports ${n}`);
});
