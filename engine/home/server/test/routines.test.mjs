// The routines (CONTRACTS-V2 17.6): the list and one routine on the version 2 seed with fixture routine
// files, the run states, run, pause and resume as the exact board calls, the refusals, and the board off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardSeedV2, IDS_V2 } from "../../../test/stubs/seed.mjs";
import { call, writes } from "../lib/testing.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { useRoutinesDir } from "../routes/routines.mjs";

const OPTS = { routes: ["routines"], inbox: [], search: [] };
const DAILY = IDS_V2.routines["daily-brief"];
const WEEKLY = IDS_V2.routines["weekly-content-plan"];

const FILES = {
  "daily-brief": {
    id: "daily-brief", title: "Daily brief", agent: "chief-of-staff",
    when: { cron: "0 9 * * *", timezone: "Asia/Kolkata", plain: "Daily at 09:00" },
    ask: "Write today's brief for the owner: what finished, what waits for the owner, and what needs a decision.",
    produces: ["brief.md"], runMinutes: 10,
  },
  "weekly-content-plan": {
    id: "weekly-content-plan", title: "Weekly content plan", agent: "marketer",
    when: { cron: "0 10 * * 1", timezone: "Asia/Kolkata", plain: "Mondays at 10:00" },
    ask: "Plan next week's posts and newsletter, one draft per item with a title, a channel and a planned date.",
    produces: ["content/*.md"], runMinutes: 15,
  },
  "monthly-review": {
    id: "monthly-review", title: "Monthly review", agent: "chief-of-staff",
    when: { cron: "0 9 1 * *", timezone: "Asia/Kolkata", plain: "Monthly on the 1st" },
    ask: "Write a short review of the month for the owner: what finished, what is late, and what to do next.",
    produces: ["review.md"], runMinutes: 10,
  },
};

function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), "uuu-routines-"));
  for (const [id, d] of Object.entries(FILES)) writeFileSync(join(dir, `${id}.json`), JSON.stringify(d, null, 2));
  writeFileSync(join(dir, "broken.json"), JSON.stringify({ id: "broken", agent: "chief-of-staff" }));
  return dir;
}

async function withHome(fn, seed = boardSeedV2()) {
  const dir = fixtureDir();
  const h = await startV2({ ...OPTS, port: 0, boardSeed: seed });
  useRoutinesDir(h.config, dir);
  try { return await fn(h); } finally {
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
const get = (h, p = "") => call(h.url, "GET", `/api/routines${p}`);
const post = (h, p, opts = {}) => call(h.url, "POST", `/api/routines${p}`, { body: {}, ...opts });
const one = (j, id) => j.routines.find((r) => r.id === id);

test("the list fits the routines shape, in name order, with the broken file under problems", async () => {
  await withHome(async (h) => {
    const r = await get(h);
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("routines"), r.json), []);
    assert.equal(r.json.connected, true);
    assert.equal(r.json.notConnected, null);
    assert.deepEqual(r.json.routines.map((x) => x.id), ["daily-brief", "monthly-review", "weekly-content-plan"]);
    assert.equal(r.json.problems.length, 1);
    assert.equal(r.json.problems[0].file, "broken.json");
    assert.ok(r.json.problems[0].problem.length > 0);
  });
});

test("daily-brief is paused, its last run finished and linked to STH-14", async () => {
  await withHome(async (h) => {
    const d = one((await get(h)).json, "daily-brief");
    assert.equal(d.state, "paused");
    assert.equal(d.plainState, "Paused");
    assert.deepEqual(d.who, { slug: "chief-of-staff", name: "Chief of staff" });
    assert.equal(d.when.plain, "Daily at 09:00");
    assert.equal(d.when.next, null);
    assert.deepEqual(d.produces, ["brief.md"]);
    assert.equal(d.runMinutes, 10);
    assert.equal(d.lastRun.identifier, "STH-14");
    assert.equal(d.lastRun.taskId, IDS_V2.issues["STH-14"]);
    assert.equal(d.lastRun.state, "finished");
    assert.equal(d.lastRun.plainState, "Finished");
  });
});

test("weekly-content-plan is on with its next run time", async () => {
  await withHome(async (h) => {
    const w = one((await get(h)).json, "weekly-content-plan");
    assert.equal(w.state, "on");
    assert.equal(w.plainState, "On");
    assert.equal(w.when.next, "2026-11-16T04:30:00.000Z");
    assert.equal(w.lastRun, null);
    assert.equal(w.who.name, "Marketer");
  });
});

