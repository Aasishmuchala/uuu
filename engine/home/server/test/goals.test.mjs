// Goals (CONTRACTS 9.4): create with the pinned body, list, detail with RESULT and VERDICT, note, stop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { IDS } from "../../../test/stubs/seed.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { call, writes } from "../lib/testing.mjs";

async function withHome(fn, opts = {}) {
  const h = await startStubsHome({ port: 0, ...opts });
  try { return await fn(h); } finally { await h.close(); }
}

test("create: the pinned board call, no Authorization header, 201 with a summary", async () => {
  await withHome(async (h) => {
    const long = "Write a welcome letter for new customers that explains how delivery and returns work, in simple words";
    const text = `${long}\nKeep it under one page.`;
    const r = await call(h.url, "POST", "/api/goals", { body: { text } });
    assert.equal(r.status, 201);
    const g = r.json.goal;
    for (const k of ["id", "identifier", "title", "state", "plainState", "createdAt", "updatedAt", "stepsDone", "stepsTotal"]) assert.ok(k in g, k);
    assert.equal(g.state, "waiting");
    assert.equal(g.plainState, "Waiting to start");
    const posts = h.board.requests.filter((x) => x.method === "POST");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].path, `/api/companies/${IDS.company}/issues`);
    assert.deepEqual(posts[0].body, {
      title: long.slice(0, 80).trimEnd(), description: text, assigneeAgentId: IDS.agents["chief-of-staff"],
      projectId: IDS.project, status: "todo", priority: "medium",
    });
    assert.ok(posts[0].body.title.length <= 80);
    assert.ok(h.board.requests.every((x) => !("authorization" in x.headers)));
    assert.equal(h.board.state.wakes.at(-1).agentId, IDS.agents["chief-of-staff"]);
  });
});

test("create: empty or too long is 400, no ids.json is 409, board off is 502", async () => {
  await withHome(async (h) => {
    for (const body of [{ text: "" }, { text: "   " }, {}, { text: 7 }, { text: "x".repeat(4001) }]) {
      const r = await call(h.url, "POST", "/api/goals", { body });
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 40));
    }
    assert.equal(writes(h.board).length, 0);
    rmSync(join(h.state, "ids.json"));
    const r = await call(h.url, "POST", "/api/goals", { body: { text: "Do a thing" } });
    assert.equal(r.status, 409);
    assert.match(r.json.error.next, /engine setup/);
  });
  await withHome(async (h) => {
    await h.board.close();
    const r = await call(h.url, "POST", "/api/goals", { body: { text: "Do a thing" } });
    assert.equal(r.status, 502);
    assert.equal(r.json.error.code, "board_off");
    assert.equal(r.json.error.next, "Run: engine start");
  });
});

test("list: active, finished, all, newest first", async () => {
  await withHome(async (h) => {
    const get = async (q) => (await call(h.url, "GET", `/api/goals${q}`)).json.goals.map((g) => g.identifier);
    assert.deepEqual(await get(""), ["STH-3", "STH-1"]);
    assert.deepEqual(await get("?show=active"), ["STH-3", "STH-1"]);
    assert.deepEqual(await get("?show=finished"), ["STH-2"]);
    assert.deepEqual(await get("?show=all"), ["STH-3", "STH-2", "STH-1"]);
    assert.equal((await call(h.url, "GET", "/api/goals?show=nonsense")).status, 400);
    const all = (await call(h.url, "GET", "/api/goals?show=all")).json.goals;
    const by = Object.fromEntries(all.map((g) => [g.identifier, g]));
    assert.deepEqual([by["STH-1"].state, by["STH-1"].stepsDone, by["STH-1"].stepsTotal], ["working", 0, 2]);
    assert.deepEqual([by["STH-2"].state, by["STH-2"].plainState, by["STH-2"].stepsDone], ["done", "Finished", 1]);
    assert.deepEqual([by["STH-3"].state, by["STH-3"].plainState], ["needs_you", "Stuck, needs you"]);
  });
});

