// The staged way of working (CONTRACTS-V2 15, 16.2): the parsers, with every vector of the 16.2 table.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MARKERS, ROUND_CAP, SIZES, buildText, parseBrief, parseCheck, parseDoc, parsePlan, parseSummary,
  roundsOf, sizeOf, stagesOf, textOf, unclearOf,
} from "../lib/staged.mjs";

const CHECK = `VERDICT: FAIL - the walk tag points past the last frame
# Check: round 1
## Questions
1. Does the work do what the brief asked? YES - four frames of a walk cycle
   evidence: art/walker/walker-sheet.png
2. Is every must-have met? NO - the tag "walk" runs to frame 4 but the sheet has frames 0 to 3
   evidence: art/walker/walker.json, art/walker/manifest.json
3. Is everything the plan said would be produced there? YES - sheet, data file, GIF, manifest
4. Are the facts, figures and names right, with nothing invented? YES - sizes match the manifest
5. Is it free of anything sent, published or made final without the owner? YES - files only
6. Could the owner use it as it is? NO - the animation would break at the last frame
## Actions
- Set the tag "walk" to frames 0 to 3.
## Anything unclear
None.
Verdict: FAIL`;

const PASS_CHECK = `VERDICT: PASS - the walk cycle is right
# Check: round 2
## Questions
1. Does the work do what the brief asked? YES - four frames
2. Is every must-have met? YES - all four
3. Is everything the plan said would be produced there? YES - sheet, data file, GIF
4. Do the exported frames equal the tagged frame ranges? YES - walk is 0 to 3
5. Is it free of anything sent, published or made final without the owner? YES - files only
6. Could the owner use it as it is? YES - it plays
## Actions
None.
## Anything unclear
Verdict: PASS`;

const BRIEF = `# Brief: Make a walking sprite for the mascot
## The goal in the owner's words
Make a walking sprite for the mascot.
## What done looks like
Four frames that loop.
## Must-haves
- 16 by 16 pixels
- a tag called walk
## Nice-to-haves
- a GIF
## Anything unclear
None.
`;

const PLAN = `# Plan: Make a walking sprite for the mascot
## Approach
Draw the frames by script, then check them.
## What will be produced
A sheet, a data file and a GIF.
## Steps
1. Draw the frames - Artist
   needs: nothing
2. Export the sheet and the GIF - Artist
## Anything unclear
None.
`;

const SUMMARY = `# Summary: Make a walking sprite for the mascot
## What was done
The Artist drew four frames.
## Files
- art/walker/walker-sheet.png: the sheet
## What is left
Nothing.
`;

const dropLine = (text, re) => text.split("\n").filter((l) => !re.test(l)).join("\n");

// ---- the vectors of 16.2 ----

test("vector: the check of 15.5", () => {
  const c = parseCheck(CHECK);
  assert.equal(c.outcome, "fail");
  assert.equal(c.reason, "the walk tag points past the last frame");
  assert.equal(c.round, 1);
  assert.equal(c.checks.length, 6);
  assert.deepEqual(c.checks.map((x) => x.n), [1, 2, 3, 4, 5, 6]);
  assert.equal(c.checks[1].answer, "no");
  assert.deepEqual(c.checks[1].evidence, ["art/walker/walker.json", "art/walker/manifest.json"]);
  assert.deepEqual(c.checks[0], {
    n: 1, question: "Does the work do what the brief asked?", answer: "yes",
    reason: "four frames of a walk cycle", evidence: ["art/walker/walker-sheet.png"],
  });
  assert.deepEqual(c.checks[2].evidence, []);
  assert.deepEqual(c.actions, ['Set the tag "walk" to frames 0 to 3.']);
  assert.deepEqual(c.unclear, []);
  assert.equal(c.wellFormed, true);
  assert.deepEqual(c.problems, []);
  assert.deepEqual(Object.keys(c).sort(),
    ["actions", "checks", "outcome", "problems", "reason", "round", "unclear", "wellFormed"]);
});

