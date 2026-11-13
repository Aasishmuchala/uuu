// The Art director's clip review (PLAN-V5 K14 step 4, C11): its comment on a film's clips, read in linear time and
// never trusted for more than it says. Only a comment the board says the Art director wrote counts (its author id,
// as lib/artreview.mjs does; never anything in the text), at most 1 MB of it is read, a line over 4000 characters is
// skipped, a clip is named only by a shot and a take of a film (s01-t1 to s12-t2: never a third take), and the
// outcome is worked out here from the clips' own lines (`retake` when any clip says retake), never taken from the
// first line. A reason is one line of plain text, at most 200 characters. Nothing here throws, and no regular
// expression here can backtrack: lines are split, then cut at fixed characters.
//
// The form (the model is section 7 of engine/company/roles/art-director.md):
//   CLIPS: KEEP - <reason>          or  CLIPS: RETAKE - <reason>
//   # Clip review: round <n>
//   ## Clips
//   s01-t1: keep; <reason>          or  s01-t1: retake; <reason>
//   ## Seen
//   - clips/s01-t1/frame-06.png: <what was seen>
//   Clips: KEEP                     or  Clips: RETAKE
//
// parseClipReview(body) -> { outcome: "keep"|"retake"|null, round, clips: [{ clip, verdict, reason }], seen,
//                            wellFormed, problems: [sentence] }
// clipReviewsOf(comments, artDirectorId) -> [parseClipReview(...) + { commentId, at }], oldest first.
import { MAX_LINE, MAX_READ, reasonText } from "./artreview.mjs";

export const CLIP_ID = /^s(0[1-9]|1[0-2])-t[12]$/;
export const VERDICTS = ["keep", "retake"];
const MARK = "CLIPS:";
const CLOSE = "Clips:";
const MAX_CLIPS = 48;
const MAX_PROBLEMS = 10;
const MAX_REVIEWS = 20;
const MAX_ROUND = 99;

const isDigits = (s) => s.length > 0 && s.length <= 2 && [...s].every((c) => c >= "0" && c <= "9");

// "KEEP" or "RETAKE" at the start of s (after spaces), as "keep" / "retake"; else null. The word must end there.
function outcomeWord(s) {
  const t = s.trimStart();
  for (const w of ["RETAKE", "KEEP"]) {
    if (t.slice(0, w.length).toUpperCase() !== w) continue;
    const next = t.charCodeAt(w.length);
    if (!Number.isNaN(next) && ((next >= 65 && next <= 90) || (next >= 97 && next <= 122))) return null;
    return w.toLowerCase();
  }
  return null;
}

// "# Clip review: round 2" -> 2, else null.
function roundOf(line) {
  const PREFIX = "# clip review: round";
  if (line.length > 40 || line.slice(0, PREFIX.length).toLowerCase() !== PREFIX) return null;
  const n = line.slice(PREFIX.length).trim();
  return isDigits(n) && Number(n) >= 1 && Number(n) <= MAX_ROUND ? Number(n) : null;
}

// "s01-t1: keep; the approach is steady" -> { clip, verdict, reason } | { clip, problem } | null (not a clip line).
function clipLine(line) {
  const colon = line.indexOf(":");
  if (colon < 1 || colon > 12) return null;
  const clip = line.slice(0, colon).trim();
  if (!CLIP_ID.test(clip)) return null;
  const rest = line.slice(colon + 1);
  const semi = rest.indexOf(";");
  const word = (semi < 0 ? rest : rest.slice(0, semi)).trim().toLowerCase();
  if (!VERDICTS.includes(word)) return { clip, problem: `Clip ${clip} is neither kept nor sent for a retake, so its line does not count.` };
  const reason = semi < 0 ? "" : reasonText(rest.slice(semi + 1));
  return { clip, verdict: word, reason };
}

