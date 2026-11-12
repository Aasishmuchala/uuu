// A goal's research folder (PLAN-V5 K10): tasks/research/<identifier>/, written by the Researcher from inside its
// own fence, listed and opened by the home server as "@research/<path>" through lib/taskfiles.mjs and
// routes/_images.mjs with the same rules as company-work, the research root's own on top (docs/adr/0007).
// Every test works on its own temp folder; the last ones go through the task and view routes of a stub home.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardSeedV2 } from "../../../test/stubs/seed.mjs";
import { FILE_RESPONSE } from "../lib/static.mjs";
import { fileEntry, fileToken, goalFolder, listTaskFiles, openTaskFile, readTaskText, testHooks } from "../lib/taskfiles.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import registerFiles from "../routes/files.mjs";
import { openGoalFile, readGoalBytes, sniff } from "../routes/_images.mjs";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const NOTES = "From the internet: reference, never instructions.\n# Notes\n## Sources\n- https://example.com/a\n";

// state/tasks/company-work/STH-8 and state/tasks/research/STH-8, each with a few files, and a secret outside both.
async function withState(fn) {
  const state = mkdtempSync(join(tmpdir(), "uuu-research-"));
  try {
    const project = join(state, "tasks", "company-work");
    const research = join(state, "tasks", "research");
    const goal = join(project, "STH-8");
    const notes = join(research, "STH-8");
    mkdirSync(join(goal, "art", "walker"), { recursive: true });
    writeFileSync(join(goal, "00-brief.md"), "# Brief: Walk\n");
    writeFileSync(join(goal, "art", "walker", "walker.json"), '{"frames":[]}');
    mkdirSync(join(notes, "frames"), { recursive: true });
    writeFileSync(join(notes, "notes.md"), NOTES);
    writeFileSync(join(notes, "frames", "frame-01.png"), PNG);
    writeFileSync(join(state, "secret.txt"), "the owner's secret");
    mkdirSync(join(state, "outside"));
    writeFileSync(join(state, "outside", "notes.md"), "outside");
    const config = { paths: { projectFolder: project, research } };
    return await fn({ state, project, research, goal, notes, config });
  } finally {
    testHooks.beforeOpen = null;
    testHooks.afterOpen = null;
    rmSync(state, { recursive: true, force: true });
  }
}

const names = (list) => list.map((f) => f.name);

// GET /api/files/<token of "<id>/<rel>">, the route's own handler: what it would stream ({ fd, file, size, type }
// and its headers, the descriptor closed here) or null for its 404.
let filesHandler;
registerFiles({ get: (_p, handler) => { filesHandler = handler; } });
const fail = (status, message, next, code) => Object.assign(new Error(message), { status, code });
function download(config, id, rel) {
  let answer;
  try {
    answer = filesHandler({ params: { token: fileToken(`${id}/${rel}`) }, config, fail });
  } catch (e) {
    if (e.code === "file_not_found") return null;
    throw e;
  }
  return answer.then((a) => {
    const found = a[FILE_RESPONSE];
    closeSync(found.fd);
    return { file: found.file, size: found.size, type: found.type, headers: a.headers };
  }, (e) => { if (e.code === "file_not_found") return null; throw e; });
}

// Every way the home server opens a goal's file, for one path: null from each means "not found".
const opens = async (config, id, rel) => {
  const opened = openGoalFile(config, id, rel);
  if (opened) closeSync(opened.fd);
  return [readTaskText(config, id, rel), opened, readGoalBytes(config, id, rel, { maxBytes: 1024 }), await download(config, id, rel)];
};
const assertNotFound = async (config, id, rel, why = "") => {
  const got = await opens(config, id, rel);
  ["readTaskText", "openGoalFile", "readGoalBytes", "/api/files"].forEach((way, i) => assert.equal(got[i], null, `${way} ${JSON.stringify(rel)} ${why}`));
};

// ---- listed and opened

