// The generation door's files (PLAN-V5 K1, K13): its block of the switches file, the Runway
// key, the owner's approved batches, and the door's own work folder (kept inputs, job records
// and outputs). Every file is read with the relay's trust rule (a plain file of this user,
// not a link, no write bit for group or others, capped) and nothing is cached. The bytes an
// agent sends are judged by their first bytes, never by a name. Zero dependencies.
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { readDoorsState } from "../doors/common.mjs";
import { KEY_RE, KINDS, MAX_SECONDS, MIN_SECONDS, VIDEO_KINDS } from "./runway.mjs";

const MB = 1024 * 1024;
const HOUR = 3600_000;
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const SHOT_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const INPUT_MIN = 512;
export const INPUT_MAX = 3_300_000;          // a data address of it stays under Runway's 5 MB
export const INPUTS_KEPT = 40;               // per agent, within a day
export const INPUT_HOURS = 24;
export const OUTPUT_HOURS = 48;
export const BATCH_DAYS = 7;
export const MAX_TAKES = 5;

// ---- trusted reads --------------------------------------------------------------------

// The file's bytes when it is this user's plain file with no group or other write bit and at
// most `max` bytes; "missing" when there is none; null otherwise. Checked on the open handle.
export function readTrustedBytes(path, max) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    return err && err.code === "ENOENT" ? "missing" : null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid() || (st.mode & 0o022) !== 0 || st.size > max) return null;
    const buf = Buffer.alloc(st.size);
    let size = 0;
    while (size < st.size) {
      const n = readSync(fd, buf, size, st.size - size, null);
      if (n === 0) break;
      size += n;
    }
    return size === st.size ? buf : null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function readJson(path, max = MB) {
  const b = readTrustedBytes(path, max);
  if (b === null || b === "missing") return b;
  try {
    const v = JSON.parse(b.toString("utf8"));
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// A folder the door may use: a real folder (not a link) of this user, no group or other write.
export function trustedFolder(path) {
  try {
    const st = lstatSync(path);
    return st.isDirectory() && st.uid === process.getuid() && (st.mode & 0o022) === 0;
  } catch {
    return false;
  }
}

// ---- the switches -------------------------------------------------------------------------

// { ok: true, on, dailyCredits, monthlyCredits, autoUnderCredits, paused, models, resumedAt }
// or { ok: false }. `paused` is the owner's own pause (any value but null). `resumedAt` is when
// the owner last pressed "Start again" (ms), read only when it is a time not in the future;
// it clears a pause the door set itself before that time.
export function readGenState(path, now = Date.now()) {
  const st = readDoorsState(path);
  if (!st.ok) return { ok: false };
  const g = st.generate;
  let resumedAt = null;
  const raw = readJson(path);
  if (raw && raw.generate && typeof raw.generate === "object" && typeof raw.generate.resumedAt === "string") {
    const t = Date.parse(raw.generate.resumedAt);
    if (Number.isFinite(t) && t <= now + 60_000) resumedAt = t;
  }
  return {
    ok: true,
    on: g.on === true,
    dailyCredits: g.dailyCredits,
    monthlyCredits: g.monthlyCredits,
    autoUnderCredits: g.autoUnderCredits,
    paused: g.paused,
    models: { ...g.models },
    resumedAt,
  };
}

// The Runway key, read now, or null (missing, untrusted, or not `key_` and 128 hex).
export function readRunwayKey(path) {
  const b = readTrustedBytes(path, 4096);
  if (b === null || b === "missing") return null;
  const k = b.toString("utf8").trim();
  return KEY_RE.test(k) ? k : null;
}

// ---- the owner's batches ------------------------------------------------------------------

const iso = (v) => (typeof v === "string" && v.length <= 40 ? Date.parse(v) : NaN);

// An approved batch for `slug`, read now from `<dir>/<id>.json` (written only by the home
// server when the owner approves a shotlist). { ok: true, batch } or { ok: false, why } with
// why one of missing, untrusted, shape, expired, other_agent.
export function readBatch(dir, id, { slug, now }) {
  if (typeof id !== "string" || !ID_RE.test(id)) return { ok: false, why: "missing" };
  if (!trustedFolder(dir)) return { ok: false, why: "untrusted" };
  const v = readJson(join(dir, `${id}.json`));
  if (v === "missing") return { ok: false, why: "missing" };
  if (v === null) return { ok: false, why: "untrusted" };
  const approved = iso(v.approvedAt);
  const expires = iso(v.expiresAt);
  if (v.id !== id || typeof v.slug !== "string" || !Number.isFinite(approved) || !Number.isFinite(expires)) return { ok: false, why: "shape" };
  if (typeof v.budgetCredits !== "number" || !Number.isFinite(v.budgetCredits) || v.budgetCredits < 0) return { ok: false, why: "shape" };
  if (v.textToVideo !== undefined && typeof v.textToVideo !== "boolean") return { ok: false, why: "shape" };
  if (v.frozen !== undefined && typeof v.frozen !== "boolean") return { ok: false, why: "shape" };
  if (!v.shots || typeof v.shots !== "object" || Array.isArray(v.shots)) return { ok: false, why: "shape" };
  const shots = Object.create(null);
  for (const [name, s] of Object.entries(v.shots)) {
    if (!SHOT_RE.test(name) || !s || typeof s !== "object" || !KINDS.includes(s.kind) || typeof s.model !== "string") return { ok: false, why: "shape" };
    if (!Number.isInteger(s.takes) || s.takes < 1 || s.takes > MAX_TAKES) return { ok: false, why: "shape" };
    const video = VIDEO_KINDS.includes(s.kind);
    if (video && !(Number.isInteger(s.maxSeconds) && s.maxSeconds >= MIN_SECONDS && s.maxSeconds <= MAX_SECONDS)) return { ok: false, why: "shape" };
    shots[name] = { kind: s.kind, model: s.model, maxSeconds: video ? s.maxSeconds : null, takes: s.takes };
  }
  if (v.slug !== slug) return { ok: false, why: "other_agent" };
  if (approved > now + 60_000 || expires <= now || expires - approved > BATCH_DAYS * 24 * HOUR + 60_000) return { ok: false, why: "expired" };
  return {
    ok: true,
    batch: { id, slug: v.slug, budgetCredits: v.budgetCredits, textToVideo: v.textToVideo === true, frozen: v.frozen === true, shots },
  };
}

// ---- bytes ----------------------------------------------------------------------------------

const u16be = (b, o) => b.readUInt16BE(o);
const u24le = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);

function jpegSize(b) {
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) return null;
    const m = b[o + 1];
    if (m === 0xff) { o += 1; continue; }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { o += 2; continue; }
    if (m === 0xda || m === 0xd9) return null;
    const len = u16be(b, o + 2);
    if (len < 2) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: u16be(b, o + 5), width: u16be(b, o + 7) };
    }
    o += 2 + len;
  }
  return null;
}

