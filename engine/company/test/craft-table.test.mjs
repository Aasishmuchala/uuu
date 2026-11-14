// Tests for engine/company/brand/craft.json (CONTRACTS-V5 K7, T17) and the job "Read the brand book":
// every playbook named is in the manifest, the twelve entries carry exactly their values, every
// key is a job that exists, and every job file still loads in the loader as it was at commit
// faf7f1b and as it is at the last commit (the running home screen keeps that code and reads the
// job files fresh: rule 11). PLAN-V5 T43 adds the film and the two still jobs; T53 the three page jobs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadCraft } from "../lib/craft-files.mjs";
import { loadJobFiles } from "../lib/job-files.mjs";
import { loadDepartmentFile } from "../lib/department-file.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPANY = join(HERE, "..");
const ROOT = join(COMPANY, "..", "..");
const CRAFT = join(COMPANY, "brand", "craft.json");
const BOOK = "operations/read-the-brand-book";

const craft = JSON.parse(readFileSync(CRAFT, "utf8"));
const roles = JSON.parse(readFileSync(join(COMPANY, "company.json"), "utf8")).agents.map((a) => ({ slug: a.slug, name: a.name }));
const { departments } = loadDepartmentFile(join(COMPANY, "departments.json"), roles);
const real = loadJobFiles(join(COMPANY, "jobs"), roles, departments);
const refs = real.jobs.map((j) => j.file.replace(/\.json$/, ""));

const COPY = ["sthyra-copywriting", "storycraft"];
const DESIGN = ["aasish-design", "impact-3d"];
const WANT = {
  "marketing/carousel-from-a-concept": ["carousel", "art", 3, ["sthyra-copywriting", "aasish-design", "creative-director"]],
  "marketing/carousel-from-a-document": ["carousel", "art", 3, ["sthyra-copywriting", "aasish-design", "creative-director"]],
  "marketing/announce-one-thing": ["post", "art", 3, COPY],
  "marketing/a-week-of-posts": ["post", "art", 1, COPY],
  "marketing/posts-from-one-document": ["post", "art", 1, COPY],
  "marketing/a-newsletter-on-one-subject": ["newsletter", "art", 3, COPY],
  "marketing/five-concepts": ["post", "none", 1, ["creative-director", "storycraft"]],
  "studio/an-animated-title-card": ["title-card", "art", 3, DESIGN],
  "studio/a-moving-chart-from-figures": ["title-card", "art", 1, DESIGN],
  "studio/a-badge-or-logo-mark": ["poster", "art", 1, ["aasish-design", "lightcraft"]],
  "studio/a-slow-reveal-from-pictures": ["title-card", "art", 1, ["aasish-design", "lightcraft"]],
  "studio/a-film-from-your-renders": ["film", "art", 3, ["shotlist-director", "sthyra-cinematic", "archfilm-edit", "cinematic-ai-film"]],
  // PLAN-V5 T53: the three page jobs, each three versions with an art review.
  "marketing/a-landing-page": ["page", "art", 3, ["aasish-design", "impeccable", "taste-skill", "sthyra-copywriting"]],
  "marketing/a-project-page": ["page", "art", 3, ["aasish-design", "impeccable", "taste-skill", "sthyra-copywriting"]],
  "marketing/a-small-site": ["page", "art", 3, ["aasish-design", "impeccable", "taste-skill", "frontend-ui-engineering"]],
};
// PLAN-V5 T43: the film has craft; the two still jobs make no piece to review, so they have none.
const STEP3 = ["studio/a-film-from-your-renders", "studio/variations-of-a-still", "studio/a-larger-sharper-still"];
// PLAN-V5 T53: the page jobs, in Marketing (C20).
const STEP4 = ["marketing/a-landing-page", "marketing/a-project-page", "marketing/a-small-site"];

test("the craft table has fifteen entries and the loader finds no problem in it", () => {
  assert.equal(Object.keys(craft.jobs).length, 15);
  const c = loadCraft(CRAFT, refs);
  assert.deepEqual(c.problems, []);
  assert.equal(c.jobs.size, 15);
  assert.ok(!("studio/variations-of-a-still" in craft.jobs) && !("studio/a-larger-sharper-still" in craft.jobs), "the still jobs have no entry");
});

test("the jobs named carry exactly their kind, review, versions and playbooks, in order", () => {
  assert.deepEqual(Object.keys(craft.jobs).sort(), Object.keys(WANT).sort());
  for (const [ref, [kind, review, variants, playbooks]] of Object.entries(WANT)) {
    assert.deepEqual(craft.jobs[ref], { kind, review, variants, playbooks }, ref);
  }
});

