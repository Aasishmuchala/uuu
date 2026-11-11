// V60c: search snippets start on a whole word without the FOR line; content draft summaries read plainly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { snippet } from "../lib/format.mjs";
import goalsSource from "../search/goals.mjs";

test("snippet: starts on a whole word, never mid-word", () => {
  const t = `${"word ".repeat(20)}Sales\nPlease record and qualify a new lead: Asha Rao (trial 2) of Rao Interiors (trial). ${"more ".repeat(40)}`;
  const out = snippet(t, ["asha"]);
  assert.match(out, /^…\S/);
  assert.doesNotMatch(out, /^…(s|ales|les) /);
  assert.ok(out.includes("Asha"));
  assert.equal(snippet("short text", ["x"]), "short text");
});

test("goals search: the snippet is the owner's words without the FOR line", async () => {
  const description = `FOR: Sales\n${"Please record and qualify a new lead: Asha Rao (trial 2) of Rao Interiors (trial). ".repeat(3)}`;
  const issues = [{ id: "g1", identifier: "STH-1", title: "Please record", description, projectId: "p", parentId: null, status: "todo" }];
  const ctx = {
    ids: () => ({ companyId: "c", projectId: "p", agents: {} }),
    board: { get: async () => issues },
  };
  const out = await goalsSource.search(ctx, "asha");
  assert.equal(out.length, 1);
  assert.doesNotMatch(out[0].snippet, /FOR:|^…s /);
  assert.match(out[0].snippet, /Please record|Asha Rao/);
});

test("content draft summary: no draft marking line, no repeated title, no Markdown", async () => {
  const { draftSummary } = await import("../inbox/content.mjs");
  const d = { title: "A warmer welcome is on its way", body: "DRAFT - not published, not sent\n\n# A warmer welcome is on its way\n\nIf you're **new** here, welcome.\n\n- Our warranty period is 27 months." };
  assert.equal(draftSummary(d), "If you're new here, welcome. Our warranty period is 27 months.");
  assert.equal(draftSummary({ title: "x", body: "" }), "");
});
