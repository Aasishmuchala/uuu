// The home server's own brand check (PLAN-V5 K6, K9): what the owner sees about a piece's brand comes
// from the engine's own tool, run by the home server itself, never from a report an agent wrote.
// The pieces are hostile files (docs/adr/0007), so the tool runs INSIDE the fence, as the check's own
// identity (a policy apply.mjs writes: read folders knowledge and art, the task folder read-only, no
// services): engine/fence/fence-run started directly (never through a shell of ours), its arguments made only
// from the config and an identifier that matches ^[A-Z][A-Z0-9]{0,9}-\d{1,9}$, from the project folder,
// with a clean environment, 60 seconds and 512 KB of output, its whole process group ended on time-out.
// If the fenced run cannot start, or says nothing usable, the answer is "unknown": there is never an
// unfenced run. The answer is parsed against K6's shape; every string is capped and cleaned, and shown
// to the owner as plain text. Results are kept by a hash of the pieces' names, sizes and times (and the
// kit's and the can't-say list's), so an unchanged goal is not checked twice.
// `ctx.home.brandCheckRunner(identifier, { config, timeoutMs, maxBytes })` replaces the default runner
// (the stub homes set one that never starts a process); it may answer the report as text or as an object.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, opendirSync } from "node:fs";
import { join } from "node:path";
import { goalFolder } from "./taskfiles.mjs";

export const BRAND_CHECK_AGENT_ID = "00000000-0000-4000-8000-0000000000b1";
export const IDENTIFIER = /^[A-Z][A-Z0-9]{0,9}-\d{1,9}$/;
export const RUN_MS = 60000;
export const MAX_OUTPUT = 512 * 1024;
export const WAIT_MS = 8000;           // how long the pieces route waits for a run before it answers
const KEEP_MS = 10 * 60 * 1000;        // a usable result is kept this long (and while nothing changes)
const KEEP_UNKNOWN_MS = 30 * 1000;     // an unusable one only this long, so a slow run is not started again at once
const MAX_KEPT = 100;
const KILL_AFTER_MS = 2000;
const CLEAN_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

// K6's report, as read here.
const KITS = new Set(["present", "missing", "unreadable"]);
const RESULTS = new Set(["pass", "warn", "fail"]);
// "goal": the tool's line about the goal as a whole (no_pieces, or a could_not_check), named after the goal.
const PIECE_KINDS = new Set(["content", "draft", "slides", "video", "film", "site", "goal"]);
const CODE = /^[a-z][a-z_]{0,39}$/;
const PIECE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}$/;
const MAX_PIECES = 40;
const MAX_ENTRIES = 50;                // hard or soft entries of one piece read
const MAX_DETAIL = 300;
const MAX_WHERE = 100;
const MAX_LINES = 10;                  // lines shown for one version

// Folders of a goal that hold pieces (brandcheck.py FOLDERS), walked for the hash.
const PIECE_FOLDERS = ["content", "drafts", "slides", "video", "film", "site"];
const STAMP_ENTRIES = 3000;
const STAMP_DEPTH = 3;

export const SAY = {
  notRun: "The brand check could not be run, so this version is not marked as checked.",
  running: "The brand check is still running. Look again in a minute.",
  notFound: "The brand check found no files for this version.",
  kitMissing: "There is no brand kit yet, so colours, the logo and type were not checked.",
  kitUnreadable: "The brand kit could not be read, so colours, the logo and type were not checked.",
  notCompared: "Whether the versions differ from each other was not checked.",
  couldNot: "Part of this version could not be checked.",
  noPieces: "No pieces were found to check.",
  tooManyPieces: "There were more than 40 pieces; the rest were not checked.",
};

// A string from the tool's answer as the owner reads it: one line, no control or format characters, capped.
export function plainText(v, max) {
  if (typeof v !== "string") return "";
  const t = v.slice(0, max * 4).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(t);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : t;
}

const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

function entries(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > MAX_ENTRIES) return null;
  const out = [];
  for (const e of list) {
    if (!isObject(e) || typeof e.code !== "string" || !CODE.test(e.code)) return null;
    if (typeof e.detail !== "string" || (e.where !== undefined && typeof e.where !== "string")) return null;
    out.push({ code: e.code, where: plainText(e.where ?? "", MAX_WHERE), detail: plainText(e.detail, MAX_DETAIL) });
  }
  return out;
}

