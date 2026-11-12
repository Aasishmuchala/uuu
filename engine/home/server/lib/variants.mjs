// A task's versions on disk (PLAN-V5 K7, K9): `<goal>/variants.json` and the pieces at their places by
// convention. Everything in a goal's folder was written by an agent (docs/adr/0007), so:
//   - the kind is never the agent's: the caller passes the kind the job's craft entry gives (the task's
//     `template:` record), and variants.json must agree with it;
//   - variants.json is read by lstat first (a link is refused, not followed), at most 16 KB, from one
//     checked descriptor (lib/taskfiles.mjs), and only its pinned keys are used, each checked;
//   - a piece's place is made here from the kind's folder, the checked name and the id (a, b or c), and each
//     place is checked with lstat under the goal's folder: no path is ever taken from the file;
//   - a preview is a picture at a fixed name in that place, checked by its first bytes, shown through
//     /api/view; or a draft's body as plain capped text. Nothing is rendered or run.
// Nothing here throws on what an agent wrote: a broken file gives `problem`, one plain sentence.
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { directionsFor } from "../../../company/lib/craft-files.mjs";
import { fileToken, goalFolder, readChecked, readTaskText } from "./taskfiles.mjs";
import { readGoalBytes, sniff } from "../routes/_images.mjs";

export const MAX_VARIANTS_JSON = 16 * 1024;
export const NAME = /^[a-z0-9][a-z0-9-]{0,35}$/;
export const IDS = ["a", "b", "c"];
export const MAX_PREVIEW_TEXT = 1500;
const MAX_DRAFT_READ = 64 * 1024;
const MAX_IMAGE = 20 * 1024 * 1024;   // the most /api/view shows of one picture
const MAX_ROUND = 10;

// K7's places: the kind's folder, whether a piece is a folder (else `<name>-<id>.md`), and the kind the
// brand check's report gives such a piece (engine/art/brandcheck.py FOLDERS).
export const PLACES = {
  post: { folder: "drafts", dir: false, report: "draft" },
  newsletter: { folder: "drafts", dir: false, report: "draft" },
  carousel: { folder: "slides", dir: true, report: "slides" },
  poster: { folder: "slides", dir: true, report: "slides" },
  "title-card": { folder: "video", dir: true, report: "video" },
  film: { folder: "film", dir: true, report: "film" },
  page: { folder: "site", dir: true, report: "site" },
};

const SAYS = {
  link: "variants.json is not a plain file (it may be a link), so the versions cannot be shown.",
  large: "variants.json is larger than 16 KB, so the versions cannot be shown.",
  unread: "variants.json could not be read, so the versions cannot be shown.",
  json: "variants.json is not valid JSON, so the versions cannot be shown.",
  shape: "variants.json does not have the shape of a list of versions, so the versions cannot be shown.",
  noKind: "This task was not started from a job that makes versions, so its versions cannot be shown.",
  otherKind: "variants.json names another kind of piece than the job makes, so the versions cannot be shown.",
  name: "The name in variants.json is not a plain name (small letters, digits and dashes), so the versions cannot be shown.",
  count: "variants.json must list one to three versions, so the versions cannot be shown.",
  id: "A version in variants.json has an id other than a, b or c, so the versions cannot be shown.",
  twice: "A version is listed twice in variants.json, so the versions cannot be shown.",
  unknown: "A version names a direction that is not in the list for this kind, so the versions cannot be shown.",
  repeated: "Two versions take the same direction, so the versions cannot be shown. Each version must take its own.",
};

const lstatOrNull = (p) => { try { return lstatSync(p); } catch { return null; } };
const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

// The piece's place inside the goal's folder, made from checked parts only.
export function placeOf(kind, name, id) {
  const p = PLACES[kind];
  if (!p || !NAME.test(name) || !IDS.includes(id)) return null;
  return { rel: `${p.folder}/${name}-${id}${p.dir ? "" : ".md"}`, dir: p.dir, report: p.report, reportName: `${name}-${id}` };
}

