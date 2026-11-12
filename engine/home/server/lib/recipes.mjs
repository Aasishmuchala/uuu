// The recipe log (CONTRACTS-V3 36.4): `packs/recipe-log.md` in the company brain, the one file there the owner
// did not type. Every agent reads the brain before it works, so nothing an agent wrote may reach this file:
// it is built only from records agents cannot write and from numbers.
//   - which tasks: the home server's own `template:` records naming a Marketing job in the catalogue (the log
//     also takes Studio jobs, PLAN-V5 K9; the Marketing page's answer keeps to Marketing);
//   - the job's title: from the job file in the repo;
//   - the owner's words: the answers the home server recorded when the job was started (`asked:<task id>`); an
//     earlier task chosen as an answer is named by the title the home server gave it (its job's title and its
//     first one-line answer, from its own records), else by its identifier on the board;
//   - the verdicts: the home server's `verdicts:<task id>` records (lib/verdicts.mjs), one row per verdict, written
//     when the owner accepts the task or sends it back, with the owner's own note; for a task accepted before
//     those records existed, the owner's `acknowledged:goal:` record (Accepted);
//   - the rounds: how many check comments the Checker wrote up to that verdict (by its author on the board, never
//     by the text);
//   - the scores: the numbers of the last of those rounds, through scoresOf, from the Checker's comments only. A
//     piece's name (its slug) is the Checker's own word, so it never reaches the file: each piece is "piece <n>".
//   - the versions (PLAN-V5 K9): the home server's `pick:` records (lib/picks.mjs). A pick is the acceptance and
//     its row says "Picked version 2 of 3 (<direction title>)", the title from the repo's directions.json; "send
//     all back" is a Sent back row; "another round" is a row of its own. The Art director's totals are numbers.
// Every line of the file is fixed words, numbers, the job file's title or the owner's own text made one line.
// recipeEntries feeds the Marketing answer; refreshRecipeLog writes the file, at most once a minute and only
// when its text would change, and never throws.
import { brainFor } from "../brain/store.mjs";
import { commentsOf, descendants, goalsOf, loadIssues } from "./goals.mjs";
import { loadCatalogue } from "./jobs.mjs";
import { ANOTHER, BACK, directionTitle, PICK, picksOf } from "./picks.mjs";
import { roundsOf } from "./staged.mjs";
import { scoresOf } from "./scores.mjs";
import { ACCEPTED, verdictsOf } from "./verdicts.mjs";
import { kindOfTask } from "../routes/pieces.mjs";

export const LOG_PATH = "packs/recipe-log.md";
export const MAX_ENTRIES = 200;
export const LOG_DEPARTMENTS = ["marketing", "studio"];
const MAX_WORDS = 300;
const MAX_NOTE = 300;
const CHECK_EVERY = 60000;
const BATCH = 8;