test("vector: an old-style one-line verdict is a round with no checks", () => {
  const c = parseCheck("VERDICT: PASS - all good");
  assert.equal(c.outcome, "pass");
  assert.equal(c.reason, "all good");
  assert.deepEqual(c.checks, []);
  assert.equal(c.wellFormed, false);
  assert.equal(c.problems.length, 1);
});

test("vector: the check with question 4 removed", () => {
  const c = parseCheck(dropLine(CHECK, /^4\./));
  assert.equal(c.wellFormed, false);
  assert.equal(c.checks.length, 5);
  assert.ok(c.problems.some((p) => /Question 4\b/.test(p)), c.problems.join("|"));
});

test("vector: first line PASS, last line Verdict: FAIL", () => {
  const c = parseCheck(PASS_CHECK.replace(/Verdict: PASS$/, "Verdict: FAIL"));
  assert.equal(c.outcome, "pass");
  assert.equal(c.wellFormed, false);
  assert.ok(c.problems.some((p) => /last line says FAIL/.test(p)));
});

test("vector: Anything unclear with None. is empty", () => {
  assert.deepEqual(unclearOf(parseDoc("## Anything unclear\nNone.").sections), []);
});

test("vector: Anything unclear with two dashed questions", () => {
  assert.deepEqual(unclearOf(parseDoc("## Anything unclear\n- Which city?\n- What budget?").sections),
    ["Which city?", "What budget?"]);
});

test("vector: a plan step with its needs line", () => {
  const p = parsePlan("# Plan: X\n## Steps\n1. Draw the frames - Artist\n   needs: nothing\n");
  assert.deepEqual(p.steps[0], { n: 1, text: "Draw the frames", who: "Artist", needs: "nothing" });
});

test("vector: buildText and textOf give the three values back", () => {
  const d = buildText({ text: "Do X", to: "Marketer", planFirst: true });
  assert.equal(d, "FOR: Marketer\nDo X\n\nPLAN FIRST");
  assert.deepEqual(textOf(d), { text: "Do X", planFirst: true, for: "Marketer", routine: null });
});

test("vector: sizeOf takes the newest SIZE line", () => {
  assert.equal(sizeOf(["hello", "SIZE: M - two agents", "SIZE: L - grew"]), "L");
});

test("vector: size S, no files, a PASS round, done", () => {
  const st = stagesOf({ size: "S", has: {}, steps: [{ status: "done" }], rounds: [parseCheck(PASS_CHECK)], status: "done" });
  assert.deepEqual(st.map((x) => [x.id, x.state]),
    [["brief", "skipped"], ["plan", "skipped"], ["work", "done"], ["summary", "skipped"], ["check", "done"]]);
  assert.deepEqual(st.map((x) => x.label), ["Brief", "Plan", "Work", "Summary", "Check"]);
});

test("vector: size M, brief and plan present, one step in progress", () => {
  const st = stagesOf({ size: "M", has: { brief: true, plan: true, summary: false }, steps: [{ status: "in_progress" }], rounds: [], status: "in_progress" });
  assert.deepEqual(st.map((x) => [x.id, x.state]),
    [["brief", "done"], ["plan", "done"], ["work", "current"], ["summary", "waiting"], ["check", "waiting"]]);
});

test("vector: slow patterns return within 200 ms", () => {
  const hashes = "#".repeat(200000);
  const ones = Array(50000).fill("1. ? YES -").join("\n");
  const inputs = [hashes, ones, `VERDICT: FAIL - x\n# Check: round 1\n## Questions\n${ones}`, `## Steps\n${ones}`,
    `## Anything unclear\n${ones}`, `1. ${" ".repeat(900000)}- x`, `## Questions\n1. ${"? ".repeat(400000)}YES -`,
    `## Steps\n1. ${" - ".repeat(300000)}`];
  for (const input of inputs) {
    for (const fn of [parseDoc, parseBrief, parsePlan, parseSummary, parseCheck, textOf, (x) => sizeOf([x]), (x) => roundsOf([x])]) {
      const t0 = performance.now();
      fn(input);
      const ms = performance.now() - t0;
      assert.ok(ms < 200, `${ms.toFixed(0)} ms for an input starting ${JSON.stringify(input.slice(0, 20))}`);
    }
  }
});

