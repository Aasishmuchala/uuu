// The playbooks' manifest and installer, and the site kit it copies beside them
// (PLAN-V5 T53, C18), and the cook playbook kept in the repo with its sub-folders (T89). Every run here copies from a made-up skills folder into a
// made-up state folder in a temp directory: the owner's real skill folders and
// the real state folder are never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync,
  lstatSync, readdirSync, realpathSync, rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { crc32, deflateSync } from "node:zlib";

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
    env: { ...process.env, ENGINE_PLAYBOOKS_SOURCE: env.skills, ENGINE_PLAYBOOKS_DEST: env.dest,
      ENGINE_PLAYBOOKS_OWN: env.own ?? join(env.top ?? dirname(env.skills), "no-own"),
      ENGINE_SITE_KIT_SOURCE: env.siteKit ?? join(env.top ?? dirname(env.skills), "no-site-kit") },
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
  assert.equal(r.out.split("\n").filter((l) => l.includes("is not on this Mac")).length,
    manifest.playbooks.filter((p) => !p.source.startsWith("own:")).length);
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
const K4 = ["render-to-film", "cook", "sthyra-copywriting", "storycraft", "aasish-design", "creative-director", "impact-3d", "renders",
  "lightcraft", "visual-realism-prompts", "shotlist-director", "sthyra-cinematic", "archfilm-edit",
  "cinematic-ai-film", "taste-skill", "hallmark", "impeccable", "frontend-ui-engineering"];
const KINDS = ["post", "newsletter", "carousel", "poster", "title-card", "film", "page", "still"];

