// GET /api/tasks/:id (CONTRACTS-V2 17.3): one task's acceptance view against the stub board and the
// version 2 seed. Loads routes/task.mjs, routes/inbox.mjs and inbox/goals.mjs only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { boardSeedV2, IDS_V2 } from "../../../test/stubs/seed.mjs";
import { call, writes } from "../lib/testing.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { MARKERS } from "../lib/staged.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const MODULES = { routes: ["task.mjs", "inbox.mjs"], inbox: ["goals.mjs"], search: [] };
const STH = (n) => IDS_V2.issues[`STH-${n}`];

async function withHome(fn, seed = boardSeedV2()) {
  const h = await startV2({ ...MODULES, boardSeed: seed });
  try { return await fn(h); } finally { await h.close(); }
}
const get = (h, id) => call(h.url, "GET", `/api/tasks/${encodeURIComponent(id)}`);
const task = async (h, id) => {
  const r = await get(h, id);
  assert.equal(r.status, 200, r.text);
  return r.json;
};

test("STH-8 fits the task shape", async () => {
  await withHome(async (h) => {
    const j = await task(h, "STH-8");
    assert.deepEqual(sameShape(readShape("task"), j), []);
    assert.equal(j.task.identifier, "STH-8");
    assert.equal(j.text, "Make a walking sprite for the mascot, four frames.");
    assert.equal(j.planFirst, false);
    assert.equal(j.for, null);
    assert.ok(j.result && j.result.by === "Chief of staff" && !j.result.text.startsWith("RESULT"));
  });
});

test("STH-8 has two rounds: Repairing then Passed", async () => {
  await withHome(async (h) => {
    const { rounds } = (await task(h, "STH-8")).acceptance;
    assert.deepEqual(rounds.map((r) => r.label), ["Round 1 · Repairing", "Round 2 · Passed"]);
    assert.deepEqual(rounds.map((r) => r.outcome), ["fail", "pass"]);
    assert.equal(rounds[0].by, "Checker");
    assert.equal(rounds[0].reason, "the walk tag points past the last frame");
    assert.deepEqual(rounds[0].actions, ["Set the tag \"walk\" to frames 0 to 3."]);
    assert.ok(rounds[1].exchange.length >= 1 && rounds[1].exchange.length <= 20);
    assert.ok(rounds[1].exchange.some((e) => e.text === "Set the tag to frames 0 to 3."));
  });
});

test("round 1 has six checks; check 2 is no with two evidence files that exist", async () => {
  await withHome(async (h) => {
    const r1 = (await task(h, "STH-8")).acceptance.rounds[0];
    assert.equal(r1.checks.length, 6);
    assert.equal(r1.wellFormed, true);
    const c2 = r1.checks.find((c) => c.n === 2);
    assert.equal(c2.answer, "no");
    assert.deepEqual(c2.evidence.map((e) => e.name), ["art/walker/walker.json", "art/walker/manifest.json"]);
    for (const e of c2.evidence) {
      assert.deepEqual(sameShape(readShape("file-entry"), e), []);
      assert.ok(e.size > 0);
    }
  });
});

test("STH-8 counts 6 of 6 checks passed in the newest round", async () => {
  await withHome(async (h) => {
    const a = (await task(h, "STH-8")).acceptance;
    assert.equal(a.checksPassed, 6);
    assert.equal(a.checksTotal, 6);
    assert.equal(a.roundCap, 5);
  });
});

test("STH-8 waits for you, and accepting through the inbox makes it accepted", async () => {
  await withHome(async (h) => {
    const before = await task(h, "STH-8");
    assert.equal(before.acceptance.state, "waiting_for_you");
    assert.equal(before.acceptance.accept.inboxId, `goal:${STH(8)}`);
    assert.equal(before.acceptance.accept.action, "acknowledge");
    assert.equal(before.acceptance.sendBack.action, "reopen");
    assert.ok(before.needsYou.some((i) => i.id === `goal:${STH(8)}` && i.taskId === STH(8)));
    assert.ok(before.needsYou.every((i) => i.taskId === STH(8)));
    // The page sends back the version it showed (CONTRACTS 9.3a); without it nothing is done.
    assert.equal(typeof before.acceptance.accept.version, "string");
    const bare = await call(h.url, "POST", "/api/inbox/act", { body: { id: before.acceptance.accept.inboxId, action: "acknowledge" } });
    assert.equal(bare.status, 409);
    assert.equal(bare.json.error.code, "changed_since_seen");
    const act = await call(h.url, "POST", "/api/inbox/act", { body: { id: before.acceptance.accept.inboxId, action: "acknowledge", version: before.acceptance.accept.version } });
    assert.equal(act.status, 200, act.text);
    assert.deepEqual(writes(h.board), []);
    const after = await task(h, "STH-8");
    assert.equal(after.acceptance.state, "accepted");
    assert.equal(after.acceptance.accept, null);
    assert.equal(after.acceptance.sendBack, null);
  });
});

