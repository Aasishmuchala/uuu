// The company brain (CONTRACTS-V3 33.6): the overview, a folder, a file, its bytes, adding, moving,
// deleting and searching. The form and starter routes are in routes/brain-forms.mjs (M32).
// Every write goes through brain/store.mjs, which holds the rules of 32.2. What is sent back:
//   - a file's text only inside JSON, never as a page;
//   - a picture with its real type (from its first bytes, which must agree with its name), inline, under
//     `default-src 'none'; sandbox`, so nothing in it can run as the home screen;
//   - everything else (a PDF, a table, text, a picture whose bytes do not match, and any `?download=1`) as
//     `application/octet-stream`, an attachment. Nothing is ever answered as HTML.
import { join } from "node:path";
import { loadStarters } from "../../../company/lib/brain-files.mjs";
import { basics } from "../lib/brainfiles.mjs";
import { fileResponse } from "../lib/static.mjs";
import {
  ENDINGS, MAX_FILES, MAX_IMAGE_BYTES, MAX_TEXT_BYTES, MAX_TOTAL_BYTES, brainFor, brainRun, brainToken,
} from "../brain/store.mjs";

const UPLOAD_MAX_BODY = 14 * 1024 * 1024;
const SANDBOX = "default-src 'none'; sandbox";
const RECENT = 10;
const FOLDER_FILES = 500;
// The order of 32.5; a starter page not named here comes after, by name.
const STARTER_ORDER = ["call-write-up", "proposal", "carousel", "post", "newsletter", "title-card", "captions", "video-cut", "slow-reveal"];

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const body = (ctx) => (obj(ctx.body) ? ctx.body : {});
const badRequest = (ctx) => ctx.fail(400, "The home screen sent something it could not read.", "Refresh the page and try again.", "bad_request");

// A file name safe inside a header: plain characters only.
const headerName = (name) => String(name).replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120) || "file";

// The first sentence of a starter page after its title, at most 140 characters, as plain words.
function aboutOf(text) {
  const para = String(text).split("\n").slice(1).map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("-") && !l.startsWith("|"));
  const joined = para.slice(0, 4).join(" ");
  const first = joined.match(/^.*?[.!?](?=\s|$)/);
  const s = (first ? first[0] : joined).replace(/[*_`]/g, "");
  return s.length > 140 ? `${s.slice(0, 139).replace(/\s+\S*$/, "")}…` : s;
}

function starters(ctx, listed) {
  let found = [];
  try { found = loadStarters(join(ctx.config.engineDir, "company", "brain", "starters")).starters; } catch { found = []; }
  const rank = (id) => { const i = STARTER_ORDER.indexOf(id); return i === -1 ? STARTER_ORDER.length : i; };
  return found
    .filter((s) => s.folder === "packs")
    .sort((a, b) => rank(a.id) - rank(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((s) => ({ id: s.id, title: s.title, about: aboutOf(s.text), added: listed.has(`packs/${s.file}`) }));
}

// Base64 from the browser -> bytes, or null when it is not plain base64.
function decodeBase64(s) {
  if (typeof s !== "string") return null;
  const t = s.replace(/\s+/g, "");
  if (t.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(t)) return null;
  return Buffer.from(t, "base64");
}

export default function register(app) {
  app.get("/api/brain", (ctx) => brainRun(ctx, () => {
    const store = brainFor(ctx.config);
    const files = store.list();
    const counts = new Map();
    for (const f of files) counts.set(f.folder, (counts.get(f.folder) || 0) + 1);
    const items = basics(ctx.config).map((b) => ({ form: b.form, title: b.title, file: b.file, state: b.state, token: brainToken(b.file) }));
    return {
      folders: store.folders().map((f) => ({ ...f, files: counts.get(f.id) || 0 })),
      basics: { filled: items.filter((b) => b.state === "filled").length, total: items.length, items },
      starters: starters(ctx, new Set(files.map((f) => f.path))),
      totals: { files: files.length, bytes: files.reduce((s, f) => s + f.size, 0) },
      limits: { imageBytes: MAX_IMAGE_BYTES, textBytes: MAX_TEXT_BYTES, files: MAX_FILES, totalBytes: MAX_TOTAL_BYTES, endings: [...ENDINGS] },
      recent: files.slice(0, RECENT),
      generatedAt: new Date().toISOString(),
    };
  }));

  app.get("/api/brain/folder/:id", (ctx) => brainRun(ctx, () => {
    const store = brainFor(ctx.config);
    const folder = store.folders().find((f) => f.id === ctx.params.id);
    if (!folder) {
      throw ctx.fail(404, "That folder is not in the company brain.", "Pick one of the folders from the list.", "folder_not_found");
    }
    const all = store.list().filter((f) => f.folder === folder.id);
    const forms = basics(ctx.config).filter((b) => b.file.startsWith(`${folder.id}/`)).map((b) => ({ id: b.form, title: b.title, state: b.state }));
    return { folder: { ...folder, files: all.length }, files: all.slice(0, FOLDER_FILES), forms };
  }));

  app.get("/api/brain/file/:token", (ctx) => brainRun(ctx, () => brainFor(ctx.config).get(ctx.params.token)));

  app.get("/api/brain/raw/:token", (ctx) => brainRun(ctx, () => {
    const { file, bytes, type } = brainFor(ctx.config).raw(ctx.params.token);
    const inline = type && ctx.query.download !== "1";
    return fileResponse(
      { bytes, size: bytes.length, type: inline ? type : "application/octet-stream" },
      {
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${headerName(file.name)}"`,
        "content-security-policy": SANDBOX,
      },
    );
  }));

  app.post("/api/brain/files", (ctx) => {
    const b = body(ctx);
    const hasText = b.text !== undefined;
    const hasFile = b.base64 !== undefined;
    if (hasText === hasFile) throw badRequest(ctx);
    let input;
    if (hasText) {
      if (typeof b.text !== "string") throw badRequest(ctx);
      input = { folder: b.folder, name: b.name, text: b.text };
    } else {
      const bytes = decodeBase64(b.base64);
      if (!bytes) throw badRequest(ctx);
      input = { folder: b.folder, name: b.name, bytes };
    }
    return { status: 201, body: { file: brainRun(ctx, () => brainFor(ctx.config).add(input)) } };
  }, { maxBody: UPLOAD_MAX_BODY });

  app.post("/api/brain/move", (ctx) => {
    const b = body(ctx);
    if (typeof b.token !== "string" || typeof b.folder !== "string") throw badRequest(ctx);
    return { file: brainRun(ctx, () => brainFor(ctx.config).move(b.token, b.folder, b.version)) };
  });

  app.delete("/api/brain/file/:token", (ctx) => brainRun(ctx, () => brainFor(ctx.config).remove(ctx.params.token, ctx.query.version)));

  app.get("/api/brain/search", (ctx) => ({
    results: brainRun(ctx, () => brainFor(ctx.config).search(String(ctx.query.q || ""), 20)),
  }));
}
