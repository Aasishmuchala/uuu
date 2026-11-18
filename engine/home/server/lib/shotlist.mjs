// A film's shotlist (PLAN-V5 K14 steps 1 and 2, C8): `film/<name>-<id>/shotlist.json` in a goal's folder, one per
// treatment, written by the Artist. The home server reads it unfenced, so everything in it is untrusted
// (docs/adr/0007): it is read with readChecked (lstat first, no link on the way or at the file, inside the goal's
// folder, at most 32 KB), must be UTF-8 JSON of the shape below, and only the shape's own keys are kept, each
// checked. A broken file gives `ok: false` and one plain sentence naming the shot and the field; agent text is in
// that sentence only as a render name that already passed its pattern. Nothing here throws on what an agent wrote.
//
// The shape (video.py `board` in engine/art checks the same list):
//   title     1 to 120 characters on one line (no control character, no line break)
//   seconds   a whole number, 5 to 120
//   ratio     one of 1280:720, 720:1280, 1104:832, 832:1104, 960:960, 1584:672
//   shots     1 to 12, with ids s01, s02, ... in order and no gap
//     id        ^s(0[1-9]|1[0-2])$, the shot's place in the list
//     render    ^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,99}$; for image_to_video a regular file of exactly that name, in
//               that letter case, in <state>/media/room/ (by listing and lstat); for text_to_video it may be left out
//     seconds   a whole number, 2 to 10
//     move      one line of at most 200 characters
//     prompt    1 to 1000 characters, not only spaces, with no control character but a line break
//     kind      image_to_video, or text_to_video (only when the task allows shots from words alone)
//     best      true or false (absent is false)
//   the shots' seconds add up to at most 120
//   cards     optional: { title, end }, each one line of at most 120 characters
//   captions  optional: at most 24, each one line of at most 120 characters
//   any other key is ignored.
//
// The cost is the home server's own (C10): each shot priced in US cents as the generation door prices it (lib/generation.mjs
// priceCents: the door's table, engine/generate/registry.mjs estimateCents, at the owner's Higgsfield rate) with the
// models the owner chose in Settings, never a number from the file. The owner reads it in dollars.
import { createHash } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { priceCents, providerOf, ratioOk, SERVICE_NAMES } from "./generation.mjs";
import { BATCH_ID } from "./staged.mjs";
import { fileToken, goalFolder, readChecked } from "./taskfiles.mjs";
import { pngSize, readGoalBytes, sniff } from "../routes/_images.mjs";

export const MAX_SHOTLIST = 32 * 1024;
export const RATIOS = Object.freeze(["1280:720", "720:1280", "1104:832", "832:1104", "960:960", "1584:672"]);
export const SHOT_ID = /^s(0[1-9]|1[0-2])$/;
export const RENDER = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,99}$/;
export const MAX_SHOTS = 12;
export const MAX_FILM_SECONDS = 120;
export const TAKES = 2;                    // a film's approved cost holds one retake a shot
const VIDEO = ["image_to_video", "text_to_video"];
const PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const MAX_PARTS = 4;
const MAX_LISTED = 5000;
const MAX_BOARD = 20 * 1024 * 1024;       // the most /api/view shows of one picture
const BOARD_IDS = Array.from({ length: MAX_SHOTS }, (_, i) => `s${String(i + 1).padStart(2, "0")}`);
const NAME = "shotlist.json";

const SAYS = {
  missing: "This treatment has no shotlist.json.",
  link: "shotlist.json is not a plain file (it may be a link), so it cannot be read.",
  large: "shotlist.json is larger than 32 KB, so it cannot be read.",
  unread: "shotlist.json could not be read.",
  json: "shotlist.json is not valid JSON.",
  object: "shotlist.json does not hold one JSON object.",
  title: "The shotlist's title must be 1 to 120 characters on one line.",
  seconds: "The shotlist's seconds must be a whole number from 5 to 120.",
  ratio: `The shotlist's ratio must be one of ${RATIOS.slice(0, -1).join(", ")} and ${RATIOS.at(-1)}.`,
  shots: "The shotlist must have 1 to 12 shots.",
  cards: "The shotlist's cards must be a title and an end of at most 120 characters each, on one line.",
  captions: "The shotlist's captions must be at most 24, each of at most 120 characters on one line.",
};

