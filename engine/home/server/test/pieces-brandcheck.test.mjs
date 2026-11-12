// PLAN-V5 K6, K9: the home server's own fenced brand check (lib/brandcheck.mjs). The real fence and the real
// tool are never run here: the argument list is asserted, and the runner's handling of a process is tried
// with a stand-in `fence-run` script in a temp engine folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../../lib/config.mjs";
import {
  BRAND_CHECK_AGENT_ID, SAY, brandCheckCommand, brandOfAll, brandOfVariant, defaultRunner, forgetBrandChecks, parseReport,
  runBrandCheck, stampOf, stubBrandCheckRunner,
} from "../lib/brandcheck.mjs";

const REPORT = {
  version: 1, kit: "present",
  pieces: [
    { kind: "slides", name: "launch-a", result: "pass", hard: [], soft: [], measured: { colours: ["#1A3C5E 61%"], words: 12 } },
    { kind: "slides", name: "launch-b", result: "fail", hard: [{ code: "off_palette", where: "slide-02.png", detail: "12% of the picture is in colours outside the kit" }], soft: [], measured: { colours: [], words: 0 } },
    { kind: "slides", name: "launch-c", result: "warn", hard: [], soft: [{ code: "filler_phrase", where: "slides.json", detail: "the phrase \"game-changer\" sounds machine-made" }], measured: { colours: [], words: 0 } },
  ],
  variants: { result: "pass", hard: [], present: true },
};
const v = (id) => ({ id, report: "slides", reportName: `launch-${id}` });
const done = (report) => ({ state: "done", report: parseReport(report) });

test("command: the argument list for STH-12 is exactly K9's, from the config and the identifier only", () => {
  const config = { engineDir: "/e", paths: { state: "/s", claudeHome: "/s/claude-home", projectFolder: "/s/tasks/company-work" } };
  const cmd = brandCheckCommand(config, "STH-12");
  assert.equal(cmd.file, "/e/fence/fence-run");
  assert.deepEqual(cmd.args, [
    "--tool", "claude", "--agent-home", `/s/claude-home/${BRAND_CHECK_AGENT_ID}`,
    "-c", "'/s/art/venv/bin/python' -I '/s/art/tools/brandcheck.py' --json STH-12",
  ]);
  assert.equal(cmd.options.cwd, "/s/tasks/company-work");
  assert.deepEqual(cmd.options.env, { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: `/s/claude-home/${BRAND_CHECK_AGENT_ID}`, LANG: "en_US.UTF-8", PAPERCLIP_AGENT_ID: BRAND_CHECK_AGENT_ID });
  assert.equal(BRAND_CHECK_AGENT_ID, "00000000-0000-4000-8000-0000000000b1");

  // The real config: the same form with this engine's own paths.
  const real = loadConfig();
  const r = brandCheckCommand(real, "STH-12");
  assert.equal(r.file, join(real.engineDir, "fence", "fence-run"));
  assert.deepEqual(r.args, ["--tool", "claude", "--agent-home", join(real.paths.claudeHome, BRAND_CHECK_AGENT_ID), "-c",
    `'${join(real.paths.state, "art", "venv", "bin", "python")}' -I '${join(real.paths.state, "art", "tools", "brandcheck.py")}' --json STH-12`]);
  assert.equal(r.options.cwd, real.paths.projectFolder);

  // Nothing else ever reaches the shell line.
  for (const bad of ["sth-12", "STH-12; rm -rf ~", "STH-12 --state /tmp", "../STH-12", "STH-", "S-1234567890", "ABCDEFGHIJK-1", "STH-12\n", "", null, 12]) {
    assert.equal(brandCheckCommand(config, bad), null, String(bad));
  }
  assert.equal(brandCheckCommand({ ...config, paths: { ...config.paths, state: "/s'; touch /tmp/x; '" } }, "STH-12"), null);
});

