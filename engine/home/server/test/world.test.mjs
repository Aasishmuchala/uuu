// GET /api/world (PLAN-3D 2.2, T4) on the version 3 seed: the rooms, the doors, App Studio and the money line, read
// only. The Web, Generation and App Studio routes are loaded beside it so the doors can be checked against what
// Settings reads of the same home. No door, no host and no Runway is started: nothing leaves 127.0.0.1.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLedger } from "../../../generate/ledger.mjs";
import { updateDoors } from "../lib/doors.mjs";
import { LEDGER_SENTENCES } from "../lib/generation.mjs";
import { call, writes } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const issueId = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SEVEN = ["operations", "sales", "marketing", "studio", "support", "people", "books"];
const OPTIONS = { routes: ["world", "web", "generation", "apps"], inbox: ["board", "goals"] };
const STATES = new Set(["free", "working", "paused", "problem", "waiting_for_you"]);
const iso = (ms) => new Date(ms).toISOString();

let h;
before(async () => { h = await startV2(OPTIONS); });
after(async () => { await h?.close(); });

const get = async (home, path) => (await call(home.url, "GET", path)).json;

async function withHome(fn) {
  const home = await startV2(OPTIONS);
  try {
    mkdirSync(home.config.paths.doors, { recursive: true, mode: 0o700 });
    return await fn(home);
  } finally {
    await home.close();
  }
}

// The keys of an object, sorted, for comparing shapes.
const keys = (o) => Object.keys(o).sort();

function assertShape(w) {
  assert.deepEqual(keys(w), ["apps", "boardOff", "company", "doors", "generatedAt", "money", "rooms", "studio"]);
  assert.equal(typeof w.company.name, "string");
  assert.ok(Number.isFinite(Date.parse(w.generatedAt)));
  for (const r of w.rooms) {
    assert.deepEqual(keys(r), ["agents", "counts", "id", "line", "title"], r.id);
    assert.deepEqual(keys(r.counts), ["jobs", "needsYou", "working"], r.id);
    for (const n of Object.values(r.counts)) assert.ok(Number.isInteger(n) && n >= 0, r.id);
    for (const a of r.agents) {
      assert.deepEqual(keys(a), ["doing", "id", "lastActiveAt", "name", "plainState", "slug", "state", "waitingForYou"], a.slug);
      assert.ok(a.id === null || typeof a.id === "string", a.slug);
      assert.ok(STATES.has(a.state), a.slug);
      assert.equal(typeof a.plainState, "string");
      assert.equal(typeof a.waitingForYou, "boolean");
      if (a.doing !== null) assert.deepEqual(keys(a.doing), ["identifier", "taskId", "title"], a.slug);
    }
  }
  assert.deepEqual(w.doors.map((d) => d.id), ["web", "generation", "higgsfield"]);
  for (const d of w.doors) {
    assert.deepEqual(keys(d), ["agents", "blocked", "id", "on", "sentence", "spends", "title"], d.id);
    assert.equal(typeof d.on, "boolean");
    assert.equal(typeof d.blocked, "boolean");
    assert.equal(typeof d.sentence, "string");
  }
  assert.deepEqual(w.doors.map((d) => [d.title, d.spends]), [["Web door", false], ["Generation door", true], ["Higgsfield door", true]]);
  assert.deepEqual(keys(w.studio), ["sentence", "state"]);
  for (const a of w.apps) {
    assert.deepEqual(keys(a), ["name", "on", "sentence", "slug", "spending", "state"], a.slug);
    assert.deepEqual(keys(a.spending), ["open", "words"], a.slug);
  }
  assert.deepEqual(keys(w.money), ["line", "month", "ok", "today"]);
  assert.deepEqual(keys(w.money.today), ["limit", "spent"]);
  assert.deepEqual(keys(w.money.month), ["limit", "spent"]);
  assert.equal(typeof w.money.line, "string");
}

