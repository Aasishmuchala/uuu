// Tests for engine/company/brand/craft.json (CONTRACTS-V5 K7, T17) and the job "Read the brand book":
// every playbook named is in the manifest, the eleven entries carry exactly their values, every
// key is a job that exists, and every job file still loads in the loader as it was at commit
// faf7f1b (the running home screen keeps that code and reads the job files fresh: rule 11).
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
};

test("the craft table has eleven entries and the loader finds no problem in it", () => {
  assert.equal(Object.keys(craft.jobs).length, 11);
  const c = loadCraft(CRAFT, refs);
  assert.deepEqual(c.problems, []);
  assert.equal(c.jobs.size, 11);
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
