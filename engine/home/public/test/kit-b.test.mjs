// The kit's composites (CONTRACTS-V2 13.2): every module loads in Node and exports its pinned names, the pure
// helpers (splitActions, trigger, layout), the stateless components' root classes and their text-only rendering
// of agents' words, the one route DecisionCard calls, and the class and token rules of 11.2 for each stylesheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync as __ex } from "node:fs";
import { dirname as __dn, join as __jn } from "node:path";
import { fileURLToPath as __fp } from "node:url";
// The shape files sit beside the server, outside this tree: found by walking up from this file.
const SHAPES = (() => { let d = __dn(__fp(import.meta.url)); for (;;) { const c = __jn(d, "server", "test", "shapes"); if (__ex(c)) return c; const p = __dn(d); if (p === d) throw new Error("shape files not found"); d = p; } })();

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = join(PUBLIC, "kit");
const shape = (name) => JSON.parse(readFileSync(join(SHAPES, `${name}.json`), "utf8"));

const PINNED = {
  decision: ["DecisionCard", "useInboxAct", "splitActions"],
  "task-card": ["TaskRow", "TaskCard", "BoardColumn"],
  brief: ["BriefCard"],
  composer: ["Composer", "trigger"],
  conversation: ["Conversation", "FileCard"],
  table: ["DataTable", "Figures"],
  timeline: ["Timeline", "layout"],
  checks: ["CheckList", "Evidence"],
  doc: ["DocView"],
  agent: ["AgentChip", "AgentCard"],
};
const MODULES = Object.keys(PINNED);
const load = (name) => import(join(KIT, `${name}.js`));

// Walks a Preact vnode tree: calls function components that use no hooks, collects classes and text.
function walk(node, out = { classes: [], text: [], props: [] }) {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return out; }
  if (typeof node === "string" || typeof node === "number") { out.text.push(String(node)); return out; }
  if (typeof node.type === "function") {
    // Primitives that keep state (Avatar, Menu) need a mounted tree; they are V7's and are tested there.
    let inner;
    try { inner = node.type(node.props || {}); } catch { out.skipped = (out.skipped || 0) + 1; return out; }
    return walk(inner, out);
  }
  const p = node.props || {};
  out.props.push(p);
  if (p.class) out.classes.push(...String(p.class).split(/\s+/));
  walk(p.children, out);
  return out;
}

const UNTRUSTED = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

test("each composite module loads in Node and exports its pinned names", async () => {
  for (const name of MODULES) {
    const m = await load(name);
    for (const exp of PINNED[name]) assert.equal(typeof m[exp], "function", `${name}.js exports ${exp}`);
  }
});

test("kit/index.js re-exports every composite name", async () => {
  const index = await import(join(KIT, "index.js"));
  for (const name of MODULES) for (const exp of PINNED[name]) assert.equal(typeof index[exp], "function", `index exports ${exp}`);
});

test("splitActions: the first primary is primary; note actions and the rest are apart", async () => {
  const { splitActions } = await load("decision");
  const accept = { id: "acknowledge", label: "Accept", style: "primary", needsNote: false };
  const back = { id: "reopen", label: "Send back", style: "plain", needsNote: true };
  const stop = { id: "stop", label: "Stop this task", style: "danger", needsNote: false };
  const dismiss = { id: "dismiss", label: "Dismiss", style: "plain", needsNote: false };
  assert.deepEqual(splitActions([back, accept, stop]), { primary: accept, withNote: [back], rest: [stop] });
  assert.deepEqual(splitActions([dismiss, back]), { primary: dismiss, withNote: [back], rest: [] });
  const second = { ...accept, id: "other" };
  assert.deepEqual(splitActions([accept, second]), { primary: accept, withNote: [], rest: [second] });
  assert.deepEqual(splitActions([]), { primary: null, withNote: [], rest: [] });
  assert.deepEqual(splitActions(undefined), { primary: null, withNote: [], rest: [] });
  const item = shape("needs-you-item");
  assert.equal(splitActions(item.actions).primary.label, "Accept");
});

