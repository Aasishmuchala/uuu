// The seats (PLAN-DESKTOP T7, DW3, DW4): the home server's five more 127.0.0.1 ports, one per PC the owner allowed,
// each reached only through the remote door's forward for that PC's key. A request's seat is known only from the
// port it arrived on (`req.socket.localPort`); no header is ever read for it. Seat n listens on `ports.seats + n - 1`
// (3201 to 3205); the Mac's own port (3200) stays the owner's, unchanged.
//
// `<state>/remote/seats.json` is written only by `engine remote`, from a Terminal on the Mac. It is read again on
// every request (a seat removed while the server runs is refused on its next request), and read as hostile (ADR
// 0007, PLAN-DESKTOP rule 6): the folder and the file must be real (not links), the owner's, with no group or other
// bits, the file at most 16 KB and of the pinned shape. Anything else is "no seats": every seat port is refused.
//
// Roles, refused by default: `desk` may read everything and make the changes in DESK_MAY; `view` reads only.
// Every POST and DELETE route the router holds is in exactly one of DESK_MAY and MAC_ONLY (test/seats-routes.test.mjs
// fails on a route sorted in neither). SEAT_HIDDEN lists the reads a seat never gets: the sign-in returns, which
// carry a one-time code. One route, POST /api/inbox/act, is a desk route whose action is sorted again once the item
// is known (inboxSeatMay): approving anything with a price or making books final stays on the Mac. A seat's note,
// on a task or with an inbox action, may not hold an owner marker the engine writes for a priced step
// (seatNoteRefused, REVIEW-DESKTOP M1); and a seat's stop of a job, or of a task with an open generation batch, is
// refused in lib/stop.mjs (L1).
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { HomeError } from "./errors.mjs";

export const SEATS_MAX_BYTES = 16 * 1024;
const SEAT_COUNT_MAX = 5;
const FINGERPRINT_RE = /^SHA256:[A-Za-z0-9+/]{43}$/;
const ROLES = new Set(["desk", "view"]);
const STATES = new Set(["waiting", "allowed"]);

export const SEAT_UNKNOWN = "This PC is not allowed to open the engine.";
export const MAC_ONLY_MESSAGE = "This is done on the Mac.";
export const MAC_ONLY_HINT = "Keys, switches, sign-ins and money stay on the Mac that runs the engine.";
export const SEAT_LINE = "You are on a second PC. Keys, switches and money stay on the Mac.";

export const seatUnknown = () => new HomeError(403, SEAT_UNKNOWN, "", "seat_unknown");
export const macOnly = () => new HomeError(403, MAC_ONLY_MESSAGE, MAC_ONLY_HINT, "mac_only");

// What a desk seat may change. Only: making a task, answering or commenting on one, accepting or sending back work
// that has no price, picking between versions already made, writing Files and brain notes, the brand kit's words
// and pictures, asking the brain, and looking at a site already made.
export const DESK_MAY = Object.freeze([
  // Tasks: make one, comment on one, stop one. A note that is a priced order, and a stop of a job or of a task with an
  // open generation batch, are refused inside (seatNoteRefused, lib/stop.mjs): cancelling anything priced stays on the Mac.
  "POST /api/goals",
  "POST /api/goals/:id/note",
  "POST /api/goals/:id/stop",
  // Needs you: answer, accept, send back, pick; each action is sorted again by inboxSeatMay.
  "POST /api/inbox/act",
  // Asking the brain (a question is a task for the Chief of staff).
  "POST /api/ask",
  // Files and brain notes.
  "POST /api/brain/files",
  "POST /api/brain/move",
  "DELETE /api/brain/file/:token",
  "POST /api/brain/forms/:id",
  "POST /api/brain/starters",
  "POST /api/brain/index/refresh",
  "POST /api/knowledge",
  "DELETE /api/knowledge/doc/:id",
  // The brand kit's words and pictures.
  "POST /api/brand/kit",
  "POST /api/brand/kit/font",
  "DELETE /api/brand/kit/font/:name",
  // A site a task already made: its pictures, and the preview (whose ports a desk seat's key forwards).
  "POST /api/tasks/:id/sites/:ref/shots",
  "POST /api/tasks/:id/sites/:ref/preview",
]);

