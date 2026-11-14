// PLAN-V5 K13 (the home server's part, T41) and K20 (T79): what the Generation section of Settings reads besides the
// switches. Money is read only from the generation door's own ledger (engine/generate/ledger.mjs: readLedger,
// summarize, totalsOf, dayOf, extrasByJob) and priced only with the door's own table (engine/generate/registry.mjs:
// rowOf, estimateCents), in US cents: a Runway credit is a cent, a Higgsfield credit is the owner's rate in cents. The
// home server never writes the ledger, and the door alone tidies it at its start (C3). The owner's approved batches
// are the home server's own files, read back with the trust rule and checked as the door's readBatch checks them.
// Every value that comes from a door file goes out as capped plain text.
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readManifests } from "../../../apps/manifest.mjs";
import { dayOf, extrasByJob, readLedger, summarize, totalsOf } from "../../../generate/ledger.mjs";
import { DEFAULT_CENTS_PER_CREDIT, ROWS, estimateCents, rowOf } from "../../../generate/registry.mjs";
import { KINDS, MAX_SECONDS, MIN_SECONDS, PRICES, VIDEO_KINDS, ratioFits } from "../../../generate/runway.mjs";
import { BATCH_DAYS, ID_RE, MAX_TAKES, SHOT_RE, trustedFolder } from "../../../generate/state.mjs";
import { readTrustedText } from "./doors.mjs";

const MB = 1024 * 1024;
const DAY_MS = 24 * 3600_000;
export const LEDGER_NEARLY_FULL = 24 * MB;
export const BATCH_MAX_BYTES = 16 * 1024;
export const BATCHES_SHOWN = 20;
export const BATCH_KEEP_DAYS = 30;
export const LEDGER_PAGE_DAYS = 14;
export const LEDGER_DAY_ROWS = 200;
const BATCH_FILES_READ = 1000;
const BATCH_FILE = /^([A-Za-z0-9_-]{1,64})\.json$/;
const TASK_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const PAUSED_SENTENCE = "Runway refused three requests in a day. Generation is paused so your account stays safe.";
export const OWN_PAUSE_SENTENCE = "Generation is paused. Press Start again to let the Artist go on.";
export const LEDGER_SENTENCES = Object.freeze({
  nearlyFull: "The spending ledger is nearly full. It is tidied when the engine starts: engine stop, then engine start.",
  unreadable: "The spending ledger cannot be read, so nothing will be made. Health shows what to do.",
});
// A finished job's result, by the verdict of its end line in the ledger.
export const RESULT_WORDS = Object.freeze({
  done: "Made",
  refused: "Refused by Runway",
  failed: "Failed",
  bad_input: "Runway could not use the picture",
  cancelled: "Cancelled",
  unknown: "Unclear, counted as spent",
  stopped: "Stopped: over a limit",
});
export const NOT_STARTED_WORDS = "Not started, nothing spent";
export const RUNNING_WORDS = "Running, counted until it ends";

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// Plain text: control and invisible characters removed, at most `max` characters.
export const plain = (v, max) => String(v ?? "").replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "").slice(0, max);
const plainOrNull = (v, max) => (typeof v === "string" ? plain(v, max) : null);
const isoTime = (ms) => new Date(ms).toISOString();

// ---- prices and words ----------------------------------------------------------------------------------------

// Cents as dollars: dollars(150) -> "$1.50". A Runway credit is one cent; every price and limit is kept in cents.
export function dollars(credits) {
  return `$${(Number(credits) / 100).toFixed(2)}`;
}

const rowIn = (model, table) => (table ? (table.find((r) => r.id === model) || null) : rowOf(model));
const rateOk = (r) => Number.isInteger(r) && r >= 1 && r <= 50;

// A row's largest size by price: the door prices an agent's Higgsfield job at it (engine/generate/door.mjs topSize).
export function topSize(row) {
  if (!row || row.resolutions === null) return undefined;
  const by = row.price && row.price.byResolution;
  if (!by) return row.resolutions[row.resolutions.length - 1];
  return row.resolutions.reduce((best, r) => (by[r] > by[best] ? r : best), row.resolutions[0]);
}

