// Files, Brand kit (PLAN-V5 K5, T14; redrawn in PLAN-COOK T69): where the owner turns a brand book into rules every
// tool obeys. The kit's frame (kit/layout.js DocLayout): a list of its parts (Logo, Colours, Type, Layout, Pictures,
// Words, References), each saying what is set, and one column of groups and rows for the chosen part. The owner's
// colours as swatches in outlined tiles, the two faces in a sample, the logo on the light and the dark ground it will
// sit on; the screen's own chrome stays quiet so the owner's colours and faces are the only colour and display type.
// Reached at #/files/brand-kit (the Files page hands this address over); the part is in the address
// ("#/files/brand-kit?s=colours"; no `s` is Logo); `?proposal=<task>` lays what the "Read the brand book" job
// proposed beside each part. One Save sends the whole kit, whichever part is open.
// Nothing an agent wrote is ever set as HTML: a proposal's values are shown as text, a colour only after it passed
// the hex pattern, a face only after it passed the family pattern, a picture only from the brain's own raw address.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { bytes, fileToken, fullWhen } from "../lib/format.js";
import {
  Button, Card, DataTable, DocLayout, ErrorNotice, Field, FilePicker, Group, Icon, Loading, Notice, Row, Rows, Select,
  StatusDot, Switch, Tag, TextArea, TextInput,
} from "../kit/index.js";

// ---------------------------------------------------------------------------------------------------------------
// Words and rules (K5)

export const WORDS = {
  card: "Brand kit: your colours, type, logo, voice and examples. Agents' tools obey it.",
  lead: "Your colours, type, logo, voice and examples. Every agent's tools obey it.",
  restart: "This page appears after the home screen is restarted: engine stop, then engine start.",
  saved: "Saved. Every tool uses this from now on.",
  fromBook: "From your brand book. Nothing is saved until you press Save.",
  fromOld: "From your old brand page. Nothing is enforced until you press Save.",
  notSaved: "Not saved yet. Nothing is enforced until you save.",
  researcher: "Only this, your company's name and your voice words are shared with the Researcher.",
  noPicks: "Nothing yet. When you pick between versions, your choices and notes are kept here for the agents.",
  noPlaybooks: "Playbooks are not in place yet. See Health.",
  changed: "The brand kit changed since you opened it.",
  save: "Save the brand kit",
};

export const PROBLEMS = {
  kit_unreadable: "Your saved brand kit could not be read, so the tools are not using it. Fill it in again and save to replace it.",
  kit_out_of_date: "Part of your saved brand kit no longer matches your files: a picture or a font it named is gone. What still fits is shown here. Check it and save again.",
};

export const LIMITS = { colours: [2, 8], words: 5, items: 12, item: 200, references: 24, logos: 4, summary: 600, fonts: 6, fontBytes: 5 * 1024 * 1024 };
export const ROLES = ["main", "accent", "background", "text", "other"];
export const ROLE_WORDS = { main: "Main colour", accent: "Accent", background: "Background", text: "Text", other: "Other" };
export const KINDS = ["post", "newsletter", "carousel", "poster", "title-card", "film", "page"];
export const KIND_WORDS = { post: "Posts", newsletter: "Newsletters", carousel: "Carousels", poster: "Posters", "title-card": "Title cards", film: "Films", page: "Web pages" };
export const PLACES = ["carousel-last", "poster", "title-card", "end-card", "page"];
export const PLACE_WORDS = { "carousel-last": "The last slide of a carousel", poster: "Posters", "title-card": "Title cards", "end-card": "End cards", page: "Web pages" };
const FALLBACKS = ["serif", "sans-serif", "monospace"];
const FALLBACK_WORDS = { serif: "A serif", "sans-serif": "A sans serif", monospace: "A typewriter face" };
const SERIF = new Set(["Georgia", "Baskerville", "Didot"]);
const CLEAR_SPACES = [0, 0.25, 0.5, 0.75, 1, 1.5, 2];
const RADII = [0, 2, 4, 8, 12, 16, 24, 32];
const MARGINS = [0, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.12, 0.15];

const HEX = /^#[0-9A-F]{6}$/;
const COLOUR_NAME = /^[a-z][a-z0-9-]{0,23}$/;
const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 -]{0,59}$/;
const FONT_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}\.(ttf|otf|ttc)$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TASTE_PATH = "brand/taste.md";
const TOP = ["name", "colours", "neutrals", "type", "logo", "layout", "voice", "references", "filler", "public"];

// The parts of the page, in the order a first-time owner fills them, with what each changes in the work.
export const PARTS = [
  { id: "name", title: "Name", changes: "Written the same way in every piece." },
  { id: "colours", title: "Colours", changes: "Slides, title cards and pages use only these. The brand check flags any other colour." },
  { id: "type", title: "Type", changes: "Every heading and line is set in these faces, never smaller than your sizes." },
  { id: "logo", title: "Logo", changes: "The tools place it where you say and keep its clear space." },
  { id: "voice", title: "How we sound", changes: "Every draft is written this way and checked against your don'ts." },
  { id: "references", title: "Examples", changes: "The Art director scores new work against these." },
  { id: "public", title: "For the Researcher", changes: "The only words about you the Researcher sees." },
];

const str = (v) => (typeof v === "string" ? v : "");
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const cut = (v, n) => str(v).slice(0, n);
const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (tested in test/pages/brand-kit.test.mjs)

// The address of the kit, with a proposal's task when one is asked for (a task id or an identifier, nothing else).
export function kitAddress(proposal) {
  const p = str(proposal);
  return REF.test(p) ? `/api/brand/kit?proposal=${encodeURIComponent(p)}` : "/api/brand/kit";
}

// What the page draws: "loading", "restart" (the route is not there yet), "error" or "ready".
export function viewState(res) {
  if (res && res.data) return "ready";
  if (res && res.error) return res.error.status === 404 ? "restart" : "error";
  return "loading";
}

// "#1a3c5e", "1A3C5E", " #1a3c5e " -> "#1A3C5E"; anything else is returned trimmed, for the rules to name.
export function normHex(v) {
  const s = str(v).trim();
  const bare = s.replace(/^#/, "");
  return /^[0-9A-Fa-f]{6}$/.test(bare) ? `#${bare.toUpperCase()}` : s;
}

// "Deep Ink" -> "deep-ink": small letters, digits and dashes, as a colour's name must be.
export function normName(v) {
  return str(v).trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-{2,}/g, "-").slice(0, 24);
}

// A colour that passed the pattern, or null: only such a value is ever put in a style.
export const safeHex = (v) => (HEX.test(normHex(v)) ? normHex(v) : null);

