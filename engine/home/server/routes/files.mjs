// CONTRACTS 9.4: GET /api/files/<token>, a file from tasks/company-work/ as a download.
// The token is the base64url of a path relative to that folder. The real path (links resolved) must
// stay inside the real folder, else 404.
import { realpath, stat } from "node:fs/promises";
import { basename, join, sep } from "node:path";
import { fileResponse } from "../lib/static.mjs";

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
    let root, real, st;
    try {
      root = await realpath(ctx.config.paths.projectFolder);
      real = await realpath(join(root, ...segs));
      st = await stat(real);
    } catch {
      throw notFound(ctx);
    }
    if (!real.startsWith(root + sep) || !st.isFile()) throw notFound(ctx);
    const name = basename(real).replace(/[^A-Za-z0-9._ -]/g, "_");
    return fileResponse(
      { file: real, size: st.size, type: "application/octet-stream" },
      { "content-disposition": `attachment; filename="${name}"` },
    );
  });
}
