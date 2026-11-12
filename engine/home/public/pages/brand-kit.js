// Files, Brand kit (PLAN-V5 K5, T14): where the owner turns a brand book into rules every tool obeys. Colours as
// swatches, the two faces as a live sample, the logo on light and on dark with its clear space drawn, the voice as
// do and don't, the approved work as a wall of pictures. Reached at #/files/brand-kit (the Files page hands this
// address over); `?proposal=<task>` lays what the "Read the brand book" job proposed beside each part.
// Nothing an agent wrote is ever set as HTML: a proposal's values are shown as text, a colour only after it passed
// the hex pattern, a face only after it passed the family pattern, a picture only from the brain's own raw address.
import { html, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { bytes, fileToken, fullWhen } from "../lib/format.js";
import {
  Button, Card, DataTable, Empty, ErrorNotice, Field, FilePicker, Icon, Loading, Notice, PageHeader, Ring, Section, Select,
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

const focusField = (field) => {
  if (typeof document === "undefined") return;
  const el = document.querySelector(`[data-field="${String(field).replace(/[^a-zA-Z0-9.]/g, "")}"]`);
  const target = el && (el.matches("input, select, textarea, button") ? el : el.querySelector("input, select, textarea, button"));
  if (target) { target.scrollIntoView({ block: "center" }); target.focus({ preventScroll: true }); return; }
  const part = fieldPlace(field).part;
  if (part) goToPart(part);
};

function goToPart(id) {
  if (typeof document === "undefined") return;
  const box = document.getElementById(`bk-${id}`);
  if (!box) return;
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  box.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  const head = box.querySelector("h2");
  if (head) { head.setAttribute("tabindex", "-1"); head.focus({ preventScroll: true }); }
}

// ---------------------------------------------------------------------------------------------------------------
// Small parts

// What was refused at one field, under its input.
const errorAt = (errors, field) => (errors && errors.field === field ? errors.message : null);

function PartError({ errors, part }) {
  if (!errors || !errors.field) return null;
  const place = fieldPlace(errors.field);
  if (place.part !== part || place.inline) return null;
  return html`<p class="p-brand-kit__part-error" role="alert"><${Icon} name="alert" size=${14} /><span>${errors.message}</span></p>`;
}

// One offer beside its field: what the brand book (or the old page) says, and Use this.
function Offer({ offer, form, onUse, children }) {
  if (!offer) return null;
  const used = offerUsed(form, offer);
  return html`<div class=${`p-brand-kit__offer${used ? " p-brand-kit__offer--used" : ""}`}>
    <div class="p-brand-kit__offer-head">
      <span class="p-brand-kit__offer-source"><${Icon} name=${offer.from === "book" ? "book" : "file"} size=${14} />${offer.from === "book" ? "Your brand book says" : "Your old brand page says"}</span>
      ${used
        ? html`<${Tag} tone="ok">In use<//>`
        : html`<${Button} size="sm" icon="check" onClick=${() => onUse(offer)}>Use this<//>`}
    </div>
    <div class="p-brand-kit__offer-body">${children}</div>
  </div>`;
}

function Swatch({ hex, size = "md", label }) {
  const h = safeHex(hex);
  return html`<span class=${`p-brand-kit__chip p-brand-kit__chip--${size}${h ? "" : " p-brand-kit__chip--empty"}`}
    style=${h ? { background: h } : undefined} role=${label ? "img" : undefined} aria-label=${label || undefined} aria-hidden=${label ? undefined : "true"}></span>`;
}

function ColourList({ colours }) {
  return html`<ul class="p-brand-kit__offer-colours">
    ${arr(colours).map((c, i) => html`<li key=${i}><${Swatch} hex=${c.hex} size="sm" /><span>${cut(c.name, 24)}</span>
      <span class="p-brand-kit__mono">${safeHex(c.hex) || ""}</span><span class="u-caption">${ROLE_WORDS[c.role] || ""}</span></li>`)}
  </ul>`;
}

const Lines = ({ list }) => html`<ul class="p-brand-kit__offer-lines">${arr(list).slice(0, 12).map((l, i) => html`<li key=${i}>${cut(l, 200)}</li>`)}</ul>`;

function Checkbox({ checked, label, onChange, field }) {
  return html`<label class=${`p-brand-kit__check${checked ? " p-brand-kit__check--on" : ""}`}>
    <input type="checkbox" checked=${checked} data-field=${field} onChange=${(e) => onChange(e.currentTarget.checked)} />
    <span>${label}</span>
  </label>`;
}

// ---------------------------------------------------------------------------------------------------------------
// The path: what to do first, what is still empty

function Path({ filled, current }) {
  const done = PARTS.filter((p) => filled[p.id]).length;
  const next = nextPart(filled);
  return html`<nav class="p-brand-kit__path" aria-label="The parts of the brand kit">
    <div class="p-brand-kit__path-head">
      <${Ring} value=${done} total=${PARTS.length} size=${44} label=${`${done} of ${PARTS.length} parts filled`} />
      <div>
        <p class="p-brand-kit__path-count">${done} of ${PARTS.length} parts filled</p>
        <p class="u-caption">${next ? `Next: ${PARTS.find((p) => p.id === next).title}` : "Every part is filled."}</p>
      </div>
    </div>
    <ol class="p-brand-kit__steps">
      ${PARTS.map((p, i) => html`<li key=${p.id}>
        <button type="button" class=${`p-brand-kit__step${filled[p.id] ? " p-brand-kit__step--done" : ""}${p.id === next ? " p-brand-kit__step--next" : ""}${p.id === current ? " p-brand-kit__step--here" : ""}`}
          onClick=${() => goToPart(p.id)} aria-label=${`${p.title}: ${filled[p.id] ? "filled" : "still empty"}`}>
          <span class="p-brand-kit__step-mark" aria-hidden="true">${filled[p.id] ? html`<${Icon} name="check" size=${12} />` : i + 1}</span>
          <span class="p-brand-kit__step-words">
            <span class="p-brand-kit__step-title">${p.title}</span>
            <span class="p-brand-kit__step-state">${filled[p.id] ? "Filled" : p.id === next ? "Start here" : "Still empty"}</span>
          </span>
        </button>
      </li>`)}
    </ol>
  </nav>`;
}

function FirstTime() {
  return html`<${Card} class="p-brand-kit__first">
    <p class="u-over">Start here</p>
    <h2 class="p-brand-kit__first-title">Make your brand a set of rules the agents cannot break.</h2>
    <ol class="p-brand-kit__first-steps">
      <li><strong>Have a brand book?</strong> Add it to Brand, then start the job "Read the brand book". It proposes every part below for you to accept, one part at a time.</li>
      <li><strong>Or fill it in yourself,</strong> top to bottom. Colours first: everything else is drawn with them.</li>
      <li><strong>Press "Save the brand kit".</strong> Until then nothing is enforced.</li>
    </ol>
    <div class="p-brand-kit__first-actions">
      <${Button} icon="upload" href="#/files/brand?new=upload">Add your brand book<//>
      <${Button} variant="quiet" icon="arrow-right" href="#/jobs/operations/read-the-brand-book">Read the brand book<//>
    </div>
  <//>`;
}

// One part of the page: its heading, what it changes, its offers, its body.
function Part({ id, hint, aside, children, errors }) {
  const p = PARTS.find((x) => x.id === id) || { title: id, changes: "" };
  return html`<div class="p-brand-kit__part" id=${`bk-${id}`}>
    <${Section} title=${p.title} aside=${aside}>
      <p class="p-brand-kit__changes"><${Icon} name="spark" size=${14} /><span>${p.changes}</span></p>
      ${hint ? html`<p class="p-brand-kit__hint">${hint}</p>` : null}
      <${PartError} errors=${errors} part=${id} />
      ${children}
    <//>
  </div>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Name

function NamePart({ form, set, errors, offers, onUse }) {
  return html`<${Part} id="name" errors=${errors}>
    <${Card}>
      <${Field} label="Your company's name, as it is written" error=${errorAt(errors, "name")}>
        <${TextInput} data-field="name" value=${form.name} maxLength=${80} placeholder="The name on your door"
          onInput=${(e) => set({ ...form, name: e.currentTarget.value })} />
      <//>
      <${Offer} offer=${offers.name} form=${form} onUse=${onUse}><p class="p-brand-kit__offer-text">${cut(offers.name && offers.name.value, 80)}</p><//>
    <//>
  <//>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Colours

function Palette({ colours }) {
  const list = arr(colours).filter((c) => safeHex(c.hex));
  if (!list.length) return null;
  return html`<div class="p-brand-kit__palette" role="list" aria-label="Your palette">
    ${list.map((c, i) => {
      const hex = safeHex(c.hex);
      return html`<div key=${i} role="listitem" class=${`p-brand-kit__tile${c.role === "main" ? " p-brand-kit__tile--main" : ""}`}
        style=${{ background: hex, color: inkOn(hex) }}>
        <span class="p-brand-kit__tile-role">${c.role === "main" ? html`<${Icon} name="spark" size=${12} />` : null}${ROLE_WORDS[c.role] || "Other"}</span>
        <span class="p-brand-kit__tile-name">${normName(c.name) || "no name yet"}</span>
        <span class="p-brand-kit__tile-hex">${hex}</span>
      </div>`;
    })}
  </div>`;
}

function Pairing({ colours }) {
  const bg = colourFor(colours, "background");
  const ink = colourFor(colours, "text") || colourFor(colours, "main");
  if (!bg || !ink || bg === ink) return null;
  const ratio = contrast(bg, ink);
  const ok = ratio >= 4.5;
  return html`<p class="p-brand-kit__pairing">
    <span class="p-brand-kit__pairing-sample" style=${{ background: bg, color: ink }} aria-hidden="true">Aa</span>
    <span>Text on your background: contrast ${ratio.toFixed(1)} to 1. ${ok ? "Easy to read." : "Hard to read at small sizes; use it for large type only."}</span>
  </p>`;
}

function ColoursPart({ form, set, errors, offers, onUse }) {
  const colours = arr(form.colours);
  const put = (next) => set({ ...form, colours: next });
  const edit = (i, key, value) => put(colours.map((c, j) => (j === i ? { ...c, [key]: value } : c)));
  return html`<${Part} id="colours" errors=${errors}
    hint="Two to eight. Give each a short name the agents can use, such as ink or sand, and say what it is for.">
    <${Card} class="p-brand-kit__colours">
      ${colours.length ? html`<${Palette} colours=${colours} />` : html`<div class="p-brand-kit__empty">
        <span class="p-brand-kit__empty-chips" aria-hidden="true"><span></span><span></span><span></span></span>
        <p><strong>No colours yet.</strong> Add your main colour first: the one people know you by.</p>
      </div>`}
      ${colours.length ? html`<ul class="p-brand-kit__rows">
        ${colours.map((c, i) => {
          const hex = safeHex(c.hex);
          return html`<li key=${i} class="p-brand-kit__row">
            <label class="p-brand-kit__picker" style=${hex ? { background: hex } : undefined}>
              <input type="color" aria-label=${`Colour ${i + 1}, pick it`} value=${hex ? hex.toLowerCase() : "#808080"}
                onInput=${(e) => edit(i, "hex", normHex(e.currentTarget.value))} />
            </label>
            <div class="p-brand-kit__row-fields">
              <${Field} label=${`Colour ${i + 1}: name`} error=${errorAt(errors, `colours.${i}.name`)}>
                <${TextInput} data-field=${`colours.${i}.name`} value=${c.name} maxLength=${24} placeholder="ink" spellcheck=${false}
                  onInput=${(e) => edit(i, "name", e.currentTarget.value)} onBlur=${(e) => edit(i, "name", normName(e.currentTarget.value))} />
              <//>
              <${Field} label="Hex" error=${errorAt(errors, `colours.${i}.hex`)}>
                <${TextInput} data-field=${`colours.${i}.hex`} class="p-brand-kit__mono" value=${c.hex} maxLength=${7} placeholder="#1A3C5E" spellcheck=${false}
                  onInput=${(e) => edit(i, "hex", e.currentTarget.value)} onBlur=${(e) => edit(i, "hex", normHex(e.currentTarget.value))} />
              <//>
              <${Field} label="What it is for" error=${errorAt(errors, `colours.${i}.role`)}>
                <${Select} data-field=${`colours.${i}.role`} value=${c.role} options=${ROLES.map((r) => ({ value: r, label: ROLE_WORDS[r] }))}
                  onChange=${(e) => put(withRole(colours, i, e.currentTarget.value))} />
              <//>
            </div>
            <div class="p-brand-kit__row-tools">
              <${Button} variant="quiet" size="sm" icon="cross" aria-label=${`Remove colour ${i + 1}${c.name ? `, ${normName(c.name)}` : ""}`}
                onClick=${() => put(removeColour(colours, i))} />
            </div>
          </li>`;
        })}
      </ul>` : null}
      <div class="p-brand-kit__more">
        <${Button} size="sm" icon="plus" disabled=${colours.length >= LIMITS.colours[1]} onClick=${() => put(addColour(colours))}>
          ${colours.length ? "Add a colour" : "Add your main colour"}<//>
        <span class="u-caption">${colours.length} of ${LIMITS.colours[1]}</span>
      </div>
      <${Pairing} colours=${colours} />
      <${Switch} on=${form.neutrals} label="Greys, black and white are allowed"
        explain=${form.neutrals ? "The tools may also use greys, black and white beside your colours." : "Only your colours. A grey, black or white counts as off-brand unless it is in the list."}
        onChange=${(on) => set({ ...form, neutrals: on })} />
      <${Offer} offer=${offers.colours} form=${form} onUse=${onUse}><${ColourList} colours=${offers.colours && offers.colours.value} /><//>
      ${offers.neutrals ? html`<${Offer} offer=${offers.neutrals} form=${form} onUse=${onUse}>
        <p class="p-brand-kit__offer-text">${offers.neutrals.value ? "Greys, black and white are allowed." : "Only the listed colours."}</p><//>` : null}
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
  return html`<figure class="p-brand-kit__specimen" style=${{ background: bg, color: ink }} aria-label="A sample of your two faces">
    <p class="p-brand-kit__spec-over" style=${{ fontFamily: fontStack(t.body), color: accent }}>${name}</p>
    <p class="p-brand-kit__spec-display" style=${{ fontFamily: fontStack(t.heading), color: accent }}>Light falls on the stone</p>
    <p class="p-brand-kit__spec-slide" style=${{ fontFamily: fontStack(t.heading), fontSize: `${slide}px` }}>The smallest line on a slide</p>
    <p class="p-brand-kit__spec-body" style=${{ fontFamily: fontStack(t.body), fontSize: `${page}px` }}>
      Body text on a page is never smaller than this. Every caption, note and footer the tools set stays at ${page} pixels or more, so it can be read on a phone.
    </p>
    <figcaption class="p-brand-kit__spec-caption" style=${{ color: ink }}>
      <span>Headings: ${cut(t.heading && t.heading.family, 60)}</span>
      <span>Body: ${cut(t.body && t.body.family, 60)}</span>
      <span>Slides from ${slide} px · pages from ${page} px</span>
    </figcaption>
  </figure>`;
}

function FaceCard({ which, label, face, options, set, errors }) {
  const value = faceValue(face);
  const opts = withCurrent(options, value, cut(face && face.family, 60) || "Not chosen");
  const uploaded = Boolean(face && face.file);
  return html`<div class="p-brand-kit__face">
    <p class="p-brand-kit__face-sample" style=${{ fontFamily: fontStack(face) }} aria-hidden="true">Aa</p>
    <${Field} label=${label} error=${errorAt(errors, `type.${which}.family`) || errorAt(errors, `type.${which}.file`)}
      hint=${uploaded && !LOADED.has(face.family) ? "Shown here in its fallback. The tools use your file." : null}>
      <${Select} data-field=${`type.${which}.family`} value=${value} options=${opts} onChange=${(e) => set(faceFrom(e.currentTarget.value, face))} />
    <//>
    <${Field} label="If it is missing, use" error=${errorAt(errors, `type.${which}.fallback`)}>
      <${Select} data-field=${`type.${which}.fallback`} value=${face && face.fallback}
        options=${FALLBACKS.map((f) => ({ value: f, label: FALLBACK_WORDS[f] }))} onChange=${(e) => set({ ...face, fallback: e.currentTarget.value })} />
    <//>
  </div>`;
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
  return html`<div class="p-brand-kit__fonts">
    <div class="p-brand-kit__fonts-head">
      <h3 class="p-brand-kit__sub">Your font files</h3>
      <span class="u-caption">${list.length} of ${LIMITS.fonts}</span>
    </div>
    ${list.length
      ? html`<ul class="p-brand-kit__font-list">${list.map((f) => html`<li key=${f.file}>
          <${Icon} name="file" size=${14} />
          <span class="u-truncate">${familyFromFile(f.file)}</span>
          <span class="u-caption">${f.file} · ${bytes(f.size)}</span>
          <${Button} variant="quiet" size="sm" busy=${busy === f.file} disabled=${Boolean(busy)} aria-label=${`Remove the font ${f.file}`} onClick=${() => remove(f.file)}>Remove<//>
        </li>`)}</ul>`
      : html`<p class="u-muted">No font files yet. The fonts on this Mac are enough to start; add your own when the brand book names one.</p>`}
    ${adding
      ? html`<${FilePicker} accept=".ttf,.otf,.ttc" maxBytes=${LIMITS.fontBytes} busy=${busy === "add"} error=${error} onPick=${add} />`
      : html`<span><${Button} size="sm" icon="plus" disabled=${list.length >= LIMITS.fonts} onClick=${() => { setAdding(true); setError(null); }}>Add a font file<//></span>`}
    ${error && !adding ? html`<p class="p-brand-kit__part-error" role="alert"><${Icon} name="alert" size=${14} /><span>${error}</span></p>` : null}
  </div>`;
}

const pxField = (label, hint, field, value, onInput, errors) => html`<${Field} label=${label} hint=${hint} error=${errorAt(errors, field)}>
  <${TextInput} data-field=${field} type="number" inputmode="numeric" class="p-brand-kit__num" value=${value} onInput=${(e) => onInput(e.currentTarget.value)} />
<//>`;

function TypePart({ form, set, errors, offers, onUse, view, fonts, onFonts, announce }) {
  const t = form.type;
  const options = faceOptions(view.fontsOnThisMac, fonts);
  const setType = (next) => set({ ...form, type: { ...t, ...next } });
  const layout = form.layout || emptyKit().layout;
  const radii = withCurrent(RADII.map((r) => ({ value: String(r), label: r ? `${r} px` : "Square corners" })), String(layout.radiusPx), `${layout.radiusPx} px`);
  const margins = withCurrent(MARGINS.map((m) => ({ value: String(m), label: m ? `${Math.round(m * 1000) / 10}% of the width` : "No margin" })), String(layout.marginShare), `${Math.round(Number(layout.marginShare) * 1000) / 10}% of the width`);
  const offer = offers.type && offers.type.value;
  return html`<${Part} id="type" errors=${errors}>
    <div class="p-brand-kit__type">
      <${Specimen} form=${form} />
      <${Card} class="p-brand-kit__type-controls">
        <div class="p-brand-kit__faces">
          <${FaceCard} which="heading" label="Headings" face=${t.heading} options=${options} errors=${errors} set=${(f) => setType({ heading: f })} />
          <${FaceCard} which="body" label="Body text" face=${t.body} options=${options} errors=${errors} set=${(f) => setType({ body: f })} />
        </div>
        <div class="p-brand-kit__sizes">
          ${pxField("Smallest text on a page, in pixels", "10 to 40. 16 is a good start.", "type.minPx", t.minPx, (v) => setType({ minPx: v }), errors)}
          ${pxField("Smallest text on a slide, in pixels", "16 to 120. Slides are read from across a room.", "type.minSlidePx", t.minSlidePx, (v) => setType({ minSlidePx: v }), errors)}
          <${Field} label="Corners" error=${errorAt(errors, "layout.radiusPx")}>
            <${Select} data-field="layout.radiusPx" value=${String(layout.radiusPx)} options=${radii} onChange=${(e) => set({ ...form, layout: { ...layout, radiusPx: Number(e.currentTarget.value) } })} />
          <//>
          <${Field} label="Margins" error=${errorAt(errors, "layout.marginShare")}>
            <${Select} data-field="layout.marginShare" value=${String(layout.marginShare)} options=${margins} onChange=${(e) => set({ ...form, layout: { ...layout, marginShare: Number(e.currentTarget.value) } })} />
          <//>
        </div>
        <${Offer} offer=${offers.type} form=${form} onUse=${onUse}>
          ${offer ? html`<p class="p-brand-kit__offer-text">Headings in ${cut(offer.heading && offer.heading.family, 60)}, body text in ${cut(offer.body && offer.body.family, 60)}.
            Smallest ${Number(offer.minPx) || "?"} px on a page and ${Number(offer.minSlidePx) || "?"} px on a slide.</p>` : null}
        <//>
        ${offers.layout ? html`<${Offer} offer=${offers.layout} form=${form} onUse=${onUse}>
          <p class="p-brand-kit__offer-text">Corners ${Number(offers.layout.value.radiusPx) || 0} px, margins ${Math.round(Number(offers.layout.value.marginShare) * 1000) / 10}% of the width.</p><//>` : null}
        <${Fonts} fonts=${fonts} onFonts=${onFonts} announce=${announce} />
      <//>
    </div>
  <//>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Logo

function LogoStage({ tone, ground, logo, picture, clearSpace }) {
  const h = 56;
  const pad = Math.round(Number(clearSpace) * h);
  return html`<figure class=${`p-brand-kit__stage p-brand-kit__stage--${tone}`} style=${{ background: ground, color: inkOn(ground) }}>
    <figcaption class="p-brand-kit__stage-label">On ${tone} backgrounds</figcaption>
    ${picture
      ? html`<div class="p-brand-kit__clear" style=${{ padding: `${pad}px` }} title=${`Clear space: ${clearSpace} times the logo's height`}>
          <img src=${picture} alt=${`Your logo on a ${tone} background: ${cut(logo, 80)}`} style=${{ height: `${h}px` }} loading="lazy" decoding="async" />
        </div>
        <span class="p-brand-kit__stage-note">${pad ? `Dashed line: the clear space, ${clearSpace} × its height` : "No clear space"}</span>`
      : html`<span class="p-brand-kit__stage-none">No logo chosen for ${tone} backgrounds yet.</span>`}
  </figure>`;
}

function LogoPart({ form, set, errors, offers, onUse, brandPics }) {
  const logo = form.logo;
  const files = arr(logo.files);
  const pics = arr(brandPics);
  const urlOf = (name) => (pics.find((p) => p.name === name) || {}).url || null;
  const g = stages(form.colours);
  const pick = (on) => files.find((f) => f.on === on && urlOf(f.file));
  const toggle = (name, on) => {
    set({ ...form, logo: { ...logo, files: toggleLogo(files, name, on) } });
  };
  const putLogo = (next) => set({ ...form, logo: { ...logo, ...next } });
  const spaces = withCurrent(CLEAR_SPACES.map((c) => ({ value: String(c), label: c ? `${c} × the logo's height` : "None" })), String(logo.clearSpace), `${logo.clearSpace} × the logo's height`);
  const light = pick("light");
  const dark = pick("dark");
  const missing = files.filter((f) => !urlOf(f.file));
  return html`<${Part} id="logo" errors=${errors}
    hint="Choose your logo from the pictures in Brand: one that reads on light backgrounds and, if you have one, one for dark.">
    <${Card} class="p-brand-kit__logo">
      <div class="p-brand-kit__stages">
        <${LogoStage} tone="light" ground=${g.light} logo=${light && light.file} picture=${light && urlOf(light.file)} clearSpace=${logo.clearSpace} />
        <${LogoStage} tone="dark" ground=${g.dark} logo=${dark && dark.file} picture=${dark && urlOf(dark.file)} clearSpace=${logo.clearSpace} />
      </div>
      ${pics.length
        ? html`<ul class="p-brand-kit__logo-picks" aria-label="The pictures in Brand">
            ${pics.map((p) => html`<li key=${p.name} class="p-brand-kit__logo-pick">
              <span class="p-brand-kit__logo-thumb" style=${{ background: `linear-gradient(90deg, ${g.light} 50%, ${g.dark} 50%)` }}><img src=${p.url} alt="" loading="lazy" decoding="async" /></span>
              <span class="p-brand-kit__logo-name u-truncate" title=${p.name}>${p.name}</span>
              <span class="p-brand-kit__logo-use">
                ${["light", "dark"].map((on) => {
                  const pressed = files.some((f) => f.file === p.name && f.on === on);
                  return html`<button key=${on} type="button" class=${`p-brand-kit__toggle${pressed ? " p-brand-kit__toggle--on" : ""}`} aria-pressed=${pressed ? "true" : "false"}
                    aria-label=${`Use ${p.name} on ${on} backgrounds`} onClick=${() => toggle(p.name, on)}>
                    ${pressed ? html`<${Icon} name="check" size=${12} />` : null}On ${on}</button>`;
                })}
              </span>
            </li>`)}
          </ul>`
        : html`<div class="p-brand-kit__empty">
            <p><strong>No pictures in Brand yet.</strong> Add your logo file to the Brand folder, then choose it here.</p>
            <${Button} size="sm" icon="upload" href="#/files/brand?new=upload">Add your logo<//>
          </div>`}
      ${missing.length ? html`<${Notice} tone="warn" title="Not in Brand any more">
          ${missing.map((f) => html`<p key=${`${f.file}-${f.on}`}>${cut(f.file, 100)} (on ${f.on}).
            <${Button} variant="quiet" size="sm" onClick=${() => putLogo({ files: files.filter((x) => x !== f) })}>Take it out<//></p>`)}
        <//>` : null}
      <div class="p-brand-kit__sizes">
        <${Field} label="Clear space around it" error=${errorAt(errors, "logo.clearSpace")}>
          <${Select} data-field="logo.clearSpace" value=${String(logo.clearSpace)} options=${spaces} onChange=${(e) => putLogo({ clearSpace: Number(e.currentTarget.value) })} />
        <//>
        ${pxField("Smallest height, in pixels", "8 to 400. Smaller than this, the tools refuse it.", "logo.minPx", logo.minPx, (v) => putLogo({ minPx: v }), errors)}
      </div>
      <fieldset class="p-brand-kit__places">
        <legend class="p-brand-kit__sub">Where it must appear</legend>
        ${PLACES.map((p) => html`<${Checkbox} key=${p} field=${`logo.requiredOn.${p}`} label=${PLACE_WORDS[p]} checked=${arr(logo.requiredOn).includes(p)}
          onChange=${(on) => putLogo({ requiredOn: PLACES.filter((x) => (x === p ? on : arr(logo.requiredOn).includes(x))) })} />`)}
      </fieldset>
      <${Offer} offer=${offers.logo} form=${form} onUse=${onUse}>
        ${offers.logo ? html`<p class="p-brand-kit__offer-text">${arr(offers.logo.value.files).map((f) => `${cut(f.file, 60)} on ${f.on}`).join(", ") || "No logo file named."}
          Clear space ${Number(offers.logo.value.clearSpace)} × its height; at least ${Number(offers.logo.value.minPx)} px high.</p>` : null}
      <//>
    <//>
  <//>`;
}

// ---------------------------------------------------------------------------------------------------------------
// How we sound

function Words({ words, set, errors, face }) {
  const [typedWord, setTyped] = useState("");
  const list = arr(words);
  const add = () => {
    const w = typedWord.trim().slice(0, 40);
    if (!w || list.length >= LIMITS.words || list.includes(w)) return;
    set([...list, w]);
    setTyped("");
  };
  return html`<div class="p-brand-kit__words">
    <${Field} label="Three to five words for how you sound" hint=${`${list.length} of ${LIMITS.words}. Press Enter after each.`}
      error=${errorAt(errors, "voice.words") || list.map((_, i) => errorAt(errors, `voice.words.${i}`)).find(Boolean)}>
      <${TextInput} data-field="voice.words" value=${typedWord} maxLength=${40} placeholder=${list.length >= LIMITS.words ? "Five words is the most" : "warm"}
        disabled=${list.length >= LIMITS.words}
        onInput=${(e) => setTyped(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
    <//>
    ${list.length ? html`<ul class="p-brand-kit__word-list" style=${{ fontFamily: fontStack(face) }}>${list.map((w, i) => html`<li key=${i}>
      <span>${cut(w, 40)}</span>
      <button type="button" class="p-brand-kit__word-x" aria-label=${`Remove the word ${cut(w, 40)}`} onClick=${() => set(list.filter((_, j) => j !== i))}><${Icon} name="cross" size=${12} /></button>
    </li>`)}</ul>` : null}
  </div>`;
}

function DoList({ kind, list, set, errors }) {
  const items = arr(list);
  const shown = items.length ? items : [""];
  const put = (next) => set(next);
  const isDo = kind === "do";
  return html`<div class=${`p-brand-kit__dos p-brand-kit__dos--${kind}`}>
    <h3 class="p-brand-kit__sub"><span class="p-brand-kit__do-mark" aria-hidden="true"><${Icon} name=${isDo ? "check" : "cross"} size=${12} /></span>${isDo ? "Do" : "Don't"}</h3>
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
    <${Button} size="sm" icon="plus" disabled=${shown.length >= LIMITS.items} onClick=${() => put([...shown, ""])}>${isDo ? "Add a do" : "Add a don't"}<//>
  </div>`;
}

function VoicePart({ form, set, errors, offers, onUse, fillerCount }) {
  const v = form.voice;
  const putVoice = (next) => set({ ...form, voice: { ...v, ...next } });
  const count = Number.isInteger(fillerCount) ? fillerCount : null;
  return html`<${Part} id="voice" errors=${errors}>
    <${Card} class="p-brand-kit__voice">
      <${Words} words=${v.words} face=${form.type && form.type.heading} set=${(words) => putVoice({ words })} errors=${errors} />
      <${Offer} offer=${offers["voice.words"]} form=${form} onUse=${onUse}><p class="p-brand-kit__offer-text">${arr(offers["voice.words"] && offers["voice.words"].value).map((w) => cut(w, 40)).join(", ")}</p><//>
      <${Field} label="How you sound, in a few sentences" error=${errorAt(errors, "voice.is")}
        hint="Write it to a new writer: who you talk to, how close, what you never pretend.">
        <${TextArea} data-field="voice.is" autoGrow value=${v.is} maxLength=${1000} placeholder="Like an architect on site: plain, exact, warm with the client, never selling."
          onInput=${(e) => putVoice({ is: e.currentTarget.value })} />
      <//>
      <${Offer} offer=${offers["voice.is"]} form=${form} onUse=${onUse}><p class="p-brand-kit__offer-text">${cut(offers["voice.is"] && offers["voice.is"].value, 1000)}</p><//>
      <div class="p-brand-kit__do-dont">
        <div>
          <${DoList} kind="do" list=${v.do} set=${(list) => putVoice({ do: list })} errors=${errors} />
          <${Offer} offer=${offers["voice.do"]} form=${form} onUse=${onUse}><${Lines} list=${offers["voice.do"] && offers["voice.do"].value} /><//>
        </div>
        <div>
          <${DoList} kind="dont" list=${v.dont} set=${(list) => putVoice({ dont: list })} errors=${errors} />
          <${Offer} offer=${offers["voice.dont"]} form=${form} onUse=${onUse}><${Lines} list=${offers["voice.dont"] && offers["voice.dont"].value} /><//>
        </div>
      </div>
      <${Field} label="Sign-off" error=${errorAt(errors, "voice.signoff")} hint="How a letter or an email from you ends.">
        <${TextInput} data-field="voice.signoff" value=${v.signoff} maxLength=${200} placeholder="With care, the Sthyra studio"
          onInput=${(e) => putVoice({ signoff: e.currentTarget.value })} />
      <//>
      <${Offer} offer=${offers["voice.signoff"]} form=${form} onUse=${onUse}><p class="p-brand-kit__offer-text">${cut(offers["voice.signoff"] && offers["voice.signoff"].value, 200)}</p><//>
      <p class="p-brand-kit__never"><${Icon} name="lock" size=${14} /><span>Words and claims you never use are kept in <a href="#/files/brand?new=form:cant-say">What we never say</a>.</span></p>
      <${Switch} on=${form.filler && form.filler.block} label="Also block machine-sounding filler"
        explain=${count !== null ? `Stops ${count} stock phrases, such as "elevate your" and "seamless experience", from reaching you.` : "Stops stock phrases, such as \"elevate your\" and \"seamless experience\", from reaching you."}
        onChange=${(on) => set({ ...form, filler: { ...(form.filler || { allow: [] }), block: on } })} />
    <//>
  <//>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Examples of work you approve

function ReferencesPart({ form, set, errors, offers, onUse, refPics }) {
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
  return html`<${Part} id="references" errors=${errors}
    aside=${html`<${Button} size="sm" icon="upload" href="#/files/references?new=upload">Add pictures<//>`}
    hint="Pictures of work you are proud of. Choose which count, what each is an example of, and in one line why it is good.">
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
                    <legend class="u-caption">An example for</legend>
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
      : html`<${Card} class="p-brand-kit__empty p-brand-kit__empty--wall">
          <span class="p-brand-kit__empty-wall" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
          <p><strong>No pictures in References yet.</strong> Add work you are proud of: the Art director compares every new piece with it.</p>
          <${Button} size="sm" icon="upload" href="#/files/references?new=upload">Add pictures<//>
        <//>`}
    ${missing.length ? html`<${Notice} tone="warn" title="Not in References any more">
        ${missing.map(({ r }) => html`<p key=${r.file}>${cut(r.file, 120)}
          <${Button} variant="quiet" size="sm" onClick=${() => put(refs.filter((x) => x !== r))}>Take it out<//></p>`)}
      <//>` : null}
    <${Offer} offer=${offers.references} form=${form} onUse=${onUse}>
      ${offered ? html`<ul class="p-brand-kit__offer-lines">${offered.slice(0, 24).map((r, i) => html`<li key=${i}>${cut(r.file, 120)}${arr(r.kinds).length ? `, for ${arr(r.kinds).map((k) => (KIND_WORDS[k] || "").toLowerCase()).join(", ")}` : ""}${r.note ? `: ${cut(r.note, 200)}` : ""}</li>`)}</ul>` : null}
    <//>
  <//>`;
}

// ---------------------------------------------------------------------------------------------------------------
// What the Researcher may know, the picks, the playbooks

function PublicPart({ form, set, errors, offers, onUse }) {
  const s = str(form.public && form.public.summary);
  return html`<${Part} id="public" errors=${errors}>
    <${Card}>
      <${Field} label="A short public summary of the company" error=${errorAt(errors, "public.summary")} hint=${`${[...s].length} of ${LIMITS.summary} characters.`}>
        <${TextArea} data-field="public.summary" autoGrow value=${s} maxLength=${LIMITS.summary} placeholder="An architecture studio in Hyderabad that designs and builds homes and small offices."
          onInput=${(e) => set({ ...form, public: { summary: e.currentTarget.value } })} />
      <//>
      <p class="p-brand-kit__shared"><${Icon} name="lock" size=${14} /><span>${WORDS.researcher}</span></p>
      <${Offer} offer=${offers.public} form=${form} onUse=${onUse}><p class="p-brand-kit__offer-text">${cut(offers.public && offers.public.value && offers.public.value.summary, 600)}</p><//>
    <//>
  <//>`;
}

function Picks() {
  const res = useResource(`/api/brain/file/${fileToken(TASTE_PATH)}`);
  const none = res.error && (res.error.status === 404 || res.error.code === "file_not_found");
  const lines = res.data ? tasteLines(res.data.text).slice(0, 60) : [];
  return html`<div class="p-brand-kit__part" id="bk-picks">
    <${Section} title="Your picks so far" hint="What you chose between versions, kept for the agents. Only your own choices and notes are written here.">
      ${res.loading && !res.data ? html`<${Loading} lines=${2} label="Reading your picks" />`
        : none || (res.data && !lines.length) ? html`<${Empty} title=${WORDS.noPicks} />`
        : res.error ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`
        : html`<${Card} class="p-brand-kit__picks">${lines.map((l, i) => (l.kind === "head"
            ? html`<h3 key=${i} class="p-brand-kit__sub">${l.text}</h3>`
            : html`<p key=${i} class="p-brand-kit__pick-line">${l.text}</p>`))}<//>`}
    <//>
  </div>`;
}

function Playbooks({ rows }) {
  const list = arr(rows).filter((r) => r && SLUG.test(str(r.name)));
  const columns = [{ key: "name", label: "Playbook" }, { key: "roles", label: "Who reads it" }, { key: "kinds", label: "For which work" }];
  const cell = (r, c) => {
    if (c.key === "name") return html`<span class="p-brand-kit__mono">${r.name}</span>${r.origin === "own" ? html` <${Tag}>Yours<//>` : null}`;
    if (c.key === "roles") return arr(r.roles).map(roleName).filter(Boolean).join(", ") || "Any agent";
    return arr(r.kinds).map((k) => KIND_WORDS[k] || roleName(k)).filter(Boolean).join(", ") || "Any work";
  };
  return html`<div class="p-brand-kit__part" id="bk-playbooks">
    <${Section} title="Playbooks" hint="Craft notes the agents read before they make something. They read them; they cannot change them.">
      ${list.length
        ? html`<div class="p-brand-kit__table"><${DataTable} columns=${columns} rows=${list.map((r) => ({ ...r, id: r.name }))} renderCell=${cell} /></div>`
        : html`<${Empty} title=${WORDS.noPlaybooks}><${Button} size="sm" href="#/health">Open Health<//><//>`}
    <//>
  </div>`;
}

// ---------------------------------------------------------------------------------------------------------------
// The page

function useFolderPictures(id) {
  const res = useResource(`/api/brain/folder/${id}`, { every: 15000 });
  const pics = arr(res.data && res.data.files)
    .filter((f) => f && f.kind === "image" && /^\/api\/brain\/raw\/[A-Za-z0-9_-]{1,700}$/.test(str(f.rawUrl)))
    .map((f) => ({ name: cut(f.name, 120), path: str(f.path) || `${id}/${str(f.name)}`, url: f.rawUrl }));
  return pics;
}

function Restart() {
  return html`<${Card} class="p-brand-kit__later">
    <${StatusDot} tone="off" label="Not here yet" />
    <p>This page appears after the home screen is restarted: <code class="k-next__command">engine stop</code>, then <code class="k-next__command">engine start</code>.</p>
  <//>`;
}

function Header({ actions }) {
  return html`<${PageHeader} over="Company brain" title="Brand kit" lead=${WORDS.lead}
    chip=${{ label: ["Files", "Brand kit"], href: "#/files", closeLabel: "Back to all files" }} actions=${actions} />`;
}

function Editor({ view, reload }) {
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
  const brandPics = useFolderPictures("brand");
  const refPics = useFolderPictures("references");
  const offers = offersOf({ proposal: view.proposal, oldKit: view.fromOldForm ? view.kit : null, families: view.fontsOnThisMac });
  const proposal = obj(view.proposal) ? view.proposal : null;

  const set = (next) => { setFormState(next); if (outcome && outcome.kind === "saved") setOutcome(null); };
  const onUse = (offer) => { set(useOffer(form, offer.key, offer.value)); announce && announce("Used. Save the brand kit to keep it."); };
  const current = kitFromForm(form);
  const changed = changedParts(base, current);
  const dirty = changed.length > 0;
  const filled = filledParts(current, exists);
  const offerCount = Object.keys(offers).length;
  const unused = Object.values(offers).filter((o) => !offerUsed(form, o)).length;

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
      setTimeout(() => focusField(local[0].field), 0);
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
      setTimeout(() => focusField(res.field), 0);
      return;
    }
    setOutcome({ kind: "failed", message: res.error.message, next: res.error.next });
  };

  const saveButton = html`<${Button} variant="primary" icon="check" busy=${busy} disabled=${busy || (!dirty && exists && !view.problem)} onClick=${save}>${WORDS.save}<//>`;
  const status = view.problem && !outcome
    ? "The saved brand kit has a problem. Saving replaces it."
    : exists ? savedAt && fullWhen(savedAt) ? `Saved ${fullWhen(savedAt)}.` : "Saved." : WORDS.notSaved;

  return html`<div class="p-brand-kit">
    <${Header} actions=${saveButton} />
    <div class="p-brand-kit__status" role="status">
      <${StatusDot} tone=${view.problem && !outcome ? "bad" : exists && !dirty ? "ok" : exists ? "warn" : "off"} label=${dirty ? `Changed: ${changed.join(", ")}. Not saved yet.` : status} />
    </div>

    ${view.problem ? html`<${Notice} tone="bad" title=${PROBLEMS[view.problem] || "Part of the brand kit could not be read."} />` : null}
    ${outcome && outcome.kind === "saved" ? html`<${Notice} tone="ok" title=${WORDS.saved} />` : null}
    ${outcome && outcome.kind === "changed" ? html`<${Notice} tone="warn" title=${WORDS.changed}>
        <p>Your changes are still on this page. Open the newest version to see what changed; then make your changes again.</p>
        <div class="p-brand-kit__notice-actions"><${Button} size="sm" icon="loop" onClick=${reload}>Open the newest version<//></div>
      <//>` : null}
    ${outcome && outcome.kind === "refused" ? html`<${Notice} tone="bad" title="Not saved.">
        <p>${outcome.message}</p>
        <div class="p-brand-kit__notice-actions"><${Button} size="sm" icon="arrow-right" onClick=${() => focusField(outcome.field)}>Show me<//></div>
      <//>` : null}
    ${outcome && outcome.kind === "failed" ? html`<${Notice} tone="bad" title=${outcome.message}>${outcome.next || null}<//>` : null}

    ${proposal ? html`<${Card} tone="warm" class="p-brand-kit__banner">
        <span class="p-brand-kit__banner-icon" aria-hidden="true"><${Icon} name="book" size=${20} /></span>
        <div class="p-brand-kit__banner-words">
          <p class="p-brand-kit__banner-title">${WORDS.fromBook}</p>
          ${proposal.problem
            ? html`<p>${cut(proposal.problem, 200)}</p>`
            : html`<p>${offerCount ? `${offerCount} proposed ${offerCount === 1 ? "part sits" : "parts sit"} beside the fields below. Use each one you agree with, change what you like, then save.` : "The brand book named nothing the kit can use."}
              ${arr(proposal.dropped).length ? ` Not taken, in whole or in part, because it broke the kit's rules: ${arr(proposal.dropped).map((d) => (PARTS.find((p) => p.id === d) || {}).title || (d === "voice" ? "How we sound" : d === "all" ? "everything" : d === "other" ? "parts the kit does not know" : d)).join(", ")}.` : ""}</p>`}
          ${/^[A-Z][A-Z0-9]{0,9}-\d{1,9}$/.test(str(proposal.from)) ? html`<p class="u-caption">Read in task <a href=${`#/tasks/${proposal.from}`}>${proposal.from}</a>.</p>` : null}
        </div>
        ${unused > 1 ? html`<${Button} size="sm" onClick=${useAll}>Use every proposed part<//>` : null}
      <//>` : null}
    ${!proposal && view.fromOldForm ? html`<${Card} tone="warm" class="p-brand-kit__banner">
        <span class="p-brand-kit__banner-icon" aria-hidden="true"><${Icon} name="file" size=${20} /></span>
        <div class="p-brand-kit__banner-words">
          <p class="p-brand-kit__banner-title">${WORDS.fromOld}</p>
          <p>What your old brand page held sits beside the fields below. Use what still fits.</p>
        </div>
        ${unused > 1 ? html`<${Button} size="sm" onClick=${useAll}>Use all of it<//>` : null}
      <//>` : null}
    ${!exists && !proposal && !view.fromOldForm ? html`<${FirstTime} />` : null}

    <div class="p-brand-kit__layout">
      <aside class="p-brand-kit__rail"><${Path} filled=${filled} current=${errors && fieldPlace(errors.field).part} /></aside>
      <div class="p-brand-kit__parts">
        <${NamePart} form=${form} set=${set} errors=${errors} offers=${offers} onUse=${onUse} />
        <${ColoursPart} form=${form} set=${set} errors=${errors} offers=${offers} onUse=${onUse} />
        <${TypePart} form=${form} set=${set} errors=${errors} offers=${offers} onUse=${onUse} view=${view} fonts=${fonts} onFonts=${setFonts} announce=${announce} />
        <${LogoPart} form=${form} set=${set} errors=${errors} offers=${offers} onUse=${onUse} brandPics=${brandPics} />
        <${VoicePart} form=${form} set=${set} errors=${errors} offers=${offers} onUse=${onUse} fillerCount=${view.fillerCount} />
        <${ReferencesPart} form=${form} set=${set} errors=${errors} offers=${offers} onUse=${onUse} refPics=${refPics} />
        <${PublicPart} form=${form} set=${set} errors=${errors} offers=${offers} onUse=${onUse} />
        <${Picks} />
        <${Playbooks} rows=${view.playbooks} />
      </div>
    </div>

    ${dirty || !exists ? html`<div class="p-brand-kit__bar" role="region" aria-label="Save">
      <span class="p-brand-kit__bar-words">${dirty ? `Changed: ${changed.join(", ")}.` : WORDS.notSaved}</span>
      <span class="p-brand-kit__bar-actions">
        ${dirty && exists ? html`<${Button} variant="quiet" size="sm" disabled=${busy} onClick=${() => { setFormState(formFromKit(base)); setErrors(null); setOutcome(null); }}>Undo my changes<//>` : null}
        ${saveButton}
      </span>
    </div>` : null}
  </div>`;
}

export default function BrandKitPage({ route }) {
  const query = (route && route.query) || new URLSearchParams();
  const ref = str(query.get && query.get("proposal"));
  const address = kitAddress(ref);
  const res = useResource(address);
  const [round, setRound] = useState(0);
  const state = viewState(res);
  const reload = () => { setRound((n) => n + 1); res.reload(); };

  if (state === "ready") return html`<${Editor} key=${`${address}-${round}-${res.data.version || "new"}`} view=${res.data} reload=${reload} />`;
  return html`<div class="p-brand-kit">
    <${Header} />
    ${state === "loading" ? html`<${Loading} lines=${6} label="Opening the brand kit" />` : null}
    ${state === "restart" ? html`<${Restart} />` : null}
    ${state === "error" ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
  </div>`;
}
