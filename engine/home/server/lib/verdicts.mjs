// The owner's verdicts on a finished task (M63 item 23): `verdicts:<task id>` in state/home/decisions.json, a list
// of { verdict, at, note }, one entry each time the owner accepts the task or sends it back. Written only by the
// home server, at the moment the owner acts (inbox/goals.mjs, routes/goals.mjs), so the recipe log can keep one row
// per verdict even after the task is redone. `note` is the owner's own words, cleaned by lib/owner-text.mjs and
// made one line; nothing an agent wrote is in a record.
import { ownerText } from "./owner-text.mjs";

export const ACCEPTED = "accepted";
export const SENT_BACK = "sent-back";
const KINDS = new Set([ACCEPTED, SENT_BACK]);
export const MAX_VERDICTS = 20;
export const NOTE_MAX = 300;

const key = (goalId) => `verdicts:${goalId}`;
const validTime = (t) => typeof t === "string" && Number.isFinite(Date.parse(t));

// The owner's note as one line: cleaned, white space collapsed, capped. "" when nothing is left.
export function noteLine(value) {
  const t = ownerText(typeof value === "string" ? value.slice(0, 20000) : "").replace(/\s+/g, " ").trim();
  return t.length > NOTE_MAX ? `${t.slice(0, NOTE_MAX - 1).trimEnd()}…` : t;
}

// verdictsOf(decisions, goalId) -> [{ verdict, at, note }], oldest first; anything malformed is left out.
export function verdictsOf(decisions, goalId) {
  const v = decisions && typeof decisions.get === "function" && goalId ? decisions.get(key(goalId)) : null;
  if (!Array.isArray(v)) return [];
  return v.filter((e) => e && typeof e === "object" && KINDS.has(e.verdict) && validTime(e.at))
    .slice(-MAX_VERDICTS)
    .map((e) => ({ verdict: e.verdict, at: e.at, note: typeof e.note === "string" && e.note ? e.note.slice(0, NOTE_MAX) : null }));
}

// recordVerdict(decisions, goalId, verdict, note?) -> the entry written. Never throws: the owner's action is done.
export function recordVerdict(decisions, goalId, verdict, note = null, { now = new Date() } = {}) {
  if (!KINDS.has(verdict) || typeof goalId !== "string" || !goalId || !decisions || typeof decisions.set !== "function") return null;
  const entry = { verdict, at: now.toISOString(), note: verdict === SENT_BACK ? noteLine(note) || null : null };
  try {
    decisions.set(key(goalId), [...verdictsOf(decisions, goalId), entry].slice(-MAX_VERDICTS));
  } catch { /* the action itself is done */ }
  return entry;
}
