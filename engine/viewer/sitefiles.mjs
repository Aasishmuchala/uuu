// A built site as a list of files (PLAN-V5 K15 row 4): the rules every name, ending and size
// must pass, the one content type each ending is served with, the headers every answer of a
// served site carries, and a folder read with the usual distrust (docs/adr/0007). Used by the
// page viewer, the owner's preview and the home server, so all three apply the same rules.
// Zero dependencies.
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const SITE_LIMITS = Object.freeze({
  sentBytes: 20 * 1024 * 1024,      // the archive as sent
  totalBytes: 20 * 1024 * 1024,     // every file unpacked, added up
  entries: 300,                      // files and folders
  fileBytes: 10 * 1024 * 1024,      // one file
  segments: 6,                       // folders deep, the file included
});

export const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

// Each ending has one fixed type; nothing else is served or unpacked.
export const TYPES = Object.freeze({
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  txt: "text/plain; charset=utf-8",
  mp4: "video/mp4",
  webm: "video/webm",
});

// The page may reach nothing but itself (K15).
export const SITE_POLICY = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'; frame-ancestors 'none'";

export const SITE_HEADERS = Object.freeze({
  "Content-Security-Policy": SITE_POLICY,
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), usb=(), serial=(), bluetooth=(), hid=(), payment=(), display-capture=()",
  "Cache-Control": "no-store",
});

export function endingOf(name) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

export function typeFor(name) {
  return Object.hasOwn(TYPES, endingOf(name)) ? TYPES[endingOf(name)] : null;
}

// One name as the rules see it: a reason it is refused, or null. `kind` is "file" or "dir".
export function nameProblem(name, kind) {
  if (typeof name !== "string" || name === "") return "an entry has no name";
  if (name.startsWith("/")) return "an entry's name is absolute";
  if (name.includes("..")) return "an entry's name holds ..";
  const parts = name.split("/");
  if (parts.length > SITE_LIMITS.segments) return `an entry is more than ${SITE_LIMITS.segments} folders deep`;
  if (!parts.every((p) => SEGMENT_RE.test(p))) return "an entry's name is not plain (letters, digits, dot, dash, underscore)";
  if (kind === "file" && typeFor(name) === null) return "an entry has an ending that is not served";
  return null;
}

// Plain capped text of a name, for a sentence back to the sender (never for a log).
export function shownName(name) {
  return String(name).replace(/[^\x20-\x7e]/g, "?").slice(0, 120);
}

// entries: [{ name, type: "file" | "dir", size }]. Applies K15 row 4 to the list:
// -> { ok: true, files: [names], dirs: [names], bytes } or { ok: false, reason }.
// Folders may be listed or only implied by a file's name; names are compared without regard
// to letter case, as this Mac's disk does.
export function checkEntries(entries) {
  if (!Array.isArray(entries)) return { ok: false, reason: "the site is not a list of files" };
  if (entries.length > SITE_LIMITS.entries) return { ok: false, reason: `the site has more than ${SITE_LIMITS.entries} entries` };
  const kinds = new Map(); // lower-case name -> "file" | "dir"
  const files = [];
  const dirs = [];
  let bytes = 0;
  const claim = (name, kind) => {
    const key = name.toLowerCase();
    const had = kinds.get(key);
    if (had === undefined) { kinds.set(key, kind); return true; }
    return had === "dir" && kind === "dir";
  };
  for (const e of entries) {
    if (!e || typeof e !== "object") return { ok: false, reason: "the site is not a list of files" };
    if (e.type !== "file" && e.type !== "dir") return { ok: false, reason: `${shownName(e.name)}: only plain files and folders are taken` };
    const problem = nameProblem(e.name, e.type);
    if (problem) return { ok: false, reason: `${problem}: ${shownName(e.name)}` };
    const parts = e.name.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (!claim(parts.slice(0, i).join("/"), "dir")) return { ok: false, reason: `a name is used for a file and a folder: ${shownName(e.name)}` };
    }
    if (e.type === "file") {
      if (!Number.isSafeInteger(e.size) || e.size < 0) return { ok: false, reason: `${shownName(e.name)}: no size` };
      if (e.size > SITE_LIMITS.fileBytes) return { ok: false, reason: `a file is over 10 MB: ${shownName(e.name)}` };
      bytes += e.size;
      if (bytes > SITE_LIMITS.totalBytes) return { ok: false, reason: "the site is over 20 MB unpacked" };
      if (!claim(e.name, "file")) return { ok: false, reason: `a name is used twice: ${shownName(e.name)}` };
      files.push(e.name);
    } else {
      if (!claim(e.name, "dir")) return { ok: false, reason: `a name is used for a file and a folder: ${shownName(e.name)}` };
      dirs.push(e.name);
    }
  }
  if (!files.includes("index.html")) return { ok: false, reason: "there is no index.html at the top" };
  return { ok: true, files, dirs, bytes };
}

