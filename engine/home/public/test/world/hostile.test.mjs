// Hostile text against the world's state (PLAN-3D section 3, T7): sceneOf holds none of the `hostile` fixture's text
// and drops the bad id. And a source check: no file under public/world/ writes HTML from a string or runs a string as
// code. The stage and the drawn studio this file also covered went with the 3D world (the owner chose photographs, 18
// Nov 2026); the photograph's stage has its own hostile checks (test/office-stage.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "..");
const WORLD = join(PUBLIC, "world");
const load = (f) => import(pathToFileURL(join(WORLD, f)).href);
const { worldState, sceneOf } = await load("state.js");
const F = await load("fixtures.js");

// The fixture's strings, and the recognisable cores of each (a cut string still carries its start).
const NEEDLES = [...F.HOSTILE.map((s) => s.slice(0, 12)), F.HOSTILE_ID, "alert(1)", "evil.example", "7*7"];

test("sceneOf holds none of the hostile strings, and drops the bad id", () => {
  const scene = sceneOf(worldState(F.hostile));
  const all = JSON.stringify(scene);
  for (const n of NEEDLES) assert.ok(!all.includes(n), `the scene holds no "${n}"`);
  assert.ok(!scene.rooms.some((r) => r.id === F.HOSTILE_ID));
});

// ---- the source check ----

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

test("no file under public/world/ writes HTML from a string or runs a string as code", () => {
  const files = filesUnder(WORLD).filter((f) => /\.(m?js|html)$/.test(f));
  assert.ok(files.some((f) => f.endsWith("state.js")) && files.some((f) => f.endsWith("words.js")), "the folder was read");
  const FORBIDDEN = ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "dangerouslySetInnerHTML", "eval(", "new Function"];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const word of FORBIDDEN) assert.ok(!src.includes(word), `${relative(PUBLIC, f)} holds "${word}"`);
  }
});