// A ledger whose door spent `cents` today, written with the door's own ledger code.
function spend(config, cents) {
  const l = createLedger(config.paths.ledger);
  const at = iso(Date.now() - 2000);
  l.reserve(at, { job: "g1", batch: null, shot: null, slug: "artist", kind: "image_to_video", model: "gen4_turbo", seconds: 5, estimate: cents });
  l.settle(at, l.job("g1"), { state: "spent", credits: cents, verdict: "done" });
}

test("GET /api/world: the seed's seven rooms in file order, their agents and counts as the map's, and nothing written", async () => {
  const r = await call(h.url, "GET", "/api/world");
  assert.equal(r.status, 200);
  assert.equal(r.headers["cache-control"], "no-store");
  const w = r.json;
  assertShape(w);
  assert.equal(w.company.name, "Sthyra");
  assert.equal(w.boardOff, null);
  assert.deepEqual(w.rooms.map((x) => x.id), SEVEN);
  assert.deepEqual(w.rooms.find((x) => x.id === "studio").agents.map((a) => a.slug), ["drafter", "artist"]);
  assert.deepEqual(w.rooms.find((x) => x.id === "marketing").agents.map((a) => a.slug), ["marketer", "researcher"]);
  assert.equal(w.rooms.reduce((n, x) => n + x.counts.jobs, 0), 72, "the map's 72 jobs");
  const sales = w.rooms.find((x) => x.id === "sales");
  assert.ok(sales.counts.working >= 1);
  const agent = sales.agents.find((a) => a.slug === "sales");
  assert.equal(agent.state, "working");
  assert.equal(agent.plainState, "Working");
  assert.deepEqual(agent.doing, { title: "Proposal from a call write-up", taskId: issueId(21), identifier: "STH-21" });
  assert.deepEqual(w.doors.map((d) => d.agents), [["researcher"], ["artist"], ["artist"]]);
  assert.deepEqual(w.studio, { state: "off", sentence: "App Studio is off. Run: engine start" });
  assert.deepEqual(writes(h.board), [], "reading the world writes nothing to the board");
});

test("GET /api/world: the board off gives 200, boardOff in plain words, the rooms with zeros", async () => {
  await withHome(async (home) => {
    await home.board.close();
    const r = await call(home.url, "GET", "/api/world");
    assert.equal(r.status, 200);
    const w = r.json;
    assertShape(w);
    assert.equal(typeof w.boardOff.reason, "string");
    assert.equal(typeof w.boardOff.next, "string");
    assert.deepEqual(w.rooms.map((x) => x.id), SEVEN);
    for (const room of w.rooms) {
      assert.deepEqual([room.counts.working, room.counts.needsYou], [0, 0], room.id);
      for (const a of room.agents) assert.deepEqual([a.id, a.state, a.plainState, a.doing], [null, "free", "Not known", null], a.slug);
    }
    assert.equal(w.doors.length, 3);
  });
});

test("GET /api/world: the doors agree with GET /api/web and GET /api/generation of the same home", async () => {
  await withHome(async (home) => {
    const check = async (label) => {
      const w = await get(home, "/api/world");
      const web = await get(home, "/api/web");
      const gen = await get(home, "/api/generation");
      const [dw, dg, dh] = w.doors;
      assert.equal(dw.on, web.on, label);
      assert.equal(dw.blocked, !web.on && !web.canSwitchOn, label);
      assert.equal(dw.sentence, web.whyNot || web.door.sentence, label);
      assert.equal(dg.on, gen.on, label);
      assert.equal(dg.blocked, !gen.on && !gen.canSwitchOn, label);
      assert.equal(dg.sentence, gen.whyNot || gen.door.sentence, label);
      assert.equal(dh.on, gen.higgsfield.on, label);
      assert.equal(dh.blocked, !gen.higgsfield.on && !gen.higgsfield.signedIn, label);
      assert.equal(dh.sentence, gen.higgsfield.sentence, label);
      return w.doors;
    };
    // No door is running and no key is saved: all three shut, and Settings would refuse each.
    const off = await check("all off");
    assert.deepEqual(off.map((d) => [d.on, d.blocked]), [[false, true], [false, true], [false, true]]);
    assert.equal(off[1].sentence, "Paste your Runway key first.");
    assert.equal(off[2].sentence, "Not signed in.");
    updateDoors(home.config, (s) => { s.web.on = true; s.generate.on = true; s.generate.higgsfield = { ...s.generate.higgsfield, on: true }; });
    const on = await check("all on");
    assert.deepEqual(on.map((d) => [d.on, d.blocked]), [[true, false], [true, false], [true, false]]);
  });
});

