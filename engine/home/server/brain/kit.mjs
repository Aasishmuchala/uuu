// The brand kit (PLAN-V5 K5): the owner's colours, type, logo, voice and approved examples, kept as
// state/knowledge/docs/brand/kit.json and read by every tool that lays something out. Only the home server
// writes it, only from the owner's typing and uploads (same-origin POSTs); no agent can write it.
//   - checkKit holds every rule of K5; anything else is refused with one sentence naming the field;
//   - a save writes four files from the kit alone: kit.json and kit.css (temp file, then rename, 0644, the
//     folder and the target checked by lstat first and after), brand.md through the brain store's `replace`
//     (so its index and version stay right; the old form still reads it), and
//     state/knowledge/shared/brand-public.md (only the name, the voice words and the public summary);
//   - fonts are uploaded by the owner, checked by their first bytes, never replaced, at most six;
//   - a proposal (brand-proposal.json in a task's folder) was written by an agent: it is opened once with no
//     link followed, capped, and every field goes through the same rules; bad parts are dropped, never an error.
// Nothing here runs, converts or opens a file with another program.
import {
  closeSync, constants as fsConstants, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, opendirSync,
  openSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { readChecked, readTaskText } from "../lib/taskfiles.mjs";
import { stripInvisible } from "../lib/owner-text.mjs";
import { noteLine } from "../lib/verdicts.mjs";
import { parseForm, readForm, renderForm } from "./forms.mjs";

export const KINDS = ["post", "newsletter", "carousel", "poster", "title-card", "film", "page"];
export const ROLES = ["main", "accent", "background", "text", "other"];
export const REQUIRED_ON = ["carousel-last", "poster", "title-card", "end-card", "page"];
export const FALLBACKS = ["serif", "sans-serif", "monospace"];
export const LIMITS = {
  colours: [2, 8], words: 5, word: 40, is: 1000, item: 200, items: 12, references: 24, logos: 4, name: 80,
  signoff: 200, summary: 600, allow: 40, allowItem: [2, 60], minPx: [10, 40], minSlidePx: [16, 120],
  logoMinPx: [8, 400], clearSpace: [0, 2], radiusPx: [0, 64], marginShare: [0, 0.25],
};
export const FONT_MAX_BYTES = 5 * 1024 * 1024;
export const FONT_MAX_FILES = 6;
export const PROPOSAL_MAX_BYTES = 64 * 1024;
const KIT_MAX_BYTES = 256 * 1024;
const INDEX_MAX_BYTES = 256 * 1024;
const FONT_SCAN = 200;

const COLOUR_NAME = /^[a-z][a-z0-9-]{0,23}$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 -]{0,59}$/;
export const FONT_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}\.(ttf|otf|ttc)$/;
const IDENTIFIER = /^[A-Z][A-Z0-9]{0,9}-\d{1,9}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLAYBOOK = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const BREAK = /[\r\n\u2028\u2029\u0085]/;
const SERIF = new Set(["Georgia", "Baskerville", "Didot"]);
const TOP = ["name", "colours", "neutrals", "type", "logo", "layout", "voice", "references", "filler", "public"];
// Keys of the file itself, set by the server: accepted in a body and ignored.
const OWN = ["version", "savedAt"];

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const chars = (s) => [...s].length;
const whole = (v) => typeof v === "number" && Number.isInteger(v);
const num = (v) => typeof v === "number" && Number.isFinite(v);

export class KitError extends Error {
  constructor(status, message, next, code, field = null) {
    super(message);
    this.status = status;
    this.next = next;
    this.code = code;
    this.field = field;
  }
}

const bad = (field, message) => new KitError(400, message, "Change that, then save again.", "bad_kit", field);
const ERR = {
  unsafe: () => new KitError(409, "The brand folder is not a plain folder, so nothing was saved.",
    "Open the knowledge folder in Finder and check the brand folder.", "folder_unsafe"),
  changed: () => new KitError(409, "The brand kit changed since you opened it.",
    "Open it again to see the newest version, then try again.", "changed_since_seen"),
  fontType: () => new KitError(400, "That file is not a font this engine can use.",
    "Add a TrueType or OpenType font file (.ttf, .otf or .ttc).", "font_type"),
  fontLarge: () => new KitError(413, "That font file is too large.", "A font file can be up to 5 MB.", "font_too_large"),
  fontMany: () => new KitError(409, "The brand kit already has six font files.", "Remove one you no longer use, then add this one.", "too_many_fonts"),
  fontExists: () => new KitError(409, "A font file with that name is already there.", "Remove the old one first, or rename the file.", "font_exists"),
  fontMissing: () => new KitError(404, "That font file is not in the brand kit.", "Go back to the brand kit and pick one from there.", "font_not_found"),
  fontInUse: () => new KitError(409, "The brand kit uses that font.", "Choose another typeface and save the brand kit, then remove it.", "font_in_use"),
};

// ---- cleaning the owner's words

// One line: control and invisible characters dropped, trimmed. A line break refuses (a sentence naming the field).
function line(v, field, label, { max, least = 0 } = {}) {
  if (typeof v !== "string") throw bad(field, `${label} could not be read.`);
  if (BREAK.test(v)) throw bad(field, `${label} must fit on one line.`);
  const s = stripInvisible(v).trim();
  if (chars(s) < least) throw bad(field, least === 1 ? `${label} is not filled in.` : `${label} is too short: at least ${least} characters.`);
  if (chars(s) > max) throw bad(field, `${label} is too long: at most ${max} characters.`);
  return s;
}

