// PLAN-V5 K14 steps 4 and 5 (T41c): a film's shots for Studio, the clip verdicts and the money, read-only.
//   GET /api/studio/films                  { films: [{ task, approvedAt, budget, spent, clips, kept, state, problem }] }
//   GET /api/studio/films/:taskId          the film: { task, treatment, batches, shots, total, edit,
//                                          changedAfterApproval, problem } (test/shapes/films.json)
//   GET /api/studio/films/:taskId/sent/:job   the picture the door sent to Runway for one take of this film
// A film is a goal with the home server's own `shotlist:` record (the owner's approvals, lib/shotlist.mjs). What
// each part rests on, and never on anything else (C12):
//   - money and takes: the generation door's own ledger (engine/generate/ledger.mjs), read again on every call;
//     a take's credits are its charge there, its result in the words of lib/generation.mjs. The Artist's
//     `clips/<clip>.json` is never read;
//   - the shots: the newest approval's batch file, written only by the home server and read with the door's own
//     reader (engine/generate/state.mjs readBatch, at its approval time); their seconds and kind are what the owner
//     approved;
//   - a shot's render, move and prompt: what the owner approved, as the newest approval's `shotlist:` record keeps
//     it (lib/shotlist.mjs), never the Artist's shotlist.json as it is now (T48 F3); each take also shows the
//     prompt of its own batch's approval. `changedAfterApproval` when the approved treatment's shotlist.json (read
//     through readShotlist) no longer prices and reads to the approved shots' hash (render and prompt included),
//     or can no longer be read;
//   - the picture and the prompt sent: the door's own job record and kept input (workStore: readJob, readInput),
//     the picture for a day, the prompt as long as the door keeps the job record (two days);
//   - `labels`: the plain words that tell the approved apart from the sent;
//   - clips, stills and boards: the Artist's files at fixed names, by exact-name listing (a link, a folder that is a
//     link, a name in another letter case are not shown), each checked by its first bytes, shown through /api/view;
//   - verdicts: the Art director's clip reviews (lib/clipreview.mjs), by the board's author id only;
//   - the edit: a `video/<name>/manifest.json` of the goal (capped read) made by `film` from this treatment.
// Takes are numbered per batch, as the door counts them (a take the door released, which cost nothing and does not
// count, is left out): t1, t2 in reservation order. Nothing here writes anything. Never throws on what an agent
// wrote; every value that comes from a file goes out as checked, capped plain text.
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { directionsFor } from "../../../company/lib/craft-files.mjs";
import { JOB_RE, readLedger, summarize } from "../../../generate/ledger.mjs";
import { BATCH_DAYS, readBatch, workStore } from "../../../generate/state.mjs";
import { CLIP_ID, clipReviewsOf, usableClipReview } from "../lib/clipreview.mjs";
import { LEDGER_SENTENCES, plain, readBatchFile, resultWords } from "../lib/generation.mjs";
import {
  approvalsOf, approvedShots, boardsOf, dollars, exactlyThere, priceShotlist, readShotlist, SHOT_ID, shotsHash,
} from "../lib/shotlist.mjs";
import { fileResponse } from "../lib/static.mjs";
import { fileToken, goalFolder, readTaskText } from "../lib/taskfiles.mjs";
import { findTask, loadTaskContext, treeComments } from "../lib/tasks.mjs";
import { goalsOf, loadIssues, needIds } from "../lib/goals.mjs";
import { placeOf, readVariants } from "../lib/variants.mjs";
import { isMp4, readGoalBytes, sniff } from "./_images.mjs";
import { lengthOf } from "./studio-video.mjs";

