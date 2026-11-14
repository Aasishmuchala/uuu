// The kit's task rows and cards (CONTRACTS-V2 13.2, V3 33.2, M50, M51, U1). Split out of kit-b, kit-m55 and
// kit-u1 (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, PUBLIC, elements, textOf, classOf, withClass, show, showNow, walkVNode as walk } from "./_dom.mjs";
import { shape } from "./_fixtures.mjs";
import { compositeSheetTests } from "./_rules.mjs";

const load = (name) => import(join(KIT, `${name}.js`));
const taskCard = await import(pathToFileURL(join(KIT, "task-card.js")).href);

test("TaskRow: one fact with the outcome, else the stage and state; the department named, never coloured; the date at the right; no chevron", async () => {
  const { TaskRow, rowLine } = await load("task-card");
  const card = shape("task-card");
  // Without the keys of 33.2 it still reads: the stage and the state in words.
  const plain = { ...card, outcome: undefined, job: undefined, department: undefined };
  assert.equal(rowLine(plain), [card.stage.label, Number(card.round) > 0 ? `Round ${card.round}` : null, card.plainState].filter(Boolean).join(" · "));
  const bare = walk(TaskRow({ task: plain }));
  assert.ok(bare.classes.includes("k-task-row__line") && bare.classes.includes("k-task-row__time") && bare.classes.includes("k-task-row__mark"));
  assert.ok(!bare.classes.includes("k-task-row__chevron") && !bare.classes.includes("k-task-row__who"), "R03: no chevron and no face on a row");
  assert.ok(!bare.classes.includes("k-task-row__dept"), "no department words without a department");
  assert.ok(bare.text.includes(rowLine(plain)));
  // With them: the outcome replaces the stage and state, the job is named, the department is named for screen readers.
  const full = { ...card, live: false, waitingForYou: false, outcome: "Proposal for Asha Kitchens, 3 pages.", job: { id: "sales/proposal-from-a-call", title: "Proposal from a call write-up" }, department: "sales" };
  assert.equal(rowLine(full), "Proposal for Asha Kitchens, 3 pages.");
  // The mark is a dot only, so waiting or working is said in words on the line.
  assert.equal(rowLine({ ...full, waitingForYou: true }), "Waiting for you · Proposal for Asha Kitchens, 3 pages.");
  assert.equal(rowLine({ live: true }), "Working");
  const out = walk(TaskRow({ task: full }));
  assert.ok(out.text.includes("Proposal for Asha Kitchens, 3 pages."));
  assert.ok(out.text.includes("Proposal from a call write-up"));
  assert.ok(out.props.some((p) => p["data-dept"] === "sales" && String(p.class).includes("k-task-row__dept") && String(p.class).includes("k-sr")));
  assert.ok(out.text.includes("Sales"), "the department is named for screen readers");
  // An unknown department is not drawn; a long outcome is cut to 140 characters on one line.
  assert.ok(!walk(TaskRow({ task: { ...full, department: "<b>x" } })).props.some((p) => "data-dept" in p));
  assert.equal(rowLine({ outcome: `a\n${"b".repeat(300)}` }).length, 140);
  assert.ok(!rowLine({ outcome: "one\ntwo" }).includes("\n"));
  // A Home "running" entry: its time is when it started.
  const home = shape("home").running[0];
  const live = walk(TaskRow({ task: home }));
  assert.ok(live.props.some((p) => p.datetime === home.since));
  assert.equal(rowLine({}), "");
});

test("TaskRow and TaskCard: pinned root classes, link, identifier, schedule chip and waiting mark", async () => {
  const { TaskRow, TaskCard, BoardColumn } = await load("task-card");
  const card = shape("task-card");
  const row = walk(TaskRow({ task: card }));
  assert.ok(row.classes.includes("k-task-row"));
  assert.ok(row.props.some((p) => p.href === `#/tasks/${card.id}`));
  assert.ok(row.text.includes("STH-8"));
  const home = shape("home").running[0];
  const live = walk(TaskRow({ task: home }));
  assert.ok(live.props.some((p) => p.href === `#/tasks/${home.taskId}`));
  assert.ok(live.text.includes("Working"), "a live row says so in words");
  const c = walk(TaskCard({ task: card }));
  assert.ok(c.classes.includes("k-task-card"));
  assert.ok(c.text.includes("Daily at 09:00"));
  assert.ok(c.text.includes("Waiting for you"));
  assert.ok(c.text.includes("M"));
  const col = walk(BoardColumn({ column: { id: "pending_review", label: "Pending review", count: 3 }, children: [] }));
  assert.ok(col.classes.includes("k-board-col"));
  assert.ok(col.text.includes("Pending review") && col.text.includes("3"));
});

