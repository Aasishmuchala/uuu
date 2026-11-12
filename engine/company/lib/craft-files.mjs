// Reads the craft files in engine/company/brand/ (CONTRACTS-V5 K7, K9): directions.json,
// timing.json, filler.json and craft.json, and does the two small pieces of arithmetic that go
// with them: which directions a round uses and how long a job takes. The loaders of the three
// plain files throw one plain sentence; `loadCraft` never throws, it leaves a bad entry out and
// says why. Nothing here touches the board or the network.
import { lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BRAND = join(dirname(fileURLToPath(import.meta.url)), "..", "brand");
const MAX_BYTES = 256 * 1024;

export const KINDS = ["post", "newsletter", "carousel", "poster", "title-card", "film", "page"];
export const SIZES = ["XS", "S", "M", "L", "XL"];
const ID = /^[a-z][a-z0-9-]{0,29}$/;
const PLAYBOOK = /^[a-z0-9][a-z0-9-]{0,39}$/;
const REF = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;

function fail(file, what) {
  throw new Error(`${file}: ${what}.`);
}

function readJson(file, label) {
  let st;
  try { st = lstatSync(file); } catch { fail(label, "the file is missing"); }
  if (!st.isFile()) fail(label, "it is not a plain file");
  if (st.size > MAX_BYTES) fail(label, "the file is too large");
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { fail(label, "the file is not valid JSON"); }
}

const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

// ---- directions.json ----

export function loadDirections(file = join(BRAND, "directions.json")) {
  const L = "directions.json";
  const doc = readJson(file, L);
  if (!isObject(doc) || doc.version !== 1) fail(L, 'it must be an object with "version" 1');
  if (!isObject(doc.kinds) || !Object.keys(doc.kinds).length) fail(L, 'it needs a "kinds" object');
  const kinds = {};
  for (const [kind, list] of Object.entries(doc.kinds)) {
    if (!Array.isArray(list) || list.length < 3) fail(L, `the kind "${kind}" needs a list of at least three directions`);
    const seen = new Set();
    kinds[kind] = list.map((d) => {
      if (!isObject(d) || !ID.test(d.id ?? "")) fail(L, `a direction of "${kind}" has no usable id`);
      if (seen.has(d.id)) fail(L, `the direction "${d.id}" is listed twice for "${kind}"`);
      seen.add(d.id);
      if (typeof d.title !== "string" || !d.title.trim() || d.title.length > 40) fail(L, `the direction "${d.id}" needs a short title`);
      if (typeof d.what !== "string" || !d.what.trim() || d.what.length > 300) fail(L, `the direction "${d.id}" needs a sentence in "what"`);
      return { id: d.id, title: d.title, what: d.what };
    });
  }
  const alias = {};
  if (doc.alias !== undefined) {
    if (!isObject(doc.alias)) fail(L, '"alias" must be an object');
    for (const [from, to] of Object.entries(doc.alias)) {
      if (typeof to !== "string" || !kinds[to]) fail(L, `the alias "${from}" points at a kind that is not listed`);
      alias[from] = to;
    }
  }
  return { version: 1, kinds, alias };
}

let cached = null;
function directions() {
  if (!cached) cached = loadDirections();
  return cached;
}

// The directions of a kind (an alias such as "newsletter" gives its kind's list); [] for no such kind.
export function directionsFor(kind) {
  const d = directions();
  const k = d.kinds[kind] ? kind : d.alias[kind];
  return k && d.kinds[k] ? d.kinds[k].map((x) => ({ ...x })) : [];
}

// K7: round 1 uses the first three, except that a direction the owner picked before (`kept`) stays
// and the other two are the first others in the list. Later rounds use directions not yet used;
// with fewer than three left, the highest-scored earlier direction is done again (marked `again`).
// `used` is a list of ids in the order used, or of { id, total } so the best can be told.
export function pickDirections({ kind, used = [], kept = null } = {}) {
  const all = directionsFor(kind);
  if (all.length < 3) return [];
  const usedIds = (Array.isArray(used) ? used : []).map((u) => (typeof u === "string" ? u : u?.id)).filter(Boolean);
  if (!usedIds.length) {
    const keep = kept && all.find((d) => d.id === kept);
    if (!keep) return all.slice(0, 3);
    const first = all.slice(0, 3);
    if (first.some((d) => d.id === keep.id)) return first;
    return [keep, ...all.filter((d) => d.id !== keep.id).slice(0, 2)];
  }
  const fresh = all.filter((d) => !usedIds.includes(d.id));
  if (fresh.length >= 3) return fresh.slice(0, 3);
  // Highest total wins; a tie, or no totals, goes to the earliest used.
  let best = null;
  let bestTotal = -Infinity;
  for (const u of used) {
    const id = typeof u === "string" ? u : u?.id;
    const d = all.find((x) => x.id === id);
    if (!d) continue;
    const t = typeof u?.total === "number" ? u.total : -1;
    if (t > bestTotal) { best = d; bestTotal = t; }
  }
  const again = [];
  const pool = fresh.slice();
  if (best) again.push({ ...best, again: true });
  for (const d of all) {
    if (pool.length + again.length >= 3) break;
    if (!pool.includes(d) && !again.some((a) => a.id === d.id)) again.push({ ...d, again: true });
  }
  return [...pool, ...again].slice(0, 3);
}

// ---- timing.json ----

export function loadTiming(file = join(BRAND, "timing.json")) {
  const L = "timing.json";
  const t = readJson(file, L);
  if (!isObject(t)) fail(L, "it must be an object");
  const num = (v, key, lo, hi) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) fail(L, `"${key}" must be a number from ${lo} to ${hi}`);
    return v;
  };
  if (!isObject(t.step)) fail(L, '"step" must give a number of minutes for each size');
  const step = {};
  for (const s of SIZES) step[s] = num(t.step[s], `step.${s}`, 0, 600);
  return {
    plan: num(t.plan, "plan", 0, 600), step,
    extraVariantShare: num(t.extraVariantShare, "extraVariantShare", 0, 5),
    artReview: num(t.artReview, "artReview", 0, 600),
    artReviewExtraShare: num(t.artReviewExtraShare, "artReviewExtraShare", 0, 5),
    check: num(t.check, "check", 0, 600),
  };
}