export const FILMS_SHOWN = 30;
export const FREEZE_AT = 2;                   // the door's REFUSALS_TO_FREEZE (engine/generate/door.mjs)
export const FROZEN = "Runway refused two pictures or prompts in this film. It needs you.";
export const NO_BATCH_FILE = "The approval's own file is no longer kept, so the shots are listed from what was spent.";
export const NO_TREATMENT = "The film's list of treatments (variants.json) is missing, so its clips cannot be shown.";
export const GONE = "gone";
// What each prompt and render on the film is, in the owner's words (T48 F3): the approved ones are the shot's
// `render`, `move` and `prompt` and a take's `approvedPrompt`; the sent one is a take's `sentPrompt`.
export const LABELS = Object.freeze({
  approved: "What you approved",
  sentPrompt: "The prompt sent to Runway",
  sentPromptGone: "No longer kept: the door keeps what it sent for two days.",
  sentPromptNone: "The door kept no copy of this prompt.",
  changed: "The shotlist was changed after you approved it. Each take shows what was sent to Runway.",
});
const MAX_PROMPT = 1000;
const DAY_MS = 24 * 3600_000;
const STILLS = 6;
const MAX_VIDEO = 300 * 1024 * 1024;          // the most /api/view shows of one video
const MAX_PICTURE = 20 * 1024 * 1024;         // the most /api/view shows of one picture
const MAX_MANIFEST = 64 * 1024;
const MAX_LISTED = 2000;
const MAX_EDITS = 200;
const EDIT_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;    // a video folder's name, as routes/studio-slides.mjs lists them
const TASK_PARAM = /^[A-Za-z0-9_-]{1,64}$/;
const SANDBOX = "default-src 'none'; sandbox";
const SENT_TYPES = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const lstatOrNull = (p) => { try { return lstatSync(p); } catch { return null; } };
const iso = (ms) => new Date(ms).toISOString();
const timeOf = (s) => (typeof s === "string" && s.length <= 40 ? Date.parse(s) : NaN);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The names in one folder exactly as stored (at most 2000 looked at), or null when it is not a real folder.
function namesIn(dir) {
  try {
    const st = lstatSync(dir);
    if (!st.isDirectory()) return null;
    return readdirSync(dir).slice(0, MAX_LISTED);
  } catch { return null; }
}

// A child of `dir` named exactly `name` (no other entry folding to it) that is a real folder (lstat: never a link).
function exactFolder(dir, names, name) {
  if (!dir || !exactlyThere(names, name)) return null;
  const p = join(dir, name);
  const st = lstatOrNull(p);
  return st && st.isDirectory() ? p : null;
}

// ---- money: the door's ledger -------------------------------------------------------------------------------

// The door's ledger, read now: { ok, jobs: Map(job -> summarize's job) }.
export function ledgerNow(config) {
  try {
    const r = readLedger(config.paths.ledger);
    return r.ok ? { ok: true, jobs: summarize(r.lines).jobs } : { ok: false, jobs: new Map() };
  } catch {
    return { ok: false, jobs: new Map() };
  }
}

// The jobs of one batch, in reservation order.
function jobsOf(ledger, batchId) {
  const out = [];
  for (const j of ledger.jobs.values()) if (j.batch === batchId) out.push(j);
  return out.sort((a, b) => a.at - b.at);
}

// One approval's batch as the film shows it, with what the door's ledger says it cost. The dates and budget are the
// home server's own (the record, then the batch file); the shots are the batch file's, read with the door's reader.
function batchOf(config, goalId, a, ledger) {
  const dir = config.paths.batches;
  let file = null;
  try { file = readBatchFile(dir, a.batch); } catch { file = null; }
  if (file && file.task !== null && file.task !== goalId) file = null;
  let shots = null;
  if (file) {
    try {
      const back = readBatch(dir, a.batch, { slug: file.slug, now: file.approvedAt });
      if (back.ok) shots = back.batch.shots;
    } catch { shots = null; }
  }
  const approved = timeOf(a.at);
  const jobs = jobsOf(ledger, a.batch);
  const refused = jobs.filter((j) => j.end && j.end.verdict === "refused").length;
  return {
    id: a.batch,
    approvedAt: iso(approved),
    expiresAt: iso(file ? file.expiresAt : approved + BATCH_DAYS * DAY_MS),
    budget: a.budget,
    spent: ledger.ok ? jobs.reduce((s, j) => s + j.charge, 0) : null,
    refused: ledger.ok ? refused : null,
    frozen: ledger.ok && refused >= FREEZE_AT,
    _: { approval: a, approved, file, shots, jobs },
  };
}

// "150 of 300 credits spent ($1.50 of $3.00)."
export function totalWords(spent, budget) {
  if (spent === null) return `What was spent cannot be read; ${budget} credits (${dollars(budget)}) were approved.`;
  return `${spent} of ${budget} credits spent (${dollars(spent)} of ${dollars(budget)}).`;
}

// ---- the treatment ------------------------------------------------------------------------------------------