test("a file with no board routine is not set up yet, and its three writes answer 409 with no board write", async () => {
  await withHome(async (h) => {
    const m = one((await get(h)).json, "monthly-review");
    assert.equal(m.state, "not_applied");
    assert.equal(m.plainState, "Not set up yet");
    assert.equal(m.when.next, null);
    assert.equal(m.lastRun, null);
    for (const verb of ["run", "pause", "resume"]) {
      const r = await post(h, `/monthly-review/${verb}`);
      assert.equal(r.status, 409, verb);
      assert.equal(r.json.error.code, "routine_not_applied");
      assert.equal(r.json.error.message, "This routine is not set up yet.");
      assert.equal(r.json.error.next, "Run: engine setup");
    }
    assert.deepEqual(writes(h.board), []);
  });
});

test("without the ids.json entry a routine is joined to the board by its title", async () => {
  await withHome(async (h) => {
    const file = join(h.state, "ids.json");
    const ids = JSON.parse(readFileSync(file, "utf8"));
    delete ids.routines;
    writeFileSync(file, JSON.stringify(ids));
    const j = (await get(h)).json;
    assert.equal(one(j, "daily-brief").state, "paused");
    assert.equal(one(j, "weekly-content-plan").state, "on");
    assert.equal((await post(h, "/weekly-content-plan/run")).status, 200);
    assert.deepEqual(writes(h.board), [`POST /api/routines/${WEEKLY}/run`]);
  });
});

test("one routine fits the routine shape, with its runs newest first", async () => {
  await withHome(async (h) => {
    const r = await get(h, "/daily-brief");
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("routine"), r.json), []);
    assert.equal(r.json.routine.id, "daily-brief");
    assert.equal(r.json.runs.length, 1);
    const run = r.json.runs[0];
    assert.equal(run.state, "finished");
    assert.equal(run.identifier, "STH-14");
    assert.equal(run.source, "schedule");
    assert.equal(run.title, "Daily brief");
    assert.equal(run.note, null);
    const runsCall = h.board.requests.find((q) => q.method === "GET" && q.path === `/api/routines/${DAILY}/runs`);
    assert.ok(runsCall);
    assert.equal(runsCall.query.limit, "20");
    const nf = await get(h, "/no-such-routine");
    assert.equal(nf.status, 404);
    assert.equal(nf.json.error.code, "routine_not_found");
  });
});

test("each board run status maps to the pinned state, and a failure text is never passed on", async () => {
  const seed = boardSeedV2();
  const at = (m) => new Date(Date.parse("2026-11-11T09:00:00.000Z") + m * 60000).toISOString();
  const run = (n, status, linkedIssueId, extra = {}) => ({
    id: `90000000-0000-4000-8000-00000000000${n}`, routineId: DAILY, source: "schedule", status,
    triggeredAt: at(n), completedAt: null, failureReason: null, linkedIssueId, ...extra,
  });
  seed.routineRuns.push(
    run(1, "received", null),
    run(2, "issue_created", IDS_V2.issues["STH-15"]),
    run(3, "completed", null),
    run(4, "failed", null, { failureReason: "SECRET board stack trace at paperclip" }),
    run(5, "coalesced", null),
    run(6, "skipped", null),
    run(7, "weird_new_status", null),
  );
  await withHome(async (h) => {
    const r = await get(h, "/daily-brief");
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("routine"), r.json), []);
    const byId = Object.fromEntries(r.json.runs.filter((x) => x.id.startsWith("9")).map((x) => [x.id.slice(-1), x]));
    assert.equal(r.json.runs[0].id.slice(-1), "7", "newest first");
    assert.equal(byId["1"].state, "starting");
    assert.equal(byId["1"].plainState, "Starting");
    assert.equal(byId["2"].state, "working");
    assert.equal(byId["2"].identifier, "STH-15");
    assert.equal(byId["3"].state, "finished");
    assert.equal(byId["4"].state, "failed");
    assert.equal(byId["4"].plainState, "Failed");
    assert.ok(byId["4"].note && !/SECRET|paperclip|stack/i.test(byId["4"].note));
    assert.ok(!r.text.includes("SECRET"));
    assert.equal(byId["5"].state, "skipped");
    assert.equal(byId["5"].note, "It was already running.");
    assert.equal(byId["6"].state, "skipped");
    assert.equal(byId["6"].note, "The routine was paused.");
    assert.equal(byId["7"].state, "skipped");
    assert.equal(r.json.routine.lastRun.state, "skipped");
  }, seed);
});