// readVariants(config, identifier, kind) -> { present, name, round, variants: [{ id, direction: { id, title },
//   rel, dir, report, reportName }], missing: [ids], problem }. `present` is false when the goal has no
// variants.json (a single piece). `kind` is the job's kind (craft), or null.
export function readVariants(config, identifier, kind, { directions = directionsFor } = {}) {
  const out = { present: false, name: null, round: null, variants: [], missing: [], problem: null };
  const fail = (key) => ({ ...out, present: true, problem: SAYS[key] });
  try {
    const base = goalFolder(config, identifier);
    if (!base) return out;
    const file = join(base, "variants.json");
    const st = lstatOrNull(file);
    if (!st) return out;
    if (!st.isFile()) return fail("link");
    if (st.size > MAX_VARIANTS_JSON) return fail("large");
    const read = readChecked(file, base, { maxBytes: MAX_VARIANTS_JSON });
    if (!read) return fail("unread");
    if (read.truncated) return fail("large");
    let doc;
    try { doc = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.bytes)); } catch { return fail("json"); }
    if (!isObject(doc) || !Array.isArray(doc.variants)) return fail("shape");
    if (typeof kind !== "string" || !PLACES[kind]) return fail("noKind");
    if (doc.kind !== kind) return fail("otherKind");
    if (typeof doc.name !== "string" || !NAME.test(doc.name)) return fail("name");
    if (doc.variants.length < 1 || doc.variants.length > IDS.length) return fail("count");
    let listed = [];
    try { listed = directions(kind) || []; } catch { listed = []; }
    const seenIds = new Set();
    const seenDirs = new Set();
    const variants = [];
    for (const v of doc.variants) {
      if (!isObject(v) || !IDS.includes(v.id)) return fail("id");
      if (seenIds.has(v.id)) return fail("twice");
      seenIds.add(v.id);
      const d = typeof v.direction === "string" ? listed.find((x) => x.id === v.direction) : null;
      if (!d) return fail("unknown");
      if (seenDirs.has(d.id)) return fail("repeated");
      seenDirs.add(d.id);
      variants.push({ id: v.id, direction: { id: d.id, title: d.title } });
    }
    const round = Number.isInteger(doc.round) && doc.round >= 1 && doc.round <= MAX_ROUND ? doc.round : null;
    // Each place checked with lstat: the kind's folder a real folder (not a link), the piece a real folder
    // or a regular file at its fixed name. A link anywhere leaves the version out.
    const folder = lstatOrNull(join(base, PLACES[kind].folder));
    const folderOk = !!folder && folder.isDirectory();
    const found = [];
    const missing = [];
    for (const v of variants.sort((a, b) => a.id.localeCompare(b.id))) {
      const place = placeOf(kind, doc.name, v.id);
      const st2 = folderOk && place ? lstatOrNull(join(base, place.rel)) : null;
      const ok = !!st2 && (place.dir ? st2.isDirectory() : st2.isFile());
      if (ok) found.push({ ...v, ...place });
      else missing.push(v.id);
    }
    return { present: true, name: doc.name, round, variants: found, missing, problem: null };
  } catch {
    return fail("unread");
  }
}

// A draft's body as plain text: the header block between two "---" lines left out, control and format
// characters (other than line breaks) made spaces, at most 1500 characters.
export function draftBody(text) {
  if (typeof text !== "string") return "";
  let t = text.slice(0, MAX_DRAFT_READ).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (t.startsWith("---\n")) {
    const end = t.indexOf("\n---", 3);
    if (end >= 0) {
      const after = t.indexOf("\n", end + 4);
      t = after < 0 ? "" : t.slice(after + 1);
    }
  }
  t = t.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) => (c === "\n" ? "\n" : " ")).replace(/\n{3,}/g, "\n\n").trim();
  const chars = Array.from(t);
  return chars.length > MAX_PREVIEW_TEXT ? `${chars.slice(0, MAX_PREVIEW_TEXT - 1).join("").trimEnd()}…` : t;
}

// The fixed picture names shown for a piece of each kind (never a name from a manifest).
function pictureNames(kind) {
  if (kind === "carousel" || kind === "poster") return [["contact.png"]];
  if (kind === "title-card") return [["poster.png"], ["title-card.png"]];
  if (kind === "film") return [["contact.png"], ["board/shot-01.png", "board/shot-02.png", "board/shot-03.png"]];
  return [];                                      // a page: the home server's own screenshots (T52)
}

// One picture of a goal, checked by its first bytes as /api/view checks it; null when it would not show.
function picture(config, identifier, rel) {
  const head = readGoalBytes(config, identifier, rel, { maxBytes: 16, readOver: true });
  if (!head || head.tooLarge || head.size > MAX_IMAGE || sniff(head.bytes) !== "png") return null;
  const token = fileToken(`${identifier}/${rel}`);
  return { type: "image", token, url: `/api/view/${token}` };
}

// previewOf(config, identifier, kind, variant) -> [{ type: "image", token, url } | { type: "text", text }].
// `variant` is one of readVariants' variants (its place was made here, not read from a file).
export function previewOf(config, identifier, kind, variant) {
  try {
    if (!variant || typeof variant.rel !== "string" || !PLACES[kind]) return [];
    if (!variant.dir) {
      const read = readTaskText(config, identifier, variant.rel, { maxBytes: MAX_DRAFT_READ });
      const text = read ? draftBody(read.text) : "";
      return text ? [{ type: "text", text }] : [];
    }
    for (const group of pictureNames(kind)) {
      const got = group.map((n) => picture(config, identifier, `${variant.rel}/${n}`)).filter(Boolean);
      if (got.length) return got;
    }
    return [];
  } catch {
    return [];
  }
}
