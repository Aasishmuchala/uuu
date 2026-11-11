// lib/answer.mjs (CONTRACTS-V3 33.5): the pure parser of a question's answer file. It reads agent-written
// text, so it must accept anything, never throw, keep its limits and run in linear time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_SOURCES, MAX_TEXT, parseAnswer, parseSourceLine } from "../lib/answer.mjs";
import { vouch } from "../routes/ask.mjs";

const PINNED = `# Answer
Customers can return an unused item within 14 days for a full refund [1]. Custom orders cannot be returned [1][2].
## Sources
1. returns-policy.md - Returns
2. policies/custom-orders.md
## Not in the files
- When the policy last changed.
`;

test("the pinned example parses into its parts", () => {
  const a = parseAnswer(PINNED);
  assert.equal(a.wellFormed, true);
  assert.equal(a.text, "Customers can return an unused item within 14 days for a full refund [1]. Custom orders cannot be returned [1][2].");
  assert.deepEqual(a.sources, [
    { n: 1, path: "returns-policy.md", note: "Returns" },
    { n: 2, path: "policies/custom-orders.md", note: "" },
  ]);
  assert.deepEqual(a.notInFiles, ["When the policy last changed."]);
  assert.deepEqual(a.problems, []);
});

test("a file with no sources is still an answer, with no sources and a problem noted", () => {
  const a = parseAnswer("# Answer\nWe do not charge for delivery inside the city.\n## Not in the files\nNone.\n");
  assert.equal(a.wellFormed, true);
  assert.equal(a.text, "We do not charge for delivery inside the city.");
  assert.deepEqual(a.sources, []);
  assert.deepEqual(a.notInFiles, []);
  assert.ok(a.problems.some((p) => /Sources/.test(p)));
});

test("an empty Sources part gives no sources and no problem about it", () => {
  const a = parseAnswer("# Answer\nYes.\n## Sources\n\n## Not in the files\n- Nothing else.\n");
  assert.deepEqual(a.sources, []);
  assert.deepEqual(a.notInFiles, ["Nothing else."]);
  assert.equal(a.wellFormed, true);
});

