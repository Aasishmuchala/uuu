// Search source "routines": routines whose title and ask contain every word of the search.
// Reads engine/company/routines/*.json directly: small files, capped, a bad file is skipped.
import { closeSync, constants, fstatSync, openSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { snippet } from "../lib/format.mjs";

const MAX_FILE = 64 * 1024;
const ID_RE = /^[a-z][a-z0-9-]{1,40}$/;

function readRoutine(dir, file) {
  const id = file.slice(0, -5);
  if (!ID_RE.test(id)) return null;
  let fd;
  try {
    fd = openSync(join(dir, file), constants.O_RDONLY | constants.O_NOFOLLOW);
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > MAX_FILE) return null;
    const j = JSON.parse(readFileSync(fd, "utf8"));
    if (!j || typeof j !== "object" || typeof j.title !== "string" || typeof j.ask !== "string") return null;
    return { id, title: j.title.slice(0, 80), ask: j.ask.slice(0, 2000) };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export default {
  id: "routines",
  label: "Routines",
  async search(ctx, q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const dir = ctx.config.routinesDir || join(ctx.config.engineDir, "company", "routines");
    let files;
    try { files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort(); } catch (e) {
      if (e?.code === "ENOENT") return [];
      return { notSearched: "The routines could not be read just now." };
    }
    return files
      .map((f) => readRoutine(dir, f))
      .filter((r) => r && words.every((w) => `${r.title}\n${r.ask}`.toLowerCase().includes(w)))
      .slice(0, 8)
      .map((r) => ({ title: r.title, snippet: snippet(r.ask, words), link: { page: "routines", id: r.id } }));
  },
};
