// F1a item 1: text an agent wrote is capped (capText) before any pattern runs, so no comment, draft or
// description can hold the server for long. Each entry point gets every hostile 2 MiB input; each must finish in
// under 200 ms. Ordinary Markdown comes out as before (bench-v60b.test.mjs holds the older cases).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boardSeed, IDS } from "../../../test/stubs/seed.mjs";
import { capText, LINE_MAX, snippet, TEXT_MAX } from "../lib/format.mjs";
import { forgetComments } from "../lib/tasks.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { plainLines, plainSummary } from "../inbox/goals.mjs";
import { draftSummary } from "../inbox/content.mjs";

const MIB2 = 2 * 1024 * 1024;
const fill = (unit) => unit.repeat(Math.ceil(MIB2 / unit.length)).slice(0, MIB2);
const HOSTILE = {
  "runs of [": fill("["),
  "runs of [a](": fill("[a]("),
  "runs of ![": fill("!["),
  "runs of *": fill("*"),
  "runs of * and space": fill("* "),
  "runs of backticks": fill("`"),
  "runs of |": fill("|"),
  "runs of ~~ and **": fill("~~**__a"),
  "one 2 MiB line": fill("word "),
  "200,000 short lines": Array.from({ length: 200000 }, (_, i) => `[l${i}](`).join("\n"),
  "long lines of [": Array.from({ length: 1100 }, () => "[".repeat(1900)).join("\n"),
};
const LIMIT_MS = 200;

function timed(name, fn) {
  for (const [kind, input] of Object.entries(HOSTILE)) {
    const t = performance.now();
    fn(input);
    const ms = performance.now() - t;
    assert.ok(ms < LIMIT_MS, `${name}, ${kind}: ${ms.toFixed(0)} ms`);
  }
}

test("capText: short text unchanged; at most 16,000 characters and 2,000 per line", () => {
  for (const s of ["", "a", "a\nb\n", "x\r\ny", "y".repeat(LINE_MAX)]) assert.equal(capText(s), s);
  assert.equal(capText(undefined), "");
  const one = capText("z".repeat(LINE_MAX + 1));
  assert.equal(one.length, LINE_MAX);
  assert.ok(one.endsWith("…"));
  const many = capText(fill("abc\n"));
  assert.ok(many.length <= TEXT_MAX + 1, String(many.length));
  assert.ok(many.endsWith("…"));
  const wide = capText(Array.from({ length: 20 }, () => "w".repeat(5000)).join("\n"));
  assert.ok(wide.length <= TEXT_MAX + 1);
  for (const line of wide.split("\n")) assert.ok(line.length <= LINE_MAX);
});

test("plainSummary, plainLines, draftSummary, snippet: every hostile 2 MiB input under 200 ms", () => {
  timed("plainSummary", plainSummary);
  timed("plainLines", plainLines);
  timed("draftSummary", (body) => draftSummary({ title: "x", body }));
  timed("snippet", (t) => snippet(t, ["word"]));
});

test("ordinary Markdown comes out as before, links included", () => {
  assert.equal(plainSummary("See the [brief](http://x/y) and ![logo](a.png), then [a](b)[c](d)."), "See the brief and logo, then ac.");
  assert.equal(plainLines("- a [note](http://x)\n- **bold** and `code`"), "• a note\n• bold and code");
  assert.equal(plainSummary("## Done\n\nWrote ~~two~~ *three* files."), "Done. Wrote two three files.");
});

const startPages = () => startV2({ routes: ["inbox", "task", "team", "search"], inbox: ["goals", "content"], search: ["goals"], boardSeed: boardSeed() });

test("the server stays quick on hostile comments, drafts and descriptions (each read under 200 ms per item)", async () => {
  const h = await startPages();
  try {
    const sth2 = IDS.issues["STH-2"];
    const inputs = Object.values(HOSTILE);
    // a hostile result on the finished goal, from the Chief of staff, and hostile comments from the Marketer
    h.board.state.comments.push({ id: "c-hostile-result", issueId: sth2, body: `RESULT: ${HOSTILE["runs of ["]}`, authorAgentId: IDS.agents["chief-of-staff"], createdAt: "2026-11-12T09:00:00.000Z" });
    inputs.forEach((body, i) => h.board.state.comments.push({ id: `c-hostile-${i}`, issueId: sth2, body, authorAgentId: IDS.agents.marketer, createdAt: `2026-11-12T09:0${1 + (i % 9)}:00.000Z` }));
    const goal = h.board.state.issues.find((x) => x.id === sth2);
    goal.description = `launch ${HOSTILE["runs of [a]("]}`;
    const dir = join(h.state, "tasks", "company-work", "STH-2", "content");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "hostile.md"), `---\ntitle: Hostile\nchannel: post\nplanned: 2026-12-01\n---\n${HOSTILE["runs of ["]}\n`);
    forgetComments();
    const budget = LIMIT_MS * (inputs.length + 3);
    for (const path of ["/api/inbox", `/api/tasks/${sth2}`, "/api/team/marketer", "/api/search?q=launch"]) {
      const t = performance.now();
      const r = await call(h.url, "GET", path);
      const ms = performance.now() - t;
      assert.equal(r.status, 200, path);
      assert.ok(ms < budget, `${path}: ${ms.toFixed(0)} ms`);
    }
    const inbox = (await call(h.url, "GET", "/api/inbox")).json;
    assert.ok(inbox.items.some((i) => i.id === `goal:${sth2}`));
  } finally { await h.close(); }
});
