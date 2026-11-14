// An app's daily allowance (PLAN-V5 K22, K23, T78) on a stub home: its bounds against the door's own ledger and the
// owner's caps, the file the generation door reads (checked with the door's own reader), its end at the next
// midnight in Asia/Kolkata, "Stop spending", and the spending words in dollars. Every key and id is made up; no door
// or host is called.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dayOf } from "../../../generate/ledger.mjs";
import { ALLOWANCE_ID_RE, readAllowance } from "../../../generate/state.mjs";
import { capsLeft, dollars, nextMidnightKolkata, spendingOf, writeAllowance } from "../lib/apps.mjs";
import { saveDoorKey, updateDoors } from "../lib/doors.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const mode = (p) => statSync(p).mode & 0o777;
const iso = (ms) => new Date(ms).toISOString();
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>\n';
const runwayKey = () => `key_${randomBytes(64).toString("hex")}`;

function makeApps(root) {
  const put = (slug, engine, port) => {
    const dir = join(root, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "app.json"), JSON.stringify({
      version: 1, slug, name: slug === "film" ? "Film Maker" : `App ${slug}`, about: "An app.", port, entry: ".build/index.mjs", client: "dist",
      engine, tools: [], icon: "icon.svg", memoryMb: 512,
    }), { mode: 0o644 });
    writeFileSync(join(dir, "icon.svg"), SVG, { mode: 0o644 });
    writeFileSync(join(dir, "READY"), "ready\n");
  };
  put("film", ["generate", "relay"], 3171);
  put("talker", ["relay"], 3172);
  mkdirSync(join(root, "broken"));
  writeFileSync(join(root, "broken", "app.json"), "{", { mode: 0o644 });
}

// A stub home with App Studio's routes and two made-up apps; a Runway key saved unless key is false.
async function withAllowance(fn, { key = true } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "uuu-apps-allowance-"));
  makeApps(join(tmp, "apps"));
  const logs = [];
  const h = await startV2({ routes: ["apps"], inbox: [], search: [], port: 0, log: (l) => logs.push(l) });
  try {
    h.config.paths.appsCode = join(tmp, "apps");
    if (key) saveDoorKey(h.config, "runway", runwayKey());
    return await fn({ h, logs, tmp });
  } finally {
    await h.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

const view = async (h) => (await call(h.url, "GET", "/api/apps")).json;
const post = (h, path, body = {}) => call(h.url, "POST", path, { body });
const film = (v) => v.apps.find((a) => a.slug === "film");
const fileOf = (config, slug = "film") => join(config.paths.allowances, `${slug}.json`);

// Ledger lines as the door writes them (engine/generate/ledger.mjs's shape).
const line = (f) => JSON.stringify({
  at: null, job: null, batch: null, shot: null, slug: "artist", kind: "image_to_video", model: "gen4_turbo", seconds: 5,
  estimate: 25, state: "reserved", credits: 25, runwayTask: null, verdict: null, ...f,
});
function spend(job, at, credits, f = {}) {
  return [line({ at: iso(at), job, credits, estimate: credits, ...f }), line({ at: iso(at + 1000), job, state: "spent", credits, verdict: "done", ...f })];
}
function writeLedger(config, lines, fileMode = 0o600) {
  mkdirSync(config.paths.doors, { recursive: true, mode: 0o700 });
  rmSync(config.paths.ledger, { force: true });
  writeFileSync(config.paths.ledger, lines.length ? `${lines.join("\n")}\n` : "");
  chmodSync(config.paths.ledger, fileMode);
}
// Caps in cents: the switches file the home server writes.
const setCaps = (config, daily, monthly) => updateDoors(config, (s) => { s.generate.dailyCredits = daily; s.generate.monthlyCredits = monthly; });
// Earlier today in the engine's day (Asia/Kolkata), never before its midnight.
function earlierToday(now = Date.now()) {
  const t = now - 60_000;
  return dayOf(t) === dayOf(now) ? t : now;
}

// ---- the bounds ------------------------------------------------------------------------------------------------------

test("an allowance of whole cents from $1 to $100, and never more than what is left today; else 400 bad_amount", async () => {
  await withAllowance(async ({ h }) => {
    setCaps(h.config, 5000, 100000);
    const at = earlierToday();
    writeLedger(h.config, [...spend("j1", at, 1200), ...spend("j2", at, 300)]);
    // 5000 - 1500 = 3500 left today.
    for (const cents of [99, 0, -100, 3501, 10001, 250.5, "500", null, undefined]) {
      const r = await post(h, "/api/apps/film/allowance", cents === undefined ? {} : { cents });
      assert.equal(r.status, 400, String(cents));
      assert.equal(r.json.error.code, "bad_amount");
      assert.equal(r.json.error.next, "Choose up to $35.00, what is left of today's limit.");
    }
    assert.equal(existsSync(fileOf(h.config)), false);
    for (const cents of [100, 3500]) assert.equal((await post(h, "/api/apps/film/allowance", { cents })).status, 200, String(cents));
  });
});

test("K22: whole dollars only: $2.50 is refused with a plain sentence; what is left is held down to a whole dollar", async () => {
  await withAllowance(async ({ h }) => {
    setCaps(h.config, 3550, 100000);
    writeLedger(h.config, []);
    for (const cents of [250, 150, 999, 101]) {
      const r = await post(h, "/api/apps/film/allowance", { cents });
      assert.equal(r.status, 400, String(cents));
      assert.equal(r.json.error.code, "bad_amount");
      assert.equal(r.json.error.message, "An allowance is in whole dollars.");
      assert.equal(r.json.error.next, "Choose a whole number of dollars, up to $35.00.");
    }
    const over = await post(h, "/api/apps/film/allowance", { cents: 3550 });
    assert.equal(over.status, 400, "$35.50 is left, but the most is $35");
    assert.equal(over.json.error.next, "Choose up to $35.00, what is left of today's limit.");
    assert.equal(existsSync(fileOf(h.config)), false, "nothing was allowed");
    assert.throws(() => writeAllowance(h.config, "film", 250), /not an allowance/);
    assert.equal(existsSync(fileOf(h.config)), false);
    assert.equal((await post(h, "/api/apps/film/allowance", { cents: 3500 })).status, 200);
    assert.equal(readAllowance(h.config.paths.allowances, "film", Date.now()).allowance.budgetCents, 3500);
  });
});

test("the month's cap bounds it too, and $100 is the most even with larger caps", async () => {
  await withAllowance(async ({ h }) => {
    setCaps(h.config, 50000, 2000);
    writeLedger(h.config, spend("j1", earlierToday(), 500));
    let r = await post(h, "/api/apps/film/allowance", { cents: 1501 });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.next, "Choose up to $15.00, what is left of today's limit.");
    assert.equal((await post(h, "/api/apps/film/allowance", { cents: 1500 })).status, 200);
    setCaps(h.config, 1000000, 1000000);
    r = await post(h, "/api/apps/film/allowance", { cents: 10001 });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.next, "Choose up to $100.00, what is left of today's limit.");
    assert.equal((await post(h, "/api/apps/film/allowance", { cents: 10000 })).status, 200);
  });
});