// The newest approval's treatment: its variant and direction from the record (the repo's directions list for the
// title), its folder's name from variants.json (read with its checks). { variant, direction, name, folder, problem }.
function treatmentOf(config, identifier, a) {
  let direction = null;
  try {
    const d = a.direction ? directionsFor("film").find((x) => x.id === a.direction) : null;
    if (d) direction = { id: d.id, title: plain(d.title, 80) };
  } catch { direction = null; }
  const v = readVariants(config, identifier, "film");
  const name = v.present && !v.problem ? v.name : null;
  const place = name ? placeOf("film", name, a.variant) : null;
  return {
    variant: a.variant, direction, name,
    folder: place ? `${name}-${a.variant}` : null,
    rel: place ? place.rel : null,
    problem: !v.present ? NO_TREATMENT : v.problem || null,
  };
}

// True when the treatment's shotlist still prices and reads to the shots the owner approved (the record's hash, the
// renders and prompts included). The models are not in the record, so each pair the approved batch used (or, with
// no batch file, its jobs in the ledger) is tried for ordinary shots and for best ones: a model chosen later in
// Settings does not count as a change.
function sameAsApproved(shotlist, models, hash) {
  const list = [...new Set(models.filter((m) => typeof m === "string"))];
  for (const video of list) {
    for (const videoBest of list) {
      const priced = priceShotlist(shotlist, { video, videoBest });
      if (priced.ok && shotsHash(approvedShots(shotlist, priced)) === hash) return true;
    }
  }
  return false;
}

// The approved shots of one approval by id: Map(id -> { render, move, prompt }); empty for a record that kept none.
const approvedOf = (a) => new Map((a && Array.isArray(a.approved) ? a.approved : []).map((s) => [s.id, s]));

// ---- the Artist's files: clips, stills and the edit ---------------------------------------------------------

// The clips of one treatment folder (`film/<folder>/clips/`), listed once: clip(id) and stills(id) give
// /api/view addresses of files there in exactly that letter case, never through a link, each checked by its first
// bytes. A treatment that is not there gives none.
function clipsOf(config, identifier, folder) {
  const none = { clip: () => null, stills: () => [] };
  const base = folder ? goalFolder(config, identifier) : null;
  if (!base) return none;
  const film = exactFolder(base, namesIn(base), "film");
  const treatment = film ? exactFolder(film, namesIn(film), folder) : null;
  const clips = treatment ? exactFolder(treatment, namesIn(treatment), "clips") : null;
  const names = clips ? namesIn(clips) : null;
  if (!names) return none;
  const rel = (name) => `film/${folder}/clips/${name}`;
  const view = (path) => `/api/view/${fileToken(`${identifier}/${path}`)}`;
  return {
    clip(id) {
      const name = `${id}.mp4`;
      if (!exactlyThere(names, name)) return null;
      const st = lstatOrNull(join(clips, name));
      if (!st || !st.isFile()) return null;
      const head = readGoalBytes(config, identifier, rel(name), { maxBytes: 12, readOver: true });
      if (!head || head.tooLarge || head.size > MAX_VIDEO || !isMp4(head.bytes)) return null;
      return view(rel(name));
    },
    stills(id) {
      const dir = exactFolder(clips, names, id);
      const frames = dir ? namesIn(dir) : null;
      if (!frames) return [];
      const out = [];
      for (let n = 1; n <= STILLS; n += 1) {
        const name = `frame-${String(n).padStart(2, "0")}.png`;
        if (!exactlyThere(frames, name)) continue;
        const st = lstatOrNull(join(dir, name));
        if (!st || !st.isFile()) continue;
        const path = rel(`${id}/${name}`);
        const head = readGoalBytes(config, identifier, path, { maxBytes: 16, readOver: true });
        if (!head || head.tooLarge || head.size > MAX_PICTURE || sniff(head.bytes) !== "png") continue;
        out.push(view(path));
      }
      return out;
    },
  };
}

