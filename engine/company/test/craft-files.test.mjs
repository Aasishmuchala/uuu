// Tests for engine/company/lib/craft-files.mjs (CONTRACTS-V5 K7, K9) and the files in brand/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { directionsFor, estimateMinutes, loadCraft, loadDirections, loadFiller, loadTiming, pickDirections } from "../lib/craft-files.mjs";
import { loadJobFiles } from "../lib/job-files.mjs";
import { loadDepartmentFile } from "../lib/department-file.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPANY = join(HERE, "..");
const BRAND = join(COMPANY, "brand");
const ids = (l) => l.map((d) => d.id);

test("time: size L, two agents, three versions, art review is 65.8 minutes, About 55 to 100", () => {
  const r = estimateMinutes({ size: "L", who: ["a", "b"], versions: 3, review: "art", timing: loadTiming(join(BRAND, "timing.json")) });
  assert.ok(Math.abs(r.minutes - 65.8) < 1e-9);
  assert.equal(r.words, "About 55 to 100 minutes");
  assert.deepEqual([r.low, r.high], [55, 100]);
});

test("time: the same with one version is 35 minutes, About 30 to 55", () => {
  const r = estimateMinutes({ size: "L", who: 2, versions: 1, review: "art" });
  assert.equal(r.minutes, 35);
  assert.equal(r.words, "About 30 to 55 minutes");
});

test("time: size S, one agent, no craft is 8 minutes, About 5 to 10", () => {
  const r = estimateMinutes({ size: "S", who: [], versions: 1, review: false });
  assert.equal(r.minutes, 8);
  assert.equal(r.words, "About 5 to 10 minutes");
});

test("every kind has five distinct ids, and the aliases give their kind's list", () => {
  const d = loadDirections(join(BRAND, "directions.json"));
  assert.deepEqual(Object.keys(d.kinds).sort(), ["carousel", "film", "page", "post", "title-card"]);
  for (const [k, list] of Object.entries(d.kinds)) {
    assert.equal(list.length, 5, k);
    assert.equal(new Set(ids(list)).size, 5, k);
    for (const x of list) assert.equal(x.title, x.id[0].toUpperCase() + x.id.slice(1).replace(/-/g, " "), x.id);
  }
  assert.deepEqual(ids(directionsFor("newsletter")), ids(directionsFor("post")));
  assert.deepEqual(ids(directionsFor("poster")), ids(directionsFor("carousel")));
  assert.deepEqual(directionsFor("nothing"), []);
});

test("pickDirections: round one is the first three", () => {
  assert.deepEqual(ids(pickDirections({ kind: "carousel", used: [], kept: null })), ["type-led", "picture-led", "diagram-led"]);
  assert.deepEqual(ids(pickDirections({ kind: "poster" })), ["type-led", "picture-led", "diagram-led"]);
});

test("pickDirections: a kept direction stays and the others are the first untried", () => {
  assert.deepEqual(ids(pickDirections({ kind: "post", used: [], kept: "list" })), ["list", "fact-first", "scene"]);
  assert.deepEqual(ids(pickDirections({ kind: "post", used: [], kept: "scene" })), ["fact-first", "scene", "question"]);
  assert.deepEqual(ids(pickDirections({ kind: "post", used: [], kept: "not-real" })), ["fact-first", "scene", "question"]);
});

test("pickDirections: a second round uses directions not yet used", () => {
  const r = pickDirections({ kind: "page", used: ["editorial", "gallery", "spec-sheet"], kept: "index" });
  assert.equal(r.length, 3);
  assert.deepEqual(ids(r).slice(0, 2), ["story-scroll", "index"]);
  assert.equal(r[2].again, true);
  const first = pickDirections({ kind: "film", used: ["people-first"], kept: null });
  assert.deepEqual(ids(first), ["slow-approach", "detail-to-whole", "day-of-light"]);
});

test("pickDirections: with fewer than three left, the best earlier one is done again", () => {
  const used = [{ id: "fact-first", total: 50 }, { id: "scene", total: 58 }, { id: "question", total: 44 }];
  const r = pickDirections({ kind: "post", used });
  assert.deepEqual(ids(r), ["contrast", "list", "scene"]);
  assert.deepEqual(r.map((d) => !!d.again), [false, false, true]);
  const one = pickDirections({ kind: "post", used: ["fact-first", "scene", "question", "contrast"] });
  assert.equal(one.length, 3);
  assert.equal(one[0].id, "list");
  assert.equal(new Set(ids(one)).size, 3);
  assert.equal(one[1].again, true);
});