test("a file in each root is listed, the research folder's as @research/, sorted together", async () => {
  await withState(async ({ config }) => {
    const list = listTaskFiles(config, "STH-8");
    assert.deepEqual(names(list), ["00-brief.md", "@research/frames/frame-01.png", "@research/notes.md", "art/walker/walker.json"]);
    const entry = list.find((f) => f.name === "@research/notes.md");
    assert.deepEqual(entry, { name: "@research/notes.md", size: Buffer.byteLength(NOTES), mtimeMs: entry.mtimeMs });
  });
});

test("a file in each root is opened: text, bytes and a descriptor, each from its own root", async () => {
  await withState(async ({ config, notes }) => {
    assert.equal(readTaskText(config, "STH-8", "00-brief.md").text, "# Brief: Walk\n");
    const r = readTaskText(config, "STH-8", "@research/notes.md");
    assert.equal(r.text, NOTES);
    assert.deepEqual(Object.keys(r).sort(), ["mtimeMs", "size", "text", "truncated"]);
    assert.equal(readTaskText(config, "STH-8", "@research/notes.md", { maxBytes: 4 }).truncated, true, "the same caps");
    const png = readGoalBytes(config, "STH-8", "@research/frames/frame-01.png", { maxBytes: 1024 });
    assert.equal(sniff(png.bytes), "png");
    assert.equal(png.real, join(realpathSync(notes), "frames", "frame-01.png"));
    assert.deepEqual(readGoalBytes(config, "STH-8", "@research/frames/frame-01.png", { maxBytes: 4 }), { tooLarge: true, size: PNG.length });
    const opened = openTaskFile(config, "STH-8", "@research/notes.md");
    assert.equal(typeof opened.fd, "number");
    assert.equal(opened.real, join(realpathSync(notes), "notes.md"));
    closeSync(opened.fd);
    assert.equal(readTaskText(config, "STH-8", "@research/missing.md"), null);
  });
});

test("/api/files: a research file downloads from the research folder as a company-work file does from its own", async () => {
  await withState(async ({ config, notes, goal }) => {
    const research = await download(config, "STH-8", "@research/notes.md");
    assert.deepEqual(research, { file: join(realpathSync(notes), "notes.md"), size: Buffer.byteLength(NOTES), type: "application/octet-stream",
      headers: { "content-disposition": 'attachment; filename="notes.md"' } });
    const work = await download(config, "STH-8", "00-brief.md");
    assert.deepEqual(work, { file: join(realpathSync(goal), "00-brief.md"), size: 14, type: "application/octet-stream",
      headers: { "content-disposition": 'attachment; filename="00-brief.md"' } });
    assert.equal((await download(config, "STH-8", "@research/frames/frame-01.png")).size, PNG.length);
  });
});

test("fileEntry: a research file is viewed through /api/view and downloaded through /api/files", () => {
  const tok = fileToken("STH-8/@research/notes.md");
  assert.deepEqual(fileEntry("STH-8", "@research/notes.md", 9), { name: "@research/notes.md", size: 9, kind: "text", url: `/api/files/${tok}`, viewUrl: `/api/view/${tok}` });
  assert.equal(fileEntry("STH-8", "@research/frames/frame-01.png", 9).kind, "image");
  assert.equal(fileEntry("STH-8", "@research/page.html", 9).viewUrl, null);
  assert.equal(fileEntry("STH-8", "@research/page.html", 9).url, `/api/files/${fileToken("STH-8/@research/page.html")}`);
  assert.equal(fileEntry("STH-8", "notes.md", 9).url, `/api/files/${fileToken("STH-8/notes.md")}`, "company-work keeps its download");
});