test("GET /api/world: money is today's spending against the daily limit, as the Generation view reads it", async () => {
  await withHome(async (home) => {
    const none = (await get(home, "/api/world")).money;
    assert.equal(none.ok, true);
    assert.equal(none.today.spent, 0);
    assert.equal(none.line, `$0.00 of ${`$${(none.today.limit / 100).toFixed(2)}`} spent today.`);
    updateDoors(home.config, (s) => { s.generate.dailyCredits = 1000; s.generate.monthlyCredits = 5000; });
    spend(home.config, 340);
    const w = await get(home, "/api/world");
    const gen = await get(home, "/api/generation");
    assert.deepEqual(w.money, { ok: true, today: { spent: 340, limit: 1000 }, month: { spent: 340, limit: 5000 }, line: "$3.40 of $10.00 spent today." });
    assert.deepEqual([w.money.today.spent, w.money.today.limit], [gen.spent.day, gen.caps.daily]);
  });
});

test("GET /api/world: a ledger that cannot be read gives ok false and the Generation view's own sentence", async () => {
  await withHome(async (home) => {
    writeFileSync(home.config.paths.ledger, "{\"at\":\"20", { mode: 0o600 });
    const r = await call(home.url, "GET", "/api/world");
    assert.equal(r.status, 200);
    assertShape(r.json);
    const gen = await get(home, "/api/generation");
    assert.equal(r.json.money.ok, false);
    assert.deepEqual([r.json.money.today.spent, r.json.money.month.spent], [null, null]);
    assert.equal(r.json.money.line, LEDGER_SENTENCES.unreadable);
    assert.equal(r.json.money.line, gen.ledger.sentence, "the same words Settings shows");
    assert.equal(r.json.money.line, "The spending ledger cannot be read, so nothing will be made. Health shows what to do.");
  });
});

test("GET /api/world: an agent's long name is cut and one holding <script> comes back as it is (the server cuts, never escapes)", async () => {
  await withHome(async (home) => {
    const dir = mkdtempSync(join(tmpdir(), "uuu-engine-"));
    const was = home.config.engineDir;
    try {
      cpSync(join(was, "company"), join(dir, "company"), { recursive: true, filter: (p) => !p.includes(join("company", "test")) });
      const file = join(dir, "company", "company.json");
      const doc = JSON.parse(readFileSync(file, "utf8"));
      const long = "N".repeat(500);
      const hostile = "<script>alert(1)</script>";
      doc.agents.find((a) => a.slug === "drafter").name = long;
      doc.agents.find((a) => a.slug === "artist").name = hostile;
      writeFileSync(file, JSON.stringify(doc, null, 2));
      home.config.engineDir = dir;
      const w = await get(home, "/api/world");
      const studio = w.rooms.find((x) => x.id === "studio").agents;
      const drafter = studio.find((a) => a.slug === "drafter");
      assert.equal(drafter.name.length, 80);
      assert.ok(drafter.name.startsWith("NNNN") && drafter.name.endsWith("…"));
      assert.equal(studio.find((a) => a.slug === "artist").name, hostile);
    } finally {
      home.config.engineDir = was;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("POST /api/world is not a route, and ten GETs leave the doors' switches file byte for byte as it was", async () => {
  await withHome(async (home) => {
    updateDoors(home.config, (s) => { s.web.on = true; });
    const path = home.config.paths.doorsState;
    const was = readFileSync(path);
    const post = await call(home.url, "POST", "/api/world", { body: { on: true } });
    assert.equal(post.status, 404);
    for (let i = 0; i < 10; i += 1) assert.equal((await call(home.url, "GET", "/api/world")).status, 200);
    assert.ok(readFileSync(path).equals(was), "the switches file is unchanged");
    assert.deepEqual(writes(home.board), [], "nothing written to the board");
  });
});
