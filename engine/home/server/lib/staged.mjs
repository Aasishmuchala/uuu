// The staged way of working (CONTRACTS-V2 15, 16.2): pure parsers for the brief, the plan, the summary,
// the Checker's check and the markers in comments and task text. No file or network access here.
//
// Everything parsed was written by an agent, so it is untrusted: every function accepts any value
// (anything that is not a string reads as ""), reads at most 1 MB of it, never throws, and runs in time
// linear in its input. Headings inside a code fence are text, not headings, and only the exact headings
// of section 15 count (`### Steps`, ` ## Steps` or `## steps` are not `## Steps`). Lines longer than
// MAX_LINE characters are kept as text but never read as a step, a question or a verdict.
// Feature tasks import this module; they never edit it.

export const MARKERS = {
  size: "SIZE:",
  planReady: "PLAN READY:",
  planAccepted: "PLAN ACCEPTED",
  answer: "ANSWER:",
  stopped: "STOPPED:",
  result: "RESULT:",
  verdict: "VERDICT:",
  for: "FOR:",
  planFirst: "PLAN FIRST",
  routine: "ROUTINE:",
};
export const SIZES = ["XS", "S", "M", "L", "XL"];
export const ROUND_CAP = 5;

const MAX_INPUT = 1024 * 1024;
const MAX_LINE = 4000;
const MAX_ITEMS = 50;          // questions, actions, steps, problems kept
const MAX_EVIDENCE = 20;
const MAX_TEXT = 1000;         // characters of one question, action, reason or evidence path
const UNCLEAR = "Anything unclear";
const NOTHING = new Set(["none", "none.", "nothing", "nothing.", "no", "-", "n/a"]);
const BRIEF_HEADINGS = ["The goal in the owner's words", "What done looks like", "Must-haves", "Nice-to-haves", UNCLEAR];
const PLAN_HEADINGS = ["Approach", "What will be produced", "Steps", UNCLEAR];
const SUMMARY_HEADINGS = ["What was done", "Files", "What is left"];
const QUESTION_COUNT = 6;

// Any value as at most 1 MB of text with "\n" line ends; `cut` when it was longer.
function clean(value) {
  let s = typeof value === "string" ? value : "";
  const cut = s.length > MAX_INPUT;
  if (cut) s = s.slice(0, MAX_INPUT);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return { s: s.replace(/\r\n?/g, "\n"), cut };
}

const squeeze = (line) => (line.length > MAX_LINE ? null : line.replace(/\s+/g, " ").trim());
const short = (s) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s);

// Lines with whether each is inside a code fence (the fence lines themselves count as inside).
function fenced(lines) {
  const out = [];
  let open = null;
  for (const line of lines) {
    const m = line.length <= MAX_LINE ? /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line) : null;
    if (!open) {
      if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
        open = { ch: m[1][0], len: m[1].length };
        out.push({ line, inFence: true });
      } else {
        out.push({ line, inFence: false });
      }
    } else {
      out.push({ line, inFence: true });
      if (m && m[1][0] === open.ch && m[1].length >= open.len && !m[2].trim()) open = null;
    }
  }
  return out;
}

// The non-blank lines of a section's text that are outside code fences.
function plainLines(text) {
  if (typeof text !== "string") return [];
  return fenced(text.split("\n")).filter((l) => !l.inFence && l.line.trim()).map((l) => l.line);
}

function docOf(s) {
  let title = null;
  const sections = [];
  let current = null;
  for (const { line, inFence } of fenced(s.split("\n"))) {
    if (!inFence && line.startsWith("## ")) {
      current = { heading: line.slice(3).trim(), lines: [] };
      sections.push(current);
    } else if (!inFence && !current && title === null && line.startsWith("# ")) {
      title = line.slice(2).trim();
    } else if (current) {
      current.lines.push(line);
    }
  }
  return { title, sections: sections.map((x) => ({ heading: x.heading, text: x.lines.join("\n").trim() })) };
}

// { title, sections: [{ heading, text }] }. `title` is the text of the first "# " line before any
// section, as written (for a brief: "Brief: <task title>"), or null.
export function parseDoc(text) {
  return docOf(clean(text).s);
}

const sectionsNamed = (sections, heading) =>
  (Array.isArray(sections) ? sections : []).filter((x) => x && x.heading === heading);