// kit-m55 shows a part at once, with no wait for effects.
{
  const show = showNow;
  test("task rows: the name first and the ref quietly after; no raw marks; the job named once (M50 F3, F8, F15; M51 F8, F12)", () => {
    assert.equal(taskCard.rowLine({ outcome: "A full refund [1]. Custom orders cannot be returned [1][2]." }), "A full refund. Custom orders cannot be returned.");
    const root = show(taskCard.TaskRow, { task: { id: "t1", identifier: "STH-20", title: "Proposal from a call write-up: Asha", job: { title: "Proposal from a call write-up" }, outcome: "Sent." } });
    const top = withClass(root, "k-task-row__top")[0];
    assert.deepEqual(top.childNodes.map(classOf), ["k-task-row__title", "k-task-row__ref"]);
    assert.equal(withClass(root, "k-task-row__job").length, 0, "the job's name is left out when the title starts with it");
    const other = show(taskCard.TaskRow, { task: { id: "t2", identifier: "STH-21", title: "Asha's proposal", job: { title: "Proposal from a call write-up" } } });
    assert.equal(withClass(other, "k-task-row__job").length, 1);
    const card = show(taskCard.TaskCard, { task: { id: "t3", identifier: "STH-22", title: "Walk cycle", column: "done" } });
    assert.equal(withClass(withClass(card, "k-task-card__top")[0], "k-mono").length, 0, "the board card leads with its name");
    assert.equal(withClass(card, "k-task-card__ref").length, 1);
  });
}

test("TaskCard: Working sits in the bottom row with the date, never squeezed beside the identifier", async () => {
  const root = await show(taskCard.TaskCard, { task: {
    id: "t1", identifier: "STH-15", title: "Write three captions", column: "in_progress", live: true,
    who: { slug: "marketer", name: "Marketer" }, stage: { id: "work", label: "Work" }, stepsDone: 0, stepsTotal: 1,
    updatedAt: "2026-11-11T09:00:00.000Z",
  } });
  const top = elements(root).find((e) => classOf(e) === "k-task-card__top");
  const bottom = elements(root).find((e) => classOf(e) === "k-task-card__bottom");
  assert.ok(!textOf(top).includes("Working"));
  assert.ok(textOf(bottom).includes("Working"));
  const css = readFileSync(join(PUBLIC, "styles", "kit", "task-card.css"), "utf8");
  assert.ok(!/k-task-card__live[^}]*text-overflow/.test(css), "Working is never cut with an ellipsis");
});

