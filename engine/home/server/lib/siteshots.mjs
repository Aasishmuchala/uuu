// The owner's own pictures of a site an agent built (PLAN-V5 K15's owner part, K16's last bullet, C14, C17, C21).
// Every file under a goal's `site/` was written by an agent (docs/adr/0007), so:
//   - a site's place is made here from the task's variants.json (lib/variants.mjs) or, with none, from the plain
//     folders under `site/` whose names fit the rule; a `ref` from a request is only ever matched against that list;
//   - its files are read with the viewer's own collectSite (lstat, no link followed, the viewer's names, endings
//     and sizes), with every folder on the way checked to be the same plain folder before and after the read;
//   - the pictures come from the page viewer (an owner token, only while its switch is on: C17), one page per call
//     and one render at a time for the whole home server, and its answer is read by readShotsTar, the home server's
//     own strict reader (C14): anything that is not exactly what the viewer writes refuses the whole answer;
//   - what is kept is the home server's own: `<homeData>/shots/<key>/` (0700, files 0600, written new and renamed,
//     500 MB in all, oldest removed first), named by the content hash of the site's files and the pages asked;
//   - the report goes to the owner only as plain sentences built here from capped values (reportLines).
// The key of a site folder is kept in memory beside a stamp of its names, sizes and times, so a site is read whole
// only when the stamp changes. Nothing here throws on what an agent wrote.
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync, constants as fsConstants, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, renameSync,
  rmSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { collectSite, endingOf, nameProblem } from "../../../viewer/sitefiles.mjs";
import { writeTar } from "../../../viewer/tar.mjs";
import { readKitFile } from "../brain/kit.mjs";
import { callDoor, readDoors } from "./doors.mjs";
import { goalFolder } from "./taskfiles.mjs";
import { readVariants } from "./variants.mjs";

const MB = 1024 * 1024;
export const SHOT_LIMITS = Object.freeze({
  sites: 6,                 // plain folders under site/ listed when there is no variants.json
  pages: 8,                 // index.html and up to seven more pages of the site (T58e: a site with more is "unknown")
  keptBytes: 500 * MB,      // every kept picture, added up
  answerBytes: 64 * MB,     // one answer of the viewer
  callMs: 120000,           // one call to the viewer
  entries: 16,              // entries in one answer
  pngBytes: 20 * MB,        // one picture
  reportBytes: 512 * 1024,  // report.json in one answer
  queue: 40,                // renders waiting at once
  stamps: 256,              // site folders whose key is remembered
  stampEntries: 5000,       // entries looked at for one stamp (past it, the site is read whole every time)
  busyWaitSec: 60,          // the most a `view_busy` answer may make the home server wait
});

export const SITE_NAME = /^[a-z0-9][a-z0-9-]{0,35}$/;
export const REF_RE = /^[a-z0-9][a-z0-9-]{0,35}(-[abc])?$/;
export const KEY_RE = /^[0-9a-f]{64}$/;
export const SHOT_NAME = /^shot-[A-Za-z0-9._-]{1,90}-(1280|390)-(light|dark)\.png$/;
const SHOT_PARTS = /^shot-([A-Za-z0-9._-]{1,90})-(1280|390)-(light|dark)\.png$/;
// A page the home server asks for: a file of the site whose name makes a shot name that fits SHOT_NAME (T58e: in
// any folder of the site; its slash is "_" in the shot's name, as the viewer writes it).
const PAGE_RE = /^[A-Za-z0-9._/-]{1,95}\.html$/;
const HEX_RE = /^#[0-9A-F]{6}$/;
const CUTS = { time: "it took too long to open.", memory: "it used more than 2 GB of memory.", crashed: "Chrome stopped while opening it.", "chrome ended": "Chrome stopped while opening it." };
const SHOW_LIST = 5;
const SHOW_COLOURS = 8;
const SHOW_CONTRAST = 3;
const SHOW_WIDER = 3;
const TRANSIENT_MS = 120000;

export const SAY = Object.freeze({
  none: "No pictures of this site yet.",
  working: "Taking pictures. This takes about a minute.",
  off: "The page viewer is off, so there are no pictures of this site. Switch it on in Settings.",
  notRunning: "The page viewer is not running, so no pictures were taken.",
  slow: "The page viewer did not answer in time, so no pictures were taken.",
  busy: "The page viewer was busy. Try again in a minute.",
  noChrome: "No Chrome was found on this Mac.",
  badSite: "The page viewer did not take this site.",
  answer: "The page viewer's answer was not what it sends.",
  keep: "The pictures could not be kept.",
  queue: "Too many sites are waiting for pictures. Try again in a few minutes.",
  gone: "This site is not there any more.",
  notYet: "Pictures of this version are not taken yet.",
  notYetOff: "Pictures of this version are not taken yet: the page viewer is off.",
});

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const lstatOrNull = (p) => { try { return lstatSync(p); } catch { return null; } };
const sameNode = (a, b) => !!a && !!b && a.dev === b.dev && a.ino === b.ino;
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
// Plain capped text: control, format and line-separator characters become spaces.
const plain = (v, max) => Array.from(String(v ?? "").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/ {2,}/g, " ").trim()).slice(0, max).join("");
const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? Math.min(v, 1_000_000) : 0);
const px = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 100000 ? Math.round(v * 100) / 100 : null);
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