// parseReport(value) -> { kit, pieces: [{ kind, name, result, hard, soft }], variants: { result, hard, present } }
// or null when the value does not have K6's shape. Never throws.
export function parseReport(value) {
  try {
    const r = value;
    if (!isObject(r) || (r.version !== undefined && r.version !== 1)) return null;
    if (!KITS.has(r.kit) || !Array.isArray(r.pieces) || r.pieces.length > MAX_PIECES) return null;
    const pieces = [];
    for (const p of r.pieces) {
      if (!isObject(p) || !PIECE_KINDS.has(p.kind) || typeof p.name !== "string" || !PIECE_NAME.test(p.name)) return null;
      if (!RESULTS.has(p.result)) return null;
      const hard = entries(p.hard);
      const soft = entries(p.soft);
      if (!hard || !soft) return null;
      pieces.push({ kind: p.kind, name: p.name, result: p.result, hard, soft });
    }
    let variants = { result: "pass", hard: [], present: false };
    if (r.variants !== undefined) {
      const v = r.variants;
      if (!isObject(v) || !RESULTS.has(v.result)) return null;
      const hard = entries(v.hard);
      if (!hard) return null;
      variants = { result: v.result, hard, present: v.present === true };
    }
    return { kit: r.kit, pieces, variants };
  } catch {
    return null;
  }
}

// ---- the default runner

// A path inside single quotes for the fenced shell, or null when it holds anything but plain characters.
const quoted = (p) => (typeof p === "string" && /^\/[A-Za-z0-9_./ -]+$/.test(p) ? `'${p}'` : null);

// brandCheckCommand(config, identifier) -> { file, args, options: { cwd, env } } or null. Only the config and
// the checked identifier go into it.
export function brandCheckCommand(config, identifier) {
  if (typeof identifier !== "string" || !IDENTIFIER.test(identifier)) return null;
  const state = config?.paths?.state;
  if (typeof state !== "string" || !state || typeof config.engineDir !== "string") return null;
  const agentHome = join(config.paths.claudeHome || join(state, "claude-home"), BRAND_CHECK_AGENT_ID);
  const python = quoted(join(state, "art", "venv", "bin", "python"));
  const tool = quoted(join(state, "art", "tools", "brandcheck.py"));
  if (!python || !tool) return null;
  return {
    file: join(config.engineDir, "fence", "fence-run"),
    args: ["--tool", "claude", "--agent-home", agentHome, "-c", `${python} -I ${tool} --json ${identifier}`],
    options: {
      cwd: config.paths.projectFolder,
      env: { PATH: CLEAN_PATH, HOME: agentHome, LANG: "en_US.UTF-8", PAPERCLIP_AGENT_ID: BRAND_CHECK_AGENT_ID },
    },
  };
}

function killGroup(child, signal) {
  try { if (child.pid) process.kill(-child.pid, signal); } catch { /* already gone */ }
}

