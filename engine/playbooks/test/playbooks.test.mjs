// The playbooks' manifest and installer. Every run here copies from a made-up
// skills folder into a made-up state folder in a temp directory: the owner's
// real skill folders and the real state folder are never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync,
  lstatSync, readdirSync, realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..");
const INSTALL = join(dir, "install.sh");
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const byName = Object.fromEntries(manifest.playbooks.map((p) => [p.name, p]));

function put(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

// A made-up skills folder holding four of the manifest's playbooks, with the
// traps the installer must not fall into.
function fakeSkills() {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "pbtest-")));
  const skills = join(top, "skills");
  const cw = join(skills, "sthyra-copywriting");
  put(join(cw, "SKILL.md"), "made-up skill\n");
  put(join(cw, "references", "one.md"), "made-up reference one\n");
  put(join(cw, "references", "two.md"), "made-up reference two\n");
  put(join(cw, "references", "notes.txt"), "a text file the pattern does not name\n");
  put(join(cw, "references", "tool.py"), "print('never copied')\n");
  put(join(cw, "references", "big.md"), "x".repeat(600 * 1024));
  put(join(cw, "scripts", "run.md"), "a script folder's file\n");
  put(join(top, "outside.md"), "a file outside every playbook\n");
  symlinkSync(join(top, "outside.md"), join(cw, "references", "escape.md"));
  symlinkSync(join(cw, "references", "one.md"), join(cw, "references", "inner.md"));

  const vr = join(skills, "visual-realism-prompts");
  put(join(vr, "LICENSE"), "made-up licence\n");
  put(join(vr, "SKILL.md"), "made-up skill\n");
  put(join(vr, "people-composite.md"), "made-up\n");
  put(join(vr, "docs", "01-physical-realism.md"), "made-up\n");
  put(join(vr, "docs", "06-higgsfield-cinema-studio.md"), "not named\n");
  put(join(vr, "prompts", "photorealism-templates.md"), "made-up\n");
  put(join(vr, "scripts", "composite_people.py"), "print(1)\n");
  put(join(vr, ".venv", "bin", "notes.md"), "never\n");

  const im = join(skills, "impeccable");
  put(join(im, "SKILL.md"), "not named for this one\n");
  put(join(im, "reference", "critique.md"), "made-up\n");
  put(join(im, "reference", "live.md"), "not named\n");
  put(join(im, "scripts", "detect.md"), "never\n");

  const hm = join(skills, "hallmark");
  put(join(hm, "SKILL.md"), "not named for this one\n");
  put(join(hm, "references", "slop-test.md"), "made-up\n");
  put(join(hm, "references", "genres", "editorial.md"), "made-up\n");
  put(join(hm, "site", "index.md"), "never\n");

  const dest = join(top, "state", "playbooks");
  mkdirSync(join(top, "state"));
  return { top, skills, dest };
}