// ---- every document of section 15 into its pinned shape ----

test("the brief: title, sections, unclear and missing", () => {
  const b = parseBrief(BRIEF);
  assert.equal(b.title, "Brief: Make a walking sprite for the mascot");
  assert.deepEqual(b.sections.map((s) => s.heading),
    ["The goal in the owner's words", "What done looks like", "Must-haves", "Nice-to-haves", "Anything unclear"]);
  assert.deepEqual(b.sections[2], { heading: "Must-haves", text: "- 16 by 16 pixels\n- a tag called walk" });
  assert.deepEqual(b.unclear, []);
  assert.deepEqual(b.missing, []);
  assert.deepEqual(Object.keys(b).sort(), ["missing", "sections", "title", "unclear"]);
  assert.deepEqual(parseBrief("# Brief: X\n## Must-haves\nA").missing,
    ["The goal in the owner's words", "What done looks like", "Nice-to-haves", "Anything unclear"]);
});

test("the plan: steps in order, needs only where written", () => {
  const p = parsePlan(PLAN);
  assert.equal(p.title, "Plan: Make a walking sprite for the mascot");
  assert.deepEqual(p.missing, []);
  assert.deepEqual(p.unclear, []);
  assert.deepEqual(p.steps, [
    { n: 1, text: "Draw the frames", who: "Artist", needs: "nothing" },
    { n: 2, text: "Export the sheet and the GIF", who: "Artist", needs: null },
  ]);
  assert.deepEqual(Object.keys(p).sort(), ["missing", "sections", "steps", "title", "unclear"]);
});

test("the summary: three sections and no unclear", () => {
  const s = parseSummary(SUMMARY);
  assert.equal(s.title, "Summary: Make a walking sprite for the mascot");
  assert.deepEqual(s.sections.map((x) => x.heading), ["What was done", "Files", "What is left"]);
  assert.equal(s.sections[1].text, "- art/walker/walker-sheet.png: the sheet");
  assert.deepEqual(s.missing, []);
  assert.deepEqual(s.unclear, []);
  assert.deepEqual(parseSummary("# Summary: X").missing, ["What was done", "Files", "What is left"]);
});

test("a well-formed PASS check", () => {
  const c = parseCheck(PASS_CHECK);
  assert.equal(c.outcome, "pass");
  assert.equal(c.round, 2);
  assert.equal(c.checks.every((x) => x.answer === "yes"), true);
  assert.equal(c.checks[3].question, "Do the exported frames equal the tagged frame ranges?");
  assert.deepEqual(c.actions, []);
  assert.deepEqual(c.unclear, []);
  assert.equal(c.wellFormed, true, c.problems.join("|"));
});

// ---- Anything unclear ----

test("Anything unclear: missing, blank, and every way of saying nothing", () => {
  assert.deepEqual(unclearOf(parseDoc("# X\n## Approach\nA").sections), []);
  assert.deepEqual(unclearOf(parseDoc("## Anything unclear\n\n   \n").sections), []);
  for (const word of ["None", "None.", "NONE", "Nothing", "nothing.", "No", "-", "N/A", "n/a", "- None."]) {
    assert.deepEqual(unclearOf(parseDoc(`## Anything unclear\n${word}\n`).sections), [], word);
  }
  assert.deepEqual(unclearOf("not sections"), []);
  assert.deepEqual(unclearOf([null, 1, { heading: "Anything unclear", text: 5 }]), []);
});

test("Anything unclear: plain lines are questions too, and a later section is not part of it", () => {
  const d = parseDoc("## Anything unclear\nWhich city?\n\n- What budget?\n## Approach\n- Not a question");
  assert.deepEqual(unclearOf(d.sections), ["Which city?", "What budget?"]);
  assert.deepEqual(parseBrief("# Brief: X\n## Anything unclear\n- Which city?\n- What budget?").unclear, ["Which city?", "What budget?"]);
});