const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const lstatOrNull = (p) => { try { return lstatSync(p); } catch { return null; } };
const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const LINE_BREAKERS = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const oneLine = (v, min, max) => typeof v === "string" && v.length >= min && v.length <= max && !LINE_BREAKERS.test(v)
  && (min === 0 || v.trim() !== "");
// A prompt: 1 to 1000 characters (counted as the generation door counts them), not only spaces, no control
// character but a line break.
const promptOk = (v) => typeof v === "string" && v.length >= 1 && v.length <= 1000 && v.trim() !== ""
  && !LINE_BREAKERS.test(v.replace(/\n/g, ""));

// "$1.50" for 150 cents (a Runway credit is one cent).
export function dollars(credits) {
  const c = Number.isFinite(credits) && credits >= 0 ? Math.round(credits) : 0;
  return `$${(c / 100).toFixed(2)}`;
}

// The names in one folder exactly as stored (at most 5000 looked at), or null when it is not a real folder.
function namesIn(dir) {
  try {
    const st = lstatSync(dir);
    if (!st.isDirectory()) return null;
    return readdirSync(dir).slice(0, MAX_LISTED);
  } catch { return null; }
}

// True when `name` is in the folder in exactly that letter case and no other entry folds to it (this disk ignores
// letter case, so "Tower.PNG" would open as "tower.png"; such a folder is refused too). The rule of lib/variants.mjs.
export function exactlyThere(names, name) {
  if (!Array.isArray(names) || typeof name !== "string") return false;
  const low = name.toLowerCase();
  const folding = names.filter((n) => n.toLowerCase() === low);
  return folding.length === 1 && folding[0] === name;
}

// The room (<state>/media/room/), listed once: a render is there when it is a regular file of exactly that name.
function roomOf(config) {
  const state = config?.paths?.state;
  const dir = typeof state === "string" && state ? join(state, "media", "room") : null;
  const names = dir ? namesIn(dir) : null;
  return (name) => {
    if (!names || !exactlyThere(names, name)) return false;
    const st = lstatOrNull(join(dir, name));
    return !!st && st.isFile();
  };
}

// The checked parts of a treatment's place in the goal's folder (`film/<name>-<id>`), or null.
function partsOf(rel) {
  if (typeof rel !== "string" || !rel || rel.length > 200) return null;
  const parts = rel.split("/");
  if (parts.length > MAX_PARTS || !parts.every((p) => PART.test(p) && p !== "." && p !== "..")) return null;
  return parts;
}

// The shot's place for a sentence: its id when it has one of the right form, else its number in the list.
const shotName = (s, i) => (isObject(s) && typeof s.id === "string" && SHOT_ID.test(s.id) ? s.id : `number ${i + 1}`);

// One shot, checked: { shot } or { problem }.
function readShot(s, i, { allowWords, inRoom }) {
  const want = BOARD_IDS[i];
  const say = (field) => ({ problem: `Shot ${shotName(s, i)} in shotlist.json: ${field}` });
  if (!isObject(s)) return { problem: `Shot number ${i + 1} in shotlist.json is not a list of its fields.` };
  if (s.id !== want) return { problem: `Shot number ${i + 1} in shotlist.json must have the id ${want}; shots are numbered s01, s02 and on, in order.` };
  if (s.kind !== "image_to_video" && s.kind !== "text_to_video") return say("the kind must be image_to_video or text_to_video.");
  if (s.kind === "text_to_video" && !allowWords) return say("it is made from words alone, and this task does not allow shots from words alone.");
  const fromWords = s.kind === "text_to_video";
  const hasRender = s.render !== undefined && s.render !== null;
  if ((!fromWords || hasRender) && !(typeof s.render === "string" && RENDER.test(s.render))) {
    return say("the render must be the bare name of a file in the room (letters, digits, spaces, dots, dashes, underscores and brackets).");
  }
  if (!fromWords && !inRoom(s.render)) return say(`the render "${s.render}" is not in the room under exactly that name.`);
  if (!whole(s.seconds, 2, 10)) return say("seconds must be a whole number from 2 to 10.");
  if (!oneLine(s.move, 0, 200)) return say("the move must be one line of at most 200 characters.");
  if (!promptOk(s.prompt)) return say("the prompt must be 1 to 1000 characters with no control characters but line breaks.");
  if (s.best !== undefined && typeof s.best !== "boolean") return say("best must be true or false.");
  return {
    shot: { id: s.id, render: hasRender ? s.render : null, seconds: s.seconds, move: s.move, prompt: s.prompt, kind: s.kind, best: s.best === true },
  };
}