// ---- keys and pages --------------------------------------------------------------------------------------------

const isPage = (n) => typeof n === "string" && PAGE_RE.test(n) && nameProblem(n, "file") === null && /^[A-Za-z0-9._-]{1,90}$/.test(pageSlug(n));

// The pages pictures are taken of (and the brand is measured on): index.html, then the site's other pages in any
// of its folders, in name order, up to SHOT_LIMITS.pages in all. A page whose shot name would be another's is left
// out (and so is not measured: see htmlPages).
export function pagesOf(files) {
  const names = (Array.isArray(files) ? files : []).map((f) => f && f.name).filter(isPage);
  if (!names.includes("index.html")) return [];
  const more = names.filter((n) => n !== "index.html").sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out = ["index.html"];
  const slugs = new Set([pageSlug("index.html")]);
  for (const n of more) {
    if (out.length >= SHOT_LIMITS.pages) break;
    if (slugs.has(pageSlug(n))) continue;
    slugs.add(pageSlug(n));
    out.push(n);
  }
  return out;
}

// Every file of the site a browser opens as a page (an .html ending in any letter case), measured or not.
export function htmlPages(files) {
  return (Array.isArray(files) ? files : []).filter((f) => f && typeof f.name === "string" && endingOf(f.name) === "html").length;
}

// SHA-256 over the sorted lines `<name>\0<sha256 of data>\n`, then the pages asked.
export function siteKey(files, pages) {
  const lines = files.map((f) => `${f.name}\0${sha256(f.data)}\n`).sort();
  const h = createHash("sha256");
  for (const line of lines) h.update(line);
  h.update(`pages\0${pages.join(",")}\n`);
  return h.digest("hex");
}