// The edit of this treatment: the newest `video/<name>/manifest.json` of the goal (at most 64 KB, a regular file in
// a real folder of a plain name) that says it is a video made by `film` from `film/<folder>`, with at least one
// clip named by its id and a length. -> { identifier, name, clips (different clips in it), seconds } or null.
export function filmEdit(config, identifier, folder) {
  try {
    const base = typeof folder === "string" && folder ? goalFolder(config, identifier) : null;
    if (!base) return null;
    const videos = exactFolder(base, namesIn(base), "video");
    const names = videos ? namesIn(videos) : null;
    if (!names) return null;
    let best = null;
    for (const name of names.filter((n) => EDIT_NAME.test(n)).sort().slice(0, MAX_EDITS)) {
      const dir = exactFolder(videos, names, name);
      const inside = dir ? namesIn(dir) : null;
      if (!inside || !exactlyThere(inside, "manifest.json")) continue;
      const read = readTaskText(config, identifier, `video/${name}/manifest.json`, { maxBytes: MAX_MANIFEST });
      if (!read || read.truncated) continue;
      let m;
      try { m = JSON.parse(read.text); } catch { continue; }
      if (!isObject(m) || m.kind !== "video" || m.made_by !== "film" || m.film !== folder || !Array.isArray(m.clips)) continue;
      const clips = new Set(m.clips.slice(0, 100).map((c) => (isObject(c) && typeof c.clip === "string" && CLIP_ID.test(c.clip) ? c.clip : null)).filter(Boolean));
      const seconds = lengthOf(m.seconds);
      if (!clips.size || seconds === null) continue;
      if (!best || read.mtimeMs > best.at || (read.mtimeMs === best.at && name > best.name)) best = { at: read.mtimeMs, name, clips: clips.size, seconds };
    }
    return best ? { identifier, name: best.name, clips: best.clips, seconds: best.seconds } : null;
  } catch {
    return null;
  }
}

// ---- the picture sent: the door's own records ---------------------------------------------------------------

// What the door kept of the picture it sent for one job of a batch: { pic } (the bytes, checked by the door's reader
// and again by their first bytes), "gone" (the door keeps an input for a day, a job record for two), or null (the job
// sent no picture, as a shot from words alone). `seen` caches inputs by id within one call.
function sentOf(store, j, now, seen = new Map()) {
  if (j.kind === "text_to_video") return null;
  let rec = null;
  try { rec = store.readJob(j.job); } catch { rec = null; }
  if (!rec) return GONE;
  if (rec.slug !== "artist" || rec.batch !== j.batch || !Array.isArray(rec.inputs)) return GONE;
  const id = rec.inputs.find((x) => typeof x === "string");
  if (!id) return null;
  if (!seen.has(id)) {
    let pic = null;
    try { pic = store.readInput("artist", id, now); } catch { pic = null; }
    const kind = pic ? sniff(pic.bytes) : null;
    seen.set(id, pic && SENT_TYPES[kind] === pic.type ? pic : null);
  }
  const pic = seen.get(id);
  return pic ? { pic } : GONE;
}

// The prompt the door sent for one job of a batch, from its own job record: the text (capped plain text: at most
// 1000 characters, line breaks kept, tabs as spaces, other control and direction characters dropped), "gone" (the
// door keeps a job record for two days), or null (the record keeps no prompt: a job from before the door kept
// them, or one settled at the door's start). The door keeps it as `prompt` (engine/generate/door.mjs, T49a).
function sentPromptOf(store, j) {
  let rec = null;
  try { rec = store.readJob(j.job); } catch { rec = null; }
  if (!rec) return GONE;
  if (rec.slug !== "artist" || rec.batch !== j.batch) return GONE;
  const v = rec.prompt;
  if (typeof v !== "string") return null;
  const text = v.replace(/\r\n?/g, "\n").replace(/\t/g, " ")
    .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, "").slice(0, MAX_PROMPT);
  return text.trim() ? text : null;
}

// ---- the film -----------------------------------------------------------------------------------------------

// The state of a take from its end line in the ledger: making (no end yet), made, refused or failed.
function takeState(j) {
  if (!j.end) return "making";
  if (j.end.verdict === "done") return "made";
  if (j.end.verdict === "refused") return "refused";
  return "failed";
}

// The newest usable clip review in [from, to) that names this clip: { verdict, reason, round } or null.
function verdictOf(reviews, clip, from, to) {
  for (let i = reviews.length - 1; i >= 0; i -= 1) {
    const r = reviews[i];
    const at = timeOf(r.at);
    if (!(at >= from && at < to)) continue;
    const c = r.clips.find((x) => x.clip === clip);
    if (c) return { verdict: c.verdict, reason: c.reason, round: r.round };
  }
  return null;
}