// The shotlist's own keys, checked: { ok: true, shotlist } or { ok: false, problem }.
export function checkShotlist(doc, { allowWords = false, inRoom = () => false } = {}) {
  const no = (problem) => ({ ok: false, shotlist: null, problem });
  if (!isObject(doc)) return no(SAYS.object);
  if (!oneLine(doc.title, 1, 120)) return no(SAYS.title);
  if (!whole(doc.seconds, 5, MAX_FILM_SECONDS)) return no(SAYS.seconds);
  if (!RATIOS.includes(doc.ratio)) return no(SAYS.ratio);
  if (!Array.isArray(doc.shots) || doc.shots.length < 1 || doc.shots.length > MAX_SHOTS) return no(SAYS.shots);
  const shots = [];
  for (let i = 0; i < doc.shots.length; i += 1) {
    const r = readShot(doc.shots[i], i, { allowWords, inRoom });
    if (r.problem) return no(r.problem);
    shots.push(r.shot);
  }
  const total = shots.reduce((n, s) => n + s.seconds, 0);
  if (total > MAX_FILM_SECONDS) return no(`The shots add up to ${total} seconds; a film may have at most ${MAX_FILM_SECONDS}.`);
  let cards = null;
  if (doc.cards !== undefined && doc.cards !== null) {
    if (!isObject(doc.cards)) return no(SAYS.cards);
    const card = (v) => (v === undefined || v === null ? true : oneLine(v, 0, 120));
    if (!card(doc.cards.title) || !card(doc.cards.end)) return no(SAYS.cards);
    cards = { title: typeof doc.cards.title === "string" ? doc.cards.title : null, end: typeof doc.cards.end === "string" ? doc.cards.end : null };
  }
  let captions = [];
  if (doc.captions !== undefined && doc.captions !== null) {
    if (!Array.isArray(doc.captions) || doc.captions.length > 24 || !doc.captions.every((c) => oneLine(c, 0, 120))) return no(SAYS.captions);
    captions = doc.captions.slice();
  }
  return { ok: true, shotlist: { title: doc.title, seconds: doc.seconds, ratio: doc.ratio, shots, cards, captions }, problem: null };
}

// readShotlist(config, identifier, rel, { allowWords }) -> { ok, shotlist, problem }: `<goal>/<rel>/shotlist.json`,
// where rel is a treatment's place (lib/variants.mjs placeOf). Never throws.
export function readShotlist(config, identifier, rel, { allowWords = false } = {}) {
  const no = (key) => ({ ok: false, shotlist: null, problem: SAYS[key] });
  try {
    const base = goalFolder(config, identifier);
    const parts = partsOf(rel);
    if (!base || !parts) return no("missing");
    let dir = base;
    for (const part of parts) {
      dir = join(dir, part);
      const st = lstatOrNull(dir);
      if (!st) return no("missing");
      if (!st.isDirectory()) return no("link");      // lstat: a link on the way is never a folder here
    }
    const file = join(dir, NAME);
    const st = lstatOrNull(file);
    if (!st) return no("missing");
    if (!st.isFile()) return no("link");
    if (st.size > MAX_SHOTLIST) return no("large");
    const read = readChecked(file, base, { maxBytes: MAX_SHOTLIST, real: true });
    if (!read) return no("unread");
    if (read.truncated) return no("large");
    let doc;
    try { doc = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.bytes)); } catch { return no("json"); }
    return checkShotlist(doc, { allowWords: allowWords === true, inRoom: roomOf(config) });
  } catch {
    return no("unread");
  }
}