// A paragraph: line breaks made "\n", control and invisible characters dropped, trimmed.
function para(v, field, label, max) {
  if (typeof v !== "string") throw bad(field, `${label} could not be read.`);
  const s = stripInvisible(v.replace(/\r\n?|\u2028|\u2029|\u0085/g, "\n")).split("\n").map((l) => l.trimEnd()).join("\n").trim();
  if (chars(s) > max) throw bad(field, `${label} is too long: at most ${max} characters.`);
  return s;
}

function keysOnly(v, keys, field, label) {
  if (!obj(v)) throw bad(field, `${label} could not be read.`);
  for (const k of Object.keys(v)) if (!keys.includes(k)) throw bad(field ? `${field}.${k}` : k, `${label} has a part the brand kit does not know.`);
  for (const k of keys) if (!Object.hasOwn(v, k)) throw bad(field ? `${field}.${k}` : k, `${label} is missing a part.`);
}

function bool(v, field, label) {
  if (typeof v !== "boolean") throw bad(field, `${label} must be on or off.`);
  return v;
}

function inRange(v, field, label, [lo, hi], { integer = true, unit = "" } = {}) {
  if (!(integer ? whole(v) : num(v)) || v < lo || v > hi) {
    throw bad(field, `${label} must be ${integer ? "a whole number " : ""}from ${lo} to ${hi}${unit}.`);
  }
  return v;
}

function list(v, field, label, max) {
  if (!Array.isArray(v)) throw bad(field, `${label} could not be read.`);
  if (v.length > max) throw bad(field, `${label} takes at most ${max}.`);
  return v;
}

// ---- the parts of the kit: each (value, env) -> the clean value, or a KitError naming its field.
// env: { families: Set (fontmap names), fonts: Set (uploaded font files), brandPictures: Set (bare names of
// the pictures in Brand), referencePictures: Set ("references/<name>") }.

const PARTS = {
  name(v) { return line(v, "name", "The company's name", { max: LIMITS.name, least: 1 }); },

  colours(v) {
    list(v, "colours", "Colours", LIMITS.colours[1]);
    if (v.length < LIMITS.colours[0]) throw bad("colours", `The brand kit needs at least ${LIMITS.colours[0]} colours.`);
    const out = v.map((c, i) => colour(c, i));
    const names = new Set();
    out.forEach((c, i) => {
      if (names.has(c.name)) throw bad(`colours.${i}.name`, `Colour ${i + 1}: another colour already has the name "${c.name}".`);
      names.add(c.name);
    });
    const mains = out.filter((c) => c.role === "main").length;
    if (mains !== 1) throw bad("colours", mains ? "Only one colour can be the main colour." : "Mark one colour as the main colour.");
    return out;
  },

  neutrals(v) { return bool(v, "neutrals", "Greys, black and white"); },

  type(v, env) {
    keysOnly(v, ["heading", "body", "minPx", "minSlidePx"], "type", "Type");
    return {
      heading: face(v.heading, "type.heading", "The heading typeface", env),
      body: face(v.body, "type.body", "The body typeface", env),
      minPx: inRange(v.minPx, "type.minPx", "The smallest text on a page", LIMITS.minPx, { unit: " pixels" }),
      minSlidePx: inRange(v.minSlidePx, "type.minSlidePx", "The smallest text on a slide", LIMITS.minSlidePx, { unit: " pixels" }),
    };
  },

  logo(v, env) {
    keysOnly(v, ["files", "clearSpace", "minPx", "requiredOn"], "logo", "Logo");
    list(v.files, "logo.files", "Logo files", LIMITS.logos);
    const seen = new Set();
    const files = v.files.map((f, i) => {
      const field = `logo.files.${i}`;
      keysOnly(f, ["file", "on"], field, `Logo file ${i + 1}`);
      if (typeof f.file !== "string" || !env.brandPictures.has(f.file)) {
        throw bad(`${field}.file`, `Logo file ${i + 1} must be one of the pictures in Brand.`);
      }
      if (f.on !== "light" && f.on !== "dark") throw bad(`${field}.on`, `Logo file ${i + 1} must say light or dark background.`);
      const k = `${f.file}|${f.on}`;
      if (seen.has(k)) throw bad(field, `Logo file ${i + 1} is listed twice.`);
      seen.add(k);
      return { file: f.file, on: f.on };
    });
    list(v.requiredOn, "logo.requiredOn", "Where the logo must appear", REQUIRED_ON.length);
    if (!v.requiredOn.every((x) => REQUIRED_ON.includes(x)) || new Set(v.requiredOn).size !== v.requiredOn.length) {
      throw bad("logo.requiredOn", "Where the logo must appear can only name the places offered, each once.");
    }
    return {
      files,
      clearSpace: inRange(v.clearSpace, "logo.clearSpace", "The logo's clear space", LIMITS.clearSpace, { integer: false, unit: " times its height" }),
      minPx: inRange(v.minPx, "logo.minPx", "The logo's smallest height", LIMITS.logoMinPx, { unit: " pixels" }),
      requiredOn: REQUIRED_ON.filter((x) => v.requiredOn.includes(x)),
    };
  },

  layout(v) {
    keysOnly(v, ["radiusPx", "marginShare"], "layout", "Layout");
    return {
      radiusPx: inRange(v.radiusPx, "layout.radiusPx", "The corner radius", LIMITS.radiusPx, { unit: " pixels" }),
      marginShare: inRange(v.marginShare, "layout.marginShare", "The margin", LIMITS.marginShare, { integer: false, unit: " of the width" }),
    };
  },

  voice(v) {
    keysOnly(v, ["words", "is", "do", "dont", "signoff"], "voice", "How we sound");
    list(v.words, "voice.words", "The words for how you sound", LIMITS.words);
    const words = v.words.map((w, i) => line(w, `voice.words.${i}`, `Word ${i + 1} for how you sound`, { max: LIMITS.word, least: 1 }));
    const items = (arr, key, label) => {
      list(arr, `voice.${key}`, label, LIMITS.items);
      return arr.map((x, i) => line(x, `voice.${key}.${i}`, `${label}, line ${i + 1},`, { max: LIMITS.item })).filter(Boolean);
    };
    return {
      words,
      is: para(v.is, "voice.is", "How you sound, in a few sentences,", LIMITS.is),
      do: items(v.do, "do", "Do examples"),
      dont: items(v.dont, "dont", "Don't examples"),
      signoff: line(v.signoff, "voice.signoff", "The sign-off", { max: LIMITS.signoff }),
    };
  },

  references(v, env) {
    list(v, "references", "Examples of approved work", LIMITS.references);
    const seen = new Set();
    return v.map((r, i) => {
      const field = `references.${i}`;
      const label = `Example ${i + 1}`;
      keysOnly(r, ["file", "kinds", "note"], field, label);
      if (typeof r.file !== "string" || !env.referencePictures.has(r.file)) throw bad(`${field}.file`, `${label} must be one of the pictures in References.`);
      if (seen.has(r.file)) throw bad(`${field}.file`, `${label} is listed twice.`);
      seen.add(r.file);
      list(r.kinds, `${field}.kinds`, `What ${label.toLowerCase()} is for`, KINDS.length);
      if (!r.kinds.every((k) => KINDS.includes(k)) || new Set(r.kinds).size !== r.kinds.length) {
        throw bad(`${field}.kinds`, `What ${label.toLowerCase()} is for can only name the kinds of work offered, each once.`);
      }
      if (typeof r.note !== "string") throw bad(`${field}.note`, `The note on ${label.toLowerCase()} could not be read.`);
      return { file: r.file, kinds: KINDS.filter((k) => r.kinds.includes(k)), note: noteLine(r.note) };
    });
  },

  filler(v) {
    keysOnly(v, ["block", "allow"], "filler", "Machine-sounding filler");
    list(v.allow, "filler.allow", "Filler phrases you allow", LIMITS.allow);
    const allow = v.allow.map((x, i) => line(x, `filler.allow.${i}`, `Allowed phrase ${i + 1}`, { max: LIMITS.allowItem[1], least: LIMITS.allowItem[0] }).toLowerCase());
    return { block: bool(v.block, "filler.block", "Blocking machine-sounding filler"), allow: [...new Set(allow)] };
  },

  public(v) {
    keysOnly(v, ["summary"], "public", "What the Researcher may know");
    return { summary: para(v.summary, "public.summary", "The public summary", LIMITS.summary) };
  },
};

