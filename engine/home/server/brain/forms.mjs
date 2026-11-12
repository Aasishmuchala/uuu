// The brain's forms (CONTRACTS-V3 32.3): the owner's answers to one form become one Markdown file in the
// company brain, and that file is read back into answers. Every agent treats these files as the company's
// facts, so the answers are written as plain text only:
//   - a line of an answer that could start a heading (`#`), a heading's underline (`---`, `===`), or that
//     reads like the placeholder is written with a `\` before it, and read back without it;
//   - a `|` or `\` inside a table cell is written as `\|` or `\\`, so a cell never breaks its table;
//   - control characters are dropped, line breaks are kept only where the kind allows them.
// A file the owner changed by hand is read as far as its headings allow: a section whose heading the form
// does not know, or whose content does not fit its field, is kept as it is and written back at the end;
// text between the title and the first heading stays where it is. Nothing of the file is lost on a save.
// Pure, except readForm and saveForm, which only call the store of brain/store.mjs.

export const PLACEHOLDER = "(not filled in yet)";
const LIMITS = { line: 200, text: 4000, item: 200, rows: 60 };
const FILLED_BYTES = 40;
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const BREAK = /[\r\n\u2028\u2029]/;
// Control characters except the line feed, and the two Unicode line separators.
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g;
const LIST_LINE = /^[-*+](?:\s+(.*))?$/;

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const chars = (s) => [...s].length;
const isEmpty = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
// A heading or a column label as it is compared: case and spacing do not count.
const key = (s) => String(s).replace(/\s+/g, " ").trim().toLowerCase();
const headingOf = (label) => String(label).replace(/\s+/g, " ").trim();

// The fixed heading of each field of the nine basics, in C3 32.3's wording (M52 F1). A form's label is a
// question for the owner ("What do you sell?"); a file may hold the plain name instead ("What you sell"), as the
// seed and a hand-written file do. Saving writes the label, as before; reading takes the label or the fixed
// heading (see headingKey), so neither kind of file opens empty and no answer is written twice. A field may
// also carry its own `heading`.
export const HEADINGS = {
  about: { what: "What the company does", who: "Who it is for", where: "Where it works", state: "The state it is in", reach: "How to reach it", name: "The company's name as it is written" },
  brand: { tone: "Three to five words for how you sound", colours: "Your colours", fonts: "Your typeface", signoff: "How you sign off", logo: "Your logo's file in Brand" },
  "cant-say": { words: "Words and phrases never to use", claims: "Claims never to make" },
  services: { items: "What you sell" },
  terms: { payment: "Payment terms", holds: "How long a quotation holds", deposit: "Deposit", other: "Anything else" },
  refunds: { rule: "The refund rule in your words", exceptions: "Who decides exceptions" },
  "support-promise": { hours: "Hours", speed: "How fast you reply", never: "What you never promise" },
  team: { people: "People" },
  "ideal-customer": { good: "Who you sell to", not: "Who you do not sell to", asks: "What they usually ask for" },
};

// A heading as it is matched: case, spacing and a final "?" do not count.
export const headingKey = (s) => key(s).replace(/\s*\?$/, "");

// fieldHeading(form, field) -> the field's fixed heading (its own, else the table's, else its label).
export function fieldHeading(form, field) {
  const own = typeof field.heading === "string" && field.heading.trim() ? field.heading : null;
  const fixed = form && Object.hasOwn(HEADINGS, form.id) && Object.hasOwn(HEADINGS[form.id], field.id) ? HEADINGS[form.id][field.id] : null;
  return headingOf(own || fixed || field.label);
}

// fieldKeys(form, field) -> the headings (as headingKey gives them) the field is read back from: its heading and its label.
export const fieldKeys = (form, field) => [...new Set([fieldHeading(form, field), headingOf(field.label)].map(headingKey))];

// ---- cleaning: one value of one kind -> the plain text that is written

const oneLine = (s) => s.replace(CONTROL, "").replace(/[\r\n]/g, " ").trim();
function manyLines(s) {
  const lines = s.replace(/\r\n?/g, "\n").replace(CONTROL, "").split("\n").map((l) => l.trimEnd());
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.join("\n");
}
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map(oneLine).filter(Boolean) : []);

function cleanOne(field, v) {
  switch (field.kind) {
    case "line": case "choice": return typeof v === "string" ? oneLine(v) : "";
    case "text": return typeof v === "string" ? manyLines(v) : "";
    case "list": case "colour": return strings(v);
    case "rows": {
      if (!Array.isArray(v)) return [];
      const out = [];
      for (const r of v) {
        if (!obj(r)) continue;
        const row = {};
        for (const c of field.columns) row[c.id] = typeof r[c.id] === "string" ? oneLine(r[c.id]) : "";
        if (field.columns.some((c) => row[c.id])) out.push(row);
      }
      return out;
    }
    default: return "";
  }
}

