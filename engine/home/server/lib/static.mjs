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

// `found` names a file by path, or carries the bytes already read (`bytes`), or a descriptor already
// opened and checked (`fd`; closed here). A file an agent wrote is never opened again by its path.
export function streamFile(res, found, headers, headOnly) {
  const size = found.bytes ? found.bytes.length : found.size;
  res.writeHead(200, { ...headers, "content-type": found.type, "content-length": size });
  if (headOnly || found.bytes) {
    if (found.fd !== undefined) try { closeSync(found.fd); } catch { /* already closed */ }
    return res.end(headOnly ? undefined : found.bytes);
  }
  const s = found.fd !== undefined
    ? createReadStream(null, { fd: found.fd, start: 0, end: Math.max(0, size - 1), autoClose: true })
    : createReadStream(found.file);
  s.on("error", () => res.destroy());
  s.pipe(res);
}
