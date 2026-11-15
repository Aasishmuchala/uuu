// The queue panel and the shell's other overlays (PLAN-COOK T21): the pure helpers pinned by section 4's
// vectors, the panel drawn from GET /api/inbox (its groups, rows, states and the row of the page being shown),
// the command menu as a floating panel, and the sheet that draws them on the raised step with the float shadow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PUBLIC, elements, installDom, settle, show, stubFetch, textOf, withClass } from "./kit/_dom.mjs";
import { css, src } from "./kit/_rules.mjs";

const attrOf = (el, k) => el.getAttribute(k) ?? null;
const load = (p) => import(pathToFileURL(join(PUBLIC, p)).href);
const lib = await load("lib/queue.js");
const queue = await load("shell/queue.js");
const menu = await load("shell/command-menu.js");

const item = (id, kind, extra = {}) => ({ id, kind, title: `Title ${id}`, summary: `Line ${id}`, severity: "normal", when: "2026-11-11T09:00:00.000Z", ...extra });

test("queueGroups: to approve, to answer, to accept, to know, empty groups left out, each in sortNeeds order", () => {
  const items = [
    item("s", "shotlist", { when: "2026-11-11T08:00:00.000Z" }),
    item("q", "question"),
    item("r", "result"),
    item("p", "problem"),
    item("k", "pick", { when: "2026-11-11T10:00:00.000Z" }),
    item("a", "approval", { severity: "high", when: "2026-11-10T09:00:00.000Z" }),
  ];
  const groups = lib.queueGroups(items);
  assert.deepEqual(groups.map((g) => [g.title, g.items.map((i) => i.kind)]), [
    ["To approve", ["approval", "pick", "shotlist"]],
    ["To answer", ["question"]],
    ["To accept", ["result"]],
    ["To know", ["problem"]],
  ]);
  assert.deepEqual(groups.map((g) => g.heading), ["To approve · 3", "To answer · 1", "To accept · 1", "To know · 1"]);
  assert.deepEqual(lib.queueGroups([item("x", "question")]).map((g) => g.heading), ["To answer · 1"], "empty groups are left out");
  assert.deepEqual(lib.queueGroups(null), []);
  assert.deepEqual(lib.queueGroups([null, { kind: "result" }]), [], "an item without an id is not drawn");
});

test("rowTime: the clock alone for today, the shared words for any other day, nothing for an empty or broken date", () => {
  const now = new Date(2026, 10, 14, 16, 0);
  assert.equal(lib.rowTime(new Date(2026, 10, 14, 14, 27).toISOString(), now), "14:27");
  assert.equal(lib.rowTime(new Date(2026, 10, 13, 9, 5).toISOString(), now), "yesterday 09:05");
  assert.equal(lib.rowTime(new Date(2026, 10, 3, 9, 5).toISOString(), now), "3 Nov");
  assert.equal(lib.rowTime("", now), "");
  assert.equal(lib.rowTime("not a date", now), "");
  assert.equal(lib.rowTime(undefined, now), "");
});

test("queueHref: a shotlist on the Needs you page; a result or pick of a task opens its task; anything else on the Needs you page", () => {
  assert.equal(lib.queueHref({ id: "shotlist:a b", kind: "shotlist", link: { page: "tasks", id: "t1" } }), "#/needs-you?item=shotlist%3Aa%20b");
  assert.equal(lib.queueHref({ id: "goal:1", kind: "result", link: { page: "tasks", id: "e1" } }), "#/tasks/e1");
  assert.equal(lib.queueHref({ id: "pick:1", kind: "pick", link: { page: "tasks", id: "STH-4" } }), "#/tasks/STH-4");
  assert.equal(lib.queueHref({ id: "q:1", kind: "question", link: { page: "tasks", id: "e1" } }), "#/needs-you?item=q%3A1");
  assert.equal(lib.queueHref({ id: "r:2", kind: "result", link: { page: "files", id: "x" } }), "#/needs-you?item=r%3A2");
  assert.equal(lib.queueHref({ id: "b:1", kind: "approval" }), "#/needs-you?item=b%3A1");
});

