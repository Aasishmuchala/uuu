// Viewing a file an agent wrote (CONTRACTS-V2 17.8): GET /api/view/<token>.
// Every file in a goal's folder is untrusted, and this route sends it to the owner's browser, so:
//   - the token rules and path checks of /api/files (CONTRACTS 9.4), but stricter: no link anywhere on the
//     way, the file opened with O_NOFOLLOW, a regular file whose real path stays inside the goal's folder;
//   - images by extension and by their first bytes (they must agree), with their real type, inline, and the
//     policy `default-src 'none'; sandbox`, so nothing in them (an SVG's script) can run as the home screen;
//   - a video (.mp4, C3 37.4) opened once, at most 300 MB, `ftyp` at byte 4, and streamed from that one
//     descriptor under the same policy, whole or as one byte range;
//   - text only as JSON; nothing is ever answered as HTML; every other file is "not viewable".
import { closeSync } from "node:fs";
import { fileResponse } from "../lib/static.mjs";
import { readTaskText } from "../lib/taskfiles.mjs";
import { headOf, isMp4, openGoalFile, readGoalBytes, sniff } from "./_images.mjs";

const MAX_IMAGE = 20 * 1024 * 1024;
const MAX_VIDEO = 300 * 1024 * 1024;
const MAX_SVG = 1024 * 1024;
const MAX_TEXT = 262144;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,64}$/;
const SANDBOX = "default-src 'none'; sandbox";

// Extension -> what its first bytes must be, and the type it is sent with.
const IMAGES = {
  png: { sniff: "png", type: "image/png" },
  gif: { sniff: "gif", type: "image/gif" },
  jpg: { sniff: "jpeg", type: "image/jpeg" },
  jpeg: { sniff: "jpeg", type: "image/jpeg" },
  webp: { sniff: "webp", type: "image/webp" },
};
const TEXT = new Set(["md", "txt", "json", "py", "csv", "log"]);

function notFound(ctx) {
  return ctx.fail(404, "That file is not here any more.", "Go back to the task and look at its files again.", "file_not_found");
}

function notViewable(ctx) {
  return ctx.fail(404, "This file cannot be shown here.", "Download it instead.", "not_viewable");
}

function tooLarge(ctx) {
  return ctx.fail(413, "This file is too large to show here.", "Download it instead.", "too_large");
}

// The goal's identifier and the path inside its folder, from a token; null when the token is not plain.
function parseToken(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{1,2000}$/.test(token)) return null;
  const rel = Buffer.from(token, "base64url").toString("utf8");
  if (!rel || rel.includes("\0") || rel.includes("\\") || rel.startsWith("/")) return null;
  const segs = rel.split("/");
  if (segs.length < 2 || segs.some((s) => !s || s === "." || s === "..")) return null;
  if (!IDENTIFIER.test(segs[0])) return null;
  return { identifier: segs[0], path: segs.slice(1).join("/"), base: segs[segs.length - 1] };
}

function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

// A file name safe inside a header: plain characters only.
const headerName = (name) => name.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120) || "file";

// The bytes already read and checked are what is sent: the file is never opened again by its path.
function imageAnswer(found, type, name) {
  return fileResponse(
    { bytes: found.bytes, size: found.bytes.length, type },
    { "content-disposition": `inline; filename="${headerName(name)}"`, "content-security-policy": SANDBOX },
  );
}

// A video, from the one descriptor opened and checked here. The core streams it and closes it: the one
// byte range the core parsed (ctx.range) as 206, a range past the end as 416, no range (or several, or a
// malformed one, which the core gives as null) as the whole file.
function videoAnswer(ctx, t) {
  const opened = openGoalFile(ctx.config, t.identifier, t.path);
  if (!opened) throw notFound(ctx);
  const { fd, st } = opened;
  let handedOn = false;
  try {
    if (st.size > MAX_VIDEO) throw tooLarge(ctx);
    if (!isMp4(headOf(fd, 12))) throw notViewable(ctx);
    handedOn = true;
    return fileResponse(
      { fd, size: st.size, type: "video/mp4", range: ctx.range ?? null },
      {
        "content-disposition": `inline; filename="${headerName(t.base)}"`,
        "content-security-policy": SANDBOX,
        "accept-ranges": "bytes",
      },
    );
  } finally {
    if (!handedOn) try { closeSync(fd); } catch { /* already closed */ }
  }
}

export default function register(app) {
  app.get("/api/view/:token", async (ctx) => {
    const t = parseToken(ctx.params.token);
    if (!t) throw notFound(ctx);
    const ext = extensionOf(t.base);

    if (IMAGES[ext]) {
      const found = readGoalBytes(ctx.config, t.identifier, t.path, { maxBytes: MAX_IMAGE });
      if (!found) throw notFound(ctx);
      if (found.tooLarge) throw tooLarge(ctx);
      if (sniff(found.bytes) !== IMAGES[ext].sniff) throw notViewable(ctx);
      return imageAnswer(found, IMAGES[ext].type, t.base);
    }

    if (ext === "mp4") return videoAnswer(ctx, t);

    if (ext === "svg") {
      const found = readGoalBytes(ctx.config, t.identifier, t.path, { maxBytes: MAX_SVG });
      if (!found) throw notFound(ctx);
      if (found.tooLarge) throw notViewable(ctx);
      if (sniff(found.bytes) !== null) throw notViewable(ctx);
      const text = found.bytes.toString("utf8");
      if (!/<svg[\s>/]/i.test(text)) throw notViewable(ctx);
      return imageAnswer(found, "image/svg+xml", t.base);
    }

    if (TEXT.has(ext)) {
      const read = readTaskText(ctx.config, t.identifier, t.path, { maxBytes: MAX_TEXT });
      if (!read) throw notFound(ctx);
      return { name: t.path, text: read.text, truncated: read.truncated };
    }

    throw notViewable(ctx);
  });
}
