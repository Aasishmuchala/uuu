// App Studio's "Made by the team" list (PLAN-V5 T88): the finished and accepted page tasks' sites, newest first, at
// most 30, each with its picked version (else the only site), a picture only when the home server has kept one, and
// where it opens. Built over a stub home's folders with a made-up task list; nothing is run and nothing is fetched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SITES_MAX, buildAppsView, listSites, sitesFrom } from "../lib/apps.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { forgetSiteShots, siteInfo } from "../lib/siteshots.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { call } from "../lib/testing.mjs";
import { IDS_V2 } from "../../../test/stubs/seed.mjs";

const JOB = "marketing/carousel-from-a-concept";
const SHOT = /^\/api\/sites\/shot\/[0-9a-f]{64}\/shot-[A-Za-z0-9._-]{1,90}-(1280|390)-(light|dark)\.png$/;

// A stub home, its craft file (the job makes pages, or another kind), and helpers to make tasks.
async function withHome(fn, { kind = "page" } = {}) {
  forgetSiteShots();
  const h = await startV2({ routes: ["apps", "pieces"] });
  const tmp = mkdtempSync(join(tmpdir(), "uuu-apps-sites-"));
  try {
    const craft = join(tmp, "craft.json");
    writeFileSync(craft, JSON.stringify({ version: 1, jobs: { [JOB]: { kind, review: "art", variants: 3, playbooks: [] } } }));
    h.app.home.craftFile = craft;
    const root = join(h.state, "tasks", "company-work");
    const decisions = new Map();
    const ctx = { config: h.config, decisions, home: h.app.home };
    const goals = [];
    // task(n, { sites, picked, status, accepted, updatedAt, job }) -> the goal, its folder written.
    const task = (n, { sites = ["launch"], variants = null, picked = null, status = "done", accepted = true, at = n, job = JOB, title = `Page ${n}` } = {}) => {
      const identifier = `STH-${100 + n}`;
      const goal = { id: `id-${n}`, identifier, title, status, updatedAt: new Date(Date.UTC(2026, 10, 1, 0, 0, at)).toISOString() };
      const dir = join(root, identifier);
      mkdirSync(dir, { recursive: true });
      for (const ref of sites) {
        const d = join(dir, "site", ref);
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, "index.html"), `<!doctype html><html lang="en"><title>${ref}</title><h1>${ref}</h1>`);
        writeFileSync(join(d, "about.html"), "<!doctype html><html lang=\"en\"><title>About</title>");
      }
      if (variants) writeFileSync(join(dir, "variants.json"), JSON.stringify(variants));
      if (job) decisions.set(`template:${goal.id}`, job);
      if (accepted) decisions.set(`acknowledged:goal:${goal.id}`, true);
      if (picked) decisions.set(`pick:${goal.id}`, [{ round: 1, variant: picked, direction: "editorial", at: "2026-11-02T00:00:00.000Z", action: "pick" }]);
      goals.push(goal);
      return goal;
    };
    const tctx = () => ({ goals: goals.slice(), accepted: (id) => decisions.get(`acknowledged:goal:${id}`) === true });
    // keep(goal, ref, names) writes the home server's kept pictures of a site (what takeShots would keep).
    const keep = (goal, rel, names) => {
      const info = siteInfo(h.config, goal.identifier, rel);
      const dir = join(h.config.paths.homeData, "shots", info.key);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "report.json"), JSON.stringify({ version: 1, taken: "2026-11-02T00:00:00.000Z", pages: [] }));
      for (const n of names) writeFileSync(join(dir, n), "x");
      return info.key;
    };
    return await fn({ h, ctx, task, tctx, keep, root, decisions });
  } finally {
    await h.close();
    rmSync(tmp, { recursive: true, force: true });
    forgetSiteShots();
  }
}

test("sites: no page tasks gives an empty list", async () => {
  await withHome(async ({ ctx, tctx }) => {
    assert.deepEqual(sitesFrom(ctx, tctx()), []);
  });
});