function webpSize(b) {
  if (b.length < 30) return null;
  const chunk = b.toString("latin1", 12, 16);
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    return { width: 1 + (b[21] | ((b[22] & 0x3f) << 8)), height: 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10)) };
  }
  if (chunk === "VP8X") return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  return null;
}

// A picture by its first bytes: { type, ext, width, height } for PNG, JPEG or WebP whose size
// can be read, else null.
export function sniffPicture(b) {
  if (!Buffer.isBuffer(b) || b.length < 32) return null;
  let size = null;
  let type = null;
  let ext = null;
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && b.toString("latin1", 12, 16) === "IHDR") {
    size = { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    type = "image/png"; ext = "png";
  } else if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    size = jpegSize(b);
    type = "image/jpeg"; ext = "jpg";
  } else if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    size = webpSize(b);
    type = "image/webp"; ext = "webp";
  }
  if (!size || !(size.width >= 1 && size.width <= 20000 && size.height >= 1 && size.height <= 20000)) return null;
  return { type, ext, width: size.width, height: size.height };
}

// An output by its first bytes: an MP4 (`ftyp` at byte 4) or a picture. { type, ext } or null.
export function sniffOutput(b, want) {
  if (!Buffer.isBuffer(b) || b.length < 32) return null;
  if (want === "video") return b.toString("latin1", 4, 8) === "ftyp" ? { type: "video/mp4", ext: "mp4" } : null;
  const p = sniffPicture(b);
  return p ? { type: p.type, ext: p.ext } : null;
}

// ---- the work folder --------------------------------------------------------------------------

function ownFolder(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (!trustedFolder(path)) throw new Error("work folder is not the door's own");
}

function writeNew(path, data) {
  writeFileSync(path, data, { mode: 0o600, flag: "wx" });
}

