// GET /api/home (CONTRACTS-V2 17.2) against the stub board and the version 2 seed, and the pure brief parser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boardSeedV2, copyStateSeedV2 } from "../../../test/stubs/seed.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { computeBrief, parseBrief } from "../routes/_brief.mjs";

const MODULES = { routes: ["home.mjs", "inbox.mjs"], inbox: ["goals.mjs"] };

async function withHome(fn, { seed, ...opts } = {}) {
  const h = await startV2({ ...MODULES, boardSeed: seed || boardSeedV2(), ...opts });
  try {
    copyStateSeedV2(h.state);
    return await fn(h);
  } finally { await h.close(); }
}
const home = async (h) => (await call(h.url, "GET", "/api/home")).json;
const briefFile = (h) => join(h.state, "tasks", "company-work", "STH-14", "brief.md");
const todayIso = () => new Date().toISOString().slice(0, 10);

test("home: the seed fits the shape and Needs you carries STH-8's delivery", async () => {
  await withHome(async (h) => {
    const r = await call(h.url, "GET", "/api/home");
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("home"), r.json), []);
    const item = r.json.needsYou.items.find((i) => i.identifier === "STH-8");
    assert.ok(item, "STH-8's delivery is in Needs you");
    assert.match(item.taskId, /^e0000000/);
    assert.equal(item.agent.slug, "chief-of-staff");
    assert.equal(r.json.company.name, "Sthyra");
    assert.equal(r.json.boardOff, null);
    assert.ok(r.json.needsYou.total >= r.json.needsYou.items.length);
  });
});

test("home: running holds STH-15 (live) before STH-1", async () => {
  await withHome(async (h) => {
    const run = (await home(h)).running;
    const ids = run.map((r) => r.identifier);
    assert.ok(ids.includes("STH-15") && ids.includes("STH-1"));
    assert.ok(ids.indexOf("STH-15") < ids.indexOf("STH-1"));
    const t15 = run.find((r) => r.identifier === "STH-15");
    assert.equal(t15.live, true);
    assert.equal(t15.who.slug, "marketer");
    assert.ok(Date.parse(t15.since) > 0);
    assert.ok(run.length <= 10);
  });
});

test("home: the seeded brief gives three items from the routine", async () => {
  await withHome(async (h) => {
    const b = (await home(h)).brief;
    assert.equal(b.from, "routine");
    assert.equal(b.date, "2026-11-11");
    assert.equal(b.items.length, 3);
    assert.equal(b.items[0].title, "Two drafts are waiting in Marketing");
    assert.equal(b.items[0].who.slug, "marketer");
    assert.equal(b.items[0].about.label, "STH-2");
    assert.equal(b.items[0].about.link.page, "tasks");
    assert.equal(b.items[1].about.label, "Books");
    assert.equal(b.items[1].about.link.page, "books");
  });
});

test("home: without brief.md the brief is computed and has Who is working", async () => {
  await withHome(async (h) => {
    rmSync(briefFile(h));
    // a lesson dated today, so the quiet-day title does not apply
    appendFileSync(join(h.state, "lessons", "builder.md"), `- ${todayIso()}: Check the totals twice.\n`);
    const b = (await home(h)).brief;
    assert.equal(b.from, "computed");
    assert.ok(b.items.some((i) => i.title === "Who is working" && /^\d+ of \d+ agents are working right now\.$/.test(i.text)));
    const learned = b.items.find((i) => i.title === "Builder learned something");
    assert.equal(learned.about.link.page, "team");
  });
});

test("home: a brief changed 40 hours ago is not used", async () => {
  await withHome(async (h) => {
    const old = new Date(Date.now() - 40 * 3600e3);
    utimesSync(briefFile(h), old, old);
    assert.equal((await home(h)).brief.from, "computed");
  });
});

test("home: an item with no by line is dropped", async () => {
  await withHome(async (h) => {
    writeFileSync(briefFile(h), [
      "# Daily brief: 2026-11-11", "## Kept", "by: Marketer", "about: company", "Fine.",
      "## Lost", "about: company", "No author.",
    ].join("\n"));
    const b = (await home(h)).brief;
    assert.equal(b.from, "routine");
    assert.deepEqual(b.items.map((i) => i.title), ["Kept"]);
    assert.equal(b.items[0].about.link, null);
  });
});