const roundTo5 = (n) => Math.max(5, Math.round(n / 5) * 5);

// K9: minutes = plan (size M or larger) + step[size] x agents x (1 + share x (versions - 1))
// + (art review ? artReview x (1 + reviewShare x (versions - 1)) : 0) + check.
export function estimateMinutes({ size, who = 1, versions = 1, review = false, timing } = {}) {
  const t = timing ?? loadTiming();
  const step = t.step[size];
  if (step === undefined) throw new Error(`The size "${size}" is not one of ${SIZES.join(", ")}.`);
  const agents = Math.max(1, Array.isArray(who) ? who.length : Number.isFinite(who) ? Math.floor(who) : 1);
  const v = versions === 3 ? 3 : 1;
  const art = review === true || review === "art";
  const minutes = (SIZES.indexOf(size) >= SIZES.indexOf("M") ? t.plan : 0)
    + step * agents * (1 + t.extraVariantShare * (v - 1))
    + (art ? t.artReview * (1 + t.artReviewExtraShare * (v - 1)) : 0)
    + t.check;
  const low = roundTo5(0.8 * minutes);
  const high = roundTo5(1.5 * minutes);
  return { minutes, low, high, words: `About ${low} to ${high} minutes` };
}

// ---- filler.json ----

export function loadFiller(file = join(BRAND, "filler.json")) {
  const L = "filler.json";
  const f = readJson(file, L);
  if (!isObject(f)) fail(L, "it must be an object");
  const out = {};
  const all = new Set();
  for (const [key, min] of [["hard", 40], ["soft", 30]]) {
    const list = f[key];
    if (!Array.isArray(list)) fail(L, `"${key}" must be a list`);
    if (list.length < min) fail(L, `"${key}" needs at least ${min} phrases`);
    for (const p of list) {
      if (typeof p !== "string" || p.length < 2 || p.length > 60) fail(L, `every phrase must be 2 to 60 characters (see "${String(p).slice(0, 30)}")`);
      if (p !== p.toLowerCase()) fail(L, `the phrase "${p}" must be lower case`);
      if (all.has(p)) fail(L, `the phrase "${p}" is listed twice`);
      all.add(p);
    }
    out[key] = list.slice();
  }
  return out;
}

// ---- craft.json ----

// Returns { jobs: Map(ref -> craft), problems }. A missing file is an empty map. An entry that
// breaks a rule is left out and named in one plain sentence. Whether a playbook is in the
// manifest is not checked here.
export function loadCraft(file = join(BRAND, "craft.json"), jobRefs = []) {
  const jobs = new Map();
  const problems = [];
  let st;
  try { st = lstatSync(file); } catch { return { jobs, problems }; }
  let doc;
  if (!st.isFile() || st.size > MAX_BYTES) return { jobs, problems: ["craft.json is not a plain file of a usable size."] };
  try { doc = JSON.parse(readFileSync(file, "utf8")); } catch { return { jobs, problems: ["craft.json is not valid JSON."] }; }
  if (!isObject(doc) || doc.version !== 1 || !isObject(doc.jobs)) {
    return { jobs, problems: ['craft.json must be an object with "version" 1 and a "jobs" object.'] };
  }
  const refs = new Set(jobRefs);
  for (const [ref, c] of Object.entries(doc.jobs)) {
    const at = `craft.json, "${String(ref).slice(0, 80)}"`;
    if (!REF.test(ref) || !refs.has(ref)) { problems.push(`${at}: no job has that name, so the entry is left out.`); continue; }
    if (!isObject(c)) { problems.push(`${at}: the entry must be an object, so it is left out.`); continue; }
    if (!KINDS.includes(c.kind)) { problems.push(`${at}: the kind must be one of ${KINDS.join(", ")}, so the entry is left out.`); continue; }
    if (c.review !== "art" && c.review !== "none") { problems.push(`${at}: review must be "art" or "none", so the entry is left out.`); continue; }
    if (c.variants !== 1 && c.variants !== 3) { problems.push(`${at}: variants must be 1 or 3, so the entry is left out.`); continue; }
    const pb = c.playbooks ?? [];
    if (!Array.isArray(pb)) { problems.push(`${at}: playbooks must be a list, so the entry is left out.`); continue; }
    if (pb.length > 4) { problems.push(`${at}: it names more than four playbooks, so the entry is left out.`); continue; }
    if (!pb.every((n) => typeof n === "string" && PLAYBOOK.test(n)) || new Set(pb).size !== pb.length) {
      problems.push(`${at}: a playbook name is not a plain name or is repeated, so the entry is left out.`); continue;
    }
    jobs.set(ref, { kind: c.kind, review: c.review, variants: c.variants, playbooks: pb.slice() });
  }
  return { jobs, problems };
}