test("Anything unclear in a check: questions, and the Verdict line is not one", () => {
  const c = parseCheck(CHECK.replace("None.", "- Is frame 4 meant to exist?"));
  assert.deepEqual(c.unclear, ["Is frame 4 meant to exist?"]);
  assert.equal(c.wellFormed, true);
  assert.deepEqual(unclearOf(parseDoc(CHECK).sections), []);
});

// ---- the check: questions, actions, verdict ----

test("check: a verdict that is not the last line", () => {
  const c = parseCheck(`${CHECK}\nThanks.`);
  assert.equal(c.outcome, "fail");
  assert.equal(c.wellFormed, false);
  assert.ok(c.problems.some((p) => /not the last line/.test(p)), c.problems.join("|"));
  assert.equal(parseCheck(`${CHECK}\n\n  \n`).wellFormed, true, "blank lines after it are fine");
});

test("check: a missing last verdict", () => {
  const c = parseCheck(dropLine(CHECK, /^Verdict:/));
  assert.equal(c.wellFormed, false);
  assert.equal(c.checks.length, 6);
  assert.ok(c.problems.some((p) => /is missing/.test(p)));
});

test("check: a missing first verdict gives no outcome", () => {
  const c = parseCheck(dropLine(CHECK, /^VERDICT:/));
  assert.equal(c.outcome, null);
  assert.equal(c.round, 1);
  assert.equal(c.checks.length, 6);
  assert.equal(c.wellFormed, false);
  assert.equal(parseCheck("VERDICT: PASSED - fine").outcome, null);
});

test("check: PASS needs six YES", () => {
  const c = parseCheck(PASS_CHECK.replace("YES - it plays", "NO - it does not play"));
  assert.equal(c.outcome, "pass");
  assert.equal(c.wellFormed, false);
  assert.ok(c.problems.some((p) => /question 6 is answered NO/.test(p)));
});

test("check: a malformed, a repeated and a seventh question are problems", () => {
  const c = parseCheck(CHECK
    .replace("3. Is everything the plan said would be produced there? YES", "3. Is everything there YES")
    .replace("6. Could", "5. Repeated? YES - again\n7. Extra? YES - x\n6. Could"));
  assert.equal(c.wellFormed, false);
  assert.deepEqual(c.checks.map((x) => x.n), [1, 2, 4, 5, 6]);
  assert.equal(c.checks[3].question, "Is it free of anything sent, published or made final without the owner?");
  assert.ok(c.problems.some((p) => /Question 3 is not written/.test(p)));
  assert.ok(c.problems.some((p) => /Question 5 appears more than once/.test(p)));
  assert.ok(c.problems.some((p) => /numbered 7/.test(p)));
});

test("check: several actions, and evidence in backticks", () => {
  const c = parseCheck(CHECK
    .replace("- Set the tag", "- Redraw frame 2.\n-   Set the tag")
    .replace("evidence: art/walker/walker-sheet.png", "evidence: `art/walker/walker-sheet.png`,  , art/a.png"));
  assert.deepEqual(c.actions, ["Redraw frame 2.", 'Set the tag "walk" to frames 0 to 3.']);
  assert.deepEqual(c.checks[0].evidence, ["art/walker/walker-sheet.png", "art/a.png"]);
});

test("check: Windows line ends read the same", () => {
  const c = parseCheck(CHECK.replace(/\n/g, "\r\n"));
  assert.equal(c.wellFormed, true, c.problems.join("|"));
  assert.equal(c.checks.length, 6);
});

// ---- headings inside code fences and lookalike headings ----

