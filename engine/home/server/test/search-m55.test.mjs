// M55 (M52 F6): search snippets carry the words without Markdown's marks, and a task started from a job shows the
// job's own summary rather than the text sent to the agent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { plainMarks, snippet } from "../lib/format.mjs";

test("plainMarks: headings, list marks, quotes, table rules and pipes, emphasis and code marks go; the words stay", () => {
  const md = "# Brand\n## Three to five words for how you sound\n- warm\n* plain\n> quoted\n| Name | Unit |\n|---|---|\n| Base | one |\n**bold** and `code`";
  const flat = plainMarks(md).replace(/\s+/g, " ").trim();
  assert.equal(flat, "Brand Three to five words for how you sound warm plain quoted Name · Unit Base · one bold and code");
  assert.equal(plainMarks("a # in the middle - and a dash"), "a # in the middle - and a dash");
});

test("snippet: a brand file reads as words, not as Markdown", () => {
  const s = snippet("# Brand\n\n## Three to five words for how you sound\n- warm\n- plain\n", ["warm"]);
  assert.ok(!/(^|\s)#|(^|\s)- /.test(s), s);
  assert.match(s, /warm plain/);
});

test("plainMarks: a long line of pipes and dashes is read quickly", () => {
  const line = `|${"---|".repeat(400)}x`;
  const t = Date.now();
  plainMarks(line);
  assert.ok(Date.now() - t < 200);
});