function pageSlug(page) { return page.replace(/\.html$/, "").replace(/\//g, "_"); }

// ---- the sites of a task -----------------------------------------------------------------------------------------

// sitesOf(config, identifier) -> { sites: [{ ref, variant, direction, rel }], problem }. With a variants.json of
// pages, its versions' places `site/<name>-<id>/`; with none, the plain folders under `site/` whose names fit
// SITE_NAME (at most 6, in name order). `problem` is variants.json's own plain sentence.
export function sitesOf(config, identifier) {
  const v = readVariants(config, identifier, "page");
  if (v.present) {
    if (v.problem) return { sites: [], problem: v.problem };
    return {
      sites: v.variants.map((x) => ({ ref: `${v.name}-${x.id}`, variant: x.id, direction: x.direction, rel: x.rel })),
      problem: null,
    };
  }
  const base = goalFolder(config, identifier);
  const folder = base ? join(base, "site") : null;
  const st = folder ? lstatOrNull(folder) : null;
  if (!st || !st.isDirectory()) return { sites: [], problem: null };
  let names = [];
  try { names = readdirSync(folder).filter((n) => SITE_NAME.test(n)).sort(); } catch { names = []; }
  const sites = [];
  for (const n of names) {
    if (sites.length >= SHOT_LIMITS.sites) break;
    const s = lstatOrNull(join(folder, n));
    if (s && s.isDirectory()) sites.push({ ref: n, variant: null, direction: null, rel: `site/${n}` });
  }
  return { sites, problem: null };
}

// The site of `ref` in the task's list, or null. `ref` is never used as a path: only a listed site is.
export function findSite(config, identifier, ref) {
  if (typeof ref !== "string" || !REF_RE.test(ref)) return null;
  return sitesOf(config, identifier).sites.find((s) => s.ref === ref) || null;
}

// ---- reading a site ----------------------------------------------------------------------------------------------

// The site's files as the viewer reads them, with the goal's folder, `site/` and the site's own folder each a plain
// folder whose real path is where it should be, and the very same folders after the read.
// -> collectSite's { ok: true, files, left, bytes } or { ok: false, sentence }.
export function readSite(config, identifier, rel) {
  const base = goalFolder(config, identifier);
  if (!base || typeof rel !== "string" || !/^site\/[a-z0-9][a-z0-9-]{0,37}$/.test(rel)) return { ok: false, sentence: SAY.gone };
  const chain = [base, join(base, "site"), join(base, rel)];
  const before = chain.map(lstatOrNull);
  if (!before.every((s) => s && s.isDirectory())) return { ok: false, sentence: SAY.gone };
  let real = null;
  try { real = realpathSync(chain[2]); } catch { real = null; }
  if (real !== chain[2]) return { ok: false, sentence: SAY.gone };
  // T58d N2: walked from the goal's real folder down with no link on any path, never resolved again.
  const read = collectSite(chain[2], { real: true });
  if (read.ok && read.root !== chain[2]) return { ok: false, sentence: SAY.gone };
  const after = chain.map(lstatOrNull);
  if (!before.every((s, i) => sameNode(s, after[i]) && after[i].isDirectory())) return { ok: false, sentence: "This site changed while it was read. Try again." };
  if (!read.ok) return { ok: false, sentence: `This site cannot be opened: ${plain(read.reason, 200)}.` };
  return read;
}

// A stamp of a site folder: every entry's name, mode, size, times and node, walked with lstat (never into a link).
// null when it is not a plain folder or holds too many entries to stamp.
function stampOf(dir) {
  const top = lstatOrNull(dir);
  if (!top || !top.isDirectory()) return null;
  const h = createHash("sha256");
  h.update(`${top.dev}:${top.ino}:${top.mtimeMs}:${top.ctimeMs}\n`);
  let seen = 0;
  const walk = (abs, rel, depth) => {
    let names;
    try { names = readdirSync(abs); } catch { return false; }
    names.sort();
    for (const n of names) {
      if (++seen > SHOT_LIMITS.stampEntries) return false;
      const st = lstatOrNull(join(abs, n));
      const name = rel ? `${rel}/${n}` : n;
      if (!st) return false;
      h.update(`${name}\0${st.mode}\0${st.size}\0${st.mtimeMs}\0${st.ctimeMs}\0${st.ino}\n`);
      if (st.isDirectory() && depth < 8 && !walk(join(abs, n), name, depth + 1)) return false;
    }
    return true;
  };
  return walk(dir, "", 0) ? h.digest("hex") : null;
}

const stamps = new Map(); // site folder -> { stamp, info }

// siteInfo(config, identifier, rel) -> { ok, key, files, bytes, left, pages, htmlPages, problem }: what the route
// shows of a site, the key its pictures are kept under (null when it cannot be read), and how many of its files
// are pages (T58e: more than `pages` is a site not measured in full).
export function siteInfo(config, identifier, rel) {
  const base = goalFolder(config, identifier);
  const dir = base && typeof rel === "string" ? join(base, rel) : null;
  const stamp = dir ? stampOf(dir) : null;
  const had = stamp ? stamps.get(dir) : null;
  if (had && had.stamp === stamp) return had.info;
  const read = readSite(config, identifier, rel);
  let info;
  if (read.ok) {
    const pages = pagesOf(read.files);
    info = { ok: true, key: siteKey(read.files, pages), files: read.files.length, bytes: read.bytes, left: read.left.map((l) => ({ name: plain(l.name, 120), why: plain(l.why, 120) })), pages, htmlPages: htmlPages(read.files), problem: null };
  } else {
    info = { ok: false, key: null, files: 0, bytes: 0, left: [], pages: [], htmlPages: 0, problem: read.sentence };
  }
  if (stamp && dir && stampOf(dir) === stamp) {
    stamps.delete(dir);
    stamps.set(dir, { stamp, info });
    while (stamps.size > SHOT_LIMITS.stamps) stamps.delete(stamps.keys().next().value);
  }
  return info;
}

// ---- the viewer's answer (C14) -----------------------------------------------------------------------------------

const BLOCK = 512;
const allZero = (b) => { for (let i = 0; i < b.length; i++) if (b[i] !== 0) return false; return true; };

// A NUL-ended text field whose every byte after the end is NUL too; null otherwise.
function field(h, start, len) {
  const f = h.subarray(start, start + len);
  const end = f.indexOf(0);
  if (end >= 0 && !allZero(f.subarray(end))) return null;
  return f.subarray(0, end < 0 ? len : end).toString("latin1");
}

function octal(h, start, len) {
  const t = field(h, start, len);
  if (t === null || !/^[0-7]{1,12} ?$/.test(t)) return null;
  const n = parseInt(t, 8);
  return Number.isSafeInteger(n) ? n : null;
}

function checksumOk(h) {
  const t = h.subarray(148, 156).toString("latin1").replace(/[\0 ]+$/, "");
  if (!/^[0-7]{1,7}$/.test(t)) return false;
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
  return sum === parseInt(t, 8);
}

// PNG first bytes, then IHDR as the first chunk, with a width and height.
export function pngOk(data) {
  if (!Buffer.isBuffer(data) || data.length < 33) return false;
  if (data.readUInt32BE(0) !== 0x89504e47 || data.readUInt32BE(4) !== 0x0d0a1a0a) return false;
  if (data.readUInt32BE(8) !== 13 || data.toString("latin1", 12, 16) !== "IHDR") return false;
  return data.readUInt32BE(16) > 0 && data.readUInt32BE(20) > 0;
}

const list = (v, cap, each) => (Array.isArray(v) ? v : []).map(each).filter((x) => x !== null).slice(0, cap);

// One page of K15's report, as the home server keeps it: every value checked, capped and made plain. null when it
// is not a page of that shape.
function cleanPage(p) {
  if (!obj(p) || !isPage(p.page)) return null;
  for (const k of ["errors", "wider", "missing", "blocked", "contrast", "fonts", "colours", "drawn", "fallbacks", "shots"]) {
    if (p[k] !== undefined && !Array.isArray(p[k])) return null;
  }
  if (p.a11y !== undefined && !obj(p.a11y)) return null;
  const a = obj(p.a11y) ? p.a11y : {};
  return {
    page: p.page,
    errors: list(p.errors, 20, (e) => (typeof e === "string" ? plain(e, 300) : null)),
    wider: list(p.wider, 20, (w) => (obj(w) ? { tag: plain(w.tag, 20), cls: plain(w.cls, 40), width: count(w.width), at: w.at === 390 || w.at === 1280 ? w.at : null } : null)),
    missing: list(p.missing, 20, (m) => (typeof m === "string" ? plain(m, 120) : null)),
    blocked: list(p.blocked, 20, (b) => (typeof b === "string" ? plain(b, 140) : null)),
    a11y: {
      noAlt: count(a.noAlt), noLabel: count(a.noLabel), noLang: a.noLang === true, noTitle: a.noTitle === true,
      headingSkips: count(a.headingSkips), smallTargets: count(a.smallTargets),
    },
    contrast: list(p.contrast, 20, (c) => (obj(c) && HEX_RE.test(c.fg) && HEX_RE.test(c.bg) && px(c.ratio) !== null
      ? { text: plain(c.text, 40), fg: c.fg, bg: c.bg, ratio: px(c.ratio) } : null)),
    fonts: list(p.fonts, 20, (f) => (obj(f) && px(f.minPx) !== null ? { family: plain(f.family, 80), minPx: px(f.minPx) } : null)),
    colours: list(p.colours, 120, (c) => (typeof c === "string" && HEX_RE.test(c) ? c : null)),
    drawn: list(p.drawn, 20, (d) => (typeof d === "string" && plain(d, 80) ? plain(d, 80) : null)),
    // T58e: faces Chrome drew only letters of other scripts with (the page's own face has none of them)
    fallbacks: list(p.fallbacks, 20, (d) => (typeof d === "string" && plain(d, 80) ? plain(d, 80) : null)),
    dark: p.dark === true,
    cut: typeof p.cut === "string" && p.cut ? (Object.hasOwn(CUTS, p.cut) ? p.cut : "other") : null,
    // T58b: elements drawn through a filter or blend mode, and whether the page held more than the report lists
    filtered: count(p.filtered),
    capped: p.capped === true,
    // T58e: gradients round the hue wheel, parts a paint worklet draws, text whose drawn size is not known, and
    // animations the viewer could not put at their keyframes
    turned: count(p.turned),
    painted: count(p.painted),
    unsized: count(p.unsized),
    unsettled: count(p.unsettled),
  };
}

// readShotsTar(buf, { pages }) -> { ok: true, shots: [{ name, data }], report: { pages } } or { ok: false, reason }.
// ustar only, type 0 only, names `report.json` or SHOT_NAME (each once), at most 16 entries, a PNG at most 20 MB with
// PNG first bytes and an IHDR, exactly one report.json of at most 512 KB of JSON with K15's pages list, and nothing
// after the entries but the zero blocks that end it. With `pages`, every shot and report page is of those pages.
// Anything else refuses the whole answer.
export function readShotsTar(buf, { pages = null } = {}) {
  const no = { ok: false, reason: SAY.answer };
  if (!Buffer.isBuffer(buf) || buf.length < 2 * BLOCK || buf.length % BLOCK !== 0 || buf.length > SHOT_LIMITS.answerBytes) return no;
  const slugs = Array.isArray(pages) ? pages.map(pageSlug) : null;
  const shots = [];
  const names = new Set();
  let report = null;
  let off = 0;
  let entries = 0;
  for (;;) {
    if (off + BLOCK > buf.length) return no;
    const h = buf.subarray(off, off + BLOCK);
    if (allZero(h)) break;
    if (++entries > SHOT_LIMITS.entries) return no;
    if (h.toString("latin1", 257, 263) !== "ustar\0" || h.toString("latin1", 263, 265) !== "00") return no;
    if (!checksumOk(h) || h[156] !== 0x30) return no;
    if (!allZero(h.subarray(345, 500))) return no;
    const name = field(h, 0, 100);
    const size = octal(h, 124, 12);
    if (name === null || size === null || names.has(name)) return no;
    if (name !== "report.json" && !SHOT_NAME.test(name)) return no;
    names.add(name);
    const start = off + BLOCK;
    const end = start + size;
    if (end > buf.length) return no;
    const data = buf.subarray(start, end);
    if (name === "report.json") {
      if (size > SHOT_LIMITS.reportBytes) return no;
      let doc;
      try { doc = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); } catch { return no; }
      if (!obj(doc) || !Array.isArray(doc.pages) || doc.pages.length < 1 || doc.pages.length > SHOT_LIMITS.pages) return no;
      const cleaned = [];
      for (const p of doc.pages) {
        const c = cleanPage(p);
        if (!c || cleaned.some((x) => x.page === c.page) || (pages && !pages.includes(c.page))) return no;
        cleaned.push(c);
      }
      report = { pages: cleaned };
    } else {
      if (size > SHOT_LIMITS.pngBytes || !pngOk(data)) return no;
      if (slugs && !slugs.includes(SHOT_PARTS.exec(name)[1])) return no;
      shots.push({ name, data: Buffer.from(data) });
    }
    off = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  if (buf.length - off < 2 * BLOCK || !allZero(buf.subarray(off))) return no;
  if (!report) return no;
  return { ok: true, shots, report };
}

// ---- the report as sentences ---------------------------------------------------------------------------------------

// The kit's facts the report is compared with: { colours: ["#RRGGBB"], families: [names], minPx } or null.
export function kitFacts(config) {
  let raw;
  try { raw = readKitFile(config).raw; } catch { return null; }
  if (!obj(raw)) return null;
  const colours = list(raw.colours, 8, (c) => (obj(c) && typeof c.hex === "string" && /^#[0-9A-Fa-f]{6}$/.test(c.hex) ? c.hex.toUpperCase() : null));
  const type = obj(raw.type) ? raw.type : {};
  const families = ["heading", "body"].map((k) => (obj(type[k]) && typeof type[k].family === "string" ? plain(type[k].family, 80) : "")).filter(Boolean);
  const minPx = Number.isInteger(type.minPx) && type.minPx >= 10 && type.minPx <= 40 ? type.minPx : null;
  return { colours, families, minPx };
}

const names = (items, cap = SHOW_LIST) => {
  const shown = items.slice(0, cap).join(", ");
  return items.length > cap ? `${shown} and ${items.length - cap} more` : shown;
};
const isGrey = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(...c) - Math.min(...c) <= 10;
};

// reportLines(page, kit) -> plain sentences for one page of a kept report: what to fix, or "Nothing to fix was
// found.", then the faces it was drawn with. Every value is one this file capped; nothing else is said.
export function reportLines(page, kit = null) {
  const p = cleanPage(page);
  if (!p) return [];
  const lines = [];
  const n = p.errors.length;
  if (n === 1) lines.push(`1 error in the page's console: ${plain(p.errors[0], 120)}`);
  else if (n > 1) lines.push(`${n} errors in the page's console, such as: ${plain(p.errors[0], 120)}`);
  for (const w of p.wider.slice(0, SHOW_WIDER)) {
    const classes = w.cls.split(/\s+/).filter(Boolean).join(".");
    const what = classes ? `${w.tag || "an element"}.${classes}` : (w.tag || "an element");
    lines.push(`Wider than the screen${w.at ? ` at ${w.at} px` : ""}: ${what} (${w.width} px)`);
  }
  if (p.missing.length) lines.push(`Pictures that did not load: ${names(p.missing.map((m) => plain(m, 60)))}`);
  if (p.blocked.length === 1) lines.push("The page tried to reach 1 other address; it was blocked.");
  else if (p.blocked.length > 1) lines.push(`The page tried to reach ${p.blocked.length} other addresses; each was blocked.`);
  const a = p.a11y;
  if (a.noAlt === 1) lines.push("1 picture has no description (alt)");
  else if (a.noAlt > 1) lines.push(`${a.noAlt} pictures have no description (alt)`);
  if (a.noLabel === 1) lines.push("1 form field has no label");
  else if (a.noLabel > 1) lines.push(`${a.noLabel} form fields have no label`);
  if (a.noLang) lines.push("The page does not say its language");
  if (a.noTitle) lines.push("The page has no title");
  if (a.headingSkips === 1) lines.push("Headings skip a level once");
  else if (a.headingSkips > 1) lines.push(`Headings skip a level ${a.headingSkips} times`);
  if (a.smallTargets === 1) lines.push("1 link or button is smaller than 24 px");
  else if (a.smallTargets > 1) lines.push(`${a.smallTargets} links or buttons are smaller than 24 px`);
  for (const c of p.contrast.slice(0, SHOW_CONTRAST)) lines.push(`Hard to read: "${c.text}" (${c.fg} on ${c.bg}, ${c.ratio} to 1)`);
  const faces = p.drawn.length ? p.drawn : [...new Set(p.fonts.map((f) => f.family).filter(Boolean))];
  if (kit && kit.families && kit.families.length) {
    const own = new Set(kit.families.map((f) => f.toLowerCase()));
    const others = faces.filter((f) => !own.has(f.toLowerCase()));
    if (others.length) lines.push(`Faces that are not your kit's: ${names(others)}`);
  }
  const sizes = p.fonts.map((f) => f.minPx).filter((v) => v !== null && v > 0);
  if (kit && kit.minPx && sizes.length && Math.min(...sizes) < kit.minPx) {
    lines.push(`Smallest text: ${Math.min(...sizes)} px; your kit's smallest is ${kit.minPx} px`);
  }
  if (kit && kit.colours && kit.colours.length) {
    const own = new Set(kit.colours);
    const others = p.colours.filter((c) => !own.has(c) && !isGrey(c));
    if (others.length) lines.push(`Colours that are not in your kit: ${names(others, SHOW_COLOURS)}`);
  }
  // T58e: what the brand verdict rests on, said here too: parts whose colours cannot be compared, and what was
  // not measured
  const parts = (n) => (n === 1 ? "1 part" : `${n} parts`);
  if (p.filtered) lines.push(`${parts(p.filtered)} drawn through a filter or blend mode, whose colours cannot be compared with your kit`);
  if (p.turned) lines.push(`${parts(p.turned)} drawn with a gradient that goes round the colour wheel, through colours that are not in your kit`);
  if (p.painted) lines.push(`${parts(p.painted)} drawn by a script in the style sheet (a paint worklet), whose colours cannot be compared with your kit`);
  if (p.unsized) lines.push(`Not measured: the drawn size of ${p.unsized === 1 ? "1 piece" : `${p.unsized} pieces`} of text`);
  if (p.unsettled) lines.push(`Not measured: ${p.unsettled === 1 ? "1 animation" : `${p.unsettled} animations`} the page viewer could not run to each of its steps`);
  if (p.capped) lines.push("Not measured in full: the page holds more elements, colours or faces than the page viewer lists");
  if (p.cut) lines.push(`This page was cut: ${CUTS[p.cut] || "it did not finish."}`);
  if (!lines.length) lines.push("Nothing to fix was found.");
  if (p.fallbacks.length) lines.push(`Some text is drawn in another face because your kit's face has no letters for it: ${names(p.fallbacks)}`);
  if (faces.length) lines.push(`Drawn with: ${names(faces)}`);
  return lines;
}

// ---- the kept pictures ---------------------------------------------------------------------------------------------

// `<homeData>/shots`, a plain folder of this user's, made 0700 when `create`; null when it is not one.
function shotsRoot(config, { create = false } = {}) {
  const home = config?.paths?.homeData;
  if (typeof home !== "string" || !home) return null;
  const root = join(home, "shots");
  if (create) {
    try { mkdirSync(home, { recursive: true, mode: 0o700 }); } catch { return null; }
    if (!lstatOrNull(root)) { try { mkdirSync(root, { mode: 0o700 }); } catch { /* checked below */ } }
  }
  const st = lstatOrNull(root);
  return st && st.isDirectory() && st.uid === process.getuid() ? root : null;
}

// A file of a kept folder, opened once with no-follow: its bytes when it is a regular file of at most `max`.
function readKeptFile(path, max) {
  let fd;
  try { fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK); } catch { return null; }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > max) return null;
    const buf = Buffer.alloc(st.size);
    let got = 0;
    while (got < st.size) {
      const n = readSync(fd, buf, got, st.size - got, got);
      if (n <= 0) break;
      got += n;
    }
    return got === st.size ? buf : null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

// keptShots(config, key) -> { taken, names: [shot names], pages: [report pages] } or null when none are kept.
export function keptShots(config, key) {
  if (typeof key !== "string" || !KEY_RE.test(key)) return null;
  const root = shotsRoot(config);
  const dir = root ? join(root, key) : null;
  const st = dir ? lstatOrNull(dir) : null;
  if (!st || !st.isDirectory()) return null;
  const raw = readKeptFile(join(dir, "report.json"), 2 * MB);
  let doc = null;
  try { doc = raw ? JSON.parse(raw.toString("utf8")) : null; } catch { doc = null; }
  if (!obj(doc) || !Array.isArray(doc.pages)) return null;
  let files = [];
  try { files = readdirSync(dir).filter((n) => SHOT_NAME.test(n)); } catch { return null; }
  return {
    taken: typeof doc.taken === "string" && Number.isFinite(Date.parse(doc.taken)) ? doc.taken : null,
    names: files,
    pages: doc.pages.map(cleanPage).filter(Boolean),
  };
}

// One kept picture's bytes, checked as a PNG, or null.
export function readShot(config, key, name) {
  if (typeof key !== "string" || !KEY_RE.test(key) || typeof name !== "string" || !SHOT_NAME.test(name)) return null;
  const root = shotsRoot(config);
  const dir = root ? join(root, key) : null;
  const st = dir ? lstatOrNull(dir) : null;
  if (!st || !st.isDirectory()) return null;
  const data = readKeptFile(join(dir, name), SHOT_LIMITS.pngBytes);
  return data && pngOk(data) ? data : null;
}

// Every kept folder added up; the oldest removed first until all fit in `maxBytes` (never `keep`). Folders left by
// a write that did not finish are removed.
export function pruneShots(root, maxBytes, keep = null) {
  let entries = [];
  try { entries = readdirSync(root); } catch { return; }
  const kept = [];
  for (const n of entries) {
    const p = join(root, n);
    const st = lstatOrNull(p);
    if (!st) continue;
    if (/^\.(new|old)-[0-9a-f]{12}$/.test(n)) { rmSync(p, { recursive: true, force: true }); continue; }
    if (!KEY_RE.test(n) || !st.isDirectory()) continue;
    let size = 0;
    try { for (const f of readdirSync(p)) { const s = lstatOrNull(join(p, f)); if (s && s.isFile()) size += s.size; } } catch { /* counted as it is */ }
    kept.push({ n, p, size, at: st.mtimeMs });
  }
  let total = kept.reduce((s, k) => s + k.size, 0);
  kept.sort((x, y) => x.at - y.at);
  for (const k of kept) {
    if (total <= maxBytes) break;
    if (k.n === keep) continue;
    rmSync(k.p, { recursive: true, force: true });
    total -= k.size;
  }
}

// Writes a render's pictures and its report into a new folder, then renames it to `<key>`.
function keep(config, key, shots, pages, taken, maxBytes = SHOT_LIMITS.keptBytes) {
  const root = shotsRoot(config, { create: true });
  if (!root) throw new Error("the shots folder is not a plain folder");
  const tmp = join(root, `.new-${randomBytes(6).toString("hex")}`);
  mkdirSync(tmp, { mode: 0o700 });
  try {
    for (const s of shots) writeFileSync(join(tmp, s.name), s.data, { mode: 0o600, flag: "wx" });
    writeFileSync(join(tmp, "report.json"), `${JSON.stringify({ version: 1, taken, pages })}\n`, { mode: 0o600, flag: "wx" });
    const dest = join(root, key);
    if (lstatOrNull(dest)) {
      const old = join(root, `.old-${randomBytes(6).toString("hex")}`);
      renameSync(dest, old);
      rmSync(old, { recursive: true, force: true });
    }
    renameSync(tmp, dest);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  pruneShots(root, maxBytes, key);
}

// ---- the state of a site's pictures ------------------------------------------------------------------------------

const working = new Map();   // `<homeData>\0<key>` -> the render's promise
const failures = new Map();  // `<homeData>\0<key>` -> { sentence, at, transient }
let chain = Promise.resolve();
let waiting = 0;

const slot = (config, key) => `${config?.paths?.homeData}\0${key}`;

// Whether the owner has the page viewer's switch on (a switches file that cannot be read is off).
export function viewerOn(config) {
  try {
    const { state, problem } = readDoors(config);
    return !problem && state.viewer.on === true;
  } catch {
    return false;
  }
}

const imagesOf = (key, kept, pages) => {
  const out = [];
  for (const page of pages) {
    for (const width of [1280, 390]) {
      for (const scheme of ["light", "dark"]) {
        const name = `shot-${pageSlug(page)}-${width}-${scheme}.png`;
        if (kept.names.includes(name)) out.push({ url: `/api/sites/shot/${key}/${name}`, page, width, scheme });
      }
    }
  }
  return out;
};

// shotsView(config, info, { on, kit }) -> { state, sentence, taken, images, report } for one site's info.
export function shotsView(config, info, { on = viewerOn(config), kit = null } = {}) {
  const none = { state: "none", sentence: SAY.none, taken: null, images: [], report: [] };
  if (!info || !info.ok) return { ...none, state: "failed", sentence: info ? info.problem : SAY.gone };
  const busy = working.has(slot(config, info.key));
  const kept = keptShots(config, info.key);
  if (kept) {
    const pages = kept.pages.map((p) => p.page);
    return {
      state: busy ? "working" : "ready",
      sentence: busy ? SAY.working : null,
      taken: kept.taken,
      images: imagesOf(info.key, kept, pages),
      report: kept.pages.map((p) => ({ page: p.page, lines: reportLines(p, kit) })),
    };
  }
  if (busy) return { ...none, state: "working", sentence: SAY.working };
  const failed = failures.get(slot(config, info.key));
  if (failed) return { ...none, state: "failed", sentence: failed.sentence };
  if (!on) return { ...none, state: "off", sentence: SAY.off };
  return none;
}

// The preview of a page version in the pick card: the kept pictures of its index page (1280 light, then 390 light),
// or one sentence.
export function pagePreview(config, identifier, variant) {
  const info = variant && typeof variant.rel === "string" ? siteInfo(config, identifier, variant.rel) : null;
  const kept = info && info.ok ? keptShots(config, info.key) : null;
  const out = [];
  for (const name of ["shot-index-1280-light.png", "shot-index-390-light.png"]) {
    if (kept && kept.names.includes(name)) out.push({ type: "image", url: `/api/sites/shot/${info.key}/${name}`, file: name });
  }
  if (out.length) return out;
  return [{ type: "text", text: viewerOn(config) ? SAY.notYet : SAY.notYetOff }];
}

// ---- taking pictures ---------------------------------------------------------------------------------------------

// One render at a time for the whole home server.
function enqueue(fn) {
  if (waiting >= SHOT_LIMITS.queue) return Promise.resolve({ ok: false, sentence: SAY.queue, transient: true });
  waiting += 1;
  const run = chain.then(fn).catch(() => ({ ok: false, sentence: SAY.keep })).finally(() => { waiting -= 1; });
  chain = run.then(() => {}, () => {});
  return run;
}

// Resolves once no render is waiting or running (for tests and a clean stop).
export async function shotsIdle() {
  while (waiting > 0) await chain;
}

// Forgets every remembered key and failure (tests); a render already queued goes on.
export function forgetSiteShots() {
  stamps.clear();
  failures.clear();
}

// One call to the viewer for one page: `view_busy` waits its retryAfterSec once.
async function callViewer(ctx, tar, page) {
  const opts = { type: "application/x-tar", query: `pages=${page}`, timeoutMs: SHOT_LIMITS.callMs, maxBytes: SHOT_LIMITS.answerBytes };
  let r = await callDoor(ctx, "viewer", "/view/shots", tar, opts);
  if (r.ok && r.status === 403 && obj(r.json) && r.json.code === "view_busy") {
    const sec = Number.isInteger(r.json.retryAfterSec) && r.json.retryAfterSec >= 0 ? Math.min(r.json.retryAfterSec, SHOT_LIMITS.busyWaitSec) : 30;
    await wait(sec * 1000);
    r = await callDoor(ctx, "viewer", "/view/shots", tar, opts);
  }
  return r;
}

// A failed call as a sentence: { sentence, transient, reason }.
function failureOf(r) {
  if (!r.ok) {
    if (r.reason === "nothing") return { sentence: SAY.slow, transient: true, reason: "no_answer" };
    if (r.reason === "cut") return { sentence: SAY.answer, transient: false, reason: "answer" };
    if (r.reason === "bad_path") return { sentence: SAY.badSite, transient: false, reason: "answer" };
    return { sentence: SAY.notRunning, transient: true, reason: "no_answer" };
  }
  const code = obj(r.json) && typeof r.json.code === "string" ? r.json.code : null;
  if (code === "view_busy") return { sentence: SAY.busy, transient: true, reason: "busy" };
  if (code === "view_no_chrome") return { sentence: SAY.noChrome, transient: true, reason: "no_chrome" };
  if (code === "view_off") return { sentence: SAY.off, transient: true, reason: "off" };
  if (code === "view_bad_site") return { sentence: SAY.badSite, transient: false, reason: "answer" };
  return { sentence: SAY.answer, transient: false, reason: "answer" };
}

// Pictures of every page of a site's files: one viewer call per page. -> { ok: true, shots, pages } or
// { ok: false, sentence, transient, reason }. `owner` (the Test) works with the switch off (C17).
async function shoot(ctx, files, { owner = false } = {}) {
  const pages = pagesOf(files);
  if (!pages.length) return { ok: false, sentence: "This site cannot be opened: there is no index.html at the top.", transient: false, reason: "answer" };
  const tar = writeTar(files);
  const shots = [];
  const reported = [];
  for (const page of pages) {
    if (!owner && !viewerOn(ctx.config)) return { ok: false, sentence: SAY.off, transient: true, reason: "off" };
    const r = await callViewer(ctx, tar, page);
    if (!r.ok || r.status !== 200 || r.type !== "application/x-tar") return { ok: false, ...failureOf(r) };
    const answer = readShotsTar(r.bytes, { pages: [page] });
    if (!answer.ok) return { ok: false, sentence: SAY.answer, transient: false, reason: "answer" };
    shots.push(...answer.shots);
    reported.push(...answer.report.pages);
  }
  return { ok: true, shots, pages: reported };
}

// takeShots(ctx, identifier, ref) -> a promise of { state, sentence }: the site's pictures taken again and kept.
// Only while the viewer's switch is on (else `off` and no call); a site already being taken is not queued twice.
export function takeShots(ctx, identifier, ref) {
  const config = ctx.config;
  const site = findSite(config, identifier, ref);
  if (!site) return Promise.resolve({ state: "failed", sentence: SAY.gone });
  if (!viewerOn(config)) return Promise.resolve({ state: "off", sentence: SAY.off });
  const info = siteInfo(config, identifier, site.rel);
  if (!info.ok) return Promise.resolve({ state: "failed", sentence: info.problem });
  const at = slot(config, info.key);
  if (working.has(at)) return working.get(at);
  failures.delete(at);
  let also = null; // the key of the files the render really read, when the site changed while it waited
  const run = enqueue(async () => {
    if (!viewerOn(config)) return { ok: false, sentence: SAY.off, transient: true };
    const read = readSite(config, identifier, site.rel);
    if (!read.ok) return { ok: false, sentence: read.sentence, transient: false };
    const key = siteKey(read.files, pagesOf(read.files));
    if (key !== info.key && !working.has(slot(config, key))) {
      also = slot(config, key);
      working.set(also, run);
    }
    const done = await shoot(ctx, read.files);
    if (!done.ok) return { ...done, key };
    try { keep(config, key, done.shots, done.pages, new Date().toISOString()); } catch { return { ok: false, sentence: SAY.keep, transient: false, key }; }
    return { ok: true, key };
  }).then((out) => {
    working.delete(at);
    if (also) working.delete(also);
    if (out.ok) return { state: "ready", sentence: null };
    if (out.sentence === SAY.off) return { state: "off", sentence: SAY.off };
    const record = { sentence: out.sentence, at: Date.now(), transient: !!out.transient };
    failures.set(at, record);
    if (out.key && out.key !== info.key) failures.set(slot(config, out.key), record);
    while (failures.size > 500) failures.delete(failures.keys().next().value);
    return { state: "failed", sentence: out.sentence };
  });
  working.set(at, run);
  return run;
}

// Starts taking a site's pictures in the background when it has none, nothing is being taken and no failure is
// waiting for the owner (a failure because the viewer was not there is tried again after two minutes). Never waits.
export function requestShots(ctx, identifier, ref) {
  try {
    const config = ctx.config;
    if (!viewerOn(config)) return false;
    const site = findSite(config, identifier, ref);
    if (!site) return false;
    const info = siteInfo(config, identifier, site.rel);
    if (!info.ok) return false;
    const at = slot(config, info.key);
    if (working.has(at) || keptShots(config, info.key)) return false;
    const failed = failures.get(at);
    if (failed && !(failed.transient && Date.now() - failed.at > TRANSIENT_MS)) return false;
    takeShots(ctx, identifier, ref).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

// The owner's Test (C17: whatever the switch): the given files (the home server's own test page) through the
// viewer. -> { ok, seconds, pictures, images, sentence, reason }; `reason` is "no_answer", "no_chrome", "busy",
// "answer" or null.
export async function testViewer(ctx, files) {
  const started = Date.now();
  const out = await enqueue(async () => {
    const done = await shoot(ctx, files, { owner: true });
    if (!done.ok) return done;
    const key = siteKey(files, pagesOf(files));
    try { keep(ctx.config, key, done.shots, done.pages, new Date().toISOString()); } catch { return { ok: false, sentence: SAY.keep, reason: "answer" }; }
    return { ok: true, key, shots: done.shots };
  });
  const seconds = Math.max(1, Math.round((Date.now() - started) / 1000));
  if (!out.ok) return { ok: false, seconds, pictures: 0, images: [], sentence: out.sentence, reason: out.reason || "answer" };
  const kept = keptShots(ctx.config, out.key);
  const images = kept ? imagesOf(out.key, kept, kept.pages.map((p) => p.page)) : [];
  return {
    ok: true, seconds, pictures: out.shots.length, images,
    sentence: `Chrome opened a test page and took ${out.shots.length} pictures in ${seconds} seconds.`, reason: null,
  };
}