function colour(c, i) {
  const field = `colours.${i}`;
  const label = `Colour ${i + 1}`;
  keysOnly(c, ["name", "hex", "role"], field, label);
  if (typeof c.name !== "string" || !COLOUR_NAME.test(c.name)) {
    throw bad(`${field}.name`, `${label}'s name must start with a small letter and hold only small letters, digits and dashes, at most 24.`);
  }
  if (typeof c.hex !== "string" || !HEX.test(c.hex)) throw bad(`${field}.hex`, `${label} must be written as # and six letters or digits, such as #1A3C5E.`);
  if (!ROLES.includes(c.role)) throw bad(`${field}.role`, `${label}'s role must be main, accent, background, text or other.`);
  return { name: c.name, hex: c.hex.toUpperCase(), role: c.role };
}

function face(v, field, label, env) {
  keysOnly(v, ["family", "file", "fallback"], field, label);
  if (!FALLBACKS.includes(v.fallback)) throw bad(`${field}.fallback`, `${label}'s fallback must be serif, sans-serif or monospace.`);
  if (v.file === null) {
    if (typeof v.family !== "string" || !env.families.has(v.family)) throw bad(`${field}.family`, `${label} must be one of the fonts on this Mac or an uploaded font.`);
    return { family: v.family, file: null, fallback: v.fallback };
  }
  if (typeof v.file !== "string" || !env.fonts.has(v.file)) throw bad(`${field}.file`, `${label}'s file must be one of the uploaded fonts.`);
  if (typeof v.family !== "string" || !FAMILY.test(v.family)) {
    throw bad(`${field}.family`, `${label}'s name must hold only letters, digits, spaces and dashes, at most 60.`);
  }
  return { family: v.family, file: v.file, fallback: v.fallback };
}

// checkKit(raw, env) -> the kit as kit.json holds it (savedAt null until a save), or a KitError naming the field.
export function checkKit(raw, env) {
  if (!obj(raw)) throw bad(null, "The brand kit could not be read.");
  for (const k of Object.keys(raw)) if (!TOP.includes(k) && !OWN.includes(k)) throw bad(k, "The brand kit has a part it does not know.");
  const out = { version: 1, savedAt: null };
  for (const k of TOP) {
    if (!Object.hasOwn(raw, k)) throw bad(k, "The brand kit is missing a part.");
    out[k] = PARTS[k](raw[k], env);
  }
  return out;
}