const sameNode = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;
const lstatOrNull = (p) => { try { return lstatSync(p); } catch { return null; } };

// Reads a site folder an agent wrote: never follows a link, never opens anything but a
// regular file, and leaves out (listing why) what can never be served: links, devices,
// hidden files and names or endings outside the rules. The limits fail the whole site.
// -> { ok: true, files: [{ name, data }], left: [{ name, why }], bytes } or { ok: false, reason }.
export function collectSite(dir) {
  const top = lstatOrNull(dir);
  if (!top || !top.isDirectory()) return { ok: false, reason: "the site folder is missing or is not a plain folder" };
  const files = [];
  const left = [];
  const seen = []; // [path, stat] of every folder on the way, checked again after each open
  let bytes = 0;
  let count = 0;
  const leave = (name, why) => { if (left.length < 50) left.push({ name: shownName(name), why }); };

  function walk(abs, rel, depth, chain) {
    let names;
    try { names = readdirSync(abs); } catch { return "a folder of the site could not be read"; }
    names.sort();
    for (const n of names) {
      const name = rel ? `${rel}/${n}` : n;
      const p = join(abs, n);
      const st = lstatOrNull(p);
      if (!st) continue;
      if (st.isSymbolicLink()) { leave(name, "a link"); continue; }
      if (!st.isFile() && !st.isDirectory()) { leave(name, "not a plain file"); continue; }
      const kind = st.isDirectory() ? "dir" : "file";
      const problem = nameProblem(name, kind);
      if (problem) { leave(name, problem.replace(/^an entry('s)? /, "")); continue; }
      if (++count > SITE_LIMITS.entries) return `the site has more than ${SITE_LIMITS.entries} entries`;
      if (kind === "dir") {
        if (depth + 1 >= SITE_LIMITS.segments) { leave(name, "too deep"); continue; }
        const why = walk(p, name, depth + 1, [...chain, [p, st]]);
        if (why) return why;
        continue;
      }
      if (st.size > SITE_LIMITS.fileBytes) return `a file is over 10 MB: ${shownName(name)}`;
      if (bytes + st.size > SITE_LIMITS.totalBytes) return "the site is over 20 MB";
      const data = readNoFollow(p, st, chain);
      if (data === null) { leave(name, "changed while it was read"); continue; }
      bytes += data.length;
      files.push({ name, data });
    }
    return null;
  }
  seen.push([dir, top]);
  const why = walk(dir, "", 0, seen);
  if (why) return { ok: false, reason: why };
  const check = checkEntries(files.map((f) => ({ name: f.name, type: "file", size: f.data.length })));
  if (!check.ok) return { ok: false, reason: check.reason };
  return { ok: true, files, left, bytes };
}

// A file opened once with no-follow, checked on the open handle against what the walk saw,
// and every folder on its way checked again afterwards (a folder swapped for a link while
// the file was opened is caught unless it is swapped back in between; see the report).
function readNoFollow(path, seenStat, chain) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || !sameNode(st, seenStat) || st.size > SITE_LIMITS.fileBytes) return null;
    const buf = Buffer.alloc(st.size);
    let got = 0;
    while (got < st.size) {
      const n = readSync(fd, buf, got, st.size - got, got);
      if (n <= 0) break;
      got += n;
    }
    if (got !== st.size) return null;
    for (const [p, was] of chain) {
      const now = lstatOrNull(p);
      if (!now || now.isSymbolicLink() || !now.isDirectory() || !sameNode(now, was)) return null;
    }
    return buf;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

// The request handler of a served site: GET and HEAD of a listed file only, `/` and a folder
// ending in `/` mean its index.html, a query string is ignored, nothing is decoded (a name
// that needs decoding is not a name of the site). files: Map name -> Buffer.
// onMissing(name) is told the plain names asked for that are not there.
export function siteHandler(getFiles, { onMissing } = {}) {
  return (req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    const files = getFiles();
    const target = typeof req.url === "string" ? req.url : "";
    const path = target.split("?")[0];
    let name = path.startsWith("/") ? path.slice(1) : "";
    if (name === "" || name.endsWith("/")) name += "index.html";
    const data = files && (req.method === "GET" || req.method === "HEAD") && nameProblem(name, "file") === null ? files.get(name) : undefined;
    if (!data) {
      if (onMissing && files && nameProblem(name, "file") === null && (req.method === "GET" || req.method === "HEAD")) onMissing(name);
      const text = "Not found.";
      res.writeHead(req.method === "GET" || req.method === "HEAD" ? 404 : 405, {
        ...SITE_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Content-Length": Buffer.byteLength(text), Connection: "close",
      });
      return void res.end(req.method === "HEAD" ? undefined : text);
    }
    res.writeHead(200, { ...SITE_HEADERS, "Content-Type": typeFor(name), "Content-Length": data.length });
    res.end(req.method === "HEAD" ? undefined : data);
  };
}
