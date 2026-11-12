// CONTRACTS 9.4: GET /api/files/<token>, a file from tasks/company-work/ as a download.
// The token is the base64url of a path relative to that folder. The real path (links resolved) must
// stay inside the real folder, else 404. Agents write these files: the file is opened once with
// openChecked (no link as the file itself, O_NONBLOCK, a regular file, still the file at that place)
// and streamed from that descriptor, never opened again by its path.
// Version 5 (PLAN-V5 K10): "<identifier>/@research/<path>" is a file of the goal's research folder, opened there by
// openTaskFile with every check of lib/taskfiles.mjs (the research root's own included); a second part that reads as
// "@research" in any other spelling is refused, so company-work's own folder of that name is never reached here.
// Every other path is opened exactly as before.
import { basename, join } from "node:path";
import { fileResponse } from "../lib/static.mjs";
import { openChecked, openTaskFile, researchPart } from "../lib/taskfiles.mjs";

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
    const opened = segs.length > 1 && researchPart(segs[1])
      ? openTaskFile(ctx.config, segs[0], segs.slice(1).join("/"))
      : typeof root === "string" && root ? openChecked(join(root, ...segs), root) : null;
    if (!opened) throw notFound(ctx);
    const name = basename(opened.real).replace(/[^A-Za-z0-9._ -]/g, "_");
    return fileResponse(
      { fd: opened.fd, file: opened.real, size: opened.st.size, type: "application/octet-stream" },
      { "content-disposition": `attachment; filename="${name}"` },
    );
  });
}