// A model's name as a sentence may show it (the switches file's own, checked there; plain characters only).
const modelName = (m) => (typeof m === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(m) ? m : "no model");

// priceShotlist(shotlist, models, { centsPerCredit, table }) -> { ok, shots: [{ id, kind, model, seconds, credits }],
// base, most, problem, centsPerCredit (the rate given, for the batch), services }, in cents. A shot marked best and a shot from words alone take `models.videoBest`, every other
// `models.video`; each is priced as the door prices it, a Higgsfield model at the owner's rate (`centsPerCredit`, the
// switches file's); `most` holds one retake a shot (two takes). `services` is each service the shots go to, with the
// clips and the most it may charge for them: [{ service: "runway" | "higgsfield", clips, base, most }], Runway first.
// `table` (tests only) is rows used instead of the door's. Pure; never throws.
export function priceShotlist(shotlist, models, { centsPerCredit, table } = {}) {
  const no = (problem) => ({ ok: false, shots: [], base: 0, most: 0, problem, services: [] });
  try {
    if (!isObject(shotlist) || !Array.isArray(shotlist.shots) || !shotlist.shots.length) return no("There is no shotlist to price.");
    const m = isObject(models) ? models : {};
    const shots = [];
    const by = new Map(Object.keys(SERVICE_NAMES).map((k) => [k, { service: k, clips: 0, base: 0, most: 0 }]));
    let base = 0;
    for (const s of shotlist.shots) {
      const model = s.best === true || s.kind === "text_to_video" ? m.videoBest : m.video;
      const credits = VIDEO.includes(s.kind) ? priceCents({ kind: s.kind, model, seconds: s.seconds }, { centsPerCredit, table }) : null;
      if (credits === null) return no(`The door has no price for ${modelName(model)}, the model chosen in Settings.`);
      if (!ratioOk(model, shotlist.ratio, { table })) return no(`The model chosen in Settings, ${modelName(model)}, cannot make the ratio ${RATIOS.includes(shotlist.ratio) ? shotlist.ratio : "asked for"}.`);
      shots.push({ id: s.id, kind: s.kind, model, seconds: s.seconds, credits });
      base += credits;
      const one = by.get(providerOf(model, { table })) || by.get("runway");
      one.clips += 1;
      one.base += credits;
      one.most += TAKES * credits;
    }
    return {
      ok: true, shots, base, most: TAKES * base, problem: null, centsPerCredit: Number.isInteger(centsPerCredit) ? centsPerCredit : undefined,
      services: [...by.values()].filter((x) => x.clips > 0),
    };
  } catch {
    return no("The shotlist could not be priced.");
  }
}

// The priced shots with what the owner read of each in the shotlist they were priced from: its render, move and
// prompt (T48 F3: the render and the prompt are part of what is approved, not only the price). [] when either is
// missing. Pure; never throws.
export function approvedShots(shotlist, priced) {
  try {
    const listed = new Map((isObject(shotlist) && Array.isArray(shotlist.shots) ? shotlist.shots : []).filter(isObject).map((s) => [s.id, s]));
    return (priced?.ok === true && Array.isArray(priced.shots) ? priced.shots : []).map((p) => {
      const s = listed.get(p.id) || {};
      return {
        ...p,
        render: typeof s.render === "string" ? s.render : null,
        move: typeof s.move === "string" ? s.move : null,
        prompt: typeof s.prompt === "string" ? s.prompt : null,
      };
    });
  } catch {
    return [];
  }
}