function run(env, ...args) {
  const r = spawnSync("/bin/bash", [INSTALL, ...args], {
    encoding: "utf8",
    env: { ...process.env, ENGINE_PLAYBOOKS_SOURCE: env.skills, ENGINE_PLAYBOOKS_DEST: env.dest },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// Every path under a folder with its kind, mode, inode and change time.
function snapshot(top) {
  const out = {};
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const s = lstatSync(p, { bigint: true });
      out[relative(top, p)] = [s.isDirectory() ? "d" : s.isFile() ? "f" : "other",
        Number(s.mode & 0o777n).toString(8), String(s.ino), String(s.mtimeNs), String(s.ctimeNs)];
      if (s.isDirectory()) walk(p);
    }
  };
  walk(top);
  return out;
}

function filesUnder(top) {
  return Object.entries(snapshot(top)).filter(([, v]) => v[0] === "f").map(([k]) => k).sort();
}

test("only the named files are copied", () => {
  const env = fakeSkills();
  const r = run(env);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(filesUnder(join(env.dest, "sthyra-copywriting")),
    ["IN-THIS-ENGINE.md", "SKILL.md", "references/inner.md", "references/one.md", "references/two.md"]);
  assert.deepEqual(filesUnder(join(env.dest, "visual-realism-prompts")),
    ["IN-THIS-ENGINE.md", "LICENSE", "SKILL.md", "docs/01-physical-realism.md", "people-composite.md",
      "prompts/photorealism-templates.md"]);
  assert.deepEqual(filesUnder(join(env.dest, "impeccable")), ["IN-THIS-ENGINE.md", "reference/critique.md"]);
  assert.deepEqual(filesUnder(join(env.dest, "hallmark")),
    ["IN-THIS-ENGINE.md", "references/genres/editorial.md", "references/slop-test.md"]);
  // A link that stays inside its folder is copied as the file it points at.
  assert.equal(readFileSync(join(env.dest, "sthyra-copywriting", "references", "inner.md"), "utf8"),
    "made-up reference one\n");
});

test("a scripts/ file, a .py file and an over-size file are not copied, and the size is said", () => {
  const env = fakeSkills();
  const r = run(env);
  assert.equal(r.code, 0, r.err);
  const all = Object.keys(snapshot(env.dest));
  assert.ok(!all.some((p) => /(^|\/)(scripts|site|\.venv)(\/|$)/.test(p)), all.join(" "));
  assert.ok(!all.some((p) => p.endsWith(".py")));
  assert.ok(!all.some((p) => p.endsWith("big.md")));
  assert.match(r.out, /sthyra-copywriting: skipped references\/big\.md: it is over 512 KB\./);
});

test("a link that leaves the folder is skipped and said", () => {
  const env = fakeSkills();
  const r = run(env);
  assert.equal(r.code, 0, r.err);
  assert.ok(!existsSync(join(env.dest, "sthyra-copywriting", "references", "escape.md")));
  assert.match(r.out, /sthyra-copywriting: skipped references\/escape\.md: it is a link that leaves the playbook's folder\./);
  for (const p of filesUnder(env.dest)) {
    assert.ok(!readFileSync(join(env.dest, p), "utf8").includes("a file outside every playbook"), p);
  }
});

test("IN-THIS-ENGINE.md holds the note, and the licence file sits beside a third party's copy", () => {
  const env = fakeSkills();
  assert.equal(run(env).code, 0);
  for (const name of ["sthyra-copywriting", "visual-realism-prompts", "impeccable", "hallmark"]) {
    const text = readFileSync(join(env.dest, name, "IN-THIS-ENGINE.md"), "utf8");
    assert.ok(text.includes(byName[name].note), name);
    assert.ok(text.includes(`licence: ${byName[name].licence}`), name);
  }
  assert.equal(readFileSync(join(env.dest, "visual-realism-prompts", "LICENSE"), "utf8"), "made-up licence\n");
});

test("folders are 0755 and files 0644", () => {
  const env = fakeSkills();
  assert.equal(run(env).code, 0);
  assert.equal((lstatSync(env.dest).mode & 0o777).toString(8), "755");
  for (const [p, [kind, mode]] of Object.entries(snapshot(env.dest))) {
    assert.ok(kind === "d" || kind === "f", `${p} is ${kind}`);
    assert.equal(mode, kind === "d" ? "755" : "644", p);
  }
});

test("a second run changes nothing", () => {
  const env = fakeSkills();
  assert.equal(run(env).code, 0);
  const before = snapshot(env.dest);
  const r = run(env);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(snapshot(env.dest), before);
  assert.match(r.out, /hallmark: already in place \(2 files\)\./);
});

test("a changed source file is picked up, and the rest stays as it was", () => {
  const env = fakeSkills();
  assert.equal(run(env).code, 0);
  const keep = snapshot(join(env.dest, "hallmark"));
  writeFileSync(join(env.skills, "impeccable", "reference", "critique.md"), "made-up, changed\n");
  const r = run(env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /impeccable: updated, 1 file /);
  assert.equal(readFileSync(join(env.dest, "impeccable", "reference", "critique.md"), "utf8"), "made-up, changed\n");
  assert.deepEqual(snapshot(join(env.dest, "hallmark")), keep);
  assert.ok(!readdirSync(env.dest).some((n) => n.startsWith(".")));
});

test("a playbook the manifest no longer names is removed; a folder it did not make is left alone", () => {
  const env = fakeSkills();
  mkdirSync(env.dest);
  put(join(env.dest, "old-playbook", "IN-THIS-ENGINE.md"), "an earlier install\n");
  put(join(env.dest, "old-playbook", "SKILL.md"), "an earlier install\n");
  put(join(env.dest, "not-ours", "keep.txt"), "the owner's\n");
  const r = run(env);
  assert.equal(r.code, 0, r.err);
  assert.ok(!existsSync(join(env.dest, "old-playbook")));
  assert.match(r.out, /old-playbook: removed; the manifest no longer names it\./);
  assert.ok(existsSync(join(env.dest, "not-ours", "keep.txt")));
  assert.match(r.out, /left alone: not-ours is not a playbook folder this installer made\./);
});

test("a missing source is one plain line and exit 0", () => {
  const env = fakeSkills();
  const r = run(env);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err, "");
  const lines = r.out.split("\n").filter((l) => l.includes("storycraft"));
  assert.deepEqual(lines, ["playbooks: storycraft: skipped: its folder is not on this Mac (~/.claude/skills/storycraft)."]);
  assert.ok(!existsSync(join(env.dest, "storycraft")));
});

test("an empty skills folder installs nothing and still exits 0", () => {
  const env = fakeSkills();
  const empty = join(env.top, "empty-skills");
  mkdirSync(empty);
  const r = run({ skills: empty, dest: env.dest });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.split("\n").filter((l) => l.includes("is not on this Mac")).length, manifest.playbooks.length);
  assert.match(r.out, /0 of \d+ playbooks installed/);
});

