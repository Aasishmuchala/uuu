// The Art director's review (PLAN-V5 K8): its comment, read in linear time, never trusted for the bar.
// The comment is an agent's words, so: only a comment the board says the Art director wrote counts (its
// author id, as lib/staged.mjs isCheck does for the Checker; never anything in the text), at most 1 MB of it
// is read, a line over 4000 characters is skipped, every number is checked (whole, 0 to 10, each of the seven
// axes exactly once), and whether a piece "meets the bar" is worked out here from the numbers, never taken
// from the Art director's own PASS or FAIL. A reason is one line of plain text, at most 200 characters.
// Nothing here throws, and no regular expression here can backtrack: lines are split, then cut at fixed
// characters.
//
// parseReview(body) -> { outcome: "pass"|"fail"|null, round, pieces: [{ id, scores, total, meets, reason }],
//                        seen, wellFormed, problems: [sentence] }
// reviewsOf(comments, artDirectorId) -> [parseReview(...) + { commentId, at }], oldest first.

export const AXES = ["brand", "hierarchy", "composition", "finish", "idea", "voice", "kind"];
export const OUT_OF = 70;
export const BAR_TOTAL = 52;
export const BAR_AXIS = 6;
export const PIECE_IDS = ["a", "b", "c", "piece"];
export const MAX_READ = 1024 * 1024;
export const MAX_LINE = 4000;
export const MAX_REASON = 200;
const MAX_PROBLEMS = 10;
const MAX_REVIEWS = 20;
const MAX_ROUND = 99;

// A reason as the owner reads it: control and format characters (a bidi override) become spaces, white
// space collapsed, at most 200 characters (whole characters, never half of a pair).
export function reasonText(s) {
  if (typeof s !== "string") return "";
  const t = s.slice(0, MAX_LINE).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(t);
  return chars.length > MAX_REASON ? `${chars.slice(0, MAX_REASON - 1).join("").trimEnd()}…` : t;
}

// "PASS" or "FAIL" at the start of s (after spaces), as "pass" / "fail"; else null.
function verdictWord(s) {
  const t = s.trimStart();
  const w = t.slice(0, 4).toUpperCase();
  if (w !== "PASS" && w !== "FAIL") return null;
  const next = t.charCodeAt(4);
  // The word must end there: "PASSED" is not a verdict.
  if (!Number.isNaN(next) && ((next >= 65 && next <= 90) || (next >= 97 && next <= 122))) return null;
  return w.toLowerCase();
}

const isDigits = (s) => s.length > 0 && s.length <= 2 && [...s].every((c) => c >= "0" && c <= "9");

// "a: brand 8, hierarchy 7, ...; reason" -> { id, scores, total, meets, reason } | { problem } | null (not a piece line)
function pieceLine(line) {
  const colon = line.indexOf(":");
  if (colon < 1 || colon > 5) return null;
  const id = line.slice(0, colon).trim();
  if (!PIECE_IDS.includes(id)) return null;
  const rest = line.slice(colon + 1);
  const semi = rest.indexOf(";");
  const scoresPart = semi < 0 ? rest : rest.slice(0, semi);
  const reason = semi < 0 ? "" : reasonText(rest.slice(semi + 1));
  const scores = {};
  const items = scoresPart.split(",");
  if (items.length > AXES.length) return { id, problem: `Piece ${id} gives more than seven scores, so its scores do not count.` };
  for (const raw of items) {
    const item = raw.trim();
    const sp = item.indexOf(" ");
    const axis = sp < 0 ? item : item.slice(0, sp);
    const num = sp < 0 ? "" : item.slice(sp + 1).trim();
    if (!AXES.includes(axis)) return { id, problem: `Piece ${id} has a score that is not one of the seven, so its scores do not count.` };
    if (Object.hasOwn(scores, axis)) return { id, problem: `Piece ${id} scores ${axis} twice, so its scores do not count.` };
    if (!isDigits(num) || Number(num) > 10) return { id, problem: `Piece ${id} gives ${axis} a score that is not a whole number from 0 to 10, so its scores do not count.` };
    scores[axis] = Number(num);
  }
  const missing = AXES.filter((a) => !Object.hasOwn(scores, a));
  if (missing.length) return { id, problem: `Piece ${id} has no score for ${missing.join(", ")}, so its scores do not count.` };
  const ordered = Object.fromEntries(AXES.map((a) => [a, scores[a]]));
  const total = AXES.reduce((n, a) => n + scores[a], 0);
  // K8: every axis at least 6 and at least 52 of 70, from the numbers alone.
  const meets = total >= BAR_TOTAL && AXES.every((a) => scores[a] >= BAR_AXIS);
  return { id, scores: ordered, total, meets, reason };
}

