// Routines page: its helpers are pure and are checked here; the page itself loads in Node.
import { test } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../../pages/routines.js");

test("routines: the page is a component", () => {
  assert.equal(typeof mod.default, "function");
});

test("routines: limitWords says the limit in words", () => {
  assert.equal(mod.limitWords(1), "1 minute");
  assert.equal(mod.limitWords(10), "10 minutes");
  assert.equal(mod.limitWords(60), "1 hour");
  assert.equal(mod.limitWords(90), "1 hour 30 minutes");
  assert.equal(mod.limitWords(120), "2 hours");
  assert.equal(mod.limitWords(null), "");
  assert.equal(mod.limitWords(0), "");
  assert.equal(mod.limitWords("soon"), "");
});

test("routines: runLine gives the state and the time", () => {
  assert.equal(mod.runLine(null), "");
  const line = mod.runLine({ at: "2020-01-05T03:30:00.000Z", plainState: "Finished", state: "finished" });
  assert.ok(line.startsWith("Finished, "), line);
  assert.equal(mod.runLine({ plainState: "Failed" }), "Failed");
});

test("routines: the page keeps its states and holds no address", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../pages/routines.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /https?:\/\//);
  assert.match(src, /NotConnected/);
  assert.match(src, /No routines yet/);
  assert.match(src, /Left out/);
});

test("routines: the last run is named by its task's title, never by a ref alone (M52 F7)", async () => {
  const m = await import("../../pages/routines.js");
  assert.equal(m.runLinkLabel({ taskId: "x", identifier: "STH-14", title: "Daily brief" }), "Daily brief");
  assert.equal(m.runLinkLabel({ taskId: "x", identifier: "STH-14" }), "Open the last run");
});