test("sites: a single site of an accepted page task: task, name, pages, opens", async () => {
  await withHome(async ({ ctx, task, tctx }) => {
    task(1, { sites: ["launch"], title: "A landing page" });
    const [s] = sitesFrom(ctx, tctx());
    assert.deepEqual(s.task, { id: "id-1", identifier: "STH-101", title: "A landing page" });
    assert.equal(s.ref, "launch");
    assert.equal(s.name, "launch");
    assert.equal(s.direction, null);
    assert.deepEqual(s.pages, ["about.html", "index.html"].sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : 0)));
    assert.equal(s.files, 2);
    assert.equal(s.opens, "#/tasks/id-1");
    assert.equal(s.picture, null);
    assert.equal(s.state, "none");
    assert.equal(s.sentence, "No pictures yet");
  });
});

test("sites: one picked of three versions: the pick is the one listed, with its direction", async () => {
  await withHome(async ({ ctx, task, tctx }) => {
    const variants = { kind: "page", name: "launch", round: 1, variants: [{ id: "a", direction: "editorial" }, { id: "b", direction: "gallery" }, { id: "c", direction: "spec-sheet" }] };
    task(1, { sites: ["launch-a", "launch-b", "launch-c"], variants, picked: "b" });
    const list = sitesFrom(ctx, tctx());
    assert.equal(list.length, 1);
    assert.equal(list[0].ref, "launch-b");
    assert.equal(list[0].name, "launch");
    assert.equal(typeof list[0].direction, "string", "the direction's title");
  });
});

test("sites: three versions and no pick are left out; so is a site folder that is missing", async () => {
  await withHome(async ({ ctx, task, tctx }) => {
    const variants = { kind: "page", name: "launch", round: 1, variants: [{ id: "a", direction: "editorial" }, { id: "b", direction: "gallery" }] };
    task(1, { sites: ["launch-a", "launch-b"], variants });
    task(2, { sites: [] });
    assert.deepEqual(sitesFrom(ctx, tctx()), []);
  });
});

test("sites: an unfinished, a sent-back (not accepted), a cancelled and another kind of task are left out", async () => {
  await withHome(async ({ ctx, task, tctx }) => {
    task(1, { status: "in_progress" });
    task(2, { accepted: false });
    task(3, { status: "cancelled" });
    task(4, { job: null });
    task(5, { job: "marketing/other-job" });
    task(6);
    assert.deepEqual(sitesFrom(ctx, tctx()).map((s) => s.task.id), ["id-6"]);
  });
  await withHome(async ({ ctx, task, tctx }) => {
    task(1);
    assert.deepEqual(sitesFrom(ctx, tctx()), [], "the job's craft kind is not page");
  }, { kind: "slides" });
});

test("sites: newest first; 31 tasks keep the newest 30", async () => {
  await withHome(async ({ ctx, task, tctx }) => {
    assert.equal(SITES_MAX, 30);
    for (let n = 1; n <= 31; n++) task(n, { at: n });
    const list = sitesFrom(ctx, tctx());
    assert.equal(list.length, 30);
    assert.equal(list[0].task.id, "id-31");
    assert.equal(list[29].task.id, "id-2");
    assert.ok(!list.some((s) => s.task.id === "id-1"));
    for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].finishedAt >= list[i].finishedAt);
  });
});

test("sites: a picture is listed only when the home server has kept one, and only in the /api/sites/shot/ form", async () => {
  await withHome(async ({ ctx, task, tctx, keep }) => {
    const g = task(1);
    const key = keep(g, "site/launch", ["shot-index-390-light.png", "shot-index-1280-light.png", "shot-about-1280-light.png"]);
    const [s] = sitesFrom(ctx, tctx());
    assert.equal(s.picture, `/api/sites/shot/${key}/shot-index-1280-light.png`, "the first page at desktop width");
    assert.match(s.picture, SHOT);
    assert.equal(s.state, "ready");
    assert.equal(s.sentence, "Pictures ready");
    const g2 = task(2);
    keep(g2, "site/launch", ["shot-index-390-dark.png"]);
    const second = sitesFrom(ctx, tctx()).find((x) => x.task.id === "id-2");
    assert.match(second.picture, SHOT, "another width still gives a picture address");
  });
});

