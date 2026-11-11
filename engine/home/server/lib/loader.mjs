// How to add a feature to the home server (CONTRACTS 9.1). Drop one file in one of three folders
// under engine/home/server/; it is found at start. Never edit the core to add a feature.
//
//   routes/<name>.mjs   export default function register(app) {
//                         app.get("/api/departments/books", async (ctx) => ({ ... }));   // 200 + JSON
//                         app.post("/api/thing/:id", async (ctx) => ({ status: 201, body: {...} }));
//                         app.delete(...)                                                  // :name segments
//                         app.post("/api/upload", handler, { maxBody: 8 * 1024 * 1024 })   // own body limit
//                       `maxBody` (post and delete only) is whole bytes from 1 to 16 MB; the default is 2 MB.
//                       Any other value fails the module's registration.
//                       }
//                       A handler throws `ctx.fail(status, message, next, code)` for a plain error.
//   inbox/<name>.mjs    export default { id: "bench",
//                         async list(ctx) { return { items: [InboxItem], notConnected?: { source, reason } }; },
//                         async act(ctx, itemId, action, note) { return { message: "Plain sentence." }; } }
//                       `itemId` is the full item id ("bench:Sales Invoice:X"). The core calls `act` only on
//                       the source that listed the item, only with an action the item offers, and only with a
//                       note when that action has `needsNote`; `ctx.item` is the item as listed.
//                       A thrown error in `list` becomes a `notConnected` entry; it never fails the inbox.
//   search/<name>.mjs   export default { id: "books", label: "Books",
//                         async search(ctx, q) { return [ { title, snippet, link: { page, id } } ]  // at most 8 kept
//                                                    or { notSearched: "plain reason" }; } }
//
// ctx = { params, query, body, config, board, bench, decisions, ids, log, fail } (see lib/app.mjs).
// `board.companyId()` is async. Files are loaded in name order; a file that fails to load or register is
// skipped, logged and listed on GET /api/health under `modulesFailed`. Tests add a folder with `moduleDirs`.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const KINDS = ["routes", "inbox", "search"];

function listModules(dir) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".mjs") && !f.startsWith(".")).sort();
  } catch {
    return [];
  }
}

function firstLineOf(e) {
  return String(e?.message || e).split("\n")[0].slice(0, 300);
}

// router: { add(method, pattern, handler, owner, options), removeOwner(owner) }
export async function loadModules({ dirs, router, log }) {
  const inbox = [];
  const search = [];
  const failed = [];
  for (const base of dirs) {
    for (const kind of KINDS) {
      for (const file of listModules(join(base, kind))) {
        const label = `${kind}/${file}`;
        const full = join(base, kind, file);
        try {
          const mod = (await import(pathToFileURL(full).href)).default;
          if (kind === "routes") {
            if (typeof mod !== "function") throw new Error("default export is not a register(app) function");
            const owner = full;
            const app = {
              get: (p, h) => router.add("GET", p, h, owner),
              post: (p, h, opts) => router.add("POST", p, h, owner, opts),
              delete: (p, h, opts) => router.add("DELETE", p, h, owner, opts),
            };
            try {
              await mod(app);
            } catch (e) {
              router.removeOwner(owner);
              throw e;
            }
          } else if (kind === "inbox") {
            if (!mod || typeof mod.id !== "string" || typeof mod.list !== "function" || typeof mod.act !== "function") {
              throw new Error("default export needs id, list(ctx) and act(ctx, itemId, action, note)");
            }
            if (inbox.some((m) => m.id === mod.id)) throw new Error(`an inbox source named ${mod.id} is already loaded`);
            inbox.push(mod);
          } else {
            if (!mod || typeof mod.id !== "string" || typeof mod.label !== "string" || typeof mod.search !== "function") {
              throw new Error("default export needs id, label and search(ctx, q)");
            }
            if (search.some((m) => m.id === mod.id)) throw new Error(`a search source named ${mod.id} is already loaded`);
            search.push(mod);
          }
        } catch (e) {
          failed.push({ file: label, error: firstLineOf(e) });
          log(`module ${label} skipped: ${firstLineOf(e)}`);
        }
      }
    }
  }
  return { inbox, search, failed };
}
