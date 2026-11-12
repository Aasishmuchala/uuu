// What the owner types that becomes a task's text or title (POST /api/goals, POST /api/ask, the answers of
// POST /api/jobs/.../start), cleaned by one rule (S8 F2), and the question of an `ask:` record as it is shown.
// Agents read the task's text, so nothing in it may be unseen by the owner but readable by a model.
import { textOf } from "./staged.mjs";

// Control characters (tab and line feed are kept), and every character that shows nothing on its own: the
// Unicode formatting characters (zero-width spaces, word joiners, direction marks and overrides, the tag
// characters U+E0020 to U+E007F, the byte order mark, soft hyphens), the default-ignorable ones (fillers,
// variation selectors) and the blank U+2800. The zero-width joiner and non-joiner and the variation selector
// U+FE0F stay: Indic scripts and emoji need them.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const INVISIBLE = /(?![\u200C\u200D\uFE0F])[\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/gu;
const BREAKS = /\r\n?|\u2028|\u2029|\u0085/g;

// One string with the control and invisible characters taken out; nothing else changes.
export function stripInvisible(value) {
  return String(value ?? "").replace(CONTROL, "").replace(INVISIBLE, "");
}

// The owner's text for a task: every kind of line break made "\n", then stripInvisible, then trimmed.
// -> "" when nothing is left.
export function ownerText(value) {
  return typeof value === "string" ? stripInvisible(value.replace(BREAKS, "\n")).trim() : "";
}

// ---- the question of a question (CONTRACTS-V3 33.5, S8 F3)

// The time of an `ask:` record: a record is the time alone (made before S8) or { at, text }.
export function askedAt(record) {
  const at = typeof record === "string" ? record : record && typeof record === "object" ? record.at : null;
  return typeof at === "string" && Number.isFinite(Date.parse(at)) ? at : null;
}

// Said before the task's own text when a record holds no question: any agent can edit a task's text, so it is
// never shown as the owner's own words.
export const NOT_SAVED = "The task now reads: ";

// The question as it is shown everywhere (the answer panel, the card's title, the task page, the map):
// { text, saved }. The owner's words as saved in the record when it holds them; else the task's text now,
// with NOT_SAVED before it.
export function askedQuestion(record, goal, max = 2000) {
  if (record && typeof record === "object" && typeof record.text === "string" && record.text.trim()) {
    return { text: record.text.slice(0, max), saved: true };
  }
  const now = textOf(goal?.description || goal?.title || "").text || String(goal?.title || "");
  return { text: `${NOT_SAVED}${now}`.slice(0, max), saved: false };
}