// filmOf(ctx, goal, { approvals, ledger, comments, artDirectorId, store, now, files }) -> the film as
// GET /api/studio/films/:taskId answers it (`files: false` leaves out what needs the Artist's files and the door's
// kept records: clips, stills, boards, the picture and the prompt sent; the Films list needs none of them).
export function filmOf(ctx, goal, { approvals, ledger, comments = [], artDirectorId = null, store = null, now = Date.now(), files = true }) {
  const { config } = ctx;
  const identifier = typeof goal.identifier === "string" ? goal.identifier : null;
  const seenBatch = new Set();
  const list = approvals.filter((a) => (seenBatch.has(a.batch) ? false : seenBatch.add(a.batch)));
  const newest = list.at(-1);
  const batches = list.map((a) => batchOf(config, goal.id, a, ledger));
  const last = batches.at(-1);
  const treatment = identifier ? treatmentOf(config, identifier, newest) : { variant: newest.variant, direction: null, name: null, folder: null, rel: null, problem: NO_TREATMENT };

  // What each shot is (render, move, prompt): what the owner approved, from the newest approval's record. The
  // approved treatment's shotlist as it is now is read only to tell whether it changed since.
  const asked = ctx.decisions?.get?.(`asked:${goal.id}`);
  const allowWords = isObject(asked) && isObject(asked.answers) && asked.answers.fromwords === "Yes";
  const read = treatment.rel ? readShotlist(config, identifier, treatment.rel, { allowWords }) : { ok: false, shotlist: null, problem: null };
  const listed = approvedOf(newest);
  const usedModels = last._.shots ? Object.values(last._.shots).map((s) => s.model) : last._.jobs.map((j) => j.model);
  const changedAfterApproval = !!treatment.rel
    && (!read.ok || (usedModels.length > 0 && !sameAsApproved(read.shotlist, usedModels, newest.shots)));

  // The shots: the newest batch's, as the owner approved them; with no batch file, those its jobs name.
  let ids = last._.shots ? Object.keys(last._.shots) : [...new Set(last._.jobs.map((j) => j.shot))];
  if (!ids.length && !last._.shots) ids = [...listed.keys()];
  ids = ids.filter((id) => typeof id === "string" && SHOT_ID.test(id)).sort();
  const boards = files && identifier && treatment.rel ? new Map(boardsOf(config, identifier, treatment.rel, ids).map((b) => [b.shot, b.url])) : new Map();

  const reviews = clipReviewsOf(comments, artDirectorId).filter(usableClipReview);
  const folders = new Map();
  const filesIn = (variant) => {
    const folder = treatment.name ? `${treatment.name}-${variant}` : null;
    if (!folders.has(folder)) folders.set(folder, files && identifier ? clipsOf(config, identifier, folder) : { clip: () => null, stills: () => [] });
    return folders.get(folder);
  };
  const inputs = new Map();
  const shots = ids.map((id) => {
    const s = listed.get(id) || null;
    const approved = last._.shots ? last._.shots[id] : null;
    const takes = [];
    const places = [];
    batches.forEach((b, k) => {
      const from = b._.approved;
      const to = k + 1 < batches.length ? batches[k + 1]._.approved : Infinity;
      const own = b._.jobs.filter((j) => j.shot === id && !(j.end && j.end.state === "released"));
      const asApproved = approvedOf(b._.approval).get(id) || null;
      own.forEach((j, n) => {
        const take = `t${n + 1}`;
        const clip = `${id}-${take}`;
        const sent = files && store ? sentOf(store, j, now, inputs) : null;
        takes.push({
          take, batch: b.id, job: JOB_RE.test(j.job) ? j.job : null,
          state: takeState(j), credits: j.charge, result: resultWords(j),
          sent: sent && sent !== GONE ? `/api/studio/films/${encodeURIComponent(goal.id)}/sent/${j.job}` : sent,
          approvedPrompt: asApproved ? asApproved.prompt : null,
          sentPrompt: files && store ? sentPromptOf(store, j) : null,
          clip: null,
          stills: [],
          verdict: CLIP_ID.test(clip) ? verdictOf(reviews, clip, from, to) : null,
        });
        places.push({ variant: b._.approval.variant, clip });
      });
    });
    // A clip file belongs to a take that was made, and, when two batches' takes share its name in one treatment
    // folder, to the newest of them: the file was written last for it.
    const claimed = new Set();
    for (let i = takes.length - 1; i >= 0; i -= 1) {
      const { variant, clip } = places[i];
      const key = `${variant}/${clip}`;
      if (takes[i].state !== "made" || !CLIP_ID.test(clip) || claimed.has(key)) continue;
      claimed.add(key);
      const f = filesIn(variant);
      takes[i].clip = f.clip(clip);
      takes[i].stills = f.stills(clip);
    }
    return {
      id,
      render: s ? s.render : null,
      move: s ? s.move : null,
      // With no batch file, the kind the door took for this shot (it takes only the approved kind); the seconds
      // are then not known, never the Artist's file's.
      seconds: approved && Number.isInteger(approved.maxSeconds) ? approved.maxSeconds : null,
      prompt: s ? s.prompt : null,
      kind: approved ? approved.kind : last._.jobs.find((j) => j.shot === id)?.kind ?? null,
      board: boards.get(id) || null,
      takes,
      credits: takes.reduce((n, t) => n + t.credits, 0),
    };
  });

  const budget = batches.reduce((n, b) => n + b.budget, 0);
  const spent = ledger.ok ? batches.reduce((n, b) => n + b.spent, 0) : null;
  const edit = identifier && treatment.folder ? filmEdit(config, identifier, treatment.folder) : null;
  const problem = !ledger.ok ? LEDGER_SENTENCES.unreadable
    : treatment.problem || (treatment.rel && !read.ok ? read.problem : null) || (!last._.shots ? NO_BATCH_FILE : null);
  return {
    task: { id: goal.id, identifier, title: plain(goal.title, 200) },
    treatment: { variant: treatment.variant, direction: treatment.direction, name: treatment.name },
    batches: batches.map(({ _, ...b }) => b),
    shots,
    total: { spent, budget, words: totalWords(spent, budget) },
    edit: edit ? { identifier: edit.identifier, name: edit.name } : null,
    changedAfterApproval,
    problem,
    labels: { ...LABELS },
  };
}