test("spending of other days and of last month does not count against today", async () => {
  await withAllowance(async ({ h }) => {
    setCaps(h.config, 1000, 100000);
    const long = Date.now() - 40 * 24 * 3600 * 1000;
    writeLedger(h.config, [...spend("old1", long, 900), ...spend("old2", Date.now() - 3 * 24 * 3600 * 1000, 900)]);
    assert.equal((await post(h, "/api/apps/film/allowance", { cents: 1000 })).status, 200);
  });
});

test("the ledger unreadable is 409 ledger_unreadable; neither service ready is 409 no_provider; nothing is written", async () => {
  await withAllowance(async ({ h }) => {
    writeLedger(h.config, ["{ torn"]);
    let r = await post(h, "/api/apps/film/allowance", { cents: 200 });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "ledger_unreadable");
    writeLedger(h.config, [], 0o666);
    assert.equal((await post(h, "/api/apps/film/allowance", { cents: 200 })).json.error.code, "ledger_unreadable", "a ledger others may change");
    rmSync(h.config.paths.ledger);
    r = await post(h, "/api/apps/film/allowance", { cents: 200 });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "no_provider");
    assert.equal(r.json.error.next, "Add a Runway key or sign in to Higgsfield in Settings first.");
    assert.equal(existsSync(h.config.paths.allowances), false);
  }, { key: false });
});

test("Higgsfield alone makes spending possible only while it is on and the door says it is signed in", async () => {
  await withAllowance(async ({ h }) => {
    const statusFile = (signedIn, refused = false) => {
      mkdirSync(h.config.paths.doors, { recursive: true, mode: 0o700 });
      writeFileSync(h.config.paths.generateStatus, JSON.stringify({ higgsfield: { signedIn, refused }, apps: {} }), { mode: 0o600 });
    };
    const switches = (on) => {
      const s = JSON.parse(readFileSync(h.config.paths.doorsState, "utf8"));
      s.generate.higgsfield = { on, centsPerCredit: 5 };
      rmSync(h.config.paths.doorsState);
      writeFileSync(h.config.paths.doorsState, JSON.stringify(s), { mode: 0o600 });
    };
    setCaps(h.config, 1000, 10000);
    statusFile(true);
    switches(false);
    assert.equal((await post(h, "/api/apps/film/allowance", { cents: 200 })).json.error.code, "no_provider", "switched off");
    assert.deepEqual(film(await view(h)).ready, { runway: false, higgsfield: false });
    switches(true);
    statusFile(false);
    assert.equal((await post(h, "/api/apps/film/allowance", { cents: 200 })).json.error.code, "no_provider", "signed out");
    statusFile(true, true);
    assert.equal((await post(h, "/api/apps/film/allowance", { cents: 200 })).json.error.code, "no_provider", "asked to sign in again");
    statusFile(true);
    assert.deepEqual(film(await view(h)).ready, { runway: false, higgsfield: true });
    assert.equal((await post(h, "/api/apps/film/allowance", { cents: 200 })).status, 200);
  }, { key: false });
});