// The default runner: the fenced tool's stdout as text, or null. It starts nothing unless the fence, the
// tool and its Python are all there; it never runs the tool any other way. The fence is started directly
// (spawn with no shell: execFile's own form, which cannot start a process group of its own), in a new
// process group, stdin closed, stderr dropped, stdout kept up to maxBytes; past maxBytes or past its time
// the whole group is ended (TERM, then KILL 2 seconds later) and the answer is null.
export function defaultRunner(identifier, { config, timeoutMs = RUN_MS, maxBytes = MAX_OUTPUT } = {}) {
  const cmd = brandCheckCommand(config, identifier);
  if (!cmd) return Promise.resolve(null);
  const state = config.paths.state;
  const needed = [cmd.file, join(state, "art", "venv", "bin", "python"), join(state, "art", "tools", "brandcheck.py")];
  if (!needed.every((p) => existsSync(p))) return Promise.resolve(null);
  const cwd = lstatSafe(cmd.options.cwd);
  if (!cwd || !cwd.isDirectory()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    let child = null;
    let timer = null;
    let size = 0;
    const chunks = [];
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const end = () => {
      killGroup(child, "SIGTERM");
      setTimeout(() => killGroup(child, "SIGKILL"), KILL_AFTER_MS).unref?.();
      finish(null);
    };
    try {
      child = spawn(cmd.file, cmd.args, {
        cwd: cmd.options.cwd, env: cmd.options.env, shell: false, detached: true,
        stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
      });
    } catch {
      return finish(null);
    }
    child.on("error", () => finish(null));
    child.stdout.on("data", (c) => {
      if (done) return;
      size += c.length;
      if (size > maxBytes) return end();
      chunks.push(c);
    });
    child.on("close", (code, signal) => {
      // Exit 0 (pass or warnings), 1 (a hard rule failed) and 2 (could not check, perhaps with a report).
      if (signal || ![0, 1, 2].includes(code)) return finish(null);
      finish(Buffer.concat(chunks).toString("utf8"));
    });
    timer = setTimeout(end, timeoutMs);
  });
}

function lstatSafe(p) {
  try { return lstatSync(p); } catch { return null; }
}

// ---- the hash of what would be checked

// stampOf(config, identifier, { versions }) -> { key, newest, complete }. The key hashes the pieces' names,
// sizes and times, and the kit's and the can't-say list's; `newest` is the latest change time of
// variants.json or anything walked in the goal's piece folders (ctime as well as mtime: an agent can set a
// file's mtime back, not its ctime). `versions` are the places of variants.json's versions (made by
// lib/variants.mjs); they are walked FIRST, each within its own cap, because they are what the owner picks.
// When any cap is reached (entries or depth), `complete` is false: the key is still stable for the same
// files (never a clock), but nothing may be trusted to be newer than every file.
const VERSION_PLACE = /^(drafts|slides|video|film|site)\/[a-z0-9][a-z0-9-]{0,35}-[abc](\.md)?$/;
const VERSION_ENTRIES = 500;
export function stampOf(config, identifier, { versions = [] } = {}) {
  const h = createHash("sha256").update(String(identifier));
  let newest = 0;
  let complete = true;
  const note = (name, st, counts = true) => {
    if (!st) { h.update(`${name}|-\n`); return; }
    if (counts) newest = Math.max(newest, st.ctimeMs || 0, st.mtimeMs || 0);
    h.update(`${name}|${st.isDirectory() ? "d" : st.isFile() ? "f" : "o"}|${st.size}|${st.mtimeMs}|${st.ctimeMs}|${st.ino}\n`);
  };
  const docs = config?.paths?.knowledgeDocs;
  if (typeof docs === "string") {
    note("kit", lstatSafe(join(docs, "brand", "kit.json")), false);
    note("cant-say", lstatSafe(join(docs, "brand", "cant-say.md")), false);
  }
  const base = goalFolder(config, identifier);
  if (!base) return { key: h.update("no-goal").digest("hex"), newest, complete };
  note("variants.json", lstatSafe(join(base, "variants.json")));
  // One walk with its own budget of entries; a folder past the depth or entries past the budget make the
  // stamp incomplete. Entries are sorted before they are hashed.
  const walker = (budget) => {
    let seen = 0;
    const walk = (dir, rel, depth) => {
      let d;
      try { d = opendirSync(dir); } catch { return; }
      try {
        const names = [];
        let e;
        while ((e = d.readSync()) !== null) {
          if (seen >= budget) { complete = false; break; }
          seen += 1;
          names.push(e.name);
        }
        names.sort();
        for (const n of names) {
          const full = join(dir, n);
          const st = lstatSafe(full);
          note(`${rel}/${n}`, st);
          if (st && st.isDirectory()) {
            if (depth < STAMP_DEPTH) walk(full, `${rel}/${n}`, depth + 1);
            else complete = false;
          }
        }
      } finally {
        try { d.closeSync(); } catch { /* closed */ }
      }
    };
    return walk;
  };
  const places = [...new Set((Array.isArray(versions) ? versions : []).filter((r) => typeof r === "string" && VERSION_PLACE.test(r)))].sort();
  for (const rel of places) {
    const st = lstatSafe(join(base, rel));
    note(`version:${rel}`, st);
    if (st && st.isDirectory()) walker(VERSION_ENTRIES)(join(base, rel), `version:${rel}`, 1);
  }
  const walkAll = walker(STAMP_ENTRIES);
  for (const f of PIECE_FOLDERS) {
    const st = lstatSafe(join(base, f));
    note(f, st);
    if (st && st.isDirectory()) walkAll(join(base, f), f, 1);
  }
  if (!complete) h.update("incomplete");
  return { key: h.digest("hex"), newest, complete };
}