// The relative luminance of a colour (0 black to 1 white), or null.
export function luminance(hex) {
  const h = safeHex(hex);
  if (!h) return null;
  const ch = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

// The contrast of two colours, 1 to 21, or null.
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// The ink that reads on a colour: near black on a light one, white on a dark one.
export const inkOn = (hex) => ((luminance(hex) ?? 0) > 0.36 ? "#141414" : "#FFFFFF");

// A face as a CSS font stack, or "inherit" when its name or fallback does not pass.
export function fontStack(face) {
  const f = obj(face) ? face : {};
  if (!FAMILY.test(str(f.family)) || !FALLBACKS.includes(f.fallback)) return "inherit";
  return `"${f.family}", ${f.fallback}`;
}

// The name an uploaded font is known by, from its file: "Sthyra-Display.otf" -> "Sthyra Display".
export function familyFromFile(file) {
  const base = str(file).replace(/\.(ttf|otf|ttc)$/i, "").replace(/[._-]+/g, " ").replace(/[^A-Za-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 60).trim();
  return FAMILY.test(base) ? base : "Uploaded font";
}

// A kit with nothing in it, as the server starts one.
export function emptyKit(families = []) {
  const list = arr(families);
  const first = list.includes("Helvetica Neue") ? "Helvetica Neue" : str(list[0]) || "Helvetica Neue";
  const fallback = SERIF.has(first) ? "serif" : "sans-serif";
  return {
    version: 1, savedAt: null, name: "", colours: [], neutrals: true,
    type: { heading: { family: first, file: null, fallback }, body: { family: first, file: null, fallback }, minPx: 16, minSlidePx: 28 },
    logo: { files: [], clearSpace: 0.5, minPx: 48, requiredOn: [...PLACES] },
    layout: { radiusPx: 0, marginShare: 0.06 },
    voice: { words: [], is: "", do: [], dont: [], signoff: "" },
    references: [], filler: { block: true, allow: [] }, public: { summary: "" },
  };
}

// The kit as the page edits it: the same shape, with the two typed sizes as text so typing never jumps.
export function formFromKit(kit) {
  const k = { ...emptyKit(), ...(obj(kit) ? clone(kit) : {}) };
  const t = obj(k.type) ? k.type : emptyKit().type;
  return {
    ...k,
    colours: arr(k.colours).map((c) => ({ name: str(c && c.name), hex: str(c && c.hex), role: ROLES.includes(c && c.role) ? c.role : "other" })),
    type: { ...t, minPx: t.minPx === undefined ? "" : String(t.minPx), minSlidePx: t.minSlidePx === undefined ? "" : String(t.minSlidePx) },
    logo: { ...emptyKit().logo, ...(obj(k.logo) ? k.logo : {}), minPx: obj(k.logo) && k.logo.minPx !== undefined ? String(k.logo.minPx) : "48" },
    voice: { ...emptyKit().voice, ...(obj(k.voice) ? k.voice : {}) },
  };
}

// A typed number as a number when it is one, else the text as it is (the server then names the field).
const typed = (v) => {
  const s = str(v).trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
};

// The kit to send, from the page's state: names and colours tidied, sizes as numbers, empty lines left out.
export function kitFromForm(form) {
  const f = obj(form) ? form : formFromKit(null);
  const lines = (list) => arr(list).map((x) => str(x).trim()).filter(Boolean);
  const out = {};
  for (const k of TOP) out[k] = clone(f[k] === undefined ? emptyKit()[k] : f[k]);
  out.name = str(f.name).trim();
  out.colours = arr(f.colours).map((c) => ({ name: normName(c.name), hex: normHex(c.hex), role: c.role }));
  out.type = { ...out.type, minPx: typed(f.type && f.type.minPx), minSlidePx: typed(f.type && f.type.minSlidePx) };
  out.logo = { ...out.logo, minPx: typed(f.logo && f.logo.minPx) };
  out.voice = { ...out.voice, words: lines(out.voice.words), is: str(out.voice.is).trim(), do: lines(out.voice.do), dont: lines(out.voice.dont), signoff: str(out.voice.signoff).trim() };
  out.references = arr(out.references).map((r) => ({ file: str(r.file), kinds: KINDS.filter((k) => arr(r.kinds).includes(k)), note: str(r.note).trim() }));
  out.public = { summary: str(out.public && out.public.summary).trim() };
  return out;
}

// The colour rules the owner can be told about before anything is sent: [{ field, message }], first problem per field.
export function colourProblems(colours) {
  const list = arr(colours);
  const out = [];
  if (list.length < LIMITS.colours[0]) out.push({ field: "colours", message: `The brand kit needs at least ${LIMITS.colours[0]} colours.` });
  if (list.length > LIMITS.colours[1]) out.push({ field: "colours", message: `The brand kit takes at most ${LIMITS.colours[1]} colours.` });
  const seen = new Set();
  list.forEach((c, i) => {
    const name = normName(c && c.name);
    if (!COLOUR_NAME.test(name)) out.push({ field: `colours.${i}.name`, message: `Colour ${i + 1} needs a name in small letters, such as ink or sand.` });
    else if (seen.has(name)) out.push({ field: `colours.${i}.name`, message: `Colour ${i + 1}: another colour already has the name "${name}".` });
    seen.add(name);
    if (!safeHex(c && c.hex)) out.push({ field: `colours.${i}.hex`, message: `Colour ${i + 1} must be written as # and six letters or digits, such as #1A3C5E.` });
  });
  const mains = list.filter((c) => c && c.role === "main").length;
  if (list.length && mains !== 1) out.push({ field: "colours", message: mains ? "Only one colour can be the main colour." : "Mark one colour as the main colour." });
  return out;
}

// The colours with colour `i` given `role`. Choosing "main" makes the old main colour "other", so there is always one.
export function withRole(colours, i, role) {
  const list = arr(colours).map((c) => ({ ...c }));
  if (!list[i] || !ROLES.includes(role)) return list;
  if (role === "main") list.forEach((c, j) => { if (j !== i && c.role === "main") c.role = "other"; });
  list[i].role = role;
  return list;
}

// A new colour row: the first is the main colour.
export function addColour(colours) {
  const list = arr(colours);
  if (list.length >= LIMITS.colours[1]) return list;
  return [...list, { name: "", hex: "", role: list.some((c) => c.role === "main") ? "other" : "main" }];
}

// The colours without row `i`; when the main one goes, the first left becomes main.
export function removeColour(colours, i) {
  const list = arr(colours).filter((_, j) => j !== i).map((c) => ({ ...c }));
  if (list.length && !list.some((c) => c.role === "main")) list[0].role = "main";
  return list;
}

// The colour a role names, or null.
export const colourFor = (colours, role) => safeHex((arr(colours).find((c) => c && c.role === role) || {}).hex);

// The two grounds the logo is shown on: the kit's own light and dark colours when it has them.
export function stages(colours) {
  const list = arr(colours).map((c) => safeHex(c && c.hex)).filter(Boolean);
  const byLum = [...list].sort((a, b) => luminance(b) - luminance(a));
  const bg = colourFor(colours, "background");
  const light = bg && luminance(bg) > 0.5 ? bg : byLum.find((h) => luminance(h) > 0.6) || "#FFFFFF";
  const dark = [colourFor(colours, "main"), colourFor(colours, "text"), ...byLum.slice().reverse()].find((h) => h && luminance(h) < 0.12) || "#141414";
  return { light, dark };
}

// The logo files with one picture used, or no longer used, on a light or dark ground (at most four in all).
export function toggleLogo(files, name, on) {
  const list = arr(files);
  if (list.some((f) => f.file === name && f.on === on)) return list.filter((f) => !(f.file === name && f.on === on));
  return list.length >= LIMITS.logos ? list : [...list, { file: name, on }];
}

// The parts filled, for the path at the top: { <part id>: bool }.
export function filledParts(kit, exists = false) {
  const k = obj(kit) ? kit : emptyKit();
  const v = obj(k.voice) ? k.voice : {};
  const base = emptyKit();
  return {
    name: Boolean(str(k.name).trim()),
    colours: arr(k.colours).length >= 2 && arr(k.colours).filter((c) => c && c.role === "main").length === 1,
    type: Boolean(exists) || !same(obj(k.type) ? [k.type.heading, k.type.body] : null, [base.type.heading, base.type.body]),
    logo: arr(k.logo && k.logo.files).length > 0,
    voice: arr(v.words).filter((w) => str(w).trim()).length > 0 || Boolean(str(v.is).trim()),
    references: arr(k.references).length > 0,
    public: Boolean(str(k.public && k.public.summary).trim()),
  };
}

// The first part not filled yet, or null.
export const nextPart = (filled) => (PARTS.find((p) => !(filled && filled[p.id])) || {}).id || null;

// The titles of the parts that differ between two kits, in the page's order.
export function changedParts(before, after) {
  const a = obj(before) ? before : {};
  const b = obj(after) ? after : {};
  const titles = { neutrals: "Colours", filler: "How we sound", layout: "Type", name: "Name", colours: "Colours", type: "Type", logo: "Logo", voice: "How we sound", references: "Examples", public: "For the Researcher" };
  const out = [];
  for (const k of TOP) if (!same(a[k], b[k]) && !out.includes(titles[k])) out.push(titles[k]);
  const order = PARTS.map((p) => p.title);
  return out.sort((x, y) => order.indexOf(x) - order.indexOf(y));
}

// Where a refusal's field belongs: { part, inline } (inline: an input on the page carries it by that name).
const INLINE = /^(name|colours\.\d+\.(name|hex|role)|type\.(heading|body)\.(family|file|fallback)|type\.(minPx|minSlidePx)|logo\.minPx|voice\.(words|is|signoff)|voice\.(do|dont)\.\d+|voice\.words\.\d+|references\.\d+\.(note|kinds)|public\.summary)$/;
const PART_OF = { neutrals: "colours", layout: "type", filler: "voice" };
export function fieldPlace(field) {
  const f = str(field);
  const top = f.split(".")[0];
  if (!TOP.includes(top)) return { part: null, inline: false };
  return { part: PART_OF[top] || top, inline: INLINE.test(f) };
}

// The offers to lay beside the form: each part of a proposal (from the brand book) and of the old brand page,
// as { key, value, from }. Voice is offered line by line; the brand book wins over the old page.
const VOICE_KEYS = ["words", "is", "do", "dont", "signoff"];
export function offersOf({ proposal, oldKit, families } = {}) {
  const out = {};
  const add = (values, from) => {
    if (!obj(values)) return;
    for (const k of TOP) {
      if (!Object.hasOwn(values, k)) continue;
      if (k === "voice" && obj(values.voice)) {
        for (const vk of VOICE_KEYS) {
          const v = values.voice[vk];
          if ((Array.isArray(v) && v.length) || (typeof v === "string" && v.trim())) out[`voice.${vk}`] = { key: `voice.${vk}`, value: clone(v), from };
        }
      } else out[k] = { key: k, value: clone(values[k]), from };
    }
  };
  if (obj(oldKit)) {
    const base = emptyKit(families);
    const old = {};
    for (const k of TOP) if (!same(oldKit[k], base[k])) old[k] = oldKit[k];
    if (obj(old.voice)) old.voice = { ...base.voice, ...old.voice };
    add(old, "old");
  }
  if (obj(proposal) && obj(proposal.values)) add(proposal.values, "book");
  return out;
}

// The form with one offer used: "colours" replaces the colours, "voice.do" only the do lines.
export function useOffer(form, key, value) {
  const f = clone(obj(form) ? form : formFromKit(null));
  const [top, sub] = str(key).split(".");
  if (!TOP.includes(top)) return f;
  if (top === "voice" && sub) { f.voice = { ...f.voice, [sub]: clone(value) }; return f; }
  const fresh = formFromKit({ ...kitFromForm(f), [top]: clone(value) });
  f[top] = fresh[top];
  return f;
}

// The value of an offer's key in the form, to tell whether it has been used.
export function valueAt(form, key) {
  const [top, sub] = str(key).split(".");
  const k = kitFromForm(form);
  return sub ? (k[top] || {})[sub] : k[top];
}

// Whether the form already holds what an offer proposes.
export const offerUsed = (form, offer) => Boolean(offer) && same(valueAt(form, offer.key), valueAt(useOffer(form, offer.key, offer.value), offer.key));

// "Marketer, Art director" from role slugs.
export const roleName = (slug) => (SLUG.test(str(slug)) ? slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " ") : "");

// The lines of the taste file as headings and entries, for plain text on screen.
export function tasteLines(text) {
  return str(text).split(/\r?\n/).slice(0, 400).map((l) => l.trimEnd()).filter((l) => l.trim() && !/^#\s/.test(l))
    .map((l) => (/^##\s+/.test(l) ? { kind: "head", text: cut(l.replace(/^##\s+/, ""), 80) } : { kind: "line", text: cut(l.replace(/^[-*]\s+/, ""), 400) }));
}

// The choices of a typeface: the fonts on this Mac, then the uploaded ones.
export function faceOptions(macFonts, uploaded) {
  return [
    ...arr(macFonts).filter((n) => FAMILY.test(str(n))).map((n) => ({ value: `mac:${n}`, label: n })),
    ...arr(uploaded).filter((u) => u && FONT_FILE.test(str(u.file))).map((u) => ({ value: `file:${u.file}`, label: `${familyFromFile(u.file)} (your file)` })),
  ];
}

// The choice a face stands at, and the face a choice makes (the fallback kept).
export const faceValue = (face) => (obj(face) && face.file ? `file:${face.file}` : `mac:${str(obj(face) && face.family)}`);
export function faceFrom(value, current) {
  const v = str(value);
  const fallback = FALLBACKS.includes(current && current.fallback) ? current.fallback : "sans-serif";
  if (v.startsWith("file:")) return { family: familyFromFile(v.slice(5)), file: v.slice(5), fallback };
  const family = v.slice(4);
  return { family, file: null, fallback: SERIF.has(family) ? "serif" : fallback };
}

// A select's options with the current value added when it is not one of them.
function withCurrent(options, value, label) {
  return options.some((o) => o.value === value) ? options : [...options, { value, label }];
}

// ---------------------------------------------------------------------------------------------------------------
// The kit's parts as the sections of the page (PLAN-COOK T69), and what each section's line says is set

// The sections, in order; `keys` are the kit's top-level keys each one edits.
export const SECTIONS = [
  { id: "logo", label: "Logo", icon: "spark", keys: ["logo"] },
  { id: "colours", label: "Colours", icon: "brush", keys: ["colours", "neutrals"] },
  { id: "type", label: "Type", icon: "docs", keys: ["type"] },
  { id: "layout", label: "Layout", icon: "grid", keys: ["layout"] },
  { id: "pictures", label: "Pictures", icon: "image", keys: ["references"] },
  { id: "words", label: "Words", icon: "reply", keys: ["name", "voice", "filler", "public"] },
  { id: "references", label: "References", icon: "book", keys: [] },
];
const SECTION_IDS = SECTIONS.map((s) => s.id);

// The page's own new words (T69): section intros, group titles and the lines in the list of sections.
export const SECTION_WORDS = {
  notSet: "Not set yet",
  startHere: "Start here",
  nothingYet: "Nothing yet",
  noPicks: "No picks yet",
  notSaved: "not saved",
  proposed: "Proposed",
  layoutIntro: "Corners and margins every slide, title card and page keeps.",
  referencesIntro: "What the agents read beside your kit: your picks between versions and the playbooks.",
  grounds: "On its grounds",
  logoFiles: "Your logo files",
  placing: "How it is placed",
  palette: "Your palette",
  sample: "Sample",
  faces: "Faces",
  sizes: "Smallest sizes",
  corners: "Corners and margins",
  examples: "Examples of work you approve",
  name: "Name",
  voice: "How we sound",
  researcher: "For the Researcher",
  pairing: "Text on your background",
  fillYourself: "Or fill it in yourself",
  startColours: "Start with colours",
  pressSave: "Press \"Save the brand kit\"",
};

// The section an address asks for: `s` when it is one, else Logo.
export function sectionOf(query) {
  const s = query && typeof query.get === "function" ? query.get("s") : null;
  return SECTION_IDS.includes(s) ? s : SECTION_IDS[0];
}

// The address of a section, with the proposal being read kept.
export function sectionHref(id, proposal) {
  const q = [];
  if (SECTION_IDS.includes(id) && id !== SECTION_IDS[0]) q.push(`s=${id}`);
  if (REF.test(str(proposal))) q.push(`proposal=${encodeURIComponent(proposal)}`);
  return `#/files/brand-kit${q.length ? `?${q.join("&")}` : ""}`;
}

// The section a refusal's field is shown in, or null.
export function fieldSection(field) {
  const top = str(field).split(".")[0];
  const s = SECTIONS.find((x) => x.keys.includes(top));
  return s ? s.id : null;
}

// The ids of the sections whose part differs between two kits, in the page's order.
export function changedSections(before, after) {
  const a = obj(before) ? before : {};
  const b = obj(after) ? after : {};
  return SECTIONS.filter((s) => s.keys.some((k) => !same(a[k], b[k]))).map((s) => s.id);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pct = (share) => `${Math.round(Number(share) * 1000) / 10}%`;

// What one section's line says is set: words, or null when nothing is set yet.
export function sectionSet(id, kit, { exists = false, playbooks } = {}) {
  const k = obj(kit) ? kit : emptyKit();
  const base = emptyKit();
  if (id === "logo") {
    const on = new Set(arr(k.logo && k.logo.files).map((f) => f && f.on));
    if (on.has("light") && on.has("dark")) return "On light and dark";
    if (on.has("light")) return "On light only";
    if (on.has("dark")) return "On dark only";
    return null;
  }
  if (id === "colours") {
    const n = arr(k.colours).filter((c) => safeHex(c && c.hex)).length;
    return n ? plural(n, "colour", "colours") : null;
  }
  if (id === "type") {
    if (!filledParts(k, exists).type) return null;
    const h = cut(k.type && k.type.heading && k.type.heading.family, 28);
    const b = cut(k.type && k.type.body && k.type.body.family, 28);
    return h === b || !b ? h || null : `${h} and ${b}`;
  }
  if (id === "layout") {
    const l = obj(k.layout) ? k.layout : base.layout;
    if (!exists && same(l, base.layout)) return null;
    const r = Number(l.radiusPx) || 0;
    return `${r ? `${r} px corners` : "Square corners"}, ${pct(l.marginShare)} margins`;
  }
  if (id === "pictures") {
    const n = arr(k.references).length;
    return n ? plural(n, "example", "examples") : null;
  }
  if (id === "words") {
    const n = arr(k.voice && k.voice.words).filter((w) => str(w).trim()).length;
    if (n) return plural(n, "word", "words");
    return str(k.name).trim() ? "The name only" : null;
  }
  if (id === "references") {
    const n = arr(playbooks).filter((r) => r && SLUG.test(str(r.name))).length;
    return n ? plural(n, "playbook", "playbooks") : null;
  }
  return null;
}

// Every section's line, { <id>: { tone, text } }: what is set (good), "not saved" beside a change (warn), and for an
// empty kit "Start here" on the first section still empty.
export function sectionLines(kit, { exists = false, playbooks, changed = [] } = {}) {
  const out = {};
  let first = true;
  for (const s of SECTIONS) {
    const set = sectionSet(s.id, kit, { exists, playbooks });
    const dirty = arr(changed).includes(s.id);
    let text = set || (s.id === "references" ? SECTION_WORDS.nothingYet : SECTION_WORDS.notSet);
    if (!set && s.id !== "references" && !exists && first) { text = SECTION_WORDS.startHere; first = false; }
    out[s.id] = dirty ? { tone: "warn", text: `${text}, ${SECTION_WORDS.notSaved}` } : { tone: set ? "good" : "neutral", text };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Saving: the server's refusal names a field beside its error, so the save reads the answer itself.

async function sendKit(body) {
  let res;
  try {
    res = await fetch("/api/brand/kit", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Engine": "1" },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, status: 0, error: { message: "The engine is not answering.", next: "Try again in a moment.", code: "offline" }, field: null };
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.ok && data && obj(data.kit)) return { ok: true, data };
  const e = data && obj(data.error) && typeof data.error.message === "string" ? data.error : null;
  return {
    ok: false,
    status: res.status,
    error: {
      message: cut(e ? e.message : res.status === 404 ? WORDS.restart : "The home screen got an answer it did not understand.", 300),
      next: cut(e && e.next, 300),
      code: cut(e && e.code, 40),
    },
    field: data && typeof data.field === "string" ? cut(data.field, 80) : null,
  };
}

// An uploaded font, shown in its own face for as long as the page is open (the bytes are the owner's own file).
const LOADED = new Set();
function showFont(family, base64) {
  try {
    if (LOADED.has(family) || typeof FontFace !== "function" || typeof document === "undefined") return;
    const bin = atob(base64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const face = new FontFace(family, buf.buffer);
    face.load().then((f) => { document.fonts.add(f); LOADED.add(family); }).catch(() => {});
  } catch { /* shown in its fallback */ }
}

// The field a refusal named, focused when its section is on screen; else the top of the column.
const focusField = (field) => {
  if (typeof document === "undefined") return;
  const el = document.querySelector(`[data-field="${String(field).replace(/[^a-zA-Z0-9.]/g, "")}"]`);
  const target = el && (el.matches("input, select, textarea, button") ? el : el.querySelector("input, select, textarea, button"));
  if (target) { target.scrollIntoView({ block: "center" }); target.focus({ preventScroll: true }); return; }
  goToPart(fieldPlace(field).part);
};

function goToPart() {
  if (typeof document === "undefined") return;
  const head = document.getElementById("page-title");
  if (typeof window.scrollTo === "function") window.scrollTo(0, 0);
  if (head) head.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------------------------------------------
// Small parts

// What was refused at one field, under its input.
const errorAt = (errors, field) => (errors && errors.field === field ? errors.message : null);

// A refusal that names this section's part as a whole (not one input), at the top of the section.
function PartError({ errors, section }) {
  if (!errors || !errors.field) return null;
  if (fieldSection(errors.field) !== section || fieldPlace(errors.field).inline) return null;
  return html`<p class="p-brand-kit__part-error" role="alert"><${Icon} name="alert" size=${14} /><span>${errors.message}</span></p>`;
}

// One offer as a row: what the brand book (or the old page) says, and Use this.
function Offer({ offer, form, onUse, children }) {
  if (!offer) return null;
  const used = offerUsed(form, offer);
  return html`<${Row} icon=${offer.from === "book" ? "book" : "file"}
    title=${offer.from === "book" ? "Your brand book says" : "Your old brand page says"}
    say=${html`<span class="p-brand-kit__offer-body">${children}</span>`}
    control=${used ? html`<${Tag} tone="ok">In use<//>` : html`<${Button} size="sm" icon="check" onClick=${() => onUse(offer)}>Use this<//>`} />`;
}

// The offers of one section, in one panel at its top.
function Offers({ list, form, onUse }) {
  const shown = list.filter((o) => o && o.offer);
  if (!shown.length) return null;
  return html`<${Group} title=${SECTION_WORDS.proposed}>
    <${Rows}>${shown.map((o) => html`<${Offer} key=${o.offer.key} offer=${o.offer} form=${form} onUse=${onUse}>${o.body}<//>`)}<//>
  <//>`;
}

function Swatch({ hex, size = "md", label }) {
  const h = safeHex(hex);
  return html`<span class=${`p-brand-kit__chip p-brand-kit__chip--${size}${h ? "" : " p-brand-kit__chip--empty"}`} data-cook-picture
    style=${h ? { background: h } : undefined} role=${label ? "img" : undefined} aria-label=${label || undefined} aria-hidden=${label ? undefined : "true"}></span>`;
}

function ColourList({ colours }) {
  return html`<ul class="p-brand-kit__offer-colours">
    ${arr(colours).map((c, i) => html`<li key=${i}><${Swatch} hex=${c.hex} size="sm" /><span>${cut(c.name, 24)}</span>
      <span class="p-brand-kit__mono">${safeHex(c.hex) || ""}</span><span class="p-brand-kit__quiet">${ROLE_WORDS[c.role] || ""}</span></li>`)}
  </ul>`;
}

const Lines = ({ list }) => html`<ul class="p-brand-kit__offer-lines">${arr(list).slice(0, 12).map((l, i) => html`<li key=${i}>${cut(l, 200)}</li>`)}</ul>`;

function Checkbox({ checked, label, onChange, field }) {
  return html`<label class=${`p-brand-kit__check${checked ? " p-brand-kit__check--on" : ""}`}>
    <input type="checkbox" checked=${checked} data-field=${field} onChange=${(e) => onChange(e.currentTarget.checked)} />
    <span>${label}</span>
  </label>`;
}

// A number typed in pixels, as a row's control.
const pxInput = (label, field, value, onInput, errors) => html`<span class="p-brand-kit__num-wrap">
  <${TextInput} data-field=${field} type="number" inputmode="numeric" class="p-brand-kit__num" aria-label=${label} value=${value}
    aria-invalid=${errorAt(errors, field) ? "true" : undefined} onInput=${(e) => onInput(e.currentTarget.value)} />
  <span class="p-brand-kit__unit" aria-hidden="true">px</span>
</span>`;

// The error of one field, under a row's words.
const RowError = ({ errors, field }) => (errorAt(errors, field)
  ? html`<span class="p-brand-kit__row-error" role="alert"><${Icon} name="alert" size=${14} /><span>${errorAt(errors, field)}</span></span>` : null);

// ---------------------------------------------------------------------------------------------------------------
// The first time: nothing saved, nothing proposed

function FirstTime({ proposal }) {
  return html`<${Group} title="Make your brand a set of rules the agents cannot break." aside=${SECTION_WORDS.startHere}>
    <${Rows}>
      <${Row} icon="book" title="Have a brand book?"
        say=${html`Add it to Brand, then start the job "Read the brand book". It proposes every part below for you to accept, one part at a time.
          <a class="p-brand-kit__link" href="#/jobs/operations/read-the-brand-book">Read the brand book</a>`}
        control=${html`<${Button} size="sm" icon="upload" href="#/files/brand?new=upload">Add your brand book<//>`} />
      <${Row} icon="brush" title=${SECTION_WORDS.fillYourself} say="Top to bottom. Colours first: everything else is drawn with them."
        control=${html`<${Button} size="sm" icon="arrow-right" href=${sectionHref("colours", proposal)}>${SECTION_WORDS.startColours}<//>`} />
      <${Row} icon="check" title=${SECTION_WORDS.pressSave} say="Until then nothing is enforced." />
    <//>
  <//>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Logo

function LogoStage({ tone, ground, logo, picture, clearSpace }) {
  const h = 56;
  const pad = Math.round(Number(clearSpace) * h);
  return html`<figure class="p-brand-kit__stage">
    <div class="p-brand-kit__ground" data-cook-picture style=${{ background: ground, color: inkOn(ground) }}>
      ${picture
        ? html`<div class="p-brand-kit__clear" style=${{ padding: `${pad}px` }} title=${`Clear space: ${clearSpace} times the logo's height`}>
            <img src=${picture} alt=${`Your logo on a ${tone} background: ${cut(logo, 80)}`} style=${{ height: `${h}px` }} loading="lazy" decoding="async" />
          </div>`
        : html`<span class="p-brand-kit__ground-none">No logo chosen for ${tone} backgrounds yet.</span>`}
    </div>
    <figcaption class="p-brand-kit__stage-foot">
      <span class="p-brand-kit__stage-label">On ${tone} backgrounds</span>
      <span class="p-brand-kit__mono p-brand-kit__quiet">${ground}</span>
    </figcaption>
    ${picture ? html`<p class="p-brand-kit__stage-note">${pad ? `Dashed line: the clear space, ${clearSpace} × its height` : "No clear space"}</p>` : null}
  </figure>`;
}

function LogoSection({ form, set, errors, offers, onUse, brandPics }) {
  const logo = form.logo;
  const files = arr(logo.files);
  const pics = arr(brandPics);
  const urlOf = (name) => (pics.find((p) => p.name === name) || {}).url || null;
  const g = stages(form.colours);
  const pick = (on) => files.find((f) => f.on === on && urlOf(f.file));
  const toggle = (name, on) => set({ ...form, logo: { ...logo, files: toggleLogo(files, name, on) } });
  const putLogo = (next) => set({ ...form, logo: { ...logo, ...next } });
  const spaces = withCurrent(CLEAR_SPACES.map((c) => ({ value: String(c), label: c ? `${c} × the logo's height` : "None" })), String(logo.clearSpace), `${logo.clearSpace} × the logo's height`);
  const light = pick("light");
  const dark = pick("dark");
  const missing = files.filter((f) => !urlOf(f.file));
  const offer = offers.logo;
  return html`
    <${Offers} form=${form} onUse=${onUse} list=${[{ offer, body: offer ? html`${arr(offer.value.files).map((f) => `${cut(f.file, 60)} on ${f.on}`).join(", ") || "No logo file named."}
      Clear space ${Number(offer.value.clearSpace)} × its height; at least ${Number(offer.value.minPx)} px high.` : null }]} />
    <${Group} title=${SECTION_WORDS.grounds} say="Choose your logo from the pictures in Brand: one that reads on light backgrounds and, if you have one, one for dark.">
      <div class="p-brand-kit__stages">
        <${LogoStage} tone="light" ground=${g.light} logo=${light && light.file} picture=${light && urlOf(light.file)} clearSpace=${logo.clearSpace} />
        <${LogoStage} tone="dark" ground=${g.dark} logo=${dark && dark.file} picture=${dark && urlOf(dark.file)} clearSpace=${logo.clearSpace} />
      </div>
    <//>
    <${Group} title=${SECTION_WORDS.logoFiles} aside=${pics.length ? html`<${Button} size="sm" variant="quiet" icon="upload" href="#/files/brand?new=upload">Add your logo<//>` : null}>
      <${Rows}>
        ${pics.length
          ? pics.map((p) => html`<${Row} key=${p.name}
              icon=${html`<span class="p-brand-kit__thumb" data-cook-picture style=${{ background: files.some((f) => f.file === p.name && f.on === "dark") && !files.some((f) => f.file === p.name && f.on === "light") ? g.dark : g.light }}><img src=${p.url} alt="" loading="lazy" decoding="async" /></span>`}
              title=${html`<span class="u-truncate" title=${p.name}>${p.name}</span>`}
              control=${html`<span class="p-brand-kit__toggles">
                ${["light", "dark"].map((on) => {
                  const pressed = files.some((f) => f.file === p.name && f.on === on);
                  return html`<button key=${on} type="button" class=${`p-brand-kit__toggle${pressed ? " p-brand-kit__toggle--on" : ""}`} aria-pressed=${pressed ? "true" : "false"}
                    aria-label=${`Use ${p.name} on ${on} backgrounds`} onClick=${() => toggle(p.name, on)}>
                    ${pressed ? html`<${Icon} name="check" size=${14} />` : null}On ${on}</button>`;
                })}
              </span>`} />`)
          : html`<${Row} icon="upload" title="No pictures in Brand yet." say="Add your logo file to the Brand folder, then choose it here."
              control=${html`<${Button} size="sm" icon="upload" href="#/files/brand?new=upload">Add your logo<//>`} />`}
      <//>
      ${missing.length ? html`<${Notice} tone="warn" title="Not in Brand any more">
          ${missing.map((f) => html`<p key=${`${f.file}-${f.on}`}>${cut(f.file, 100)} (on ${f.on}).
            <${Button} variant="quiet" size="sm" onClick=${() => putLogo({ files: files.filter((x) => x !== f) })}>Take it out<//></p>`)}
        <//>` : null}
    <//>
    <${Group} title=${SECTION_WORDS.placing}>
      <${Rows}>
        <${Row} icon="layers" title="Clear space around it" say=${html`The empty margin kept round the logo.<${RowError} errors=${errors} field="logo.clearSpace" />`}
          control=${html`<${Select} data-field="logo.clearSpace" aria-label="Clear space around it" value=${String(logo.clearSpace)} options=${spaces}
            onChange=${(e) => putLogo({ clearSpace: Number(e.currentTarget.value) })} />`} />
        <${Row} icon="arrow-up-right" title="Smallest height, in pixels" say=${html`8 to 400. Smaller than this, the tools refuse it.<${RowError} errors=${errors} field="logo.minPx" />`}
          control=${pxInput("Smallest height, in pixels", "logo.minPx", logo.minPx, (v) => putLogo({ minPx: v }), errors)} />
        <${Row} icon="check" title="Where it must appear"
          say=${html`<span class="p-brand-kit__checks" role="group" aria-label="Where it must appear">
            ${PLACES.map((p) => html`<${Checkbox} key=${p} field=${`logo.requiredOn.${p}`} label=${PLACE_WORDS[p]} checked=${arr(logo.requiredOn).includes(p)}
              onChange=${(on) => putLogo({ requiredOn: PLACES.filter((x) => (x === p ? on : arr(logo.requiredOn).includes(x))) })} />`)}
          </span>`} />
      <//>
    <//>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Colours

// One colour as an outlined tile: its swatch (a click picks the colour), its name, its value and what it is for.
function ColourTile({ c, i, errors, edit, setRole, remove }) {
  const hex = safeHex(c.hex);
  return html`<li class=${`p-brand-kit__tile${c.role === "main" ? " p-brand-kit__tile--main" : ""}`}>
    <label class=${`p-brand-kit__swatch${hex ? "" : " p-brand-kit__swatch--empty"}`} data-cook-picture style=${hex ? { background: hex, color: inkOn(hex) } : undefined}>
      <input type="color" aria-label=${`Colour ${i + 1}, pick it`} value=${hex ? hex.toLowerCase() : "#808080"}
        onInput=${(e) => edit(i, "hex", normHex(e.currentTarget.value))} />
      ${hex ? null : html`<span class="p-brand-kit__swatch-none"><${Icon} name="brush" size=${16} />Pick a colour</span>`}
    </label>
    <div class="p-brand-kit__tile-body">
      <${Field} label=${`Colour ${i + 1}: name`} error=${errorAt(errors, `colours.${i}.name`)}>
        <${TextInput} data-field=${`colours.${i}.name`} class="p-brand-kit__tile-name" value=${c.name} maxLength=${24} placeholder="ink" spellcheck=${false}
          onInput=${(e) => edit(i, "name", e.currentTarget.value)} onBlur=${(e) => edit(i, "name", normName(e.currentTarget.value))} />
      <//>
      <${Field} label="Hex" error=${errorAt(errors, `colours.${i}.hex`)}>
        <${TextInput} data-field=${`colours.${i}.hex`} class="p-brand-kit__mono p-brand-kit__tile-hex" value=${c.hex} maxLength=${7} placeholder="#1A3C5E" spellcheck=${false}
          onInput=${(e) => edit(i, "hex", e.currentTarget.value)} onBlur=${(e) => edit(i, "hex", normHex(e.currentTarget.value))} />
      <//>
      <${Field} label="What it is for" error=${errorAt(errors, `colours.${i}.role`)}>
        <${Select} data-field=${`colours.${i}.role`} class="p-brand-kit__tile-role" value=${c.role} options=${ROLES.map((r) => ({ value: r, label: ROLE_WORDS[r] }))}
          onChange=${(e) => setRole(i, e.currentTarget.value)} />
      <//>
    </div>
    <span class="p-brand-kit__tile-x">
      <${Button} variant="quiet" size="sm" icon="cross" aria-label=${`Remove colour ${i + 1}${c.name ? `, ${normName(c.name)}` : ""}`} onClick=${() => remove(i)} />
    </span>
  </li>`;
}

function Pairing({ colours }) {
  const bg = colourFor(colours, "background");
  const ink = colourFor(colours, "text") || colourFor(colours, "main");
  if (!bg || !ink || bg === ink) return null;
  const ratio = contrast(bg, ink);
  const ok = ratio >= 4.5;
  return html`<${Row} icon=${html`<span class="p-brand-kit__pair" data-cook-picture style=${{ background: bg, color: ink }} aria-hidden="true">Aa</span>`}
    title=${SECTION_WORDS.pairing} state=${ok ? { tone: "good", text: `${ratio.toFixed(1)} to 1` } : { tone: "warn", text: `${ratio.toFixed(1)} to 1` }}
    say=${ok ? "Easy to read." : "Hard to read at small sizes; use it for large type only."} />`;
}

function ColoursSection({ form, set, errors, offers, onUse }) {
  const colours = arr(form.colours);
  const put = (next) => set({ ...form, colours: next });
  const edit = (i, key, value) => put(colours.map((c, j) => (j === i ? { ...c, [key]: value } : c)));
  const full = colours.length >= LIMITS.colours[1];
  return html`
    <${Offers} form=${form} onUse=${onUse} list=${[
      { offer: offers.colours, body: html`<${ColourList} colours=${offers.colours && offers.colours.value} />` },
      { offer: offers.neutrals, body: offers.neutrals ? (offers.neutrals.value ? "Greys, black and white are allowed." : "Only the listed colours.") : null },
    ]} />
    <${Group} title=${SECTION_WORDS.palette} aside=${`${colours.length} of ${LIMITS.colours[1]}`}
      say="Two to eight. Give each a short name the agents can use, such as ink or sand, and say what it is for.">
      <ul class="p-brand-kit__tiles" aria-label="Your palette">
        ${colours.map((c, i) => html`<${ColourTile} key=${i} c=${c} i=${i} errors=${errors} edit=${edit}
          setRole=${(j, role) => put(withRole(colours, j, role))} remove=${(j) => put(removeColour(colours, j))} />`)}
        ${full ? null : html`<li class=${`p-brand-kit__tile p-brand-kit__tile--add${colours.length ? "" : " p-brand-kit__tile--first"}`}>
          <button type="button" class="p-brand-kit__add" onClick=${() => put(addColour(colours))}>
            <span class="p-brand-kit__add-mark" aria-hidden="true"><${Icon} name="plus" size=${18} /></span>
            <span class="p-brand-kit__add-words">${colours.length ? "Add a colour" : "Add your main colour"}</span>
          </button>
        </li>`}
      </ul>
      ${colours.length ? null : html`<p class="p-brand-kit__lead"><strong>No colours yet.</strong> Add your main colour first: the one people know you by.</p>`}
    <//>
    <${Group}>
      <${Rows}>
        <${Row} icon="layers" title="Greys, black and white are allowed"
          say=${form.neutrals ? "The tools may also use greys, black and white beside your colours." : "Only your colours. A grey, black or white counts as off-brand unless it is in the list."}
          control=${html`<${Switch} on=${form.neutrals} label="Greys, black and white are allowed" onChange=${(on) => set({ ...form, neutrals: on })} />`} />
        <${Pairing} colours=${colours} />
      <//>
    <//>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Type

function Specimen({ form }) {
  const colours = arr(form.colours);
  const bg = colourFor(colours, "background") || stages(colours).light;
  const ink = colourFor(colours, "text") || colourFor(colours, "main") || inkOn(bg);
  const accent = colourFor(colours, "main") || ink;
  const t = form.type || {};
  const page = Math.min(40, Math.max(10, Number(t.minPx) || 16));
  const slide = Math.min(120, Math.max(16, Number(t.minSlidePx) || 28));
  const name = cut(form.name, 40) || "Your company";
  return html`<figure class="p-brand-kit__specimen-wrap" aria-label="A sample of your two faces">
    <div class="p-brand-kit__specimen" data-cook-picture style=${{ background: bg, color: ink }}>
      <p class="p-brand-kit__spec-over" style=${{ fontFamily: fontStack(t.body), color: accent }}>${name}</p>
      <p class="p-brand-kit__spec-display" style=${{ fontFamily: fontStack(t.heading), color: accent }}>Light falls on the stone</p>
      <p class="p-brand-kit__spec-slide" style=${{ fontFamily: fontStack(t.heading), fontSize: `${slide}px` }}>The smallest line on a slide</p>
      <p class="p-brand-kit__spec-body" style=${{ fontFamily: fontStack(t.body), fontSize: `${page}px` }}>
        Body text on a page is never smaller than this. Every caption, note and footer the tools set stays at ${page} pixels or more, so it can be read on a phone.
      </p>
    </div>
    <figcaption class="p-brand-kit__caption">
      <span>Headings: ${cut(t.heading && t.heading.family, 60)}</span>
      <span>Body: ${cut(t.body && t.body.family, 60)}</span>
      <span>Slides from ${slide} px · pages from ${page} px</span>
    </figcaption>
  </figure>`;
}

function FaceRow({ which, label, face, options, set, errors }) {
  const value = faceValue(face);
  const opts = withCurrent(options, value, cut(face && face.family, 60) || "Not chosen");
  const uploaded = Boolean(face && face.file);
  return html`<${Row} icon=${html`<span class="p-brand-kit__face" data-cook-picture style=${{ fontFamily: fontStack(face) }}>Aa</span>`}
    title=${label}
    say=${html`<span class="p-brand-kit__fallback">
        <label for=${`bk-fallback-${which}`}>If it is missing, use</label>
        <${Select} id=${`bk-fallback-${which}`} data-field=${`type.${which}.fallback`} class="p-brand-kit__small-select" value=${face && face.fallback}
          options=${FALLBACKS.map((f) => ({ value: f, label: FALLBACK_WORDS[f] }))} onChange=${(e) => set({ ...face, fallback: e.currentTarget.value })} />
      </span>
      ${uploaded && !LOADED.has(face.family) ? html`<span class="p-brand-kit__line">Shown here in its fallback. The tools use your file.</span>` : null}
      <${RowError} errors=${errors} field=${`type.${which}.family`} /><${RowError} errors=${errors} field=${`type.${which}.file`} /><${RowError} errors=${errors} field=${`type.${which}.fallback`} />`}
    control=${html`<${Select} data-field=${`type.${which}.family`} aria-label=${label} class="p-brand-kit__face-select" value=${value} options=${opts}
      onChange=${(e) => set(faceFrom(e.currentTarget.value, face))} />`} />`;
}

function Fonts({ fonts, onFonts, announce }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const list = arr(fonts).filter((f) => f && FONT_FILE.test(str(f.file)));
  const add = async ({ name, base64 }) => {
    setBusy("add");
    setError(null);
    try {
      const res = await api.post("/api/brand/kit/font", { name, base64 });
      const file = res && res.font && str(res.font.file);
      if (FONT_FILE.test(file)) showFont(familyFromFile(file), base64);
      onFonts(arr(res && res.fonts));
      setAdding(false);
      announce && announce("The font is added. Choose it as a heading or body face.");
    } catch (e) {
      setError(cut(e && e.message, 300) || "The font could not be added.");
    } finally {
      setBusy("");
    }
  };
  const remove = async (file) => {
    setBusy(file);
    setError(null);
    try {
      const res = await api.del(`/api/brand/kit/font/${encodeURIComponent(file)}`);
      onFonts(arr(res && res.fonts));
      announce && announce("The font is removed.");
    } catch (e) {
      setError([cut(e && e.message, 300), cut(e && e.next, 300)].filter(Boolean).join(" ") || "The font could not be removed.");
    } finally {
      setBusy("");
    }
  };
  const addButton = html`<${Button} size="sm" icon="plus" disabled=${list.length >= LIMITS.fonts} aria-expanded=${adding ? "true" : "false"}
    onClick=${() => { setAdding(!adding); setError(null); }}>${adding ? "Not now" : "Add a font file"}<//>`;
  return html`<${Group} title="Your font files" aside=${`${list.length} of ${LIMITS.fonts}`}>
    <${Rows}>
      ${list.map((f) => html`<${Row} key=${f.file} icon="file" title=${html`<span class="u-truncate">${familyFromFile(f.file)}</span>`}
        say=${html`<span class="p-brand-kit__mono">${f.file}</span> · ${bytes(f.size)}`}
        control=${html`<${Button} variant="quiet" size="sm" busy=${busy === f.file} disabled=${Boolean(busy)} aria-label=${`Remove the font ${f.file}`} onClick=${() => remove(f.file)}>Remove<//>`} />`)}
      ${list.length ? null : html`<${Row} icon="file" title="No font files yet."
        say="The fonts on this Mac are enough to start; add your own when the brand book names one." control=${adding ? null : addButton} />`}
      ${list.length && !adding ? html`<${Row} icon="plus" title="Add a font file" say=".ttf, .otf or .ttc, up to 5 MB." control=${addButton} />` : null}
    <//>
    ${adding ? html`<div class="p-brand-kit__picker">
        <${FilePicker} accept=".ttf,.otf,.ttc" maxBytes=${LIMITS.fontBytes} busy=${busy === "add"} error=${error} onPick=${add} />
        <span class="p-brand-kit__picker-foot">${addButton}</span>
      </div>` : null}
    ${error && !adding ? html`<p class="p-brand-kit__part-error" role="alert"><${Icon} name="alert" size=${14} /><span>${error}</span></p>` : null}
  <//>`;
}

function TypeSection({ form, set, errors, offers, onUse, view, fonts, onFonts, announce }) {
  const t = form.type;
  const options = faceOptions(view.fontsOnThisMac, fonts);
  const setType = (next) => set({ ...form, type: { ...t, ...next } });
  const offer = offers.type && offers.type.value;
  return html`
    <${Offers} form=${form} onUse=${onUse} list=${[{ offer: offers.type, body: offer ? html`Headings in ${cut(offer.heading && offer.heading.family, 60)}, body text in ${cut(offer.body && offer.body.family, 60)}.
      Smallest ${Number(offer.minPx) || "?"} px on a page and ${Number(offer.minSlidePx) || "?"} px on a slide.` : null }]} />
    <${Group} title=${SECTION_WORDS.sample}><${Specimen} form=${form} /><//>
    <${Group} title=${SECTION_WORDS.faces}>
      <${Rows}>
        <${FaceRow} which="heading" label="Headings" face=${t.heading} options=${options} errors=${errors} set=${(f) => setType({ heading: f })} />
        <${FaceRow} which="body" label="Body text" face=${t.body} options=${options} errors=${errors} set=${(f) => setType({ body: f })} />
      <//>
    <//>
    <${Group} title=${SECTION_WORDS.sizes}>
      <${Rows}>
        <${Row} icon="docs" title="Smallest text on a page, in pixels" say=${html`10 to 40. 16 is a good start.<${RowError} errors=${errors} field="type.minPx" />`}
          control=${pxInput("Smallest text on a page, in pixels", "type.minPx", t.minPx, (v) => setType({ minPx: v }), errors)} />
        <${Row} icon="stage" title="Smallest text on a slide, in pixels" say=${html`16 to 120. Slides are read from across a room.<${RowError} errors=${errors} field="type.minSlidePx" />`}
          control=${pxInput("Smallest text on a slide, in pixels", "type.minSlidePx", t.minSlidePx, (v) => setType({ minSlidePx: v }), errors)} />
      <//>
    <//>
    <${Fonts} fonts=${fonts} onFonts=${onFonts} announce=${announce} />`;
}

// ---------------------------------------------------------------------------------------------------------------
// Layout

// A page drawn in the kit's own colours with its corners and margins, the margin's edge as a dashed line.
function LayoutSample({ form }) {
  const colours = arr(form.colours);
  const layout = form.layout || emptyKit().layout;
  const bg = colourFor(colours, "background") || stages(colours).light;
  const ink = colourFor(colours, "text") || colourFor(colours, "main") || inkOn(bg);
  const main = colourFor(colours, "main") || ink;
  const second = colourFor(colours, "accent") || safeHex((colours.find((c) => c.role === "other") || {}).hex) || main;
  const r = Math.max(0, Math.min(32, Number(layout.radiusPx) || 0));
  const m = Math.max(0, Math.min(0.15, Number(layout.marginShare) || 0));
  const t = form.type || {};
  return html`<figure class="p-brand-kit__specimen-wrap" aria-label="A page with your corners and margins">
    <div class="p-brand-kit__page" data-cook-picture style=${{ background: bg, color: ink, padding: `${m * 100}%` }}>
      ${m ? html`<span class="p-brand-kit__page-guide" aria-hidden="true" style=${{ inset: `${m * 100}% ${m * 100}% ${m * 100}% ${m * 100}%` }}></span>` : null}
      <div class="p-brand-kit__page-grid">
        <span class="p-brand-kit__page-block" style=${{ background: main, borderRadius: `${r}px` }}></span>
        <div class="p-brand-kit__page-col">
          <p class="p-brand-kit__page-head" style=${{ fontFamily: fontStack(t.heading) }}>${cut(form.name, 40) || "Your company"}</p>
          <span class="p-brand-kit__page-bar"></span>
          <span class="p-brand-kit__page-bar"></span>
          <span class="p-brand-kit__page-bar p-brand-kit__page-bar--short"></span>
          <span class="p-brand-kit__page-mark" style=${{ background: second, borderRadius: `${r}px` }}></span>
        </div>
      </div>
    </div>
    <figcaption class="p-brand-kit__caption">
      <span>Corners: ${r ? `${r} px` : "square"}</span>
      <span>Margins: ${m ? `${Math.round(m * 1000) / 10}% of the width` : "none"}</span>
    </figcaption>
  </figure>`;
}

function LayoutSection({ form, set, errors, offers, onUse }) {
  const layout = form.layout || emptyKit().layout;
  const radii = withCurrent(RADII.map((r) => ({ value: String(r), label: r ? `${r} px` : "Square corners" })), String(layout.radiusPx), `${layout.radiusPx} px`);
  const margins = withCurrent(MARGINS.map((m) => ({ value: String(m), label: m ? `${Math.round(m * 1000) / 10}% of the width` : "No margin" })), String(layout.marginShare), `${Math.round(Number(layout.marginShare) * 1000) / 10}% of the width`);
  return html`
    <${Offers} form=${form} onUse=${onUse} list=${[{ offer: offers.layout, body: offers.layout
      ? `Corners ${Number(offers.layout.value.radiusPx) || 0} px, margins ${Math.round(Number(offers.layout.value.marginShare) * 1000) / 10}% of the width.` : null }]} />
    <${Group} title=${SECTION_WORDS.sample}><${LayoutSample} form=${form} /><//>
    <${Group} title=${SECTION_WORDS.corners}>
      <${Rows}>
        <${Row} icon="grid" title="Corners" say=${html`How round the corners of pictures and panels are.<${RowError} errors=${errors} field="layout.radiusPx" />`}
          control=${html`<${Select} data-field="layout.radiusPx" aria-label="Corners" value=${String(layout.radiusPx)} options=${radii}
            onChange=${(e) => set({ ...form, layout: { ...layout, radiusPx: Number(e.currentTarget.value) } })} />`} />
        <${Row} icon="sidebar" title="Margins" say=${html`The empty edge round every slide and page.<${RowError} errors=${errors} field="layout.marginShare" />`}
          control=${html`<${Select} data-field="layout.marginShare" aria-label="Margins" value=${String(layout.marginShare)} options=${margins}
            onChange=${(e) => set({ ...form, layout: { ...layout, marginShare: Number(e.currentTarget.value) } })} />`} />
      <//>
    <//>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Pictures: examples of work you approve

function PicturesSection({ form, set, errors, offers, onUse, refPics }) {
  const refs = arr(form.references);
  const pics = arr(refPics);
  const put = (next) => set({ ...form, references: next });
  const at = (path) => refs.findIndex((r) => r.file === path);
  const toggle = (path) => {
    const i = at(path);
    if (i >= 0) put(refs.filter((_, j) => j !== i));
    else if (refs.length < LIMITS.references) put([...refs, { file: path, kinds: [], note: "" }]);
  };
  const edit = (i, next) => put(refs.map((r, j) => (j === i ? { ...r, ...next } : r)));
  const missing = refs.map((r, i) => ({ r, i })).filter(({ r }) => !pics.some((p) => p.path === r.file));
  const offered = offers.references && arr(offers.references.value);
  return html`
    <${Offers} form=${form} onUse=${onUse} list=${[{ offer: offers.references, body: offered ? html`<ul class="p-brand-kit__offer-lines">${offered.slice(0, 24).map((r, i) => html`<li key=${i}>${cut(r.file, 120)}${arr(r.kinds).length ? `, for ${arr(r.kinds).map((k) => (KIND_WORDS[k] || "").toLowerCase()).join(", ")}` : ""}${r.note ? `: ${cut(r.note, 200)}` : ""}</li>`)}</ul>` : null }]} />
    <${Group} title=${SECTION_WORDS.examples} aside=${pics.length ? html`<${Button} size="sm" variant="quiet" icon="upload" href="#/files/references?new=upload">Add pictures<//>` : null}
      say="Pictures of work you are proud of. Choose which count, what each is an example of, and in one line why it is good.">
      ${pics.length
        ? html`<ul class="p-brand-kit__wall">
            ${pics.map((p) => {
              const i = at(p.path);
              const on = i >= 0;
              const r = on ? refs[i] : null;
              return html`<li key=${p.path} class=${`p-brand-kit__ref${on ? " p-brand-kit__ref--on" : ""}`}>
                <figure class="p-brand-kit__ref-pic"><img src=${p.url} alt=${cut(p.name, 100)} loading="lazy" decoding="async" /></figure>
                <div class="p-brand-kit__ref-body">
                  <${Checkbox} field=${`references.${on ? i : "new"}.file`} checked=${on} label=${on ? "An example of good work" : "Use as an example"} onChange=${() => toggle(p.path)} />
                  ${on ? html`
                    <fieldset class="p-brand-kit__kinds" data-field=${`references.${i}.kinds`}>
                      <legend class="p-brand-kit__quiet">An example for</legend>
                      ${KINDS.map((k) => html`<${Checkbox} key=${k} field=${`references.${i}.kinds.${k}`} label=${KIND_WORDS[k]} checked=${arr(r.kinds).includes(k)}
                        onChange=${(c) => edit(i, { kinds: KINDS.filter((x) => (x === k ? c : arr(r.kinds).includes(x))) })} />`)}
                    </fieldset>
                    ${errorAt(errors, `references.${i}.kinds`) ? html`<p class="p-brand-kit__part-error" role="alert"><${Icon} name="alert" size=${14} /><span>${errorAt(errors, `references.${i}.kinds`)}</span></p>` : null}
                    <${Field} label="Why it is good" error=${errorAt(errors, `references.${i}.note`)}>
                      <${TextInput} data-field=${`references.${i}.note`} value=${r.note} maxLength=${300} placeholder="The light on the stone; nothing else in the frame."
                        onInput=${(e) => edit(i, { note: e.currentTarget.value })} />
                    <//>` : null}
                </div>
              </li>`;
            })}
          </ul>`
        : html`<${Rows}><${Row} icon="image" title="No pictures in References yet."
            say="Add work you are proud of: the Art director compares every new piece with it."
            control=${html`<${Button} size="sm" icon="upload" href="#/files/references?new=upload">Add pictures<//>`} /><//>`}
      ${missing.length ? html`<${Notice} tone="warn" title="Not in References any more">
          ${missing.map(({ r }) => html`<p key=${r.file}>${cut(r.file, 120)}
            <${Button} variant="quiet" size="sm" onClick=${() => put(refs.filter((x) => x !== r))}>Take it out<//></p>`)}
        <//>` : null}
    <//>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Words: the name, how we sound, what the Researcher may know

function VoiceWords({ words, set, errors, face }) {
  const [typedWord, setTyped] = useState("");
  const list = arr(words);
  const add = () => {
    const w = typedWord.trim().slice(0, 40);
    if (!w || list.length >= LIMITS.words || list.includes(w)) return;
    set([...list, w]);
    setTyped("");
  };
  return html`<div class="p-brand-kit__words">
    ${list.length ? html`<ul class="p-brand-kit__word-list" data-cook-picture style=${{ fontFamily: fontStack(face) }}>${list.map((w, i) => html`<li key=${i}>
      <span>${cut(w, 40)}</span>
      <button type="button" class="p-brand-kit__word-x" aria-label=${`Remove the word ${cut(w, 40)}`} onClick=${() => set(list.filter((_, j) => j !== i))}><${Icon} name="cross" size=${14} /></button>
    </li>`)}</ul>` : null}
    <${Field} label="Three to five words for how you sound" hint=${`${list.length} of ${LIMITS.words}. Press Enter after each.`}
      error=${errorAt(errors, "voice.words") || list.map((_, i) => errorAt(errors, `voice.words.${i}`)).find(Boolean)}>
      <${TextInput} data-field="voice.words" value=${typedWord} maxLength=${40} placeholder=${list.length >= LIMITS.words ? "Five words is the most" : "warm"}
        disabled=${list.length >= LIMITS.words}
        onInput=${(e) => setTyped(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
    <//>
  </div>`;
}

function DoList({ kind, list, set, errors }) {
  const items = arr(list);
  const shown = items.length ? items : [""];
  const put = (next) => set(next);
  const isDo = kind === "do";
  return html`<div class=${`p-brand-kit__dos p-brand-kit__dos--${kind}`}>
    <ul class="p-brand-kit__do-list">
      ${shown.map((line, i) => html`<li key=${i}>
        <${Field} label=${`${isDo ? "Do" : "Don't"}, example ${i + 1}`} error=${errorAt(errors, `voice.${kind}.${i}`)}>
          <${TextInput} data-field=${`voice.${kind}.${i}`} value=${line} maxLength=${200}
            placeholder=${isDo ? "Name the street and the year it was built." : "Call a project luxurious or world-class."}
            onInput=${(e) => put(shown.map((x, j) => (j === i ? e.currentTarget.value : x)))} />
        <//>
        ${items.length ? html`<${Button} variant="quiet" size="sm" icon="cross" aria-label=${`Remove ${isDo ? "do" : "don't"} example ${i + 1}`}
          onClick=${() => put(shown.filter((_, j) => j !== i))} />` : null}
      </li>`)}
    </ul>
    <span><${Button} size="sm" variant="quiet" icon="plus" disabled=${shown.length >= LIMITS.items} onClick=${() => put([...shown, ""])}>${isDo ? "Add a do" : "Add a don't"}<//></span>
  </div>`;
}

function WordsSection({ form, set, errors, offers, onUse, fillerCount }) {
  const v = form.voice;
  const putVoice = (next) => set({ ...form, voice: { ...v, ...next } });
  const count = Number.isInteger(fillerCount) ? fillerCount : null;
  const s = str(form.public && form.public.summary);
  const text = (key, n) => cut(offers[key] && offers[key].value, n);
  return html`
    <${Offers} form=${form} onUse=${onUse} list=${[
      { offer: offers.name, body: cut(offers.name && offers.name.value, 80) },
      { offer: offers["voice.words"], body: arr(offers["voice.words"] && offers["voice.words"].value).map((w) => cut(w, 40)).join(", ") },
      { offer: offers["voice.is"], body: text("voice.is", 1000) },
      { offer: offers["voice.do"], body: html`<${Lines} list=${offers["voice.do"] && offers["voice.do"].value} />` },
      { offer: offers["voice.dont"], body: html`<${Lines} list=${offers["voice.dont"] && offers["voice.dont"].value} />` },
      { offer: offers["voice.signoff"], body: text("voice.signoff", 200) },
      { offer: offers.public, body: cut(offers.public && offers.public.value && offers.public.value.summary, 600) },
    ]} />
    <${Group} title=${SECTION_WORDS.name}>
      <${Rows}>
        <${Row} icon="tag" title="Your company's name, as it is written" say=${html`${PARTS[0].changes}<${RowError} errors=${errors} field="name" />`}
          control=${html`<${TextInput} data-field="name" class="p-brand-kit__name" aria-label="Your company's name, as it is written" value=${form.name} maxLength=${80}
            placeholder="The name on your door" onInput=${(e) => set({ ...form, name: e.currentTarget.value })} />`} />
      <//>
    <//>
    <${Group} title=${SECTION_WORDS.voice}>
      <${Rows}>
        <${Row} icon="reply" title="Your words" say=${html`<${VoiceWords} words=${v.words} face=${form.type && form.type.heading} set=${(words) => putVoice({ words })} errors=${errors} />`} />
        <${Row} icon="docs" title="How you sound, in a few sentences"
          say=${html`<span class="p-brand-kit__line">Write it to a new writer: who you talk to, how close, what you never pretend.</span>
            <${Field} error=${errorAt(errors, "voice.is")}>
              <${TextArea} data-field="voice.is" autoGrow aria-label="How you sound, in a few sentences" value=${v.is} maxLength=${1000}
                placeholder="Like an architect on site: plain, exact, warm with the client, never selling." onInput=${(e) => putVoice({ is: e.currentTarget.value })} />
            <//>`} />
        <${Row} icon="check" title="Do" say=${html`<${DoList} kind="do" list=${v.do} set=${(list) => putVoice({ do: list })} errors=${errors} />`} />
        <${Row} icon="cross" title="Don't" say=${html`<${DoList} kind="dont" list=${v.dont} set=${(list) => putVoice({ dont: list })} errors=${errors} />`} />
        <${Row} icon="send" title="Sign-off" say=${html`How a letter or an email from you ends.<${RowError} errors=${errors} field="voice.signoff" />`}
          control=${html`<${TextInput} data-field="voice.signoff" class="p-brand-kit__name" aria-label="Sign-off" value=${v.signoff} maxLength=${200}
            placeholder="With care, the Sthyra studio" onInput=${(e) => putVoice({ signoff: e.currentTarget.value })} />`} />
        <${Row} icon="filter" title="Also block machine-sounding filler"
          say=${count !== null ? `Stops ${count} stock phrases, such as "elevate your" and "seamless experience", from reaching you.` : "Stops stock phrases, such as \"elevate your\" and \"seamless experience\", from reaching you."}
          control=${html`<${Switch} on=${form.filler && form.filler.block} label="Also block machine-sounding filler"
            onChange=${(on) => set({ ...form, filler: { ...(form.filler || { allow: [] }), block: on } })} />`} />
        <${Row} icon="lock" title="What we never say"
          say=${html`Words and claims you never use are kept in <a class="p-brand-kit__link" href="#/files/brand?new=form:cant-say">What we never say</a>.`} />
      <//>
    <//>
    <${Group} title=${SECTION_WORDS.researcher} say=${PARTS.find((p) => p.id === "public").changes}>
      <${Rows}>
        <${Row} icon="lock" title="A short public summary of the company"
          say=${html`<span class="p-brand-kit__line">${WORDS.researcher}</span>
            <${Field} error=${errorAt(errors, "public.summary")} hint=${`${[...s].length} of ${LIMITS.summary} characters.`}>
              <${TextArea} data-field="public.summary" autoGrow aria-label="A short public summary of the company" value=${s} maxLength=${LIMITS.summary}
                placeholder="An architecture studio in Hyderabad that designs and builds homes and small offices."
                onInput=${(e) => set({ ...form, public: { summary: e.currentTarget.value } })} />
            <//>`} />
      <//>
    <//>`;
}

// ---------------------------------------------------------------------------------------------------------------
// References: the picks, the playbooks

// The taste file is read only when Brand lists it, so an owner with no picks yet costs no failed request.
function Picks({ known }) {
  const res = useResource(known ? `/api/brain/file/${fileToken(TASTE_PATH)}` : null);
  const none = !known || (res.error && (res.error.status === 404 || res.error.code === "file_not_found"));
  const lines = res.data ? tasteLines(res.data.text).slice(0, 60) : [];
  return html`<${Group} title="Your picks so far" say="What you chose between versions, kept for the agents. Only your own choices and notes are written here.">
    ${known && res.loading && !res.data ? html`<${Loading} lines=${2} label="Reading your picks" />`
      : none || (res.data && !lines.length) ? html`<${Rows}><${Row} icon="layers" title=${SECTION_WORDS.noPicks} say=${WORDS.noPicks} /><//>`
      : res.error ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`
      : html`<${Card} class="p-brand-kit__picks">${lines.map((l, i) => (l.kind === "head"
          ? html`<h3 key=${i} class="p-brand-kit__sub">${l.text}</h3>`
          : html`<p key=${i} class="p-brand-kit__pick-line">${l.text}</p>`))}<//>`}
  <//>`;
}

function Playbooks({ rows }) {
  const list = arr(rows).filter((r) => r && SLUG.test(str(r.name)));
  const columns = [{ key: "name", label: "Playbook" }, { key: "roles", label: "Who reads it" }, { key: "kinds", label: "For which work" }];
  const cell = (r, c) => {
    if (c.key === "name") return html`<span class="p-brand-kit__mono">${r.name}</span>${r.origin === "own" ? html` <${Tag}>Yours<//>` : null}`;
    if (c.key === "roles") return arr(r.roles).map(roleName).filter(Boolean).join(", ") || "Any agent";
    return arr(r.kinds).map((k) => KIND_WORDS[k] || roleName(k)).filter(Boolean).join(", ") || "Any work";
  };
  return html`<${Group} title="Playbooks" say="Craft notes the agents read before they make something. They read them; they cannot change them.">
    ${list.length
      ? html`<${Card} padding="none" class="p-brand-kit__table"><${DataTable} columns=${columns} rows=${list.map((r) => ({ ...r, id: r.name }))} renderCell=${cell} /><//>`
      : html`<${Rows}><${Row} icon="health" title=${WORDS.noPlaybooks} control=${html`<${Button} size="sm" href="#/health">Open Health<//>`} /><//>`}
  <//>`;
}

// ---------------------------------------------------------------------------------------------------------------
// The page

function useFolder(id) {
  const res = useResource(`/api/brain/folder/${id}`, { every: 15000 });
  const files = arr(res.data && res.data.files);
  const pics = files
    .filter((f) => f && f.kind === "image" && /^\/api\/brain\/raw\/[A-Za-z0-9_-]{1,700}$/.test(str(f.rawUrl)))
    .map((f) => ({ name: cut(f.name, 120), path: str(f.path) || `${id}/${str(f.name)}`, url: f.rawUrl }));
  return { pics, has: (path) => files.some((f) => f && str(f.path) === path) };
}

const INTROS = {
  logo: PARTS.find((p) => p.id === "logo").changes,
  colours: PARTS.find((p) => p.id === "colours").changes,
  type: PARTS.find((p) => p.id === "type").changes,
  layout: SECTION_WORDS.layoutIntro,
  pictures: PARTS.find((p) => p.id === "references").changes,
  words: PARTS.find((p) => p.id === "voice").changes,
  references: SECTION_WORDS.referencesIntro,
};

// The crumbs and the window's title for one section.
function useTop(here, proposal) {
  const app = useApp() || {};
  const { setTop } = app;
  const company = app.shell && app.shell.company && app.shell.company.name;
  useEffect(() => {
    if (typeof document !== "undefined") document.title = [`Brand kit, ${here.label}`, company].filter(Boolean).join(" · ");
    if (typeof setTop === "function") {
      setTop({ crumbs: [{ label: "Files", href: "#/files" }, { label: "Brand kit", href: sectionHref(SECTIONS[0].id, proposal) }, { label: here.label }] });
    }
  }, [here.id, company, setTop, proposal]);
}

function Restart() {
  return html`<${Rows}>
    <${Row} icon=${html`<${StatusDot} tone="off" label="Not here yet" hideLabel=${true} />`} title="Not here yet"
      say=${html`This page appears after the home screen is restarted: <code class="k-next__command">engine stop</code>, then <code class="k-next__command">engine start</code>.`} />
  <//>`;
}

function Editor({ view, reload, section, proposalRef }) {
  const { announce } = useApp();
  const [base, setBase] = useState(() => kitFromForm(formFromKit(view.fromOldForm ? emptyKit(view.fontsOnThisMac) : view.kit)));
  const [form, setFormState] = useState(() => formFromKit(view.fromOldForm ? emptyKit(view.fontsOnThisMac) : view.kit));
  const [version, setVersion] = useState(view.version || null);
  const [exists, setExists] = useState(Boolean(view.exists));
  const [savedAt, setSavedAt] = useState(view.kit && view.kit.savedAt);
  const [fonts, setFonts] = useState(arr(view.fontsUploaded));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [pending, setPending] = useState(null);
  const brand = useFolder("brand");
  const refs = useFolder("references");
  const offers = offersOf({ proposal: view.proposal, oldKit: view.fromOldForm ? view.kit : null, families: view.fontsOnThisMac });
  const proposal = obj(view.proposal) ? view.proposal : null;
  const here = SECTIONS.find((s) => s.id === section) || SECTIONS[0];

  // A new section starts at the top, and on a phone its name is brought into the row of names; a refusal in
  // another section is shown once that section is drawn.
  const first = useRef(true);
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!first.current && typeof window.scrollTo === "function") window.scrollTo(0, 0);
    first.current = false;
    const pick = document.querySelector(".p-brand-kit .k-doc__pick[aria-current]");
    if (pick && typeof pick.scrollIntoView === "function") pick.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (pending && fieldSection(pending) === here.id) { const f = pending; setPending(null); setTimeout(() => focusField(f), 0); }
  }, [here.id, pending]);
  const show = (field) => {
    const to = fieldSection(field);
    if (to && to !== here.id && typeof location !== "undefined") { setPending(field); location.hash = sectionHref(to, proposalRef); return; }
    setTimeout(() => focusField(field), 0);
  };

  const set = (next) => { setFormState(next); if (outcome && outcome.kind === "saved") setOutcome(null); };
  const onUse = (offer) => { set(useOffer(form, offer.key, offer.value)); announce && announce("Used. Save the brand kit to keep it."); };
  const current = kitFromForm(form);
  const changed = changedSections(base, current);
  const dirty = changed.length > 0;
  const offerCount = Object.keys(offers).length;
  const unused = Object.values(offers).filter((o) => !offerUsed(form, o)).length;
  const lines = sectionLines(current, { exists, playbooks: view.playbooks, changed });

  const useAll = () => {
    let next = form;
    for (const o of Object.values(offers)) next = useOffer(next, o.key, o.value);
    set(next);
    announce && announce("Every proposed part is used. Check them, then save.");
  };

  const save = async () => {
    const local = colourProblems(form.colours);
    if (local.length) {
      setErrors(local[0]);
      setOutcome({ kind: "refused", message: local[0].message, field: local[0].field });
      show(local[0].field);
      return;
    }
    setBusy(true);
    setErrors(null);
    setOutcome(null);
    const res = await sendKit({ kit: current, version });
    setBusy(false);
    if (res.ok) {
      const saved = res.data.kit;
      setBase(kitFromForm(formFromKit(saved)));
      setFormState(formFromKit(saved));
      setVersion(res.data.version || null);
      setExists(true);
      setSavedAt(saved.savedAt);
      setOutcome({ kind: "saved" });
      announce && announce(WORDS.saved);
      return;
    }
    if (res.error.code === "changed_since_seen") { setOutcome({ kind: "changed" }); return; }
    if (res.field) {
      setErrors({ field: res.field, message: res.error.message });
      setOutcome({ kind: "refused", message: res.error.message, field: res.field });
      show(res.field);
      return;
    }
    setOutcome({ kind: "failed", message: res.error.message, next: res.error.next });
  };

  const status = view.problem && !outcome
    ? "The saved brand kit has a problem. Saving replaces it."
    : exists ? savedAt && fullWhen(savedAt) ? `Saved ${fullWhen(savedAt)}.` : "Saved." : WORDS.notSaved;
  const changedWords = `Changed: ${changed.map((id) => SECTIONS.find((s) => s.id === id).label).join(", ")}.`;
  const tone = view.problem && !outcome ? "bad" : exists && !dirty ? "ok" : exists ? "warn" : "off";
  const parts = { form, set, errors, offers, onUse };

  let body;
  if (here.id === "logo") body = html`<${LogoSection} ...${parts} brandPics=${brand.pics} />`;
  else if (here.id === "colours") body = html`<${ColoursSection} ...${parts} />`;
  else if (here.id === "type") body = html`<${TypeSection} ...${parts} view=${view} fonts=${fonts} onFonts=${setFonts} announce=${announce} />`;
  else if (here.id === "layout") body = html`<${LayoutSection} ...${parts} />`;
  else if (here.id === "pictures") body = html`<${PicturesSection} ...${parts} refPics=${refs.pics} />`;
  else if (here.id === "words") body = html`<${WordsSection} ...${parts} fillerCount=${view.fillerCount} />`;
  else body = html`<${Picks} known=${brand.has(TASTE_PATH)} /><${Playbooks} rows=${view.playbooks} />`;

  const sections = SECTIONS.map((s) => ({ id: s.id, label: s.label, icon: s.icon, href: sectionHref(s.id, proposalRef), status: lines[s.id] }));

  return html`<div class=${`p-brand-kit p-brand-kit--${here.id}`}>
    <${DocLayout} title=${here.label} state=${lines[here.id]} intro=${INTROS[here.id]} sections=${sections} current=${here.id}>
      <div class="p-brand-kit__top">
        ${view.problem ? html`<${Notice} tone="bad" title=${PROBLEMS[view.problem] || "Part of the brand kit could not be read."} />` : null}
        ${outcome && outcome.kind === "saved" ? html`<${Notice} tone="ok" title=${WORDS.saved} />` : null}
        ${outcome && outcome.kind === "changed" ? html`<${Notice} tone="warn" title=${WORDS.changed}>
            <p>Your changes are still on this page. Open the newest version to see what changed; then make your changes again.</p>
            <div class="p-brand-kit__notice-actions"><${Button} size="sm" icon="loop" onClick=${reload}>Open the newest version<//></div>
          <//>` : null}
        ${outcome && outcome.kind === "refused" ? html`<${Notice} tone="bad" title="Not saved.">
            <p>${outcome.message}</p>
            <div class="p-brand-kit__notice-actions"><${Button} size="sm" icon="arrow-right" onClick=${() => show(outcome.field)}>Show me<//></div>
          <//>` : null}
        ${outcome && outcome.kind === "failed" ? html`<${Notice} tone="bad" title=${outcome.message}>${outcome.next || null}<//>` : null}
        <${PartError} errors=${errors} section=${here.id} />

        ${proposal ? html`<${Rows}>
            <${Row} icon="book" title=${WORDS.fromBook}
              say=${html`${proposal.problem
                ? cut(proposal.problem, 200)
                : html`${offerCount ? `${offerCount} proposed ${offerCount === 1 ? "part sits" : "parts sit"} beside the fields below. Use each one you agree with, change what you like, then save.` : "The brand book named nothing the kit can use."}
                  ${arr(proposal.dropped).length ? ` Not taken, in whole or in part, because it broke the kit's rules: ${arr(proposal.dropped).map((d) => (PARTS.find((p) => p.id === d) || {}).title || (d === "voice" ? "How we sound" : d === "all" ? "everything" : d === "other" ? "parts the kit does not know" : d)).join(", ")}.` : ""}`}
                ${/^[A-Z][A-Z0-9]{0,9}-\d{1,9}$/.test(str(proposal.from)) ? html`<span class="p-brand-kit__line">Read in task <a class="p-brand-kit__link" href=${`#/tasks/${proposal.from}`}>${proposal.from}</a>.</span>` : null}`}
              control=${unused > 1 ? html`<${Button} size="sm" onClick=${useAll}>Use every proposed part<//>` : null} />
          <//>` : null}
        ${!proposal && view.fromOldForm ? html`<${Rows}>
            <${Row} icon="file" title=${WORDS.fromOld} say="What your old brand page held sits beside the fields below. Use what still fits."
              control=${unused > 1 ? html`<${Button} size="sm" onClick=${useAll}>Use all of it<//>` : null} />
          <//>` : null}
      </div>
      ${!exists && !dirty && !proposal && !view.fromOldForm ? html`<${FirstTime} proposal=${proposalRef} />` : null}

      ${body}

      <div class=${`p-brand-kit__bar${dirty ? " p-brand-kit__bar--dirty" : ""}`} role="region" aria-label="Save">
        <span class="p-brand-kit__bar-words">
          <${StatusDot} tone=${tone} label=${dirty ? `${changedWords} Not saved yet.` : status} />
        </span>
        <span class="p-brand-kit__bar-actions">
          ${dirty && exists ? html`<${Button} variant="quiet" size="sm" disabled=${busy} onClick=${() => { setFormState(formFromKit(base)); setErrors(null); setOutcome(null); }}>Undo my changes<//>` : null}
          <${Button} variant="primary" size="sm" icon="check" busy=${busy} disabled=${busy || (!dirty && !view.problem)} onClick=${save}>${WORDS.save}<//>
        </span>
      </div>
    <//>
  </div>`;
}

export default function BrandKitPage({ route }) {
  const query = (route && route.query) || new URLSearchParams();
  const ref = str(query.get && query.get("proposal"));
  const section = sectionOf(query);
  const address = kitAddress(ref);
  const res = useResource(address);
  const [round, setRound] = useState(0);
  const state = viewState(res);
  const reload = () => { setRound((n) => n + 1); res.reload(); };
  const here = SECTIONS.find((s) => s.id === section) || SECTIONS[0];
  useTop(here, ref);

  if (state === "ready") return html`<${Editor} key=${`${address}-${round}-${res.data.version || "new"}`} view=${res.data} reload=${reload} section=${section} proposalRef=${ref} />`;
  const sections = SECTIONS.map((s) => ({ id: s.id, label: s.label, icon: s.icon, href: sectionHref(s.id, ref) }));
  return html`<div class="p-brand-kit">
    <${DocLayout} title="Brand kit" intro=${WORDS.lead} sections=${sections} current=${section}>
      <div class="p-brand-kit__top">
        ${state === "loading" ? html`<${Loading} lines=${6} label="Opening the brand kit" />` : null}
        ${state === "restart" ? html`<${Restart} />` : null}
        ${state === "error" ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
      </div>
    <//>
  </div>`;
}
