// The Brain page's routes (PLAN-BRAIN T11, B10): what the index holds, a rebuild on request, finding
// passages and walking one entity's links. Everything is answered from the index built by
// `brain/indexer.mjs` (read-only), after `ensureFresh`. A file result links to the store's own listing;
// a record links to the page of its doctype. Nothing a caller typed is SQL or search syntax: the query
// goes to `ask` (which quotes every term) and the entity key is a bound value.
import { ask, entityView, findEntities } from "../../../brain/retrieve.mjs";
import { BASICS } from "../lib/brainfiles.mjs";
import { brainFor, brainToken } from "../brain/store.mjs";
import { indexFor } from "../brain/indexer.mjs";

const REFRESH_GAP_MS = 10 * 1000;
const KEY_MAX = 200;
const PAGE_OF = new Map([
  ["Customer", "books"], ["Sales Invoice", "books"], ["Project", "books"],
  ["CRM Deal", "customers"], ["Contact", "customers"], ["HD Ticket", "support"], ["Employee", "people"],
]);

const lastRefresh = new WeakMap(); // config -> time (ms) of the last refresh

// `books:<Doctype>:<id>` -> { page, id } | null.
function recordLink(source) {
  const m = /^books:([^:]+):(.+)$/s.exec(String(source));
  if (!m) return null;
  const page = PAGE_OF.get(m[1]);
  return page ? { page, id: m[2] } : null;
}

// The link of one result or passage: a listed file -> the files page, a record -> its doctype's page.
function linkOf(row, tokens) {
  if (row.kind === "record" || String(row.source).startsWith("books:")) return recordLink(row.source);
  const token = tokens.get(row.source);
  return token ? { page: "files", id: token } : null;
}

// path -> token of every file the store lists now (a file the store does not list gets no link).
function listedTokens(ctx) {
  const tokens = new Map();
  try { for (const f of brainFor(ctx.config).list()) tokens.set(f.path, brainToken(f.path)); } catch { /* none listed */ }
  return tokens;
}

const withLinks = (rows, tokens) => rows.map((r) => ({ ...r, link: linkOf(r, tokens) }));

export default function register(app) {
  app.get("/api/brain/index", (ctx) => indexFor(ctx.config).ensureFresh(ctx));

  app.post("/api/brain/index/refresh", async (ctx) => {
    const now = Date.now();
    const last = lastRefresh.get(ctx.config);
    if (last !== undefined && now - last < REFRESH_GAP_MS) {
      throw ctx.fail(429, "The brain was refreshed a moment ago.", "Wait a few seconds, then refresh again.", "brain_busy");
    }
    lastRefresh.set(ctx.config, now);
    await indexFor(ctx.config).rebuild(ctx);
    return indexFor(ctx.config).status();
  });

  app.get("/api/brain/find", (ctx) => {
    const q = String(ctx.query.q || "").trim();
    if (q.length < 2) throw ctx.fail(400, "Type at least two letters to search.", "Add a word or two, then search again.", "query_too_short");
    if (q.length > 200) throw ctx.fail(400, "That search is too long.", "Use a few words.", "query_too_long");
    const indexer = indexFor(ctx.config);
    indexer.ensureFresh(ctx);
    const ix = indexer.open();
    if (!ix) return { results: [], links: [], notFound: [], entities: [], builtAt: null };
    try {
      const found = ask(ix.db, q, { basics: BASICS.map((b) => b.file) });
      return {
        results: withLinks(found.results, listedTokens(ctx)),
        links: found.links,
        notFound: found.notFound,
        entities: findEntities(ix.db, q),
        builtAt: ix.builtAt ?? null,
      };
    } finally {
      try { ix.db.close(); } catch { /* closed */ }
    }
  });

  app.get("/api/brain/links/:key", (ctx) => {
    const missing = () => ctx.fail(404, "That is not in the brain's index.", "Search again from the Brain page.", "entity_not_found");
    const raw = String(ctx.params.key || "");
    if (!raw || raw.length > KEY_MAX * 2 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw missing();
    const key = Buffer.from(raw, "base64url").toString("utf8");
    if (!key || key.length > KEY_MAX || key.includes("\u0000")) throw missing();
    const indexer = indexFor(ctx.config);
    indexer.ensureFresh(ctx);
    const ix = indexer.open();
    if (!ix) throw missing();
    try {
      const view = entityView(ix.db, key);
      if (!view) throw missing();
      return { ...view, passages: withLinks(view.passages, listedTokens(ctx)) };
    } finally {
      try { ix.db.close(); } catch { /* closed */ }
    }
  });
}
