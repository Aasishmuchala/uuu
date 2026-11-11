// CONTRACTS 9.4: GET /api/files/<token>, a file from tasks/company-work/ as a download.
// The token is the base64url of a path relative to that folder. The real path (links resolved) must
// stay inside the real folder, else 404. Agents write these files: the file is opened once with
// openChecked (no link as the file itself, O_NONBLOCK, a regular file, still the file at that place)
// and streamed from that descriptor, never opened again by its path.
import { basename, join } from "node:path";
import { fileResponse } from "../lib/static.mjs";
import { openChecked } from "../lib/taskfiles.mjs";

function notFound(ctx) {
  return ctx.fail(404, "That file is not here any more.", "Go back to the goal and look at its files again.", "file_not_found");
}

export default function register(app) {
  app.get("/api/files/:token", async (ctx) => {
    const token = ctx.params.token;
    if (!/^[A-Za-z0-9_-]{1,2000}$/.test(token)) throw notFound(ctx);
    const rel = Buffer.from(token, "base64url").toString("utf8");
    if (!rel || rel.includes("\0") || rel.includes("\\") || rel.startsWith("/")) throw notFound(ctx);
    const segs = rel.split("/");
    if (segs.some((s) => !s || s === "." || s === "..")) throw notFound(ctx);
    const root = ctx.config.paths.projectFolder;
    const opened = typeof root === "string" && root ? openChecked(join(root, ...segs), root) : null;
    if (!opened) throw notFound(ctx);
    const name = basename(opened.real).replace(/[^A-Za-z0-9._ -]/g, "_");
    return fileResponse(
      { fd: opened.fd, file: opened.real, size: opened.st.size, type: "application/octet-stream" },
      { "content-disposition": `attachment; filename="${name}"` },
    );
  });
}