test("actBody: the version the owner saw goes with every action on an item that has one", async () => {
  const { actBody, isChangedSinceSeen, changedText, CHANGED_TEXT } = await load("decision");
  assert.deepEqual(actBody("goal:1", "acknowledge"), { id: "goal:1", action: "acknowledge" });
  assert.deepEqual(actBody("goal:1", "reopen", "More", "v7"), { id: "goal:1", action: "reopen", note: "More", version: "v7" });
  assert.deepEqual(actBody("goal:1", "acknowledge", "", "v7"), { id: "goal:1", action: "acknowledge", version: "v7" });
  assert.deepEqual(actBody("goal:1", "acknowledge", undefined, ""), { id: "goal:1", action: "acknowledge" });
  assert.deepEqual(actBody("goal:1", "acknowledge", undefined, null), { id: "goal:1", action: "acknowledge" });
  assert.equal(isChangedSinceSeen({ code: "changed_since_seen" }), true);
  assert.equal(isChangedSinceSeen({ code: "conflict" }), false);
  assert.equal(isChangedSinceSeen(null), false);
  assert.deepEqual(changedText({ message: "", next: "" }), CHANGED_TEXT);
  assert.equal(CHANGED_TEXT.message, "This changed after you looked at it. Nothing was done.");
  assert.deepEqual(changedText({ message: "Changed.", next: "Look again." }), { message: "Changed.", next: "Look again." });
});

test("reloadInboxItem reads GET /api/inbox and finds the item, or null when it is gone", async () => {
  const { reloadInboxItem } = await load("decision");
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (path, opts) => {
    calls.push({ path, method: opts.method });
    return { ok: true, status: 200, json: async () => ({ items: [{ id: "goal:1", version: "v8", title: "New" }] }) };
  };
  try {
    assert.deepEqual(await reloadInboxItem("goal:1"), { id: "goal:1", version: "v8", title: "New" });
    assert.equal(await reloadInboxItem("goal:2"), null);
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["GET /api/inbox", "GET /api/inbox"]);
  } finally {
    globalThis.fetch = real;
  }
});

test("trigger: '/' at the start of a line and '@' at the start of a word", async () => {
  const { trigger } = await load("composer");
  assert.deepEqual(trigger("/inv", 4), { kind: "/", query: "inv" });
  assert.deepEqual(trigger("hello @ma", 9), { kind: "@", query: "ma" });
  assert.equal(trigger("a/b", 3), null);
  assert.equal(trigger("mail@x", 6), null);
  assert.deepEqual(trigger("first line\n/dr", 14), { kind: "/", query: "dr" });
  assert.deepEqual(trigger("/", 1), { kind: "/", query: "" });
  assert.deepEqual(trigger("@", 1), { kind: "@", query: "" });
  assert.equal(trigger("/inv now", 8), null);
  assert.deepEqual(trigger("/invoice and more", 4), { kind: "/", query: "inv" });
  assert.equal(trigger("", 0), null);
});

// CONTRACTS-V3 25 and 28: the "/" list holds jobs now, so the placeholder names them; the ask box has its own words.
test("Composer has the pinned default placeholder, and the ask box's words", async () => {
  const src = readFileSync(join(KIT, "composer.js"), "utf8");
  assert.ok(src.includes('"Say what you want done.  /  for jobs,  @  to pick who."'));
  const m = await load("composer");
  assert.equal(m.ASK_PLACEHOLDER, "Ask the company brain, or say what you want done.");
  assert.equal(m.ASK_HINT, "Enter to send. A real agent reads your files, so an answer takes a minute or two.");
  assert.ok(!/ready-made/i.test(src.replace(/^\/\/.*$/gm, "")), "no \"ready-made\" on screen");
});

