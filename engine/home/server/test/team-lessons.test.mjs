// Editing an agent's lessons (CONTRACTS-V2 17.5, V28): add, replace, delete; the one-line rule; the hash check;
// the temp-file-and-rename write with one retry; only state/lessons/<slug>.md for a slug in the company file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { readShape, sameShape } from "../lib/shape.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { testHooks } from "../routes/team-lessons.mjs";

async function withHome(fn) {
  const h = await startV2({ routes: ["team-lessons"] });
  try { return await fn(h); } finally { testHooks.beforeRename = null; await h.close(); }
}
const lessonsDir = (h) => h.config.paths.lessons;
const fileOf = (h, slug) => join(lessonsDir(h), `${slug}.md`);
const read = (h, slug) => readFileSync(fileOf(h, slug), "utf8");
const hashOf = (line) => createHash("sha256").update(line, "utf8").digest("hex").slice(0, 8);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const add = (h, slug, text) => call(h.url, "POST", `/api/team/${slug}/lessons`, { body: { text } });
const replace = (h, slug, n, text, hash) => call(h.url, "POST", `/api/team/${slug}/lessons/${n}`, { body: { text, hash } });
const remove = (h, slug, n, hash) => call(h.url, "DELETE", `/api/team/${slug}/lessons/${n}?hash=${encodeURIComponent(hash)}`);
const lessonShape = () => readShape("agent").lessons[0];

const SAMPLE = [
  "# Lessons for the Builder",
  "- 2026-11-09: Keep each goal's files in a sub-folder.",
  "Written by hand: not a lesson.",
  "- 2026-11-10: Write the file first, then report it.",
  "- An undated lesson.",
  "",
].join("\n");

function seedSample(h, slug = "builder") {
  mkdirSync(lessonsDir(h), { recursive: true });
  writeFileSync(fileOf(h, slug), SAMPLE);
}

// Every file under the state folder, with its size and modified time (to prove nothing was written).
function snapshot(root) {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(`${relative(root, p)}:${st.size}:${st.mtimeMs}`);
    }
  };
  walk(root);
  return out;
}

const noTempFiles = (h) => assert.deepEqual(readdirSync(lessonsDir(h)).filter((n) => n.startsWith(".")), []);

test("add appends a dated line and returns the lesson with its hash; a missing file is created with mode 0644", async () => {
  await withHome(async (h) => {
    rmSync(fileOf(h, "builder"), { force: true });
    const r = await add(h, "builder", "  Name every file after its goal.  ");
    assert.equal(r.status, 201);
    const line = `- ${today()}: Name every file after its goal.`;
    assert.deepEqual(r.json.lesson, { n: 1, date: today(), text: "Name every file after its goal.", hash: hashOf(line) });
    assert.deepEqual(sameShape(lessonShape(), r.json.lesson), []);
    assert.equal(r.json.lesson.hash.length, 8);
    assert.equal(read(h, "builder"), `${line}\n`);
    assert.equal(statSync(fileOf(h, "builder")).mode & 0o777, 0o644);

    seedSample(h);
    const r2 = await add(h, "builder", "Second.");
    assert.equal(r2.status, 201);
    assert.equal(r2.json.lesson.n, 4);
    assert.equal(read(h, "builder"), `${SAMPLE}- ${today()}: Second.\n`);
    noTempFiles(h);
  });
});

test("add to a file without a final line break keeps the last line whole", async () => {
  await withHome(async (h) => {
    mkdirSync(lessonsDir(h), { recursive: true });
    writeFileSync(fileOf(h, "marketer"), "- 2026-11-01: One.");
    const r = await add(h, "marketer", "Two.");
    assert.equal(r.status, 201);
    assert.equal(read(h, "marketer"), `- 2026-11-01: One.\n- ${today()}: Two.\n`);
  });
});

test("a text with a line break, a control character, 501 characters or only spaces is refused with bad_lesson", async () => {
  await withHome(async (h) => {
    seedSample(h);
    for (const text of ["one\ntwo", "one\rtwo", "tab\there", "bell\u0007", "a\u2028b", "x".repeat(501), "   ", "", 42, null]) {
      const r = await add(h, "builder", text);
      assert.equal(r.status, 400, JSON.stringify(text));
      assert.equal(r.json.error.code, "bad_lesson");
      assert.ok(r.json.error.message && r.json.error.next);
      const p = await replace(h, "builder", 1, text, hashOf("- 2026-11-09: Keep each goal's files in a sub-folder."));
      assert.equal(p.status, 400, JSON.stringify(text));
      assert.equal(p.json.error.code, "bad_lesson");
    }
    assert.equal(read(h, "builder"), SAMPLE);
    assert.equal((await add(h, "builder", "x".repeat(500))).status, 201);
  });
});