// The owner's text as one plain line: no control or format characters, no line breaks, capped.
function oneLine(v, max) {
  const t = String(v ?? "").replace(/[\p{C}]/gu, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function dateText(ms) {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

const timeOf = (v) => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

const answersOf = (record) => (record && typeof record === "object" && record.answers && typeof record.answers === "object" ? record.answers : null);

// The title the home server gave an earlier task, from its own records only: the job's title, then ": " and the
// task's first one-line answer when there is one. null when the task was not started from a job.
function startedTitle(ctx, jobs, taskId) {
  const ref = ctx.decisions?.get(`template:${taskId}`);
  const job = typeof ref === "string" ? jobs.get(ref) : null;
  if (!job) return null;
  const answers = answersOf(ctx.decisions?.get(`asked:${taskId}`));
  const line = (Array.isArray(job.asks) ? job.asks : []).find((a) => a.kind === "line" && answers && typeof answers[a.id] === "string" && answers[a.id].trim());
  return oneLine(line ? `${job.title}: ${answers[line.id]}` : job.title, 120);
}

// The answers recorded at the start, in the order of the job's asks: "<label>: <answer>; ...". A task chosen as
// an answer is recorded by its identifier (or, in older records, its id) and named by startedTitle.
function wordsOf(ctx, jobs, job, record, issues) {
  const answers = answersOf(record);
  if (!answers) return null;
  const parts = [];
  for (const ask of Array.isArray(job.asks) ? job.asks : []) {
    if (!Object.hasOwn(answers, ask.id)) continue;
    let v = answers[ask.id];
    if (typeof v === "number" && Number.isFinite(v)) v = String(v);
    if (typeof v !== "string") continue;
    if (ask.kind === "task") {
      const earlier = issues.find((i) => i.id === v || (typeof i.identifier === "string" && i.identifier === v));
      v = (earlier && (startedTitle(ctx, jobs, earlier.id) || (typeof earlier.identifier === "string" ? earlier.identifier : null))) || "an earlier task";
    }
    const answer = oneLine(v, MAX_WORDS);
    if (answer) parts.push(`${oneLine(ask.label, 80).replace(/[?:.]+$/, "")}: ${answer}`);
  }
  return parts.length ? oneLine(parts.join("; "), MAX_WORDS) : null;
}

// What the owner did with a card of versions, in fixed words, the repo's direction titles and numbers:
// "Picked version 2 of 3 (Picture led). Totals of 70: 52, 46, 50". null for anything else.
export function versionsLine(kind, p) {
  if (!p) return null;
  const n = p.versions.length;
  const totals = p.versions.map((v) => v.total).filter((t) => Number.isInteger(t));
  const tail = totals.length ? `. Totals of 70: ${totals.join(", ")}` : "";
  if (p.action === PICK) {
    const at = p.versions.findIndex((v) => v.id === p.variant);
    const which = at >= 0 && n ? `version ${at + 1} of ${n}` : "one version";
    const title = directionTitle(kind, p.direction);
    return `Picked ${which}${title ? ` (${title})` : ""}${tail}`;
  }
  if (p.action === BACK) return `Sent all ${n || "the versions"} back${tail}`;
  if (p.action === ANOTHER) return `Asked for another round after ${n || "the versions"}${tail}`;
  return null;
}

// The owner's verdicts on a task from the home server's own records, oldest first: [{ verdict, note, at,
// versions }]. A verdict written in the same moment as a choice on the versions carries that choice (and, for a
// pick, the owner's note with it); "another round" is a row of its own.
function verdictsFor(ctx, goal, kind) {
  const picks = picksOf(ctx.decisions, goal.id);
  const byAt = new Map(picks.map((p) => [p.at, p]));
  const list = verdictsOf(ctx.decisions, goal.id).map((v) => {
    const p = byAt.get(v.at) || null;
    const note = v.note || p?.note || null;
    return {
      verdict: v.verdict === ACCEPTED ? "Accepted" : "Sent back",
      note: note ? oneLine(note, MAX_NOTE) || null : null,
      at: timeOf(v.at) ?? 0,
      versions: versionsLine(kind, p),
    };
  });
  for (const p of picks) {
    if (p.action !== ANOTHER) continue;
    list.push({ verdict: "Another round", note: p.note ? oneLine(p.note, MAX_NOTE) || null : null, at: timeOf(p.at) ?? 0, versions: versionsLine(kind, p) });
  }
  list.sort((a, b) => a.at - b.at);
  if (list.length) return list;
  const ack = ctx.decisions?.get(`acknowledged:goal:${goal.id}`);
  return ack ? [{ verdict: "Accepted", note: null, at: timeOf(ack) ?? timeOf(goal.updatedAt) ?? 0, versions: null }] : [];
}

// The scores of a round: from question 2's reason (36.3), else the first other reason that holds them.
function roundScores(round) {
  if (!round) return [];
  const checks = Array.isArray(round.checks) ? round.checks : [];
  const ordered = [...checks.filter((c) => c.n === 2), ...checks.filter((c) => c.n !== 2)];
  for (const c of ordered) {
    const s = scoresOf(c.reason);
    if (s.length) return s;
  }
  return scoresOf(round.reason);
}

async function inBatches(list, fn) {
  for (let i = 0; i < list.length; i += BATCH) await Promise.all(list.slice(i, i + BATCH).map(fn));
}

// recipeEntries(ctx, { departments }) -> [{ taskId, identifier, at, date, jobId, job, words, rounds, scores,
// verdict, note, versions }], one per verdict of the owner (and per "another round"), newest first, at most 200,
// for jobs of those departments (default Marketing, as the Marketing page shows). Throws when the board cannot
// be read.
export async function recipeEntries(ctx, { departments = ["marketing"] } = {}) {
  const wanted = new Set(departments);
  const ids = ctx.ids();
  if (!ids?.companyId || !ids?.projectId) return [];
  const { jobs } = loadCatalogue(ctx.config);
  const issues = await loadIssues(ctx, ids.companyId);
  const checker = ids.agents?.checker || null;
  const candidates = [];
  for (const g of goalsOf(issues, ids)) {
    const ref = ctx.decisions?.get(`template:${g.id}`);
    if (typeof ref !== "string" || !wanted.has(ref.split("/")[0])) continue;
    const job = jobs.get(ref);
    if (!job || !wanted.has(job.department)) continue;
    let kind = null;
    try { kind = kindOfTask(ctx, g); } catch { kind = null; }
    const verdicts = verdictsFor(ctx, g, kind);
    if (!verdicts.length) continue;
    candidates.push({ g, ref, job, verdicts });
    if (candidates.length >= MAX_ENTRIES * 2) break;
  }
  const out = [];
  await inBatches(candidates, async ({ g, ref, job, verdicts }) => {
    const own = await commentsOf(ctx, g.id);
    const steps = await Promise.all(descendants(issues, g.id).map((s) => commentsOf(ctx, s.id)));
    const tree = [...own, ...steps.flat()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const words = wordsOf(ctx, jobs, job, ctx.decisions?.get(`asked:${g.id}`), issues);
    for (const v of verdicts) {
      // The rounds the owner had seen when giving this verdict.
      const seen = tree.filter((c) => { const t = timeOf(c.createdAt); return t === null || t <= v.at; });
      const rounds = roundsOf(seen, checker);
      out.push({
        taskId: g.id, identifier: typeof g.identifier === "string" ? oneLine(g.identifier, 64) : null,
        at: v.at, date: dateText(v.at), jobId: ref, job: oneLine(job.title, 120), words,
        rounds: rounds.length, scores: roundScores(rounds.at(-1)),
        verdict: v.verdict, note: v.note, versions: v.versions,
      });
    }
  });
  out.sort((a, b) => b.at - a.at || String(b.taskId).localeCompare(String(a.taskId)));
  return out.slice(0, MAX_ENTRIES);
}

// Numbers only: the slugs an agent wrote are replaced by a neutral label.
const scoreLine = (scores) => (scores.length ? scores.map((s, i) => `piece ${i + 1}: ${Number(s.score)}`).join(", ") : "None");

// The file's text: fixed words, the job's title, the owner's own words and numbers. Pure.
export function renderLog(entries) {
  const lines = [
    "# Recipe log",
    "",
    "What was made from a Marketing or Studio job, how many check rounds it took, the Checker's scores out of 10, which version the owner picked, and what the owner said. Newest first.",
    "The home screen writes this file from its own records. Agents do not write it.",
  ];
  if (!entries.length) lines.push("", "Nothing yet.");
  for (const e of entries) {
    lines.push(
      "",
      `## ${e.date} · ${e.job}`,
      `- The owner asked for: ${e.words || "Not recorded."}`,
      `- Rounds: ${e.rounds}`,
      `- Scores of the last round: ${scoreLine(e.scores)}`,
      ...(e.versions ? [`- Versions: ${e.versions}`] : []),
      `- Verdict: ${e.verdict}${e.note ? `. The owner's note: ${e.note}` : ""}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

// writeRecipeLog(ctx) -> { written: boolean }: builds the log and writes it through the brain store only when
// the text would change. Nothing is written while there is nothing to log and no log yet. May throw.
export async function writeRecipeLog(ctx) {
  const entries = await recipeEntries(ctx, { departments: LOG_DEPARTMENTS });
  const brain = brainFor(ctx.config);
  const current = brain.find(LOG_PATH);
  if (!current && !entries.length) return { written: false };
  const text = renderLog(entries);
  if (current) {
    const now = brain.get(current.token);
    if (!now.truncated && now.text === text) return { written: false };
  }
  brain.replace(LOG_PATH, text, current ? current.version : null);
  return { written: true };
}

// state folder -> when the log was last checked
const checked = new Map();

// refreshRecipeLog(ctx): writeRecipeLog at most once a minute per state folder. Never throws.
export async function refreshRecipeLog(ctx, { now = Date.now() } = {}) {
  try {
    const key = ctx.config.paths.state;
    const last = checked.get(key);
    if (last !== undefined && now - last < CHECK_EVERY) return { written: false, skipped: true };
    checked.set(key, now);
    if (checked.size > 50) for (const k of checked.keys()) { checked.delete(k); if (checked.size <= 25) break; }
    return await writeRecipeLog(ctx);
  } catch (e) {
    try { ctx.log?.(`recipe log: ${String(e?.message || e).split("\n")[0]}`); } catch { /* never fail the caller */ }
    return { written: false };
  }
}

// For tests: forget when the log was last checked.
export function forgetRecipeChecks() {
  checked.clear();
}