// The price in cents of one job the Artist may be approved for, as the door prices it (engine/generate/door.mjs
// agentPrice): step 3's five Runway models (runway.mjs PRICES) as they are, a Higgsfield row at its largest size and at
// the owner's rate; null for any other model, or when the door has no price (then nothing is approved).
// item: { kind, model, seconds }; opts: { centsPerCredit (the state's rate), table (tests only: rows used instead) }.
export function priceCents({ kind, model, seconds } = {}, { centsPerCredit = DEFAULT_CENTS_PER_CREDIT, table } = {}) {
  const row = rowIn(model, table);
  if (row === null) return null;
  if (row.provider === "runway" && !Object.hasOwn(PRICES, model)) return null;
  const item = { kind, model, seconds: VIDEO_KINDS.includes(kind) ? seconds : undefined, resolution: row.provider === "higgsfield" ? topSize(row) : undefined };
  return estimateCents(item, { centsPerCredit, table });
}

// Whether a model makes a film's ratio as the door takes it: step 3's Runway rows by runway.mjs's list; a Higgsfield
// row as it is or by its lowest terms ("1280:720" is "16:9", engine/generate/door.mjs rowRatio).
export function ratioOk(model, ratio, { table } = {}) {
  const row = rowIn(model, table);
  if (row === null || typeof ratio !== "string") return false;
  if (row.provider === "runway") return ratioFits(model, ratio);
  if (row.ratios === null || row.ratios.includes(ratio)) return true;
  const m = /^([0-9]{1,5}):([0-9]{1,5})$/.exec(ratio);
  if (!m || Number(m[1]) === 0 || Number(m[2]) === 0) return false;
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(Number(m[1]), Number(m[2]));
  return row.ratios.includes(`${Number(m[1]) / g}:${Number(m[2]) / g}`);
}

// The service a model is on, by the door's table ("runway" when the table does not know it, as for old ledger lines).
export const providerOf = (model) => rowOf(model)?.provider || "runway";
export const SERVICE_NAMES = Object.freeze({ runway: "Runway", higgsfield: "Higgsfield" });

// A model's own name without its service: "Nano Banana Pro on Runway" -> "Nano Banana Pro"; an id the table does not
// know, as plain text.
export function modelWords(model) {
  const row = rowOf(model);
  if (row === null) return plain(model, 80);
  return row.words.replace(/ on (Runway|Higgsfield)$/, "");
}

// Which models fit each of the owner's four choices: the kinds a model must make.
export const CHOICE_KINDS = Object.freeze({
  video: ["image_to_video"],
  videoBest: ["image_to_video", "text_to_video"],
  still: ["still_variation"],
  upscale: ["still_upscale"],
});
export const MODEL_FIELDS = Object.freeze(Object.keys(CHOICE_KINDS));

// What one second of a clip or one picture costs with this row, in cents, as the door prices the Artist's work (a
// Higgsfield row at its largest size and the owner's rate, rounded up); null without a price.
function unitCents(row, rate) {
  const p = row.price;
  if (p === null) return null;
  const base = p.byResolution === null ? p.credits : p.byResolution[topSize(row)];
  if (typeof base !== "number" || !Number.isFinite(base)) return null;
  if (row.provider === "runway") return Math.ceil(base);
  return rateOk(rate) ? Math.ceil(Math.round(base * rate * 1e6) / 1e6) : null;
}

// The model with its service and its price in dollars: "Gen-4 Turbo on Runway: $0.05 a second". A Higgsfield price
// is "about" (its credits turned into cents at the owner's rate): "FLUX.2 Max on Higgsfield: about $0.20 a picture".
export function priceWords(model, { centsPerCredit = DEFAULT_CENTS_PER_CREDIT } = {}) {
  const row = rowOf(model);
  if (row === null) return `${plain(model, 80)}: no price`;
  const c = unitCents(row, centsPerCredit);
  if (c === null) return `${row.words}: no price`;
  return `${row.words}: ${row.provider === "higgsfield" ? "about " : ""}${dollars(c)} a ${row.price.per}`;
}

