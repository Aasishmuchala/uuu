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

// ---- the owner's answers to an agent's question on the board (M63 item 40)

// The board keeps an answer to a question card as a record of its own, not as a comment, so the task's conversation
// never showed it. The home server keeps the owner's words as sent, `owneranswers:<issue id>`: a list of { at, text },
// written when the owner answers (inbox/board.mjs), shown as the owner's own message in its place in time
// (routes/task.mjs). Nothing an agent wrote is in it: a choice the owner picked is not copied, since its label is
// the agent's word.
export const OWNER_ANSWER_MAX = 2000;
const OWNER_ANSWERS = 20;
export const PICKED = "You answered with one of the choices offered.";
const answersKey = (issueId) => `owneranswers:${issueId}`;

export function ownerAnswersOf(decisions, issueId) {
  const v = decisions && typeof decisions.get === "function" && issueId ? decisions.get(answersKey(issueId)) : null;
  return Array.isArray(v)
    ? v.filter((e) => e && typeof e.at === "string" && Number.isFinite(Date.parse(e.at)) && typeof e.text === "string" && e.text)
      .slice(-OWNER_ANSWERS).map((e) => ({ at: e.at, text: e.text.slice(0, OWNER_ANSWER_MAX) }))
    : [];
}

// recordOwnerAnswer(decisions, issueId, texts) -> the entry kept, or null. `texts`: the owner's typed answers (may be
// empty when the owner only picked choices). Never throws: the answer itself has been passed on.
export function recordOwnerAnswer(decisions, issueId, texts, { now = new Date() } = {}) {
  if (!decisions || typeof decisions.set !== "function" || typeof issueId !== "string" || !issueId) return null;
  const said = [...new Set((Array.isArray(texts) ? texts : []).map((t) => ownerText(typeof t === "string" ? t.slice(0, 20000) : "")).filter(Boolean))];
  let text = said.join("\n\n") || PICKED;
  if (text.length > OWNER_ANSWER_MAX) text = `${text.slice(0, OWNER_ANSWER_MAX - 1).trimEnd()}…`;
  const entry = { at: now.toISOString(), text };
  try { decisions.set(answersKey(issueId), [...ownerAnswersOf(decisions, issueId), entry].slice(-OWNER_ANSWERS)); } catch { /* passed on already */ }
  return entry;
}
