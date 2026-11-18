// Cut one brain file into passages (contract B4). Pure: no file, no network, linear time.
//   cutFile({ path, name, kind, text, at }) -> [{ title, locator, ord, text }]
// kind is the store's own: "text" (md, txt), "table" (csv), "image", "pdf".

export const MAX_PASSAGE_CHARS = 900;
export const MAX_PASSAGES = 400;
const CSV_ROWS = 20;
const CSV_PASSAGES = 50;
const TITLE_MAX = 80;
const LOCATOR_MAX = 160;

const isSpace = (c) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f" || c === "\v";

function nameOf(file) {
  const raw = typeof file.name === "string" && file.name ? file.name : String(file.path ?? "").split("/").pop();
  const dot = raw.lastIndexOf(".");
  return dot > 0 ? raw.slice(0, dot) : raw;
}

const fenceMark = (line) => /^[ \t]{0,3}(```|~~~)/.test(line);
const headingOf = (line) => {
  const m = /^(#{1,6})[ \t]+(.*?)[ \t#]*$/.exec(line);
  return m ? { level: m[1].length, text: m[2].trim() } : null;
};

function firstTitle(lines) {
  let fenced = false;
  for (const line of lines) {
    if (fenceMark(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    if (line.startsWith("# ")) {
      const t = line.slice(2).trim();
      if (t) return t.slice(0, TITLE_MAX);
    }
  }
  return null;
}

// Cut a paragraph longer than the limit: at the last sentence end or space before it, else hard.
function cutLong(para, out) {
  let rest = para;
  while (rest.length > MAX_PASSAGE_CHARS) {
    let at = -1;
    for (let i = MAX_PASSAGE_CHARS - 1; i > 0; i--) {
      const c = rest[i];
      if ((c === "." || c === "!" || c === "?") && isSpace(rest[i + 1])) { at = i + 1; break; }
    }
    if (at < 0) for (let i = MAX_PASSAGE_CHARS - 1; i > 0; i--) if (isSpace(rest[i])) { at = i; break; }
    if (at < 0) at = MAX_PASSAGE_CHARS;
    out.push(rest.slice(0, at).trim());
    let skip = at;
    while (skip < rest.length && isSpace(rest[skip])) skip++;
    rest = rest.slice(skip);
    if (out.length >= MAX_PASSAGES) return "";
  }
  return rest;
}

function packSection(body, push) {
  const paras = body.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean);
  let cur = "";
  for (const para of paras) {
    if (para.length > MAX_PASSAGE_CHARS) {
      if (cur) { push(cur); cur = ""; }
      const pieces = [];
      const tail = cutLong(para, pieces);
      for (const p of pieces) if (p) push(p);
      cur = tail;
    } else if (!cur) cur = para;
    else if (cur.length + 2 + para.length <= MAX_PASSAGE_CHARS) cur += `\n\n${para}`;
    else { push(cur); cur = para; }
  }
  if (cur) push(cur);
}

function cutText(lines, title) {
  const out = [];
  const stack = []; // [{ level, text }]
  let fenced = false;
  let body = [];
  const locator = () => stack.map((h) => h.text).filter(Boolean).join(" > ").slice(0, LOCATOR_MAX);
  const flush = () => {
    const text = body.join("\n").trim();
    body = [];
    if (!text) return;
    const loc = locator();
    packSection(text, (t) => { if (out.length < MAX_PASSAGES) out.push({ title, locator: loc, ord: out.length, text: t }); });
  };
  for (const line of lines) {
    if (out.length >= MAX_PASSAGES) break;
    if (fenceMark(line)) { fenced = !fenced; body.push(line); continue; }
    const h = fenced ? null : headingOf(line);
    if (h) {
      flush();
      while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
      stack.push(h);
    } else body.push(line);
  }
  if (out.length < MAX_PASSAGES) flush();
  return out;
}

function cutTable(lines, title) {
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length < 2) return [];
  const header = lines[0];
  const out = [];
  for (let start = 1; start < lines.length && out.length < CSV_PASSAGES; start += CSV_ROWS) {
    const end = Math.min(start + CSV_ROWS, lines.length); // exclusive, 0-based
    out.push({
      title, locator: `rows ${start + 1} to ${end}`, ord: out.length,
      text: [header, ...lines.slice(start, end)].join("\n"),
    });
  }
  return out;
}

export function cutFile({ path, name, kind, text } = {}) {
  const fallback = nameOf({ path, name });
  if (kind === "image" || kind === "pdf") return [{ title: fallback, locator: "", ord: 0, text: "" }];
  if (kind !== "text" && kind !== "table") return [];
  if (typeof text !== "string" || text.includes("\0")) return [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const title = firstTitle(lines) ?? fallback;
  return (kind === "table" ? cutTable(lines, title) : cutText(lines, title)).slice(0, MAX_PASSAGES);
}
