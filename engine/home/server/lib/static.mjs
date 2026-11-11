// Static files from engine/home/public only. The real path of every file must stay inside the real
// public folder (links are resolved), or the answer is 404.
import { closeSync, createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, join, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2", ".map": "application/json; charset=utf-8",
};

export const PLACEHOLDER_HTML = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
  + "<title>Home screen</title></head><body><p>The home screen's interface is not built yet. "
  + "The engine is on; the pages will appear here once they are built.</p></body></html>\n";

// Resolves a request path to a real file inside root, or null.
export async function resolveStatic(root, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return null; }
  if (rel.includes("\0") || rel.includes("\\")) return null;
  const segs = rel.split("/").filter(Boolean);
  if (segs.some((s) => s === "." || s === ".." || s.startsWith("."))) return null;
  let realRoot;
  try { realRoot = await realpath(root); } catch { return null; }
  let target = join(realRoot, ...segs);
  try {
    let real = await realpath(target);
    let st = await stat(real);
    if (st.isDirectory()) {
      real = await realpath(join(real, "index.html"));
      st = await stat(real);
    }
    if (!st.isFile()) return null;
    if (real !== realRoot && !real.startsWith(realRoot + sep)) return null;
    return { file: real, size: st.size, type: TYPES[extname(real).toLowerCase()] || "application/octet-stream" };
  } catch {
    return null;
  }
}

// A handler returns fileResponse(found, headers) to stream a file found by resolveStatic.
export const FILE_RESPONSE = Symbol("file response");
export function fileResponse(found, headers = {}) {
  return { [FILE_RESPONSE]: found, headers };
}

// The one byte range a request asks for (C3 37.4), parsed by the core so no route sees the raw header.
// -> { start, end } for exactly one `bytes=a-b` (b at least a) or `bytes=a-` (end null), with whole
// non-negative numbers; null for no header, several ranges, a suffix range, another unit or anything else.
export function parseRangeHeader(header) {
  if (typeof header !== "string" || header.length > 64) return null;
  const m = /^bytes=(\d{1,15})-(\d{0,15})$/.exec(header.trim());
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] === "" ? null : Number(m[2]);
  if (!Number.isSafeInteger(start) || (end !== null && (!Number.isSafeInteger(end) || end < start))) return null;
  return { start, end };
}

// `found` names a file by path, or carries the bytes already read (`bytes`), or a descriptor already
// opened and checked (`fd`; closed here). A file an agent wrote is never opened again by its path.
// A `range` key on `found` (null, or { start, end } from parseRangeHeader) offers byte ranges: the answer
// says Accept-Ranges; one range is answered 206 with Content-Range, read from the same descriptor; a range
// that starts at or past the end is 416 with `Content-Range: bytes */<size>`; null is the whole file.
export function streamFile(res, found, headers, headOnly) {
  const size = found.bytes ? found.bytes.length : found.size;
  const closeFd = () => { if (found.fd !== undefined) try { closeSync(found.fd); } catch { /* already closed */ } };
  const ranged = "range" in found;
  const r = ranged ? found.range : null;
  const one = r && Number.isSafeInteger(r.start) && r.start >= 0
    && (r.end === null || (Number.isSafeInteger(r.end) && r.end >= r.start));
  if (ranged) headers = { ...headers, "accept-ranges": "bytes" };
  if (one && r.start >= size) {
    closeFd();
    res.writeHead(416, { ...headers, "content-range": `bytes */${size}`, "content-length": 0 });
    return res.end();
  }
  const start = one ? r.start : 0;
  const end = one ? Math.min(r.end === null ? size - 1 : r.end, size - 1) : Math.max(0, size - 1);
  const length = one ? end - start + 1 : size;
  res.writeHead(one ? 206 : 200, {
    ...headers, "content-type": found.type, "content-length": length,
    ...(one ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
  });
  if (headOnly || found.bytes) {
    closeFd();
    return res.end(headOnly ? undefined : (one ? found.bytes.subarray(start, end + 1) : found.bytes));
  }
  const s = found.fd !== undefined
    ? createReadStream(null, { fd: found.fd, start, end, autoClose: true })
    : createReadStream(found.file, one ? { start, end } : undefined);
  s.on("error", () => res.destroy());
  // A browser's video player drops requests all the time when the owner seeks. Without this the paused
  // read stream is never destroyed and the file stays open until the server restarts.
  res.on("close", () => s.destroy());
  s.pipe(res);
}