// { video, videoBest, still, upscale: [ { model, provider, words } ] }: the models the door prices for the Artist for
// each choice: step 3's five Runway models, and the priced Higgsfield rows only while `higgsfield` is true (the switch
// on and signed in).
export function modelChoices({ centsPerCredit = DEFAULT_CENTS_PER_CREDIT, higgsfield = false } = {}) {
  const ids = [...Object.keys(PRICES), ...(higgsfield ? ROWS.filter((r) => r.provider === "higgsfield").map((r) => r.id) : [])];
  const out = {};
  for (const [field, kinds] of Object.entries(CHOICE_KINDS)) {
    out[field] = ids
      .filter((m) => {
        const row = rowOf(m);
        return row !== null && kinds.every((k) => row.kinds.includes(k)) && unitCents(row, centsPerCredit) !== null;
      })
      .map((model) => ({ model, provider: providerOf(model), words: priceWords(model, { centsPerCredit }) }));
  }
  return out;
}

// What a film of six 5-second clips costs with the model chosen for clips, with one retake each, in dollars.
export function exampleSentence(models, { centsPerCredit = DEFAULT_CENTS_PER_CREDIT } = {}) {
  const one = priceCents({ kind: "image_to_video", model: models.video, seconds: 5 }, { centsPerCredit });
  if (one === null) return `The door has no price for ${plain(models.video, 80)}, the model chosen in Settings.`;
  const c = one * 6;
  return `A 30-second film of six clips costs about ${dollars(c)}, up to ${dollars(2 * c)} with one retake each.`;
}

// A job's kind in words: "Clip, 5 s", "Clip from words, 5 s", "Variation", "Larger still".
export function kindWords(kind, seconds) {
  const s = typeof seconds === "number" && Number.isFinite(seconds) ? `, ${seconds} s` : "";
  if (kind === "image_to_video") return `Clip${s}`;
  if (kind === "text_to_video") return `Clip from words${s}`;
  if (kind === "still_variation") return "Variation";
  if (kind === "still_upscale") return "Larger still";
  return "Other";
}

// A job of summarize() in words, by its end line's verdict; a job with no end line is still counted. A Higgsfield
// job's refusals name Higgsfield (`provider` from the ledger's lines; missing is Runway).
export function resultWords(job, provider = "runway") {
  if (!job || !job.end) return RUNNING_WORDS;
  const v = job.end.verdict;
  if (typeof v === "string" && /^not_started_[0-9]{1,3}$/.test(v)) return NOT_STARTED_WORDS;
  if (typeof v === "string" && Object.hasOwn(RESULT_WORDS, v)) {
    return provider === "higgsfield" ? RESULT_WORDS[v].replace("Runway", "Higgsfield") : RESULT_WORDS[v];
  }
  return job.end.state === "released" ? NOT_STARTED_WORDS : RESULT_WORDS.unknown;
}

// An app's job in words: "Render to Film: picture, Nano Banana Pro", "Render to Film: clip, 5 s, Kling 3.0 Pro".
export function appJobWords(name, kind, seconds, model) {
  const s = typeof seconds === "number" && Number.isFinite(seconds) ? `, ${seconds} s` : "";
  const what = kind === "image_to_video" ? `clip${s}` : kind === "text_to_video" ? `clip from words${s}`
    : kind === "still_variation" ? "picture" : kind === "still_upscale" ? "larger picture" : "other";
  return `${plain(name, 40)}: ${what}, ${modelWords(model)}`;
}

// The names of the apps in App Studio by slug, from their manifests (engine/apps/manifest.mjs); none when the apps
// folder cannot be read. A slug with no good manifest is named by its slug.
export function appNames(config) {
  const out = new Map();
  try {
    for (const e of readManifests(config)) if (e && e.ok && e.app) out.set(e.app.slug, plain(e.app.name, 40));
  } catch { /* no names: each app is named by its slug */ }
  return out;
}

// ---- the ledger ----------------------------------------------------------------------------------------------