// What stays on the Mac: (a) keys, tokens and sign-ins; (b) every switch; (c) limits, rates, ceilings, allowances
// and models; (d) anything with a price; (e) the proof, and what agents may reach or who they are; (f) Setup's steps.
export const MAC_ONLY = Object.freeze([
  // App Studio: a switch, an allowance, the model an app thinks with.
  "POST /api/apps/:slug/switch",
  "POST /api/apps/:slug/allowance",
  "POST /api/apps/:slug/allowance/stop",
  "POST /api/apps/:slug/thinks",
  // The brain door: its switch, the tidy-up switch, Test.
  "POST /api/brain-door/switch",
  "POST /api/brain-door/tidy",
  "POST /api/brain-door/test",
  // Agents paused or resumed (who works).
  "POST /api/company/agents/:id/pause",
  "POST /api/company/agents/:id/resume",
  // Generation: switches, limits, models, the key, Test, sign-ins and rates.
  "POST /api/generation/switch",
  "POST /api/generation/caps",
  "POST /api/generation/models",
  "POST /api/generation/key",
  "POST /api/generation/key/remove",
  "POST /api/generation/test",
  "POST /api/generation/resume",
  "POST /api/generation/higgsfield/switch",
  "POST /api/generation/higgsfield/rate",
  "POST /api/generation/higgsfield/begin",
  "POST /api/generation/higgsfield/forget",
  "POST /api/generation/higgsfield/test",
  "POST /api/generation/runway/begin",
  "POST /api/generation/runway/forget",
  "POST /api/generation/runway/test",
  "POST /api/generation/runway/rate",
  // The proof.
  "POST /api/health/prove",
  // A job has a price.
  "POST /api/jobs/:department/:id/start",
  // Models: the key, Test, picks, the mode, and the list read with the key.
  "POST /api/models/key",
  "POST /api/models/key/remove",
  "POST /api/models/refresh",
  "POST /api/models/pick",
  "POST /api/models/test",
  "POST /api/models/mode",
  // Routines: run now, pause, resume.
  "POST /api/routines/:id/run",
  "POST /api/routines/:id/pause",
  "POST /api/routines/:id/resume",
  // The Mac's own appearance (its motion switch among them).
  "POST /api/settings",
  // Setup's steps.
  "POST /api/setup/skip",
  "POST /api/setup/dismiss",
  // An agent's lessons change who it is.
  "POST /api/team/:slug/lessons",
  "POST /api/team/:slug/lessons/:n",
  "DELETE /api/team/:slug/lessons/:n",
  // The viewer door: its switch and Test.
  "POST /api/viewer/switch",
  "POST /api/viewer/test",
  // The web door: its switch, what the Researcher may reach and read, the search key and Test.
  "POST /api/web/switch",
  "POST /api/web/lists",
  "POST /api/web/search",
  "POST /api/web/search-key",
  "POST /api/web/search-key/remove",
  "POST /api/web/test",
  "POST /api/web/share",
]);

// Reads a seat never gets: where a sign-in comes back with its one-time code.
export const SEAT_HIDDEN = Object.freeze([
  "GET /api/generation/higgsfield/back",
  "GET /api/generation/runway/back",
]);

const DESK_SET = new Set(DESK_MAY);
const HIDDEN_SET = new Set(SEAT_HIDDEN);

// Needs you's actions a desk seat may take, by the source that listed the item. Anything not here is refused:
// approving a shot list and its cost, another round of versions or treatments (a new round is made and paid for),
// making a draft in the books final, approving an agent's request to the board, and trying a failed run again.
const INBOX_DESK = Object.freeze({
  board: ["dismiss", "answer", "accept", "reject", "send_back", "stop"],
  goals: ["acknowledge", "reopen", "pick"],
  staged: ["answer", "accept", "send_back", "stop"],
  bench: ["send_back"],
  content: ["approve", "send_back"],
  brain: ["open", "dismiss"],
});

// seat: { n, role } or null (the Mac). source: the id of the inbox source that listed the item.
export function inboxSeatMay(seat, source, item, action) {
  if (!seat) return true;
  if (seat.role !== "desk") return false;
  const may = Object.hasOwn(INBOX_DESK, source) ? INBOX_DESK[source] : [];
  if (may.includes(action)) return true;
  // The board's review of finished work may be approved (it marks the task finished); an agent's request may not.
  return source === "board" && action === "approve" && item?._raw?.sourceKind === "review";
}