// The SHA-256 of the shots as the owner approved them (the `shotlist:` record keeps it, so a shotlist changed after
// the approval can be told): each shot's id, kind, model, seconds and credits as priced, and its render and prompt
// as the owner read them (approvedShots). Field by field, in the shots' order.
export function shotsHash(shots) {
  const list = (Array.isArray(shots) ? shots : []).map((s) => [s?.id ?? null, s?.kind ?? null, s?.model ?? null, s?.seconds ?? null, s?.credits ?? null,
    s?.render ?? null, s?.prompt ?? null]);
  return createHash("sha256").update(JSON.stringify(list), "utf8").digest("hex");
}

// The cost as the owner reads it, in dollars: "6 clips, 30 seconds: about $1.50, up to $3.00 with one retake each.
// Today's limit: $3.00." When only the retakes would pass what is left of today's (or this month's) limit, it says so.
export function costWords(priced, { daily = null, dayLeft = null, monthLeft = null } = {}) {
  const shots = Array.isArray(priced?.shots) ? priced.shots : [];
  const n = shots.length;
  const seconds = shots.reduce((t, s) => t + (Number.isInteger(s.seconds) ? s.seconds : 0), 0);
  const base = Number.isFinite(priced?.base) ? priced.base : 0;
  const most = Number.isFinite(priced?.most) ? priced.most : 0;
  let out = `${n} ${n === 1 ? "clip" : "clips"}, ${seconds} seconds: about ${dollars(base)}, up to ${dollars(most)} with one retake${n === 1 ? "" : " each"}.`;
  if (Number.isFinite(daily)) out += ` Today's limit: ${dollars(daily)}.`;
  if (Number.isFinite(dayLeft) && base <= dayLeft && most > dayLeft) out += " Retakes may stop at today's limit.";
  else if (Number.isFinite(monthLeft) && base <= monthLeft && most > monthLeft) out += " Retakes may stop at this month's limit.";
  return out;
}

// The services a batch goes to, by name, Runway first: "Runway", "Higgsfield", "Runway and Higgsfield". `services`
// is service keys or priceShotlist's `services`; none, or none known, is Runway (the door's own default).
export function serviceWords(services) {
  const keys = (Array.isArray(services) ? services : []).map((s) => (isObject(s) ? s.service : s));
  const names = Object.keys(SERVICE_NAMES).filter((k) => keys.includes(k)).map((k) => SERVICE_NAMES[k]);
  return names.length ? names.join(" and ") : SERVICE_NAMES.runway;
}

const clipsOf = (n) => `${n} ${n === 1 ? "clip" : "clips"}`;

// The spending confirm of one treatment, as the owner reads it before anything is sent: { body, button }, naming the
// service (or both) that may charge and the most each may: "Runway may charge up to $3.00 for its 6 clips and one
// retake each. Nothing else is spent without you." With both, the share of each follows. null when it is not priced.
export function confirmWords(priced) {
  if (priced?.ok !== true || !Array.isArray(priced.shots) || !priced.shots.length || !Number.isFinite(priced.most)) return null;
  const services = Array.isArray(priced.services) && priced.services.length ? priced.services : [{ service: "runway", clips: priced.shots.length, most: priced.most }];
  const each = services.length > 1
    ? `: ${services.map((s) => `up to ${dollars(s.most)} at ${SERVICE_NAMES[s.service] || SERVICE_NAMES.runway} for ${clipsOf(s.clips)}`).join(" and ")}`
    : "";
  return {
    body: `${serviceWords(services)} may charge up to ${dollars(priced.most)} for its ${clipsOf(priced.shots.length)} and one retake each${each}. Nothing else is spent without you.`,
    button: `Approve and spend up to ${dollars(priced.most)}`,
  };
}

// How long the service takes, as the owner reads it: two to five minutes a clip, each end rounded to 5, at least 5.
// `services` as serviceWords takes them (Runway when none are given).
export function timeWords(n, services) {
  const count = Number.isInteger(n) && n > 0 ? n : 0;
  const to5 = (x) => Math.round(x / 5) * 5;
  const low = Math.max(5, to5(count * 2));
  const high = Math.max(low, to5(count * 5));
  const span = low === high ? `about ${low} minutes` : `about ${low} to ${high} minutes`;
  const who = serviceWords(services);
  return `${who} ${who.includes(" and ") ? "take" : "takes"} a few minutes a clip: ${span} for ${clipsOf(count)}, then the edit and the checks.`;
}