test("filler.json: at least 40 hard and 30 soft, lower case, 2 to 60 characters, no digit, rupee sign or percent", () => {
  const f = loadFiller(join(BRAND, "filler.json"));
  assert.ok(f.hard.length >= 40 && f.soft.length >= 30);
  const all = [...f.hard, ...f.soft];
  assert.equal(new Set(all).size, all.length, "no phrase twice");
  for (const p of all) {
    assert.ok(p.length >= 2 && p.length <= 60, p);
    assert.equal(p, p.toLowerCase(), p);
    assert.doesNotMatch(p, /[0-9₹%]/, p);
  }
  for (const p of ["in today's fast-paced world", "elevate your", "unlock the power", "seamless experience", "game-changer", "look no further", "more than just a"]) {
    assert.ok(f.hard.includes(p), p);
  }
});

test("the loaders of the three plain files say one plain sentence for a bad file", () => {
  const dir = mkdtempSync(join(tmpdir(), "uuu-craft-"));
  try {
    const w = (n, v) => { const f = join(dir, n); writeFileSync(f, typeof v === "string" ? v : JSON.stringify(v)); return f; };
    assert.throws(() => loadDirections(w("d1.json", "{")), /^Error: directions\.json: .*\.$/);
    assert.throws(() => loadDirections(join(dir, "none.json")), /missing/);
    assert.throws(() => loadDirections(w("d2.json", { version: 1, kinds: { post: [{ id: "a", title: "A", what: "x" }] } })), /at least three/);
    assert.throws(() => loadTiming(w("t1.json", { plan: 4 })), /step/);
    assert.throws(() => loadFiller(w("f1.json", { hard: ["Upper case phrase"], soft: [] })), /at least 40/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadCraft: a missing file is an empty map; the real file loads clean when no job refs are given", () => {
  const none = loadCraft(join(tmpdir(), "uuu-no-such-craft.json"), []);
  assert.equal(none.jobs.size, 0);
  assert.deepEqual(none.problems, []);
  // With no refs every entry names an unknown job (T17 filled the table, T43 added the film, T53 the three pages); the full
  // check is craft-table.test.mjs.
  const real = loadCraft(join(BRAND, "craft.json"), []);
  assert.equal(real.jobs.size, 0);
  assert.equal(real.problems.length, 15);
});

test("loadCraft: a good entry loads; a bad kind, a fifth playbook and an unknown job are each one sentence and left out", () => {
  const dir = mkdtempSync(join(tmpdir(), "uuu-craft-"));
  try {
    const f = join(dir, "craft.json");
    const ok = { kind: "carousel", review: "art", variants: 3, playbooks: ["a", "b-c"] };
    writeFileSync(f, JSON.stringify({ version: 1, jobs: {
      "studio/good": ok,
      "studio/badkind": { ...ok, kind: "banner" },
      "studio/five": { ...ok, playbooks: ["a", "b", "c", "d", "e"] },
      "studio/ghost": ok,
      "studio/badrev": { ...ok, review: "maybe" },
      "studio/badvar": { ...ok, variants: 2 },
      "studio/badname": { ...ok, playbooks: ["Bad Name"] },
    } }));
    const refs = ["studio/good", "studio/badkind", "studio/five", "studio/badrev", "studio/badvar", "studio/badname"];
    const { jobs, problems } = loadCraft(f, refs);
    assert.deepEqual([...jobs.keys()], ["studio/good"]);
    assert.deepEqual(jobs.get("studio/good"), ok);
    assert.equal(problems.length, 6);
    for (const p of problems) assert.match(p, /^craft\.json, "studio\/[a-z]+": [^\n]*\.$/);
    assert.ok(problems.some((p) => /badkind.*kind must be one of/.test(p)));
    assert.ok(problems.some((p) => /five.*more than four playbooks/.test(p)));
    assert.ok(problems.some((p) => /ghost.*no job has that name/.test(p)));
    writeFileSync(f, "not json");
    assert.deepEqual(loadCraft(f, refs).problems, ["craft.json is not valid JSON."]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Craft never goes into a job file (K7, rule 11): PLAN-V5 T34 changed job files on purpose (the research jobs and the
// hand-ons to them), so what is checked is that no job file carries a key of craft.json; that the files as saved
// load in the loaders of the last commit is checked in company-file.test.mjs.
test("the real job files give no problem, craft.json names only jobs that exist, and no job file holds a craft key", () => {
  const roles = JSON.parse(readFileSync(join(COMPANY, "company.json"), "utf8")).agents.map((a) => ({ slug: a.slug, name: a.name }));
  const { departments } = loadDepartmentFile(join(COMPANY, "departments.json"), roles);
  const { jobs, problems } = loadJobFiles(join(COMPANY, "jobs"), roles, departments);
  assert.deepEqual(problems, []);
  assert.equal(jobs.length, 72);
  const refs = jobs.map((j) => j.file.replace(/\.json$/, ""));
  const c = loadCraft(join(BRAND, "craft.json"), refs);
  assert.deepEqual(c.problems, []);
  for (const j of jobs) {
    const raw = JSON.parse(readFileSync(join(COMPANY, "jobs", j.file), "utf8"));
    for (const k of ["craft", "kind", "review", "variants", "playbooks"]) assert.equal(k in raw, false, `${j.file}: ${k}`);
  }
});
