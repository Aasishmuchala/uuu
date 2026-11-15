// The Needs you page's pure helpers: the department of an item (CONTRACTS-V3 26.4), the order, the filter chips.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const mod = await import("../../pages/needs-you.js");

const departments = [
  { id: "sales", title: "Sales", agents: [{ slug: "sales" }] },
  { id: "studio", title: "Studio", agents: [{ slug: "artist" }] },
  { id: "operations", title: "Operations", agents: [{ slug: "chief-of-staff" }, { slug: "checker" }] },
];
const item = (id, extra = {}) => ({ id, source: "goal", severity: "normal", when: "2026-11-11T09:00:00.000Z", ...extra });

test("needs-you: the page is a component", () => {
  assert.equal(typeof mod.default, "function");
});

test("needs-you: an item belongs to the department of its agent, else of its source, else to none", () => {
  assert.equal(mod.departmentOf(item("a", { agent: { slug: "artist" } }), departments), "studio");
  assert.equal(mod.departmentOf(item("b", { agent: { slug: "checker" } }), departments), "operations");
  assert.equal(mod.departmentOf(item("c", { source: "books" }), departments), "books");
  assert.equal(mod.departmentOf(item("d", { source: "customers" }), departments), "sales");
  assert.equal(mod.departmentOf(item("e", { source: "support" }), departments), "support");
  assert.equal(mod.departmentOf(item("f", { source: "board" }), departments), "");
  // The agent wins over the source; an unknown agent falls back to the source; no map falls back too.
  assert.equal(mod.departmentOf(item("g", { source: "marketing", agent: { slug: "artist" } }), departments), "studio");
  assert.equal(mod.departmentOf(item("h", { source: "books", agent: { slug: "nobody" } }), departments), "books");
  assert.equal(mod.departmentOf(item("i", { agent: { slug: "artist" } }), null), "");
  assert.equal(mod.departmentOf(null, departments), "");
  assert.equal(mod.departmentOf(item("j", { source: "constructor" }), departments), "");
});

test("needs-you: the home server's department wins (M50 F1): a task's result raised by the Chief of staff is filtered under its task's department", () => {
  assert.equal(mod.departmentOf(item("a", { agent: { slug: "chief-of-staff" }, department: "studio" }), departments), "studio");
  assert.equal(mod.departmentOf(item("b", { source: "books", department: null }), departments), "", "placed nowhere stays nowhere");
  assert.equal(mod.departmentOf(item("c", { department: "nonsense" }), departments), "");
  assert.equal(mod.departmentOf(item("d", { department: "books" }), null), "books", "no map needed");
});

test("needs-you: with the home server's departments, the chips add up to All for the seed of 20", () => {
  const where = ["operations", "operations", "operations", "marketing", "marketing", "books", "books", "books", "books", "people",
    "support", "operations", "studio", "operations", "operations", "studio", "marketing", "operations", "operations", "operations"];
  const items = where.map((d, i) => item(`i${i}`, { agent: { slug: "chief-of-staff" }, department: d }));
  const chips = mod.chipsFor(items, departments, "");
  assert.equal(chips[0].count, 20);
  assert.equal(chips.slice(1).reduce((n, c) => n + c.count, 0), 20, "every item is under one chip");
  for (const c of chips.slice(1)) assert.equal(mod.itemsFor(items, departments, c.id).length, c.count, c.id);
});

test("needs-you: urgent first, then newest; bad entries are dropped", () => {
  const out = mod.sortItems([
    item("old", { when: "2026-11-01T00:00:00Z" }),
    item("new", { when: "2026-11-10T00:00:00Z" }),
    item("hot", { severity: "high", when: "2026-10-01T00:00:00Z" }),
    null,
    { title: "no id" },
  ]);
  assert.deepEqual(out.map((i) => i.id), ["hot", "new", "old"]);
  assert.deepEqual(mod.sortItems(undefined), []);
});

test("needs-you: the address filters by department, and only by a known one", () => {
  assert.equal(mod.filterOf(new URLSearchParams("d=sales")), "sales");
  assert.equal(mod.filterOf(new URLSearchParams("d=nonsense")), "");
  assert.equal(mod.filterOf(new URLSearchParams("")), "");
  assert.equal(mod.address("studio"), "#/needs-you?d=studio");
  assert.equal(mod.address(""), "#/needs-you");
  assert.equal(mod.address("../x"), "#/needs-you");
  const items = [item("a", { agent: { slug: "artist" } }), item("b", { source: "books" }), item("c", { agent: { slug: "artist" }, when: "2026-11-12T00:00:00Z" })];
  assert.deepEqual(mod.itemsFor(items, departments, "studio").map((i) => i.id), ["c", "a"]);
  assert.deepEqual(mod.itemsFor(items, departments, "").length, 3);
  assert.deepEqual(mod.itemsFor(items, departments, "sales"), []);
});