test("a goal with only a research folder still has files, and they open", async () => {
  await withState(async ({ config, research }) => {
    mkdirSync(join(research, "STH-12"));
    writeFileSync(join(research, "STH-12", "notes.md"), NOTES);
    assert.equal(goalFolder(config, "STH-12"), null);
    assert.deepEqual(names(listTaskFiles(config, "STH-12")), ["@research/notes.md"]);
    assert.equal(readTaskText(config, "STH-12", "@research/notes.md").text, NOTES);
    assert.equal((await download(config, "STH-12", "@research/notes.md")).size, Buffer.byteLength(NOTES));
    assert.equal(readTaskText(config, "STH-12", "notes.md"), null, "without the prefix it is company-work's, where there is none");
    assert.equal(await download(config, "STH-12", "notes.md"), null);
  });
});

// ---- paths that try to leave

test("@research/../x, @research//x and every other path trick are not found", async () => {
  await withState(async ({ config, notes, state }) => {
    for (const rel of ["@research/../x", "@research//x", "@research/./notes.md", "@research/frames/../notes.md", "@research/",
      "@research", "@research/../STH-8/notes.md", "@research/../../company-work/STH-8/00-brief.md", "@research/../../../secret.txt",
      "@research/frames//frame-01.png", "@research/frames/", "@research\\notes.md", "@research/notes.md\0.png", `@research/${join(notes, "notes.md")}`,
      `@research${join(state, "secret.txt")}`, `@research/${"x/".repeat(600)}notes.md`, "/@research/notes.md", "./@research/notes.md",
      "@research/frames", "@research/notes.md/x"]) {
      await assertNotFound(config, "STH-8", rel);
    }
  });
});

test("a link in the research folder leaving it is not found and not listed, nor is one pointing inside", async () => {
  await withState(async ({ config, notes, state, goal }) => {
    symlinkSync(join(state, "secret.txt"), join(notes, "secret.md"));
    symlinkSync("../../../secret.txt", join(notes, "relative.md"));
    symlinkSync(join(notes, "notes.md"), join(notes, "inside.md"));
    symlinkSync(join(state, "outside"), join(notes, "out"));
    symlinkSync(goal, join(notes, "work"));
    symlinkSync(join(notes, "frames"), join(notes, "frames2"));
    for (const rel of ["@research/secret.md", "@research/relative.md", "@research/inside.md", "@research/out/notes.md",
      "@research/work/00-brief.md", "@research/frames2/frame-01.png"]) {
      await assertNotFound(config, "STH-8", rel);
    }
    assert.deepEqual(names(listTaskFiles(config, "STH-8")), ["00-brief.md", "@research/frames/frame-01.png", "@research/notes.md", "art/walker/walker.json"]);
  });
});

test("a research folder that is itself a link is not found, to company-work or outside; so is a research root that is a link", async () => {
  await withState(async ({ config, research, goal, state }) => {
    symlinkSync(goal, join(research, "STH-13"));
    mkdirSync(join(state, "outside", "STH-14"));
    writeFileSync(join(state, "outside", "STH-14", "notes.md"), "outside");
    symlinkSync(join(state, "outside", "STH-14"), join(research, "STH-14"));
    writeFileSync(join(research, "STH-15"), "a file, not a folder");
    for (const id of ["STH-13", "STH-14", "STH-15"]) {
      assert.deepEqual(listTaskFiles(config, id), [], id);
      await assertNotFound(config, id, "@research/notes.md", id);
      await assertNotFound(config, id, "@research/00-brief.md", id);
    }
    // The root itself swapped for a link to a folder that holds a goal of the same name.
    const other = join(state, "other-root");
    mkdirSync(join(other, "STH-8"), { recursive: true });
    writeFileSync(join(other, "STH-8", "notes.md"), "from another root");
    renameSync(research, `${research}-real`);
    symlinkSync(other, research);
    assert.deepEqual(names(listTaskFiles(config, "STH-8")), ["00-brief.md", "art/walker/walker.json"], "company-work's files only");
    await assertNotFound(config, "STH-8", "@research/notes.md", "through a root that is a link");
  });
});