test("replace with the right hash changes only that line and keeps its date", async () => {
  await withHome(async (h) => {
    seedSample(h);
    const old = "- 2026-11-10: Write the file first, then report it.";
    const r = await replace(h, "builder", 2, "Write the file, then report it.", hashOf(old));
    assert.equal(r.status, 200);
    const line = "- 2026-11-10: Write the file, then report it.";
    assert.deepEqual(r.json.lesson, { n: 2, date: "2026-11-10", text: "Write the file, then report it.", hash: hashOf(line) });
    assert.deepEqual(sameShape(lessonShape(), r.json.lesson), []);
    assert.equal(read(h, "builder"), SAMPLE.replace(old, line));

    const u = await replace(h, "builder", 3, "Still undated.", hashOf("- An undated lesson."));
    assert.equal(u.status, 200);
    assert.equal(u.json.lesson.date, null);
    assert.equal(read(h, "builder"), SAMPLE.replace(old, line).replace("- An undated lesson.", "- Still undated."));
    noTempFiles(h);
  });
});

test("replace or delete with an old hash answers 409 lesson_changed and changes nothing", async () => {
  await withHome(async (h) => {
    seedSample(h);
    const stale = hashOf("- 2026-11-09: Something it used to say.");
    const r = await replace(h, "builder", 1, "New text.", stale);
    assert.equal(r.status, 409);
    assert.deepEqual(r.json.error, { message: "This lesson changed while you were editing.", next: "Refresh the page and try again.", code: "lesson_changed" });
    const d = await remove(h, "builder", 1, stale);
    assert.equal(d.status, 409);
    assert.equal(d.json.error.code, "lesson_changed");
    const missing = await call(h.url, "DELETE", "/api/team/builder/lessons/1");
    assert.equal(missing.status, 409);
    assert.equal(read(h, "builder"), SAMPLE);
  });
});

test("delete removes only that line", async () => {
  await withHome(async (h) => {
    seedSample(h);
    const line = "- 2026-11-09: Keep each goal's files in a sub-folder.";
    const r = await remove(h, "builder", 1, hashOf(line));
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true });
    assert.equal(read(h, "builder"), SAMPLE.replace(`${line}\n`, ""));
    noTempFiles(h);
  });
});

test("a lesson number out of range answers 404", async () => {
  await withHome(async (h) => {
    seedSample(h);
    const any = hashOf("- An undated lesson.");
    for (const n of ["0", "4", "99", "-1", "1x", "1.0"]) {
      const r = await replace(h, "builder", n, "Text.", any);
      assert.equal(r.status, 404, n);
      const d = await remove(h, "builder", n, any);
      assert.equal(d.status, 404, n);
    }
    rmSync(fileOf(h, "marketer"), { force: true });
    assert.equal((await replace(h, "marketer", 1, "Text.", any)).status, 404);
    assert.ok(!existsSync(fileOf(h, "marketer")));
    assert.equal(read(h, "builder"), SAMPLE);
  });
});

test("an unknown slug or a slug such as ../x answers 404 and no file is written anywhere", async () => {
  await withHome(async (h) => {
    const root = join(h.state, "..");
    const before = snapshot(root);
    for (const slug of ["nobody", "..%2Fx", "%2E%2E%2Fx", "..%2F..%2Fx", "builder%2F..%2Fx", "Builder", "builder.md"]) {
      const a = await add(h, slug, "A lesson.");
      assert.equal(a.status, 404, slug);
      assert.equal(a.json.error.code, "agent_not_found");
      assert.equal((await replace(h, slug, 1, "A lesson.", "00000000")).status, 404, slug);
      assert.equal((await remove(h, slug, 1, "00000000")).status, 404, slug);
    }
    assert.deepEqual(snapshot(root), before);
    assert.ok(!existsSync(join(lessonsDir(h), "..", "x")));
    assert.ok(!existsSync(join(lessonsDir(h), "..", "x.md")));
  });
});

test("a line an agent appends between the read and the write is still there afterwards", async () => {
  await withHome(async (h) => {
    seedSample(h);
    const agentLine = "- 2026-11-11: Added by the agent while the owner was saving.";
    let calls = 0;
    testHooks.beforeRename = (file, attempt) => {
      calls++;
      if (attempt === 0) appendFileSync(file, `${agentLine}\n`);
    };
    const old = "- 2026-11-09: Keep each goal's files in a sub-folder.";
    const r = await replace(h, "builder", 1, "Keep files per goal.", hashOf(old));
    assert.equal(r.status, 200);
    assert.equal(calls, 2);
    assert.equal(read(h, "builder"), `${SAMPLE.replace(old, "- 2026-11-09: Keep files per goal.")}${agentLine}\n`);

    testHooks.beforeRename = (file, attempt) => { if (attempt === 0) appendFileSync(file, "- 2026-11-11: Another.\n"); };
    const a = await add(h, "builder", "From the owner.");
    assert.equal(a.status, 201);
    assert.equal(a.json.lesson.n, 6);
    assert.ok(read(h, "builder").endsWith(`- 2026-11-11: Another.\n- ${today()}: From the owner.\n`));
    noTempFiles(h);
  });
});