test("the real manifest: names, sources, roles, kinds and notes", () => {
  assert.equal(manifest.version, 1);
  assert.ok(manifest.playbooks.length >= 14);
  assert.deepEqual(manifest.playbooks.map((p) => p.name).sort(), [...K4].sort());
  for (const p of manifest.playbooks) {
    assert.match(p.name, /^[a-z0-9][a-z0-9-]{0,39}$/);
    assert.match(p.source, /^(~\/\.claude\/skills\/[A-Za-z0-9][A-Za-z0-9._-]*|own:[a-z0-9][a-z0-9-]*)$/);
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

// An own: source (T82): the engine's own playbooks, .md files only, read and never removed.
function fakeOwn() {
  const env = fakeSkills();
  const own = join(env.top, "own");
  const f = join(own, "render-to-film");
  put(join(f, "SKILL.md"), "made-up own playbook\n");
  put(join(f, "notes.txt"), "not an .md file\n");
  put(join(f, "tool.json"), "{}\n");
  put(join(env.top, "secret.md"), "outside the own folder\n");
  symlinkSync(join(env.top, "secret.md"), join(f, "escape.md"));
  return { ...env, own, folder: f };
}

test("an own: source copies its .md files only, from the engine's own folder", () => {
  const env = fakeOwn();
  const r = run(env);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(filesUnder(join(env.dest, "render-to-film")), ["IN-THIS-ENGINE.md", "SKILL.md"]);
  assert.equal(readFileSync(join(env.dest, "render-to-film", "SKILL.md"), "utf8"), "made-up own playbook\n");
  const note = readFileSync(join(env.dest, "render-to-film", "IN-THIS-ENGINE.md"), "utf8");
  assert.ok(note.includes(byName["render-to-film"].note));
  assert.match(note, /the engine's own playbooks/);
  assert.equal(run(env, "--check-only").out, "Playbooks: 5 installed\n");
});

test("an own: source is never removed, changed or written to", () => {
  const env = fakeOwn();
  const before = snapshot(env.own);
  assert.equal(run(env).code, 0);
  assert.equal(run(env).code, 0);
  assert.deepEqual(snapshot(env.own), before);
  // Even when the manifest no longer names it: the installed copy goes, the source stays.
  assert.ok(existsSync(join(env.folder, "SKILL.md")));
});

test("a link in an own: folder that leaves it is skipped and said", () => {
  const env = fakeOwn();
  rmSync(join(env.folder, "SKILL.md"));
  symlinkSync(join(env.top, "secret.md"), join(env.folder, "SKILL.md"));
  const r = run(env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /render-to-film: skipped SKILL\.md: it is a link that leaves the playbook's folder\./);
  assert.ok(!existsSync(join(env.dest, "render-to-film")));
});

test("an own: source that is a link, or is missing, is skipped in one plain line", () => {
  const env = fakeOwn();
  const elsewhere = join(env.top, "elsewhere");
  put(join(elsewhere, "SKILL.md"), "made-up\n");
  const linked = join(env.top, "own-linked");
  mkdirSync(linked);
  symlinkSync(elsewhere, join(linked, "render-to-film"));
  let r = run({ ...env, own: linked });
  assert.equal(r.code, 0, r.err);
  assert.ok(!existsSync(join(env.dest, "render-to-film")));
  assert.match(r.out, /render-to-film: skipped: its folder is not in the engine \(own:render-to-film\)\./);
  r = run({ ...env, own: join(env.top, "nothing-here") });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /render-to-film: skipped: its folder is not in the engine/);
});

// The installer's manifest checks, run against a made-up manifest copy of the installer.
function withManifest(entries) {
  const env = fakeOwn();
  const copy = join(env.top, "playbooks");
  mkdirSync(copy);
  const script = readFileSync(INSTALL, "utf8");
  writeFileSync(join(copy, "install.sh"), script);
  writeFileSync(join(copy, "manifest.json"), JSON.stringify({ version: 1, playbooks: entries }));
  // The installer sources ../lib/config.sh beside itself.
  symlinkSync(join(dir, "..", "lib"), join(env.top, "lib"));
  symlinkSync(join(dir, "..", "config.json"), join(env.top, "config.json"));
  const r = spawnSync("/bin/bash", [join(copy, "install.sh")], {
    encoding: "utf8",
    env: { ...process.env, ENGINE_PLAYBOOKS_SOURCE: env.skills, ENGINE_PLAYBOOKS_DEST: env.dest, ENGINE_PLAYBOOKS_OWN: env.own },
  });
  return { ...env, code: r.status, out: r.stdout, err: r.stderr };
}

test("the real manifest's own entry passes the installer's checks; own:../x and odd entries are refused", () => {
  const good = byName["render-to-film"];
  assert.deepEqual(good.files, ["SKILL.md"]);
  assert.equal(good.origin, "own");
  assert.deepEqual(good.kinds, ["film", "still"]);
  const ok = withManifest([good]);
  assert.equal(ok.code, 0, ok.err);
  for (const [source, files] of [["own:../x", ["SKILL.md"]], ["own:a/b", ["SKILL.md"]], ["own:", ["SKILL.md"]], ["own:Render", ["SKILL.md"]],
    ["own:render-to-film", ["notes.txt"]], ["own:render-to-film", ["../SKILL.md"]]]) {
    const r = withManifest([{ ...good, source, files }]);
    assert.equal(r.code, 1, `${source} ${files}`);
    assert.match(r.err, /the manifest is not right/, `${source} ${files}`);
    assert.ok(!existsSync(r.dest), "nothing was changed");
  }
});

test("the manifest may not name a playbook site-kit: that name is the engine's site kit", () => {
  const r = withManifest([{ ...byName["render-to-film"], name: "site-kit" }]);
  assert.equal(r.code, 1);
  assert.match(r.err, /the manifest is not right: site-kit is the name of the engine's site kit, never of a playbook/);
  assert.ok(!existsSync(r.dest), "nothing was changed");
});

// ---- PLAN-V5 T89: cook (MIT), a third party's playbook kept in the repo under own/cook/, with its
// references/ and templates/ sub-folders, made the default way visual work is done here.

const OWN_DIR = join(dir, "own");
const COOK_FILES = ["SKILL.md", "references/intake.md", "references/loop-and-critics.md", "references/rules.md", "references/ship.md",
  "references/target-and-bar.md", "templates/ROUNDS.md", "templates/brief.md"];

test("the real manifest: cook is an own: source of a third party's work under MIT, for the makers of visual work and the Art director", () => {
  const c = byName.cook;
  assert.ok(c, "cook is in the manifest");
  assert.deepEqual(Object.keys(c).sort(), ["files", "kinds", "licence", "licenceFiles", "name", "note", "origin", "roles", "source"]);
  assert.equal(c.source, "own:cook");
  assert.equal(c.origin, "third-party");
  assert.equal(c.licence, "MIT");
  assert.deepEqual(c.licenceFiles, ["LICENSE.md"]);
  // Exact names, no pattern: only the reading files, never its script or its README.
  assert.deepEqual(c.files, COOK_FILES);
  assert.ok(c.files.every((f) => !f.includes("*") && f.endsWith(".md")));
  assert.deepEqual([...c.roles].sort(), ["art-director", "artist", "builder"]);
  // Every visual kind the engine makes (slides are carousels here); never posts or newsletters.
  assert.deepEqual([...c.kinds].sort(), ["carousel", "film", "page", "poster", "still", "title-card"]);
  assert.ok(c.note.length <= 4000, `${c.note.length} characters`);
  for (const s of ["In this engine: the default way visual work is made and judged", "cook/ inside the goal's sub-folder",
    "the job's own time limit", "the engine's usage limits replace its 8-hour floor and its usage pacing",
    "the job's form and the Chief of staff's plan are the intake; never put its questions to the owner in the middle of a run",
    "a missing company fact is still a blocked step", "the pictures brand/kit.json lists", "the files the task names",
    "anything else is the Researcher's to fetch", "the three versions the job makes are its target mockups",
    "write a number per dimension into cook/BRIEF.md", "the rounds ledger, cook/ROUNDS.md, beside it", "Design first, motion second",
    "its script is not copied", "the page viewer's picture", "$UUU_ART_PYTHON, Pillow", "self-scored and never decide",
    "The Art director is the zero-context judge each round", "knows nothing of the build",
    "the owner's picks in brand/taste.md calibrate its scores", "nothing is published or pushed", "the pick card",
    "anything that spends (a clip, a generated still) waits for the batch the owner approved", "a colour or typeface the brand kit names is the brand",
    "LICENSE.md is kept beside the copy"]) assert.ok(c.note.includes(s), s);
  // No full path, address, port or key in the note.
  assert.doesNotMatch(c.note, /(^|[\s(])\/(Users|opt|private|var|tmp|etc|home|Volumes|Library)\/|~\/|https?:|127\.0\.0\.1|localhost|:\d{4,5}\b|\bport\s+\d/);
});

test("own/cook in the repository: exactly the named .md files and LICENSE.md with the MIT notice; never its script", () => {
  const top = join(OWN_DIR, "cook");
  assert.deepEqual(filesUnder(top), [...COOK_FILES, "LICENSE.md"].sort());
  for (const [p, [kind]] of Object.entries(snapshot(top))) assert.ok(kind === "d" || kind === "f", `${p} is ${kind}`);
  const licence = readFileSync(join(top, "LICENSE.md"), "utf8");
  assert.match(licence, /^MIT License\n\nCopyright \(c\) 2026 Leon Lin\n/);
  assert.match(licence, /The above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software\./);
  assert.match(readFileSync(join(top, "SKILL.md"), "utf8"), /^---\nname: cook\n/);
  assert.ok(!existsSync(join(top, "scripts")) && !existsSync(join(top, "README.md")));
});

test("the cook playbook installs from the repo into a temp folder: its sub-folders' files byte for byte, its licence and the note", () => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "pbcook-")));
  try {
    const env = { skills: join(top, "no-skills"), dest: join(top, "state", "playbooks"), own: OWN_DIR, siteKit: join(top, "no-site-kit") };
    mkdirSync(env.skills);
    mkdirSync(join(top, "state"));
    const before = snapshot(OWN_DIR);
    const r = run(env);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^playbooks: cook: installed, 9 files \(\d+ KB\)\.$/m);
    const copy = join(env.dest, "cook");
    assert.deepEqual(filesUnder(copy), [...COOK_FILES, "IN-THIS-ENGINE.md", "LICENSE.md"].sort());
    for (const f of [...COOK_FILES, "LICENSE.md"]) assert.ok(readFileSync(join(copy, f)).equals(readFileSync(join(OWN_DIR, "cook", f))), `${f} byte for byte`);
    for (const [p, [kind, mode]] of Object.entries(snapshot(copy))) assert.equal(mode, kind === "d" ? "755" : "644", p);
    const note = readFileSync(join(copy, "IN-THIS-ENGINE.md"), "utf8");
    assert.ok(note.includes(byName.cook.note));
    assert.match(note, /This is a third party's playbook \(licence: MIT\), copied from the engine's own playbooks: 9 files\./);
    const row = JSON.parse(readFileSync(join(env.dest, "index.json"), "utf8")).playbooks.find((x) => x.name === "cook");
    assert.deepEqual(row.files, [...COOK_FILES, "LICENSE.md"].sort());
    assert.deepEqual(row.roles, byName.cook.roles);
    assert.deepEqual(row.kinds, byName.cook.kinds);
    // A second run changes nothing, and the repo's folder is only read.
    const installed = snapshot(env.dest);
    const again = run(env);
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /^playbooks: cook: already in place \(9 files\)\.$/m);
    assert.deepEqual(snapshot(env.dest), installed);
    assert.deepEqual(snapshot(OWN_DIR), before);
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
});

// A made-up own/cook folder with the traps of a sub-folder: an unnamed file, a script, a text file and links.
function fakeCook() {
  const env = fakeSkills();
  const own = join(env.top, "own");
  const f = join(own, "cook");
  for (const n of COOK_FILES) put(join(f, n), `made-up ${n}\n`);
  put(join(f, "LICENSE.md"), "made-up licence\n");
  put(join(f, "README.md"), "not named\n");
  put(join(f, "references", "extra.md"), "not named\n");
  put(join(f, "references", "notes.txt"), "not an .md file\n");
  put(join(f, "scripts", "side-by-side.mjs"), "never copied\n");
  put(join(env.top, "outside", "brief.md"), "outside the own folder\n");
  return { ...env, own, folder: f };
}

test("an own: source's named files in sub-folders are copied, and nothing else in them", () => {
  const env = fakeCook();
  const r = run(env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /cook: installed, 9 files /);
  assert.deepEqual(filesUnder(join(env.dest, "cook")), [...COOK_FILES, "IN-THIS-ENGINE.md", "LICENSE.md"].sort());
  for (const n of COOK_FILES) assert.equal(readFileSync(join(env.dest, "cook", n), "utf8"), `made-up ${n}\n`);
  const all = Object.keys(snapshot(join(env.dest, "cook")));
  assert.ok(!all.some((p) => /scripts|README|extra|notes|\.mjs$/.test(p)), all.join(" "));
});

test("in an own: source's sub-folder, a link that leaves the folder is skipped and said; a sub-folder that is such a link too", () => {
  let env = fakeCook();
  rmSync(join(env.folder, "references", "rules.md"));
  symlinkSync(join(env.top, "outside", "brief.md"), join(env.folder, "references", "rules.md"));
  let r = run(env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /cook: skipped references\/rules\.md: it is a link that leaves the playbook's folder\./);
  assert.ok(!existsSync(join(env.dest, "cook", "references", "rules.md")));
  assert.match(r.out, /cook: installed, 8 files /);

  env = fakeCook();
  rmSync(join(env.folder, "templates"), { recursive: true });
  symlinkSync(join(env.top, "outside"), join(env.folder, "templates"));
  r = run(env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /cook: skipped templates: it is a link that leaves the playbook's folder\./);
  assert.ok(!existsSync(join(env.dest, "cook", "templates")));
  for (const p of filesUnder(env.dest)) assert.ok(!readFileSync(join(env.dest, p), "utf8").includes("outside the own folder"), p);
});

test("the real manifest's cook entry passes the installer's checks; a pattern or a script in its files is refused", () => {
  const ok = withManifest([byName.cook]);
  assert.equal(ok.code, 0, ok.err);
  for (const files of [["scripts/side-by-side.mjs"], ["references/rules.txt"], ["../cook/SKILL.md"], ["scripts/SKILL.md"]]) {
    const r = withManifest([{ ...byName.cook, files }]);
    assert.equal(r.code, 1, files.join(" "));
    assert.match(r.err, /the manifest is not right/, files.join(" "));
    assert.ok(!existsSync(r.dest), "nothing was changed");
  }
});

// ---- PLAN-V5 T53 (K16, C18): the site kit, engine/site-kit/, copied to <state>/playbooks/site-kit/.

const ENGINE = join(dir, "..");
const KIT_DIR = join(ENGINE, "site-kit");
const KIT_FILES = ["README.md", "gallery.js", "layout.css", "reset.css", "reveal.js"];
const kitText = (n) => readFileSync(join(KIT_DIR, n), "utf8");
// CSS with its comments taken out, so a rule is judged by what it does, not by what a comment says.
const cssOf = (n) => kitText(n).replace(/\/\*[\s\S]*?\*\//g, "");

// A made-up site kit folder: the five real files, a link that leaves it and a seventh file.
function fakeKit() {
  const env = fakeSkills();
  const kit = join(env.top, "site-kit-source");
  mkdirSync(kit);
  for (const n of KIT_FILES) writeFileSync(join(kit, n), readFileSync(join(KIT_DIR, n)));
  put(join(env.top, "outside.css"), "body { color: red; }\n");
  symlinkSync(join(env.top, "outside.css"), join(kit, "extra.css"));
  writeFileSync(join(kit, "notes.md"), "a seventh file\n");
  return { ...env, siteKit: kit };
}
const siteKitRow = (dest) => JSON.parse(readFileSync(join(dest, "index.json"), "utf8")).playbooks.find((r) => r.name === "site-kit");

test("the site kit: the installer copies its five files, skips a link and a seventh file, and lists its row in index.json", () => {
  const env = fakeKit();
  const r = run(env);
  assert.equal(r.code, 0, r.err);
  const top = join(env.dest, "site-kit");
  assert.deepEqual(filesUnder(top), KIT_FILES);
  for (const n of KIT_FILES) assert.ok(readFileSync(join(top, n)).equals(readFileSync(join(KIT_DIR, n))), `${n} byte for byte`);
  assert.equal((lstatSync(top).mode & 0o777).toString(8), "755");
  for (const n of KIT_FILES) assert.equal((lstatSync(join(top, n)).mode & 0o777).toString(8), "644", n);
  assert.match(r.out, /site-kit: skipped extra\.css: the site kit holds only reset\.css, layout\.css, reveal\.js, gallery\.js, README\.md\./);
  assert.match(r.out, /site-kit: skipped notes\.md: the site kit holds only/);
  assert.match(r.out, /site-kit: installed, 5 files /);
  assert.ok(!existsSync(join(top, "extra.css")) && !existsSync(join(top, "notes.md")));
  assert.deepEqual(siteKitRow(env.dest), { name: "site-kit", origin: "own", licence: "this engine's own", roles: ["builder", "art-director"],
    kinds: ["page"], files: KIT_FILES, bytes: KIT_FILES.reduce((n, f) => n + lstatSync(join(KIT_DIR, f)).size, 0) });
  // The site kit is not a playbook: --check-only and the closing count stay the manifest's.
  assert.equal(run(env, "--check-only").out, "Playbooks: 4 installed\n");
  assert.match(r.out, /4 of \d+ playbooks installed/);
});

test("the site kit: one of its files that is a link, or is over 64 KB, is skipped and said; the rest are copied", () => {
  const env = fakeKit();
  rmSync(join(env.siteKit, "reveal.js"));
  symlinkSync(join(env.top, "outside.css"), join(env.siteKit, "reveal.js"));
  writeFileSync(join(env.siteKit, "layout.css"), `/* ${"x".repeat(64 * 1024)} */\n`);
  const r = run(env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /site-kit: skipped reveal\.js: it is a link, and the installer follows no link\./);
  assert.match(r.out, /site-kit: skipped layout\.css: it is over 64 KB\./);
  assert.deepEqual(filesUnder(join(env.dest, "site-kit")), ["README.md", "gallery.js", "reset.css"]);
  for (const p of filesUnder(env.dest)) assert.ok(!readFileSync(join(env.dest, p), "utf8").includes("color: red"), p);
});

test("the site kit: a second run changes nothing, and its folder is never removed as not in the manifest", () => {
  const env = fakeKit();
  assert.equal(run(env).code, 0);
  const before = snapshot(env.dest);
  let r = run(env);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(snapshot(env.dest), before);
  assert.match(r.out, /site-kit: already in place \(5 files\)\./);
  assert.doesNotMatch(r.out, /site-kit: removed|left alone: site-kit/);
  // With its source gone, the copy installed earlier is kept and still listed.
  r = run({ ...env, siteKit: join(env.top, "gone") });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /site-kit: skipped: its folder is not in the engine \(engine\/site-kit\)\. The copy installed earlier is kept\./);
  assert.deepEqual(filesUnder(join(env.dest, "site-kit")), KIT_FILES);
  assert.deepEqual(siteKitRow(env.dest).files, KIT_FILES);
});

test("the site kit: a source folder that is a link is skipped in one plain line", () => {
  const env = fakeKit();
  const linked = join(env.top, "kit-link");
  symlinkSync(env.siteKit, linked);
  const r = run({ ...env, siteKit: linked });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /site-kit: skipped: its folder is not in the engine \(engine\/site-kit\)\./);
  assert.ok(!existsSync(join(env.dest, "site-kit")));
  assert.equal(siteKitRow(env.dest), undefined);
});

test("the site kit in the repository: the five files, the engine's own, at most 32 KB, naming no address", () => {
  assert.deepEqual(readdirSync(KIT_DIR).sort(), KIT_FILES);
  let total = 0;
  for (const n of KIT_FILES) {
    const st = lstatSync(join(KIT_DIR, n));
    assert.ok(st.isFile() && st.size <= 64 * 1024, n);
    total += st.size;
    const text = kitText(n);
    assert.doesNotMatch(text, /https?:|\/\//i, `${n} names an address`);
    assert.match(text, /this engine's own/, `${n} says it is the engine's own`);
  }
  assert.ok(total <= 32 * 1024, `${total} bytes`);
  const readme = kitText("README.md");
  for (const n of ["reset.css", "layout.css", "reveal.js", "gallery.js"]) assert.ok(readme.includes(`\`${n}\``), `the README says what ${n} is`);
  assert.match(readme, /Never copy this\s+`README\.md` into a site/);
});

test("the site kit's two scripts pass node --check, and neither reaches for anything", () => {
  for (const n of ["reveal.js", "gallery.js"]) {
    const r = spawnSync(process.execPath, ["--check", join(KIT_DIR, n)], { encoding: "utf8" });
    assert.equal(r.status, 0, `${n}: ${r.stderr}`);
    assert.doesNotMatch(kitText(n), /\bfetch\b|XMLHttpRequest|\bimport\s*\(|WebSocket|EventSource|sendBeacon|\bWorker\b|\beval\b|innerHTML|document\.write/, n);
  }
  const reveal = kitText("reveal.js");
  for (const s of ["IntersectionObserver", "data-reveal", '"is-in"', "(prefers-reduced-motion: reduce)"]) assert.ok(reveal.includes(s), s);
  // T58b: the page viewer is not told apart by navigator.webdriver; it asks for less motion as any visitor can
  assert.doesNotMatch(reveal, /webdriver|HeadlessChrome|userAgent/);
  const gallery = kitText("gallery.js");
  for (const s of ['createElement("dialog")', "showModal()", "a[data-gallery]", '"ArrowLeft"', '"ArrowRight"', '"close"', "opener.focus()",
    'getAttribute("alt")', "textContent"]) assert.ok(gallery.includes(s), s);
});

test("reset.css: no colour but inherit, currentColor and transparent; no face but the kit's body face", () => {
  const css = cssOf("reset.css");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i);
  const colours = [...css.matchAll(/(?:^|[\s;{])(color|background(?:-color)?|border(?:-color)?|outline(?:-color)?|fill|stroke)\s*:\s*([^;}]+)/g)];
  assert.ok(colours.length >= 3);
  for (const [, prop, value] of colours) {
    const words = value.trim().split(/\s+/).filter((w) => !/^[\d.]+(rem|em|px)?$/.test(w) && w !== "solid" && w !== "0");
    assert.ok(words.every((w) => ["inherit", "currentColor", "transparent"].includes(w)), `${prop}: ${value}`);
  }
  assert.deepEqual([...css.matchAll(/font-family\s*:\s*([^;}]+)/g)].map((m) => m[1].trim()), ["var(--brand-body)"]);
  assert.deepEqual([...css.matchAll(/(?:^|[\s;{])font\s*:\s*([^;}]+)/g)].map((m) => m[1].trim()), ["inherit"]);
  assert.doesNotMatch(css, /\d+px/, "no size in px");
});

test("layout.css: a spacing scale in rem, a 12-column grid with breakpoints at 390, 768 and 1280 px, sizes never in px", () => {
  const css = cssOf("layout.css");
  for (let i = 1; i <= 8; i += 1) assert.match(css, new RegExp(`--space-${i}: [0-9.]+rem;`), `--space-${i}`);
  assert.match(css, /\.kit-grid \{[^}]*grid-template-columns: repeat\(12, minmax\(0, 1fr\)\)/);
  for (let i = 1; i <= 12; i += 1) assert.match(css, new RegExp(`\\.span-${i} \\{ grid-column: span ${i}; \\}`), `.span-${i}`);
  assert.match(css, /\.kit-container \{[^}]*padding-inline: max\(var\(--space-4\), calc\(var\(--kit-margin-share\) \* 100%\)\)/);
  assert.deepEqual([...css.matchAll(/@media \(min-width: (\d+)px\)/g)].map((m) => Number(m[1])), [390, 768, 1280]);
  // Outside the breakpoints, no px at all; every text size goes through the kit's smallest.
  assert.doesNotMatch(css.replace(/@media \(min-width: \d+px\)/g, ""), /\d+px/);
  const sizes = [...css.matchAll(/font-size\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
  assert.ok(sizes.length >= 2 && sizes.every((v) => /^max\(var\(--brand-min-size\), [0-9.]+rem\)$/.test(v)), sizes.join(" | "));
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i);
  assert.doesNotMatch(css, /font-family/);
});

// A made-up 4 x 2 PNG of ink, the test kit's logo.
function png() {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const ink = [0x1a, 0x3c, 0x5e, 255];
  const row = [0, ...ink, ...ink, ...ink, ...ink];   // the filter byte, then four pixels
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from([...row, ...row]))), chunk("IEND", Buffer.alloc(0))]);
}