// The film's state in the list: stopped (a cancelled goal), done, needs you (the newest batch has two Runway
// refusals), making (its newest batch is still open), or ended (the approval ran out before the goal was done).
export function filmState(goal, film, now = Date.now()) {
  if (goal.status === "cancelled") return "stopped";
  if (goal.status === "done") return "done";
  const last = film.batches.at(-1);
  if (last && last.frozen) return "needs you";
  return last && timeOf(last.expiresAt) > now ? "making" : "ended";
}

const endedWords = (at) => `The approval of its cost ended on ${new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}, so nothing more can be made with Runway for it.`;

// One row of the Films list.
export function filmRow(goal, film, now = Date.now()) {
  const state = filmState(goal, film, now);
  const last = film.batches.at(-1);
  const takes = film.shots.flatMap((s) => s.takes);
  return {
    task: film.task,
    approvedAt: last ? last.approvedAt : null,
    budget: film.total.budget,
    spent: film.total.spent,
    clips: takes.filter((t) => t.state === "made").length,
    kept: film.shots.filter((s) => s.takes.some((t) => t.verdict && t.verdict.verdict === "keep")).length,
    state,
    problem: state === "needs you" ? FROZEN : state === "ended" ? endedWords(timeOf(last.expiresAt)) : film.problem,
  };
}

// ---- a finished film's card in Needs you (inbox/goals.mjs) --------------------------------------------------

// The two details of a finished film's ordinary card, or null when the goal has no `shotlist:` record:
// "Film" ("6 clips, 30.5 seconds" from the edit's manifest, or "No edit yet") and "Spent" ("150 of 300 credits
// ($1.50 of $3.00)"), from the door's ledger only.
export function filmCardDetails(ctx, goal) {
  const approvals = approvalsOf(ctx.decisions, goal.id);
  if (!approvals.length) return null;
  const seenBatch = new Set();
  const list = approvals.filter((a) => (seenBatch.has(a.batch) ? false : seenBatch.add(a.batch)));
  const ledger = ledgerNow(ctx.config);
  const budget = list.reduce((n, a) => n + a.budget, 0);
  const spent = ledger.ok ? list.reduce((n, a) => n + jobsOf(ledger, a.batch).reduce((s, j) => s + j.charge, 0), 0) : null;
  const identifier = typeof goal.identifier === "string" ? goal.identifier : null;
  const treatment = identifier ? treatmentOf(ctx.config, identifier, list.at(-1)) : null;
  const edit = treatment && treatment.folder ? filmEdit(ctx.config, identifier, treatment.folder) : null;
  return {
    film: edit ? `${plural(edit.clips, "clip", "clips")}, ${edit.seconds} seconds` : "No edit yet",
    spent: spent === null
      ? `Not known: the spending ledger cannot be read. Up to ${budget} credits (${dollars(budget)}) were approved.`
      : `${spent} of ${budget} credits (${dollars(spent)} of ${dollars(budget)})`,
  };
}

