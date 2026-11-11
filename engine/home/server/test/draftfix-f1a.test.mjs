// F1a item 4: a draft's fix task is known only from the home server's own record, written when it makes the
// task. The "DRAFT-FIX:" line in a task's text has no effect: it neither hides a finished goal nor gets a
// task closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boardSeed, IDS } from "../../../test/stubs/seed.mjs";
import { fixLine } from "../lib/draftfix.mjs";
import { forgetComments } from "../lib/tasks.mjs";
import { actAsSeen, call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const inbox = async (h) => (await call(h.url, "GET", "/api/inbox")).json;
const actOn = (h, id, action, note) => actAsSeen(h.url, note === undefined ? { id, action } : { id, action, note });
const decisions = (h) => JSON.parse(readFileSync(join(h.config.paths.homeData, "decisions.json"), "utf8"));
const contentDir = (h, key) => join(h.state, "tasks", "company-work", key, "content");
const draft = (title, words = "Some words.") => `---\ntitle: ${title}\nchannel: post\nplanned: 2026-12-01\n---\n${words}\n`;
const STH1 = IDS.issues["STH-1"];
const STH2 = IDS.issues["STH-2"];

test("a finished goal whose text an agent gave the marker line is still listed, and Accept works", async () => {
  const h = await startV2({ routes: ["inbox", "task"], inbox: ["goals"], boardSeed: boardSeed() });
  try {
    const goal = h.board.state.issues.find((i) => i.id === STH2);
    goal.description = `${goal.description}\n\n${fixLine("content:launch")}`;
    forgetComments();
    const item = (await inbox(h)).items.find((i) => i.id === `goal:${STH2}`);
    assert.ok(item, "still in Needs you");
    const page = (await call(h.url, "GET", `/api/tasks/${STH2}`)).json;
    assert.equal(page.acceptance.state, "waiting_for_you");
    assert.equal(page.acceptance.accept.inboxId, `goal:${STH2}`);
    assert.equal(page.acceptance.sendBack.action, "reopen");
    const r = await actOn(h, page.acceptance.accept.inboxId, page.acceptance.accept.action);
    assert.equal(r.status, 200);
    assert.ok(decisions(h)[`acknowledged:goal:${STH2}`]);
  } finally { await h.close(); }
});

const startContent = () => startV2({ routes: ["inbox", "task"], inbox: ["content", "goals"], boardSeed: boardSeed() });
const launchItem = async (h) => (await inbox(h)).items.find((i) => i.id.startsWith("content:") && i.title.endsWith("Launch"));

test("approving a draft closes only its recorded fix task, never other tasks carrying the line", async () => {
  const h = await startContent();
  try {
    mkdirSync(contentDir(h, "STH-2"), { recursive: true });
    writeFileSync(join(contentDir(h, "STH-2"), "launch.md"), draft("Launch"));
    let item = await launchItem(h);
    const before = h.board.state.issues.length;
    assert.equal((await actOn(h, item.id, "send_back", "Shorter.")).status, 200);
    const fix = h.board.state.issues.at(-1);
    assert.equal(h.board.state.issues.length, before + 1);
    assert.equal(decisions(h)[`fixtask:${fix.id}`], item.id);
    assert.deepEqual(decisions(h)[`fixtasks:${item.id}`], [fix.id]);
    // an agent puts the same line on another open task
    const other = h.board.state.issues.find((i) => i.id === STH1);
    other.description = `${other.description || ""}\n\n${fixLine(item.id)}`;
    const otherStatus = other.status;
    writeFileSync(join(contentDir(h, "STH-2"), "launch.md"), draft("Launch", "Fewer words."));
    item = await launchItem(h);
    const n = h.board.requests.length;
    assert.equal((await actOn(h, item.id, "approve")).status, 200);
    const patches = h.board.requests.slice(n).filter((q) => q.method === "PATCH");
    assert.deepEqual(patches.map((q) => q.path), [`/api/issues/${fix.id}`]);
    assert.equal(fix.status, "done");
    assert.equal(other.status, otherStatus);
    const d = decisions(h);
    assert.equal(d[`fixtask:${fix.id}`], null, "forgotten once closed");
    assert.equal(d[`fixtasks:${item.id}`], null);
    assert.ok(d[`acknowledged:goal:${fix.id}`], "the closed fix task is not left waiting for the owner");
    // the closed fix task is not in Needs you, and its page offers no buttons
    forgetComments();
    assert.ok(!(await inbox(h)).items.some((i) => i.id === `goal:${fix.id}`));
    const page = (await call(h.url, "GET", `/api/tasks/${fix.id}`)).json;
    assert.equal(page.acceptance.accept, null);
  } finally { await h.close(); }
});

test("a second send-back closes the first fix task and records the second", async () => {
  const h = await startContent();
  try {
    mkdirSync(contentDir(h, "STH-2"), { recursive: true });
    writeFileSync(join(contentDir(h, "STH-2"), "launch.md"), draft("Launch"));
    let item = await launchItem(h);
    assert.equal((await actOn(h, item.id, "send_back", "Shorter.")).status, 200);
    const first = h.board.state.issues.at(-1);
    // while open and once done by the Marketer, the fix task is not a result for the owner
    first.status = "done";
    forgetComments();
    assert.ok(!(await inbox(h)).items.some((i) => i.id === `goal:${first.id}`));
    const page = (await call(h.url, "GET", `/api/tasks/${first.id}`)).json;
    assert.equal(page.acceptance.accept, null, "no dead buttons");
    first.status = "todo";
    writeFileSync(join(contentDir(h, "STH-2"), "launch.md"), draft("Launch", "Fewer words."));
    item = await launchItem(h);
    assert.equal((await actOn(h, item.id, "send_back", "Shorter still.")).status, 200);
    const second = h.board.state.issues.at(-1);
    assert.notEqual(second.id, first.id);
    assert.equal(first.status, "done");
    assert.equal(second.status, "todo");
    const d = decisions(h);
    assert.equal(d[`fixtask:${first.id}`], null);
    assert.equal(d[`fixtask:${second.id}`], item.id);
    assert.deepEqual(d[`fixtasks:${item.id}`], [second.id]);
  } finally { await h.close(); }
});

test("books send-back records the fix task it made", async () => {
  const h = await startV2({ routes: ["inbox"], inbox: ["bench"] });
  try {
    const id = "bench:Sales Invoice:ACC-SINV-2026-00001";
    await inbox(h);
    const r = await actOn(h, id, "send_back", "Wrong customer.");
    assert.equal(r.status, 200);
    const made = h.board.state.issues.at(-1);
    assert.ok(made.description.endsWith(fixLine(id)));
    assert.equal(decisions(h)[`fixtask:${made.id}`], id);
    assert.deepEqual(decisions(h)[`fixtasks:${id}`], [made.id]);
  } finally { await h.close(); }
});