test("report: K6's shape is read, every string cleaned and capped; anything else is no report", () => {
  const r = parseReport(REPORT);
  assert.equal(r.kit, "present");
  assert.deepEqual(r.pieces.map((p) => [p.name, p.result]), [["launch-a", "pass"], ["launch-b", "fail"], ["launch-c", "warn"]]);
  assert.deepEqual(parseReport(await_stub()), { kit: "missing", pieces: [], variants: { result: "pass", hard: [], present: false } });
  const dirty = parseReport({ ...REPORT, pieces: [{ ...REPORT.pieces[1], hard: [{ code: "off_palette", where: "x‮.png", detail: `<script>alert(1)</script>\u0000${"z".repeat(5000)}` }] }] });
  const d = dirty.pieces[0].hard[0];
  assert.ok(Array.from(d.detail).length <= 300);
  assert.ok(!/[\u0000‮]/.test(d.detail + d.where));
  assert.ok(d.detail.startsWith("<script>"), "kept as text: the page shows it as text");
  const garbage = [
    null, "x", [], 42, {}, { kit: "present" }, { kit: "yes", pieces: [] }, { ...REPORT, version: 2 },
    { ...REPORT, pieces: [{ ...REPORT.pieces[0], result: "great" }] },
    { ...REPORT, pieces: [{ ...REPORT.pieces[0], kind: "../etc" }] },
    { ...REPORT, pieces: [{ ...REPORT.pieces[0], name: "../../x" }] },
    { ...REPORT, pieces: [{ ...REPORT.pieces[0], hard: [{ code: "Bad Code", where: "", detail: "" }] }] },
    { ...REPORT, pieces: [{ ...REPORT.pieces[0], hard: Array(51).fill({ code: "x", where: "", detail: "" }) }] },
    { ...REPORT, pieces: Array(41).fill(REPORT.pieces[0]) },
    { ...REPORT, variants: { result: "maybe", hard: [] } },
  ];
  for (const g of garbage) assert.equal(parseReport(g), null, JSON.stringify(g)?.slice(0, 80));
});

function await_stub() {
  // The stub homes' runner answers this at once.
  return { kit: "missing", pieces: [] };
}

test("results: a version's brand comes from its own piece; could_not_check is unknown, never a pass", () => {
  const run = done(REPORT);
  assert.deepEqual(brandOfVariant(run, v("a")), { result: "pass", lines: [] });
  assert.deepEqual(brandOfVariant(run, v("b")), { result: "fail", lines: ["slide-02.png: 12% of the picture is in colours outside the kit"] });
  assert.equal(brandOfVariant(run, v("c")).result, "warn");
  assert.deepEqual(brandOfVariant(run, { id: "d", report: "slides", reportName: "launch-d" }), { result: "unknown", lines: [SAY.notFound] });

  const cannot = done({ ...REPORT, pieces: [{ ...REPORT.pieces[0], result: "fail", hard: [{ code: "could_not_check", where: "launch-a", detail: "a file of this piece could not be read" }] }] });
  assert.equal(brandOfVariant(cannot, v("a")).result, "unknown");
  assert.equal(brandOfVariant(cannot, v("a")).lines[0], SAY.couldNot);

  // Variants-level lines go to the versions they name, or to all.
  const alike = done({ ...REPORT, variants: { result: "fail", present: true, hard: [{ code: "variants_alike", where: "variants.json", detail: "variants a and c have first pictures that differ by 3.0 of 255 on average: near copies" }] } });
  assert.equal(brandOfVariant(alike, v("a")).result, "fail");
  assert.equal(brandOfVariant(alike, v("b")).result, "fail", "b fails on its own piece");
  assert.equal(brandOfVariant(alike, v("c")).result, "fail", "c is named: its warning becomes a fail");
  const alikeAB = done({ ...REPORT, pieces: [REPORT.pieces[0], { ...REPORT.pieces[0], name: "launch-b" }, { ...REPORT.pieces[0], name: "launch-c" }], variants: { result: "fail", present: true, hard: [{ code: "direction_repeated", where: "variants.json", detail: "variant b repeats the direction type-led" }] } });
  assert.deepEqual(["a", "b", "c"].map((id) => brandOfVariant(alikeAB, v(id)).result), ["pass", "fail", "pass"]);

  // The versions were not compared: not a pass.
  const notCompared = done({ ...REPORT, variants: { result: "pass", hard: [], present: false } });
  assert.equal(brandOfVariant(notCompared, v("a")).result, "unknown");
  assert.ok(brandOfVariant(notCompared, v("a")).lines.includes(SAY.notCompared));

  // No kit: a pass is only a warning; a kit that cannot be read: not checked.
  assert.equal(brandOfVariant(done({ ...REPORT, kit: "missing" }), v("a")).result, "warn");
  assert.equal(brandOfVariant(done({ ...REPORT, kit: "unreadable" }), v("a")).result, "unknown");
  assert.equal(brandOfVariant(done({ ...REPORT, kit: "unreadable" }), v("b")).result, "fail");

  // Not run, still running.
  assert.deepEqual(brandOfVariant({ state: "unknown" }, v("a")), { result: "unknown", lines: [SAY.notRun] });
  assert.deepEqual(brandOfVariant({ state: "running" }, v("a")), { result: "unknown", lines: [SAY.running] });
  assert.deepEqual(brandOfVariant(null, v("a")).result, "unknown");

  // A single piece: the worst of all.
  assert.equal(brandOfAll(run).result, "fail");
  assert.equal(brandOfAll(done({ ...REPORT, pieces: [REPORT.pieces[0]] })).result, "pass");
  assert.equal(brandOfAll(done(await_stub())).result, "unknown");
});