test("sites: a site that cannot be read shows a sentence and no picture; a linked site folder is never followed", async () => {
  await withHome(async ({ ctx, task, tctx, root }) => {
    const g = task(1, { sites: [] });
    const outside = mkdtempSync(join(tmpdir(), "uuu-apps-sites-out-"));
    try {
      writeFileSync(join(outside, "index.html"), "<h1>secret</h1>");
      mkdirSync(join(root, g.identifier, "site"), { recursive: true });
      symlinkSync(outside, join(root, g.identifier, "site", "linked"));
      assert.deepEqual(sitesFrom(ctx, tctx()), [], "a link is not a folder of the task");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
  await withHome(async ({ ctx, task, tctx, root }) => {
    const g = task(1);
    writeFileSync(join(root, g.identifier, "site", "launch", ".env"), "KEY=1");
    const [s] = sitesFrom(ctx, tctx());
    assert.equal(s.picture, null);
    assert.equal(typeof s.sentence, "string");
  });
});

test("sites: an agent's words cannot make an address or a path: odd titles pass as text, refs stay in the list's own form", async () => {
  await withHome(async ({ ctx, task, tctx }) => {
    task(1, { title: "<img src=x onerror=1> ../../etc/passwd" });
    task(2, { sites: ["Bad Name", ".hidden", "..", "ok-site"] });
    const list = sitesFrom(ctx, tctx());
    const two = list.find((s) => s.task.id === "id-2");
    assert.equal(two.ref, "ok-site");
    for (const s of list) {
      assert.match(s.ref, /^[a-z0-9][a-z0-9-]{0,35}(-[abc])?$/);
      assert.match(s.opens, /^#\/tasks\/[A-Za-z0-9%._-]+$/);
      assert.ok(s.picture === null || SHOT.test(s.picture));
    }
    assert.equal(list.find((s) => s.task.id === "id-1").task.title, "<img src=x onerror=1> ../../etc/passwd");
  });
});

test("sites: listSites answers [] on any problem (no board), never throws", async () => {
  assert.deepEqual(await listSites({ config: null }), []);
  assert.deepEqual(await listSites({}), []);
  await withHome(async ({ ctx }) => {
    assert.ok(Array.isArray(await listSites({ ...ctx, board: null, ids: () => null })));
  });
});

test("sites: GET /api/apps carries the list and fits the shape; an accepted page task of the stub board shows", async () => {
  await withHome(async ({ h }) => {
    const r = await call(h.url, "GET", "/api/apps");
    assert.equal(r.status, 200, r.text);
    assert.ok(Array.isArray(r.json.sites));
    assert.deepEqual(sameShape(readShape("apps"), r.json), []);
  });
  const h = await startV2({ routes: ["apps", "pieces"], decisions: { [`template:${IDS_V2.issues["STH-2"]}`]: JOB, [`acknowledged:goal:${IDS_V2.issues["STH-2"]}`]: true } });
  const tmp = mkdtempSync(join(tmpdir(), "uuu-apps-sites-"));
  try {
    const craft = join(tmp, "craft.json");
    writeFileSync(craft, JSON.stringify({ version: 1, jobs: { [JOB]: { kind: "page", review: "art", variants: 3, playbooks: [] } } }));
    h.app.home.craftFile = craft;
    const dir = join(h.state, "tasks", "company-work", "STH-2", "site", "launch");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), "<!doctype html><html lang=\"en\"><title>x</title>");
    const r = await call(h.url, "GET", "/api/apps");
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.sites.length, 1, r.text);
    assert.equal(r.json.sites[0].task.identifier, "STH-2");
    assert.deepEqual(sameShape(readShape("apps"), r.json), []);
    const view = await buildAppsView({ config: h.config, decisions: h.app.decisions, home: h.app.home, ids: () => null });
    assert.deepEqual(view.sites, [], "no company ids: an empty list, the rest of the view as before");
  } finally {
    await h.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});
