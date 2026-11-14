// PLAN-V5 T58b: a page's brand verdict from the home server's own render, the judge an agent cannot talk round.
// The brand check by code (lib/brandcheck.mjs) reads a site's files; a page can still draw what its files do not
// plainly say. So the home server compares its OWN page viewer report of the site (the one its pictures come from,
// kept by lib/siteshots.mjs under the hash of the very files it rendered; never a report from the task folder) with
// the brand kit, and a disagreement is a hard line on the piece's brand, whatever the check by code said:
//   - colours: every colour Chrome drew is one of the kit's (each channel within 2 of it), or a grey (Lab chroma at
//     most 8, the brand check's own measure) when the kit allows neutrals;
//   - faces: every text element's face is one of the kit's, and so is every face Chrome drew with (when the kit
//     names faces of this Mac; an uploaded font's own name inside its file is not known here);
//   - size: no text smaller than the kit's smallest;
//   - addresses: the page asked for nothing outside the site;
//   - a filter or blend mode: colours that cannot be compared, so a fail as the check by code fails them.
// A version the viewer has not measured (no pictures kept of its current files), a page cut short or one with more
// elements or colours than the report lists is "unknown", never "pass". Every line is built here from capped values.
// T58e: the size is the size text is DRAWN at (zoom, transforms and SVG viewBoxes included); a gradient that goes
// round the hue wheel and a part a paint worklet draws fail as a filter does; text whose drawn size is not known and
// an animation the viewer could not run to its steps are "unknown". So is "nothing measured": no site at all, a site
// with more pages than were measured, a page of the site with no report, and a folder under site/ the home server
// does not list. A face Chrome drew only the letters of another script with (Devanagari, Telugu, …) while the
// page's own faces are the kit's is a soft line, never a fail: the kit's face has no letters for it.
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readKitFile } from "../brain/kit.mjs";
import { SHOT_LIMITS, keptShots, siteInfo, sitesOf, viewerOn } from "./siteshots.mjs";
import { goalFolder } from "./taskfiles.mjs";

const MAX_LINES = 10;
const SHOW = 5;
const NEAR = 2;              // channel difference that is still the kit's colour (Chrome's rounding of mixes)
const GREY_CHROMA = 8;

export const MEASURED_SAY = Object.freeze({
  notYet: "The page viewer has not measured this version yet, so it is not marked as fitting the brand.",
  notYetOff: "The page viewer is off, so this version is not measured and not marked as fitting the brand.",
  failed: "The page viewer could not open this version, so it is not marked as fitting the brand.",
  noSite: "There is no site the page viewer opens, so nothing was measured and it is not marked as fitting the brand.",
});

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const norm = (s) => String(s).toLowerCase().split(/\s+/).filter(Boolean).join(" ");
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const names = (items) => (items.length > SHOW ? `${items.slice(0, SHOW).join(", ")} and ${items.length - SHOW} more` : items.join(", "));

// sRGB 0-255 -> CIE Lab chroma (D65), as engine/art/brandcheck.py's lab().
function chroma([r, g, b]) {
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  return Math.hypot(500 * (f(x) - f(y)), 200 * (f(y) - f(z)));
}

