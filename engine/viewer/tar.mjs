// Tar archives for the page viewer (PLAN-V5 K15 row 4). Reads plain ustar, and gzip through
// zlib with a hard cap on what it may unpack to, applying every rule of sitefiles.mjs to the
// whole list BEFORE a byte is written to disk; writes ustar for the viewer's own answers and
// the home server's loads. Nothing in an archive is ever run, followed or trusted: only
// regular files and folders are taken, under plain names, into a fresh folder of our own.
// Zero dependencies.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { SITE_LIMITS, checkEntries, shownName } from "./sitefiles.mjs";

const BLOCK = 512;
// Headers of any kind (pax records included) read before the archive is refused: bounds the
// work an archive of empty headers can cause.
const MAX_HEADERS = 2 * SITE_LIMITS.entries + 8;
const MAX_PAX_BYTES = 8 * 1024;
// What a gzip stream may unpack to: the files, a header and padding per entry, the end.
export const MAX_TAR_BYTES = SITE_LIMITS.totalBytes + (MAX_HEADERS + 2) * 2 * BLOCK;

const bad = (reason) => ({ ok: false, reason });

function cstring(buf, start, len) {
  const field = buf.subarray(start, start + len);
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? len : end).toString("latin1");
}

// An octal number field (spaces or NUL may end it); null when it is anything else, base-256
// included.
function octal(buf, start, len) {
  const text = cstring(buf, start, len).replace(/ +$/, "").replace(/^ +/, "");
  if (!/^[0-7]{1,12}$/.test(text)) return null;
  const n = parseInt(text, 8);
  return Number.isSafeInteger(n) ? n : null;
}

function checksumOk(h) {
  const want = octal(h, 148, 8);
  if (want === null) return false;
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
  return sum === want;
}

// pax records: "<len> <key>=<value>\n". Only `path` is used; `size` must agree with the
// header. -> { path?, size? } or null when the records do not parse.
function paxRecords(data) {
  const out = {};
  let i = 0;
  while (i < data.length) {
    const sp = data.indexOf(0x20, i);
    if (sp < 0 || sp - i > 8) return null;
    const lenText = data.subarray(i, sp).toString("latin1");
    if (!/^[1-9][0-9]{0,7}$/.test(lenText)) return null;
    const len = Number(lenText);
    if (i + len > data.length || data[i + len - 1] !== 0x0a) return null;
    const rec = data.subarray(sp + 1, i + len - 1).toString("utf8");
    const eq = rec.indexOf("=");
    if (eq <= 0) return null;
    const key = rec.slice(0, eq);
    const value = rec.slice(eq + 1);
    if (key === "path") out.path = value;
    else if (key === "size") out.size = value;
    i += len;
  }
  return out;
}

const isZero = (h) => { for (let i = 0; i < BLOCK; i++) if (h[i] !== 0) return false; return true; };

// The archive's bytes (as sent) -> { ok: true, entries: [{ name, type, data }], files, bytes }
// or { ok: false, reason } (a plain sentence for the sender; it may hold a capped name of
// theirs). Folders are listed as entries of type "dir" with no data.
export function readTar(input) {
  if (!Buffer.isBuffer(input)) return bad("the site must be sent as the bytes of a tar archive");
  if (input.length > SITE_LIMITS.sentBytes) return bad("the archive is over 20 MB");
  let buf = input;
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      buf = gunzipSync(input, { maxOutputLength: MAX_TAR_BYTES });
    } catch (err) {
      return bad(err && err.code === "ERR_BUFFER_TOO_LARGE" ? "the archive is over 20 MB unpacked" : "the gzip stream is damaged");
    }
  }
  if (buf.length > MAX_TAR_BYTES) return bad("the archive is over 20 MB unpacked");
  if (buf.length < BLOCK) return bad("this is not a tar archive");

  const entries = [];
  let off = 0;
  let headers = 0;
  let pax = null;
  let ended = false;
  while (off + BLOCK <= buf.length) {
    const h = buf.subarray(off, off + BLOCK);
    if (isZero(h)) { ended = true; break; }
    if (++headers > MAX_HEADERS) return bad(`the site has more than ${SITE_LIMITS.entries} entries`);
    const magic = h.subarray(257, 263).toString("latin1");
    if (magic !== "ustar\0" && magic !== "ustar ") return bad("this is not a ustar archive");
    if (!checksumOk(h)) return bad("the archive is damaged (a header's checksum is wrong)");
    const size = octal(h, 124, 12);
    if (size === null) return bad("the archive is damaged (a size is not a plain number)");
    const flag = String.fromCharCode(h[156]);
    const dataStart = off + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > buf.length) return bad("the archive ends in the middle of a file");
    off = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (flag === "x" || flag === "g") {
      if (size > MAX_PAX_BYTES) return bad("the archive has an extended header that is too long");
      const recs = paxRecords(buf.subarray(dataStart, dataEnd));
      if (recs === null) return bad("the archive has a damaged extended header");
      if (flag === "x") pax = recs;
      continue;
    }
    let type;
    if (flag === "0" || flag === "\0") type = "file";
    else if (flag === "5") type = "dir";
    else {
      const kinds = { 1: "a hard link", 2: "a link", 3: "a device", 4: "a device", 6: "a pipe", 7: "a special file", L: "a long-name record", K: "a long-link record" };
      const name = cstring(h, 0, 100);
      return bad(`only plain files and folders are taken, and this is ${kinds[flag] || "something else"}: ${shownName(name)}`);
    }
    if (type === "dir" && size !== 0) return bad("the archive is damaged (a folder has a size)");
    let name = pax && typeof pax.path === "string" ? pax.path : (() => {
      const prefix = magic === "ustar\0" ? cstring(h, 345, 155) : "";
      const base = cstring(h, 0, 100);
      return prefix ? `${prefix}/${base}` : base;
    })();
    if (pax && pax.size !== undefined && pax.size !== String(size)) return bad("the archive is damaged (two sizes for one file)");
    pax = null;
    if (/[\x00-\x1f\x7f]/.test(name)) return bad(`an entry's name is not plain: ${shownName(name)}`);
    // One leading "./" is how tar writes "this folder"; the folder itself is not an entry.
    if (name.startsWith("./")) name = name.slice(2);
    if (type === "dir" && name.endsWith("/")) name = name.slice(0, -1);
    if (name === "" || name === ".") {
      if (type === "dir") continue;
      return bad("an entry has no name");
    }
    entries.push({ name, type, data: type === "file" ? buf.subarray(dataStart, dataEnd) : null, size });
  }
  if (!ended && off < buf.length) return bad("the archive ends in the middle of a header");
  if (pax) return bad("the archive ends after an extended header");
  const check = checkEntries(entries.map((e) => ({ name: e.name, type: e.type, size: e.size })));
  if (!check.ok) return bad(check.reason);
  return { ok: true, entries: entries.map(({ name, type, data }) => ({ name, type, data })), files: check.files, bytes: check.bytes };
}