// A temp engine and state whose fence-run is a stand-in script, so the runner's process handling is tried
// without the real fence.
function fakeEngine(script) {
  const root = mkdtempSync(join(tmpdir(), "uuu-brand-run-"));
  const engineDir = join(root, "engine");
  const state = join(root, "state");
  mkdirSync(join(engineDir, "fence"), { recursive: true });
  mkdirSync(join(state, "art", "venv", "bin"), { recursive: true });
  mkdirSync(join(state, "art", "tools"), { recursive: true });
  mkdirSync(join(state, "tasks", "company-work", "STH-12"), { recursive: true });
  writeFileSync(join(state, "art", "venv", "bin", "python"), "");
  writeFileSync(join(state, "art", "tools", "brandcheck.py"), "");
  const fence = join(engineDir, "fence", "fence-run");
  writeFileSync(fence, `#!/bin/bash\n${script}\n`);
  chmodSync(fence, 0o755);
  const config = { engineDir, paths: { state, claudeHome: join(state, "claude-home"), projectFolder: join(state, "tasks", "company-work"), knowledgeDocs: join(state, "knowledge", "docs") } };
  return { root, config, state, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("runner: started with execFile from the project folder, a clean environment, the exact arguments; exit 1 still answers", async () => {
  const f = fakeEngine(`printf '%s\\n' "$@" > "$PWD/../../args.txt"; env > "$PWD/../../env.txt"; pwd -P > "$PWD/../../cwd.txt"; echo '${JSON.stringify(REPORT)}'; exit 1`);
  try {
    process.env.UUU_SHOULD_NOT_LEAK = "leak";
    const out = await defaultRunner("STH-12", { config: f.config });
    delete process.env.UUU_SHOULD_NOT_LEAK;
    assert.deepEqual(parseReport(JSON.parse(out)).pieces.length, 3);
    const args = readFileSync(join(f.state, "args.txt"), "utf8").trimEnd().split("\n");
    assert.deepEqual(args, brandCheckCommand(f.config, "STH-12").args);
    assert.ok(readFileSync(join(f.state, "cwd.txt"), "utf8").trim().endsWith("/tasks/company-work"));
    const env = readFileSync(join(f.state, "env.txt"), "utf8");
    assert.match(env, new RegExp(`^PAPERCLIP_AGENT_ID=${BRAND_CHECK_AGENT_ID}$`, "m"));
    assert.ok(!env.includes("UUU_SHOULD_NOT_LEAK"), "the home server's own environment is not passed on");
  } finally { f.close(); }
});

test("runner: a refusal, more than 512 KB, or a run past its time is no answer, and the time-out ends the whole group", async () => {
  const refused = fakeEngine("echo 'fence: refused' >&2; exit 78");
  try { assert.equal(await defaultRunner("STH-12", { config: refused.config }), null); } finally { refused.close(); }

  const big = fakeEngine("head -c 700000 /dev/zero | tr '\\0' 'x'; exit 0");
  try { assert.equal(await defaultRunner("STH-12", { config: big.config }), null); } finally { big.close(); }

  const slow = fakeEngine(`(sleep 30; touch "$PWD/../../late.txt") & echo $! > "$PWD/../../child.pid"; sleep 30`);
  try {
    const t = Date.now();
    assert.equal(await defaultRunner("STH-12", { config: slow.config, timeoutMs: 400 }), null);
    assert.ok(Date.now() - t < 3000);
    const pid = Number(readFileSync(join(slow.state, "child.pid"), "utf8"));
    await new Promise((r) => setTimeout(r, 300));
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    assert.equal(alive, false, "the grandchild was ended with its group");
  } finally { slow.close(); }
});

test("runner: nothing is started when the fence, the tool or its Python is missing; there is no other way to run it", async () => {
  const f = fakeEngine(`touch "$PWD/../../ran.txt"; echo '{}'`);
  try {
    rmSync(join(f.state, "art", "tools", "brandcheck.py"));
    assert.equal(await defaultRunner("STH-12", { config: f.config }), null);
    assert.equal(existsSync(join(f.state, "ran.txt")), false);
    writeFileSync(join(f.state, "art", "tools", "brandcheck.py"), "");
    rmSync(join(f.config.engineDir, "fence", "fence-run"));
    assert.equal(await defaultRunner("STH-12", { config: f.config }), null);
    assert.equal(await defaultRunner("bad id", { config: f.config }), null);
    assert.equal(existsSync(join(f.state, "ran.txt")), false);
  } finally { f.close(); }
  assert.deepEqual(await stubBrandCheckRunner("STH-12"), { kit: "missing", pieces: [] });
});

test("runs: garbage, 1 MB or a runner that never answers is unknown within the wait; an unchanged goal is checked once", async () => {
  const f = fakeEngine("exit 0");
  try {
    forgetBrandChecks();
    const ctx = (runner, extra = {}) => ({ config: f.config, home: { brandCheckRunner: runner, ...extra } });
    assert.deepEqual(await runBrandCheck(ctx(async () => "not json at all"), "STH-12"), { state: "unknown" });
    forgetBrandChecks();
    assert.deepEqual(await runBrandCheck(ctx(async () => "x".repeat(1024 * 1024)), "STH-12"), { state: "unknown" });
    forgetBrandChecks();
    assert.deepEqual(await runBrandCheck(ctx(async () => { throw new Error("boom"); }), "STH-12"), { state: "unknown" });
    forgetBrandChecks();
    assert.deepEqual(await runBrandCheck(ctx(() => { throw new Error("sync boom"); }), "STH-12"), { state: "unknown" });
    forgetBrandChecks();
    const t = Date.now();
    assert.deepEqual(await runBrandCheck(ctx(() => new Promise(() => {}), { brandCheckWaitMs: 200 }), "STH-12"), { state: "running" });
    assert.ok(Date.now() - t < 1500);
    forgetBrandChecks();

    let calls = 0;
    const counting = async () => { calls += 1; return JSON.stringify(REPORT); };
    const a = await runBrandCheck(ctx(counting), "STH-12");
    assert.equal(a.state, "done");
    await runBrandCheck(ctx(counting), "STH-12");
    assert.equal(calls, 1, "unchanged: the kept result");
    const before = stampOf(f.config, "STH-12").key;
    mkdirSync(join(f.state, "tasks", "company-work", "STH-12", "slides", "launch-a"), { recursive: true });
    writeFileSync(join(f.state, "tasks", "company-work", "STH-12", "slides", "launch-a", "slide-01.png"), "x");
    assert.notEqual(stampOf(f.config, "STH-12").key, before);
    await runBrandCheck(ctx(counting), "STH-12");
    assert.equal(calls, 2, "a changed piece is checked again");
    assert.deepEqual(await runBrandCheck(ctx(counting), "sth-12"), { state: "unknown" });
    assert.equal(calls, 2);
  } finally { forgetBrandChecks(); f.close(); }
});

test("stamp: thousands of junk files give a stable key marked incomplete; the versions' folders are walked first", () => {
  const f = fakeEngine("exit 0");
  try {
    const goal = join(f.state, "tasks", "company-work", "STH-12");
    mkdirSync(join(goal, "content"), { recursive: true });
    for (let i = 0; i < 3100; i += 1) writeFileSync(join(goal, "content", `junk-${i}.md`), "x");
    mkdirSync(join(goal, "slides", "launch-b"), { recursive: true });
    writeFileSync(join(goal, "slides", "launch-b", "slide-01.png"), "x");
    const versions = ["slides/launch-b"];
    const one = stampOf(f.config, "STH-12", { versions });
    const two = stampOf(f.config, "STH-12", { versions });
    assert.equal(one.complete, false);
    assert.equal(one.key, two.key, "the same files give the same key, so a card's version does not change between lists");
    writeFileSync(join(goal, "slides", "launch-b", "slide-01.png"), "changed in place");
    const three = stampOf(f.config, "STH-12", { versions });
    assert.notEqual(three.key, one.key, "a change in a version's folder is seen even past the cap");
    assert.ok(three.newest >= one.newest);
    const small = fakeEngine("exit 0");
    try { assert.equal(stampOf(small.config, "STH-12").complete, true); } finally { small.close(); }
  } finally { f.close(); }
});

test("results: a goal-level piece parses; no_pieces and too_many_pieces fail with their own sentences; a fail never turns unknown", () => {
  const goalPiece = (hard) => ({ kind: "goal", name: "STH-12", result: "fail", hard, soft: [], measured: { colours: [], words: 0 } });
  const NO = { code: "no_pieces", where: "STH-12", detail: "the goal holds no piece to check" };
  const CANNOT = { code: "could_not_check", where: "STH-12", detail: "it took longer than 120 seconds" };
  const TOO_MANY = { code: "too_many_pieces", where: "launch-c", detail: "only the first 40 pieces of a goal are checked; this one was not" };
  const noPieces = { ...REPORT, pieces: [goalPiece([NO])] };
  assert.ok(parseReport(noPieces), "a report with a goal piece parses");
  assert.equal(parseReport({ ...REPORT, pieces: [{ ...goalPiece([NO]), name: "../x" }] }), null, "the same name rule");
  for (const id of ["a", "b", "c"]) assert.deepEqual(brandOfVariant(done(noPieces), v(id)), { result: "fail", lines: [SAY.noPieces] });
  assert.deepEqual(brandOfAll(done(noPieces)), { result: "fail", lines: [SAY.noPieces] });

  // A goal-level fail beside the pieces fails every version, a pass included.
  const withGoalFail = { ...REPORT, pieces: [...REPORT.pieces, goalPiece([NO])] };
  assert.deepEqual(["a", "b", "c"].map((id) => brandOfVariant(done(withGoalFail), v(id)).result), ["fail", "fail", "fail"]);
  assert.equal(brandOfVariant(done(withGoalFail), v("a")).lines[0], SAY.noPieces);

  // Only could_not_check at goal level: every version unknown, but a version that failed stays failed.
  const goalCannot = { ...REPORT, pieces: [...REPORT.pieces, { ...goalPiece([CANNOT]) }] };
  assert.deepEqual(["a", "b", "c"].map((id) => brandOfVariant(done(goalCannot), v(id)).result), ["unknown", "fail", "unknown"]);

  // too_many_pieces on a version's own piece is a fail for that version, with its sentence, even if the piece says pass.
  const tooMany = { ...REPORT, pieces: [REPORT.pieces[0], REPORT.pieces[1], { ...REPORT.pieces[2], result: "pass", hard: [TOO_MANY], soft: [] }] };
  assert.deepEqual(brandOfVariant(done(tooMany), v("c")), { result: "fail", lines: [SAY.tooManyPieces] });
  assert.equal(brandOfVariant(done(tooMany), v("a")).result, "pass");
  // A fail mixed with could_not_check stays a fail.
  const mixed = { ...REPORT, pieces: [{ ...REPORT.pieces[1], hard: [CANNOT, REPORT.pieces[1].hard[0]] }] };
  assert.equal(brandOfVariant(done(mixed), v("b")).result, "fail");
  assert.equal(brandOfAll(done(tooMany)).result, "fail");
});

test("report: 40 pieces plus one goal piece with too_many_pieces parses and fails every version with its sentence; 41 without it does not", () => {
  const piece = (i) => ({ kind: "slides", name: i < 3 ? `launch-${"abc"[i]}` : `extra-${i}`, result: "pass", hard: [], soft: [], measured: { colours: [], words: 0 } });
  const forty = Array.from({ length: 40 }, (_, i) => piece(i));
  const goal = { kind: "goal", name: "STH-12", result: "fail", hard: [{ code: "too_many_pieces", where: "STH-12", detail: "the goal holds more than 40 pieces; only the first 40 were checked" }], soft: [], measured: { colours: [], words: 0 } };
  const report = { ...REPORT, pieces: [...forty, goal] };
  assert.ok(parseReport(report), "the agreed shape parses");
  for (const id of ["a", "b", "c"]) assert.deepEqual(brandOfVariant(done(report), v(id)), { result: "fail", lines: [SAY.tooManyPieces] });
  assert.equal(parseReport({ ...REPORT, pieces: [...forty, piece(40)] }), null, "41 ordinary pieces: no report");
  assert.equal(parseReport({ ...REPORT, pieces: [...forty, { ...goal, hard: [] }] }), null, "the 41st must be the goal-level too_many_pieces");
  assert.equal(parseReport({ ...REPORT, pieces: [...forty, goal, goal] }), null);
});

test("stamp: a folder deeper than eight levels marks the stamp incomplete", () => {
  const f = fakeEngine("exit 0");
  try {
    const deep = join(f.state, "tasks", "company-work", "STH-12", "site", "x", "1", "2", "3", "4", "5", "6", "7", "8");
    mkdirSync(deep, { recursive: true });
    assert.equal(stampOf(f.config, "STH-12").complete, false);
  } finally { f.close(); }
});