// salvageKit(raw, env) -> { values, dropped }: every part of an untrusted kit that passes its rules
// (`values`, a partial kit) and the known names of the parts left out. A colour or a voice line that breaks a
// rule is dropped on its own when the rest still passes. Never throws.
export function salvageKit(raw, env) {
  const values = {};
  const dropped = [];
  if (!obj(raw)) return { values, dropped: raw === undefined ? [] : ["all"] };
  for (const k of TOP) {
    if (!Object.hasOwn(raw, k)) continue;
    try { values[k] = PARTS[k](raw[k], env); continue; } catch { /* try the parts below */ }
    let saved = null;
    try {
      if (k === "colours" && Array.isArray(raw[k])) {
        const good = raw[k].slice(0, 32).filter((c, i) => { try { colour(c, i); return true; } catch { return false; } });
        saved = PARTS.colours(good, env);
      } else if (k === "voice" && obj(raw[k])) {
        const v = raw[k];
        const lines = (a) => (Array.isArray(a) ? a.slice(0, 64).filter((x) => { try { line(x, "", "", { max: LIMITS.item }); return true; } catch { return false; } }).slice(0, LIMITS.items) : []);
        const words = Array.isArray(v.words) ? v.words.slice(0, 64).filter((w) => { try { line(w, "", "", { max: LIMITS.word, least: 1 }); return true; } catch { return false; } }).slice(0, LIMITS.words) : [];
        const safe = (f, d) => { try { return f(); } catch { return d; } };
        saved = PARTS.voice({
          words, do: lines(v.do), dont: lines(v.dont),
          is: safe(() => para(v.is, "", "", LIMITS.is), ""), signoff: safe(() => line(v.signoff, "", "", { max: LIMITS.signoff }), ""),
        }, env);
      }
    } catch { saved = null; }
    if (saved) values[k] = saved;
    dropped.push(k);
  }
  if (Object.keys(raw).some((k) => !TOP.includes(k) && !OWN.includes(k))) dropped.push("other");
  return { values, dropped };
}

// ---- the files written from the kit

const quote = (family) => `"${family}"`;
const stack = (f) => `${quote(f.family)}, ${f.fallback}`;

// kit.css: one custom property per colour, the two font stacks, the radius, the smallest size, and one
// @font-face per uploaded font the kit uses. Every value passed a pattern of checkKit: no free text.
export function kitCss(kit) {
  const out = ["/* The brand kit's tokens, written by the home server on every save. Change them in Files, Brand kit. */"];
  const seen = new Set();
  for (const f of [kit.type.heading, kit.type.body]) {
    if (!f.file || seen.has(f.file)) continue;
    seen.add(f.file);
    out.push(`@font-face { font-family: ${quote(f.family)}; src: url("fonts/${f.file}"); }`);
  }
  out.push(":root {");
  for (const c of kit.colours) out.push(`  --brand-${c.name}: ${c.hex};`);
  out.push(`  --brand-heading: ${stack(kit.type.heading)};`, `  --brand-body: ${stack(kit.type.body)};`);
  out.push(`  --brand-radius: ${kit.layout.radiusPx}px;`, `  --brand-min-size: ${kit.type.minPx}px;`, "}");
  return `${out.join("\n")}\n`;
}

const PLACE = {
  "carousel-last": "the last slide of a carousel", poster: "posters", "title-card": "title cards", "end-card": "end cards", page: "web pages",
};
// The four sections brand.md gains beyond the old form's own, as list fields (so renderForm writes them as plain text).
const EXTRA_FIELDS = [
  { id: "kit-colours", label: "Colours by name", kind: "list", required: false, max: 20 },
  { id: "kit-type", label: "Type", kind: "list", required: false, max: 20 },
  { id: "kit-logo", label: "Logo rules", kind: "list", required: false, max: 20 },
  { id: "kit-voice", label: "How we sound: do and don't", kind: "list", required: false, max: 40 },
];

const roleWords = { main: "the main colour", accent: "an accent", background: "a background", text: "for text", other: "" };

// The old brand form's answers and the four new sections, from the kit alone.
export function brandValues(kit, form) {
  const options = (form.fields.find((f) => f.id === "fonts")?.options) || [];
  const typeface = [kit.type.heading, kit.type.body].find((f) => !f.file && options.includes(f.family));
  const logo = kit.logo.files.find((f) => f.on === "light") || kit.logo.files[0];
  return {
    tone: kit.voice.words,
    colours: kit.colours.map((c) => c.hex),
    fonts: typeface ? typeface.family : "",
    signoff: kit.voice.signoff,
    logo: logo ? logo.file : "",
    "kit-colours": [
      ...kit.colours.map((c) => `${c.name}: ${c.hex}${roleWords[c.role] ? `, ${roleWords[c.role]}` : ""}`),
      kit.neutrals ? "Greys, black and white are allowed too." : "Greys, black and white are not allowed unless listed.",
    ],
    "kit-type": [
      `Headings: ${kit.type.heading.family}${kit.type.heading.file ? ` (uploaded font ${kit.type.heading.file})` : ""}, else ${kit.type.heading.fallback}`,
      `Body text: ${kit.type.body.family}${kit.type.body.file ? ` (uploaded font ${kit.type.body.file})` : ""}, else ${kit.type.body.fallback}`,
      `Smallest text on a page: ${kit.type.minPx} px`,
      `Smallest text on a slide: ${kit.type.minSlidePx} px`,
    ],
    "kit-logo": [
      ...(kit.logo.files.length ? kit.logo.files.map((f) => `${f.file}, on ${f.on} backgrounds`) : ["No logo file chosen yet."]),
      `Clear space: ${kit.logo.clearSpace} times the logo's height on every side`,
      `Smallest height: ${kit.logo.minPx} px`,
      kit.logo.requiredOn.length ? `Must appear on: ${kit.logo.requiredOn.map((p) => PLACE[p]).join(", ")}` : "Not required anywhere.",
    ],
    "kit-voice": [
      ...(kit.voice.is ? [`In short: ${kit.voice.is.replace(/\s+/g, " ")}`] : []),
      ...kit.voice.do.map((x) => `Do: ${x}`),
      ...kit.voice.dont.map((x) => `Don't: ${x}`),
    ],
  };
}