function writeReplace(dir, name, data) {
  const tmp = join(dir, `.${name}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeNew(tmp, data);
    renameSync(tmp, join(dir, name));
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* nothing was left */ }
    throw err;
  }
}

export const newId = (prefix) => `${prefix}${randomBytes(10).toString("hex")}`;
// The hash of a picture's bytes: what "the same picture" means to the door, whatever its id.
export const bytesHash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const HASH_RE = /^[0-9a-f]{64}$/;

// The door's own folder `<doorWork>/gen/`: inputs/<id>.json and .bin, jobs/<job>.json and
// the output beside it. Only the door writes here; it still reads with the trust rule. An
// input's record holds the hash of its bytes (`sha256`); a job's record holds what was sent
// (`prompt`, `inputSha256`) besides the input ids.
export function workStore(root) {
  const base = join(root, "gen");
  const inputs = join(base, "inputs");
  const jobs = join(base, "jobs");
  const ready = () => { ownFolder(root); ownFolder(base); ownFolder(inputs); ownFolder(jobs); };
  const listJson = (dir) => {
    try { return readdirSync(dir).filter((n) => /^[A-Za-z0-9_-]{1,64}\.json$/.test(n)); } catch { return []; }
  };
  const store = {
    // Keeps an input's bytes; returns its record.
    saveInput(slug, pic, bytes, now) {
      ready();
      const id = newId("i");
      const rec = {
        id, slug, at: new Date(now).toISOString(), type: pic.type, width: pic.width, height: pic.height, bytes: bytes.length,
        sha256: bytesHash(bytes), refused: false,
      };
      writeNew(join(inputs, `${id}.bin`), bytes);
      writeReplace(inputs, `${id}.json`, JSON.stringify(rec));
      return rec;
    },
    inputRecord(id) {
      if (!ID_RE.test(id)) return null;
      const v = readJson(join(inputs, `${id}.json`));
      return v && v !== "missing" && v.id === id ? v : null;
    },
    // An input this agent kept in the last day, with its bytes checked again and hashed now
    // (`sha256` is of the bytes read, never the record's word); null otherwise.
    readInput(slug, id, now) {
      const rec = typeof id === "string" ? store.inputRecord(id) : null;
      if (!rec || rec.slug !== slug || !(now - Date.parse(rec.at) < INPUT_HOURS * HOUR)) return null;
      const bytes = readTrustedBytes(join(inputs, `${id}.bin`), INPUT_MAX);
      if (!Buffer.isBuffer(bytes) || bytes.length !== rec.bytes) return null;
      const pic = sniffPicture(bytes);
      if (!pic || pic.type !== rec.type) return null;
      return { ...rec, ...pic, bytes, sha256: bytesHash(bytes) };
    },
    markInputRefused(id) {
      const rec = store.inputRecord(id);
      if (!rec) return;
      try { writeReplace(inputs, `${id}.json`, JSON.stringify({ ...rec, refused: true })); } catch { /* the job record still says so */ }
    },
    countInputs(slug, now) {
      let n = 0;
      for (const name of listJson(inputs)) {
        const rec = store.inputRecord(name.slice(0, -5));
        if (rec && rec.slug === slug && now - Date.parse(rec.at) < INPUT_HOURS * HOUR) n += 1;
      }
      return n;
    },
    saveJob(rec) {
      ready();
      writeReplace(jobs, `${rec.job}.json`, JSON.stringify(rec));
    },
    readJob(job) {
      if (typeof job !== "string" || !ID_RE.test(job)) return null;
      const v = readJson(join(jobs, `${job}.json`));
      return v && v !== "missing" && v.job === job ? v : null;
    },
    listJobs() {
      return listJson(jobs).map((n) => store.readJob(n.slice(0, -5))).filter(Boolean);
    },
    saveOutput(job, ext, bytes) {
      ready();
      writeNew(join(jobs, `${job}.${ext}`), bytes);
    },
    // An open handle on a job's output, checked: { fd, size } or null. The caller closes it.
    openOutput(job, ext, size) {
      if (!ID_RE.test(job) || !/^(mp4|png|jpg|webp)$/.test(ext)) return null;
      let fd;
      try {
        fd = openSync(join(jobs, `${job}.${ext}`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      } catch {
        return null;
      }
      const st = fstatSync(fd);
      if (!st.isFile() || st.uid !== process.getuid() || (st.mode & 0o022) !== 0 || st.size !== size) {
        closeSync(fd);
        return null;
      }
      return { fd, size: st.size };
    },
    // Removes inputs older than a day and job records and outputs older than two days.
    sweep(now) {
      const old = (dir, hours) => {
        let names = [];
        try { names = readdirSync(dir); } catch { return; }
        for (const n of names) {
          const p = join(dir, n);
          try {
            const st = lstatSync(p);
            if (st.isFile() && now - st.mtimeMs > hours * HOUR) unlinkSync(p);
          } catch { /* gone already */ }
        }
      };
      old(inputs, INPUT_HOURS);
      old(jobs, OUTPUT_HOURS);
    },
  };
  return store;
}
