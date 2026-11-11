// GET /api/team and GET /api/team/:slug (CONTRACTS-V2 17.5), on the version 2 seed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boardSeedV2 } from "../../../test/stubs/seed.mjs";
import { call } from "../lib/testing.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const OPTS = { routes: ["team", "inbox"], inbox: ["board", "goals"], search: [] };
const SLUGS = ["chief-of-staff", "builder", "checker", "bookkeeper", "sales", "support", "people", "marketer", "drafter", "artist"];

async function withHome(fn, extra = {}) {
  const h = await startV2({ ...OPTS, port: 0, boardSeed: boardSeedV2(), ...extra });
  try { return await fn(h); } finally { await h.close(); }
}
const team = (h) => call(h.url, "GET", "/api/team");
const agent = (h, slug) => call(h.url, "GET", `/api/team/${slug}`);

test("the team fits its shape and holds ten agents in file order", async () => {
  await withHome(async (h) => {
    const r = await team(h);
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("team"), r.json), []);
    assert.equal(r.json.connected, true);
    assert.equal(r.json.notConnected, null);
    assert.deepEqual(r.json.agents.map((a) => a.slug), SLUGS);
    assert.ok(r.json.agents.every((a) => a.applied === true));
  });
});

test("the Marketer is working and says what it is doing", async () => {
  await withHome(async (h) => {
    const m = (await team(h)).json.agents.find((a) => a.slug === "marketer");
    assert.equal(m.state, "working");
    assert.ok(m.doingNow && m.doingNow.title);
  });
});

test("with the board off the ten agents come from the file, not applied", async () => {
  const h = await startV2({ ...OPTS, port: 0, boardSeed: boardSeedV2() });
  try {
    await h.board.close();
    const r = await team(h);
    assert.equal(r.status, 200);
    assert.equal(r.json.connected, false);
    assert.ok(r.json.notConnected.reason && r.json.notConnected.next);
    assert.deepEqual(r.json.agents.map((a) => a.slug), SLUGS);
    assert.ok(r.json.agents.every((a) => a.applied === false && a.state === "free"));
    assert.deepEqual(sameShape(readShape("team"), r.json), []);
    const one = await agent(h, "artist");
    assert.equal(one.status, 200);
    assert.equal(one.json.agent.applied, false);
    assert.deepEqual(one.json.conversation, []);
  } finally { await h.close(); }
});

test("the Artist's page fits its shape, with the Artist's sentence and tool", async () => {
  await withHome(async (h) => {
    const r = await agent(h, "artist");
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("agent"), r.json), []);
    assert.ok(r.json.profile.may.includes("Draws sprites, animations and simple images with its own tools."));
    assert.equal(r.json.profile.tool.label, "Drawing tools");
    assert.equal(r.json.instructions.file, "roles/artist.md");
  });
});

test("the Bookkeeper's page has the books sentences", async () => {
  await withHome(async (h) => {
    const p = (await agent(h, "bookkeeper")).json.profile;
    assert.ok(p.may.includes("Prepares drafts in the books. Nothing is final until you approve it."));
    assert.ok(p.mayNot.includes("Cannot make a draft final, cancel it or delete it."));
  });
});

test("the Checker's page has the read-only sentence", async () => {
  await withHome(async (h) => {
    const p = (await agent(h, "checker")).json.profile;
    assert.ok(p.may.includes("Reads the work it checks. It cannot change it."));
  });
});

test("the Marketer's conversation starts with the owner's ask for STH-15", async () => {
  await withHome(async (h) => {
    const r = await agent(h, "marketer");
    const c = r.json.conversation;
    assert.ok(c.length >= 3, JSON.stringify(c));
    assert.equal(c[0].kind, "ask");
    assert.equal(c[0].who.slug, "you");
    assert.equal(c[0].identifier, "STH-15");
    assert.doesNotMatch(c[0].text, /FOR:/);
    assert.ok(c.some((x) => x.kind === "comment" && x.who.slug === "marketer"));
    for (let i = 1; i < c.length; i++) assert.ok(Date.parse(c[i - 1].at) <= Date.parse(c[i].at));
  });
});

test("the Artist's last comment on a finished step is a result", async () => {
  await withHome(async (h) => {
    const c = (await agent(h, "artist")).json.conversation;
    assert.ok(c.some((x) => x.kind === "ask" && x.who.slug === "chief-of-staff" && x.identifier === "STH-8"));
    assert.ok(c.some((x) => x.kind === "result" && x.who.slug === "artist"));
    assert.ok(c.every((x) => Array.isArray(x.files) && x.files.length <= 5));
  });
});

test("the Builder lists its seeded lessons with number, date, text and an 8-character hash", async () => {
  await withHome(async (h) => {
    const l = (await agent(h, "builder")).json.lessons;
    assert.equal(l.length, 2);
    assert.equal(l[0].n, 1);
    assert.equal(l[0].date, "2026-11-09");
    assert.match(l[0].text, /^Keep each goal's files/);
    assert.match(l[1].hash, /^[0-9a-f]{8}$/);
    assert.notEqual(l[0].hash, l[1].hash);
  });
});

test("recent holds at most ten task cards, and the Chief of staff sees the newest", async () => {
  await withHome(async (h) => {
    const r = (await agent(h, "chief-of-staff")).json;
    assert.ok(r.recent.length > 0 && r.recent.length <= 10);
    const t = r.recent.map((c) => Date.parse(c.createdAt));
    for (let i = 1; i < t.length; i++) assert.ok(t[i - 1] >= t[i]);
    assert.deepEqual(sameShape(readShape("task-card"), r.recent[0]), []);
    const art = (await agent(h, "artist")).json.recent;
    assert.ok(art.map((c) => c.identifier).includes("STH-8"));
  });
});

test("an unknown agent is 404 agent_not_found, and a path-like one too", async () => {
  await withHome(async (h) => {
    for (const s of ["nobody", "..%2Fx", "Builder"]) {
      const r = await agent(h, s);
      assert.equal(r.status, 404, s);
      assert.equal(r.json.error.code, "agent_not_found");
    }
  });
});

test("the instructions are filled: no template marker is left, for any agent", async () => {
  await withHome(async (h) => {
    for (const s of SLUGS) {
      const r = await agent(h, s);
      assert.equal(r.status, 200, s);
      assert.ok(r.json.instructions.text.length > 0, s);
      assert.ok(!r.json.instructions.text.includes("{{"), s);
    }
  });
});

test("the team routes only read: nothing is written to the board", async () => {
  await withHome(async (h) => {
    await team(h); await agent(h, "marketer");
    assert.deepEqual(h.board.requests.filter((q) => q.method !== "GET"), []);
  });
});