test("every playbook named is in the playbook manifest and serves the entry's kind", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "engine", "playbooks", "manifest.json"), "utf8"));
  const byName = new Map(manifest.playbooks.map((p) => [p.name, p]));
  for (const [ref, e] of Object.entries(craft.jobs)) {
    assert.ok(e.playbooks.length >= 2 && e.playbooks.length <= 4, `${ref} names two to four playbooks`);
    for (const name of e.playbooks) {
      assert.ok(byName.has(name), `${ref}: ${name} is in the manifest`);
      assert.ok(byName.get(name).kinds.includes(e.kind), `${ref}: ${name} serves the kind ${e.kind}`);
    }
  }
});

test("every key of the table is a job that exists, and no other job has an entry", () => {
  for (const ref of Object.keys(craft.jobs)) assert.ok(refs.includes(ref), `${ref} is a job`);
  assert.deepEqual(real.problems, []);
});

test("the job Read the brand book: the Builder, size S, you approve, one file from Brand, and its text names the proposal's shape", () => {
  const job = real.jobs.find((j) => j.file === `${BOOK}.json`);
  assert.ok(job, "it loads");
  assert.equal(job.title, "Read the brand book");
  assert.deepEqual([job.who, job.size, job.handoff], [["builder"], "S", "you-approve"]);
  assert.deepEqual(job.asks, [{ id: "book", label: "Which file is the brand book?", kind: "file", required: true, folder: "brand" }]);
  assert.deepEqual(job.produces, ["brand-proposal.json", "brand-proposal-notes.md"]);
  assert.ok(!(BOOK in craft.jobs), "it makes no piece, so it has no craft entry");
  for (const s of ["brand-proposal.json", "Invent nothing", "Not in the book", "exactly one main", "heading, body, minPx, minSlidePx",
    "family, file: null, fallback", "clearSpace", "requiredOn", "words", "dont", "signoff", "No other keys", "Brand kit page"]) {
    assert.ok(job.text.includes(s), `its text says: ${s}`);
  }
});

// Rule 11: the loader as it was at commit faf7f1b (with its own routine-files and department-file).
test("every job file, the new one included, loads in the loader as it was at faf7f1b", (t) => {
  const old = (f) => execFileSync("git", ["show", `faf7f1b:engine/company/lib/${f}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  let files;
  try { files = ["job-files.mjs", "routine-files.mjs", "department-file.mjs"].map((f) => [f, old(f)]); } catch { return t.skip("commit faf7f1b is not in this checkout"); }
  const dir = mkdtempSync(join(tmpdir(), "uuu-oldloader-"));
  return (async () => {
    try {
      for (const [f, text] of files) writeFileSync(join(dir, f), text);
      const jobsMod = await import(pathToFileURL(join(dir, "job-files.mjs")).href);
      const depsMod = await import(pathToFileURL(join(dir, "department-file.mjs")).href);
      const deps = depsMod.loadDepartmentFile(join(COMPANY, "departments.json"), roles).departments;
      const { jobs, problems } = jobsMod.loadJobFiles(join(COMPANY, "jobs"), roles, deps);
      assert.deepEqual(problems, []);
      assert.equal(jobs.length, real.jobs.length);
      assert.ok(jobs.some((j) => j.file === `${BOOK}.json`), "the new job loads in the old loader");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
});

// Rule 11 for PLAN-V5 T43 and T53: the new job files and craft.json load in the loaders of the last commit.
test("the film, the two still jobs and the three page jobs load in the loaders of the last commit, and so does the craft table", (t) => {
  const old = (f) => execFileSync("git", ["show", `HEAD:engine/company/lib/${f}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  let files;
  try { files = ["job-files.mjs", "routine-files.mjs", "department-file.mjs", "craft-files.mjs"].map((f) => [f, old(f)]); } catch { return t.skip("no last commit in this checkout"); }
  const dir = mkdtempSync(join(tmpdir(), "uuu-headloader-"));
  return (async () => {
    try {
      for (const [f, text] of files) writeFileSync(join(dir, f), text);
      const jobsMod = await import(pathToFileURL(join(dir, "job-files.mjs")).href);
      const depsMod = await import(pathToFileURL(join(dir, "department-file.mjs")).href);
      const craftMod = await import(pathToFileURL(join(dir, "craft-files.mjs")).href);
      const deps = depsMod.loadDepartmentFile(join(COMPANY, "departments.json"), roles).departments;
      const { jobs, problems } = jobsMod.loadJobFiles(join(COMPANY, "jobs"), roles, deps);
      assert.deepEqual(problems, []);
      assert.equal(jobs.length, 72);
      const loaded = jobs.map((j) => j.file.replace(/\.json$/, ""));
      for (const ref of [...STEP3, ...STEP4]) assert.ok(loaded.includes(ref), `${ref} loads in the old loader`);
      const c = craftMod.loadCraft(CRAFT, loaded);
      assert.deepEqual(c.problems, []);
      assert.equal(c.jobs.size, 15);
      for (const ref of ["studio/a-film-from-your-renders", ...STEP4]) assert.deepEqual(c.jobs.get(ref), craft.jobs[ref], ref);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
});