export function parseClipReview(body) {
  const out = { outcome: null, round: null, clips: [], seen: 0, wellFormed: false, problems: [] };
  const problem = (s) => { if (out.problems.length < MAX_PROBLEMS && !out.problems.includes(s)) out.problems.push(s); };
  try {
    if (typeof body !== "string" || !body) { problem("The clip review is empty."); return out; }
    if (body.length > MAX_READ) problem("The clip review is longer than 1 MB; only its first 1 MB was read.");
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
      if (section === "clips") {
        const c = clipLine(t);
        if (!c) continue;
        if (ids.has(c.clip)) { problem(`Clip ${c.clip} is named twice; only the first counts.`); continue; }
        ids.add(c.clip);
        if (c.problem) { problem(c.problem); continue; }
        if (out.clips.length >= MAX_CLIPS) { problem(`The review names more than ${MAX_CLIPS} clips; the rest do not count.`); continue; }
        if (c.verdict === "retake" && !c.reason) problem(`Clip ${c.clip} is sent for a retake with no reason.`);
        out.clips.push(c);
      } else if (section === "seen" && t.startsWith("- ") && t.length > 2) {
        out.seen += 1;
      }
    }
    if (skipped) problem("Some lines are longer than 4000 characters and were skipped.");
    const opening = first !== null && first.startsWith(MARK) ? outcomeWord(first.slice(MARK.length)) : null;
    const closing = last !== null && last.startsWith(CLOSE) ? outcomeWord(last.slice(CLOSE.length)) : null;
    if (!opening) problem('The clip review does not start with "CLIPS: KEEP" or "CLIPS: RETAKE".');
    if (!closing) problem('The clip review does not end with "Clips: KEEP" or "Clips: RETAKE".');
    if (opening && closing && opening !== closing) problem("The clip review's first and last lines disagree.");
    if (out.round === null) problem('The clip review has no line "# Clip review: round <n>".');
    if (!out.clips.length) problem("The clip review names no clip.");
    if (!out.seen) problem("Nothing is written under Seen, so the verdicts do not count.");
    // The outcome is the clips' own: one retake makes it a retake, whatever the first line says.
    out.outcome = out.clips.length ? (out.clips.some((c) => c.verdict === "retake") ? "retake" : "keep") : null;
    if (out.outcome && opening && opening !== out.outcome) problem(`The first line says ${opening.toUpperCase()}, but the clips say ${out.outcome.toUpperCase()}.`);
    out.wellFormed = !!opening && closing === opening && opening === out.outcome && out.round !== null && out.seen > 0
      && out.problems.length === 0;
  } catch {
    out.wellFormed = false;
    problem("The clip review could not be read.");
  }
  return out;
}

// True when this comment is an Art director's clip review: the board says the Art director wrote it (author id),
// and it starts "CLIPS:". With no Art director set up, nothing is.
export function isClipReview(comment, artDirectorId) {
  if (typeof artDirectorId !== "string" || !artDirectorId) return false;
  if (!comment || typeof comment !== "object" || comment.authorAgentId !== artDirectorId) return false;
  return typeof comment.body === "string" && comment.body.slice(0, 64).trimStart().startsWith(MARK);
}

// Every clip review in a task's comments (oldest first), at most the newest 20, each with the comment's id and the
// board's own time.
export function clipReviewsOf(comments, artDirectorId) {
  const out = [];
  try {
    const list = Array.isArray(comments) ? comments : [];
    for (let i = list.length - 1; i >= 0 && out.length < MAX_REVIEWS; i -= 1) {
      const c = list[i];
      if (!isClipReview(c, artDirectorId)) continue;
      out.push({ ...parseClipReview(c.body), commentId: typeof c.id === "string" ? c.id : null, at: typeof c.createdAt === "string" ? c.createdAt : null });
    }
  } catch { /* what was read stands */ }
  return out.reverse();
}

// A review's verdicts count only when it names clips and says what was seen (as the art review's scores).
export const usableClipReview = (r) => !!r && r.clips.length > 0 && r.seen > 0;