test("needs-you: the chips are All, then each department that has an item, with counts", () => {
  const items = [item("a", { agent: { slug: "artist" } }), item("b", { source: "books" }), item("c", { agent: { slug: "artist" } })];
  const chips = mod.chipsFor(items, departments, "");
  assert.deepEqual(chips.map((c) => [c.id, c.count]), [["", 3], ["studio", 2], ["books", 1]]);
  assert.equal(chips[1].href, "#/needs-you?d=studio");
  // A department asked for by the address stays a chip even when it has nothing.
  assert.deepEqual(mod.chipsFor(items, departments, "people").map((c) => c.id), ["", "studio", "people", "books"]);
});

test("needs-you: the not-connected lines are plain words, capped", () => {
  const lines = mod.quietLines(Array.from({ length: 14 }, (_, i) => ({ source: i ? "books" : "mystery", reason: "x".repeat(300) })));
  assert.equal(lines.length, 10);
  assert.equal(lines[0].source, "A part");
  assert.equal(lines[1].source, "The books");
  assert.ok(lines[0].reason.length <= 200);
  assert.deepEqual(mod.quietLines(null), []);
});

test("needs-you: the page uses the approval card and refreshes every 10 seconds", () => {
  const src = readFileSync(resolve(HERE, "../../pages/needs-you.js"), "utf8");
  assert.match(src, /DecisionCard/);
  assert.match(src, /every: 10000/);
  assert.match(src, /refreshShell/);
  assert.match(src, /Nothing needs you\./);
});

// PLAN-V5 K9, T20: a finished task with versions is a card of versions; after a pick its outcome stays in view.
test("needs-you: a card of versions is shown with the kit's PickCard; any other item keeps the approval card", () => {
  const src = readFileSync(resolve(HERE, "../../pages/needs-you.js"), "utf8");
  assert.match(src, /isPickItem\(item\)\s*\n?\s*\? html`<\$\{PickCard\}/);
  // PLAN-COOK T50: an ordinary item opened on this page is the approval card at the page's level.
  assert.match(src, /: html`<\$\{DecisionCard\} key=\$\{item\.id\} item=\$\{item\} onDone=\$\{done\} level \/>`/);
});

test("needs-you: the outcome of a pick stays once its item has left the list, newest first, at most three", () => {
  const settled = [{ id: "goal:3" }, { id: "goal:2" }, { id: "goal:1" }, { id: "goal:0" }, null, { title: "no id" }];
  assert.deepEqual(mod.settledShown(settled, [item("goal:2")]).map((s) => s.id), ["goal:3", "goal:1", "goal:0"]);
  assert.deepEqual(mod.settledShown(settled, []).map((s) => s.id), ["goal:3", "goal:2", "goal:1"]);
  assert.deepEqual(mod.settledShown(null, null), []);
});

// PLAN-V5 K14, T45: a film's shotlist is a card of its own, and its outcome stays like a pick's.
test("needs-you: an item of kind shotlist is shown with ShotlistCard, before PickCard and DecisionCard", () => {
  const src = readFileSync(resolve(HERE, "..", "..", "pages", "needs-you.js"), "utf8");
  assert.match(src, /isShotlistItem\(item\)\s*\n?\s*\? html`<\$\{ShotlistCard\} key=\$\{item\.id\} item=\$\{item\} onDone=\$\{done\} \/>`/);
  assert.match(src, /s\.kind === "shotlist"\s*\n?\s*\? html`<\$\{ShotlistDone\}/);
  assert.doesNotMatch(src, /innerHTML/);
});

test("needs-you: a shotlist's settled outcome stays at the top once its item has left the list", () => {
  const settled = [{ id: "staged:shotlist:g1", kind: "shotlist", action: "approve" }];
  assert.equal(mod.settledShown(settled, []).length, 1);
  assert.equal(mod.settledShown(settled, [{ id: "staged:shotlist:g1" }]).length, 0);
});

