// GET /api/map and GET /api/map/:department (CONTRACTS-V3 33.2) on the version 3 seed, with only the map
// route and the two inbox sources the seed's Needs-you items come from.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { benchSeed } from "../../../test/stubs/seed.mjs";
import { brainToken } from "../lib/brainfiles.mjs";
import { forgetNeeds } from "../lib/jobs.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { call, writes } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { whenWords } from "../routes/map.mjs";

const issueId = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SEVEN = ["operations", "sales", "marketing", "studio", "support", "people", "books"];
const OPTIONS = { routes: ["map"], inbox: ["board", "goals"] };

let h;
before(async () => { h = await startV2(OPTIONS); });
after(async () => { await h?.close(); });

const get = async (home, path) => {
  const r = await call(home.url, "GET", path);
  return { status: r.status, body: r.json };
};
const jobOf = (map, id) => map.departments.flatMap((d) => d.clusters.flatMap((c) => c.jobs)).find((j) => j.id === id);

async function withHome(options, fn) {
  const home = await startV2({ ...OPTIONS, ...options });
  try { return await fn(home); } finally { await home.close(); }
}

test("GET /api/map fits shape map: the seven departments in file order, each with all its clusters", async () => {
  forgetNeeds();
  const { status, body } = await get(h, "/api/map");
  assert.equal(status, 200);
  assert.deepEqual(sameShape(readShape("map"), body), []);
  assert.deepEqual(body.departments.map((d) => d.id), SEVEN);
  assert.deepEqual(body.departments.find((d) => d.id === "marketing").clusters.map((c) => c.id), ["ideas", "writing", "design", "review"]);
  assert.equal(body.departments.reduce((n, d) => n + d.counts.jobs, 0), 60);
  assert.equal(body.departments.reduce((n, d) => n + d.clusters.length, 0), 22);
  assert.equal(body.company.name, "Sthyra");
  assert.equal(body.boardOff, null);
  assert.deepEqual(body.problems, []);
  assert.deepEqual(body.departments.find((d) => d.id === "studio").agents, [{ slug: "drafter", name: "Drafter" }, { slug: "artist", name: "Artist" }]);
  assert.deepEqual(writes(h.board), [], "reading the map writes nothing");
});

test("GET /api/map: STH-21 shows as working on sales/proposal-from-a-call and on the Sales hub", async () => {
  const { body } = await get(h, "/api/map");
  const j = jobOf(body, "sales/proposal-from-a-call");
  assert.equal(j.working, 1);
  assert.equal(j.needsYou, 0);
  const sales = body.departments.find((d) => d.id === "sales");
  assert.ok(sales.counts.working >= 1, "the Sales agent has a live run");
  assert.equal(jobOf(body, "sales/call-write-up").working, 0, "an accepted task is not working");
  assert.equal(jobOf(body, "sales/record-a-new-lead").working, 0);
  assert.ok(body.counts.running >= 1);
  assert.ok(body.counts.needsYou >= 1);
});

test("GET /api/map: the brain is asking STH-22, with the seed's answer waiting and the basics counted", async () => {
  const { body } = await get(h, "/api/map");
  assert.equal(body.brain.asking.id, issueId(22));
  assert.equal(body.brain.asking.question, "Do we charge for delivery?");
  assert.ok(Number.isFinite(Date.parse(body.brain.asking.since)));
  assert.equal(body.brain.unread, 1, "STH-19's answer waits in Needs you");
  assert.deepEqual(body.brain.basics, { filled: 3, total: 9 });
  assert.ok(body.brain.files >= 9);
});

test("GET /api/map: internet is never ready; account neither; each with its pinned sentence", async () => {
  const { body } = await get(h, "/api/map");
  const find = jobOf(body, "sales/find-companies-to-approach");
  assert.equal(find.ready, false);
  assert.deepEqual(find.why, { name: "internet", text: "The web door is off. Switch it on in Settings.", link: { page: "settings", id: null } });
  const publish = jobOf(body, "marketing/publish-approved-posts");
  assert.equal(publish.why.text, "Sending and publishing are switched off. Connect an account first.");
  assert.equal(jobOf(body, "books/draft-a-quotation").ready, true, "the seed's books allow quotations");
});