test("an app that makes no pictures, or a damaged one, has nothing to spend: 409 cannot_spend", async () => {
  await withAllowance(async ({ h }) => {
    for (const slug of ["talker", "broken"]) {
      const r = await post(h, `/api/apps/${slug}/allowance`, { cents: 200 });
      assert.equal(r.status, 409, slug);
      assert.equal(r.json.error.code, "cannot_spend");
    }
    const v = await view(h);
    assert.deepEqual(v.apps.find((a) => a.slug === "talker").spending.open, false);
    assert.equal(existsSync(h.config.paths.allowances), false);
  });
});

// ---- the file --------------------------------------------------------------------------------------------------------

test("the file: K22's shape exactly, 0600 in 0700 folders, a new id at each yes, read as open by the door's own reader", async () => {
  await withAllowance(async ({ h, logs }) => {
    setCaps(h.config, 3000, 10000);
    const before = Date.now();
    assert.equal((await post(h, "/api/apps/film/allowance", { cents: 500 })).status, 200);
    const file = fileOf(h.config);
    const a = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(Object.keys(a), ["version", "id", "app", "approvedAt", "expiresAt", "budgetCents"]);
    assert.equal(a.version, 1);
    assert.match(a.id, ALLOWANCE_ID_RE);
    assert.equal(a.app, "film");
    assert.equal(a.budgetCents, 500);
    assert.ok(Date.parse(a.approvedAt) >= before - 1000 && Date.parse(a.approvedAt) <= Date.now());
    assert.equal(a.expiresAt, nextMidnightKolkata(Date.parse(a.approvedAt)));
    assert.equal(mode(file), 0o600);
    assert.equal(mode(h.config.paths.allowances), 0o700);
    assert.equal(mode(h.config.paths.doors), 0o700);
    assert.ok(readFileSync(file).length <= 4096);
    const door = readAllowance(h.config.paths.allowances, "film");
    assert.equal(door.ok, true);
    assert.equal(door.allowance.id, a.id);
    assert.equal(readAllowance(h.config.paths.allowances, "talker").ok, false, "another app's is not this one");
    assert.equal((await post(h, "/api/apps/film/allowance", { cents: 700 })).status, 200);
    const b = JSON.parse(readFileSync(file, "utf8"));
    assert.notEqual(b.id, a.id);
    assert.equal(b.budgetCents, 700);
    assert.deepEqual(readdirSync(h.config.paths.allowances), ["film.json"], "no temp file is left");
    assert.ok(logs.some((l) => l.startsWith("apps: film may spend $7.00 until ")));
  });
});

test("a link planted at the allowance's name is replaced, never written through", async () => {
  await withAllowance(async ({ h, tmp }) => {
    setCaps(h.config, 3000, 10000);
    mkdirSync(h.config.paths.allowances, { recursive: true, mode: 0o700 });
    const target = join(tmp, "elsewhere.json");
    writeFileSync(target, "kept\n");
    symlinkSync(target, fileOf(h.config));
    assert.equal((await post(h, "/api/apps/film/allowance", { cents: 300 })).status, 200);
    assert.equal(readFileSync(target, "utf8"), "kept\n");
    assert.equal(readAllowance(h.config.paths.allowances, "film").ok, true);
  });
});

test("it ends at the next midnight in Asia/Kolkata: at 23:59 a minute later, at 00:01 a day less a minute", () => {
  // 23:59 IST on 14 November 2026 is 18:29 UTC.
  assert.equal(nextMidnightKolkata(Date.parse("2026-11-14T18:29:00.000Z")), "2026-11-14T18:30:00.000Z");
  // 00:01 IST on 15 November is 18:31 UTC on the 14th.
  assert.equal(nextMidnightKolkata(Date.parse("2026-11-14T18:31:00.000Z")), "2026-11-15T18:30:00.000Z");
  assert.equal(nextMidnightKolkata(Date.parse("2026-11-14T18:30:00.000Z")), "2026-11-15T18:30:00.000Z", "midnight itself starts a new day");
  assert.equal(nextMidnightKolkata(Date.parse("2026-12-31T20:00:00.000Z")), "2027-01-01T18:30:00.000Z");
});