// PLAN-COOK T50: the list in the queue's order, one item opened, the pager and the crumbs.
const kinds = (list) => list.map((i) => i.kind);
const known = [
  item("p1", { kind: "problem", when: "2026-11-11T09:00:00Z" }),
  item("q1", { kind: "question", when: "2026-11-11T08:00:00Z" }),
  item("s1", { kind: "shotlist", when: "2026-11-11T07:00:00Z" }),
  item("r1", { kind: "result", when: "2026-11-11T06:00:00Z" }),
  item("a1", { kind: "approval", severity: "high", when: "2026-11-10T00:00:00Z" }),
  item("k1", { kind: "pick", when: "2026-11-11T05:00:00Z" }),
];

test("needs-you: the list is in the queue's order: to approve, to answer, to accept, to know", () => {
  assert.deepEqual(mod.queueOrder(known).map((i) => i.id), ["a1", "s1", "k1", "q1", "r1", "p1"]);
  assert.deepEqual(kinds(mod.queueOrder(known)), ["approval", "shotlist", "pick", "question", "result", "problem"]);
  assert.deepEqual(mod.queueOrder(null), []);
});

test("needs-you: the pager gives the place and the total over the queue's order, with addresses either side", () => {
  const order = mod.queueOrder(known);
  assert.deepEqual(mod.pagerOf(order, "a1"), { index: 1, total: 6, label: "1 of 6", prev: null, next: "#/needs-you?item=s1" });
  assert.deepEqual(mod.pagerOf(order, "k1"), { index: 3, total: 6, label: "3 of 6", prev: "#/needs-you?item=s1", next: "#/needs-you?item=q1" });
  assert.deepEqual(mod.pagerOf(order, "p1"), { index: 6, total: 6, label: "6 of 6", prev: "#/needs-you?item=r1", next: null });
  // Ids work as well as items; a department filter stays in the addresses.
  assert.deepEqual(mod.pagerOf(["x", "y"], "x", "studio"), { index: 1, total: 2, label: "1 of 2", prev: null, next: "#/needs-you?item=y&d=studio" });
  assert.equal(mod.pagerOf(order, "nope"), null);
  assert.equal(mod.pagerOf(order, ""), null);
});

test("needs-you: after an action the item leaves the list and the pager steps on from where it was, only when asked", () => {
  // k1 was third; after it is done the list has five, and next is the one that took its place.
  const left = mod.queueOrder(known.filter((i) => i.id !== "k1"));
  assert.deepEqual(mod.pagerOf(left, "k1", "", 2), { index: null, total: 5, label: "5 left", prev: "#/needs-you?item=s1", next: "#/needs-you?item=q1" });
  assert.deepEqual(mod.pagerOf([], "k1", "", 0), { index: null, total: 0, label: "None left", prev: null, next: null });
  assert.deepEqual(mod.pagerOf(["a"], "z", "", 5), { index: null, total: 1, label: "1 left", prev: "#/needs-you?item=a", next: null });
});

test("needs-you: an item's address is the queue's, with the filter kept; the address names the item opened", () => {
  assert.equal(mod.itemAddress("staged:shotlist:g1"), "#/needs-you?item=staged%3Ashotlist%3Ag1");
  assert.equal(mod.itemAddress("a b", "sales"), "#/needs-you?item=a%20b&d=sales");
  assert.equal(mod.itemAddress("a", "../x"), "#/needs-you?item=a");
  assert.equal(mod.openOf(new URLSearchParams("item=staged%3Ashotlist%3Ag1&d=studio")), "staged:shotlist:g1");
  assert.equal(mod.openOf(new URLSearchParams("")), "");
  assert.equal(mod.openOf(null), "");
});

test("needs-you: the crumbs name the kind of the item opened", () => {
  assert.equal(mod.crumbWord({ kind: "shotlist" }), "A shotlist to approve");
  assert.equal(mod.crumbWord({ kind: "pick" }), "Versions to pick from");
  assert.equal(mod.crumbWord({ kind: "question" }), "A question");
  assert.equal(mod.crumbWord({ kind: "result" }), "A result");
  assert.equal(mod.crumbWord({ kind: "problem" }), "A problem");
  assert.equal(mod.crumbWord({ kind: "approval" }), "Something to approve");
  assert.equal(mod.crumbWord({ kind: "draft" }), "Something to approve");
  assert.equal(mod.crumbWord({ kind: "toString" }), "Something to know");
  assert.equal(mod.crumbWord(null), "Something to know");
  assert.deepEqual(mod.crumbsFor({ kind: "shotlist" }), [{ label: "Needs you", href: "#/needs-you" }, { label: "A shotlist to approve" }]);
  assert.deepEqual(mod.crumbsFor({ kind: "question" }, "sales"), [{ label: "Needs you", href: "#/needs-you?d=sales" }, { label: "A question" }]);
  assert.deepEqual(mod.crumbsFor(null), [{ label: "Needs you" }]);
  assert.deepEqual(mod.crumbsFor(null, "books"), [{ label: "Needs you", href: "#/needs-you" }, { label: "Books" }]);
});

