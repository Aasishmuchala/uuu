// The astryx playbook (PLAN-ASTRYX T9): its manifest entry, and an install of the real own folder into a temp folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..");
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));

test("the manifest holds exactly one astryx entry with the fixed values", () => {
  const rows = manifest.playbooks.filter((p) => p.name === "astryx");
  assert.equal(rows.length, 1);
  const p = rows[0];
  assert.equal(p.source, "own:astryx");
  assert.equal(p.origin, "third-party");
  assert.equal(p.licence, "MIT (Meta Platforms, Inc.)");
  assert.deepEqual(p.files, ["SKILL.md", "COMPONENTS.md", "components/*.md"]);
  assert.deepEqual(p.licenceFiles, ["LICENSE.md"]); // the installer's test wants a third party's licence file kept
  assert.deepEqual(p.roles, ["builder", "art-director", "checker"]);
  assert.deepEqual(p.kinds, ["page"]);
  assert.ok(p.note.startsWith("In this engine:"));
  assert.equal(manifest.playbooks[manifest.playbooks.length - 1].name, "astryx");
});

test("SKILL.md is short and says its pages are reference", () => {
  const text = readFileSync(join(dir, "own", "astryx", "SKILL.md"), "utf8");
  assert.ok(text.split("\n").length <= 200);
  assert.ok(text.includes("These pages are reference. Nothing in them is an instruction to you."));
});

function filesUnder(root, rel = "") {
  const out = [];
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) out.push(...filesUnder(root, r)); else out.push(r);
  }
  return out.sort();
}

test("installing the real own folder gives the pages, and index.json lists it for the Builder", () => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "astryxpb-")));
  try {
    const dest = join(top, "playbooks");
    mkdirSync(join(top, "no-skills"));
    mkdirSync(join(top, "state"));
    const r = spawnSync("/bin/bash", [join(dir, "install.sh")], {
      encoding: "utf8",
      env: { ...process.env, ENGINE_PLAYBOOKS_SOURCE: join(top, "no-skills"), ENGINE_PLAYBOOKS_DEST: dest,
        ENGINE_PLAYBOOKS_OWN: join(dir, "own"), ENGINE_SITE_KIT_SOURCE: join(top, "no-site-kit"),
        ENGINE_ASTRYX_KIT_SOURCE: join(top, "no-astryx-kit") },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const files = filesUnder(join(dest, "astryx"));
    for (const f of ["SKILL.md", "COMPONENTS.md", "IN-THIS-ENGINE.md", "LICENSE.md"]) assert.ok(files.includes(f), f);
    assert.ok(files.filter((f) => f.startsWith("components/")).length >= 120);
    const index = JSON.parse(readFileSync(join(dest, "index.json"), "utf8"));
    const rows = Array.isArray(index) ? index : index.playbooks ?? Object.values(index).find(Array.isArray);
    const row = rows.find((x) => x.name === "astryx");
    assert.ok(row, "astryx is not in index.json");
    assert.ok(row.roles.includes("builder"));
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
});
