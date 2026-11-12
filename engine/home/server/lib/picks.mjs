// The owner's choices on a task's versions (PLAN-V5 K9): `pick:<goal id>` in state/home/decisions.json, a list
// of { round, variant, direction, note, at, action, versions, scores }, one entry each time the owner acts on a
// card of versions: "pick" (the pick is the acceptance), "another" (another round) or "back" (send all back).
// Written only by the home server, at the moment the owner acts (inbox/goals.mjs), from:
//   - the version the owner chose (a, b or c, one of those shown) and its direction's id, which the home server
//     checked against the repo's directions.json when it read variants.json (lib/variants.mjs);
//   - the versions shown, as ids, direction ids and the Art director's totals as numbers;
//   - the picked version's seven scores as numbers (worked out by lib/artreview.mjs, never its words);
//   - the owner's own note, through noteLine.
// No reason, file name or other word an agent wrote is kept. Entries stay in the record across rounds, at most
// ten. routes/jobs.mjs reads the newest entry that names a variant (the hand-on and the kept direction);
// lib/taste.mjs and lib/recipes.mjs read them all.
import { AXES } from "./artreview.mjs";
import { noteLine } from "./verdicts.mjs";
import { directionsFor } from "../../../company/lib/craft-files.mjs";

export const PICK = "pick";
export const ANOTHER = "another";
export const BACK = "back";
const ACTIONS = new Set([PICK, ANOTHER, BACK]);
export const MAX_ROUNDS = 10;
const VARIANT = /^[abc]$/;
const DIRECTION = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_ROUND = 99;

const key = (goalId) => `pick:${goalId}`;
const validTime = (t) => typeof t === "string" && t.length <= 40 && Number.isFinite(Date.parse(t));
const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const wholeIn = (n, lo, hi) => (Number.isInteger(n) && n >= lo && n <= hi ? n : null);

// The seven scores as whole numbers 0 to 10, or null unless all seven are there.
function cleanScores(s) {
  if (!isObject(s)) return null;
  const out = {};
  for (const a of AXES) {
    const n = wholeIn(s[a], 0, 10);
    if (n === null) return null;
    out[a] = n;
  }
  return out;
}

// The versions shown: [{ id, direction, total }], ids a to c once each, in that order.
function cleanVersions(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const v of list.slice(0, 3)) {
    if (!isObject(v) || !VARIANT.test(String(v.id)) || out.some((x) => x.id === v.id)) continue;
    out.push({
      id: v.id,
      direction: typeof v.direction === "string" && DIRECTION.test(v.direction) ? v.direction : null,
      total: wholeIn(v.total, 0, 70),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// One entry as kept, or null when it is malformed. An entry without `action` that names a variant is a pick.
function cleanEntry(e) {
  if (!isObject(e) || !validTime(e.at)) return null;
  const variant = typeof e.variant === "string" && VARIANT.test(e.variant) ? e.variant : null;
  const action = e.action === undefined && variant ? PICK : e.action;
  if (!ACTIONS.has(action)) return null;
  if (action === PICK && !variant) return null;
  const note = typeof e.note === "string" ? noteLine(e.note) || null : null;
  return {
    round: wholeIn(e.round, 1, MAX_ROUND),
    variant: action === PICK ? variant : null,
    direction: action === PICK && typeof e.direction === "string" && DIRECTION.test(e.direction) ? e.direction : null,
    note,
    at: e.at,
    action,
    versions: cleanVersions(e.versions),
    scores: action === PICK ? cleanScores(e.scores) : null,
  };
}

// picksOf(decisions, goalId) -> the owner's choices on that task's versions, oldest first; malformed ones left out.
export function picksOf(decisions, goalId) {
  try {
    const v = decisions && typeof decisions.get === "function" && goalId ? decisions.get(key(goalId)) : null;
    const list = Array.isArray(v) ? v : isObject(v) ? [v] : [];
    return list.slice(-MAX_ROUNDS).map(cleanEntry).filter(Boolean);
  } catch {
    return [];
  }
}

// recordPick(decisions, goalId, { action, round, variant, direction, note, versions, scores }, { now }) -> the
// entry written, or null. Never throws: the owner's action is done.
export function recordPick(decisions, goalId, choice, { now = new Date() } = {}) {
  try {
    if (typeof goalId !== "string" || !goalId || !decisions || typeof decisions.set !== "function") return null;
    const c = isObject(choice) ? choice : {};
    const entry = cleanEntry({
      round: c.round, variant: c.variant, direction: c.direction, note: c.note ?? null,
      at: now.toISOString(), action: c.action, versions: c.versions, scores: c.scores,
    });
    if (!entry) return null;
    decisions.set(key(goalId), [...picksOf(decisions, goalId), entry].slice(-MAX_ROUNDS));
    return entry;
  } catch {
    return null;
  }
}

// A direction's title from the repo's directions.json for that kind, or null for one it does not list.
export function directionTitle(kind, id) {
  try {
    const d = directionsFor(kind).find((x) => x.id === id);
    return d ? d.title : null;
  } catch {
    return null;
  }
}