test("home: a brief.md that is a link is ignored", async () => {
  await withHome(async (h) => {
    const target = join(h.state, "outside-brief.md");
    writeFileSync(target, "# Daily brief: 2026-11-11\n## X\nby: Marketer\nabout: company\ntext\n");
    rmSync(briefFile(h));
    symlinkSync(target, briefFile(h));
    assert.equal((await home(h)).brief.from, "computed");
  });
});

test("home: the newest valid brief wins", async () => {
  await withHome(async (h) => {
    const other = join(h.state, "tasks", "company-work", "STH-8", "brief.md");
    writeFileSync(other, "# Daily brief: 2026-11-12\n## Newer\nby: Support\nabout: support\nHello.\n");
    const later = new Date(Date.now() + 1000);
    utimesSync(other, later, later);
    const b = (await home(h)).brief;
    assert.equal(b.date, "2026-11-12");
    assert.equal(b.items[0].title, "Newer");
  });
});

test("home: parseBrief returns at once on a file of 100,000 hash marks, and on a wrong first line", () => {
  const t0 = process.hrtime.bigint();
  assert.deepEqual(parseBrief("#".repeat(100000)), { date: null, items: [] });
  const wide = `# Daily brief: 2026-11-11\n${"## a\nby: x\nabout: y\n".repeat(5000)}${"#".repeat(100000)}`;
  assert.equal(parseBrief(wide).items.length, 8);
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 200);
  assert.deepEqual(parseBrief("hello\n## A\nby: x\nabout: y"), { date: null, items: [] });
});

test("home: computeBrief orders finished, lessons, then who is working; quiet day when nothing else", () => {
  const now = Date.parse("2026-11-11T10:00:00Z");
  const out = computeBrief({
    now, working: 2, total: 10,
    accepted: [
      { id: "i1", identifier: "STH-8", title: "Sprite", result: "x".repeat(300), at: "2026-11-11T08:00:00Z" },
      { id: "i2", identifier: "STH-9", title: "Old", result: "y", at: "2026-11-09T08:00:00Z" },
    ],
    lessons: [
      { slug: "marketer", name: "Marketer", text: "Plan dates.", date: "2026-11-10" },
      { slug: "builder", name: "Builder", text: "Too old.", date: "2026-11-08" },
    ],
  });
  assert.deepEqual(out.items.map((i) => i.title), ["Finished: Sprite", "Marketer learned something", "Who is working"]);
  assert.equal(out.items[0].text.length, 200);
  assert.equal(out.items[2].text, "2 of 10 agents are working right now.");
  assert.equal(computeBrief({ now, working: 0, total: 10 }).items[0].title, "A quiet day");
});

test("home: with the board off the answer is 200 with boardOff set", async () => {
  await withHome(async (h) => {
    const r = await call(h.url, "GET", "/api/home");
    assert.equal(r.status, 200);
    assert.ok(r.json.boardOff.reason && r.json.boardOff.next);
    assert.deepEqual(r.json.running, []);
    assert.equal(r.json.brief.from, "computed");
    assert.deepEqual(r.json.brief.items, []);
    assert.equal(r.json.brief.date, todayIso());
    assert.deepEqual(sameShape(readShape("home"), r.json), []);
  }, { urls: { board: "http://127.0.0.1:1" } });
});

test("home: more than 20 inbox items are cut to 20 and total is right", async () => {
  const seed = boardSeedV2();
  const proto = seed.issues.find((i) => i.identifier === "STH-2");
  for (let n = 0; n < 25; n++) {
    const num = 200 + n;
    seed.issues.push({
      ...proto, id: `e0000000-0000-4000-8000-000000000${num}`, identifier: `STH-${num}`, issueNumber: num,
      title: `Extra goal ${n}`, status: "done",
    });
  }
  await withHome(async (h) => {
    const r = await home(h);
    const inbox = (await call(h.url, "GET", "/api/inbox")).json;
    assert.equal(r.needsYou.items.length, 20);
    assert.equal(r.needsYou.total, inbox.counts.total);
    assert.ok(r.needsYou.total >= 25);
  }, { seed });
});
