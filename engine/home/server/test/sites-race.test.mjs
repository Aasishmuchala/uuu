// T57 F1: the home server reads files an agent wrote while a process in the agent's fence swaps a folder of them
// for a link to a folder outside and back, as fast as it can (renamex_np RENAME_SWAP, atomic). The site reader
// (readSite: the preview and the zip), the zip and the preview archive built from it, and the goal-file reader
// (readTaskText, readGoalBytes: shot lists, variants, pieces, research, Studio pictures) must never return a byte
// of the outside file. Temp folders only, removed at the end.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeTar } from "../../../viewer/tar.mjs";
import { writeZip } from "../../../viewer/zip.mjs";
import { readSite } from "../lib/siteshots.mjs";
import { readTaskText } from "../lib/taskfiles.mjs";
import { readGoalBytes } from "../routes/_images.mjs";

const RUNS = 3000;
const CANARY = "OWNER-ONLY-CANARY";
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const SWAPPER = `
import ctypes, os, sys
libc = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
a, b = sys.argv[1].encode(), sys.argv[2].encode()
os.symlink(sys.argv[3], sys.argv[2])
while True:
    libc.renamex_np(a, b, 2)
`;

// Ends the swapper and waits until it is gone. SIGKILL alone is not enough: a swap already inside the kernel still
// lands after kill() returns, and on a busy Mac (the full suite) that was late enough to put a folder back while the
// cleanup below was removing the tree (ENOTEMPTY). The exit event comes only once the process is reaped.
function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  const gone = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGKILL");
  return gone;
}

// A goal folder with `inside` (a folder holding auth.json, a decoy) and an outside folder holding the canary;
// the swapper runs while `body` does.
async function racing(inside, body) {
  const base = mkdtempSync(join(tmpdir(), "sites-race-"));
  dirs.push(base);
  const project = join(base, "company-work");
  const goal = join(project, "STH-1");
  const outside = join(base, "owner-private");
  mkdirSync(join(goal, inside), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(goal, inside, "auth.json"), "{\"decoy\":true}");
  writeFileSync(join(outside, "auth.json"), `{"token":"${CANARY}"}`);
  const config = { paths: { projectFolder: project } };
  const alt = join(goal, "alt");
  const child = spawn("/usr/bin/python3", ["-I", "-c", SWAPPER, join(goal, inside), alt, outside], { stdio: "ignore" });
  try {
    // The swapper's first act is the link; until it is there (Python can start slowly on a busy Mac) nothing races.
    const until = Date.now() + 15000;
    for (;;) {
      try { lstatSync(alt); break; } catch { /* not yet */ }
      assert.ok(child.exitCode === null && child.signalCode === null, "the swapper ended before it began");
      assert.ok(Date.now() < until, "the swapper did not begin within 15 seconds");
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 300));
    return await body({ config, goal });
  } finally {
    await stop(child);
  }
}

test("readSite, its zip and its preview archive never hold a file outside the site while a folder is swapped", async () => {
  await racing("site/launch-a/data", async ({ config, goal }) => {
    writeFileSync(join(goal, "site", "launch-a", "index.html"), "<!doctype html><title>x</title>");
    let read = 0;
    let leaked = 0;
    for (let i = 0; i < RUNS; i++) {
      const r = readSite(config, "STH-1", "site/launch-a");
      if (!r.ok) continue;
      read++;
      if (r.files.some((f) => f.data.includes(CANARY))) leaked++;
      if (writeTar(r.files).includes(CANARY)) leaked++;
      writeZip(r.files);
    }
    assert.equal(leaked, 0, `${leaked} reads held the outside file`);
    assert.ok(read > 0, "some reads of the site went through");
  });
});

test("a goal's file read by readTaskText and readGoalBytes never holds a file outside the goal while a folder is swapped", async () => {
  await racing("art/data", async ({ config }) => {
    let read = 0;
    let leaked = 0;
    for (let i = 0; i < RUNS; i++) {
      const t = readTaskText(config, "STH-1", "art/data/auth.json");
      if (t) { read++; if (t.text.includes(CANARY)) leaked++; }
      const b = readGoalBytes(config, "STH-1", "art/data/auth.json", { maxBytes: 1024 });
      if (b && b.bytes && Buffer.from(b.bytes).includes(CANARY)) leaked++;
    }
    assert.equal(leaked, 0, `${leaked} reads held the outside file`);
    assert.ok(read > 0, "some reads went through");
  });
});

test("a goal folder under a system link (/var, /tmp on this Mac) is still read", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "sites-race-")));
  dirs.push(base);
  mkdirSync(join(base, "company-work", "STH-2", "art"), { recursive: true });
  writeFileSync(join(base, "company-work", "STH-2", "art", "a.json"), "{}");
  const viaLink = base.replace(/^\/private\//, "/");
  assert.equal(readTaskText({ paths: { projectFolder: join(viaLink, "company-work") } }, "STH-2", "art/a.json").text, "{}");
});