const extendedForm = (form) => ({ ...form, fields: [...form.fields, ...EXTRA_FIELDS] });

// brandMarkdown(kit, form, current) -> brand.md: the old form's headings and the four new sections. What a file
// that is there holds beyond them (an intro, a section written by hand) is kept, as a form save keeps it.
export function brandMarkdown(kit, form, current = "") {
  const ext = extendedForm(form);
  const parsed = parseForm(ext, current || "");
  const ours = new Set(ext.fields.flatMap((f) => [f.label, f.heading || ""].filter(Boolean).map((s) => s.replace(/\s+/g, " ").trim().toLowerCase().replace(/\s*\?$/, ""))));
  const unknown = parsed.unknown.filter((u) => !ours.has(String(u.heading).replace(/\s+/g, " ").trim().toLowerCase().replace(/\s*\?$/, "")));
  return renderForm(ext, brandValues(kit, form), { intro: parsed.intro, unknown });
}

const PUBLIC_INTRO = "What the Researcher may know about the company. Written by the home server from the brand kit.";
// brand-public.md: the name, the voice words and the public summary, and nothing else.
export function publicMarkdown(kit) {
  const form = {
    title: kit.name, fields: [
      { id: "words", label: "How we sound", kind: "list", required: false, max: LIMITS.words },
      { id: "summary", label: "About us", kind: "text", required: false },
    ],
  };
  return renderForm(form, { words: kit.voice.words, summary: kit.public.summary }, { intro: PUBLIC_INTRO });
}

// ---- starting values

export function emptyKit(families = []) {
  const first = families.includes("Helvetica Neue") ? "Helvetica Neue" : families[0] || "Helvetica Neue";
  const fallback = SERIF.has(first) ? "serif" : "sans-serif";
  return {
    version: 1, savedAt: null, name: "", colours: [], neutrals: true,
    type: { heading: { family: first, file: null, fallback }, body: { family: first, file: null, fallback }, minPx: 16, minSlidePx: 28 },
    logo: { files: [], clearSpace: 0.5, minPx: 48, requiredOn: [...REQUIRED_ON] },
    layout: { radiusPx: 0, marginShare: 0.06 },
    voice: { words: [], is: "", do: [], dont: [], signoff: "" },
    references: [], filler: { block: true, allow: [] }, public: { summary: "" },
  };
}

// kitFromOldForm(values, env, name) -> a starting kit from the old brand form's answers: its tone, its colours
// (named colour-1 and on, the first the main one), its typeface, sign-off and logo where they pass the rules.
export function kitFromOldForm(values, env, name = "") {
  const kit = emptyKit([...env.families]);
  const safe = (f, d) => { try { return f(); } catch { return d; } };
  kit.name = safe(() => line(name, "", "", { max: LIMITS.name }), "");
  const hexes = (Array.isArray(values.colours) ? values.colours : []).filter((h) => typeof h === "string" && HEX.test(h)).slice(0, LIMITS.colours[1]);
  kit.colours = hexes.map((h, i) => ({ name: `colour-${i + 1}`, hex: h.toUpperCase(), role: i === 0 ? "main" : "other" }));
  kit.voice.words = (Array.isArray(values.tone) ? values.tone : [])
    .filter((w) => { try { line(w, "", "", { max: LIMITS.word, least: 1 }); return true; } catch { return false; } }).slice(0, LIMITS.words);
  kit.voice.signoff = safe(() => line(values.signoff || "", "", "", { max: LIMITS.signoff }), "");
  if (typeof values.fonts === "string" && env.families.has(values.fonts)) {
    const f = { family: values.fonts, file: null, fallback: SERIF.has(values.fonts) ? "serif" : "sans-serif" };
    kit.type.heading = { ...f };
    kit.type.body = { ...f };
  }
  if (typeof values.logo === "string" && env.brandPictures.has(values.logo)) kit.logo.files = [{ file: values.logo, on: "light" }];
  return kit;
}

// ---- fonts

// The kind of font the first bytes say, or null: TrueType (00 01 00 00, `true`), OpenType (`OTTO`), a collection (`ttcf`).
export function fontKind(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) return null;
  const head = bytes.subarray(0, 4);
  if (head.equals(Buffer.from([0, 1, 0, 0])) || head.toString("latin1") === "true") return "truetype";
  if (head.toString("latin1") === "OTTO") return "opentype";
  if (head.toString("latin1") === "ttcf") return "collection";
  return null;
}

// fontFileName(name, bytes) -> the one safe name a font is stored under, or a KitError. Only the last part of
// the name counts; spaces become dashes; other characters are dropped; the ending must agree with the bytes.
export function fontFileName(name, bytes) {
  const kind = fontKind(bytes);
  if (!kind) throw ERR.fontType();
  let n = typeof name === "string" ? name.split(/[\\/]/).pop().normalize("NFC") : "";
  n = n.replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "").replace(/^[._-]+/, "").replace(/\.{2,}/g, ".");
  const m = n.match(/\.([A-Za-z0-9]+)$/);
  let base = m ? n.slice(0, -m[0].length) : n;
  const ext = m ? m[1].toLowerCase() : kind === "collection" ? "ttc" : kind === "opentype" ? "otf" : "ttf";
  const ok = kind === "collection" ? ext === "ttc" : ext === "ttf" || ext === "otf";
  if (!ok) throw ERR.fontType();
  base = base.replace(/[._-]+$/, "").slice(0, 55).replace(/[._-]+$/, "") || "font";
  const out = `${base}.${ext}`;
  if (!FONT_FILE.test(out)) throw ERR.fontType();
  return out;
}

// ---- the disk

