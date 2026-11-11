// An agent's page: the pure helpers, fed with the contract's shape files as sample data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const shape = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../server/test/shapes/${name}.json`, import.meta.url)), "utf8"));
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

test("agent: the composer offers only the department's ready-made goals", () => {
  const gallery = shape("gallery");
  const { agent } = shape("agent");
  assert.deepEqual(page.goalsFor(gallery, agent), []);
  const books = page.goalsFor(gallery, { ...agent, slug: "bookkeeper", department: "books" });
  assert.equal(books.length, 1);
  assert.equal(books[0].id, "books/draft-an-invoice");
  const general = { departments: [{ id: "general", title: "Company", goals: [{ id: "general/x" }] }, ...gallery.departments] };
  assert.deepEqual(page.goalsFor(general, { slug: "builder", department: null }).map((g) => g.id), ["general/x"]);
  assert.deepEqual(page.goalsFor(null, agent), []);
});

test("agent: a task handed here names the agent, except the Chief of staff", () => {
  assert.deepEqual(page.goalBody({ text: "Draw a cat.", planFirst: false }, "artist"), { text: "Draw a cat.", to: "artist" });
  assert.deepEqual(page.goalBody({ text: "Plan it.", planFirst: true, template: "books/draft-an-invoice" }, "bookkeeper"),
    { text: "Plan it.", to: "bookkeeper", planFirst: true, template: "books/draft-an-invoice" });
  assert.deepEqual(page.goalBody({ text: "Sort it out." }, "chief-of-staff"), { text: "Sort it out." });
  assert.equal(page.composerPlaceholder("Artist"), "Hand Artist a task.  /  for ready-made goals");
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