test("run sends exactly POST /api/routines/<board id>/run and nothing else", async () => {
  await withHome(async (h) => {
    const before = h.board.state.issues.length;
    const r = await post(h, "/weekly-content-plan/run");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, message: "Started. It will show under Tasks in a moment." });
    assert.deepEqual(writes(h.board), [`POST /api/routines/${WEEKLY}/run`]);
    const sent = h.board.requests.find((q) => q.method === "POST");
    assert.deepEqual(sent.body, {});
    assert.equal(sent.headers.authorization, undefined);
    assert.equal(h.board.state.issues.length, before + 1);
  });
});

test("pause and resume send the pinned PATCH and answer with the routine", async () => {
  await withHome(async (h) => {
    const p = await post(h, "/weekly-content-plan/pause");
    assert.equal(p.status, 200);
    assert.equal(p.json.ok, true);
    assert.equal(p.json.routine.id, "weekly-content-plan");
    assert.equal(p.json.routine.state, "paused");
    assert.equal(p.json.routine.when.next, null);
    const r = await post(h, "/daily-brief/resume");
    assert.equal(r.status, 200);
    assert.equal(r.json.routine.state, "on");
    assert.equal(r.json.routine.lastRun.identifier, "STH-14");
    assert.deepEqual(writes(h.board), [`PATCH /api/routines/${WEEKLY}`, `PATCH /api/routines/${DAILY}`]);
    const bodies = h.board.requests.filter((q) => q.method === "PATCH").map((q) => q.body);
    assert.deepEqual(bodies, [{ status: "paused" }, { status: "active" }]);
    assert.equal(one((await get(h)).json, "daily-brief").state, "on");
  });
});

test("an archived routine's run answers 409 routine_not_ready with no board text", async () => {
  const seed = boardSeedV2();
  seed.routines.find((r) => r.id === DAILY).status = "archived";
  await withHome(async (h) => {
    const r = await post(h, "/daily-brief/run");
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "routine_not_ready");
    assert.equal(r.json.error.message, "This routine cannot run right now.");
    assert.equal(r.json.error.next, "Switch it on first, or wait for the run in progress.");
    assert.ok(!/archived/i.test(r.text));
  }, seed);
});

test("an id that is not a routine id answers 404 and reaches no board routine", async () => {
  await withHome(async (h) => {
    for (const p of ["/..%2Fx", "/%2E%2E%2Fx", "/Daily-Brief", `/${DAILY}`, "/x"]) {
      const g = await get(h, p);
      assert.equal(g.status, 404, p);
      for (const verb of ["run", "pause", "resume"]) {
        const w = await post(h, `${p}/${verb}`);
        assert.equal(w.status, 404, `${p}/${verb}`);
      }
    }
    assert.deepEqual(writes(h.board), []);
    assert.ok(!h.board.requests.some((q) => q.path.startsWith("/api/routines/")));
  });
});

test("a write without the home screen's headers is refused", async () => {
  await withHome(async (h) => {
    const r = await call(h.url, "POST", "/api/routines/daily-brief/run", { body: {}, bare: true, headers: { "content-type": "application/json" } });
    assert.equal(r.status, 403);
    assert.deepEqual(writes(h.board), []);
  });
});

test("with the board off the list answers 200, not connected, every routine not set up yet", async () => {
  await withHome(async (h) => {
    await h.board.close();
    const r = await get(h);
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("routines"), r.json), []);
    assert.equal(r.json.connected, false);
    assert.ok(r.json.notConnected.reason && r.json.notConnected.next);
    assert.equal(r.json.routines.length, 3);
    for (const x of r.json.routines) {
      assert.equal(x.state, "not_applied");
      assert.equal(x.when.next, null);
      assert.equal(x.lastRun, null);
    }
    assert.equal(r.json.problems.length, 1);
    const d = await get(h, "/daily-brief");
    assert.equal(d.status, 200);
    assert.equal(d.json.routine.state, "not_applied");
    const w = await post(h, "/daily-brief/run");
    assert.equal(w.status, 502);
  });
});

test("a missing routines folder gives an empty list", async () => {
  await withHome(async (h) => {
    useRoutinesDir(h.config, join(h.state, "no-such-folder"));
    const r = await get(h);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.routines, []);
  });
});