const lstatOrNull = (p) => { try { return lstatSync(p); } catch { return null; } };
const realOrNull = (p) => { try { return realpathSync(p); } catch { return null; } };

// The place of each file, from config.paths.knowledgeDocs and config.paths.state only.
export function kitPaths(config) {
  const docs = config.paths.knowledgeDocs;
  const brand = join(docs, "brand");
  return {
    docs, brand, fonts: join(brand, "fonts"), kit: join(brand, "kit.json"), css: join(brand, "kit.css"),
    state: config.paths.state, knowledge: join(config.paths.state, "knowledge"), shared: join(config.paths.state, "knowledge", "shared"),
    playbooksIndex: join(config.paths.state, "playbooks", "index.json"),
    fontmap: join(config.engineDir || "", "art", "fontmap.json"),
    filler: join(config.engineDir || "", "company", "brand", "filler.json"),
  };
}

// A folder that must be a plain folder (lstat: not a link) whose real path is exactly `expected`.
// -> { dev, ino }, or null.
function plainDir(dir, expected) {
  const st = lstatOrNull(dir);
  if (!st || !st.isDirectory()) return null;
  return realOrNull(dir) === expected ? { dev: st.dev, ino: st.ino } : null;
}

// The same, made (0755) when missing. -> { dev, ino } or ERR.unsafe.
function ensureDir(dir, expected) {
  if (!lstatOrNull(dir)) {
    try { mkdirSync(dir, { mode: 0o755 }); } catch (e) { if (e?.code !== "EEXIST") throw e; }
  }
  const id = plainDir(dir, expected);
  if (!id) throw ERR.unsafe();
  return id;
}

// The real places of the brand folder (and its fonts) and of the shared folder: made when missing for a write.
function brandDirs(config, { create }) {
  const p = kitPaths(config);
  if (create) mkdirSync(p.docs, { recursive: true });
  const docsReal = realOrNull(p.docs);
  if (!docsReal) return null;
  const brandReal = join(docsReal, "brand");
  const brand = create ? ensureDir(p.brand, brandReal) : plainDir(p.brand, brandReal);
  return brand ? { p, brandReal, brand, fontsReal: join(brandReal, "fonts") } : null;
}

