// What the page can give the world (PLAN-3D D3, D6, T6 f): canWorld, tierOf, stillOf, benchOn, from plain facts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const { canWorld, tierOf, stillOf, benchOn, PHONE_BELOW } = await import(pathToFileURL(join(HERE, "..", "..", "world", "support.js")).href);

test("tierOf: phone below 860 px, desktop from 860", () => {
  assert.equal(PHONE_BELOW, 860);
  assert.equal(tierOf(390), "phone");
  assert.equal(tierOf(859), "phone");
  assert.equal(tierOf(860), "desktop");
  assert.equal(tierOf(1280), "desktop");
  assert.equal(tierOf(NaN), "desktop");
  assert.equal(tierOf(undefined), "desktop");
});

test("canWorld: WebGL2, no world=off, no save-data", () => {
  assert.equal(canWorld({ webgl2: true, query: "" }), true);
  assert.equal(canWorld({ webgl2: true, query: "?world=off" }), false);
  assert.equal(canWorld({ webgl2: true, query: "&view=list&world=off" }), false);
  assert.equal(canWorld({ webgl2: true, query: "?world=offline" }), true);
  assert.equal(canWorld({ webgl2: false, query: "" }), false);
  assert.equal(canWorld({ webgl2: true, query: "", saveData: true }), false);
});

test("canWorld reads the page when it is not told: world=off in the address or the hash's query", () => {
  globalThis.WebGL2RenderingContext = function WebGL2RenderingContext() {};
  try {
    globalThis.location = { search: "", hash: "#/map" };
    assert.equal(canWorld(), true);
    globalThis.location = { search: "?world=off", hash: "#/map" };
    assert.equal(canWorld(), false);
    globalThis.location = { search: "", hash: "#/map?world=off" };
    assert.equal(canWorld(), false);
  } finally {
    delete globalThis.WebGL2RenderingContext;
    delete globalThis.location;
  }
  assert.equal(canWorld({ query: "" }), false, "no WebGL2 in Node");
});

test("stillOf: data-motion=off or the system's reduced motion", () => {
  assert.equal(stillOf({ motion: "off" }), true);
  assert.equal(stillOf({ motion: "on" }), false);
  assert.equal(stillOf({ reduced: true }), true);
  globalThis.document = { documentElement: { getAttribute: (k) => (k === "data-motion" ? "off" : null) } };
  try { assert.equal(stillOf(), true); } finally { delete globalThis.document; }
  globalThis.matchMedia = (q) => ({ matches: q === "(prefers-reduced-motion: reduce)" });
  try { assert.equal(stillOf(), true); } finally { delete globalThis.matchMedia; }
  assert.equal(stillOf(), false);
});

test("benchOn only with worldbench=1", () => {
  assert.equal(benchOn({ query: "?worldbench=1" }), true);
  assert.equal(benchOn({ query: "?a=1&worldbench=1&b=2" }), true);
  assert.equal(benchOn({ query: "?worldbench=10" }), false);
  assert.equal(benchOn({ query: "" }), false);
});