// The picture boxes the Artist's tool noted for a treatment's boards (video.py `board` writes `manifest.json` beside
// shotlist.json: `pictures: [{ frame: "shot-01", box: [x0, y0, x1, y1], source }]`, the box being where the render sits
// on the board, above the band of words it draws under it). The file is an agent's, so it is untrusted: read as the
// shotlist is (in exactly that letter case, no link on the way or at the file, inside the goal's folder, at most
// 64 KB, UTF-8 JSON) and only a frame's box is taken from it, as numbers (boxOf checks them against the board). No
// value in it is ever used as a path or shown. -> Map(frame -> the box as written, or null when written twice), or
// an empty Map when the file is missing or broken.
export const MAX_BOARD_MANIFEST = 64 * 1024;

function boardBoxes(config, identifier, parts, top) {
  const none = new Map();
  if (!exactlyThere(top, "manifest.json")) return none;
  const read = readGoalBytes(config, identifier, `${parts.join("/")}/manifest.json`, { maxBytes: MAX_BOARD_MANIFEST });
  if (!read || read.tooLarge || !read.bytes || read.size > MAX_BOARD_MANIFEST) return none;
  let doc;
  try { doc = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.bytes)); } catch { return none; }
  if (!isObject(doc) || doc.kind !== "board" || !Array.isArray(doc.pictures)) return none;
  const out = new Map();
  for (const p of doc.pictures.slice(0, 100)) {
    if (!isObject(p) || typeof p.frame !== "string" || !/^shot-(0[1-9]|1[0-2])$/.test(p.frame)) continue;
    out.set(p.frame, out.has(p.frame) ? null : p.box);
  }
  return out;
}

// A board's picture box as the page may use it: four whole numbers [x0, y0, x1, y1] with 0 <= x0 < x1 <= the board's
// width and 0 <= y0 < y1 <= its height, covering at least half the board; anything else is null (the whole board is
// shown). `size` is the board's own { w, h }, from its PNG header.
export function boxOf(box, size) {
  if (!size || !Number.isInteger(size.w) || !Number.isInteger(size.h) || size.w < 1 || size.h < 1) return null;
  if (!Array.isArray(box) || box.length !== 4 || !box.every((v) => Number.isInteger(v))) return null;
  const [x0, y0, x1, y1] = box;
  if (!(x0 >= 0 && x0 < x1 && x1 <= size.w && y0 >= 0 && y0 < y1 && y1 <= size.h)) return null;
  if ((x1 - x0) * (y1 - y0) * 2 < size.w * size.h) return null;
  return [x0, y0, x1, y1];
}

// The storyboard stills of a treatment: `board/shot-01.png` to `shot-12.png` for the shots named (all twelve when
// none are), each there in exactly that letter case, a regular file of at most 20 MB that starts as a PNG, shown
// through /api/view. Each comes with its picture box when the tool's manifest gives a good one (boardBoxes, boxOf),
// and then the board's own size from its PNG header, so the page can show the picture without the band under it.
// -> [{ shot, url, box: [x0, y0, x1, y1] | null, size: [w, h] | null }]. Never throws.
export function boardsOf(config, identifier, rel, shotIds = BOARD_IDS) {
  try {
    const base = goalFolder(config, identifier);
    const parts = partsOf(rel);
    if (!base || !parts) return [];
    const top = namesIn(join(base, ...parts));
    if (!exactlyThere(top, "board")) return [];
    const names = namesIn(join(base, ...parts, "board"));
    let boxes = null;
    const out = [];
    for (const id of (Array.isArray(shotIds) ? shotIds : []).filter((x) => SHOT_ID.test(x))) {
      const name = `shot-${id.slice(1)}.png`;
      if (!exactlyThere(names, name)) continue;
      const path = `${parts.join("/")}/board/${name}`;
      const head = readGoalBytes(config, identifier, path, { maxBytes: 24, readOver: true });
      if (!head || head.tooLarge || head.size > MAX_BOARD || sniff(head.bytes) !== "png") continue;
      if (!boxes) boxes = boardBoxes(config, identifier, parts, top);
      const size = pngSize(head.bytes);
      const box = boxOf(boxes.get(`shot-${id.slice(1)}`), size);
      out.push({ shot: id, url: `/api/view/${fileToken(`${identifier}/${path}`)}`, box, size: box ? [size.w, size.h] : null });
    }
    return out;
  } catch {
    return [];
  }
}