test("TaskRow: a second line with the outcome, else the stage and state; the department's dot, the time, a chevron", async () => {
  const { TaskRow, rowLine } = await load("task-card");
  const card = shape("task-card");
  // Without the keys of 33.2 it still reads: the stage and the state in words.
  const plain = { ...card, outcome: undefined, job: undefined, department: undefined };
  assert.equal(rowLine(plain), [card.stage.label, Number(card.round) > 0 ? `Round ${card.round}` : null, card.plainState].filter(Boolean).join(" · "));
  const bare = walk(TaskRow({ task: plain }));
  assert.ok(bare.classes.includes("k-task-row__line") && bare.classes.includes("k-task-row__chevron") && bare.classes.includes("k-task-row__time"));
  assert.ok(!bare.classes.includes("k-task-row__dept"), "no dot without a department");
  assert.ok(bare.text.includes(rowLine(plain)));
  // With them: the outcome replaces the stage and state, the job is named, the dot carries the department's colour.
  const full = { ...card, live: false, waitingForYou: false, outcome: "Proposal for Asha Kitchens, 3 pages.", job: { id: "sales/proposal-from-a-call", title: "Proposal from a call write-up" }, department: "sales" };
  assert.equal(rowLine(full), "Proposal for Asha Kitchens, 3 pages.");
  // The mark is a dot only, so waiting or working is said in words on the line.
  assert.equal(rowLine({ ...full, waitingForYou: true }), "Waiting for you · Proposal for Asha Kitchens, 3 pages.");
  assert.equal(rowLine({ live: true }), "Working");
  const out = walk(TaskRow({ task: full }));
  assert.ok(out.text.includes("Proposal for Asha Kitchens, 3 pages."));
  assert.ok(out.text.includes("Proposal from a call write-up"));
  assert.ok(out.props.some((p) => p["data-dept"] === "sales" && String(p.class).includes("k-task-row__dept")));
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

test("Conversation: the owner's bubble has an initials badge; an agent's head; a marker is a centred quiet line", async () => {
  const { Conversation, markerOf } = await load("conversation");
  assert.deepEqual(markerOf({ marker: { label: "Brief  written", tone: "ok" } }), { label: "Brief written", tone: "ok" });
  assert.deepEqual(markerOf({ marker: { label: "Round 1 · Repairing", tone: "pink" } }), { label: "Round 1 · Repairing", tone: "neutral" });
  assert.equal(markerOf({ marker: { label: "  " } }), null);
  assert.equal(markerOf({ marker: "Brief written" }), null);
  assert.equal(markerOf({}), null);
  assert.equal(markerOf({ marker: { label: "x".repeat(500) } }).label.length, 120);
  const msgs = [
    { marker: { label: "Brief written", tone: "neutral" } },
    { who: { slug: "you", name: "Asha Rao" }, kind: "note", text: "Make it four frames.", at: "2026-11-11T08:00:00.000Z" },
    { who: shape("who"), kind: "comment", text: "On it.", at: "2026-11-11T08:01:00.000Z", marker: { label: "Round 1 · Repairing", tone: "warn" } },
  ];
  const out = walk(Conversation({ messages: msgs }));
  assert.equal(out.classes.filter((c) => c === "k-convo__marker").length, 2);
  assert.ok(out.classes.includes("k-convo__marker--warn"));
  assert.ok(out.text.includes("Brief written") && out.text.includes("Round 1 · Repairing"));
  assert.equal(out.classes.filter((c) => c === "k-convo__msg").length, 2, "a marker alone is only its line");
  assert.ok(out.classes.includes("k-convo__badge") && out.classes.includes("k-convo__mine"));
  assert.ok(out.classes.includes("k-convo__head"));
  assert.ok(out.text.includes("On it."));
  // A marker's words are an agent's words too: text only.
  const bad = walk(Conversation({ messages: [{ marker: { label: UNTRUSTED } }] }));
  assert.ok(bad.text.includes(UNTRUSTED));
  assert.ok(!bad.props.some((p) => "dangerouslySetInnerHTML" in p));
});

test("composer.css is the only composite stylesheet that blurs what is behind it (27.3)", () => {
  for (const name of MODULES) {
    const css = readFileSync(join(PUBLIC, "styles", "kit", `${name}.css`), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    if (name !== "composer") assert.ok(!/backdrop-filter/.test(css), `${name}.css: no backdrop-filter`);
    assert.ok(!/filter\s*:\s*blur/.test(css), `${name}.css: no filter: blur`);
    assert.ok(!/will-change/.test(css), `${name}.css: no will-change`);
    // Nothing moves for ever here (the live dot is status.css's).
    assert.ok(!/animation[^;]*infinite/.test(css), `${name}.css: no endless animation`);
    for (const m of css.matchAll(/transition\s*:([^;]+);/g)) {
      for (const part of m[1].split(",")) {
        const prop = part.trim().split(/\s+/)[0];
        assert.ok(["transform", "opacity", "background-color", "border-color", "color", "box-shadow"].includes(prop), `${name}.css: transition of ${prop}`);
        if (!["transform", "opacity"].includes(prop)) assert.ok(/var\(--t-(fast|med)\)/.test(part), `${name}.css: a colour moves in --t-med at most`);
      }
    }
  }
});

test("layout: back-to-back items share the axis; an open item runs to now; widths are at least 1", async () => {
  const { layout } = await load("timeline");
  const t0 = Date.parse("2026-11-11T08:00:00.000Z");
  const iso = (s) => new Date(t0 + s * 1000).toISOString();
  const two = [
    { id: "a", startedAt: iso(0), endedAt: iso(60) },
    { id: "b", startedAt: iso(60), endedAt: iso(120) },
  ];
  assert.deepEqual(layout(two, new Date(t0 + 120000)), [
    { id: "a", leftPct: 0, widthPct: 50 },
    { id: "b", leftPct: 50, widthPct: 50 },
  ]);
  const open = layout([{ id: "a", startedAt: iso(0), endedAt: iso(60) }, { id: "b", startedAt: iso(60), endedAt: null }], new Date(t0 + 120000));
  assert.deepEqual(open[1], { id: "b", leftPct: 50, widthPct: 50 });
  const tiny = layout([{ id: "a", startedAt: iso(0), endedAt: iso(1000) }, { id: "b", startedAt: iso(500), endedAt: iso(500) }], new Date(t0 + 1000000));
  assert.ok(tiny.every((p) => p.widthPct >= 1 && p.leftPct >= 0 && p.leftPct + p.widthPct <= 100));
  assert.equal(tiny[1].widthPct, 1);
  const task = shape("task");
  const one = layout(task.timeline, new Date(task.generatedAt));
  assert.equal(one.length, 1);
  assert.equal(one[0].widthPct, 100);
  assert.deepEqual(layout([], new Date()), []);
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

test("BriefCard, AgentCard, AgentChip, DocView, Figures, DataTable: pinned root classes", async () => {
  const { BriefCard } = await load("brief");
  const { AgentCard, AgentChip } = await load("agent");
  const { DocView } = await load("doc");
  const { DataTable, Figures } = await load("table");
  const item = shape("home").brief.items[0];
  const b = walk(BriefCard({ item }));
  assert.ok(b.classes.includes("k-brief"));
  assert.ok(b.text.includes("FYI"));
  assert.ok(b.text.includes(item.about.label));
  assert.ok(walk(AgentCard({ agent: shape("agent-card") })).classes.includes("k-agent"));
  const chip = walk(AgentChip({ agent: shape("who") }));
  assert.ok(chip.classes.includes("k-agent"));
  assert.ok(chip.props.some((p) => p.href === "#/team/artist"));
  const stage = shape("task").stages[0];
  assert.ok(walk(DocView({ doc: stage.doc, unclear: [] })).classes.includes("k-doc"));
  const unclear = walk(DocView({ doc: { name: "01-plan.md", sections: [{ heading: "Anything unclear", text: "Which colour?" }] }, unclear: ["Which colour?"] }));
  assert.ok(unclear.classes.includes("k-doc__unclear"));
  assert.ok(walk(Figures({ figures: [{ id: "a", label: "Open", value: "3" }] })).classes.includes("k-figures"));
  const t = walk(DataTable({ columns: [{ key: "a", label: "A" }], rows: [{ id: 1, a: "x" }] }));
  assert.ok(t.classes.includes("k-table"));
  assert.ok(walk(DataTable({ columns: [], rows: [], emptyText: "None yet." })).text.includes("None yet."));
});

test("Conversation and FileCard: the owner's bubble, Open or Download", async () => {
  const { Conversation, FileCard } = await load("conversation");
  const file = shape("file-entry");
  const msgs = [
    { who: { slug: "you", name: "You" }, kind: "note", text: "Make it four frames.", at: "2026-11-11T08:00:00.000Z" },
    { who: shape("who"), kind: "result", text: "Done.", at: "2026-11-11T08:10:00.000Z", files: [file] },
  ];
  const out = walk(Conversation({ messages: msgs }));
  assert.ok(out.classes.includes("k-convo"));
  assert.ok(out.classes.includes("k-convo__bubble"));
  assert.ok(out.classes.includes("k-file"));
  assert.ok(out.text.includes("Open"));
  const dl = walk(FileCard({ file: { ...file, viewUrl: null } }));
  assert.ok(dl.text.includes("Download"));
  assert.ok(!dl.text.includes("Open"));
});

test("CheckList: a mark and a word for each check, and its evidence count", async () => {
  const { CheckList } = await load("checks");
  const checks = [
    { n: 1, question: "Does the work do what the brief asked?", answer: "yes", reason: "four frames", evidence: [shape("file-entry")] },
    { n: 2, question: "Is every must-have met?", answer: "no", reason: "the tag runs past", evidence: [] },
  ];
  const out = walk(CheckList({ checks, selected: 1, onSelect: () => {} }));
  assert.ok(out.classes.includes("k-checks"));
  assert.ok(out.text.includes("Passed") && out.text.includes("Failed"));
  assert.ok(out.text.includes("1 file") && out.text.includes("No evidence"));
  assert.ok(out.props.some((p) => p["aria-pressed"] === "true"));
});

test("agents' words are rendered as text, never as HTML", async () => {
  const { BriefCard } = await load("brief");
  const { Conversation } = await load("conversation");
  const { DocView } = await load("doc");
  const { TaskCard } = await load("task-card");
  const outs = [
    walk(BriefCard({ item: { ...shape("home").brief.items[0], title: UNTRUSTED, text: UNTRUSTED } })),
    walk(Conversation({ messages: [{ who: shape("who"), kind: "comment", text: UNTRUSTED, at: null }] })),
    walk(DocView({ doc: { name: "x.md", sections: [{ heading: UNTRUSTED, text: UNTRUSTED }] } })),
    walk(TaskCard({ task: { ...shape("task-card"), title: UNTRUSTED } })),
  ];
  for (const o of outs) {
    assert.ok(o.text.includes(UNTRUSTED), "shown as a text node");
    assert.ok(!o.props.some((p) => "dangerouslySetInnerHTML" in p));
  }
  for (const name of MODULES) {
    const src = readFileSync(join(KIT, `${name}.js`), "utf8");
    assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(src), `${name}.js sets no HTML`);
  }
});

test("DecisionCard acts only through POST /api/inbox/act, through lib/api.js; no module touches the page at load", async () => {
  const src = readFileSync(join(KIT, "decision.js"), "utf8");
  const paths = [...src.matchAll(/["'`](\/api\/[^"'`]*)["'`]/g)].map((m) => m[1]);
  // The one write is POST /api/inbox/act; the one read is GET /api/inbox, to show an item again after the server
  // said it changed since the owner looked (CONTRACTS 9.3a).
  assert.deepEqual([...new Set(paths)].sort(), ["/api/inbox", "/api/inbox/act"]);
  assert.ok(/api\.post\(\s*"\/api\/inbox\/act"/.test(src));
  assert.equal([...src.matchAll(/api\.post\(/g)].length, 1, "one place sends an action");
  assert.ok(/api\.get\(\s*"\/api\/inbox"\s*\)/.test(src));
  assert.ok(!/api\.(del|post)\(\s*"\/api\/inbox"\s*[,)]/.test(src));
  for (const name of MODULES) {
    const code = readFileSync(join(KIT, `${name}.js`), "utf8");
    assert.ok(!code.includes("fetch("), `${name}.js uses lib/api.js`);
    // Top-level statements only (lines that start at column 0): none may reach for the page.
    const top = code.split("\n").filter((l) => /^\S/.test(l) && !/^(export )?function |^\/\/|^}/.test(l));
    assert.ok(!top.some((l) => /\b(document|window)\b/.test(l)), `${name}.js touches nothing at load`);
  }
});

test("each composite stylesheet exists, uses only k- selectors and tokens (11.2)", () => {
  for (const name of MODULES) {
    const file = join(PUBLIC, "styles", "kit", `${name}.css`);
    assert.ok(existsSync(file), `${name}.css exists`);
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(css.trim().length > 0, `${name}.css is not empty`);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), `${name}.css: no hex colour`);
    assert.ok(!/\brgba?\(/.test(css), `${name}.css: no rgb(`);
    assert.ok(!/font-family\s*:/.test(css), `${name}.css: no font-family`);
    assert.ok(!/font-size\s*:\s*[\d.]+px/.test(css), `${name}.css: no font-size in px`);
    for (const m of css.matchAll(/z-index\s*:\s*(\d+)/g)) assert.ok(Number(m[1]) <= 50, `${name}.css: z-index ${m[1]}`);
    // Every rule's selectors (outside @-rules' own lines and keyframe steps) are k- classes.
    const blocks = css
      .replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")
      .replace(/@(?:media|supports|container)[^{]+\{/g, "");
    for (const m of blocks.matchAll(/([^{}@;]+)\{/g)) {
      for (const sel of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
        assert.ok(/^(?:[a-z]+)?\.k-/.test(sel), `${name}.css: selector "${sel}" starts with a k- class`);
      }
    }
  }
});

// M63 item 28: an agent's long comment folds behind a real "Show all" button; the first lines show.
test("Conversation: a long agent message marked fold shows its first lines and a Show all button; others stay open", async () => {
  const { Conversation, foldText, FOLD_LINES, FOLD_CHARS } = await load("conversation");
  const long = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of what the agent said.`).join("\n");
  const f = foldText(long);
  assert.equal(f.long, true);
  assert.ok(f.head.startsWith("Line 1 of"));
  assert.ok(f.head.endsWith("agent said."), "a line that ends a sentence gets no extra mark");
  assert.ok(foldText("word ".repeat(400)).head.endsWith("…"));
  assert.ok(f.head.split("\n").length <= 6);
  assert.equal(foldText("short").long, false);
  assert.equal(foldText("a\n".repeat(FOLD_LINES - 1)).long, false);
  assert.equal(foldText("a\n".repeat(FOLD_LINES)).long, true);
  assert.equal(foldText("x".repeat(FOLD_CHARS)).long, false);
  const wide = foldText("word ".repeat(400));
  assert.equal(wide.long, true);
  assert.ok(wide.head.length <= 482);
  // Linear on a hostile text.
  const t0 = performance.now();
  foldText("\n".repeat(2_000_000));
  assert.ok(performance.now() - t0 < 500);

  // In the page: the folded one renders through its own component (with state), the check and the result as text.
  const msgs = [
    { who: { slug: "builder", name: "Builder" }, kind: "comment", text: long, at: null, fold: true },
    { who: { slug: "checker", name: "Checker" }, kind: "verdict", text: long, at: null },
    { who: { slug: "chief-of-staff", name: "Chief of staff" }, kind: "result", text: long, at: null },
  ];
  const tree = Conversation({ messages: msgs });
  const src = JSON.stringify(tree, (k, v) => (typeof v === "function" ? `fn:${v.name}` : k === "__" || k === "__o" ? undefined : v));
  assert.equal((src.match(/fn:FoldedText/g) || []).length, 1, "only the agent's comment folds");
  assert.equal((src.match(/Line 30 of what/g) || []).length, 3, "the check and the result keep every line; the fold holds the full text to open");
});

// A very small DOM, enough for Preact to render into, for the fold's state (as in kit-f1b).
class MiniNode {
  constructor() { this.childNodes = []; this.parentNode = null; }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}
class MiniText extends MiniNode { constructor(d) { super(); this.nodeType = 3; this.data = String(d); } }
class MiniElement extends MiniNode {
  constructor(tag) { super(); this.nodeType = 1; this.localName = tag; this.attrs = {}; this.listeners = {}; this.style = { cssText: "", setProperty() {} }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
  dispatch(type) {
    const key = Object.keys(this.listeners).find((k) => k.toLowerCase() === type);
    for (const f of this.listeners[key] || []) f.call(this, { type: key, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} });
  }
}
function fakeDocument() {
  const doc = {
    createElement: (t) => new MiniElement(t), createElementNS: (_n, t) => new MiniElement(t), createTextNode: (d) => new MiniText(d),
    addEventListener() {}, removeEventListener() {}, activeElement: null,
  };
  doc.body = new MiniElement("body");
  globalThis.document = doc;
  return doc;
}
function* miniWalk(n) { yield n; for (const c of n.childNodes) yield* miniWalk(c); }
const find = (root, ok) => [...miniWalk(root)].find((n) => n.nodeType === 1 && ok(n)) || null;
const textIn = (root) => [...miniWalk(root)].filter((n) => n.nodeType === 3).map((n) => n.data).join(" ");

// The fold's button in a mounted tree: a real button, closed with the first lines, opened by a click.
test("Conversation fold: Show all opens the rest, Show less closes it, and aria-expanded follows", async () => {
  const { Conversation } = await load("conversation");
  const { html, render } = await import(pathToFileURL(join(PUBLIC, "vendor", "preact-htm.js")).href);
  const long = Array.from({ length: 20 }, (_, i) => `Row ${i + 1}`).join("\n");
  const doc = fakeDocument();
  const root = doc.createElement("div");
  render(html`<${Conversation} messages=${[{ who: { slug: "builder", name: "Builder" }, kind: "comment", text: long, fold: true }]} />`, root);
  const btn = find(root, (n) => n.localName === "button" && /k-convo__fold/.test(n.getAttribute?.("class") || ""));
  assert.ok(btn, "a button");
  assert.equal(btn.getAttribute("type"), "button");
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.match(textIn(root), /Show all/);
  assert.doesNotMatch(textIn(root), /Row 20/);
  assert.match(textIn(root), /Row 1\b/);
  const box = btn.getAttribute("aria-controls");
  assert.ok(find(root, (n) => n.getAttribute?.("id") === box), "it controls the text it opens");
  btn.dispatch("click");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  assert.match(textIn(root), /Row 20/);
  assert.match(textIn(root), /Show less/);
});