// cleanValues(form, values) -> { <field id>: value } for every field of the form, as it would be written:
// trimmed, control characters dropped, empty list items and empty rows left out. Keys the form does not
// have are dropped. A round trip through renderForm and parseForm gives exactly this back.
export function cleanValues(form, values) {
  const v = obj(values) ? values : {};
  const out = {};
  for (const f of form.fields) out[f.id] = cleanOne(f, v[f.id]);
  return out;
}

// emptyValues(form) -> the values of a form nobody has filled in.
export const emptyValues = (form) => cleanValues(form, {});

// ---- checking

const quoted = (f) => `"${headingOf(f.label)}"`;

// checkValues(form, values) -> [{ field, label, code, message }]. Every code but `empty` refuses a save;
// `empty` (a required field with no answer) is allowed and makes the file count as not filled (32.4).
export function checkValues(form, values) {
  const v = obj(values) ? values : {};
  const out = [];
  const say = (f, code, message) => out.push({ field: f.id, label: f.label, code, message });
  for (const f of form.fields) {
    const raw = v[f.id];
    const textKind = f.kind === "line" || f.kind === "text" || f.kind === "choice";
    if (raw !== undefined && raw !== null && (textKind ? typeof raw !== "string" : !Array.isArray(raw))) {
      say(f, "bad_type", `The answer to ${quoted(f)} could not be read.`);
      continue;
    }
    if (f.kind === "list" || f.kind === "colour") {
      if (raw && raw.some((x) => typeof x !== "string")) { say(f, "bad_type", `The answer to ${quoted(f)} could not be read.`); continue; }
      if (raw && raw.some((x) => BREAK.test(x))) { say(f, "one_line", `Each answer to ${quoted(f)} must fit on one line.`); continue; }
    }
    if (f.kind === "rows" && raw) {
      if (raw.some((r) => !obj(r) || f.columns.some((c) => r[c.id] !== undefined && r[c.id] !== null && typeof r[c.id] !== "string"))) {
        say(f, "bad_type", `The answer to ${quoted(f)} could not be read.`);
        continue;
      }
      if (raw.some((r) => f.columns.some((c) => typeof r[c.id] === "string" && BREAK.test(r[c.id])))) {
        say(f, "one_line", `Each box of ${quoted(f)} must fit on one line.`);
        continue;
      }
    }
    if ((f.kind === "line" || f.kind === "choice") && typeof raw === "string" && BREAK.test(raw)) {
      say(f, "one_line", `The answer to ${quoted(f)} must fit on one line.`);
      continue;
    }
    const value = cleanOne(f, raw);
    if (isEmpty(value)) {
      if (f.required) say(f, "empty", `${quoted(f)} is not filled in yet.`);
      continue;
    }
    switch (f.kind) {
      case "line":
        if (chars(value) > LIMITS.line) say(f, "too_long", `The answer to ${quoted(f)} is too long: at most ${LIMITS.line} characters.`);
        break;
      case "text":
        if (chars(value) > LIMITS.text) say(f, "too_long", `The answer to ${quoted(f)} is too long: at most ${LIMITS.text} characters.`);
        break;
      case "choice":
        if (!f.options.includes(value)) say(f, "not_an_option", `The answer to ${quoted(f)} must be one of the choices offered.`);
        break;
      case "list":
        if (value.length > f.max) say(f, "too_many", `${quoted(f)} takes at most ${f.max} answers.`);
        else if (value.some((x) => chars(x) > LIMITS.item)) say(f, "too_long", `An answer to ${quoted(f)} is too long: at most ${LIMITS.item} characters each.`);
        break;
      case "colour":
        if (value.length > f.max) say(f, "too_many", `${quoted(f)} takes at most ${f.max} colours.`);
        else if (!value.every((x) => COLOUR.test(x))) {
          say(f, "bad_colour", `${quoted(f)} takes colours written as # and six letters or digits, such as #1a3c5e.`);
        }
        break;
      case "rows":
        if (value.length > LIMITS.rows) say(f, "too_many", `${quoted(f)} takes at most ${LIMITS.rows} rows.`);
        else if (value.some((r) => f.columns.some((c) => chars(r[c.id]) > LIMITS.item))) {
          say(f, "too_long", `A box of ${quoted(f)} is too long: at most ${LIMITS.item} characters each.`);
        }
        break;
      default:
        say(f, "bad_type", `The answer to ${quoted(f)} could not be read.`);
    }
  }
  return out;
}

