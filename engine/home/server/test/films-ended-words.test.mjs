// U19 fix 3: a film whose approval ran out names the service or services its clips actually used (Runway, Higgsfield,
// or both), as the spending confirm does, not "Runway" for every film. Pure: filmServices reads a film's batches and
// filmRow words the row; no files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filmRow, filmServices } from "../routes/films.mjs";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 18, 6, 0, 0);
const job = (model, state = "spent") => ({ model, end: { state } });
const batch = (jobs, shots = null) => ({ _: { jobs, shots } });
const goal = { id: "g1", status: "open" };
const film = (batches, services) => ({
  task: { id: "g1", identifier: "STH-1", title: "A film" }, batches: batches.map(() => ({ expiresAt: new Date(NOW - HOUR).toISOString(), approvedAt: new Date(NOW - 9 * 24 * HOUR).toISOString(), frozen: false })),
  shots: [], total: { spent: 100, budget: 300 }, problem: null, services,
});
const sentence = (services) => filmRow(goal, film([batch([])], services), NOW).problem;
const tail = (names) => `so nothing more can be made with ${names} for it.`;

test("filmServices: the service of each clip the film's jobs made, Runway first; released jobs made nothing", () => {
  assert.deepEqual(filmServices([batch([job("gen4_turbo")])]), ["runway"]);
  assert.deepEqual(filmServices([batch([job("hf.wan2_6")])]), ["higgsfield"]);
  assert.deepEqual(filmServices([batch([job("hf.wan2_6"), job("gen4_turbo")]), batch([job("hf.wan2_6")])]), ["runway", "higgsfield"]);
  assert.deepEqual(filmServices([batch([job("hf.wan2_6", "released"), job("gen4_turbo")])]), ["runway"], "a clip not started is not a service used");
});

test("filmServices: with no job yet, the models the newest batch approved; with nothing at all, Runway", () => {
  assert.deepEqual(filmServices([batch([], { s01: { model: "hf.wan2_6" } })]), ["higgsfield"]);
  assert.deepEqual(filmServices([batch([], null)]), ["runway"]);
  assert.deepEqual(filmServices([]), ["runway"]);
});

test("an ended film's row names the services its clips used", () => {
  assert.ok(sentence(["runway"]).endsWith(tail("Runway")), sentence(["runway"]));
  assert.ok(sentence(["higgsfield"]).endsWith(tail("Higgsfield")), sentence(["higgsfield"]));
  assert.ok(sentence(["runway", "higgsfield"]).endsWith(tail("Runway and Higgsfield")), sentence(["runway", "higgsfield"]));
  assert.match(sentence(["higgsfield"]), /^The approval of its cost ended on \d{1,2} [A-Z][a-z]{2} \d{4}, so nothing more can be made with Higgsfield for it\.$/);
  assert.ok(!/Runway/.test(sentence(["higgsfield"])), "never Runway for a Higgsfield film");
});