test("a FIFO or a folder in the research folder is refused at once and not listed", { timeout: 30000 }, async () => {
  await withState(async ({ config, notes }) => {
    execFileSync("/usr/bin/mkfifo", [join(notes, "pipe.md")]);
    const t = Date.now();
    await assertNotFound(config, "STH-8", "@research/pipe.md");
    await assertNotFound(config, "STH-8", "@research/frames");
    assert.ok(Date.now() - t < 2000);
    assert.ok(!names(listTaskFiles(config, "STH-8")).includes("@research/pipe.md"));
  });
});

// ---- the prefix belongs to the research folder only

test("a real folder named @research in company-work is never reached through the prefix, nor listed", async () => {
  await withState(async ({ config, goal, project }) => {
    mkdirSync(join(goal, "@research"));
    writeFileSync(join(goal, "@research", "notes.md"), "planted in company-work");
    writeFileSync(join(goal, "@research", "only-here.md"), "planted in company-work");
    assert.equal(readTaskText(config, "STH-8", "@research/notes.md").text, NOTES, "the research folder's own file");
    assert.equal((await download(config, "STH-8", "@research/notes.md")).size, Buffer.byteLength(NOTES), "downloaded from the research folder too");
    await assertNotFound(config, "STH-8", "@research/only-here.md");
    const list = listTaskFiles(config, "STH-8");
    assert.deepEqual(names(list), ["00-brief.md", "@research/frames/frame-01.png", "@research/notes.md", "art/walker/walker.json"]);
    assert.equal(list.find((f) => f.name === "@research/notes.md").size, Buffer.byteLength(NOTES));
    // A goal with no research folder: the company-work folder of that name is still not reached, nor listed.
    mkdirSync(join(project, "STH-9", "@research"), { recursive: true });
    writeFileSync(join(project, "STH-9", "@research", "notes.md"), "planted in company-work");
    writeFileSync(join(project, "STH-9", "plan.md"), "a plan");
    await assertNotFound(config, "STH-9", "@research/notes.md");
    assert.deepEqual(names(listTaskFiles(config, "STH-9")), ["plan.md"]);
  });
});

test("another spelling of @research reaches neither folder, and company-work's top folder so spelt is not listed", async () => {
  await withState(async ({ config, goal }) => {
    mkdirSync(join(goal, "@Research-x"));
    writeFileSync(join(goal, "@Research-x", "a.md"), "an ordinary folder");
    for (const spelt of ["@Research", "@RESEARCH", "＠ｒｅｓｅａｒｃｈ", "@reſearch"]) {
      await assertNotFound(config, "STH-8", `${spelt}/notes.md`, spelt);
    }
    mkdirSync(join(goal, "@RESEARCH"));
    writeFileSync(join(goal, "@RESEARCH", "b.md"), "planted");
    // Company-work's own folder of that name, by every spelling, through every way in (/api/files included).
    for (const spelt of ["@research", "@Research", "@RESEARCH", "＠ｒｅｓｅａｒｃｈ", "@reſearch"]) {
      await assertNotFound(config, "STH-8", `${spelt}/b.md`, spelt);
    }
    const listed = names(listTaskFiles(config, "STH-8"));
    assert.ok(!listed.some((n) => /^@research\/b\.md$/i.test(n)), listed.join(", "));
    assert.ok(listed.includes("@Research-x/a.md"), "a name that only starts like it is an ordinary folder");
    assert.equal(readTaskText(config, "STH-8", "@Research-x/a.md").text, "an ordinary folder");
    assert.equal((await download(config, "STH-8", "@Research-x/a.md")).size, 18);
  });
});