// ---- writing

// A line of an answer that could be read as Markdown structure, or as the placeholder, gets a `\` first.
function escapeLine(line) {
  const m = line.match(/^([ \t]*)([\s\S]*)$/);
  const rest = m[2];
  if (/^[\\#]/.test(rest) || /^(=+|-+)\s*$/.test(rest) || rest.trim() === PLACEHOLDER) return `${m[1]}\\${rest}`;
  return line;
}
function unescapeLine(line) {
  const m = line.match(/^([ \t]*)\\([\s\S]*)$/);
  if (!m) return line;
  const rest = m[2];
  if (/^[\\#]/.test(rest) || /^(=+|-+)\s*$/.test(rest) || rest.trim() === PLACEHOLDER) return `${m[1]}${rest}`;
  return line;
}

const cellOut = (s) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
const rowOut = (cells) => `| ${cells.map(cellOut).join(" | ")} |`;

function bodyOf(field, value) {
  if (isEmpty(value)) return [PLACEHOLDER];
  switch (field.kind) {
    case "line": case "choice": return [escapeLine(value)];
    case "text": return value.split("\n").map(escapeLine);
    case "list": case "colour": return value.map((x) => `- ${x}`);
    case "rows": return [
      rowOut(field.columns.map((c) => headingOf(c.label))),
      `|${field.columns.map(() => "---").join("|")}|`,
      ...value.map((r) => rowOut(field.columns.map((c) => r[c.id]))),
    ];
    default: return [PLACEHOLDER];
  }
}

// renderForm(form, values, kept?) -> markdown. `kept` is what parseForm found that the form does not hold
// ({ intro, unknown }): the intro goes under the title, the unknown sections at the end, as they were.
export function renderForm(form, values, kept = {}) {
  const v = cleanValues(form, values);
  const out = [`# ${headingOf(form.title)}`, ""];
  const intro = typeof kept.intro === "string" ? kept.intro.trimEnd() : "";
  if (intro) out.push(intro, "");
  for (const f of form.fields) out.push(`## ${headingOf(f.label)}`, ...bodyOf(f, v[f.id]), "");
  for (const u of Array.isArray(kept.unknown) ? kept.unknown : []) {
    if (u && typeof u.text === "string" && u.text.trim()) out.push(u.text.trimEnd(), "");
  }
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

// ---- reading

// The cells of one table line; `\|` and `\\` are a `|` and a `\` inside a cell.
function cellsOf(line) {
  const cells = [];
  let cur = "";
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\\" && (line[i + 1] === "|" || line[i + 1] === "\\")) { cur += line[i + 1]; i += 1; } else if (ch === "|") { cells.push(cur); cur = ""; } else cur += ch;
  }
  cells.push(cur);
  // A row starts and ends with a `|`: the parts outside them are empty.
  if (cells.length > 1 && !cells[0].trim()) cells.shift();
  if (cells.length > 1 && !cells[cells.length - 1].trim()) cells.pop();
  return cells.map((c) => c.trim());
}
const SEPARATOR = /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

// The value of one field from the lines under its heading, or undefined when they do not fit its kind.
function valueOf(field, lines) {
  const body = [...lines];
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body[body.length - 1].trim()) body.pop();
  const filled = body.filter((l) => l.trim());
  if (!filled.length || (filled.length === 1 && filled[0].trim() === PLACEHOLDER)) return cleanOne(field, undefined);
  switch (field.kind) {
    case "line": return filled.length === 1 ? oneLine(unescapeLine(filled[0])) : undefined;
    case "choice": {
      if (filled.length !== 1) return undefined;
      const c = oneLine(unescapeLine(filled[0]));
      return field.options.includes(c) ? c : undefined;
    }
    case "text": return manyLines(body.map(unescapeLine).join("\n"));
    case "list": case "colour": {
      const items = [];
      for (const l of filled) {
        const m = l.trim().match(LIST_LINE);
        if (!m) return undefined;
        const item = oneLine(m[1] || "");
        if (item) items.push(item);
      }
      return items;
    }
    case "rows": {
      if (filled.length < 2 || !filled.every((l) => l.trim().startsWith("|")) || !SEPARATOR.test(filled[1].trim())) return undefined;
      const head = cellsOf(filled[0].trim()).map(key);
      const labels = field.columns.map((c) => key(headingOf(c.label)));
      if (head.length !== labels.length || [...head].sort().join("\n") !== [...labels].sort().join("\n")) return undefined;
      const rows = [];
      for (const l of filled.slice(2)) {
        const cells = cellsOf(l.trim());
        if (cells.length > head.length) return undefined;
        const row = {};
        for (const c of field.columns) {
          const at = head.indexOf(key(headingOf(c.label)));
          row[c.id] = oneLine(cells[at] || "");
        }
        if (field.columns.some((c) => row[c.id])) rows.push(row);
      }
      return rows;
    }
    default: return undefined;
  }
}

// parseForm(form, markdown) -> { values, unknown: [{ heading, text }], intro }. `values` has every field
// (empty when the file does not answer it). A section is a `## ` line and the lines under it; the first
// section whose heading is the field's heading or its label (case, spacing and a final "?" aside; see
// fieldKeys) and whose content fits the field's kind
// answers it; every other section is kept in `unknown` as it is. `intro` is the text between the title and
// the first section (a title other than the form's is kept in it too).
export function parseForm(form, markdown) {
  const values = emptyValues(form);
  const unknown = [];
  const lines = String(typeof markdown === "string" ? markdown : "").replace(/\r\n?/g, "\n").split("\n");
  let at = 0;
  while (at < lines.length && !lines[at].trim()) at += 1;
  const introLines = [];
  if (at < lines.length && /^# /.test(lines[at])) {
    if (key(lines[at].slice(2)) !== key(form.title)) introLines.push(lines[at]);
    at += 1;
  }
  const sections = [];
  let cur = null;
  for (; at < lines.length; at += 1) {
    const line = lines[at];
    if (line.startsWith("## ") || line === "##") {
      cur = { heading: line.slice(3).trim(), raw: [line], body: [] };
      sections.push(cur);
    } else if (cur) {
      cur.raw.push(line);
      cur.body.push(line);
    } else introLines.push(line);
  }
  const byLabel = new Map();
  for (const f of form.fields) for (const k of fieldKeys(form, f)) if (!byLabel.has(k)) byLabel.set(k, f);
  const done = new Set();
  for (const s of sections) {
    const f = byLabel.get(headingKey(s.heading));
    const value = f && !done.has(f.id) ? valueOf(f, s.body) : undefined;
    if (value !== undefined) {
      values[f.id] = value;
      done.add(f.id);
    } else {
      unknown.push({ heading: s.heading, text: s.raw.join("\n").trimEnd() });
    }
  }
  return { values, unknown, intro: introLines.join("\n").replace(/^\n+/, "").trimEnd() };
}

// ---- the store

// stateOf(form, values, text) -> "filled" | "empty", as 32.4 counts a file that came from a form.
export function stateOf(form, values, text) {
  if (Buffer.byteLength(String(text), "utf8") < FILLED_BYTES) return "empty";
  const v = cleanValues(form, values);
  return form.fields.some((f) => f.required && isEmpty(v[f.id])) ? "empty" : "filled";
}

export const formPath = (form) => `${form.folder}/${form.file}`;

// readForm(store, form) -> { values, exists, version, unknown, intro, truncated }.
export function readForm(store, form) {
  const file = store.find(formPath(form));
  if (!file) return { values: emptyValues(form), exists: false, version: null, unknown: [], intro: "", truncated: false };
  const { text, truncated } = store.get(file.token);
  const parsed = parseForm(form, text || "");
  return { ...parsed, exists: true, version: file.version, truncated, file };
}

export class FormError extends Error {
  constructor(status, message, next, code) {
    super(message);
    this.status = status;
    this.next = next;
    this.code = code;
  }
}

// saveForm(store, form, values, version) -> { file, state }. Refuses a bad value (400 bad_value, naming the
// field), and a version that is not the file's (409, from the store). What the file holds beyond the form
// is read at that version and kept.
export function saveForm(store, form, values, version) {
  const problems = checkValues(form, values).filter((p) => p.code !== "empty");
  if (problems.length) throw new FormError(400, problems[0].message, "Change that answer, then save again.", "bad_value");
  const current = store.find(formPath(form));
  const seen = version === undefined || version === null || version === "" ? null : String(version);
  const changed = () => new FormError(409, "That file changed since you opened it.", "Open it again to see the newest version, then try again.", "changed_since_seen");
  // A file that is there needs its version; a version for a file that is gone is stale too.
  if (current ? seen !== current.version : seen !== null) throw changed();
  let kept = {};
  if (current) {
    const { text, truncated } = store.get(current.token);
    if (truncated) {
      throw new FormError(409, "That file has grown too long to open as a form.", "Open it in Files and shorten it, then try again.", "too_long_for_form");
    }
    const parsed = parseForm(form, text || "");
    kept = { intro: parsed.intro, unknown: parsed.unknown };
  }
  const text = renderForm(form, values, kept);
  const file = store.replace(formPath(form), text, seen);
  return { file, state: stateOf(form, values, text) };
}