test("--check-only both ways", () => {
  const env = fakeSkills();
  let r = run(env, "--check-only");
  assert.equal(r.code, 1);
  assert.equal(r.out, "Playbooks: not installed\n");
  assert.ok(!existsSync(env.dest), "--check-only made the folder");
  assert.equal(run(env).code, 0);
  r = run(env, "--check-only");
  assert.equal(r.code, 0);
  assert.equal(r.out, "Playbooks: 4 installed\n");
  r = run(env, "--check-only", "extra");
  assert.equal(r.code, 1);
});

test("index.json matches what is on disk", () => {
  const env = fakeSkills();
  assert.equal(run(env).code, 0);
  const idx = JSON.parse(readFileSync(join(env.dest, "index.json"), "utf8"));
  assert.equal(idx.version, 1);
  assert.deepEqual(idx.playbooks.map((r) => r.name),
    manifest.playbooks.map((p) => p.name).filter((n) =>
      ["sthyra-copywriting", "visual-realism-prompts", "impeccable", "hallmark"].includes(n)));
  for (const row of idx.playbooks) {
    const p = byName[row.name];
    assert.deepEqual(Object.keys(row).sort(), ["bytes", "files", "kinds", "licence", "name", "origin", "roles"]);
    assert.equal(row.origin, p.origin);
    assert.equal(row.licence, p.licence);
    assert.deepEqual(row.roles, p.roles);
    assert.deepEqual(row.kinds, p.kinds);
    const files = filesUnder(join(env.dest, row.name)).filter((f) => f !== "IN-THIS-ENGINE.md");
    assert.deepEqual(row.files, files);
    const bytes = files.reduce((n, f) => n + lstatSync(join(env.dest, row.name, f)).size, 0);
    assert.equal(row.bytes, bytes);
  }
});

test("a state folder that is a link is refused and nothing is changed", () => {
  const env = fakeSkills();
  const real = join(env.top, "elsewhere");
  mkdirSync(real);
  symlinkSync(real, env.dest);
  const r = run(env);
  assert.equal(r.code, 1);
  assert.match(r.err, /is a link or not a folder; remove it and run again\. Nothing was changed\./);
  assert.deepEqual(readdirSync(real), []);
});

// The real manifest.
const K4 = ["sthyra-copywriting", "storycraft", "aasish-design", "creative-director", "impact-3d", "renders",
  "lightcraft", "visual-realism-prompts", "shotlist-director", "sthyra-cinematic", "archfilm-edit",
  "cinematic-ai-film", "taste-skill", "hallmark", "impeccable", "frontend-ui-engineering"];
const KINDS = ["post", "newsletter", "carousel", "poster", "title-card", "film", "page"];

test("the real manifest: names, sources, roles, kinds and notes", () => {
  assert.equal(manifest.version, 1);
  assert.ok(manifest.playbooks.length >= 14);
  assert.deepEqual(manifest.playbooks.map((p) => p.name).sort(), [...K4].sort());
  for (const p of manifest.playbooks) {
    assert.match(p.name, /^[a-z0-9][a-z0-9-]{0,39}$/);
    assert.match(p.source, /^~\/\.claude\/skills\/[A-Za-z0-9][A-Za-z0-9._-]*$/);
    assert.ok(["own", "third-party"].includes(p.origin), p.name);
    assert.ok(p.roles.length > 0 && p.kinds.length > 0, p.name);
    assert.ok(p.kinds.every((k) => KINDS.includes(k)), p.name);
    assert.ok(p.note.startsWith("In this engine:") && p.note.length >= 60, p.name);
  }
  assert.equal(new Set(manifest.playbooks.map((p) => p.name)).size, manifest.playbooks.length);
});

test("the real manifest: every third party has a licence and a licence file, or says it has none", () => {
  for (const p of manifest.playbooks.filter((x) => x.origin === "third-party")) {
    assert.ok(typeof p.licence === "string" && p.licence.trim().length > 0, p.name);
    if (p.licenceFiles.length === 0) assert.match(p.note, /no licence file/, p.name);
  }
  assert.deepEqual(byName.hallmark.licenceFiles, []);
  assert.match(byName.hallmark.note, /no licence file/);
  assert.deepEqual(byName["visual-realism-prompts"].licenceFiles, ["LICENSE"]);
});

test("the real manifest: no files entry names scripts, site, .venv or a reading-only ending", () => {
  for (const p of manifest.playbooks) {
    for (const f of p.files) {
      assert.ok(!f.split("/").some((s) => ["scripts", "site", ".venv"].includes(s.toLowerCase())), `${p.name}: ${f}`);
      assert.match(f, /\.(md|txt|json)$/, `${p.name}: ${f}`);
      assert.ok(!f.startsWith("/") && !f.split("/").includes(".."), `${p.name}: ${f}`);
    }
  }
  assert.deepEqual(byName.hallmark.files.filter((f) => !f.startsWith("references/")), []);
  assert.deepEqual(byName.impeccable.files.filter((f) => !/^reference\/[^/]+\.md$/.test(f)), []);
  assert.deepEqual(byName["archfilm-edit"].files, ["SKILL.md", "references/*.md"]);
});