// The owner's questions in "Anything unclear" (15.5). Every section of that name counts; a line
// "Verdict: PASS" or "Verdict: FAIL" (the check's last line) is not a question.
export function unclearOf(sections) {
  const out = [];
  for (const sec of sectionsNamed(sections, UNCLEAR)) {
    for (const raw of plainLines(sec.text)) {
      if (out.length >= MAX_ITEMS) return out;
      const line = raw.trim().replace(/^-\s+/, "").trim();
      if (!line || NOTHING.has(line.toLowerCase())) continue;
      if (/^Verdict:\s*(PASS|FAIL)$/.test(line)) continue;
      out.push(short(line));
    }
  }
  return out;
}

function staged(text, headings) {
  const { title, sections } = parseDoc(text);
  const present = new Set(sections.map((x) => x.heading));
  return { title, sections, unclear: unclearOf(sections), missing: headings.filter((h) => !present.has(h)) };
}

export function parseBrief(text) {
  return staged(text, BRIEF_HEADINGS);
}

export function parseSummary(text) {
  return staged(text, SUMMARY_HEADINGS);
}

// A plan also has steps: [{ n, text, who, needs }] from "## Steps" (`needs` is null without a needs line).
export function parsePlan(text) {
  const doc = staged(text, PLAN_HEADINGS);
  const steps = [];
  for (const sec of sectionsNamed(doc.sections, "Steps")) {
    const lines = plainLines(sec.text);
    for (let i = 0; i < lines.length && steps.length < MAX_ITEMS; i += 1) {
      if (!/^\d/.test(lines[i])) continue;
      const line = squeeze(lines[i]);
      const m = line && /^(\d{1,6})\. (.+?) - (.+)$/.exec(line);
      if (!m) continue;
      let needs = null;
      const next = lines[i + 1];
      if (next !== undefined && /^\s/.test(next)) {
        const n = squeeze(next);
        const nm = n && /^needs: ?(.+)$/.exec(n);
        if (nm) { needs = short(nm[1].trim()); i += 1; }
      }
      steps.push({ n: Number(m[1]), text: short(m[2].trim()), who: short(m[3].trim()), needs });
    }
  }
  return { ...doc, steps };
}

const VERDICT_FIRST = /^VERDICT:\s*(PASS|FAIL)\b(.*)$/i;
const VERDICT_LAST = /^Verdict: ?(PASS|FAIL)$/;