test("needs-you: a shotlist or versions to pick from take the whole pane; anything else is a card", () => {
  assert.equal(mod.isStageItem({ id: "s", kind: "shotlist" }), true);
  assert.equal(mod.isStageItem({ id: "q", kind: "question" }), false);
  assert.equal(mod.isStageItem(null), false);
  const src = readFileSync(resolve(HERE, "../../pages/needs-you.js"), "utf8");
  assert.match(src, /p-needs-you--stage/);
  assert.match(src, /setTop\(\{ crumbs, pager/);
  assert.doesNotMatch(src, /PageHeader/, "the stage's own title is the page's one heading");
  assert.doesNotMatch(src, /const SOURCE_DEPARTMENT/, "the shared table from lib/queue.js");
});

// PLAN-COOK T104 (critics of round A1 on S09: "every row is cut twice", "70 percent of the pane empty").
test("needs-you: a row's grey line shows only where it adds a fact the title does not say", () => {
  const approval = { title: "An agent asked for something the home screen will not approve", summary: "The Builder asked for something the home screen will not approve. It is not a plain request." };
  assert.equal(mod.addsFact(approval), false, "it repeats the title");
  assert.equal(mod.addsFact({ title: "Reply to request 1", summary: "Support wrote a reply to request 1. Approving it replies." }), false);
  assert.equal(mod.addsFact({ title: "Draft invoice ACC-SINV-2026-00001", summary: "The Bookkeeper made a draft invoice for Acme Interiors of ₹ 11,800.00." }), true, "the customer and the amount");
  assert.equal(mod.addsFact({ title: "Plan ready: Open a second showroom page on the website", summary: "The brief and the plan for the Whitefield page are ready." }), true);
  assert.equal(mod.addsFact({ title: "A", summary: "" }), false);
  assert.equal(mod.addsFact({ title: "", summary: "Something." }), true);
  assert.equal(mod.addsFact(null), false);
});

test("needs-you: under the item opened, the other items of its task, its story so far, and (alone) what comes next", () => {
  const a = item("a", { link: { page: "goals", id: "t1" } });
  const b = item("b", { link: { page: "tasks", id: "t2" } });
  const c = item("c", { link: { page: "goals", id: "t1" } });
  const d = item("d", { link: { page: "books", id: "x" } });
  const e = item("e");
  const order = [a, b, c, d, e];
  assert.deepEqual(mod.taskOf(a), { href: "#/tasks/t1", id: "t1" });
  assert.equal(mod.taskOf(d), null, "a link to the books is no task");
  assert.equal(mod.taskOf(e), null);
  assert.deepEqual(mod.sameTask(a, order).map((i) => i.id), ["c"]);
  assert.deepEqual(mod.sameTask(d, order), []);
  assert.deepEqual(mod.nextAfter(order, "a", 3, ["c"]).map((i) => i.id), ["b", "d", "e"]);
  assert.deepEqual(mod.nextAfter(order, "d").map((i) => i.id), ["e"]);
  assert.deepEqual(mod.nextAfter(order, "zz"), []);
  assert.equal(mod.NEXT_SHOWN, 3);
  assert.equal(mod.PAGE_WORDS.sameTask, "From the same task");
  assert.equal(mod.PAGE_WORDS.openTask, "Open the task");
  assert.equal(mod.PAGE_WORDS.upNext, "Up next");
  assert.equal(mod.PAGE_WORDS.next, "Next");
  assert.equal(mod.PAGE_WORDS.story, "The story so far");
  const src = readFileSync(resolve(HERE, "../../pages/needs-you.js"), "utf8");
  // PLAN-COOK T116: the map, and a task's story from the route the task page reads; nothing else.
  const gets = (src.match(/api\.get\([^\n]*/g) || []).sort();
  assert.equal(gets.length, 2, "no request beyond the map and the task");
  assert.ok(gets[0].startsWith('api.get("/api/map")'));
  assert.ok(gets[1].startsWith("api.get(`/api/tasks/${encodeURIComponent(id)}`)"));
  assert.match(src, /Object\.hasOwn\(cache\.current, id\)\) return;/, "one request a task, kept while the page lives");
  assert.doesNotMatch(src, /PAGE_WORDS\.upNext\}/, "Up next goes: the list beside the card says it");
});

// PLAN-COOK R5-D (critics of round R4 on S09: "about 45-55% of the pane is empty below 'The story so far'").
test("needs-you: the story so far is a task's whole thread with words, up to eight entries, newest first", () => {
  const conversation = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ who: { slug: "builder", name: "Builder" }, kind: "comment", text: `entry ${n}`, at: null }));
  assert.deepEqual(mod.storyOf({ conversation }).map((m) => m.text), ["entry 10", "entry 9", "entry 8", "entry 7", "entry 6", "entry 5", "entry 4", "entry 3"]);
  assert.deepEqual(mod.storyOf({ conversation: conversation.slice(0, 5) }).map((m) => m.text), ["entry 5", "entry 4", "entry 3", "entry 2", "entry 1"], "a thread of five: all five");
  assert.deepEqual(mod.storyOf({ conversation: [...conversation.slice(0, 2), { text: "  " }, null] }).map((m) => m.text), ["entry 2", "entry 1"]);
  assert.deepEqual(mod.storyOf(null), []);
  assert.deepEqual(mod.storyOf({ conversation: "x" }), []);
  assert.deepEqual(mod.storyOf({ conversation: [] }), [], "nothing given, nothing drawn");
  assert.equal(mod.STORY_SHOWN, 8);
  const c = readFileSync(resolve(HERE, "../../styles/pages/needs-you.css"), "utf8");
  assert.match(c, /\.p-needs-you \.p-needs-you__entry-text \{[^}]*-webkit-line-clamp: 2;/, "its words in two lines at most");
});