// The door's ledger as Settings shows it: { file: { ok, bytes, nearlyFull, sentence }, lines (null when it cannot
// be read) }.
export function readLedgerFile(config) {
  const path = config.paths.ledger;
  let bytes = 0;
  try {
    const st = lstatSync(path);
    if (st.isFile()) bytes = st.size;
  } catch { bytes = 0; }
  const r = readLedger(path);
  const nearlyFull = bytes > LEDGER_NEARLY_FULL;
  const sentence = !r.ok ? LEDGER_SENTENCES.unreadable : nearlyFull ? LEDGER_SENTENCES.nearlyFull : null;
  return { file: { ok: r.ok, bytes, nearlyFull, sentence }, lines: r.ok ? r.lines : null };
}

// Today's and this month's money as the door counts it, what is left under the owner's caps, and whether the door
// is paused. `lines` null (the ledger cannot be read): nothing is known and nothing is left. `resumedAt` (ms or null)
// is the owner's last "Start again", read as the door reads it; `ownPause` is the switches file's own `paused`.
// -> { spent: { ok, day, month, dayLeft, monthLeft, running }, paused: null | { at, sentence } }
export function moneyOf(lines, now, { daily, monthly, resumedAt = null, ownPause = false }) {
  const own = ownPause ? { at: null, sentence: OWN_PAUSE_SENTENCE } : null;
  if (lines === null) {
    return { spent: { ok: false, day: null, month: null, dayLeft: 0, monthLeft: 0, running: null }, paused: own };
  }
  const t = totalsOf(lines, now, { resumedAt });
  let paused = own;
  if (t.paused) {
    let at = -Infinity;
    for (const l of lines) {
      const ms = l.state === "paused" ? Date.parse(l.at) : NaN;
      if (ms > at && (resumedAt === null || ms > resumedAt)) at = ms;
    }
    paused = { at: Number.isFinite(at) ? isoTime(at) : null, sentence: PAUSED_SENTENCE };
  }
  return {
    spent: {
      ok: true,
      day: t.day,
      month: t.month,
      dayLeft: Math.max(0, daily - t.day),
      monthLeft: Math.max(0, monthly - t.month),
      running: t.open.length,
    },
    paused,
  };
}