test("written at 23:59 the door takes it for a minute; written at 00:01 it lasts the day, never past 24 hours", async () => {
  await withAllowance(async ({ h }) => {
    const late = Date.parse("2026-11-14T18:29:00.000Z");
    writeAllowance(h.config, "film", 500, late);
    assert.equal(readAllowance(h.config.paths.allowances, "film", late + 30_000).ok, true);
    assert.equal(readAllowance(h.config.paths.allowances, "film", late + 60_000).why, "expired");
    const early = Date.parse("2026-11-14T18:31:00.000Z");
    const a = writeAllowance(h.config, "film", 500, early);
    assert.equal(Date.parse(a.expiresAt) - early, 24 * 3600 * 1000 - 60_000);
    assert.equal(readAllowance(h.config.paths.allowances, "film", early + 23 * 3600 * 1000).ok, true);
  });
});

test("Stop spending removes it: the door then finds none; stopping with none open, or for any listed app, is taken", async () => {
  await withAllowance(async ({ h, logs }) => {
    setCaps(h.config, 3000, 10000);
    assert.equal((await post(h, "/api/apps/film/allowance", { cents: 500 })).status, 200);
    const r = await post(h, "/api/apps/film/allowance/stop");
    assert.equal(r.status, 200);
    assert.equal(film(r.json).spending.open, false);
    assert.equal(existsSync(fileOf(h.config)), false);
    assert.equal(readAllowance(h.config.paths.allowances, "film").why, "missing");
    assert.ok(logs.includes("apps: film may no longer spend"));
    for (const slug of ["film", "talker", "broken"]) assert.equal((await post(h, `/api/apps/${slug}/allowance/stop`)).status, 200, slug);
  });
});

// ---- the words --------------------------------------------------------------------------------------------------------

test("the spending words in dollars: none, then what was allowed and spent with this allowance only", async () => {
  await withAllowance(async ({ h }) => {
    setCaps(h.config, 4000, 100000);
    const at = earlierToday();
    writeLedger(h.config, spend("artist1", at, 1000));
    let s = film(await view(h)).spending;
    assert.deepEqual(s, {
      open: false, budget: 0, spent: 0, left: 0, expiresAt: null, words: "This app cannot spend anything right now.",
      limitLeft: 3000, limitWords: "What is left of today's limit: $30.00.",
    });
    const r = await post(h, "/api/apps/film/allowance", { cents: 500 });
    const id = JSON.parse(readFileSync(fileOf(h.config), "utf8")).id;
    assert.deepEqual(sameShape(readShape("apps"), r.json), []);
    writeLedger(h.config, [...spend("artist1", at, 1000), ...spend("app1", at, 120, { batch: id, slug: "app-film", app: "film" }),
      ...spend("old", at, 300, { batch: "a00000000000000000000", slug: "app-film", app: "film" })]);
    s = film(await view(h)).spending;
    assert.equal(s.open, true);
    assert.deepEqual([s.budget, s.spent, s.left], [500, 120, 380]);
    assert.equal(s.words, "Allowed today: $5.00. Spent: $1.20.");
    assert.equal(s.expiresAt, JSON.parse(readFileSync(fileOf(h.config), "utf8")).expiresAt);
    assert.equal(s.limitWords, "What is left of today's limit: $25.80.");
  });
});

test("what is left is held to the caps as the door holds it; a ledger that cannot be read leaves nothing", async () => {
  await withAllowance(async ({ h }) => {
    setCaps(h.config, 1000, 100000);
    writeLedger(h.config, []);
    assert.equal((await post(h, "/api/apps/film/allowance", { cents: 800 })).status, 200);
    writeLedger(h.config, spend("artist1", earlierToday(), 700));
    let s = film(await view(h)).spending;
    assert.deepEqual([s.budget, s.spent, s.left], [800, 0, 300]);
    writeLedger(h.config, ["{ torn"]);
    s = film(await view(h)).spending;
    assert.deepEqual([s.open, s.left, s.limitLeft], [true, 0, 0]);
    assert.match(s.words, /^Allowed today: \$8\.00\. The spending ledger cannot be read/);
  });
});

test("the helpers: dollars, and capsLeft and spendingOf on a ledger with this month's spend", async () => {
  assert.deepEqual([dollars(0), dollars(5), dollars(120), dollars(10000)], ["$0.00", "$0.05", "$1.20", "$100.00"]);
  await withAllowance(async ({ h }) => {
    setCaps(h.config, 2000, 2500);
    const at = earlierToday();
    writeLedger(h.config, spend("a", at, 900));
    const caps = capsLeft(h.config);
    assert.deepEqual([caps.ok, caps.dayLeft, caps.monthLeft, caps.left], [true, 1100, 1600, 1100]);
    assert.equal(spendingOf(h.config, "film", caps).open, false);
  });
});