// The owner markers the engine itself writes for a priced step: "ANOTHER ROUND" (a new round is made and paid for)
// and "SHOTLIST ACCEPTED:" (a film's cost approved). The Chief of staff acts on the owner's comment, and its reader is
// a model, not a parser: a comment that looks the same is the same order. So a seat may not write either anywhere in a
// note (REVIEW-DESKTOP M1, S1). The whole note is folded to a skeleton (foldMarkers) and searched; this also refuses
// plain words such as "not another round yet" from a seat, the safe side ("when unsure: MAC_ONLY").
// Letters of other scripts and small capitals that look like Latin ones, mapped to the Latin letter.
const LOOKALIKES = new Map(Object.entries({
  // Cyrillic
  "А": "A", "В": "B", "Е": "E", "Ѕ": "S", "І": "I", "Ј": "J", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C",
  "Т": "T", "У": "Y", "Х": "X", "Ԛ": "Q", "Ԝ": "W", "Ӏ": "I", "Ү": "Y",
  "а": "a", "в": "b", "е": "e", "ѕ": "s", "і": "i", "ј": "j", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c",
  "т": "t", "у": "y", "х": "x", "ԛ": "q", "ԝ": "w", "ӏ": "l", "ү": "y", "ԁ": "d", "һ": "h", "п": "n", "г": "r",
  // Greek
  "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T",
  "Υ": "Y", "Χ": "X", "Ϲ": "C", "Ϻ": "M",
  "α": "a", "β": "b", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x", "ϲ": "c",
  "η": "n", "ω": "w",
  // Small capitals and the like (Latin Extended, Phonetic Extensions)
  "ᴀ": "A", "ʙ": "B", "ᴄ": "C", "ᴅ": "D", "ᴇ": "E", "ꜰ": "F", "ɢ": "G", "ʜ": "H", "ɪ": "I", "ᴊ": "J", "ᴋ": "K", "ʟ": "L",
  "ᴍ": "M", "ɴ": "N", "ᴏ": "O", "ᴘ": "P", "ǫ": "Q", "ʀ": "R", "ꜱ": "S", "ᴛ": "T", "ᴜ": "U", "ᴠ": "V", "ᴡ": "W", "ʏ": "Y",
  "ᴢ": "Z", "ı": "I", "ȷ": "J",
}));
// After the letters are capitals: digits and letters a reader takes for one another, made one.
const SKELETON = Object.freeze({ "0": "O", "1": "I", "L": "I", "3": "E", "4": "A", "5": "S", "7": "T", "8": "B" });

// A text's skeleton: NFKD, combining marks dropped, lookalikes mapped to Latin, capitals, everything that is not a
// letter or a digit dropped, then the lookalike digits and letters made one.
export function foldMarkers(text) {
  const plain = String(text ?? "").normalize("NFKD").replace(/\p{M}/gu, "");
  let mapped = "";
  for (const ch of plain) mapped += LOOKALIKES.get(ch) ?? ch;
  return mapped.toUpperCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "").replace(/[0134578L]/g, (c) => SKELETON[c]);
}
const PRICED_MARKERS = Object.freeze(["ANOTHER ROUND", "SHOTLIST ACCEPTED"].map(foldMarkers));

// seat: { n, role } or null (the Mac). -> true when this note must be refused for this seat. The Mac is never refused.
export function seatNoteRefused(seat, note) {
  if (!seat || typeof note !== "string") return false;
  const folded = foldMarkers(note);
  return PRICED_MARKERS.some((m) => folded.includes(m));
}

// May this seat make this change? `route` is "<METHOD> <pattern>" of the matched route, or null when none matched.
export function seatMayChange(seat, route) {
  return !!seat && seat.role === "desk" && typeof route === "string" && DESK_SET.has(route);
}

export function seatMayRead(seat, route) {
  return !!seat && !(typeof route === "string" && HIDDEN_SET.has(route));
}