function evidenceOf(list) {
  const out = [];
  for (const piece of list.split(",")) {
    const p = piece.trim().replace(/^[`"']+|[`"']+$/g, "").trim();
    if (p && out.length < MAX_EVIDENCE) out.push(short(p));
  }
  return out;
}

// The Checker's comment (15.5). `outcome` and `reason` come from the first line; `round` from the
// title "# Check: round <n>". `wellFormed` is true exactly when `problems` is empty.
export function parseCheck(body) {
  const { s, cut } = clean(body);
  const problems = [];
  const problem = (p) => { if (problems.length < MAX_ITEMS) problems.push(p); };
  const result = { outcome: null, reason: "", round: null, checks: [], actions: [], unclear: [], wellFormed: false, problems };
  if (cut) problem("The check is longer than 1 MB; only the first 1 MB was read.");

  const lines = s.split("\n");
  let first = 0;
  while (first < lines.length && !lines[first].trim()) first += 1;
  if (first >= lines.length) {
    problem("The check is empty.");
    return result;
  }
  const head = squeeze(lines[first]);
  const vm = head && VERDICT_FIRST.exec(head);
  if (vm) {
    result.outcome = vm[1].toLowerCase();
    result.reason = short(vm[2].replace(/^\s*[-:]?\s*/, "").trim());
  } else {
    problem('The first line is not "VERDICT: PASS - <reason>" or "VERDICT: FAIL - <reason>".');
  }
  const rest = lines.slice(vm ? first + 1 : first);
  if (vm && !rest.some((l) => l.trim())) {
    problem("There is only the verdict line; the check's questions are missing.");
    return result;
  }

  const doc = docOf(rest.join("\n"));
  const tm = doc.title !== null && doc.title.length <= MAX_LINE ? /^Check: round (\d{1,6})$/.exec(squeeze(doc.title)) : null;
  if (tm) result.round = Number(tm[1]);
  else problem('The title "# Check: round <n>" is missing.');

  // Questions: exactly six, numbered 1 to 6, each "<question>? YES|NO - <reason>", maybe with evidence.
  const questions = sectionsNamed(doc.sections, "Questions");
  if (!questions.length) problem('The section "Questions" is missing.');
  const byNumber = new Map();
  for (const sec of questions) {
    const ql = plainLines(sec.text);
    for (let i = 0; i < ql.length; i += 1) {
      const nm = /^(\d{1,6})\./.exec(ql[i]);
      if (!nm) continue;
      const n = Number(nm[1]);
      const line = squeeze(ql[i]);
      const m = line && /^([1-6])\. (.+\?) (YES|NO) - (.+)$/.exec(line);
      if (!m) {
        problem(n >= 1 && n <= QUESTION_COUNT
          ? `Question ${n} is not written as "<question>? YES - <reason>" or "<question>? NO - <reason>".`
          : `There is a question numbered ${n}; a check has questions 1 to 6.`);
        continue;
      }
      let evidence = [];
      const next = ql[i + 1];
      if (next !== undefined && /^\s/.test(next)) {
        const e = squeeze(next);
        const em = e && /^evidence: ?(.+)$/.exec(e);
        if (em) { evidence = evidenceOf(em[1]); i += 1; }
      }
      if (byNumber.has(n)) { problem(`Question ${n} appears more than once.`); continue; }
      byNumber.set(n, { n, question: short(m[2].trim()), answer: m[3].toLowerCase(), reason: short(m[4].trim()), evidence });
    }
  }
  for (let n = 1; n <= QUESTION_COUNT; n += 1) {
    if (byNumber.has(n)) result.checks.push(byNumber.get(n));
    else if (questions.length) problem(`Question ${n} is missing.`);
  }

  // Actions: "- " lines, or "None.".
  const actions = sectionsNamed(doc.sections, "Actions");
  if (!actions.length) problem('The section "Actions" is missing.');
  for (const sec of actions) {
    for (const raw of plainLines(sec.text)) {
      const am = /^\s*-\s+(.+)$/.exec(raw);
      if (am && result.actions.length < MAX_ITEMS) result.actions.push(short(am[1].trim()));
    }
  }

  result.unclear = unclearOf(doc.sections);

  // The last line repeats the verdict.
  let last = lines.length - 1;
  while (last > first && !lines[last].trim()) last -= 1;
  const tail = last > first ? squeeze(lines[last]) : null;
  const lm = tail && VERDICT_LAST.exec(tail);
  if (!lm) {
    const elsewhere = rest.some((l) => { const q = squeeze(l); return q && VERDICT_LAST.test(q); });
    problem(elsewhere
      ? 'The line "Verdict: PASS" or "Verdict: FAIL" is not the last line.'
      : 'The last line "Verdict: PASS" or "Verdict: FAIL" is missing.');
  } else if (result.outcome && lm[1].toLowerCase() !== result.outcome) {
    problem(`The last line says ${lm[1]} but the first line says ${result.outcome.toUpperCase()}.`);
  }

  if (result.outcome === "pass") {
    for (const c of result.checks) if (c.answer === "no") problem(`The verdict is PASS but question ${c.n} is answered NO.`);
  }
  result.wellFormed = problems.length === 0;
  return result;
}

const bodyOf = (c) => (typeof c === "string" ? c : c && typeof c.body === "string" ? c.body : "");
// A plain string counts as an agent's comment; a board comment does when it has `authorAgentId`.
const byAgent = (c) => typeof c === "string" || Boolean(c && c.authorAgentId);

// The task's size from the newest agent comment (comments oldest first) whose first line is "SIZE: <size>".
export function sizeOf(comments) {
  const list = Array.isArray(comments) ? comments : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (!byAgent(list[i])) continue;
    const { s } = clean(bodyOf(list[i]));
    const firstLine = s.trimStart().split("\n", 1)[0];
    const m = firstLine.length <= MAX_LINE ? /^SIZE:\s*(XS|S|M|L|XL)\b/.exec(firstLine) : null;
    if (m) return m[1];
  }
  return null;
}

// A task's text with its markers taken out: "FOR: <name>" on the first line, "PLAN FIRST" and
// "ROUTINE: <id>" on the last lines (in either order).
export function textOf(description) {
  const lines = clean(description).s.split("\n");
  let start = 0;
  let end = lines.length;
  const out = { text: "", planFirst: false, for: null, routine: null };
  while (start < end && !lines[start].trim()) start += 1;
  if (start < end) {
    const m = /^FOR:\s*(.+)$/.exec(lines[start].trim());
    if (m && lines[start].length <= MAX_LINE) { out.for = short(m[1].trim()); start += 1; }
  }
  for (;;) {
    while (end > start && !lines[end - 1].trim()) end -= 1;
    if (end <= start || lines[end - 1].length > MAX_LINE) break;
    const line = lines[end - 1].trim();
    if (line === MARKERS.planFirst && !out.planFirst) { out.planFirst = true; end -= 1; continue; }
    const rm = /^ROUTINE:\s*(\S.*)$/.exec(line);
    if (rm && out.routine === null) { out.routine = short(rm[1].trim()); end -= 1; continue; }
    break;
  }
  out.text = lines.slice(start, end).join("\n").trim();
  return out;
}

// The task text the home server writes: "FOR: <to>\n<text>\n\nPLAN FIRST" (each marker only when asked).
export function buildText({ text, to, planFirst } = {}) {
  const body = typeof text === "string" ? text.trim() : "";
  const name = typeof to === "string" ? to.replace(/\s+/g, " ").trim() : "";
  let out = name ? `${MARKERS.for} ${name}\n${body}` : body;
  if (planFirst) out += `\n\n${MARKERS.planFirst}`;
  return out;
}

// Every check round of a task's tree (comments oldest first): the n-th comment starting "VERDICT:" is round n.
export function roundsOf(comments) {
  const list = Array.isArray(comments) ? comments : [];
  const out = [];
  for (const comment of list) {
    const body = bodyOf(comment);
    if (!/^\s*VERDICT:/i.test(body.slice(0, MAX_LINE))) continue;
    out.push({ n: out.length + 1, comment, ...parseCheck(body) });
  }
  return out;
}

const STAGES = [
  { id: "brief", label: "Brief" },
  { id: "plan", label: "Plan" },
  { id: "work", label: "Work" },
  { id: "summary", label: "Summary" },
  { id: "check", label: "Check" },
];
const FINISHED = new Set(["done", "cancelled"]);

// The five stages of a task with done | current | waiting | skipped.
// `steps`: the task's steps ({ status }); `rounds`: roundsOf; `status`: the task's own status.
// The stage furthest along is current; those before it are done, those after it waiting. Brief, plan
// and summary are skipped for XS, S and an unknown size unless their file exists, and for any size
// once the task has gone past them without the file. A task that is done, or whose newest round
// passed, has no current stage. After a FAIL the check stays current until a round passes.
export function stagesOf({ size, has, steps, rounds, status } = {}) {
  const files = has && typeof has === "object" ? has : {};
  const stepList = Array.isArray(steps) ? steps : [];
  const roundList = Array.isArray(rounds) ? rounds : [];
  const full = size === "M" || size === "L" || size === "XL";
  const newest = roundList[roundList.length - 1];
  const passed = Boolean(newest && newest.outcome === "pass");
  const done = status === "done";
  const stepsFinished = stepList.length > 0 && stepList.every((x) => x && FINISHED.has(x.status));

  let current;
  if (done || passed) current = STAGES.length;          // nothing is current
  else if (roundList.length || files.summary) current = 4;
  else if (stepsFinished) current = full ? 3 : 4;
  else if (stepList.length || files.plan) current = 2;
  else if (files.brief) current = 1;
  else current = full ? 0 : 2;
  const isDocStage = (i) => i === 0 || i === 1 || i === 3;
  while (current < STAGES.length && isDocStage(current) && !full && !files[STAGES[current].id]) current += 1;

  return STAGES.map((st, i) => {
    let state = i < current ? "done" : i === current ? "current" : "waiting";
    const isDoc = isDocStage(i);
    if (isDoc && files[st.id]) state = "done";
    else if (isDoc && (!full || state === "done")) state = "skipped";
    if (st.id === "check" && passed) state = "done";
    return { id: st.id, label: st.label, state };
  });
}