// PLAN-COOK T37 (corrections after round 3, 1 and 5): a task that needs the owner says so with its amber glyph and
// its words; the warm tint and the amber outline are gone, and no department colour is drawn (O7).
test("task rows and cards: needs you is the glyph and the words, never a tint or an amber outline", () => {
  const sheet = readFileSync(join(PUBLIC, "styles", "kit", "task-card.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(sheet, /linear-gradient|--bg-warm|--warn-bg|--border-warm|--warn-line|--glass|--r-pill|var\(--dept/);
  assert.match(sheet, /\.k-task-row__mark--warn\s*\{\s*color: var\(--warn\);/);
  assert.match(sheet, /\.k-task-row__time\s*\{[^}]*text-align: right;[^}]*font-variant-numeric: tabular-nums;/);
  assert.match(sheet, /\.k-task-row\s*\{[^}]*min-height: 50px;/, "a 50 px row, 51 with its hairline (R03)");
  const row = showNow(taskCard.TaskRow, { task: { id: "t1", identifier: "STH-8", title: "Walk cycle", waitingForYou: true, column: "pending_review" } });
  assert.ok(withClass(row, "k-task-row__mark--warn").length === 1, "the amber glyph");
  assert.match(textOf(row), /Waiting for you/, "and the words");
  const card = showNow(taskCard.TaskCard, { task: { id: "t1", identifier: "STH-8", title: "Walk cycle", waitingForYou: true, column: "pending_review" } });
  assert.match(textOf(withClass(card, "k-task-card__bottom")[0]), /Waiting for you/);
  assert.equal(withClass(card, "k-st--warn").length, 1, "said as a state line with the warning glyph");
});

// PLAN-COOK T94: under a group headed "Needs you" a row does not repeat "Waiting for you" in its fact; the glyph and
// the accessible words stay.
test("TaskRow quiet=waiting: the fact leaves out 'Waiting for you'; the amber glyph and its words stay", () => {
  const out = "Proposal for Asha Kitchens, 3 pages.";
  const waiting = { id: "t1", identifier: "STH-8", title: "Walk cycle", column: "pending_review", waitingForYou: true, outcome: out };
  // Every existing call keeps its answer.
  assert.equal(taskCard.rowLine(waiting), `Waiting for you · ${out}`);
  assert.equal(taskCard.rowLine(waiting, undefined), `Waiting for you · ${out}`);
  // The quiet form: the outcome alone; no outcome gives the next fact or nothing, never a bare separator.
  assert.equal(taskCard.rowLine(waiting, "waiting"), out);
  assert.equal(taskCard.rowLine({ ...waiting, outcome: "" }, "waiting"), "Pending review", "the column's words are the next fact");
  assert.equal(taskCard.rowLine({ waitingForYou: true }, "waiting"), "", "nothing at all when there is nothing else");
  assert.equal(taskCard.rowLine({ ...waiting, outcome: "", stage: { label: "Check" }, round: 2 }, "waiting"), "Check · Round 2 · Pending review");
  assert.equal(taskCard.rowLine({ ...waiting, outcome: "", plainState: "Waiting for you" }, "waiting"), "");
  assert.ok(!/^\s*·|·\s*$/.test(taskCard.rowLine({ ...waiting, outcome: "", stage: { label: "Check" } }, "waiting")));
  // A working task still says Working; a task that does not wait is untouched.
  assert.equal(taskCard.rowLine({ live: true }, "waiting"), "Working");
  assert.equal(taskCard.rowLine({ outcome: out }, "waiting"), out);
  const row = showNow(taskCard.TaskRow, { task: waiting, quiet: "waiting" });
  assert.equal(withClass(row, "k-task-row__mark--warn").length, 1, "the amber glyph stays");
  assert.match(textOf(withClass(row, "k-task-row__mark")[0]), /Waiting for you/, "its words for a screen reader stay");
  assert.equal(textOf(withClass(row, "k-task-row__text")[0]), out, "the fact is the outcome alone");
  const loud = showNow(taskCard.TaskRow, { task: waiting });
  assert.equal(textOf(withClass(loud, "k-task-row__text")[0]), `Waiting for you · ${out}`);
});

// PLAN-COOK T94: below 860 px a row stays short.
test("task rows on a phone: two lines of name with the ref after it, one line of fact, the date on the first line, 44 px at least", () => {
  const css = readFileSync(join(PUBLIC, "styles", "kit", "task-card.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const phone = css.slice(css.indexOf("@media (max-width: 859px)"));
  assert.match(phone, /\.k-task-row\s*\{[^}]*min-height: 44px;/);
  assert.match(phone, /\.k-task-row__top\s*\{[^}]*-webkit-line-clamp: 2;[^}]*line-clamp: 2;/, "the name and its ref run on, cut after two lines");
  assert.match(phone, /\.k-task-row__title\s*\{[^}]*display: inline;/, "the name is inline so the ref follows its last word");
  assert.match(phone, /\.k-task-row__ref\s*\{[^}]*display: inline;/, "the ref stays inline");
  assert.match(phone, /\.k-task-row__line\s*\{[^}]*display: block;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/, "the fact is one line with an ellipsis");
  assert.doesNotMatch(phone, /\.k-task-row__line\s*\{[^}]*line-clamp: 2/);
  assert.match(phone, /\.k-task-row__time\s*\{[^}]*grid-row: 1;/, "the date stays at the right of the first line");
});

compositeSheetTests("task-card");
