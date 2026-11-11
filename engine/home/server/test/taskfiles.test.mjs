// Reading what agents wrote, safely (CONTRACTS-V2 16.1). Every test works on its own temp folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { closeSync, fstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import registerFiles from "../routes/files.mjs";
import { fileEntry, fileToken, goalFolder, kindOf, listTaskFiles, readTaskText } from "../lib/taskfiles.mjs";

// state/tasks/company-work/STH-8 with a few files, and a secret outside the project folder.
async function withProject(fn) {
  const state = mkdtempSync(join(tmpdir(), "uuu-taskfiles-"));
  try {
    const project = join(state, "tasks", "company-work");
    const goal = join(project, "STH-8");
    mkdirSync(join(goal, "art", "walker"), { recursive: true });
    writeFileSync(join(goal, "00-brief.md"), "# Brief: Walk\n## Must-haves\n- four frames\n");
    writeFileSync(join(goal, "art", "walker", "walker.json"), '{"frames":[]}');
    writeFileSync(join(state, "secret.txt"), "the owner's secret");
    mkdirSync(join(state, "outside"));
    writeFileSync(join(state, "outside", "x.md"), "outside");
    const config = { paths: { projectFolder: project } };
    return await fn({ state, project, goal, config });
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
}

test("goalFolder: the real folder of a plain identifier", async () => {
  await withProject(({ config, goal, state }) => {
    assert.equal(goalFolder(config, "STH-8"), realpathSync(goal));
    for (const bad of ["STH-8/art", "../STH-8", "..", ".", "", "STH 8", "a".repeat(65), null, 8, "STH-9"]) {
      assert.equal(goalFolder(config, bad), null, String(bad));
    }
    assert.equal(goalFolder({}, "STH-8"), null);
    assert.equal(goalFolder(undefined, "STH-8"), null);
    // A goal folder that is a link, even to a folder inside the project, is refused.
    symlinkSync(join(state, "outside"), join(config.paths.projectFolder, "STH-OUT"));
    symlinkSync(goal, join(config.paths.projectFolder, "STH-ALIAS"));
    assert.equal(goalFolder(config, "STH-OUT"), null);
    assert.equal(goalFolder(config, "STH-ALIAS"), null);
    writeFileSync(join(config.paths.projectFolder, "STH-FILE"), "x");
    assert.equal(goalFolder(config, "STH-FILE"), null);
  });
});

test("readTaskText: a normal file, at the top and in a folder", async () => {
  await withProject(({ config }) => {
    const r = readTaskText(config, "STH-8", "00-brief.md");
    assert.equal(r.text, "# Brief: Walk\n## Must-haves\n- four frames\n");
    assert.equal(r.size, 42);
    assert.equal(r.truncated, false);
    assert.equal(typeof r.mtimeMs, "number");
    assert.deepEqual(Object.keys(r).sort(), ["mtimeMs", "size", "text", "truncated"]);
    assert.equal(readTaskText(config, "STH-8", "art/walker/walker.json").text, '{"frames":[]}');
    assert.equal(readTaskText(config, "STH-8", "missing.md"), null);
    assert.equal(readTaskText(config, "STH-9", "00-brief.md"), null);
  });
});

test("readTaskText: a file that is a link pointing outside the folder is not read", async () => {
  await withProject(({ config, goal, state }) => {
    symlinkSync(join(state, "secret.txt"), join(goal, "secret.md"));
    symlinkSync("../../../secret.txt", join(goal, "relative.md"));
    symlinkSync(join(goal, "00-brief.md"), join(goal, "inside-link.md"));
    assert.equal(readTaskText(config, "STH-8", "secret.md"), null);
    assert.equal(readTaskText(config, "STH-8", "relative.md"), null);
    assert.equal(readTaskText(config, "STH-8", "inside-link.md"), null, "a link is refused even when it points inside");
  });
});

test("readTaskText: a folder on the way that is a link is refused", async () => {
  await withProject(({ config, goal, state }) => {
    symlinkSync(join(state, "outside"), join(goal, "out"));
    symlinkSync(join(goal, "art"), join(goal, "art2"));
    assert.equal(readTaskText(config, "STH-8", "out/x.md"), null);
    assert.equal(readTaskText(config, "STH-8", "art2/walker/walker.json"), null);
    assert.equal(readTaskText(config, "STH-8", "00-brief.md/x"), null, "a file on the way");
  });
});

test("readTaskText: .., an absolute path, a backslash, a NUL and empty parts are refused", async () => {
  await withProject(({ config, goal, state }) => {
    for (const rel of ["../STH-8/00-brief.md", "art/../00-brief.md", "./00-brief.md", join(goal, "00-brief.md"),
      "/etc/hosts", "art\\walker\\walker.json", "00-brief.md\0.png", "art//walker/walker.json", "art/walker/",
      "", null, 5, "../../../secret.txt", join(state, "secret.txt"), "x".repeat(2000)]) {
      assert.equal(readTaskText(config, "STH-8", rel), null, JSON.stringify(rel));
    }
  });
});

test("readTaskText: a file over the cap comes back cut, with truncated true", async () => {
  await withProject(({ config, goal }) => {
    writeFileSync(join(goal, "big.log"), "a".repeat(300000));
    const r = readTaskText(config, "STH-8", "big.log");
    assert.equal(r.truncated, true);
    assert.equal(r.text.length, 262144);
    assert.equal(r.size, 300000);
    const small = readTaskText(config, "STH-8", "big.log", { maxBytes: 10 });
    assert.equal(small.text, "aaaaaaaaaa");
    assert.equal(small.truncated, true);
    assert.equal(readTaskText(config, "STH-8", "big.log", { maxBytes: 300000 }).truncated, false);
    // A character cut by the cap is dropped, not turned into a replacement mark.
    writeFileSync(join(goal, "rupee.txt"), "₹₹₹");
    assert.equal(readTaskText(config, "STH-8", "rupee.txt", { maxBytes: 4 }).text, "₹");
  });
});

test("readTaskText: bytes that are not UTF-8 are replaced", async () => {
  await withProject(({ config, goal }) => {
    writeFileSync(join(goal, "odd.txt"), Buffer.from([0x68, 0x69, 0xff, 0xfe, 0x21]));
    assert.equal(readTaskText(config, "STH-8", "odd.txt").text, "hi��!");
  });
});

test("readTaskText: a FIFO or a folder is refused, and a FIFO does not hang", async () => {
  await withProject(({ config, goal }) => {
    execFileSync("/usr/bin/mkfifo", [join(goal, "pipe.txt")]);
    assert.equal(readTaskText(config, "STH-8", "pipe.txt"), null);
    assert.equal(readTaskText(config, "STH-8", "art"), null);
    assert.equal(readTaskText(config, "STH-8", "art/walker"), null);
  });
});

test("listTaskFiles: regular files only, sorted, no links and no dot files", async () => {
  await withProject(({ config, goal, state }) => {
    writeFileSync(join(goal, ".hidden.md"), "x");
    mkdirSync(join(goal, ".git"));
    writeFileSync(join(goal, ".git", "config"), "x");
    writeFileSync(join(goal, "a.txt"), "12345");
    symlinkSync(join(state, "secret.txt"), join(goal, "link.md"));
    symlinkSync(join(state, "outside"), join(goal, "linked-folder"));
    execFileSync("/usr/bin/mkfifo", [join(goal, "pipe.txt")]);
    const list = listTaskFiles(config, "STH-8");
    assert.deepEqual(list.map((f) => f.name), ["00-brief.md", "a.txt", "art/walker/walker.json"]);
    assert.deepEqual(list[1], { name: "a.txt", size: 5, mtimeMs: list[1].mtimeMs });
    assert.equal(typeof list[1].mtimeMs, "number");
    assert.deepEqual(listTaskFiles(config, "../tasks"), []);
    assert.deepEqual(listTaskFiles(config, "STH-9"), []);
  });
});

test("listTaskFiles: a folder with more files than the cap stops at max", async () => {
  await withProject(({ config, goal }) => {
    mkdirSync(join(goal, "many"));
    for (let i = 0; i < 250; i += 1) writeFileSync(join(goal, "many", `f${String(i).padStart(3, "0")}.txt`), "x");
    const list = listTaskFiles(config, "STH-8");
    assert.equal(list.length, 200);
    assert.equal(list[0].name, "00-brief.md");
    const names = list.map((f) => f.name);
    assert.deepEqual(names, [...names].sort());
    assert.equal(listTaskFiles(config, "STH-8", { max: 5 }).length, 5);
    assert.equal(listTaskFiles(config, "STH-8", { max: 1000 }).length, 252);
  });
});

test("kindOf and fileEntry: viewUrl only for images and text", async () => {
  const kinds = { "a.png": "image", "a.GIF": "image", "x/y.jpg": "image", "a.jpeg": "image", "a.webp": "image", "a.svg": "image",
    "a.md": "text", "a.txt": "text", "a.json": "text", "a.py": "text", "a.csv": "text", "a.log": "text",
    "a.step": "cad", "a.STP": "cad", "a.html": "file", "a.pdf": "file", "noext": "file", ".png": "file", "a.png.exe": "file" };
  for (const [name, kind] of Object.entries(kinds)) assert.equal(kindOf(name), kind, name);

  const img = fileEntry("STH-8", "art/walker/walker-sheet.png", 412);
  const tok = Buffer.from("STH-8/art/walker/walker-sheet.png", "utf8").toString("base64url");
  assert.deepEqual(img, { name: "art/walker/walker-sheet.png", size: 412, kind: "image", url: `/api/files/${tok}`, viewUrl: `/api/view/${tok}` });
  assert.equal(fileEntry("STH-8", "00-brief.md", 1).viewUrl, `/api/view/${fileToken("STH-8/00-brief.md")}`);
  assert.equal(fileEntry("STH-8", "cad/bracket.step", 1).viewUrl, null);
  assert.equal(fileEntry("STH-8", "page.html", 1).viewUrl, null);
  assert.equal(fileEntry("STH-8", "page.html", 1).kind, "file");
});

test("kindOf and fileEntry: .mp4 is a video, and a video is viewable (C3 37.4)", () => {
  for (const name of ["a.mp4", "a.MP4", "video/title/title.mp4"]) assert.equal(kindOf(name), "video", name);
  for (const name of ["a.mov", "a.m4v", "a.mp4.exe", ".mp4", "mp4"]) assert.notEqual(kindOf(name), "video", name);
  const tok = fileToken("STH-25/video/title/title.mp4");
  assert.deepEqual(fileEntry("STH-25", "video/title/title.mp4", 5041),
    { name: "video/title/title.mp4", size: 5041, kind: "video", url: `/api/files/${tok}`, viewUrl: `/api/view/${tok}` });
  assert.equal(fileEntry("STH-25", "video/title/clip.mov", 1).viewUrl, null);
});

test("fileToken round-trips through the rules of /api/files", async () => {
  await withProject(async ({ config, goal }) => {
    let handler;
    registerFiles({ get: (_p, h) => { handler = h; } });
    const fail = (status, message, next, code) => Object.assign(new Error(message), { status, code });
    for (const name of ["00-brief.md", "art/walker/walker.json"]) {
      const entry = fileEntry("STH-8", name, 1);
      const token = entry.url.slice("/api/files/".length);
      assert.equal(Buffer.from(token, "base64url").toString("utf8"), `STH-8/${name}`);
      const answer = await handler({ params: { token }, config, fail });
      const found = answer[Object.getOwnPropertySymbols(answer)[0]];
      assert.equal(found.file, realpathSync(join(goal, name)));
      // The answer streams from the descriptor already opened and checked, never from the path again.
      assert.equal(typeof found.fd, "number");
      assert.equal(fstatSync(found.fd).ino, statSync(join(goal, name)).ino);
      closeSync(found.fd);
    }
  });
});