test("GET /api/map: a must file that is not filled makes its job not ready, with the pinned sentence and a link to it", async () => {
  const file = join(h.state, "knowledge", "docs", "pricing", "services.md");
  const original = readFileSync(file);
  const before = (await get(h, "/api/map")).body;
  assert.equal(jobOf(before, "books/draft-a-quotation").ready, true);
  writeFileSync(file, "# What we sell\n\n## What do you sell?\n(not filled in yet)\n");
  try {
    const { body } = await get(h, "/api/map");
    const q = jobOf(body, "books/draft-a-quotation");
    assert.equal(q.ready, false);
    assert.deepEqual(q.why, { name: "reads", text: 'Fill in "What we sell" first.', link: { page: "files", id: brainToken("pricing/services.md") } });
    assert.equal(body.brain.basics.filled, 2);
    const p = jobOf(body, "sales/proposal-from-a-call");
    assert.equal(p.why.text, 'Fill in "What we sell" first.', "the first must file that is not filled");
  } finally {
    writeFileSync(file, original);
  }
  const after = (await get(h, "/api/map")).body;
  assert.equal(jobOf(after, "books/draft-a-quotation").ready, true);
  assert.equal(jobOf(after, "sales/proposal-from-a-call").why.text, 'Fill in "Terms" first.');
});

test("GET /api/map: quotations: false in the bench seed gives the pinned sentence", async () => {
  forgetNeeds();
  await withHome({ benchSeed: benchSeed({ quotations: false }) }, async (home) => {
    const { status, body } = await get(home, "/api/map");
    assert.equal(status, 200);
    for (const id of ["books/draft-a-quotation", "books/quotation-from-a-call", "books/invoice-from-a-quotation"]) {
      const j = jobOf(body, id);
      assert.equal(j.ready, false, id);
      assert.deepEqual(j.why, { name: "quotations", text: "The books do not let the Bookkeeper draft quotations yet.", link: { page: "health", id: null } }, id);
    }
    assert.equal(jobOf(body, "books/draft-an-invoice").ready, true);
  });
});

test("GET /api/map: with the books not installed, a books job says the books are switched off", async () => {
  forgetNeeds();
  await withHome({ benchInstalled: false }, async (home) => {
    const { body } = await get(home, "/api/map");
    assert.equal(jobOf(body, "books/draft-a-quotation").why.text, "The books are switched off.", "books comes before quotations");
    assert.equal(jobOf(body, "books/what-customers-owe").why.name, "books");
  });
});

test("GET /api/map: the board off gives 200, zeros everywhere and boardOff", async () => {
  await withHome({}, async (home) => {
    await home.board.close();
    const { status, body } = await get(home, "/api/map");
    assert.equal(status, 200);
    assert.deepEqual(sameShape(readShape("map"), body), []);
    assert.equal(typeof body.boardOff.reason, "string");
    assert.equal(typeof body.boardOff.next, "string");
    assert.ok(!/paperclip|http|127\.0\.0\.1|\d{4,5}/i.test(`${body.boardOff.reason} ${body.boardOff.next}`), "plain words only");
    for (const d of body.departments) {
      assert.equal(d.counts.working, 0, d.id);
      assert.equal(d.counts.needsYou, 0, d.id);
      for (const c of d.clusters) for (const j of c.jobs) assert.deepEqual([j.working, j.needsYou], [0, 0], j.id);
    }
    assert.deepEqual(body.counts, { needsYou: 0, running: 0 });
    assert.equal(body.brain.asking, null);
    assert.equal(body.brain.unread, 0);
    assert.equal(body.departments.length, 7);
    const one = await get(home, "/api/map/sales");
    assert.equal(one.status, 200);
    assert.deepEqual(one.body.recent, []);
    assert.equal(one.body.recentTotal, 0);
    assert.equal(one.body.department.state.id, "idle");
  });
});

