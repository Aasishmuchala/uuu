// Shared by routes/knowledge.mjs and search/knowledge.mjs.
import { createKnowledge, KnowledgeError } from "./store.mjs";

const stores = new Map();
export function storeFor(ctx) {
  const key = ctx.config.paths.knowledgeDocs;
  if (!stores.has(key)) stores.set(key, createKnowledge(ctx.config));
  return stores.get(key);
}

// Turns a store error into the plain-sentence error the core sends; anything else becomes a 500 there.
export function run(ctx, fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof KnowledgeError) throw ctx.fail(e.status, e.message, e.next, e.code);
    ctx.log(`knowledge: ${String(e?.message || e).split("\n")[0]}`);
    throw ctx.fail(500, "The knowledge folder could not be read just now.", "Try again in a moment.", "knowledge_unavailable");
  }
}