// The Artist's own Python, where the brand check runs (it needs the drawing library).
const ART_PY = join(homedir(), ".paperclip", "uuu-engine", "art", "venv", "bin", "python");
const noArtPy = existsSync(ART_PY) ? false : "the Artist's tools are not installed (engine/art/install.sh), so the brand check cannot run";

test("the site kit, in a fixture site with a test kit, passes the brand check with no hard failure and no warning", { skip: noArtPy }, () => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "sitekit-check-")));
  try {
    const state = join(top, "state");
    const brand = join(state, "knowledge", "docs", "brand");
    // The strictest kit: no neutrals, the logo required on pages.
    put(join(brand, "kit.json"), JSON.stringify({ version: 1, savedAt: "2026-11-13T10:00:00.000Z", name: "Sthyra",
      colours: [{ name: "ink", hex: "#1A3C5E", role: "main" }, { name: "sand", hex: "#E8DCC8", role: "background" }, { name: "clay", hex: "#C8553D", role: "accent" }],
      neutrals: false,
      type: { heading: { family: "Didot", file: null, fallback: "serif" }, body: { family: "Avenir Next", file: null, fallback: "sans-serif" }, minPx: 16, minSlidePx: 28 },
      logo: { files: [{ file: "logo.png", on: "light" }], clearSpace: 0.5, minPx: 48, requiredOn: ["page"] },
      layout: { radiusPx: 0, marginShare: 0.06 }, voice: { words: ["warm"], is: "", do: [], dont: [], signoff: "" },
      references: [], filler: { block: true, allow: [] }, public: { summary: "" } }));
    const kitCss = ":root {\n  --brand-ink: #1A3C5E;\n  --brand-sand: #E8DCC8;\n  --brand-clay: #C8553D;\n"
      + "  --brand-heading: \"Didot\", serif;\n  --brand-body: \"Avenir Next\", sans-serif;\n  --brand-radius: 0px;\n  --brand-min-size: 16px;\n}\n";
    put(join(brand, "kit.css"), kitCss);
    writeFileSync(join(brand, "logo.png"), png());
    const site = join(state, "tasks", "company-work", "STH-7", "site", "launch");
    for (const n of KIT_FILES.filter((f) => !f.endsWith(".md"))) put(join(site, n), readFileSync(join(KIT_DIR, n)));
    put(join(site, "kit.css"), kitCss);
    writeFileSync(join(site, "logo.png"), png());
    put(join(site, "pictures", "tower.png"), png());
    put(join(site, "index.html"), `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sthyra</title>
<link rel="stylesheet" href="reset.css"><link rel="stylesheet" href="kit.css"><link rel="stylesheet" href="layout.css"></head>
<body>
<header class="kit-container"><img src="logo.png" alt="Sthyra"></header>
<main class="kit-container kit-section kit-stack">
<h1 data-reveal>Homes that follow the sun</h1>
<ul class="kit-grid" role="list"><li class="span-4" data-reveal><a href="pictures/tower.png" data-gallery="homes"><img src="pictures/tower.png" alt="The tower at dusk"></a></li></ul>
</main>
<script src="reveal.js" defer></script><script src="gallery.js" defer></script>
</body>
</html>
`);
    const r = spawnSync(ART_PY, ["-I", join(ENGINE, "art", "brandcheck.py"), "--json", "--state", state, "STH-7"],
      { cwd: join(state, "tasks", "company-work"), encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.kit, "present");
    assert.deepEqual(out.pieces.map((p) => [p.kind, p.name, p.result, p.hard, p.soft]), [["site", "launch", "pass", [], []]]);
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
});