test("the shell re-exports the queue's helpers from one place, and the drawer is gone", () => {
  for (const n of ["queueGroups", "queueHref", "sortNeeds", "needsFor", "needsTitle", "SOURCE_DEPARTMENT"]) assert.equal(queue[n], lib[n], `shell/queue.js gives lib's ${n}`);
  assert.deepEqual(queue.KIND_ICON, { shotlist: "video", pick: "layers", approval: "check", question: "reply", result: "done", draft: "file" });
  assert.equal(queue.KIND_ICON.draft, "file", "a draft shows the file icon in the queue, as on the Needs you page, not the warning glyph");
  assert.ok(!existsSync(join(PUBLIC, "shell", "needs-drawer.js")), "shell/needs-drawer.js is removed");
  const shell = src("shell/app-shell.js");
  assert.match(shell, /<div id="s-queue" class="s-queue-host">\s*<\$\{QueuePanel\} open=\$\{overlay === "needs"\} narrow=\$\{narrow\}/, "the Queue button's aria-controls names the panel's place");
  assert.doesNotMatch(shell, /NeedsDrawer/);
});

const INBOX = {
  items: [
    item("goal:1", "result", { title: "Finished: a walking sprite", summary: "Four frames and a GIF.", link: { page: "tasks", id: "e1" } }),
    item("shotlist:2", "shotlist", { title: "A film of the lake house", summary: "3 treatments", severity: "high" }),
    item("q:3", "question", { title: "2 answers before the work goes on" }),
    item("p:4", "problem", { title: "Runway refused two pictures", summary: "" }),
  ],
  notConnected: [{ source: "books", reason: "Books is switched off." }],
};

async function drawQueue(answer, props = {}) {
  installDom();
  const calls = stubFetch((path) => (path === "/api/inbox" ? answer : { status: 404, body: {} }));
  try {
    const root = await show(queue.QueuePanel, { open: true, narrow: false, here: "", onClose() {}, ...props });
    await settle();
    return { root, calls: calls.calls };
  } finally {
    calls.restore();
  }
}

test("the queue panel: the kit's Drawer at the right, its title and count, the groups, and a row for each item", async () => {
  const { root, calls } = await drawQueue({ status: 200, body: INBOX }, { here: "#/tasks/e1" });
  assert.deepEqual(calls.map((c) => c.path), ["/api/inbox"]);
  const drawer = withClass(root, "k-drawer")[0];
  assert.ok(drawer, "a panel: the kit's Drawer");
  assert.equal(withClass(root, "k-drawer--right").length, 1, "at the window's right");
  assert.equal(withClass(root, "k-drawer__backdrop").length, 1, "over the standard dim");
  const dialog = withClass(root, "k-drawer__panel")[0];
  assert.equal(attrOf(dialog, "role"), "dialog");
  assert.equal(attrOf(dialog, "aria-modal"), "true");
  const head = withClass(root, "k-drawer__title")[0];
  assert.equal(attrOf(dialog, "aria-labelledby"), attrOf(head, "id"), "named by its title");
  assert.equal(textOf(withClass(head, "s-queue-name")[0]), "Needs you");
  assert.equal(textOf(withClass(head, "s-queue-count")[0]), "4");
  assert.equal(withClass(root, "k-drawer__close").length, 1, "and the kit's Close");
  const panel = withClass(root, "s-queue")[0];
  assert.deepEqual(withClass(panel, "s-queue-group-title").map((h) => textOf(h)), ["To approve · 1", "To answer · 1", "To accept · 1", "To know · 1"]);
  const rows = withClass(panel, "s-queue-row");
  assert.deepEqual(rows.map((r) => attrOf(r, "href")), ["#/needs-you?item=shotlist%3A2", "#/needs-you?item=q%3A3", "#/tasks/e1", "#/needs-you?item=p%3A4"]);
  assert.deepEqual(rows.map((r) => textOf(withClass(r, "s-queue-title")[0])), ["A film of the lake house", "2 answers before the work goes on", "Finished: a walking sprite", "Runway refused two pictures"]);
  assert.equal(textOf(withClass(rows[2], "s-queue-line")[0]), "Four frames and a GIF.");
  assert.equal(withClass(rows[3], "s-queue-line").length, 0, "no grey line when there is no summary");
  assert.equal(withClass(rows[0], "s-queue-line").length, 0, "one line a row: the grey line only on the current row");
  assert.equal(withClass(panel, "s-queue-body").length, 1, "the rows scroll in their own body");
  assert.ok(withClass(rows[0], "s-queue-when")[0], "each row has its time at the right");
  assert.equal(rows.every((r) => withClass(r, "s-queue-icon").length === 1), true, "a 16 px icon on every row");
  assert.deepEqual(rows.map((r) => attrOf(r, "aria-current")), [null, null, "true", null], "the row of the page being shown is current");
  const quiet = withClass(panel, "s-queue-quiet")[0];
  assert.equal(textOf(quiet), "The books: Books is switched off.");
  const full = withClass(panel, "s-queue-full")[0];
  assert.equal(attrOf(full, "href"), "#/needs-you");
  assert.equal(textOf(full), "Open the whole list");
  assert.equal(withClass(full, "k-icon").length, 1, "the foot's row ends on an arrow");
  assert.equal(withClass(panel, "s-queue-more").length, 0, "no group holds more than it shows");
  // The test DOM finds no rows by selector, so the panel itself holds focus here; in a browser it is the first
  // row (checked in Chrome for T21).
  assert.ok(globalThis.document.activeElement === panel || globalThis.document.activeElement === rows[0], "focus moves into the panel");
});

