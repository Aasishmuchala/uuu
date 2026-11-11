// An agent's page: the pure helpers, fed with the contract's shape files as sample data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { existsSync as __ex } from "node:fs";
import { dirname as __dn, join as __jn } from "node:path";
import { fileURLToPath as __fp } from "node:url";
// The shape files sit beside the server, outside this tree: found by walking up from this file.
const SHAPES = (() => { let d = __dn(__fp(import.meta.url)); for (;;) { const c = __jn(d, "server", "test", "shapes"); if (__ex(c)) return c; const p = __dn(d); if (p === d) throw new Error("shape files not found"); d = p; } })();

const shape = (name) => JSON.parse(readFileSync(__jn(SHAPES, `${name}.json`), "utf8"));
const page = await import("../../pages/agent.js");

test("agent: the default export is a component", () => {
  assert.equal(typeof page.default, "function");
});

test("agent: the tab comes from the address, Talk by default", () => {
  const q = (s) => new URLSearchParams(s);
  assert.equal(page.pickTab(q("")), "talk");
  assert.equal(page.pickTab(q("tab=lessons")), "lessons");
  assert.equal(page.pickTab(q("tab=profile")), "profile");
  assert.equal(page.pickTab(q("tab=nonsense")), "talk");
  assert.equal(page.pickTab(undefined), "talk");
  assert.equal(page.tabHref("artist", "talk"), "#/team/artist");
  assert.equal(page.tabHref("artist", "work"), "#/team/artist?tab=work");
});

test("agent: the limits read as one sentence", () => {
  const { profile } = shape("agent");
  assert.equal(page.limitsSentence(profile.limits), "Works on one task at a time, for up to 15 minutes a run.");
  assert.equal(page.limitsSentence({ runMinutes: 1, oneAtATime: true }), "Works on one task at a time, for up to 1 minute a run.");
  assert.equal(page.limitsSentence({ oneAtATime: false, runMinutes: 30 }), "Works on more than one task at a time, for up to 30 minutes a run.");
  assert.equal(page.limitsSentence(null), "Works on one task at a time.");
});

test("agent: Pause or Resume, hidden when not set up", () => {
  const { agent } = shape("agent");
  assert.equal(page.pauseAction(agent), "pause");
  assert.equal(page.pauseAction({ ...agent, state: "paused" }), "resume");
  assert.equal(page.pauseAction({ ...agent, state: "problem" }), "resume");
  assert.equal(page.pauseAction({ ...agent, applied: false }), null);
  assert.equal(page.pauseAction(null), null);
});

test("agent: the composer offers the jobs of its department that this agent does, ready ones first", () => {
  const department = shape("department");
  assert.deepEqual(page.jobsFor(department, "artist").map((j) => j.id), ["sales/proposal-from-a-call"]);
  assert.deepEqual(page.jobsFor(department, "sales"), []);
  const studio = { clusters: [
    { id: "parts", jobs: [{ id: "studio/plate", who: [{ slug: "drafter" }], ready: true }] },
    { id: "pictures", jobs: [{ id: "studio/icons", who: [{ slug: "artist" }], ready: false }, { id: "studio/badge", who: ["artist"], ready: true }] },
  ] };
  assert.deepEqual(page.jobsFor(studio, "artist").map((j) => j.id), ["studio/badge", "studio/icons"]);
  assert.deepEqual(page.jobsFor(studio, "drafter").map((j) => j.id), ["studio/plate"]);
  const ops = { clusters: [{ id: "planning", jobs: [{ id: "operations/week", who: [], ready: true }, { id: "operations/doc", who: [{ slug: "builder" }], ready: true }] }] };
  assert.deepEqual(page.jobsFor(ops, "chief-of-staff").map((j) => j.id), ["operations/week"], "the Chief of staff plans the jobs nobody is named for");
  assert.deepEqual(page.jobsFor(ops, "builder").map((j) => j.id), ["operations/doc"]);
  assert.deepEqual(page.jobsFor(null, "artist"), []);
});

test("agent: the department chip names the map's department of this agent", async () => {
  const team = await import("../../pages/team.js");
  const map = shape("map");
  const who = map.departments[0].agents[0];
  assert.deepEqual(team.departmentOf(who.slug, map.departments), { id: map.departments[0].id, title: map.departments[0].title });
});

test("agent: a task handed here names the agent, except the Chief of staff", () => {
  assert.deepEqual(page.goalBody({ text: "Draw a cat.", planFirst: false }, "artist"), { text: "Draw a cat.", to: "artist" });
  assert.deepEqual(page.goalBody({ text: "Plan it.", planFirst: true, template: "books/draft-an-invoice" }, "bookkeeper"),
    { text: "Plan it.", to: "bookkeeper", planFirst: true, template: "books/draft-an-invoice" });
  assert.deepEqual(page.goalBody({ text: "Sort it out." }, "chief-of-staff"), { text: "Sort it out." });
  assert.equal(page.composerPlaceholder("Artist"), "Hand Artist a task.  /  for its jobs");
});

test("agent: a lesson is one line of 1 to 500 characters", () => {
  assert.equal(page.lessonProblem("Keep every frame the same size."), "");
  assert.notEqual(page.lessonProblem("   "), "");
  assert.notEqual(page.lessonProblem("two\nlines"), "");
  assert.notEqual(page.lessonProblem("a\u0007b"), "");
  assert.notEqual(page.lessonProblem("x".repeat(501)), "");
  assert.equal(page.lessonProblem("x".repeat(500)), "");
});

test("agent: a lesson's date is the calendar day only, with no clock time", () => {
  assert.equal(page.lessonDate("2026-11-10"), "10 Nov 2026");
  assert.equal(page.lessonDate("2026-01-05"), "5 Jan 2026");
  assert.equal(page.lessonDate(""), "");
  assert.equal(page.lessonDate(undefined), "");
  assert.doesNotMatch(page.lessonDate("2026-11-10"), /\d:\d/);
});