// ---- the owner's approvals: `shotlist:<goal id>` in state/home/decisions.json

const RECORD_MAX = 10;
const VARIANT = /^[abc]$/;
const DIRECTION = /^[a-z][a-z0-9-]{0,39}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const validTime = (t) => typeof t === "string" && t.length <= 40 && Number.isFinite(Date.parse(t));
const recordKey = (goalId) => `shotlist:${goalId}`;

// What the owner read of each approved shot, as kept: [{ id, render, move, prompt }] (1 to 12 shots, each field
// checked again as readShotlist checks it: a render name of its pattern or null, one line of at most 200 for the
// move, at most 1000 characters with no control character but a line break for the prompt), or null when any of
// it is not of that form. This is the only agent-written text kept in a record (T48 F3): the words the owner
// approved, so Studio can show them whatever the Artist's file says later.
function cleanApproved(v) {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_SHOTS) return null;
  const out = [];
  for (const s of v) {
    if (!isObject(s) || typeof s.id !== "string" || !SHOT_ID.test(s.id)) return null;
    if (!(s.render === null || (typeof s.render === "string" && RENDER.test(s.render)))) return null;
    if (!(s.move === null || oneLine(s.move, 0, 200))) return null;
    if (!promptOk(s.prompt)) return null;
    out.push({ id: s.id, render: s.render, move: s.move, prompt: s.prompt });
  }
  return out;
}

// One approval as kept, or null: ids, a direction id from the repo's list, numbers, a hash, a time, and the
// approved shots' render, move and prompt (cleanApproved; null for a record kept before they were).
function cleanApproval(e) {
  if (!isObject(e) || !validTime(e.at) || typeof e.variant !== "string" || !VARIANT.test(e.variant)) return null;
  if (typeof e.batch !== "string" || !BATCH_ID.test(e.batch) || typeof e.shots !== "string" || !HEX64.test(e.shots)) return null;
  if (!whole(e.budget, 0, 1e9) || !whole(e.base, 0, 1e9)) return null;
  return {
    round: whole(e.round, 1, 99) ? e.round : null,
    variant: e.variant,
    direction: typeof e.direction === "string" && DIRECTION.test(e.direction) ? e.direction : null,
    batch: e.batch, budget: e.budget, base: e.base, shots: e.shots, at: e.at,
    approved: cleanApproved(e.approved),
  };
}

// The owner's approvals of a goal's shotlists, oldest first (newest last), at most ten; malformed ones left out.
export function approvalsOf(decisions, goalId) {
  try {
    const v = decisions && typeof decisions.get === "function" && goalId ? decisions.get(recordKey(goalId)) : null;
    return (Array.isArray(v) ? v : []).slice(-RECORD_MAX).map(cleanApproval).filter(Boolean);
  } catch {
    return [];
  }
}

// recordApproval(decisions, goalId, { round, variant, direction, batch, budget, base, shots, approved }, { now }) ->
// the entry written, or null when it is malformed (nothing is written then).
export function recordApproval(decisions, goalId, entry, { now = new Date() } = {}) {
  if (typeof goalId !== "string" || !goalId || !decisions || typeof decisions.set !== "function") return null;
  const e = cleanApproval({ ...(isObject(entry) ? entry : {}), at: now.toISOString() });
  if (!e) return null;
  decisions.set(recordKey(goalId), [...approvalsOf(decisions, goalId), e].slice(-RECORD_MAX));
  return e;
}