test("the queue panel: empty, failed, closed, and below 860 px not drawn", async () => {
  const empty = await drawQueue({ status: 200, body: { items: [], notConnected: [] } });
  assert.equal(textOf(withClass(empty.root, "s-queue-empty")[0]), "Nothing needs you.");
  assert.equal(withClass(empty.root, "s-queue-count").map((c) => textOf(c))[0], "0");
  const failed = await drawQueue({ status: 503, body: {} });
  assert.equal(withClass(failed.root, "k-notice--bad").length, 1, "the kit's ErrorNotice");
  const closed = await drawQueue({ status: 200, body: INBOX }, { open: false });
  assert.equal(elements(closed.root).length, 1, "nothing is drawn while closed");
  assert.equal(closed.calls.length, 0, "and nothing is read");
  const narrow = await drawQueue({ status: 200, body: INBOX }, { narrow: true });
  assert.equal(withClass(narrow.root, "s-queue").length, 0);
  assert.equal(withClass(narrow.root, "k-drawer").length, 0, "no panel and no dim on a phone");
  const one = await drawQueue({ status: 200, body: INBOX }, { department: "people" });
  assert.equal(textOf(withClass(withClass(one.root, "k-drawer__title")[0], "s-queue-name")[0]), "Needs you: People");
  assert.equal(attrOf(withClass(one.root, "s-queue-full")[0], "href"), "#/needs-you?d=people");
});

test("the queue: a group shows its first rows, then one line to the whole list with how many more", async () => {
  const many = { items: Array.from({ length: 11 }, (_, i) => item(`p:${i}`, "problem", { title: `Problem ${i}` })), notConnected: [] };
  const { root } = await drawQueue({ status: 200, body: many });
  const panel = withClass(root, "s-queue")[0];
  assert.equal(queue.GROUP_ROWS, 3);
  assert.equal(withClass(panel, "s-queue-row").length, 3, "the first three rows");
  const more = withClass(panel, "s-queue-more");
  assert.equal(more.length, 1);
  assert.equal(textOf(more[0]), "and 8 more");
  assert.equal(attrOf(more[0], "href"), "#/needs-you", "it opens the whole list");
  assert.equal(queue.moreWords(10), "and 10 more");
  assert.deepEqual(withClass(panel, "s-queue-group-title").map((h) => textOf(h)), ["To know · 11"], "the label keeps the group's whole count");
});

test("fitGroups: each group as many rows as the room holds, one at least, in turn; a group shown whole drops its more line", () => {
  const f = queue.fitGroups;
  assert.deepEqual(f([2, 2, 5, 11], NaN, { row: 36, more: 28 }), [2, 2, 3, 3], "without a room, three a group");
  assert.deepEqual(f([2, 2, 5, 11], 2000, { row: 36, more: 28 }), [2, 2, 5, 11], "room for all: every row, no more line");
  // 4 groups at one row: 4 x 36 + 4 more lines x 28 = 256; each further row 36, a group's last row 36 - 28.
  assert.deepEqual(f([2, 2, 5, 11], 256, { row: 36, more: 28 }), [1, 1, 1, 1]);
  assert.deepEqual(f([2, 2, 5, 11], 400, { row: 36, more: 28 }), [2, 2, 3, 2], "in turn, the short groups shown whole");
  assert.deepEqual(f([2, 2, 5, 11], 488, { row: 36, more: 28 }), [2, 2, 4, 4]);
  assert.deepEqual(f([2, 2, 5, 11], 100, { row: 36, more: 28 }), [1, 1, 1, 1], "one row a group at least, the list then scrolls");
  assert.deepEqual(f([], 400, { row: 36, more: 28 }), []);
  const js = src("shell/queue.js");
  assert.match(js, /fitGroups\(sizes, room, \{ row, more \}\)/, "the panel measures its room and fits the groups to it");
});