// A calendar day as YYYY-MM-DD that exists.
export const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`))
  && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

// One page of what was spent: the 14 newest days with jobs before `before` (YYYY-MM-DD, or all), newest first, each
// with its credits, jobs and refusals, and at most 200 of its jobs, newest first. A job belongs to the day it was
// reserved, as the door counts it. `taskOf(batch)` -> { id, identifier } or null. Each row names its service
// (`provider`, Runway for old lines) and, for an app's job, the app (`app` { slug, name }, its words the app's name).
// `appNames` is Map(slug -> name).
export function ledgerPage(lines, { before = null, taskOf = () => null, appNames = new Map() } = {}) {
  const { jobs } = summarize(lines);
  const extras = extrasByJob(lines);
  const appOf = (j) => {
    const e = extras.get(j.job);
    const slug = e && typeof e.app === "string" ? e.app
      : typeof j.slug === "string" && /^app-[a-z0-9][a-z0-9-]{0,23}$/.test(j.slug) ? j.slug.slice(4) : null;
    return slug === null ? null : { slug, name: appNames.get(slug) || slug };
  };
  const byDay = new Map();
  for (const j of jobs.values()) {
    const day = dayOf(j.at);
    if (before !== null && !(day < before)) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(j);
  }
  const all = [...byDay.keys()].sort().reverse();
  const days = all.slice(0, LEDGER_PAGE_DAYS).map((day) => {
    const list = byDay.get(day).slice().reverse();
    list.sort((a, b) => b.at - a.at);
    return {
      day,
      credits: list.reduce((s, j) => s + j.charge, 0),
      jobs: list.length,
      refused: list.filter((j) => j.end && j.end.verdict === "refused").length,
      rows: list.slice(0, LEDGER_DAY_ROWS).map((j) => {
        const provider = extras.get(j.job)?.provider || "runway";
        const app = appOf(j);
        return {
          at: isoTime(j.at),
          kind: plain(j.kind, 40),
          words: app ? appJobWords(app.name, j.kind, j.seconds, j.model) : kindWords(j.kind, j.seconds),
          model: plainOrNull(j.model, 80),
          seconds: typeof j.seconds === "number" ? j.seconds : null,
          credits: j.charge,
          provider,
          app,
          result: resultWords(j, provider),
          shot: plainOrNull(j.shot, 32),
          task: j.batch === null || app ? null : taskOf(j.batch),
        };
      }),
    };
  });
  return { days, more: all.length > LEDGER_PAGE_DAYS };
}

// What each batch has cost so far, from the ledger's jobs of that batch: Map(batch -> credits).
export function spentByBatch(lines) {
  const out = new Map();
  for (const j of summarize(lines).jobs.values()) {
    if (typeof j.batch === "string") out.set(j.batch, (out.get(j.batch) || 0) + j.charge);
  }
  return out;
}

// ---- the owner's batches -------------------------------------------------------------------------------------

const timeOf = (v) => (typeof v === "string" && v.length <= 40 ? Date.parse(v) : NaN);

// One batch file, read with the trust rule (this user's plain file, not a link, at most 16 KB) and checked as the
// door's readBatch checks its shape, but not against today: { id, task, slug, approvedAt, expiresAt (ms), budget,
// shots (how many), textToVideo } or null. `task` is the goal's id, or null when the file names none.
export function readBatchFile(dir, id) {
  if (typeof id !== "string" || !ID_RE.test(id)) return null;
  const text = readTrustedText(join(dir, `${id}.json`), BATCH_MAX_BYTES);
  if (typeof text !== "string" || text === "missing") return null;
  let v;
  try { v = JSON.parse(text); } catch { return null; }
  if (!obj(v) || v.id !== id || typeof v.slug !== "string") return null;
  const approved = timeOf(v.approvedAt);
  const expires = timeOf(v.expiresAt);
  if (!Number.isFinite(approved) || !Number.isFinite(expires)) return null;
  if (expires <= approved || expires - approved > BATCH_DAYS * DAY_MS + 60_000) return null;
  if (typeof v.budgetCredits !== "number" || !Number.isFinite(v.budgetCredits) || v.budgetCredits < 0) return null;
  if (v.textToVideo !== undefined && typeof v.textToVideo !== "boolean") return null;
  if (v.frozen !== undefined && typeof v.frozen !== "boolean") return null;
  if (!obj(v.shots)) return null;
  let shots = 0;
  for (const [name, s] of Object.entries(v.shots)) {
    if (!SHOT_RE.test(name) || !obj(s) || !KINDS.includes(s.kind) || typeof s.model !== "string") return null;
    if (!Number.isInteger(s.takes) || s.takes < 1 || s.takes > MAX_TAKES) return null;
    if (VIDEO_KINDS.includes(s.kind) && !(Number.isInteger(s.maxSeconds) && s.maxSeconds >= MIN_SECONDS && s.maxSeconds <= MAX_SECONDS)) return null;
    shots += 1;
  }
  return {
    id, task: typeof v.task === "string" && TASK_ID.test(v.task) ? v.task : null, slug: v.slug,
    approvedAt: approved, expiresAt: expires, budget: v.budgetCredits, shots, textToVideo: v.textToVideo === true,
  };
}

// Every batch in `config.paths.batches` (a folder of ours, not a link) that is kept: until 30 days past its expiry.
// Newest approval first.
export function readBatches(config, now) {
  const dir = config.paths.batches;
  if (typeof dir !== "string" || !trustedFolder(dir)) return [];
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names.sort().slice(0, BATCH_FILES_READ)) {
    const m = BATCH_FILE.exec(name);
    if (!m) continue;
    const b = readBatchFile(dir, m[1]);
    if (b && b.expiresAt + BATCH_KEEP_DAYS * DAY_MS >= now) out.push(b);
  }
  return out.sort((a, b) => b.approvedAt - a.approvedAt || (a.id < b.id ? -1 : 1));
}

// A batch as Settings lists it. `spent` is null when the ledger cannot be read; `open` is whether the door would
// still take a job of it by its dates.
export function batchView(b, { spent, task, now }) {
  return {
    id: b.id,
    task,
    approvedAt: isoTime(b.approvedAt),
    expiresAt: isoTime(b.expiresAt),
    budget: b.budget,
    spent,
    shots: b.shots,
    open: b.approvedAt <= now + 60_000 && b.expiresAt > now,
  };
}