// The kit as the judge reads it, or null when there is none to compare with.
export function measuredKit(config) {
  let raw;
  try { raw = readKitFile(config).raw; } catch { return null; }
  if (!obj(raw)) return null;
  const colours = (Array.isArray(raw.colours) ? raw.colours : []).slice(0, 32)
    .map((c) => (obj(c) && typeof c.hex === "string" && /^#[0-9A-Fa-f]{6}$/.test(c.hex) ? rgbOf(c.hex.toUpperCase()) : null)).filter(Boolean);
  const type = obj(raw.type) ? raw.type : {};
  const faces = ["heading", "body"].map((k) => (obj(type[k]) ? type[k] : {}));
  const families = faces.map((f) => (typeof f.family === "string" ? norm(f.family) : "")).filter(Boolean);
  const minPx = Number.isInteger(type.minPx) && type.minPx >= 10 && type.minPx <= 40 ? type.minPx : null;
  if (!colours.length && !families.length && !minPx) return null;
  return { colours, families: new Set(families), minPx, neutrals: raw.neutrals !== false, uploaded: faces.some((f) => typeof f.file === "string" && f.file) };
}

function colourOk(kit, hex) {
  const c = rgbOf(hex);
  if (kit.colours.some((k) => k.every((v, i) => Math.abs(v - c[i]) <= NEAR))) return true;
  return kit.neutrals && chroma(c) <= GREY_CHROMA;
}

// One kept report page (siteshots' cleanPage shape) against the kit -> { fail: [lines], unknown: [lines],
// soft: [lines] }.
export function judgePage(page, kit) {
  const fail = [];
  const unknown = [];
  const soft = [];
  if (!obj(page) || !kit) return { fail, unknown, soft };
  const parts = (n) => (n === 1 ? "1 part" : `${n} parts`);
  const colours = (page.colours || []).filter((c) => typeof c === "string" && /^#[0-9A-F]{6}$/.test(c));
  const off = colours.filter((c) => !colourOk(kit, c));
  if (kit.colours.length && off.length) fail.push(`colours that are not in your kit: ${names(off)}`);
  if (page.filtered > 0) fail.push(`${parts(page.filtered)} drawn through a filter or blend mode, whose colours cannot be compared with your kit`);
  if (page.turned > 0) fail.push(`${parts(page.turned)} drawn with a gradient that goes round the colour wheel, through colours that are not in your kit`);
  if (page.painted > 0) fail.push(`${parts(page.painted)} drawn by a script in the style sheet (a paint worklet), whose colours cannot be compared with your kit`);
  if (kit.families.size) {
    const set = [...new Set((page.fonts || []).map((f) => (obj(f) ? String(f.family || "") : "")).filter(Boolean))];
    const other = set.filter((f) => !kit.families.has(norm(f)));
    if (other.length) fail.push(`text set in faces that are not your kit's: ${names(other)}`);
    if (!kit.uploaded) {
      const drawn = (page.drawn || []).filter((d) => typeof d === "string" && d && !kit.families.has(norm(d)) && !other.includes(d));
      if (drawn.length) fail.push(`drawn with faces that are not your kit's: ${names(drawn)}`);
      // T58e (N4): the page asks for the kit's faces and Chrome filled in letters they have none of from the Mac's
      // own face for that script: the Builder cannot fix that, so it is said, not failed
      const filling = (page.fallbacks || []).filter((d) => typeof d === "string" && d && !kit.families.has(norm(d)) && !drawn.includes(d));
      if (filling.length && !other.length) soft.push(`Some text is drawn in another face because your kit's face has no letters for it: ${names(filling)}`);
    }
  }
  const sizes = (page.fonts || []).map((f) => (obj(f) ? f.minPx : null)).filter((v) => typeof v === "number" && v > 0);
  if (kit.minPx && sizes.length && Math.min(...sizes) < kit.minPx) fail.push(`text of ${Math.min(...sizes)} px; your kit's smallest is ${kit.minPx} px`);
  const blocked = (page.blocked || []).length;
  if (blocked) fail.push(`the page tried to reach ${blocked === 1 ? "1 address" : `${blocked} addresses`} outside the site`);
  if (page.cut) unknown.push("the page did not finish in the page viewer, so it was not measured in full");
  if (page.capped) unknown.push("the page holds more elements, colours or faces than the page viewer lists, so not all were measured");
  if (page.unsized > 0) unknown.push(`the drawn size of ${page.unsized === 1 ? "1 piece" : `${page.unsized} pieces`} of text could not be worked out (a 3D transform or font-size-adjust), so it was not measured`);
  if (page.unsettled > 0) unknown.push(`${page.unsettled === 1 ? "1 animation" : `${page.unsettled} animations`} could not be run to each of its steps (one that follows scrolling, or has more steps than the page viewer measures), so the page was not measured as it looks later`);
  return { fail, unknown, soft };
}

// The folders under a goal's site/ that are not among `rels`: plain folders only, counted up to 100.
function unlistedFolders(config, identifier, rels) {
  const base = goalFolder(config, identifier);
  if (!base) return 0;
  const folder = join(base, "site");
  let st = null;
  try { st = lstatSync(folder); } catch { return 0; }
  if (!st.isDirectory()) return 0;
  let names = [];
  try { names = readdirSync(folder).slice(0, 1000); } catch { return 0; }
  let n = 0;
  for (const name of names) {
    if (n >= 100) break;
    let s = null;
    try { s = lstatSync(join(folder, name)); } catch { s = null; }
    if (s && s.isDirectory() && !rels.includes(`site/${name}`)) n++;
  }
  return n;
}

// measuredBrand(config, identifier, rels, { kit, on, whole }) -> { state: "nokit" } | { state: "done", result,
// lines }: the verdict of the home server's own kept report of each site place in `rels` (a version's own place, or
// every site of a single piece: `whole`, when a folder under site/ that is not in `rels` is not measured either).
// result is "fail" on any disagreement, "unknown" when anything is not measured (no place at all included), else
// "pass". Soft lines come last and change no result.
export function measuredBrand(config, identifier, rels, { kit = measuredKit(config), on, whole = false } = {}) {
  if (!kit) return { state: "nokit" };
  const places = (Array.isArray(rels) ? rels : [rels]).filter((r) => typeof r === "string");
  const fails = [];
  const unknowns = [];
  const softs = [];
  const label = (page) => (places.length > 1 || page !== "index.html" ? `${page}: ` : "");
  if (!places.length) unknowns.push(MEASURED_SAY.noSite);
  if (whole) {
    const left = unlistedFolders(config, identifier, places);
    if (left) {
      unknowns.push(`${left === 1 ? "1 folder" : `${left} folders`} under site/ ${left === 1 ? "is" : "are"} not a site the page viewer opens (a site's folder is named with lower-case letters, digits and dashes, and at most ${SHOT_LIMITS.sites} are opened), so ${left === 1 ? "it was" : "they were"} not measured.`);
    }
  }
  for (const rel of places) {
    let info = null;
    try { info = siteInfo(config, identifier, rel); } catch { info = null; }
    if (!info || !info.ok) { unknowns.push(MEASURED_SAY.failed); continue; }
    const kept = keptShots(config, info.key);
    if (!kept || !kept.pages.length) {
      const isOn = typeof on === "boolean" ? on : viewerOn(config);
      unknowns.push(isOn ? MEASURED_SAY.notYet : MEASURED_SAY.notYetOff);
      continue;
    }
    const site = places.length > 1 ? `${rel.replace(/^site\//, "")}: ` : "";
    // every page of the site, measured: one past the cap, or one whose name the viewer cannot be asked for, is not
    const missing = info.pages.filter((pg) => !kept.pages.some((p) => p.page === pg)).length + Math.max(0, (info.htmlPages || 0) - info.pages.length);
    if (missing > 0) {
      unknowns.push(`Measured in the page viewer: ${site}${missing === 1 ? "1 page" : `${missing} pages`} of this site ${missing === 1 ? "was" : "were"} not measured (the page viewer measures at most ${SHOT_LIMITS.pages} pages of a site, each with a plain name), so the site is not marked as fitting the brand.`);
    }
    for (const page of kept.pages) {
      const j = judgePage(page, kit);
      const where = places.length > 1 ? `${rel.replace(/^site\//, "")}, ${page.page}: ` : label(page.page);
      for (const l of j.fail) fails.push(`Measured in the page viewer: ${where}${l}.`);
      for (const l of j.unknown) unknowns.push(`Measured in the page viewer: ${where}${l}.`);
      for (const l of j.soft) softs.push(`Measured in the page viewer: ${where}${l}.`);
    }
  }
  const result = fails.length ? "fail" : unknowns.length ? "unknown" : "pass";
  return { state: "done", result, lines: [...new Set([...fails, ...unknowns, ...softs])] };
}

// Every site of a single page piece (no variants.json): their places. Measure them with { whole: true }, so a folder
// under site/ the list leaves out is "unknown", not passed over.
export function sitePlaces(config, identifier) {
  try { return sitesOf(config, identifier).sites.map((s) => s.rel); } catch { return []; }
}

// The brand line of a page version with the measured verdict put over it: a measured fail fails it, an unmeasured
// version is never "pass", and the measured lines come first.
export function withMeasured(brand, measured) {
  if (!measured || measured.state !== "done") return brand;
  let result = brand.result;
  if (measured.result === "fail") result = "fail";
  else if (measured.result === "unknown" && result !== "fail") result = "unknown";
  return { result, lines: [...measured.lines, ...brand.lines].slice(0, MAX_LINES) };
}