// The seat ports as config says: `ports.seats` is seat 1's, `remote.seats` how many (1 to 5).
export function seatPorts(config) {
  const first = Number.isInteger(config?.ports?.seats) ? config.ports.seats : 3201;
  const raw = config?.remote?.seats;
  const count = Number.isInteger(raw) && raw >= 1 && raw <= SEAT_COUNT_MAX ? raw : SEAT_COUNT_MAX;
  const out = [];
  for (let n = 1; n <= count; n++) if (first + n - 1 <= 65535) out.push({ n, port: first + n - 1 });
  return out;
}

function ownedAndClosed(st) {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  return (uid === null || st.uid === uid) && (st.mode & 0o077) === 0;
}

const NO_SEATS = (reason) => Object.freeze({ ok: false, reason, seats: Object.freeze([]) });

function validSeat(s, count) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return false;
  if (!Number.isInteger(s.n) || s.n < 1 || s.n > count) return false;
  if (typeof s.name !== "string" || s.name.length > 200 || /[\u0000-\u001f\u007f]/.test(s.name)) return false;
  if (!ROLES.has(s.role) || !STATES.has(s.state)) return false;
  if (s.fingerprint !== null && (typeof s.fingerprint !== "string" || !FINGERPRINT_RE.test(s.fingerprint))) return false;
  if (s.state === "allowed" && s.fingerprint === null) return false;
  if (typeof s.added !== "string" || s.added.length > 64) return false;
  return true;
}

// -> { ok, reason, seats }. A missing file is ok with no seats; any rule broken is not ok, with no seats.
// Never blocks: a FIFO or a device in the file's place is refused before it is opened, and opened without waiting.
export function readSeats(config) {
  const dir = join(config.paths.state, "remote");
  const file = join(dir, "seats.json");
  const count = seatPorts(config).length;
  let dst;
  try {
    dst = lstatSync(dir);
  } catch (e) {
    return e?.code === "ENOENT" ? Object.freeze({ ok: true, reason: "none", seats: Object.freeze([]) }) : NO_SEATS("folder");
  }
  if (!dst.isDirectory() || !ownedAndClosed(dst)) return NO_SEATS("folder");
  let st;
  try {
    st = lstatSync(file);
  } catch (e) {
    return e?.code === "ENOENT" ? Object.freeze({ ok: true, reason: "none", seats: Object.freeze([]) }) : NO_SEATS("file");
  }
  if (!st.isFile() || !ownedAndClosed(st) || st.size > SEATS_MAX_BYTES) return NO_SEATS("file");
  let fd;
  let text;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const fst = fstatSync(fd);
    if (!fst.isFile() || fst.ino !== st.ino || fst.dev !== st.dev || !ownedAndClosed(fst) || fst.size > SEATS_MAX_BYTES) return NO_SEATS("file");
    const buf = Buffer.alloc(SEATS_MAX_BYTES + 1);
    let got = 0;
    for (;;) {
      const n = readSync(fd, buf, got, buf.length - got, null);
      if (n <= 0) break;
      got += n;
      if (got > SEATS_MAX_BYTES) return NO_SEATS("file");
    }
    text = buf.subarray(0, got).toString("utf8");
  } catch {
    return NO_SEATS("file");
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* closed */ }
  }
  let data;
  try { data = JSON.parse(text); } catch { return NO_SEATS("shape"); }
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.seats) || data.seats.length > count) return NO_SEATS("shape");
  const seen = new Set();
  for (const s of data.seats) {
    if (!validSeat(s, count) || seen.has(s.n)) return NO_SEATS("shape");
    seen.add(s.n);
  }
  const seats = data.seats.map((s) => Object.freeze({ n: s.n, name: s.name, role: s.role, state: s.state, fingerprint: s.fingerprint, added: s.added }));
  return Object.freeze({ ok: true, reason: "read", seats: Object.freeze(seats) });
}

// The seat of a request that arrived on `localPort`: null when the port is not a seat port; else { n, role }, with
// role null unless seats.json is good and holds that seat `allowed`.
export function seatFor(localPort, config) {
  const at = seatPorts(config).find((s) => s.port === localPort);
  if (!at) return null;
  const read = readSeats(config);
  const seat = read.ok ? read.seats.find((s) => s.n === at.n && s.state === "allowed") : null;
  return Object.freeze({ n: at.n, role: seat ? seat.role : null });
}