test("the identifier pattern still guards both roots", async () => {
  await withState(async ({ config, research, state }) => {
    // Folders a bad identifier could name if it were joined as it is.
    mkdirSync(join(research, "x"), { recursive: true });
    writeFileSync(join(research, "x", "notes.md"), "x");
    for (const id of ["../research/STH-8", "../company-work/STH-8", "..", ".", "", "STH 8", "STH-8/frames", "a".repeat(65),
      null, 8, "STH-8\0", join(research, "STH-8"), "x/..", `${state}`]) {
      assert.deepEqual(listTaskFiles(config, id), [], String(id));
      await assertNotFound(config, id, "@research/notes.md", String(id));
      await assertNotFound(config, id, "00-brief.md", String(id));
    }
    assert.deepEqual(names(listTaskFiles(config, "x")), ["@research/notes.md"], "a plain identifier is fine");
  });
});

test("no research root in the config, or none on disk: the research files are simply not there", async () => {
  await withState(async ({ config, project, research }) => {
    const plain = { paths: { projectFolder: project } };
    for (const c of [plain, { paths: { projectFolder: project, research: "" } }, { paths: { projectFolder: project, research: join(research, "nope") } }]) {
      assert.deepEqual(names(listTaskFiles(c, "STH-8")), ["00-brief.md", "art/walker/walker.json"]);
      await assertNotFound(c, "STH-8", "@research/notes.md");
      assert.equal(readTaskText(c, "STH-8", "00-brief.md").text, "# Brief: Walk\n");
    }
    assert.ok(names(listTaskFiles(config, "STH-8")).includes("@research/notes.md"));
  });
});

test("a goal with no research folder lists and reads byte for byte as without the research root", async () => {
  await withState(async ({ config, project }) => {
    const plain = { paths: { projectFolder: project } };
    mkdirSync(join(project, "STH-10", "drafts"), { recursive: true });
    writeFileSync(join(project, "STH-10", "drafts", "post-a.md"), "one");
    writeFileSync(join(project, "STH-10", "0.md"), "zero");
    writeFileSync(join(project, "STH-10", "Z.md"), "zed");
    assert.deepEqual(names(listTaskFiles(config, "STH-10")), ["0.md", "Z.md", "drafts/post-a.md"]);
    assert.deepEqual(listTaskFiles(config, "STH-10"), listTaskFiles(plain, "STH-10"));
    assert.deepEqual(listTaskFiles(config, "STH-10", { max: 1 }), listTaskFiles(plain, "STH-10", { max: 1 }));
    for (const rel of ["0.md", "drafts/post-a.md", "Z.md", "missing.md", "../STH-8/00-brief.md", "drafts//post-a.md"]) {
      assert.deepEqual(readTaskText(config, "STH-10", rel), readTaskText(plain, "STH-10", rel), rel);
      assert.deepEqual(readGoalBytes(config, "STH-10", rel, { maxBytes: 64 }), readGoalBytes(plain, "STH-10", rel, { maxBytes: 64 }), rel);
      assert.deepEqual(await download(config, "STH-10", rel), await download(plain, "STH-10", rel), rel);
    }
    assert.equal((await download(config, "STH-10", "drafts/post-a.md")).file, join(realpathSync(project), "STH-10", "drafts", "post-a.md"));
    for (const name of ["0.md", "drafts/post-a.md", "art/x.png", "page.html"]) {
      assert.equal(fileEntry("STH-10", name, 3).url, `/api/files/${fileToken(`STH-10/${name}`)}`, name);
    }
  });
});

// ---- the caps cover both roots together

test("the list's cap covers both roots: at most max entries in all, sorted across them", async () => {
  await withState(async ({ config, goal, notes }) => {
    mkdirSync(join(goal, "many"));
    mkdirSync(join(notes, "many"));
    for (let i = 0; i < 150; i += 1) {
      writeFileSync(join(goal, "many", `f${String(i).padStart(3, "0")}.txt`), "x");
      writeFileSync(join(notes, "many", `r${String(i).padStart(3, "0")}.txt`), "x");
    }
    const list = listTaskFiles(config, "STH-8");
    assert.equal(list.length, 200);
    const all = names(listTaskFiles(config, "STH-8", { max: 1000 }));
    assert.equal(all.length, 304);
    assert.deepEqual(all, [...all].sort());
    assert.deepEqual(names(list), all.slice(0, 200));
    assert.equal(listTaskFiles(config, "STH-8", { max: 3 }).length, 3);
  });
});