test("the queue's panel: the kit's Drawer under the top bar, the window's height, 420 px, the kit's surface, edge and dim", () => {
  const o = css("shell-overlays.css");
  assert.match(o, /\.k-drawer:has\(\.s-queue\) \{[^}]*top: var\(--topbar-h\);/, "under the top bar: the Queue button stays in view over the dim");
  assert.match(o, /\.k-drawer:has\(\.s-queue\) \.k-drawer__panel \{[^}]*width: min\(420px, 100vw\);/, "420 px wide");
  assert.doesNotMatch(o, /\.s-queue[^{]*\{[^}]*(background|box-shadow|border-left)\s*:[^;]*(--overlay|--scrim)/, "the surface, edge, shadow and dim are the kit's");
  assert.doesNotMatch(o, /\.s-queue-scrim/, "the dim is the Drawer's own");
  assert.match(css("kit/overlays.css"), /\.k-drawer--right \.k-drawer__panel \{ border-left: 1px solid var\(--overlay-line\); \}/, "the kit's 1 px edge at its left");
  assert.match(o, /\.s-queue-body \{[^}]*overflow-y: auto;/, "the rows scroll inside, between the head and the foot");
  assert.match(o, /\.s-queue-full \{[^}]*flex: none;[^}]*margin-top: auto;[^}]*height: 40px;[^}]*border-top: 1px solid var\(--line\);/, "the foot is one 40 px row under a rule at the panel's foot, always in view");
  assert.doesNotMatch(o, /\.s-queue-full \{[^}]*color: var\(--accent\)/, "not a lone blue link");
  assert.match(o, /\.s-queue-row\[aria-current="true"\],\s*\.s-queue-row:focus-visible,\s*\.s-queue-more:focus-visible \{[^}]*outline: none;[^}]*background: color-mix\(in srgb, var\(--ink\) 9%, transparent\);[^}]*box-shadow: inset 2px 0 0 var\(--accent\);/, "the current row and the row reached are a clear fill with a 2 px accent bar, never a ring");
  assert.match(o, /\.s-queue-title \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/, "a row is one line: the title cut with an ellipsis");
  assert.match(o, /\.s-queue-more \{[^}]*color: var\(--accent\);/, "\"and N more\" in the accent ink");
  assert.match(o, /\.s-queue-when \{[^}]*color: var\(--ink-2\);[^}]*font-variant-numeric: tabular-nums;/, "the date muted, in tabular figures");
  assert.match(o, /\.s-queue-group-title \{[^}]*padding: var\(--s-3\) [^}]*color: var\(--ink-2\);[^}]*font-size: var\(--fs-label\);[^}]*font-weight: var\(--fw-medium\);/, "12 px, 500, muted group labels with 12 px above, as in the menu");
  assert.match(o, /@media \(max-width: 859px\) \{[\s\S]*\.k-drawer:has\(\.s-queue\) \{\s*display: none;/);
  assert.match(o, /:root\[data-motion="off"\] \.s-queue-row \{/);
  assert.match(o, /prefers-reduced-motion/);
  const js = src("shell/queue.js");
  assert.match(js, /<\$\{Drawer\} open=\$\{true\} side="right"/, "the kit's Drawer, at the right");
  assert.match(js, /a !== opener\.current/, "Esc, the dim and Close give the keyboard back to the Queue button, not to where it was before");
});

test("fitWholeRows: a list that holds more than its room is cut back to the foot of the last whole row; one that fits is left alone", () => {
  const box = (top, bottom) => ({ getBoundingClientRect: () => ({ top, bottom }) });
  const list = (rows, room, scroll) => ({
    style: { height: "x" }, clientHeight: room, scrollHeight: scroll, scrollTop: 0,
    getBoundingClientRect: () => ({ top: 100, bottom: 100 + room }),
    querySelectorAll: () => rows.map(([t, b]) => box(100 + t, 100 + b)),
  });
  const long = list([[4, 40], [40, 76], [108, 144], [144, 180]], 160, 400);
  queue.fitWholeRows(long, ".row");
  assert.equal(long.style.height, "144px", "the third row ends at 144, the fourth would be cut at 160");
  const short = list([[4, 40]], 160, 120);
  queue.fitWholeRows(short, ".row");
  assert.equal(short.style.height, "", "a list that fits keeps its own height");
  assert.doesNotThrow(() => queue.fitWholeRows(null, ".row"));
});

test("the command menu: a floating panel whose field is its head, 36 px rows with each department's icon, a muted hint and a count chip, the chosen row a fill with a 2 px accent bar", async () => {
  installDom();
  const calls = stubFetch(() => ({ status: 200, body: { departments: [] } }));
  try {
    const root = await show(menu.CommandMenu, { open: true, onClose() {}, team: [], onCompose() {} });
    const panel = withClass(root, "s-cmd")[0];
    assert.equal(attrOf(panel, "role"), "dialog");
    assert.equal(attrOf(panel, "aria-modal"), "true");
    assert.equal(attrOf(panel, "aria-label"), "Search");
    assert.equal(withClass(root, "k-dialog").length, 0, "no title bar over the field");
    const input = withClass(root, "s-cmd-input")[0];
    assert.equal(attrOf(input, "role"), "combobox");
    assert.equal(attrOf(input, "aria-activedescendant"), "s-cmd-0", "the marked row is the keyboard's place");
    assert.equal(attrOf(withClass(root, "s-cmd-list")[0], "tabindex"), "-1", "the list is not a tab stop: its rows are chosen with the arrows");
    assert.ok(globalThis.document.activeElement === input, "focus goes to the field");
    const rows = withClass(root, "s-cmd-item");
    assert.equal(rows.length, menu.localItems("", []).length, "the same lists as before");
    assert.equal(attrOf(rows[0], "aria-selected"), "true");
    assert.deepEqual(withClass(root, "s-cmd-group-title").map((t) => textOf(t)), ["Start", "Departments", "Pages"]);
    assert.equal(textOf(withClass(rows[0], "s-cmd-end")[0]), "Enter", "the chosen row says Enter at its right");
    const tasks = rows.find((r) => textOf(withClass(r, "s-cmd-label")[0]) === "Tasks");
    assert.equal(textOf(withClass(tasks, "s-cmd-end")[0]), "GT", "a page with keys shows them as keycaps");
    assert.equal(withClass(tasks, "k-kbd").length, 2);
    assert.equal(textOf(withClass(root, "s-cmd-help")[0]), "↑↓ to moveEnter to openEsc to close", "the foot's words, the keys as keycaps");
    assert.equal(withClass(withClass(root, "s-cmd-help")[0], "k-kbd").length, 4);
    assert.equal(menu.HINT_WORDS.working(2), "2 working");
    assert.equal(menu.HINT_WORDS.jobs(1), "1 job");
    assert.equal(menu.HINT_WORDS.jobs(72), "72 jobs");
    const closed = await show(menu.CommandMenu, { open: false, onClose() {}, team: [], onCompose() {} });
    assert.equal(elements(closed).length, 1, "nothing is drawn while closed");
  } finally {
    calls.restore();
  }
  const empty = menu.localItems("", []);
  assert.deepEqual(empty.filter((i) => i.group === "Departments").map((i) => i.icon), ["layers", "trend", "horn", "film", "buoy", "team", "book"], "each department its sidebar icon");
  assert.deepEqual(menu.PAGE_KEYS, { map: "M", tasks: "T", dashboards: "D", files: "F", "needs-you": "N", jobs: "J" });
  const shell = src("shell/app-shell.js");
  for (const [k, page] of Object.entries({ m: "map", t: "tasks", d: "dashboards", f: "files", n: "needs-you", j: "jobs" })) {
    assert.ok(shell.includes(`${k}: "${page}"`), `the shell's GO has g then ${k} for ${page}`);
    assert.equal(menu.PAGE_KEYS[page], k.toUpperCase());
  }
  const o = css("shell-overlays.css");
  assert.match(o, /\.s-cmd-layer \{[^}]*align-items: flex-start;[^}]*justify-content: center;[^}]*padding: 14vh var\(--s-4\) var\(--s-12\);/, "centred on the window, its top 14 percent down, 48 px clear at the foot");
  assert.match(o, /\.s-cmd \{[^}]*max-width: 560px;[^}]*max-height: min\(560px, calc\(86vh - var\(--s-12\)\)\);[^}]*border: 1px solid var\(--overlay-line\);[^}]*border-radius: var\(--r-3\);[^}]*background: var\(--overlay\);[^}]*box-shadow: var\(--overlay-shadow\);/, "560 px, so a rail's words at the right stand whole beside it; at most 560 px tall, so it ends above a composer at a page's foot");
  assert.match(o, /\.s-cmd-list \{[^}]*max-height: min\(466px, /, "the list as tall as the menu allows, less its head and foot");
  assert.match(o, /\.s-cmd-field \{[^}]*height: 52px;[^}]*border-bottom: 1px solid var\(--line\);/, "the head is one 52 px row over a hairline");
  assert.match(o, /\.s-cmd-input \{[^}]*border: 0;[^}]*background: transparent;/, "the field has no box of its own");
  assert.match(o, /\.s-cmd-input:focus,\s*\.s-cmd-input:focus-visible \{\s*outline: none;\s*\}/, "and no ring: the marked row shows the keyboard's place");
  assert.match(o, /\.s-cmd-item \{[^}]*min-height: var\(--h-md\);[^}]*border-radius: var\(--r-1\);/, "36 px rows");
  assert.match(o, /\.s-cmd-list \{[^}]*padding: var\(--s-1\) 6px 6px;/, "the rows are inset 6 px");
  assert.match(o, /\.s-cmd-item\.is-active \{[^}]*background: color-mix\(in srgb, var\(--ink\) 9%, transparent\);/, "the marked row a fill of at least 8 percent");
  assert.doesNotMatch(o, /\.s-cmd-item\.is-active \{[^}]*box-shadow/, "the fill alone: no bar");
  assert.match(o, /\.s-cmd-help \{[^}]*border-top: 1px solid var\(--line\);[^}]*background: var\(--ctl\);/, "the foot a tinted strip under a rule");
  assert.match(src("shell/command-menu.js"), /<span class="s-cmd-count u-num">\$\{count\}<\/span>/, "a count is a plain figure, no chip");
  assert.match(o, /\.s-cmd-count \{[^}]*color: var\(--ink-2\);[^}]*font-variant-numeric: tabular-nums;/, "muted, in tabular figures");
  assert.doesNotMatch(o, /\.s-cmd-item[^{]*\{[^}]*outline: 2px/, "never a ring on a row");
  assert.match(o, /\.s-cmd-group-title \{[^}]*padding: var\(--s-3\) [^}]*color: var\(--ink-2\);[^}]*font-size: var\(--fs-label\);[^}]*font-weight: var\(--fw-medium\);/, "12 px, 500, muted labels with 12 px above");
  assert.match(src("shell/command-menu.js"), /fitWholeRows\(list\.current, "\.s-cmd-item"\)/, "the list ends on a whole row, so no heading stands alone at its foot");
});