test("STH-8 has five stages with its documents and the check", async () => {
  await withHome(async (h) => {
    const { stages } = await task(h, "STH-8");
    assert.deepEqual(stages.map((s) => s.id), ["brief", "plan", "work", "summary", "check"]);
    const by = Object.fromEntries(stages.map((s) => [s.id, s]));
    for (const [id, name] of [["brief", "00-brief.md"], ["plan", "01-plan.md"], ["summary", "04-summary.md"]]) {
      assert.equal(by[id].doc.name, name);
      assert.equal(by[id].doc.file.name, name);
      assert.ok(by[id].doc.sections.length > 0, id);
    }
    assert.equal(by.work.doc, null);
    assert.equal(by.check.doc.name, "Check");
    assert.equal(by.check.doc.file, null);
    assert.deepEqual(by.check.doc.sections.map((s) => s.heading), ["Questions", "Actions", "Anything unclear"]);
    assert.ok(!by.check.doc.sections.some((s) => /Verdict:/.test(s.text)));
  });
});

test("STH-8's timeline is work, check, work, check with whole durations", async () => {
  await withHome(async (h) => {
    const { timeline } = await task(h, "STH-8");
    assert.deepEqual(timeline.map((t) => t.kind), ["work", "check", "work", "check"]);
    assert.deepEqual(timeline.map((t) => t.identifier), ["STH-9", "STH-10", "STH-11", "STH-12"]);
    for (const t of timeline) {
      assert.ok(Number.isInteger(t.durationMs) && t.durationMs > 0, t.identifier);
      assert.equal(t.durationMs, Date.parse(t.endedAt) - Date.parse(t.startedAt));
    }
    assert.equal(timeline[0].who.slug, "artist");
  });
});

test("the conversation has no line that starts with a marker", async () => {
  await withHome(async (h) => {
    for (const id of ["STH-7", "STH-8", "STH-13", "STH-18"]) {
      const { conversation } = await task(h, id);
      assert.ok(conversation.length > 0, id);
      for (const c of conversation) {
        for (const line of c.text.split("\n")) {
          const t = line.trimStart();
          for (const m of Object.values(MARKERS)) assert.ok(!t.toUpperCase().startsWith(m.toUpperCase()), `${id}: ${line}`);
        }
      }
    }
    const kinds = (await task(h, "STH-8")).conversation.map((c) => c.kind);
    assert.ok(kinds.includes("result") && kinds.includes("verdict") && kinds.includes("comment"));
  });
});

test("a PLAN READY line in lower case reads as its own sentence (live trial V50)", async () => {
  const seed = boardSeedV2();
  const ready = seed.comments.find((c) => c.issueId === STH(7) && c.body.startsWith("PLAN READY:"));
  ready.body = "PLAN READY: the Marketer drafts both pieces in one step, then the Checker reads them.";
  await withHome(async (h) => {
    const texts = (await task(h, "STH-7")).conversation.map((c) => c.text);
    assert.ok(texts.includes("The plan is ready. The Marketer drafts both pieces in one step, then the Checker reads them."), texts.join("\n"));
  }, seed);
});

test("STH-13's brief stage lists two unclear questions", async () => {
  await withHome(async (h) => {
    const brief = (await task(h, "STH-13")).stages.find((s) => s.id === "brief");
    assert.equal(brief.unclear.length, 2);
    assert.ok(brief.unclear.every((q) => q.endsWith("?") && !q.startsWith("-")));
  });
});

test("STH-18 has five rounds, the last one Failed, none well formed", async () => {
  await withHome(async (h) => {
    const j = await task(h, "STH-18");
    assert.deepEqual(sameShape(readShape("task"), j), []);
    const { rounds } = j.acceptance;
    assert.equal(rounds.length, 5);
    assert.equal(rounds[4].label, "Round 5 · Failed");
    assert.ok(rounds.every((r) => r.wellFormed === false));
    assert.ok(rounds.slice(0, 4).every((r) => r.label.endsWith("· Repairing")));
  });
});

test("STH-1 has no rounds and is not ready", async () => {
  await withHome(async (h) => {
    const j = await task(h, "STH-1");
    assert.deepEqual(sameShape(readShape("task"), j), []);
    assert.deepEqual(j.acceptance.rounds, []);
    assert.equal(j.acceptance.state, "not_ready");
    assert.equal(j.acceptance.accept, null);
    assert.equal(j.acceptance.checksTotal, 0);
  });
});

test("the identifier and the id give the same answer; an unknown id is a 404", async () => {
  await withHome(async (h) => {
    const a = await task(h, "STH-8");
    const b = await task(h, STH(8));
    delete a.generatedAt; delete b.generatedAt;
    assert.deepEqual(a, b);
    const r = await get(h, "STH-999");
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, "task_not_found");
    assert.ok(r.json.error.message && r.json.error.next);
  });
});

test("evidence that leaves the folder or is a link is left out", async () => {
  const seed = boardSeedV2();
  const check = seed.comments.find((c) => c.issueId === STH(12) && c.body.startsWith("VERDICT:"));
  check.body = check.body.replace("   evidence: art/walker/walker.gif",
    "   evidence: ../../x, art/walker/link.png, art/walker/walker.gif, /etc/passwd, art/walker/nope.png");
  await withHome(async (h) => {
    symlinkSync("walker-sheet.png", join(h.state, "tasks", "company-work", "STH-8", "art", "walker", "link.png"));
    const r2 = (await task(h, "STH-8")).acceptance.rounds[1];
    const c3 = r2.checks.find((c) => c.n === 3);
    assert.deepEqual(c3.evidence.map((e) => e.name), ["art/walker/walker.gif"]);
    const files = (await task(h, "STH-8")).files.map((f) => f.name);
    assert.ok(!files.includes("art/walker/link.png"));
    assert.ok(files.includes("00-brief.md") && files.includes("art/walker/walker-sheet.png"));
  }, seed);
});