// Writes checked entries into `dir`, which must not exist yet: the folder is made 0700,
// folders 0700, files 0600, each file created new (never over anything). Throws on any
// failure; the caller removes `dir`.
export function unpack(entries, dir) {
  mkdirSync(dir, { mode: 0o700 });
  const made = new Set([""]);
  const folder = (rel) => {
    const parts = rel.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const sub = parts.slice(0, i).join("/");
      if (made.has(sub)) continue;
      mkdirSync(join(dir, sub), { mode: 0o700 });
      made.add(sub);
    }
  };
  for (const e of entries) {
    if (e.type === "dir") { folder(e.name); continue; }
    const at = e.name.lastIndexOf("/");
    if (at > 0) folder(e.name.slice(0, at));
    writeFileSync(join(dir, e.name), e.data, { mode: 0o600, flag: "wx" });
  }
}

function header(name, size, flag) {
  const h = Buffer.alloc(BLOCK);
  const put = (text, start, len) => { Buffer.from(text, "latin1").copy(h, start, 0, len); };
  const num = (n, start, len) => put(n.toString(8).padStart(len - 1, "0") + "\0", start, len);
  let base = name;
  let prefix = "";
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf("/", name.length - 1);
    // a split that fits ustar's two fields; the caller uses a pax record when none does
    if (cut > 0 && cut <= 155 && name.length - cut - 1 <= 100) { prefix = name.slice(0, cut); base = name.slice(cut + 1); }
  }
  put(base, 0, 100);
  num(flag === "5" ? 0o700 : 0o600, 100, 8);
  num(0, 108, 8);
  num(0, 116, 8);
  num(size, 124, 12);
  num(0, 136, 12);
  h.fill(0x20, 148, 156);
  h[156] = flag.charCodeAt(0);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  put(prefix, 345, 155);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += h[i];
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return h;
}

const fitsUstar = (name) => Buffer.byteLength(name) <= 100 ||
  (() => { const cut = name.lastIndexOf("/"); return cut > 0 && cut <= 155 && name.length - cut - 1 <= 100; })();

// files: [{ name, data }] (names already checked by the caller) -> the bytes of a ustar
// archive. A name that does not fit ustar's fields gets a pax `path` record.
export function writeTar(files) {
  const parts = [];
  const pad = (n) => { const r = n % BLOCK; if (r) parts.push(Buffer.alloc(BLOCK - r)); };
  for (const f of files) {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    if (!fitsUstar(f.name)) {
      const body = (n) => `${n} path=${f.name}\n`;
      let len = Buffer.byteLength(body(0));
      while (Buffer.byteLength(body(len)) !== len) len = Buffer.byteLength(body(len));
      const rec = Buffer.from(body(len));
      parts.push(header("PaxHeader", rec.length, "x"), rec);
      pad(rec.length);
    }
    parts.push(header(fitsUstar(f.name) ? f.name : f.name.slice(-100).replace(/^[^/]*\//, ""), data.length, "0"), data);
    pad(data.length);
  }
  parts.push(Buffer.alloc(2 * BLOCK));
  return Buffer.concat(parts);
}