test("the compose dialog and the work panel are on the same surfaces, and nothing in the overlays blurs or fades by gradient", () => {
  const o = css("shell-overlays.css");
  assert.match(o, /@media \(min-width: 860px\) \{\s*\.k-dialog:has\(\.s-compose\) \{[^}]*align-items: flex-start;[^}]*padding: 22vh /, "the compose dialog's top 22 percent down, as tall as what it holds");
  assert.match(o, /\.k-dialog:has\(\.s-compose\) \.k-dialog__panel \{[^}]*max-width: 640px;/, "640 px wide");
  assert.match(o, /\.k-dialog:has\(\.s-compose\) \.k-dialog__head \{[^}]*border-bottom: 0;/, "no band and no rule under the label");
  assert.match(o, /\.k-dialog:has\(\.s-compose\) \.k-dialog__body \{[^}]*padding: 0 var\(--s-5\) var\(--s-5\);/, "20 px in, 20 px under the foot row");
  const dialog = src("shell/compose-dialog.js");
  assert.match(dialog, /bare=\$\{true\}/, "one composer, no box in a box: the Composer's bare look");
  assert.doesNotMatch(o, /k-composer[^{]*\{[^}]*display: contents/, "the Composer's box is not taken apart from outside");
  assert.match(o, /\.s-compose \.k-composer__field \{[^}]*min-height: calc\(2 \* var\(--lh-fact\) \+ 2 \* var\(--s-3\) \+ 2px\);[^}]*border: 1px solid var\(--line-2\);[^}]*border-radius: var\(--r-2\);[^}]*background: var\(--field\);/, "the field framed as the kit's fields are, two lines tall at rest");
  assert.match(o, /\.s-compose \.k-composer--bare \.k-composer__field:focus \{[^}]*border-color: var\(--accent\);[^}]*outline: 2px solid transparent;[^}]*box-shadow: none;/, "focus a 1 px accent edge and no glow, not a lone accent bar; the outline kept for forced colours");
  assert.match(o, /\.k-dialog:has\(\.s-compose\) \.k-dialog__title \{[^}]*font-size: var\(--fs-section\);[^}]*font-weight: var\(--fw-medium\);/, "\"New task\" 15 px 500");
  assert.match(o, /\.s-compose \.k-composer__bar \.k-btn--ghost \{\s*border-color: transparent;\s*\}/, "the chips ghosts with no edge until hover");
  assert.doesNotMatch(o, /\.s-compose[^{]*\{[^}]*inset 2px 0 0/, "no bar at the field's left");
  assert.match(o, /\.s-compose \.k-composer__plan \{[^}]*min-height: var\(--s-8\);[^}]*border: 1px solid transparent;[^}]*border-radius: var\(--r-2\);/, "Plan first one of the ghost chips: the ghost's height and corner");
  assert.match(dialog, /maxHeight="40vh"/, "growing to 40 percent of the window, through the Composer's own limit");
  assert.doesNotMatch(o, /!important|field-sizing/, "no override of the Composer's growth");
  assert.doesNotMatch(o, /\.k-composer__(send|hint)\b[^{]*\{[^}]*display: none;/, "nothing of the Composer's is hidden: its own Send and keys are the foot's");
  assert.doesNotMatch(dialog, /MutationObserver|querySelector|\.click\(\)/, "the dialog does not reach inside the Composer");
  assert.doesNotMatch(o, /\.k-composer__plan input/, "Plan first is the kit's check box, not drawn here");
  assert.match(css("kit/fields.css"), /\.k-check__box \{[^}]*border: 1\.5px solid var\(--ink-2\);/, "Plan first a check with a 1.5 px edge");
  assert.match(o, /\.s-panel \{[^}]*border-left: 1px solid var\(--line\);[^}]*background: var\(--panel\);/);
  assert.match(src("shell/compose-dialog.js"), /<\$\{Dialog\} open=\$\{open\} title="New task"/, "the compose dialog is the kit's dialog: the raised step and the float shadow");
  assert.match(o, /\.s-cmd-scrim \{[^}]*background: var\(--scrim\);/, "the layer behind the menu is the themed scrim token");
  assert.doesNotMatch(o, /data-theme="(light|auto)"\] \.s-cmd-scrim/, "no light-theme override of the scrim");
  assert.doesNotMatch(o, /backdrop-filter/);
  assert.doesNotMatch(o, /gradient\(/);
  assert.doesNotMatch(o, /#[0-9a-fA-F]{3,8}\b\s*;|rgba?\(|hsla?\(/, "colours come from the tokens");
  assert.doesNotMatch(o, /font-size\s*:\s*\d+px/, "sizes come from the tokens");
  // The kit's dialog and drawer are placed for the compose dialog and the queue only through what they hold.
  for (const sel of o.replace(/@keyframes[\s\S]*?\}\s*\}/g, "").matchAll(/(^|[{}])\s*([^{}@]+)\{/g)) {
    for (const one of sel[2].split(",")) assert.match(one.trim(), /^(:root\[data-[a-z]+="[a-z]+"\]\s+|\.k-dialog:has\(\.s-compose\)\s*)?\.s-|^\.k-dialog:has\(\.s-compose\)( \.k-dialog__(body|head|panel|title))?$|^\.k-drawer:has\(\.s-queue\)( \.k-drawer__(body|head|panel|title))?$/, `"${one.trim()}" starts with .s-`);
  }
  const shell = css("shell.css");
  for (const gone of [".s-cmd", ".s-panel", ".s-compose", ".s-needs", ".s-queue-host"]) assert.ok(!shell.includes(`${gone}`), `${gone} moved out of shell.css`);
});