// ---- runs, kept

const kept = new Map();      // key -> { at, ttl, value }
const running = new Map();   // key -> Promise

export function forgetBrandChecks() {
  kept.clear();
  running.clear();
}

function keep(key, value) {
  kept.delete(key);
  kept.set(key, { at: Date.now(), ttl: value ? KEEP_MS : KEEP_UNKNOWN_MS, value });
  while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value);
}

async function runOnce(ctx, identifier) {
  const runner = typeof ctx?.home?.brandCheckRunner === "function" ? ctx.home.brandCheckRunner : defaultRunner;
  let timer = null;
  try {
    const out = await Promise.race([
      Promise.resolve().then(() => runner(identifier, { config: ctx.config, timeoutMs: RUN_MS, maxBytes: MAX_OUTPUT })),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), RUN_MS); timer.unref?.(); }),
    ]);
    if (typeof out === "string") {
      if (out.length > MAX_OUTPUT) return null;
      let parsed;
      try { parsed = JSON.parse(out); } catch { return null; }
      return parseReport(parsed);
    }
    return parseReport(out);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// runBrandCheck(ctx, identifier, { waitMs, versions }) -> { state: "done", report } | { state: "unknown" } |
// { state: "running" } (still running when the wait ran out; the run goes on and its result is kept). When the
// stamp is incomplete the result is never kept: only a run already going is shared.
export async function runBrandCheck(ctx, identifier, { waitMs, versions } = {}) {
  try {
    if (typeof identifier !== "string" || !IDENTIFIER.test(identifier)) return { state: "unknown" };
    const { key, complete } = stampOf(ctx.config, identifier, { versions });
    const hit = complete ? kept.get(key) : null;
    if (hit && Date.now() - hit.at < hit.ttl) return hit.value ? { state: "done", report: hit.value } : { state: "unknown" };
    let p = running.get(key);
    if (!p) {
      p = runOnce(ctx, identifier).then((report) => { if (complete) keep(key, report); running.delete(key); return report; });
      running.set(key, p);
    }
    const wait = Number.isFinite(waitMs) ? waitMs : Number.isFinite(ctx?.home?.brandCheckWaitMs) ? ctx.home.brandCheckWaitMs : WAIT_MS;
    let timer = null;
    const out = await Promise.race([
      p.then((report) => ({ report })),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), Math.max(0, wait)); timer.unref?.(); }),
    ]);
    clearTimeout(timer);
    if (!out) return { state: "running" };
    return out.report ? { state: "done", report: out.report } : { state: "unknown" };
  } catch {
    return { state: "unknown" };
  }
}

// ---- what one version shows

// Codes shown in the home server's own words rather than the tool's.
const OWN_WORDS = { no_pieces: SAY.noPieces, too_many_pieces: SAY.tooManyPieces };
const lineOf = (e) => OWN_WORDS[e.code] || (e.where ? `${e.where}: ${e.detail}` : e.detail);
const unknown = (line) => ({ result: "unknown", lines: [line] });

// The ids a variants-level line is about ("variant a ...", "variants a and b ..."), from the tool's fixed
// words; [] when it names none (then it is about every version).
function idsNamed(detail) {
  const m = /^variants? ([abc])(?: and ([abc]))?\b/.exec(detail);
  return m ? [m[1], m[2]].filter(Boolean) : [];
}

function finishLines(result, lines) {
  return { result, lines: lines.filter(Boolean).slice(0, MAX_LINES) };
}