test("the entries looked at are counted across both roots: company-work's fill the budget, the research folder's are not read", { timeout: 120000 }, async () => {
  await withState(async ({ project, research, config }) => {
    // 20000 entries in all are looked at (lib/taskfiles.mjs SCAN_ENTRIES): one folder and 19999 files use them up.
    const many = join(project, "STH-20", "many");
    mkdirSync(many, { recursive: true });
    for (let i = 0; i < 19999; i += 1) writeFileSync(join(many, `f${i}`), "");
    mkdirSync(join(research, "STH-20"));
    writeFileSync(join(research, "STH-20", "notes.md"), NOTES);
    const full = names(listTaskFiles(config, "STH-20", { max: 10000 }));
    assert.equal(full.length, 10000);
    assert.ok(!full.some((n) => n.startsWith("@research/")), "nothing of the research folder once the budget is spent");
    rmSync(join(many, "f0"));
    const one = names(listTaskFiles(config, "STH-20", { max: 10000 }));
    assert.equal(one[0], "@research/notes.md", "one entry left in the budget: the research folder's one file");
  });
});

// ---- links swapped in around the open (the research root and the goal's research folder too)

function swapper(from, to) {
  return {
    swapIn: () => { renameSync(from, `${from}-real`); symlinkSync(to, from); },
    swapOut: () => { unlinkSync(from); renameSync(`${from}-real`, from); },
  };
}

test("the research root or the goal's research folder swapped for a link before the open is refused", async () => {
  await withState(async ({ config, research, notes, state }) => {
    const other = join(state, "other-root");
    mkdirSync(join(other, "STH-8", "frames"), { recursive: true });
    writeFileSync(join(other, "STH-8", "notes.md"), "from another root");
    writeFileSync(join(other, "STH-8", "frames", "frame-01.png"), PNG);
    for (const s of [swapper(research, other), swapper(notes, join(other, "STH-8"))]) {
      for (const read of [
        () => readTaskText(config, "STH-8", "@research/notes.md"),
        () => readGoalBytes(config, "STH-8", "@research/frames/frame-01.png", { maxBytes: 1024 }),
        () => openGoalFile(config, "STH-8", "@research/notes.md"),
        () => download(config, "STH-8", "@research/notes.md"),
      ]) {
        testHooks.beforeOpen = () => { testHooks.beforeOpen = null; s.swapIn(); };
        assert.equal(await read(), null);
        s.swapOut();
        assert.equal(readTaskText(config, "STH-8", "@research/notes.md").text, NOTES, "the place is back as it was");
      }
    }
  });
});

test("a link swapped in for the open and back out before the checks is refused, at the root too", async () => {
  await withState(async ({ config, research, notes, state }) => {
    const other = join(state, "other-root");
    mkdirSync(join(other, "STH-8", "frames"), { recursive: true });
    writeFileSync(join(other, "STH-8", "notes.md"), "from another root");
    writeFileSync(join(other, "STH-8", "frames", "frame-01.png"), PNG);
    for (const s of [swapper(research, other), swapper(notes, join(other, "STH-8")), swapper(join(notes, "frames"), join(other, "STH-8", "frames"))]) {
      for (const read of [
        () => readTaskText(config, "STH-8", "@research/frames/frame-01.png"),
        () => readGoalBytes(config, "STH-8", "@research/frames/frame-01.png", { maxBytes: 1024 }),
        () => openGoalFile(config, "STH-8", "@research/frames/frame-01.png"),
        () => download(config, "STH-8", "@research/frames/frame-01.png"),
      ]) {
        testHooks.beforeOpen = () => { testHooks.beforeOpen = null; s.swapIn(); };
        testHooks.afterOpen = () => { testHooks.afterOpen = null; s.swapOut(); };
        assert.equal(await read(), null);
        assert.equal(readGoalBytes(config, "STH-8", "@research/frames/frame-01.png", { maxBytes: 1024 }).bytes.length, PNG.length, "back as it was");
      }
    }
  });
});

