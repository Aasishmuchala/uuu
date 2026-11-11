// The recipe log (CONTRACTS-V3 36.4): `packs/recipe-log.md` in the company brain, the one file there the owner
// did not type. Every agent reads the brain before it works, so nothing an agent wrote may reach this file:
// it is built only from records agents cannot write and from numbers.
//   - which tasks: the home server's own `template:` records naming a Marketing job in the catalogue;
//   - the job's title: from the job file in the repo;
//   - the owner's words: the answers the home server recorded when the job was started (`asked:<task id>`);
//   - the verdict: the owner's `acknowledged:goal:` record (Accepted), or the owner's own comment on the board
//     after the newest result, on a task that is not finished (Sent back, with that comment as the note);
//   - the rounds: how many check comments the Checker wrote (by its author on the board, never by the text);
//   - the scores: slugs and numbers of the newest round, through scoresOf, from the Checker's comments only.
// Every line of the file is fixed words, numbers, the job file's title or the owner's own text made one line.
// recipeEntries feeds the Marketing answer; refreshRecipeLog writes the file, at most once a minute and only
// when its text would change, and never throws.
import { brainFor } from "../brain/store.mjs";
import { commentsOf, descendants, goalsOf, loadIssues } from "./goals.mjs";
import { loadCatalogue } from "./jobs.mjs";
import { roundsOf } from "./staged.mjs";
import { scoresOf } from "./scores.mjs";

export const LOG_PATH = "packs/recipe-log.md";
export const MAX_ENTRIES = 200;
const MAX_WORDS = 300;
const MAX_NOTE = 300;
const CHECK_EVERY = 60000;
const BATCH = 8;

const isResult = (c) => !!c?.authorAgentId && /^\s*RESULT:/.test(String(c.body || "").slice(0, 200));
const isOwners = (c) => !!c && !c.authorAgentId;

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

// The answers recorded at the start, in the order of the job's asks: "<label>: <answer>; ...". A task chosen
// as an answer is named by its identifier on the board.
function wordsOf(job, record, issues) {
  const answers = record && typeof record === "object" && record.answers && typeof record.answers === "object" ? record.answers : null;
  if (!answers) return null;
  const parts = [];
  for (const ask of Array.isArray(job.asks) ? job.asks : []) {
    if (!Object.hasOwn(answers, ask.id)) continue;
    let v = answers[ask.id];
    if (typeof v === "number" && Number.isFinite(v)) v = String(v);
    if (typeof v !== "string") continue;
    if (ask.kind === "task") v = issues.find((i) => i.id === v)?.identifier || "an earlier task";
    const answer = oneLine(v, MAX_WORDS);
    if (answer) parts.push(`${oneLine(ask.label, 80).replace(/[?:.]+$/, "")}: ${answer}`);
  }
  return parts.length ? oneLine(parts.join("; "), MAX_WORDS) : null;
}

// The verdict from the owner's own records: { verdict, note, at } or null when there is none yet.
function verdictOf(ctx, goal, own) {
  const ack = ctx.decisions?.get(`acknowledged:goal:${goal.id}`);
  if (ack) return { verdict: "Accepted", note: null, at: timeOf(ack) ?? timeOf(goal.updatedAt) ?? 0 };
  if (goal.status === "done" || goal.status === "cancelled") return null;
  let result = null;
  for (const c of own) if (isResult(c)) result = c;
  if (!result) return null;
  let note = null;
  for (const c of own) if (isOwners(c) && String(c.createdAt) > String(result.createdAt)) note = c;
  if (!note) return null;
  return { verdict: "Sent back", note: oneLine(note.body, MAX_NOTE) || null, at: timeOf(note.createdAt) ?? 0 };
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

// recipeEntries(ctx) -> [{ taskId, identifier, at, date, jobId, job, words, rounds, scores, verdict, note }],
// newest first, at most 200. Throws when the board cannot be read.
export async function recipeEntries(ctx) {
  const ids = ctx.ids();
  if (!ids?.companyId || !ids?.projectId) return [];
  const { jobs } = loadCatalogue(ctx.config);
  const issues = await loadIssues(ctx, ids.companyId);
  const checker = ids.agents?.checker || null;
  const candidates = [];
  for (const g of goalsOf(issues, ids)) {
    const ref = ctx.decisions?.get(`template:${g.id}`);
    if (typeof ref !== "string" || !ref.startsWith("marketing/")) continue;
    const job = jobs.get(ref);
    if (!job || job.department !== "marketing") continue;
    candidates.push({ g, ref, job });
    if (candidates.length >= MAX_ENTRIES * 2) break;
  }
  const out = [];
  await inBatches(candidates, async ({ g, ref, job }) => {
    const own = await commentsOf(ctx, g.id);
    const verdict = verdictOf(ctx, g, own);
    if (!verdict) return;
    const steps = await Promise.all(descendants(issues, g.id).map((s) => commentsOf(ctx, s.id)));
    const tree = [...own, ...steps.flat()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const rounds = roundsOf(tree, checker);
    out.push({
      taskId: g.id, identifier: typeof g.identifier === "string" ? oneLine(g.identifier, 64) : null,
      at: verdict.at, date: dateText(verdict.at), jobId: ref, job: oneLine(job.title, 120),
      words: wordsOf(job, ctx.decisions?.get(`asked:${g.id}`), issues),
      rounds: rounds.length, scores: roundScores(rounds.at(-1)),
      verdict: verdict.verdict, note: verdict.note,
    });
  });
  out.sort((a, b) => b.at - a.at || String(b.taskId).localeCompare(String(a.taskId)));
  return out.slice(0, MAX_ENTRIES);
}

const scoreLine = (scores) => (scores.length ? scores.map((s) => `${s.slug} ${s.score}`).join(", ") : "None");

// The file's text: fixed words, the job's title, the owner's own words and numbers. Pure.
export function renderLog(entries) {
  const lines = [
    "# Recipe log",
    "",
    "What was made from a Marketing job, how many check rounds it took, the Checker's scores out of 10, and what the owner said. Newest first.",
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
      `- Verdict: ${e.verdict}${e.note ? `. The owner's note: ${e.note}` : ""}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

// writeRecipeLog(ctx) -> { written: boolean }: builds the log and writes it through the brain store only when
// the text would change. Nothing is written while there is nothing to log and no log yet. May throw.
export async function writeRecipeLog(ctx) {
  const entries = await recipeEntries(ctx);
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