test("detail: steps, RESULT, VERDICT, updates, files", async () => {
  await withHome(async (h) => {
    const r = await call(h.url, "GET", `/api/goals/${IDS.issues["STH-2"]}`);
    assert.equal(r.status, 200);
    const d = r.json;
    assert.equal(d.goal.identifier, "STH-2");
    assert.equal(d.goal.text, "Draft one launch post and one newsletter for November.");
    assert.deepEqual(d.steps.map((s) => [s.identifier, s.who, s.state]), [["STH-6", "Checker", "done"]]);
    assert.deepEqual(d.result, { text: "Two drafts are ready: a launch post and the November newsletter.", by: "Chief of staff", at: d.result.at });
    assert.equal(d.verdict.outcome, "pass");
    assert.equal(d.verdict.reason, "both drafts have a title, a channel and a planned date.");
    assert.equal(d.verdict.by, "Checker");
    assert.ok(d.updates.length >= 2);
    assert.ok(d.updates.every((u) => u.who && u.text && u.at));
    const names = d.files.map((f) => f.name);
    assert.ok(names.includes("cad/bracket.step"));
    assert.ok(names.includes("content/launch-post.md"));
    const file = d.files.find((f) => f.name === "cad/bracket.step");
    const dl = await call(h.url, "GET", file.url);
    assert.equal(dl.status, 200);
    assert.equal(dl.buffer.length, file.size);

    const one = (await call(h.url, "GET", `/api/goals/${IDS.issues["STH-1"]}`)).json;
    assert.deepEqual(one.steps.map((s) => [s.identifier, s.who]), [["STH-4", "Builder"], ["STH-5", "Checker"]]);
    assert.equal(one.result, null);
    assert.equal(one.verdict, null);
    assert.deepEqual(one.files, []);

    h.board.state.comments.push({ id: "c-fail", issueId: IDS.issues["STH-5"], body: "VERDICT: FAIL - the GST rate is wrong on line 3.", authorAgentId: IDS.agents.checker, authorUserId: null, createdAt: "2026-11-11T10:00:00.000Z" });
    const failed = (await call(h.url, "GET", `/api/goals/${IDS.issues["STH-1"]}`)).json;
    assert.deepEqual([failed.verdict.outcome, failed.verdict.reason], ["fail", "the GST rate is wrong on line 3."]);

    assert.equal((await call(h.url, "GET", "/api/goals/nope")).status, 404);
    assert.equal((await call(h.url, "GET", `/api/goals/${IDS.issues["STH-4"]}`)).status, 404, "a step is not a goal");
  });
});

test("note: comments; reopens a done or blocked goal, leaves a working one", async () => {
  await withHome(async (h) => {
    for (const [key, reopen] of [["STH-2", true], ["STH-3", true], ["STH-1", false]]) {
      const before = h.board.requests.length;
      const r = await call(h.url, "POST", `/api/goals/${IDS.issues[key]}/note`, { body: { text: "One more thing." } });
      assert.equal(r.status, 200);
      assert.deepEqual(r.json, { ok: true });
      const w = h.board.requests.slice(before).filter((x) => x.method !== "GET");
      assert.equal(`${w[0].method} ${w[0].path}`, `POST /api/issues/${IDS.issues[key]}/comments`);
      assert.deepEqual(w[0].body, { body: "One more thing." });
      if (reopen) {
        assert.equal(`${w[1].method} ${w[1].path}`, `PATCH /api/issues/${IDS.issues[key]}`);
        assert.deepEqual(w[1].body, { status: "todo" });
      } else {
        assert.equal(w.length, 1, key);
      }
    }
    assert.equal((await call(h.url, "POST", `/api/goals/${IDS.issues["STH-1"]}/note`, { body: { text: "" } })).status, 400);
  });
});

test("stop: sets the goal to cancelled", async () => {
  await withHome(async (h) => {
    const r = await call(h.url, "POST", `/api/goals/${IDS.issues["STH-1"]}/stop`, { body: {} });
    assert.equal(r.status, 200);
    const w = h.board.requests.filter((x) => x.method !== "GET").at(-1);
    assert.equal(`${w.method} ${w.path}`, `PATCH /api/issues/${IDS.issues["STH-1"]}`);
    assert.deepEqual(w.body, { status: "cancelled" });
    const finished = (await call(h.url, "GET", "/api/goals?show=finished")).json.goals.map((g) => g.identifier);
    assert.ok(finished.includes("STH-1"));
  });
});

test("search: the goals source matches every word in title and description", async () => {
  await withHome(async (h) => {
    const r = await call(h.url, "GET", "/api/search?q=price%20GST");
    assert.equal(r.status, 200);
    const g = r.json.groups.find((x) => x.source === "goals");
    assert.equal(g.label, "Goals");
    assert.deepEqual(g.results.map((x) => x.title), ["Write the price list"]);
    assert.deepEqual(g.results[0].link, { page: "goals", id: IDS.issues["STH-1"] });
    const none = await call(h.url, "GET", "/api/search?q=price%20banana");
    assert.ok(!none.json.groups.some((x) => x.source === "goals"));
    assert.equal((await call(h.url, "GET", "/api/search?q=a")).status, 400);
    assert.equal((await call(h.url, "GET", "/api/search")).status, 400);
  });
});