// "# Art review: round 2" -> 2, else null.
function roundOf(line) {
  const PREFIX = "# art review: round";
  if (line.length > 40 || line.slice(0, PREFIX.length).toLowerCase() !== PREFIX) return null;
  const n = line.slice(PREFIX.length).trim();
  return isDigits(n) && Number(n) >= 1 && Number(n) <= MAX_ROUND ? Number(n) : null;
}

export function parseReview(body) {
  const out = { outcome: null, round: null, pieces: [], seen: 0, wellFormed: false, problems: [] };
  const problem = (s) => { if (out.problems.length < MAX_PROBLEMS && !out.problems.includes(s)) out.problems.push(s); };
  try {
    if (typeof body !== "string" || !body) { problem("The review is empty."); return out; }
    if (body.length > MAX_READ) problem("The review is longer than 1 MB; only its first 1 MB was read.");
    const lines = body.slice(0, MAX_READ).split("\n");
    let first = null;
    let last = null;
    let section = null;
    let skipped = 0;
    const ids = new Set();
    for (let i = 0; i < lines.length; i += 1) {
      let line = lines[i];
      if (line.length > MAX_LINE) { skipped += 1; continue; }
      if (line.endsWith("\r")) line = line.slice(0, -1);
      const t = line.trim();
      if (!t) continue;
      if (first === null) { first = t; continue; }
      last = t;
      if (t.startsWith("## ")) { section = t.slice(3).trim().toLowerCase(); continue; }
      if (t.startsWith("# ")) {
        const r = roundOf(t);
        if (r !== null && out.round === null) out.round = r;
        section = null;
        continue;
      }
      if (section === "pieces") {
        const p = pieceLine(t);
        if (!p) continue;
        if (ids.has(p.id)) { problem(`Piece ${p.id} is scored twice; only the first counts.`); continue; }
        ids.add(p.id);
        if (p.problem) { problem(p.problem); continue; }
        out.pieces.push(p);
      } else if (section === "seen" && t.startsWith("- ") && t.length > 2) {
        out.seen += 1;
      }
    }
    if (skipped) problem("Some lines are longer than 4000 characters and were skipped.");
    const opening = first !== null && first.startsWith("REVIEW:") ? verdictWord(first.slice(7)) : null;
    const closing = last !== null && last.startsWith("Review:") ? verdictWord(last.slice(7)) : null;
    if (!opening) problem('The review does not start with "REVIEW: PASS" or "REVIEW: FAIL".');
    if (!closing) problem('The review does not end with "Review: PASS" or "Review: FAIL".');
    if (opening && closing && opening !== closing) problem("The review's first and last lines disagree.");
    out.outcome = opening && (!closing || closing === opening) ? opening : null;
    if (out.round === null) problem('The review has no line "# Art review: round <n>".');
    if (!out.pieces.length) problem("The review scores no piece.");
    if (!out.seen) problem("Nothing is written under Seen, so the scores do not count.");
    const mixed = ids.has("piece") && ids.size > 1;
    if (mixed) problem('The review scores "piece" and versions together.');
    out.wellFormed = !!opening && closing === opening && out.round !== null && out.pieces.length > 0 && out.seen > 0
      && !mixed && out.problems.length === 0;
  } catch {
    out.wellFormed = false;
    problem("The review could not be read.");
  }
  return out;
}

// True when this comment is an Art director's review: the board says the Art director wrote it (author id),
// and it starts "REVIEW:". With no Art director set up, nothing is.
export function isReview(comment, artDirectorId) {
  if (typeof artDirectorId !== "string" || !artDirectorId) return false;
  if (!comment || typeof comment !== "object" || comment.authorAgentId !== artDirectorId) return false;
  return typeof comment.body === "string" && comment.body.slice(0, 64).trimStart().startsWith("REVIEW:");
}

// Every review in a task's comments (oldest first), at most the newest 20, each with the comment's id and
// the board's own time.
export function reviewsOf(comments, artDirectorId) {
  const out = [];
  try {
    const list = Array.isArray(comments) ? comments : [];
    for (let i = list.length - 1; i >= 0 && out.length < MAX_REVIEWS; i -= 1) {
      const c = list[i];
      if (!isReview(c, artDirectorId)) continue;
      out.push({ ...parseReview(c.body), commentId: typeof c.id === "string" ? c.id : null, at: typeof c.createdAt === "string" ? c.createdAt : null });
    }
  } catch { /* what was read stands */ }
  return out.reverse();
}

// A piece's review as the pieces route shows it (K9), or null.
export function reviewView(piece) {
  if (!piece) return null;
  return { scores: { ...piece.scores }, total: piece.total, of: OUT_OF, meets: piece.meets, reason: piece.reason };
}