test("the research root or the goal's research folder swapped for a link after the folders were checked is refused", async () => {
  await withState(async ({ config, research, notes, state }) => {
    const other = join(state, "other-root");
    mkdirSync(join(other, "STH-8", "frames"), { recursive: true });
    writeFileSync(join(other, "STH-8", "notes.md"), "from another root");
    writeFileSync(join(other, "STH-8", "frames", "frame-01.png"), PNG);
    for (const s of [swapper(research, other), swapper(notes, join(other, "STH-8"))]) {
      for (const read of [
        () => readTaskText(config, "STH-8", "@research/notes.md"),
        () => readGoalBytes(config, "STH-8", "@research/frames/frame-01.png", { maxBytes: 1024 }),
        () => openTaskFile(config, "STH-8", "@research/notes.md"),
        () => download(config, "STH-8", "@research/notes.md"),
      ]) {
        // Swapped in after the root and the goal's folder were found, before openChecked looks at them.
        testHooks.afterPlace = () => { testHooks.afterPlace = null; s.swapIn(); };
        assert.equal(await read(), null);
        s.swapOut();
        // Swapped in and back out around the open: the file opened is not inside the folder found first.
        testHooks.afterPlace = () => { testHooks.afterPlace = null; s.swapIn(); };
        testHooks.afterOpen = () => { testHooks.afterOpen = null; s.swapOut(); };
        assert.equal(await read(), null);
        assert.equal(readTaskText(config, "STH-8", "@research/notes.md").text, NOTES, "the place is back as it was");
      }
    }
  });
});

test("a research file swapped for a link to a secret before the open is refused", async () => {
  await withState(async ({ config, notes, state }) => {
    const file = join(notes, "notes.md");
    for (const read of [() => readTaskText(config, "STH-8", "@research/notes.md"), () => download(config, "STH-8", "@research/notes.md")]) {
      writeFileSync(join(notes, "fresh.md"), NOTES);
      renameSync(join(notes, "fresh.md"), file);
      testHooks.beforeOpen = () => { testHooks.beforeOpen = null; rmSync(file); symlinkSync(join(state, "secret.txt"), file); };
      assert.equal(await read(), null);
      rmSync(file);
    }
  });
});

// ---- through the routes of a stub home: the task's files and /api/view

const token = (rel) => Buffer.from(rel, "utf8").toString("base64url");

