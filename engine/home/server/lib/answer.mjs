// The answer file of a question (CONTRACTS-V3 33.5): `answer.md`, written by the Chief of staff in the goal's
// folder, read as plain parts. Pure: no file or network access here.
//
//   # Answer
//   <the answer, citing sources as [1], [2]>
//   ## Sources
//   1. <path> - <note>
//   ## Not in the files
//   - <what the files did not say>   (or "None.")
//
// The file was written by an agent, so it is untrusted: parseAnswer accepts any value (anything that is not a
// string reads as ""), reads at most 64 KB of it, never throws and runs in time linear in its input. A source's
// path is only words here: whether it names one of the owner's files is decided by the caller from the brain's
// own listing, never from this file. Only the exact headings above count; any other line is text of the part
// it is in.

export const MAX_INPUT = 64 * 1024;
export const MAX_TEXT = 8000;        // characters of the answer
export const MAX_SOURCES = 12;
export const MAX_NOT_IN_FILES = 12;
const MAX_PATH = 300;                // characters of a source's path
const MAX_NOTE = 300;                // characters of a source's note, and of one "not in the files" line
const MAX_LINE = 2000;               // a longer line is never read as a source or a "not in the files" line
const MAX_PROBLEMS = 20;
const HEAD_ANSWER = "# Answer";
const HEAD_SOURCES = "## Sources";
const HEAD_NOT_IN = "## Not in the files";
const NOTHING = new Set(["none.", "none", "nothing.", "nothing"]);

const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

// Any value as at most 64 KB of text with "\n" line ends.
function clean(value) {
  let s = typeof value === "string" ? value : "";
  if (s.length > MAX_INPUT) s = s.slice(0, MAX_INPUT);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s.replace(/\r\n?/g, "\n");
}

// The answer's lines joined, blank lines squeezed to one, trimmed and cut to MAX_TEXT.
function joinText(lines, problems) {
  const out = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { if (out.length && out[out.length - 1] !== "") out.push(""); continue; }
    out.push(line);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  const text = out.join("\n").trim();
  if (text.length > MAX_TEXT) {
    problems.push("The answer is longer than 8000 characters; the rest is not shown.");
    return cut(text, MAX_TEXT);
  }
  return text;
}

// One line of the Sources part -> { n, path, note } or null. The line must match
// ^(\d{1,2})\.\s+(\S.*?)(?:\s+-\s+(.+))?$ ; the path ends at the first " - " that has something after it.
// Read without a backtracking pattern over the rest of the line, so it stays linear.
export function parseSourceLine(line) {
  if (typeof line !== "string" || line.length > MAX_LINE || line.includes("\n")) return null;
  const m = /^(\d{1,2})\.\s+(?=\S)/.exec(line);
  if (!m) return null;
  const rest = line.slice(m[0].length);
  const sep = /\s-\s./.exec(rest.slice(1));
  let path = rest;
  let note = "";
  if (sep) {
    const at = sep.index + 1;
    path = rest.slice(0, at);
    note = rest.slice(at).replace(/^\s*-\s*/, "").trim();
  }
  path = path.trim();
  if (!path) return null;
  return { n: Number(m[1]), path: cut(path, MAX_PATH), note: cut(note, MAX_NOTE) };
}

// A file that does not parse, as plain text: heading marks and [n] marks taken out, cut to MAX_TEXT.
function plainOf(s) {
  const lines = s.split("\n").map((l) => l.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/\[\d{1,2}\]/g, ""));
  return joinText(lines, []);
}

// parseAnswer(text) -> { text, sources: [{ n, path, note }], notInFiles: [string], wellFormed, problems }.
// `wellFormed` is false when there is no "# Answer" heading or the answer under it is empty; `text` is then the
// whole file as plain text, with no sources. `problems` are plain sentences about what was left out.
export function parseAnswer(input) {
  const s = clean(input);
  const problems = [];
  const note = (p) => { if (problems.length < MAX_PROBLEMS) problems.push(p); };
  const lines = s.split("\n");
  let part = null;                    // null (before "# Answer": not read), "answer", "sources", "notIn"
  let sawAnswer = false;
  let sawSources = false;
  const answerLines = [];
  const sources = [];
  const seen = new Set();
  const notInFiles = [];
  let fenced = false;
  let extraSources = 0;

  for (const raw of lines) {
    const t = raw.trim();
    if (t.startsWith("```")) fenced = !fenced;
    const heading = !fenced && raw.length <= MAX_LINE ? t : null;
    if (heading === HEAD_ANSWER && !sawAnswer) { part = "answer"; sawAnswer = true; continue; }
    if (heading === HEAD_SOURCES && sawAnswer && !sawSources) { part = "sources"; sawSources = true; continue; }
    if (heading === HEAD_NOT_IN && sawAnswer) { part = "notIn"; continue; }
    if (part === "answer") { answerLines.push(raw); continue; }
    if (part === "sources") {
      if (!t) continue;
      const src = parseSourceLine(t);
      if (!src) { note("A line under Sources is not a numbered source; it is left out."); continue; }
      if (seen.has(src.n)) { note(`Source ${src.n} is listed twice; only the first is kept.`); continue; }
      if (sources.length >= MAX_SOURCES) { extraSources += 1; continue; }
      seen.add(src.n);
      sources.push(src);
      continue;
    }
    if (part === "notIn") {
      if (!t || NOTHING.has(t.toLowerCase())) continue;
      if (t.length <= MAX_LINE && t.startsWith("- ")) {
        const item = t.slice(2).trim();
        if (item && notInFiles.length < MAX_NOT_IN_FILES) notInFiles.push(cut(item, MAX_NOTE));
        continue;
      }
      note("A line under Not in the files is not a list item; it is left out.");
    }
  }
  if (extraSources) note(`Only the first ${MAX_SOURCES} sources are kept.`);

  const text = sawAnswer ? joinText(answerLines, problems) : "";
  if (!sawAnswer || !text) {
    return {
      text: plainOf(s), sources: [], notInFiles: [], wellFormed: false,
      problems: [sawAnswer ? "The answer under # Answer is empty." : "There is no # Answer heading."],
    };
  }
  if (!sawSources) note("There is no Sources part.");
  return { text, sources, notInFiles, wellFormed: true, problems };
}