test("13 sources: the first 12 are kept and the cut is noted", () => {
  const lines = Array.from({ length: 13 }, (_, i) => `${i + 1}. file-${i + 1}.md - note ${i + 1}`);
  const a = parseAnswer(`# Answer\nMany [1].\n## Sources\n${lines.join("\n")}\n`);
  assert.equal(a.sources.length, MAX_SOURCES);
  assert.equal(a.sources.length, 12);
  assert.deepEqual(a.sources.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.ok(a.problems.some((p) => /12/.test(p)));
});

test("a source path that is a trick is kept as words and is never found or linked", () => {
  const a = parseAnswer("# Answer\nSee [1][2][3].\n## Sources\n1. ../secrets - keys\n2. /etc/passwd\n3. returns-policy.md\n");
  assert.deepEqual(a.sources.map((s) => s.path), ["../secrets", "/etc/passwd", "returns-policy.md"]);
  const listed = new Map([["returns-policy.md", "cmV0dXJucy1wb2xpY3kubWQ"], ["secrets", "c2VjcmV0cw"]]);
  const out = vouch(a.sources, listed);
  assert.deepEqual(out[0], { n: 1, path: "../secrets", note: "keys", found: false, link: null });
  assert.deepEqual(out[1], { n: 2, path: "/etc/passwd", note: "", found: false, link: null });
  assert.deepEqual(out[2].link, { page: "files", id: "cmV0dXJucy1wb2xpY3kubWQ" });
  assert.equal(out[2].found, true);
});

test("no # Answer heading: not well formed, the whole file as plain text with no marks", () => {
  const a = parseAnswer("Customers can return items [1].\n## Sources\n1. returns-policy.md - Returns\n");
  assert.equal(a.wellFormed, false);
  assert.deepEqual(a.sources, []);
  assert.deepEqual(a.notInFiles, []);
  assert.ok(!/\[1\]/.test(a.text), a.text);
  assert.ok(!/#/.test(a.text), a.text);
  assert.ok(a.text.startsWith("Customers can return items"));
  assert.equal(a.problems.length, 1);
});

test("an empty answer under the heading is not well formed", () => {
  const a = parseAnswer("# Answer\n\n## Sources\n1. returns-policy.md\n");
  assert.equal(a.wellFormed, false);
  assert.deepEqual(a.sources, []);
});

test("60,000 [1] marks parse within 200 ms and the text is held to 8000 characters", () => {
  const big = `# Answer\n${"[1]".repeat(60000)}\n## Sources\n1. returns-policy.md\n`;
  const t0 = performance.now();
  const a = parseAnswer(big);
  const ms = performance.now() - t0;
  assert.ok(ms < 200, `took ${ms} ms`);
  assert.ok(a.text.length <= MAX_TEXT);
  assert.equal(a.wellFormed, true);
});

test("a long run of spaces in a source line stays linear", () => {
  const line = `1. a${" ".repeat(1990)}x`;
  const t0 = performance.now();
  for (let i = 0; i < 30; i += 1) parseAnswer(`# Answer\nA.\n## Sources\n${line}\n`);
  assert.ok(performance.now() - t0 < 200);
  assert.deepEqual(parseSourceLine("1. a     - "), { n: 1, path: "a     -", note: "" });
});

test("it never throws and reads anything that is not a string as empty", () => {
  for (const v of [undefined, null, 0, 42, {}, [], true, Symbol.iterator, () => 1, "\u0000", "#", "# Answer"]) {
    const a = parseAnswer(v);
    assert.equal(typeof a.text, "string");
    assert.equal(a.wellFormed, false);
    assert.ok(Array.isArray(a.sources) && Array.isArray(a.notInFiles) && Array.isArray(a.problems));
  }
});

test("only the first 64 KB are read", () => {
  const a = parseAnswer(`# Answer\nShort.\n${"x".repeat(70 * 1024)}\n## Sources\n1. returns-policy.md\n`);
  assert.deepEqual(a.sources, [], "the Sources part lies beyond 64 KB");
  assert.ok(a.text.length <= MAX_TEXT);
});

test("Windows line ends and a byte-order mark are read as plain lines", () => {
  const a = parseAnswer(`﻿${PINNED.replace(/\n/g, "\r\n")}`);
  assert.equal(a.wellFormed, true);
  assert.equal(a.sources.length, 2);
  assert.deepEqual(a.notInFiles, ["When the policy last changed."]);
});

test("headings inside a code fence are text, and only the exact headings count", () => {
  const a = parseAnswer("# Answer\nLook:\n```\n## Sources\n1. evil.md\n```\n### Sources\n## sources\n");
  assert.deepEqual(a.sources, []);
  assert.ok(a.text.includes("1. evil.md"));
  assert.ok(a.text.includes("### Sources"));
});

test("a number listed twice keeps the first; lines that are not sources are left out", () => {
  const a = parseAnswer("# Answer\nA [1].\n## Sources\n1. a.md - first\n1. b.md - second\nnot a source\n100. c.md\n");
  assert.deepEqual(a.sources, [{ n: 1, path: "a.md", note: "first" }]);
  assert.ok(a.problems.length >= 2);
});

test("the source line reader agrees with the pinned pattern", () => {
  const PATTERN = /^(\d{1,2})\.\s+(\S.*?)(?:\s+-\s+(.+))?$/;
  const lines = [
    "1. returns-policy.md - Returns", "2. policies/custom-orders.md", "3. a - b - c", "4. my file.md - a note",
    "12. x.md -note", "5. x.md\t-\tTabbed", "6.  spaced.md  -  note  ", "7. -", "8. a -- b", "9.x.md", "123. x", "1.", "1. ",
  ];
  for (const l of lines) {
    const m = PATTERN.exec(l);
    const got = parseSourceLine(l);
    if (!m) { assert.equal(got, null, l); continue; }
    assert.deepEqual(got, { n: Number(m[1]), path: m[2].trim(), note: (m[3] || "").trim() }, l);
  }
});

test("Not in the files keeps list items only, and None. means none", () => {
  const a = parseAnswer("# Answer\nA.\n## Sources\n1. a.md\n## Not in the files\n- One.\nloose words\n- Two.\n");
  assert.deepEqual(a.notInFiles, ["One.", "Two."]);
  assert.deepEqual(parseAnswer("# Answer\nA.\n## Not in the files\nNone.\n").notInFiles, []);
});