// One piece's result. Any hard entry other than could_not_check is a fail, whatever the piece's own result
// says; a piece whose only hard entries are could_not_check is "unknown", never "pass".
function pieceResult(piece) {
  if (piece.hard.some((e) => e.code !== "could_not_check")) return "fail";
  if (piece.hard.length) return "unknown";
  return piece.result === "fail" ? "fail" : piece.result;
}

// The goal-level lines (pieces of kind "goal"): { result: "fail"|"unknown"|null, lines }. They apply to every
// version: a fail there fails them all; only could_not_check makes them all unknown.
function goalLevel(report) {
  const goal = report.pieces.filter((p) => p.kind === "goal");
  const results = goal.map(pieceResult);
  const result = results.includes("fail") ? "fail" : results.includes("unknown") ? "unknown" : null;
  return { result, lines: goal.flatMap((p) => p.hard.map(lineOf)) };
}

// After the kit's state: no kit means colours were not checked (a pass becomes a warning); a kit that could
// not be read means the piece was not really checked.
function withKit(report, result, lines) {
  if (report.kit === "missing") {
    lines.push(SAY.kitMissing);
    return result === "pass" ? "warn" : result;
  }
  if (report.kit === "unreadable") {
    lines.push(SAY.kitUnreadable);
    return result === "fail" ? "fail" : "unknown";
  }
  return result;
}

// brandOfVariant(run, variant, { expectVariants }) -> { result: "pass"|"warn"|"fail"|"unknown", lines }.
// `run` is runBrandCheck's answer; `variant` has `report` (the report's kind) and `reportName`.
export function brandOfVariant(run, variant, { expectVariants = true } = {}) {
  if (!run || run.state === "running") return unknown(SAY.running);
  if (run.state !== "done" || !run.report) return unknown(SAY.notRun);
  const report = run.report;
  const goal = goalLevel(report);
  const piece = report.pieces.find((p) => p.kind === variant.report && p.name === variant.reportName);
  if (!piece) {
    if (goal.result === "fail") return finishLines("fail", goal.lines);
    return unknown(SAY.notFound);
  }
  let result = pieceResult(piece);
  const lines = [...piece.hard, ...piece.soft].filter((e) => e.code !== "kit_missing").map(lineOf);
  if (result === "unknown") lines.unshift(SAY.couldNot);
  if (goal.result === "fail") result = "fail";
  else if (goal.result === "unknown" && result !== "fail") result = "unknown";
  lines.unshift(...goal.lines);
  if (expectVariants) {
    if (!report.variants.present) {
      lines.push(SAY.notCompared);
      if (result === "pass" || result === "warn") result = "unknown";
    } else {
      for (const e of report.variants.hard) {
        const named = idsNamed(e.detail);
        if (named.length && !named.includes(variant.id)) continue;
        lines.push(e.detail);
        if (e.code === "could_not_check") { if (result !== "fail") result = "unknown"; } else result = "fail";
      }
    }
  }
  result = withKit(report, result, lines);
  return finishLines(result, lines);
}

// The whole goal at once (a single piece, id "piece"): the worst of every piece.
export function brandOfAll(run) {
  if (!run || run.state === "running") return unknown(SAY.running);
  if (run.state !== "done" || !run.report) return unknown(SAY.notRun);
  const report = run.report;
  if (!report.pieces.length) return unknown(SAY.notFound);
  const results = report.pieces.map(pieceResult);
  let result = results.includes("fail") ? "fail" : results.includes("unknown") ? "unknown" : results.includes("warn") ? "warn" : "pass";
  const lines = [];
  for (const p of report.pieces) {
    for (const e of [...p.hard, ...p.soft]) {
      if (e.code === "kit_missing") continue;
      lines.push((OWN_WORDS[e.code] || p.kind === "goal") ? lineOf(e) : `${p.name}: ${lineOf(e)}`);
    }
  }
  if (results.includes("unknown")) lines.unshift(SAY.couldNot);
  result = withKit(report, result, lines);
  return finishLines(result, lines.map((l) => plainText(l, MAX_DETAIL + MAX_WHERE)));
}

// The stub homes' runner: an answer at once, no process.
export async function stubBrandCheckRunner() {
  return { kit: "missing", pieces: [] };
}
