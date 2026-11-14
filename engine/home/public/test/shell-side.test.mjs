// The sidebar's automatic width and what the context says of the owner's choice (T95).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHELL = readFileSync(join(PUBLIC, "shell/app-shell.js"), "utf8");
const CONTEXT = readFileSync(join(PUBLIC, "lib/context.js"), "utf8");
const { sideMode } = await import(pathToFileURL(join(PUBLIC, "shell/sidenav.js")).href);
const context = await import(pathToFileURL(join(PUBLIC, "lib/context.js")).href);

test("the stage query names both a work stage and a layout page such as Settings", () => {
  const queries = SHELL.match(/main\.querySelector\([^)]*\)/g) || [];
  assert.deepEqual(queries, ['main.querySelector(".k-work, .k-doc--layout")']);
});

test("sideMode: the stored choice wins over the stage, for both values", () => {
  for (const stage of [true, false]) {
    assert.equal(sideMode({ stored: "open", stage, width: 1400 }), "open");
    assert.equal(sideMode({ stored: "icons", stage, width: 1400 }), "icons");
  }
  assert.equal(sideMode({ stored: null, stage: true, width: 1400 }), "icons");
  assert.equal(sideMode({ stored: null, stage: false, width: 1400 }), "open");
});

test("the context carries sideChoice, null for automatic, beside side and setSide", () => {
  assert.match(SHELL, /sideChoice: stored === "open" \|\| stored === "icons" \? stored : null,/);
  assert.match(CONTEXT, /sideChoice: null,/);
  assert.ok(context.AppContext, "the context module loads");
});