// PLAN-COOK T116 (critics of round A2 on S09: "every title is cut after about 30 characters", "groups blur"), and R5-D
// (critics of round R4: "three solid grey 28px bars chop the list", "titles wrap because the date sits inline", "the
// selected row uses a blue left rule, a fill and a check icon all at once").
test("needs-you: side by side the list is a column of its own; each group under its label and count over a hairline; the date in a 64 px gutter; a title takes one line", () => {
  const c = readFileSync(resolve(HERE, "../../styles/pages/needs-you.css"), "utf8");
  assert.match(c, /\.p-needs-you\.p-needs-you--split \{[^}]*grid-template-columns: 440px minmax\(0, 1fr\);/);
  assert.match(c, /\.p-needs-you\.p-needs-you--split \{[^}]*min-height: calc\(100vh - var\(--topbar-h\)\);/);
  const h = /\.p-needs-you \.p-needs-you__heading \{([^}]*)\}/.exec(c)[1];
  assert.match(h, /border-bottom: 1px solid var\(--line\);/, "the label over a hairline");
  assert.doesNotMatch(h, /background/, "no filled band");
  assert.match(h, /font-size: var\(--fs-label\);/);
  assert.match(h, /font-weight: var\(--fw-bold\);/);
  assert.match(c, /\.p-needs-you \.p-needs-you__row \{[^}]*grid-template-columns: 16px minmax\(0, 1fr\) 64px;/, "the date's own 64 px gutter");
  assert.doesNotMatch(c, /aria-current="true"\] \.p-needs-you__icon/, "the chosen row is the fill and the bar, no third mark");
  const t = /\.p-needs-you \.p-needs-you__title \{([^}]*)\}/.exec(c)[1];
  assert.match(t, /text-overflow: ellipsis;[^}]*white-space: nowrap;/, "one line a title, cut with an ellipsis (R6-D)");
  assert.match(readFileSync(resolve(HERE, "../../pages/needs-you.js"), "utf8"), /<span class="p-needs-you__title" title=\$\{cap\(item\.title, 120\)\}>/, "its whole words on hover");
  assert.match(c, /\.p-needs-you \.p-needs-you__when \{[^}]*font-size: var\(--fs-label\);[^}]*font-variant-numeric: tabular-nums;/, "the date 12 px tabular");
  assert.match(c, /\.p-needs-you \.p-needs-you__row\[aria-current="true"\] \{[^}]*background: var\(--sel\);[^}]*box-shadow: inset 2px 0 0 var\(--accent\);/, "the chosen row: the kit's fill and bar");
});