test("headings inside a code fence are text", () => {
  const d = parseDoc("# Brief: X\n## Must-haves\n```\n## Anything unclear\n- fake?\n```\n~~~~md\n# not a title\n## Steps\n~~~\n~~~~\n## Nice-to-haves\nB");
  assert.deepEqual(d.sections.map((s) => s.heading), ["Must-haves", "Nice-to-haves"]);
  assert.match(d.sections[0].text, /## Anything unclear/);
  assert.deepEqual(unclearOf(d.sections), []);
  const fencedTitle = parseDoc("```\n# Brief: fake\n```\n# Brief: real\n## A\n");
  assert.equal(fencedTitle.title, "Brief: real");
});

test("a fenced block in a check hides lookalike questions and a lookalike verdict", () => {
  const c = parseCheck(CHECK.replace("## Actions", "```\n## Actions\n- fake action\n7. Fake? YES - x\n```\n## Actions"));
  assert.deepEqual(c.actions, ['Set the tag "walk" to frames 0 to 3.']);
  assert.equal(c.wellFormed, true, c.problems.join("|"));
  const unclosed = parseCheck(CHECK.replace("## Questions", "```\n## Questions"));
  assert.equal(unclosed.checks.length, 0);
  assert.equal(unclosed.wellFormed, false);
});

test("lookalike headings are not the pinned ones", () => {
  const d = parseDoc("## Anything unclear?\n- a\n### Anything unclear\n- b\n ## Anything unclear\n- c\n##Anything unclear\n- d\n## anything unclear\n- e");
  assert.deepEqual(d.sections.map((s) => s.heading), ["Anything unclear?", "anything unclear"]);
  assert.deepEqual(unclearOf(d.sections), []);
  assert.ok(parseBrief("# Brief: X\n## Anything unclear?\n- a").missing.includes("Anything unclear"));
  const p = parsePlan("## steps\n1. Draw - Artist\n### Steps\n2. Paint - Artist");
  assert.deepEqual(p.steps, []);
  assert.deepEqual(parseCheck(CHECK.replace("## Questions", "### Questions")).checks, []);
});

// ---- markers ----

test("MARKERS, SIZES and ROUND_CAP", () => {
  assert.deepEqual(Object.values(MARKERS).sort(), ["ANSWER:", "FOR:", "PLAN ACCEPTED", "PLAN FIRST", "PLAN READY:",
    "RESULT:", "ROUTINE:", "SIZE:", "STOPPED:", "VERDICT:"]);
  assert.deepEqual(SIZES, ["XS", "S", "M", "L", "XL"]);
  assert.equal(ROUND_CAP, 5);
});

test("textOf and buildText: each marker alone, a routine, nothing", () => {
  assert.equal(buildText({ text: "  Do X  " }), "Do X");
  assert.equal(buildText({ text: "Do X", to: "Marketer" }), "FOR: Marketer\nDo X");
  assert.equal(buildText({ text: "Do X", planFirst: true }), "Do X\n\nPLAN FIRST");
  assert.equal(buildText({ text: "Do X", to: "Mark\neter" }), "FOR: Mark eter\nDo X");
  assert.deepEqual(textOf("Write the brief.\n\nROUTINE: daily-brief"), { text: "Write the brief.", planFirst: false, for: null, routine: "daily-brief" });
  assert.deepEqual(textOf("Do X\n\nPLAN FIRST\nROUTINE: weekly\n"), { text: "Do X", planFirst: true, for: null, routine: "weekly" });
  assert.deepEqual(textOf("Do X"), { text: "Do X", planFirst: false, for: null, routine: null });
  assert.deepEqual(textOf("Please PLAN FIRST here\nFOR: nobody"), { text: "Please PLAN FIRST here\nFOR: nobody", planFirst: false, for: null, routine: null });
  assert.deepEqual(textOf(undefined), { text: "", planFirst: false, for: null, routine: null });
});

test("sizeOf: board comments, the owner's lines and lookalikes", () => {
  const agent = (body) => ({ body, authorAgentId: "a1" });
  assert.equal(sizeOf([agent("SIZE: S - one agent"), { body: "SIZE: XL - from the owner", authorUserId: "u" }]), "S");
  assert.equal(sizeOf([agent("SIZE: XS - quick"), agent("I think SIZE: L")]), "XS");
  assert.equal(sizeOf([agent("SIZE: XXL - huge"), agent("size: M")]), null);
  assert.equal(sizeOf([agent("SIZE:M")]), "M");
  assert.equal(sizeOf([agent("SIZE: L\nmore")]), "L");
  assert.equal(sizeOf([]), null);
  assert.equal(sizeOf("SIZE: M"), null);
});

test("roundsOf: the n-th VERDICT comment is round n", () => {
  const comments = [
    { body: "SIZE: M - x", authorAgentId: "a" },
    { body: CHECK, authorAgentId: "c" },
    { body: "Fixed the tag.", authorAgentId: "a" },
    { body: "VERDICT: FAIL - still wrong", authorAgentId: "c" },
    { body: PASS_CHECK, authorAgentId: "c" },
  ];
  const r = roundsOf(comments);
  assert.deepEqual(r.map((x) => x.n), [1, 2, 3]);
  assert.equal(r[0].comment, comments[1]);
  assert.equal(r[0].wellFormed, true);
  assert.equal(r[1].wellFormed, false);
  assert.deepEqual(r[1].checks, []);
  assert.deepEqual(r.map((x) => x.outcome), ["fail", "fail", "pass"]);
  assert.equal(roundsOf(["VERDICT: PASS - ok", "not a verdict"]).length, 1);
});

test("stagesOf: the other states", () => {
  const states = (args) => stagesOf(args).map((x) => x.state);
  assert.deepEqual(states({ size: "L", has: {}, steps: [], rounds: [], status: "todo" }), ["current", "waiting", "waiting", "waiting", "waiting"]);
  assert.deepEqual(states({ size: "M", has: { brief: true }, steps: [], rounds: [], status: "in_progress" }), ["done", "current", "waiting", "waiting", "waiting"]);
  assert.deepEqual(states({ size: "M", has: { brief: true, plan: true }, steps: [{ status: "done" }], rounds: [], status: "in_progress" }), ["done", "done", "done", "current", "waiting"]);
  assert.deepEqual(states({ size: "M", has: { brief: true, plan: true, summary: true }, steps: [{ status: "done" }], rounds: [{ outcome: "fail" }], status: "in_progress" }), ["done", "done", "done", "done", "current"]);
  assert.deepEqual(states({ size: "XS", has: {}, steps: [{ status: "in_progress" }], rounds: [], status: "in_progress" }), ["skipped", "skipped", "current", "skipped", "waiting"]);
  assert.deepEqual(states({ size: "S", has: {}, steps: [{ status: "done" }], rounds: [], status: "in_progress" }), ["skipped", "skipped", "done", "skipped", "current"]);
  assert.deepEqual(states({ size: null, has: { brief: true }, steps: [], rounds: [], status: "blocked" }), ["done", "skipped", "current", "skipped", "waiting"]);
  assert.deepEqual(states({ size: "M", has: { brief: true, plan: true }, steps: [{ status: "done" }], rounds: [{ outcome: "pass" }], status: "in_progress" }), ["done", "done", "done", "skipped", "done"]);
  assert.deepEqual(states({}), ["skipped", "skipped", "current", "skipped", "waiting"]);
});

// ---- malformed and empty input never throws ----

test("malformed and empty input never throws", () => {
  const odd = [undefined, null, "", "   \n\n", 42, {}, [], "\0\0\0", "#", "##", "## ", "# \n## \n", "```", "~~~\n## A",
    "VERDICT:", "VERDICT: FAIL -", "﻿# Brief: X", "𐀀\uD800", "1.", "1. - -", "   evidence:", "Verdict: PASS",
    "x".repeat(1024 * 1024 + 10)];
  for (const v of odd) {
    for (const fn of [parseDoc, parseBrief, parsePlan, parseSummary, parseCheck, textOf]) assert.doesNotThrow(() => fn(v));
    assert.doesNotThrow(() => unclearOf(v));
    assert.doesNotThrow(() => sizeOf(v));
    assert.doesNotThrow(() => sizeOf([v]));
    assert.doesNotThrow(() => roundsOf([v]));
    assert.doesNotThrow(() => roundsOf(v));
    assert.doesNotThrow(() => buildText(v || undefined));
    assert.doesNotThrow(() => stagesOf(v || undefined));
  }
  assert.deepEqual(parseDoc(undefined), { title: null, sections: [] });
  assert.deepEqual(parseCheck(""), {
    outcome: null, reason: "", round: null, checks: [], actions: [], unclear: [], wellFormed: false, problems: ["The check is empty."],
  });
  assert.deepEqual(parsePlan(null).steps, []);
  assert.ok(parseCheck(`${CHECK}\n${"x".repeat(1024 * 1024)}`).problems.some((p) => /longer than 1 MB/.test(p)));
});

// ---- version 3 (CONTRACTS-V3 31.3, 33.2): the question marker and the job lines ----

const EXAMPLE_31_3 = `FOR: Sales
Write a proposal for the customer of the call write-up in the sub-folder STH-20 of your current working folder.

Read first, from the company's files: pricing/services.md, pricing/terms.md, packs/proposal.md.
Produce: proposal.md in the goal's sub-folder.
JOB: sales/proposal-from-a-call`;

test("vector: buildText with ask gives the words, a blank line and ASK", () => {
  assert.equal(buildText({ text: "Do we deliver?", ask: true }), "Do we deliver?\n\nASK");
  const t = textOf("Do we deliver?\n\nASK");
  assert.equal(t.text, "Do we deliver?");
  assert.equal(t.ask, true);
  assert.equal(t.job, null);
});

test("vector: textOf of the example of 31.3 gives back its first block and the job", () => {
  const t = textOf(EXAMPLE_31_3);
  assert.equal(t.text, "Write a proposal for the customer of the call write-up in the sub-folder STH-20 of your current working folder.");
  assert.equal(t.job, "sales/proposal-from-a-call");
  assert.equal(t.for, "Sales");
  assert.equal(t.ask, false);
  assert.equal(t.planFirst, false);
});

test("vector: an ASK line the owner typed stays in the built text, and textOf reports it (the record decides)", () => {
  const built = buildText({ text: "Tell me about deliveries.\nASK" });
  assert.equal(built, "Tell me about deliveries.\nASK");
  assert.ok(built.endsWith("\nASK"));
  assert.equal(textOf(built).ask, true);
});

test("buildText with reads, produces and job writes the lines of 31.3, must files first, JOB before PLAN FIRST", () => {
  const out = buildText({
    text: "Write it.", to: "Sales", planFirst: true, job: "sales/proposal-from-a-call", produces: ["proposal.md"],
    reads: [{ file: "packs/proposal.md", need: "helps" }, { file: "pricing/services.md", need: "must" }, { file: "pricing/terms.md", need: "must" }],
  });
  assert.equal(out, "FOR: Sales\nWrite it.\n\nRead first, from the company's files: pricing/services.md, pricing/terms.md, packs/proposal.md.\n"
    + "Produce: proposal.md in the goal's sub-folder.\nJOB: sales/proposal-from-a-call\n\nPLAN FIRST");
  const t = textOf(out);
  assert.deepEqual({ ...t }, { text: "Write it.", planFirst: true, for: "Sales", routine: null });
  assert.equal(t.job, "sales/proposal-from-a-call");
  assert.equal(buildText({ text: "Write it.", reads: [], produces: [], job: "" }), "Write it.", "empty additions add nothing");
  assert.equal(buildText({ text: "Write it.", produces: ["a.md", "b/*.md"] }), "Write it.\n\nProduce: a.md, b/*.md in the goal's sub-folder.");
});

test("textOf: Read first and Produce lines are taken out only above a JOB line", () => {
  const own = "My notes.\nProduce: a report in the goal's sub-folder.";
  assert.equal(textOf(own).text, own);
  assert.equal(textOf(own).job, null);
  assert.equal(textOf("Do X\nJOB: a/b\n\nASK\nPLAN FIRST").text, "Do X");
  const odd = textOf("JOB: one two");
  assert.equal(odd.job, null, "a JOB line with more than one word is not a job line");
});

test("MARKERS gains ASK and JOB:, not listed among the version 2 markers", () => {
  assert.equal(MARKERS.ask, "ASK");
  assert.equal(MARKERS.job, "JOB:");
  assert.ok(!Object.values(MARKERS).includes("ASK"));
});