// Writes bytes as `name` in `dir` (checked to be `expected`): a new temp file (wx, no link followed, 0644,
// synced), then renamed over the old file, or linked in place when `replace` is false (never replacing what is
// there). What is at the name before must be a regular file or nothing; after, the folder must be the very
// folder checked and the name must hold the very file written, else it is undone and refused.
function putFile(dir, expected, name, bytes, { replace = true } = {}) {
  const dirId = plainDir(dir, expected);
  if (!dirId) throw ERR.unsafe();
  const dest = join(dir, name);
  const cur = lstatOrNull(dest);
  if (cur && !cur.isFile()) throw ERR.unsafe();
  if (cur && !replace) throw ERR.fontExists();
  const tmp = join(dir, `.kit-${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
  const fd = openSync(tmp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o644);
  let st;
  try {
    let at = 0;
    while (at < bytes.length) at += writeSync(fd, bytes, at, bytes.length - at);
    fchmodSync(fd, 0o644);
    fsyncSync(fd);
    st = fstatSync(fd);
  } catch (e) {
    try { closeSync(fd); } catch { /* already closed */ }
    rmSync(tmp, { force: true });
    throw e;
  }
  closeSync(fd);
  try {
    if (replace) renameSync(tmp, dest);
    else linkSync(tmp, dest);
  } catch (e) {
    rmSync(tmp, { force: true });
    if (e?.code === "EEXIST") throw ERR.fontExists();
    throw e;
  }
  if (!replace) unlinkSync(tmp);
  const nowDir = plainDir(dir, expected);
  const got = lstatOrNull(dest);
  if (!nowDir || nowDir.dev !== dirId.dev || nowDir.ino !== dirId.ino || !got || !got.isFile() || got.dev !== st.dev || got.ino !== st.ino) {
    if (got && got.isFile() && got.dev === st.dev && got.ino === st.ino) rmSync(dest, { force: true });
    throw ERR.unsafe();
  }
}

// The fonts on this Mac the tools know: the names of engine/art/fontmap.json.
export function fontsOnThisMac(config) {
  try {
    const map = JSON.parse(readFileSync(kitPaths(config).fontmap, "utf8"));
    return obj(map) ? Object.keys(map).filter((k) => FAMILY.test(k)).sort() : [];
  } catch { return []; }
}

// The uploaded fonts: [{ file, size }], regular files only (lstat), by name.
export function listFonts(config) {
  const d = brandDirs(config, { create: false });
  if (!d || !plainDir(d.p.fonts, d.fontsReal)) return [];
  const out = [];
  let dir;
  try { dir = opendirSync(d.p.fonts); } catch { return []; }
  try {
    let e;
    let seen = 0;
    while (seen < FONT_SCAN && (e = dir.readSync()) !== null) {
      seen += 1;
      if (!FONT_FILE.test(e.name)) continue;
      const st = lstatOrNull(join(d.p.fonts, e.name));
      if (st && st.isFile()) out.push({ file: e.name, size: st.size });
    }
  } finally {
    try { dir.closeSync(); } catch { /* already closed */ }
  }
  return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

// The rules' view of what is there: font names, uploaded fonts, and the pictures the store lists.
export function kitEnv(config, store) {
  const files = store.list();
  return {
    families: new Set(fontsOnThisMac(config)),
    fonts: new Set(listFonts(config).map((f) => f.file)),
    brandPictures: new Set(files.filter((f) => f.folder === "brand" && f.kind === "image").map((f) => f.name)),
    referencePictures: new Set(files.filter((f) => f.folder === "references" && f.kind === "image").map((f) => f.path)),
  };
}

// The saved kit file, unchecked: { raw, mtimeMs, problem } (raw undefined when there is none or it cannot be read).
export function readKitFile(config) {
  const d = brandDirs(config, { create: false });
  if (!d) return { kit: null, raw: undefined, mtimeMs: null, problem: null };
  const st = lstatOrNull(d.p.kit);
  if (!st) return { kit: null, raw: undefined, mtimeMs: null, problem: null };
  const read = st.isFile() ? readChecked(d.p.kit, d.p.brand, { maxBytes: KIT_MAX_BYTES }) : null;
  if (!read || read.truncated) return { kit: null, raw: undefined, mtimeMs: st.mtimeMs, problem: "kit_unreadable" };
  let raw;
  try { raw = JSON.parse(read.bytes.toString("utf8")); } catch { return { kit: null, raw: undefined, mtimeMs: st.mtimeMs, problem: "kit_unreadable" }; }
  return { kit: null, raw, mtimeMs: read.mtimeMs, problem: null };
}

// The version a save must name: the times of kit.json and brand.md, or null when neither is there.
export function versionOf(kitMs, brandVersion) {
  if (kitMs === null && !brandVersion) return null;
  return `k${kitMs === null ? 0 : Math.trunc(kitMs)}-b${brandVersion || 0}`;
}

function brandFileVersion(store) {
  const f = store.find("brand/brand.md");
  return f ? f.version : null;
}

export function currentVersion(config, store) {
  const d = brandDirs(config, { create: false });
  const st = d ? lstatOrNull(d.p.kit) : null;
  return versionOf(st ? st.mtimeMs : null, brandFileVersion(store));
}

// readKit(config, store, { brandForm, aboutForm }) -> { kit, exists, version, fromOldForm, problem }. Writes nothing.
export function readKit(config, store, { brandForm = null, aboutForm = null } = {}) {
  const env = kitEnv(config, store);
  const file = readKitFile(config);
  const version = versionOf(file.mtimeMs, brandFileVersion(store));
  if (file.mtimeMs !== null) {
    if (file.problem) return { kit: emptyKit([...env.families]), exists: true, version, fromOldForm: false, problem: file.problem, env };
    try {
      const kit = checkKit(file.raw, env);
      kit.savedAt = obj(file.raw) && typeof file.raw.savedAt === "string" && Number.isFinite(Date.parse(file.raw.savedAt)) ? file.raw.savedAt : null;
      return { kit, exists: true, version, fromOldForm: false, problem: null, env };
    } catch {
      // A kit that no longer passes (a picture or a font removed since): what still passes, over the empty kit.
      const { values } = salvageKit(file.raw, env);
      return { kit: { ...emptyKit([...env.families]), ...values }, exists: true, version, fromOldForm: false, problem: "kit_out_of_date", env };
    }
  }
  if (brandForm && store.find("brand/brand.md")) {
    let name = "";
    if (aboutForm) { try { name = readForm(store, aboutForm).values.name || ""; } catch { name = ""; } }
    const old = readForm(store, brandForm);
    return { kit: kitFromOldForm(old.values, env, name), exists: false, version, fromOldForm: true, problem: null, env };
  }
  return { kit: emptyKit([...env.families]), exists: false, version, fromOldForm: false, problem: null, env };
}

// Before anything is written: every folder a save writes into is a plain folder (or not made yet) and every
// file it replaces is a regular file (or not there), so a refused save leaves every file as it was.
function saveTargetsSafe(config) {
  const p = kitPaths(config);
  const okFile = (f) => { const st = lstatOrNull(f); return !st || st.isFile(); };
  const docsReal = realOrNull(p.docs);
  const stateReal = realOrNull(p.state);
  if (!stateReal || !plainDir(p.knowledge, join(stateReal, "knowledge"))) throw ERR.unsafe();
  if (docsReal && lstatOrNull(p.brand) && !plainDir(p.brand, join(docsReal, "brand"))) throw ERR.unsafe();
  if (lstatOrNull(p.shared) && !plainDir(p.shared, join(stateReal, "knowledge", "shared"))) throw ERR.unsafe();
  if (![p.kit, p.css, join(p.shared, "brand-public.md")].every(okFile)) throw ERR.unsafe();
}

const sameVersion = (a, b) => (a === null ? b === null || b === undefined || b === "" : a === b);

// saveKit(config, store, raw, version, { brandForm, now }) -> { kit, version }. Refuses a kit that breaks a
// rule (400, naming the field) and a version that is not the current one (409), as the forms do.
export function saveKit(config, store, raw, version, { brandForm, now = new Date() } = {}) {
  if (!brandForm) throw new KitError(503, "The brand form is not in the engine folder, so the brand kit cannot be saved.", "Restore the engine folder, then try again.", "form_missing");
  const env = kitEnv(config, store);
  const kit = checkKit(raw, env);
  if (!sameVersion(currentVersion(config, store), version)) throw ERR.changed();
  kit.savedAt = now.toISOString();
  saveTargetsSafe(config);

  // brand.md through the store, at the version just checked, keeping what the file holds beyond the form.
  const current = store.find("brand/brand.md");
  let text = "";
  if (current) {
    const got = store.get(current.token);
    if (got.truncated) throw new KitError(409, "Your brand file has grown too long to rewrite.", "Open it in Files and shorten it, then try again.", "too_long_for_form");
    text = got.text || "";
  }
  store.replace("brand/brand.md", brandMarkdown(kit, brandForm, text), current ? current.version : null);

  const d = brandDirs(config, { create: true });
  if (!d) throw ERR.unsafe();
  putFile(d.p.brand, d.brandReal, "kit.json", Buffer.from(`${JSON.stringify(kit, null, 2)}\n`, "utf8"));
  putFile(d.p.brand, d.brandReal, "kit.css", Buffer.from(kitCss(kit), "utf8"));

  const stateReal = realOrNull(d.p.state);
  if (!stateReal || !plainDir(d.p.knowledge, join(stateReal, "knowledge"))) throw ERR.unsafe();
  ensureDir(d.p.shared, join(stateReal, "knowledge", "shared"));
  putFile(d.p.shared, join(stateReal, "knowledge", "shared"), "brand-public.md", Buffer.from(publicMarkdown(kit), "utf8"));
  return { kit, version: currentVersion(config, store) };
}

// addFont(config, name, bytes) -> { file, size }. Never replaces a font that is there.
export function addFont(config, name, bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw ERR.fontType();
  if (bytes.length > FONT_MAX_BYTES) throw ERR.fontLarge();
  const file = fontFileName(name, bytes);
  if (listFonts(config).length >= FONT_MAX_FILES) throw ERR.fontMany();
  const d = brandDirs(config, { create: true });
  if (!d) throw ERR.unsafe();
  ensureDir(d.p.fonts, d.fontsReal);
  putFile(d.p.fonts, d.fontsReal, file, bytes, { replace: false });
  return { file, size: bytes.length };
}

// removeFont(config, file) -> { ok: true }. A font the saved kit uses is refused.
export function removeFont(config, file) {
  if (typeof file !== "string" || !FONT_FILE.test(file) || !listFonts(config).some((f) => f.file === file)) throw ERR.fontMissing();
  const { raw } = readKitFile(config);
  const t = obj(raw) && obj(raw.type) ? raw.type : {};
  if ([t.heading, t.body].some((f) => obj(f) && f.file === file)) throw ERR.fontInUse();
  const d = brandDirs(config, { create: false });
  if (!d || !plainDir(d.p.fonts, d.fontsReal)) throw ERR.fontMissing();
  const path = join(d.p.fonts, file);
  const st = lstatOrNull(path);
  if (!st || !st.isFile()) throw ERR.fontMissing();
  unlinkSync(path);
  return { ok: true };
}

// ---- what an agent proposed

// The goal identifier of `?proposal=`: an identifier as it is, a task id through the board. -> string or null.
export async function proposalIdentifier(ctx, id) {
  if (typeof id !== "string") return null;
  if (IDENTIFIER.test(id)) return id;
  if (!UUID.test(id) || !ctx.board || typeof ctx.board.get !== "function") return null;
  try {
    const issue = await ctx.board.get(`/api/issues/${encodeURIComponent(id)}`);
    return issue && typeof issue.identifier === "string" && IDENTIFIER.test(issue.identifier) ? issue.identifier : null;
  } catch { return null; }
}

// readProposal(config, identifier, env) -> { from, values, dropped, problem }: brand-proposal.json of the
// goal's folder, at most 64 KB, opened once with no link followed, each part through the rules. Never throws.
export function readProposal(config, identifier, env) {
  const none = (problem) => ({ from: identifier || null, values: {}, dropped: [], problem });
  if (!identifier) return none("That task could not be found.");
  let read;
  try { read = readTaskText(config, identifier, "brand-proposal.json", { maxBytes: PROPOSAL_MAX_BYTES }); } catch { read = null; }
  if (!read) return none("There is no brand proposal in that task's folder.");
  if (read.truncated) return none("The brand proposal is too large to read.");
  let raw;
  try { raw = JSON.parse(read.text); } catch { return none("The brand proposal could not be read."); }
  if (!obj(raw)) return none("The brand proposal could not be read.");
  const { values, dropped } = salvageKit(raw, env);
  return { from: identifier, values, dropped, problem: null };
}

// ---- what the page shows beside the kit

// The playbooks' index (written by engine/playbooks/install.sh): its rows, each field checked and capped.
export function readPlaybooks(config) {
  const p = kitPaths(config);
  const read = readChecked(p.playbooksIndex, join(p.state, "playbooks"), { maxBytes: INDEX_MAX_BYTES });
  if (!read || read.truncated) return [];
  let data;
  try { data = JSON.parse(read.bytes.toString("utf8")); } catch { return []; }
  const rows = Array.isArray(data) ? data : obj(data) && Array.isArray(data.playbooks) ? data.playbooks : [];
  const slugs = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && SLUG.test(x)).slice(0, 20) : []);
  return rows.slice(0, 60).filter((r) => obj(r) && typeof r.name === "string" && PLAYBOOK.test(r.name)).map((r) => ({
    name: r.name,
    origin: r.origin === "own" ? "own" : "third-party",
    licence: typeof r.licence === "string" ? stripInvisible(r.licence).replace(/\s+/g, " ").trim().slice(0, 80) : "",
    roles: slugs(r.roles),
    kinds: slugs(r.kinds),
    files: Array.isArray(r.files) ? r.files.filter((x) => typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9._\/*-]{0,99}$/.test(x)).slice(0, 50) : [],
    bytes: whole(r.bytes) && r.bytes >= 0 ? r.bytes : 0,
  }));
}

// How many shipped filler phrases the switch "Also block machine-sounding filler" blocks, or null.
export function fillerCount(config) {
  try {
    const f = JSON.parse(readFileSync(kitPaths(config).filler, "utf8"));
    if (!obj(f)) return null;
    return (Array.isArray(f.hard) ? f.hard.length : 0) + (Array.isArray(f.soft) ? f.soft.length : 0);
  } catch { return null; }
}