test("a line an agent appends between two calls survives the next edit", async () => {
  await withHome(async (h) => {
    seedSample(h);
    const line = "- 2026-11-10: Write the file first, then report it.";
    appendFileSync(fileOf(h, "builder"), "- 2026-11-11: From the agent.\n");
    const d = await remove(h, "builder", 2, hashOf(line));
    assert.equal(d.status, 200);
    assert.equal(read(h, "builder"), `${SAMPLE.replace(`${line}\n`, "")}- 2026-11-11: From the agent.\n`);
  });
});

test("when the file keeps changing during the write, the edit is tried once more and then refused with 409", async () => {
  await withHome(async (h) => {
    seedSample(h);
    let calls = 0;
    testHooks.beforeRename = (file) => { calls++; appendFileSync(file, `- 2026-11-11: Agent line ${calls}.\n`); };
    const r = await add(h, "builder", "From the owner.");
    assert.equal(r.status, 409);
    assert.equal(calls, 2);
    assert.ok(r.json.error.message && r.json.error.next && r.json.error.code);
    assert.equal(read(h, "builder"), `${SAMPLE}- 2026-11-11: Agent line 1.\n- 2026-11-11: Agent line 2.\n`);
    noTempFiles(h);
  });
});

test("lines that do not start with a dash and a space survive every edit", async () => {
  await withHome(async (h) => {
    const text = "# Title\r\n\r\n-not a lesson\r\n- 2026-11-01: One.\r\n  - indented\r\n- 2026-11-02: Two.\r\n";
    mkdirSync(lessonsDir(h), { recursive: true });
    writeFileSync(fileOf(h, "marketer"), text);
    assert.equal((await add(h, "marketer", "Three.")).status, 201);
    assert.equal((await replace(h, "marketer", 1, "Uno.", hashOf("- 2026-11-01: One."))).status, 200);
    assert.equal((await remove(h, "marketer", 2, hashOf("- 2026-11-02: Two."))).status, 200);
    assert.equal(read(h, "marketer"), `# Title\r\n\r\n-not a lesson\r\n- 2026-11-01: Uno.\r\n  - indented\r\n- ${today()}: Three.\n`);
  });
});

test("a lessons file that is a link answers 409 and the link's target is unchanged", async () => {
  await withHome(async (h) => {
    const target = join(h.state, "..", "outside.md");
    const content = "- 2026-11-01: Outside.\n";
    writeFileSync(target, content);
    mkdirSync(lessonsDir(h), { recursive: true });
    rmSync(fileOf(h, "builder"), { force: true });
    symlinkSync(target, fileOf(h, "builder"));
    for (const r of [
      await add(h, "builder", "Sneaky."),
      await replace(h, "builder", 1, "Sneaky.", hashOf("- 2026-11-01: Outside.")),
      await remove(h, "builder", 1, hashOf("- 2026-11-01: Outside.")),
    ]) {
      assert.equal(r.status, 409);
      assert.ok(r.json.error.message && r.json.error.next);
      assert.ok(!/ELOOP|symlink|errno/i.test(r.json.error.message));
    }
    assert.equal(readFileSync(target, "utf8"), content);
    assert.ok(lstatSync(fileOf(h, "builder")).isSymbolicLink());
    noTempFiles(h);
  });
});

test("a write without the home screen's header is refused with 403", async () => {
  await withHome(async (h) => {
    seedSample(h);
    const p = await call(h.url, "POST", "/api/team/builder/lessons", { body: { text: "Sneaky." }, headers: { "x-engine": "0" } });
    assert.equal(p.status, 403);
    const q = await call(h.url, "POST", "/api/team/builder/lessons", { body: { text: "Sneaky." }, bare: true, headers: { "content-type": "application/json" } });
    assert.equal(q.status, 403);
    const d = await call(h.url, "DELETE", `/api/team/builder/lessons/1?hash=${hashOf("- 2026-11-09: Keep each goal's files in a sub-folder.")}`, { bare: true });
    assert.equal(d.status, 403);
    assert.equal(read(h, "builder"), SAMPLE);
  });
});

test("no write reaches the board", async () => {
  await withHome(async (h) => {
    seedSample(h);
    await add(h, "builder", "One more.");
    await remove(h, "builder", 1, hashOf("- 2026-11-09: Keep each goal's files in a sub-folder."));
    assert.deepEqual(h.board.requests.filter((r) => r.method !== "GET"), []);
  });
});