test("GET /api/map: a broken job file is listed under problems and does not break the map", async () => {
  await withHome({}, async (home) => {
    const dir = mkdtempSync(join(tmpdir(), "uuu-engine-"));
    const was = home.config.engineDir;
    try {
      cpSync(join(was, "company"), join(dir, "company"), { recursive: true, filter: (p) => !p.includes(join("company", "test")) });
      writeFileSync(join(dir, "company", "jobs", "sales", "broken.json"), "{ not json");
      home.config.engineDir = dir;
      const { status, body } = await get(home, "/api/map");
      assert.equal(status, 200);
      assert.deepEqual(body.problems, [{ file: "sales/broken.json", problem: "It is not valid JSON." }]);
      assert.equal(body.departments.find((d) => d.id === "sales").counts.jobs, 9);
      assert.deepEqual(sameShape(readShape("map"), body), []);
    } finally {
      home.config.engineDir = was;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("GET /api/map/sales fits shape department: its jobs, agents, recent tasks and neighbours", async () => {
  const { status, body } = await get(h, "/api/map/sales");
  assert.equal(status, 200);
  assert.deepEqual(sameShape(readShape("department"), body), []);
  assert.deepEqual(sameShape(readShape("task-card"), body.recent[0]), []);
  assert.equal(body.department.id, "sales");
  assert.equal(body.department.dashboard, "customers");
  assert.deepEqual(body.department.counts.jobs, 9);
  assert.deepEqual(body.agents.map((a) => a.slug), ["sales"]);
  assert.deepEqual(body.clusters.map((c) => c.id), ["leads", "calls", "deals"]);
  assert.deepEqual(body.clusters[1].jobs.map((j) => j.id), ["sales/briefing-before-a-call", "sales/call-write-up", "sales/proposal-from-a-call"]);
  assert.deepEqual(body.recent.map((c) => c.identifier), ["STH-21", "STH-20"]);
  assert.equal(body.recentTotal, 2);
  assert.ok(body.recent.every((c) => c.department === "sales"));
  assert.deepEqual(body.neighbours, { prev: { id: "operations", title: "Operations" }, next: { id: "marketing", title: "Marketing" } });
  assert.deepEqual(body.department.state, { id: "working", plain: "Working on: Proposal from a call write-up", taskId: issueId(21) });
});

test("GET /api/map/:department: neighbours wrap; recent holds at most 10; an idle department says so", async () => {
  const ops = (await get(h, "/api/map/operations")).body;
  assert.equal(ops.neighbours.prev.id, "books");
  const books = (await get(h, "/api/map/books")).body;
  assert.equal(books.neighbours.next.id, "operations");
  assert.ok(ops.recent.length <= 10);
  assert.ok(ops.recentTotal >= ops.recent.length);
  for (const id of SEVEN) {
    const { status, body } = await get(h, `/api/map/${id}`);
    assert.equal(status, 200, id);
    assert.deepEqual(sameShape(readShape("department"), body), [], id);
    assert.ok(["waiting", "working", "idle"].includes(body.department.state.id), id);
    if (body.department.state.id === "waiting") assert.equal(body.department.state.plain, "Waiting for you");
    if (body.department.state.id === "idle") assert.match(body.department.state.plain, /^Idle( · last active .+)?$/);
  }
});

test("GET /api/map/:department: an unknown department is 404 department_not_found", async () => {
  for (const id of ["nowhere", "customers", "..", "%2e%2e"]) {
    const r = await call(h.url, "GET", `/api/map/${id}`);
    assert.equal(r.status, 404, id);
    if (r.json?.error?.code !== "not_found") assert.equal(r.json.error.code, "department_not_found", id);
  }
  const r = await call(h.url, "GET", "/api/map/nowhere");
  assert.equal(r.json.error.code, "department_not_found");
  assert.equal(typeof r.json.error.message, "string");
});

test("whenWords: plain words for how long ago", () => {
  const now = Date.parse("2026-11-12T12:00:00.000Z");
  const ago = (ms) => new Date(now - ms).toISOString();
  assert.equal(whenWords(ago(10 * 1000), now), "just now");
  assert.equal(whenWords(ago(60 * 1000), now), "1 minute ago");
  assert.equal(whenWords(ago(5 * 60 * 1000), now), "5 minutes ago");
  assert.equal(whenWords(ago(2 * 3600 * 1000), now), "2 hours ago");
  assert.equal(whenWords(ago(30 * 3600 * 1000), now), "yesterday");
  assert.equal(whenWords(ago(3 * 86400 * 1000), now), "3 days ago");
  assert.equal(whenWords("2026-01-05T00:00:00.000Z", now), "on 5 Jan 2026");
  assert.equal(whenWords("not a date", now), null);
});