// ---- the routes ---------------------------------------------------------------------------------------------

function noFilm(ctx) {
  return ctx.fail(404, "There is no film for this task.", "Go back to Studio and pick a film from the list.", "film_not_found");
}

function notSent(ctx) {
  return ctx.fail(404, "That picture is not one this film sent to Runway.", "Go back to the film and look at it again.", "sent_not_found");
}

export default function register(app) {
  app.get("/api/studio/films", async (ctx) => {
    const tctx = await loadTaskContext(ctx, { withInbox: false, withComments: false });
    const artDirectorId = tctx.ids?.agents?.["art-director"] || null;
    const now = Date.now();
    const found = [];
    for (const goal of tctx.goals) {
      const approvals = approvalsOf(ctx.decisions, goal.id);
      if (approvals.length) found.push({ goal, approvals, at: timeOf(approvals.at(-1).at) });
    }
    found.sort((a, b) => b.at - a.at || String(a.goal.id).localeCompare(String(b.goal.id)));
    const ledger = ledgerNow(ctx.config);
    const films = [];
    for (const { goal, approvals } of found.slice(0, FILMS_SHOWN)) {
      let comments = [];
      try { comments = await treeComments(tctx, goal); } catch { comments = []; }
      const film = filmOf(ctx, goal, { approvals, ledger, comments, artDirectorId, now, files: false });
      films.push(filmRow(goal, film, now));
    }
    return { films };
  });

  app.get("/api/studio/films/:taskId", async (ctx) => {
    if (!TASK_PARAM.test(ctx.params.taskId)) throw noFilm(ctx);
    const tctx = await loadTaskContext(ctx, { withInbox: false, withComments: false });
    const goal = findTask(tctx, ctx.params.taskId);
    const approvals = goal ? approvalsOf(ctx.decisions, goal.id) : [];
    if (!goal || !approvals.length) throw noFilm(ctx);
    const comments = await treeComments(tctx, goal);
    const artDirectorId = tctx.ids?.agents?.["art-director"] || null;
    const store = workStore(ctx.config.paths.doorWork);
    return filmOf(ctx, goal, { approvals, ledger: ledgerNow(ctx.config), comments, artDirectorId, store, now: Date.now() });
  });

  // The door's own kept copy of what it sent, only for a job of this film's batches, never for longer than the
  // door keeps it; the bytes are the door's, checked by their first bytes, sent under a policy that runs nothing.
  app.get("/api/studio/films/:taskId/sent/:job", async (ctx) => {
    const { taskId, job } = ctx.params;
    if (!TASK_PARAM.test(taskId) || typeof job !== "string" || !JOB_RE.test(job)) throw notSent(ctx);
    const ids = needIds(ctx);
    const goal = goalsOf(await loadIssues(ctx, ids.companyId), ids).find((g) => g.id === taskId || g.identifier === taskId);
    const batches = new Set(goal ? approvalsOf(ctx.decisions, goal.id).map((a) => a.batch) : []);
    const ledger = ledgerNow(ctx.config);
    const j = ledger.ok ? ledger.jobs.get(job) : null;
    if (!j || typeof j.batch !== "string" || !batches.has(j.batch)) throw notSent(ctx);
    const sent = sentOf(workStore(ctx.config.paths.doorWork), j, Date.now());
    if (sent === GONE) {
      throw ctx.fail(404, "The door keeps a picture it sent for a day, and this one is no longer kept.",
        "Nothing to do: the clip and its stills stay in the task's folder.", "sent_gone");
    }
    if (!sent) throw notSent(ctx);
    const { bytes, type } = sent.pic;
    return fileResponse({ bytes, size: bytes.length, type }, {
      "content-disposition": `inline; filename="sent-${job.slice(0, 64)}.${EXT[type]}"`,
      "content-security-policy": SANDBOX,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    });
  });
}