test("routes: the task lists a research file; /api/view and /api/files open it from the research folder, never company-work's", async () => {
  const h = await startV2({ routes: ["task.mjs", "inbox.mjs", "view.mjs", "files.mjs"], inbox: ["goals.mjs"], search: [], boardSeed: boardSeedV2() });
  try {
    const notes = join(h.config.paths.research, "STH-8");
    mkdirSync(join(notes, "frames"), { recursive: true });
    writeFileSync(join(notes, "notes.md"), NOTES);
    writeFileSync(join(notes, "frames", "frame-01.png"), PNG);
    const planted = join(h.state, "tasks", "company-work", "STH-8", "@research");
    mkdirSync(planted, { recursive: true });
    writeFileSync(join(planted, "notes.md"), "planted in company-work");
    writeFileSync(join(planted, "frame-02.png"), PNG);

    const t = await call(h.url, "GET", "/api/tasks/STH-8");
    assert.equal(t.status, 200, t.text);
    const files = t.json.files;
    const entry = files.find((f) => f.name === "@research/notes.md");
    const tok = token("STH-8/@research/notes.md");
    assert.deepEqual(entry, { name: "@research/notes.md", size: Buffer.byteLength(NOTES), kind: "text", url: `/api/files/${tok}`, viewUrl: `/api/view/${tok}` });
    assert.ok(files.some((f) => f.name === "00-brief.md"), "company-work's files are still there");
    assert.equal(files.filter((f) => f.name.startsWith("@research/")).length, 2, files.map((f) => f.name).join(", "));

    const got = await call(h.url, "GET", entry.url);
    assert.equal(got.status, 200, got.text);
    assert.equal(got.text, NOTES, "the research folder's file, not the one planted in company-work");

    const text = await call(h.url, "GET", entry.viewUrl);
    assert.equal(text.status, 200, text.text);
    assert.deepEqual(text.json, { name: "@research/notes.md", text: NOTES, truncated: false });
    const pic = await call(h.url, "GET", `/api/view/${token("STH-8/@research/frames/frame-01.png")}`);
    assert.equal(pic.status, 200);
    assert.equal(pic.headers["content-type"], "image/png");
    assert.equal(pic.headers["content-security-policy"], "default-src 'none'; sandbox");
    for (const rel of ["STH-8/@research/frame-02.png", "STH-8/@research/../00-brief.md", "STH-8/@research//notes.md", "STH-8/@Research/notes.md", "STH-9/@research/notes.md"]) {
      for (const route of ["view", "files"]) {
        const r = await call(h.url, "GET", `/api/${route}/${token(rel)}`);
        assert.equal(r.status, 404, `${route} ${rel}`);
        assert.equal(r.json.error.code, "file_not_found", `${route} ${rel}`);
      }
    }
  } finally { await h.close(); }
});

test("routes: /api/files sends a research file with a company-work file's headers: an attachment, never HTML, its size at the open", async () => {
  const h = await startV2({ routes: ["files.mjs"], boardSeed: boardSeedV2() });
  try {
    const notes = join(h.config.paths.research, "STH-8");
    const work = join(h.state, "tasks", "company-work", "STH-8");
    mkdirSync(notes, { recursive: true });
    const page = "<!doctype html><title>x</title><script>fetch('/api/settings')</script>\n";
    for (const dir of [notes, work]) {
      writeFileSync(join(dir, "same.md"), NOTES);
      writeFileSync(join(dir, "page.html"), page);
    }
    const strip = (headers) => { const { date, connection, "keep-alive": k, ...rest } = headers; return rest; };
    for (const name of ["same.md", "page.html"]) {
      const research = await call(h.url, "GET", `/api/files/${token(`STH-8/@research/${name}`)}`);
      const company = await call(h.url, "GET", `/api/files/${token(`STH-8/${name}`)}`);
      assert.equal(research.status, 200, research.text);
      assert.deepEqual(strip(research.headers), strip(company.headers), name);
      assert.equal(research.headers["content-type"], "application/octet-stream", "never text/html");
      assert.equal(research.headers["content-disposition"], `attachment; filename="${name}"`);
      assert.equal(research.headers["x-content-type-options"], "nosniff");
      assert.equal(Number(research.headers["content-length"]), research.buffer.length);
    }
    assert.equal((await call(h.url, "GET", `/api/files/${token("STH-8/@research/page.html")}`)).text, page, "the bytes as they are, to be saved");
    // The size is the one measured at the open: bytes added later are not sent (CONTRACTS 9.4, as for company-work).
    let found;
    registerFiles({ get: (_p, handler) => { found = handler; } });
    const answer = await found({ params: { token: token("STH-8/@research/same.md") }, config: h.config, fail });
    writeFileSync(join(notes, "same.md"), "x".repeat(10000), { flag: "a" });
    assert.equal(answer[FILE_RESPONSE].size, Buffer.byteLength(NOTES));
    closeSync(answer[FILE_RESPONSE].fd);
  } finally { await h.close(); }
});
