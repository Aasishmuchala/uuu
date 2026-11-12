// F1b items 2 and 3.
//   2. A question hides the board's stuck-task item only for the same task or a step under it, and only when the
//      owner can answer or accept it; the goal reads "waiting for you" only for a question about the goal itself.
//   3. A board question card shows what Accept does (each suggested task and who it is for; the words and boxes
//      of a confirmation), names the agent that raised it, offers Hide, and its version covers all it shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boardSeed, IDS } from "../../../test/stubs/seed.mjs";
import { mergeInbox } from "../lib/inbox.mjs";
import { columnOf, waitsForOwner } from "../lib/tasks.mjs";
import { actAsSeen, call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const I = IDS.issues; // STH-4 and STH-5 are steps of the goal STH-1
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const inbox = async (h) => (await call(h.url, "GET", "/api/inbox")).json;
const writesSince = (h, n) => h.board.requests.slice(n).filter((r) => r.method !== "GET");

// The plain seed without its own question card.
function seed() {
  const s = boardSeed();
  s.attention = s.attention.filter((a) => a.sourceKind !== "issue_thread_interaction");
  s.threadInteractions = [];
  return s;
}
function blocker(s, n, key) {
  s.attention.push({
    companyId: IDS.company, sourceKind: "blocker_attention", id: `blocker_attention:${n}`,
    subject: { kind: "issue", id: I[key], title: "A step is stuck", status: "blocked", metadata: {} },
    whyNow: "Blocked.", decisionVerbs: [], severity: "medium", dismissalKey: `attention:${n}`,
    relatedIssue: { kind: "issue", id: I[key], title: `Step ${key}`, identifier: key, status: "blocked", metadata: {} },
    originAgentName: null, activityAt: "2026-11-11T08:00:00.000Z", createdAt: "2026-11-11T08:00:00.000Z", updatedAt: "2026-11-11T08:00:00.000Z",
  });
  return `board:blocker_attention:${n}`;
}
function interaction(s, n, key, kind, payload, { by = IDS.agents.sales, title = "Something to decide" } = {}) {
  const iid = `9b000000-0000-4000-8000-00000000000${n}`;
  s.attention.push({
    companyId: IDS.company, sourceKind: "issue_thread_interaction", id: `issue_thread_interaction:interaction:${iid}`,
    subject: { kind: "interaction", id: iid, title, status: "pending", metadata: { kind, issueId: I[key], createdByAgentId: by } },
    whyNow: "An agent asked.", decisionVerbs: [], severity: "medium", dismissalKey: `attention:interaction:${iid}`,
    relatedIssue: { kind: "issue", id: I[key], title: `Task ${key}`, identifier: key, status: "in_progress", metadata: {} },
    originAgentName: null, activityAt: "2026-11-11T09:00:00.000Z", createdAt: "2026-11-11T09:00:00.000Z", updatedAt: "2026-11-11T09:00:00.000Z",
  });
  s.threadInteractions.push({
    id: iid, companyId: IDS.company, issueId: I[key], kind, status: "pending", title, payload, result: null,
    createdByAgentId: by, createdAt: "2026-11-11T09:00:00.000Z", updatedAt: "2026-11-11T09:00:00.000Z",
  });
  return { id: `board:issue_thread_interaction:interaction:${iid}`, iid };
}
const ASK = { version: 1, questions: [{ id: "q", prompt: "Which colour?", selectionMode: "single", required: true, options: [{ id: "a", label: "Blue" }] }] };
const CONFIRM = { version: 1, prompt: "Send the price list to Asha Rao today?" };

async function withSeed(s, fn) {
  const h = await startV2({ routes: ["inbox"], inbox: ["board"], boardSeed: s });
  try { return await fn(h); } finally { await h.close(); }
}
const listed = async (h) => new Set((await inbox(h)).items.map((i) => i.id));

// ---- 2

test("a question on one step keeps the stuck item of a sibling step", async () => {
  const s = seed();
  const other = blocker(s, "b5", "STH-5");
  const q = interaction(s, 1, "STH-4", "ask_user_questions", ASK);
  await withSeed(s, async (h) => {
    const ids = await listed(h);
    assert.ok(ids.has(q.id) && ids.has(other), [...ids].join());
  });
});

test("a question on the same step hides that step's stuck item; a confirmation counts as well", async () => {
  for (const [kind, payload] of [["ask_user_questions", ASK], ["request_confirmation", CONFIRM]]) {
    const s = seed();
    const same = blocker(s, "b4", "STH-4");
    const q = interaction(s, 1, "STH-4", kind, payload);
    await withSeed(s, async (h) => {
      const ids = await listed(h);
      assert.ok(ids.has(q.id), kind);
      assert.ok(!ids.has(same), `${kind}: the stuck item of the same step is dropped`);
    });
  }
});

test("a question about the goal hides the stuck items of the steps under it", async () => {
  const s = seed();
  const b4 = blocker(s, "b4", "STH-4");
  const b5 = blocker(s, "b5", "STH-5");
  const b3 = blocker(s, "b3", "STH-3"); // another goal
  interaction(s, 1, "STH-1", "ask_user_questions", ASK);
  await withSeed(s, async (h) => {
    const ids = await listed(h);
    assert.ok(!ids.has(b4) && !ids.has(b5));
    assert.ok(ids.has(b3), "another goal's stuck item stays");
  });
});

test("a question that offers only Hide hides nothing", async () => {
  // STH-5, not STH-4: the seed has a run of STH-4 running, and a run of the blocked task itself means its block is
  // being dealt with (M63: the card is left out while a run of the task is queued or running).
  const s = seed();
  const same = blocker(s, "b5", "STH-5");
  const q = interaction(s, 1, "STH-5", "connection_intent", { version: 1 });
  await withSeed(s, async (h) => {
    const items = (await inbox(h)).items;
    assert.deepEqual(items.find((i) => i.id === q.id).actions.map((a) => a.id), ["dismiss"]);
    assert.ok(items.some((i) => i.id === same), "the stuck item stays");
  });
});

test("merge rule on its own: same task or an ancestor only", async () => {
  const item = (id, kind, about, chain, actions = [{ id: "answer" }], raw = "issue_thread_interaction") => {
    const i = { id, source: "board", kind, when: "2026-11-11T09:00:00Z", severity: "normal", actions, link: { page: "goals", id: "G" } };
    Object.defineProperty(i, "_raw", { enumerable: false, value: { sourceKind: raw } });
    Object.defineProperty(i, "_about", { enumerable: false, value: about });
    if (chain) Object.defineProperty(i, "_chain", { enumerable: false, value: chain });
    return i;
  };
  const stuck = (id, about) => item(id, "problem", about, [about, "G"], [{ id: "dismiss" }], "recovery_action");
  const src = (items) => [{ id: "board", list: async () => ({ items }), act: async () => ({}) }];
  const ids = async (items) => (await mergeInbox({ log() {} }, src(items))).items.map((i) => i.id).sort();
  assert.deepEqual(await ids([stuck("p1", "S1"), item("q1", "question", "S2", ["S2", "G"])]), ["p1", "q1"], "sibling: kept");
  assert.deepEqual(await ids([stuck("p1", "S1"), item("q1", "question", "S1", ["S1", "G"])]), ["q1"], "same step: dropped");
  assert.deepEqual(await ids([stuck("p1", "S1"), item("q1", "question", "G", ["G"])]), ["q1"], "goal question: dropped");
  assert.deepEqual(await ids([stuck("p1", "S1"), item("q1", "question", "S1", ["S1", "G"], [{ id: "dismiss" }])]), ["p1", "q1"], "Hide only: kept");
  assert.deepEqual(await ids([stuck("p1", "S1"), item("q1", "question", "H", ["H"])]), ["p1", "q1"], "another goal: kept");
});

test("the goal waits for the owner only for a question about the goal itself", () => {
  const GOAL = { id: "G", status: "blocked" };
  const q = (about, actions = [{ id: "answer" }]) => {
    const i = { id: `board:${about}`, source: "board", kind: "question", taskId: "G", actions };
    Object.defineProperty(i, "_about", { enumerable: false, value: about });
    return i;
  };
  const problem = { id: "board:p", source: "board", kind: "problem", taskId: "G" };
  const tctx = (needsYou) => ({ needsYou, accepted: () => false });
  assert.equal(waitsForOwner(GOAL, tctx([q("S1"), problem])), false, "a question on a step");
  assert.equal(columnOf(GOAL, tctx([q("S1"), problem])), "failed");
  assert.equal(waitsForOwner(GOAL, tctx([q("G"), problem])), true);
  assert.equal(columnOf(GOAL, tctx([q("G"), problem])), "pending_review");
  assert.equal(waitsForOwner(GOAL, tctx([q("G", [{ id: "dismiss" }]), problem])), false, "Hide only");
});

// ---- 3

const task = (title, agent, extra = {}) => ({ clientKey: title, title, assigneeAgentId: agent ? IDS.agents[agent] : null, ...extra });

test("suggested tasks: each listed with who it is for, then Accept; the agent that raised it is named", async () => {
  const s = seed();
  const ok = interaction(s, 1, "STH-1", "suggest_tasks", { version: 1, tasks: [task("Call Asha Rao", "sales"), task("Send the price list", null)] });
  await withSeed(s, async (h) => {
    const item = (await inbox(h)).items.find((i) => i.id === ok.id);
    assert.deepEqual(item.actions.map((a) => a.id), ["accept", "reject", "dismiss"]);
    assert.deepEqual(item.suggested, [{ title: "Call Asha Rao", who: "Sales" }, { title: "Send the price list", who: "Nobody yet" }]);
    assert.equal(item.raisedBy, "Sales");
    assert.match(item.summary, /^The Sales asked you/);
    assert.equal(typeof item.version, "string");
    const words = [item.raisedBy, item.summary, ...item.details.map((d) => `${d.label} ${d.value}`), ...item.suggested.map((t) => t.who)].join(" ");
    assert.doesNotMatch(words, GUID);
    // Accept goes as before, with the version of what was shown.
    const n = h.board.requests.length;
    const r = await actAsSeen(h.url, { id: ok.id, action: "accept" });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(writesSince(h, n).map((w) => `${w.method} ${w.path}`), [`POST /api/issues/${I["STH-1"]}/interactions/${ok.iid}/accept`]);
  });
});

test("suggested tasks that cannot all be shown plainly: Decline and Hide only", async () => {
  const s = seed();
  const many = Array.from({ length: 51 }, (_, k) => task(`Task ${k}`, "sales"));
  const cases = [
    interaction(s, 1, "STH-1", "suggest_tasks", { version: 1, tasks: [task("Call", "sales"), task("Hire", null, { assigneeAgentId: "11111111-0000-4000-8000-000000000099" })] }),
    interaction(s, 2, "STH-1", "suggest_tasks", { version: 1, tasks: [task("Ask a person", null, { assigneeUserId: "someone" })] }),
    interaction(s, 3, "STH-1", "suggest_tasks", { version: 1, tasks: many }),
    interaction(s, 4, "STH-1", "suggest_tasks", { version: 1, tasks: [] }),
    interaction(s, 5, "STH-1", "suggest_tasks", null),
  ];
  await withSeed(s, async (h) => {
    const items = (await inbox(h)).items;
    for (const c of cases) {
      const item = items.find((i) => i.id === c.id);
      assert.deepEqual(item.actions.map((a) => a.id), ["reject", "dismiss"], c.id);
      assert.equal(item.suggested, undefined);
      assert.ok(item.details.some((d) => d.label === "Why there is no Accept"));
      assert.equal((await actAsSeen(h.url, { id: c.id, action: "accept" })).status, 400, "Accept is refused");
    }
  });
});

test("a confirmation shows the words it asks to confirm, and its boxes as Accept would send them", async () => {
  const s = seed();
  const plain = interaction(s, 1, "STH-1", "request_confirmation", { ...CONFIRM, detailsMarkdown: "The list has the GST column." });
  const boxes = interaction(s, 2, "STH-1", "request_checkbox_confirmation", {
    version: 1, prompt: "Which channels may I post to?", options: [{ id: "ig", label: "Instagram" }, { id: "fb", label: "Facebook" }, { id: "x", label: "X" }],
    defaultSelectedOptionIds: ["ig", "x"],
  });
  const tool = interaction(s, 3, "STH-1", "request_confirmation", { ...CONFIRM, toolAction: { kind: "something" } });
  const bare = interaction(s, 4, "STH-1", "request_confirmation", { version: 1 });
  await withSeed(s, async (h) => {
    const items = (await inbox(h)).items;
    const by = (c) => items.find((i) => i.id === c.id);
    assert.deepEqual(by(plain).details, [
      { label: "Task", value: "Task STH-1" },
      { label: "It asks you to confirm", value: CONFIRM.prompt },
      { label: "More from the agent", value: "The list has the GST column." },
    ]);
    assert.deepEqual(by(plain).actions.map((a) => a.id), ["accept", "reject", "dismiss"]);
    assert.deepEqual(by(boxes).details.slice(1), [
      { label: "It asks you to confirm", value: "Which channels may I post to?" },
      { label: "Ticked if you accept", value: "Instagram · X" },
      { label: "Left unticked", value: "Facebook" },
    ]);
    assert.deepEqual(by(boxes).actions.map((a) => a.id), ["accept", "reject", "dismiss"]);
    for (const c of [tool, bare]) assert.deepEqual(by(c).actions.map((a) => a.id), ["reject", "dismiss"]);
  });
});

test("an agent the company file does not know is An agent", async () => {
  const s = seed();
  const q = interaction(s, 1, "STH-1", "request_confirmation", CONFIRM, { by: "11111111-0000-4000-8000-000000000099" });
  await withSeed(s, async (h) => {
    const item = (await inbox(h)).items.find((i) => i.id === q.id);
    assert.equal(item.raisedBy, "An agent");
  });
});

test("a card changed after it was shown is not acted on", async () => {
  const s = seed();
  const q = interaction(s, 1, "STH-1", "suggest_tasks", { version: 1, tasks: [task("Call Asha Rao", "sales")] });
  await withSeed(s, async (h) => {
    const seen = (await inbox(h)).items.find((i) => i.id === q.id).version;
    // The agent changes what Accept would make; the card the owner saw is out of date.
    h.board.state.threadInteractions.find((r) => r.id === q.iid).payload.tasks.push(task("Spend the budget", "sales"));
    const n = h.board.requests.length;
    const r = await call(h.url, "POST", "/api/inbox/act", { body: { id: q.id, action: "accept", version: seen } });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "changed_since_seen");
    assert.deepEqual(writesSince(h, n), []);
    const now = (await inbox(h)).items.find((i) => i.id === q.id);
    assert.notEqual(now.version, seen);
    assert.equal(now.suggested.length, 2);
  });
  // A confirmation's words are covered the same way.
  const c = seed();
  const conf = interaction(c, 1, "STH-1", "request_confirmation", CONFIRM);
  await withSeed(c, async (h) => {
    const seen = (await inbox(h)).items.find((i) => i.id === conf.id).version;
    h.board.state.threadInteractions.find((r) => r.id === conf.iid).payload.prompt = "Delete every customer?";
    const r = await call(h.url, "POST", "/api/inbox/act", { body: { id: conf.id, action: "accept", version: seen } });
    assert.equal(r.status, 409);
  });
});

test("every board card offers Hide, and Hide works without the board's own dismissal key", async () => {
  const s = seed();
  const q = interaction(s, 1, "STH-1", "ask_user_questions", ASK);
  const att = s.attention.at(-1);
  delete att.dismissalKey;
  await withSeed(s, async (h) => {
    const items = (await inbox(h)).items;
    for (const i of items) assert.ok(i.actions.some((a) => a.id === "dismiss"), i.id);
    const n = h.board.requests.length;
    const r = await actAsSeen(h.url, { id: q.id, action: "dismiss" });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(writesSince(h, n), [], "hiding writes nothing to the board");
    assert.ok(!(await inbox(h)).items.some((i) => i.id === q.id));
  });
});
