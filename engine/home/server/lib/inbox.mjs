// The inbox merge (CONTRACTS 9.3): every inbox source is asked at once; a source that fails or is
// not connected adds a `notConnected` entry and never fails the whole list.
// Versions (CONTRACTS 9.3a): an item may carry `version`, a short string a source computes from what it
// reads. An action re-reads every source (with `ctx.acting` set, so no source answers from a cache) and is
// refused when the item has a version and the browser did not send that same version back: the owner
// acts only on what the owner saw. No source keeps any memory of what was shown.
import { createHash } from "node:crypto";
import { HomeError } from "./errors.mjs";

// A version from the texts an item shows: the first 16 hex characters of a SHA-256 over them.
export function versionOf(...parts) {
  const h = createHash("sha256");
  for (const p of parts) h.update(String(p ?? "")).update("\u0000");
  return h.digest("hex").slice(0, 16);
}

function plainReason(e) {
  if (e instanceof HomeError) return e.message;
  return "This part could not be read just now.";
}

export async function mergeInbox(ctx, sources) {
  const items = [];
  const notConnected = [];
  const owners = new Map();
  await Promise.all(sources.map(async (src) => {
    try {
      const out = (await src.list(ctx)) || {};
      for (const item of Array.isArray(out.items) ? out.items : []) {
        if (!item || typeof item.id !== "string" || owners.has(item.id)) continue;
        owners.set(item.id, src);
        items.push(item);
      }
      if (out.notConnected) notConnected.push({ source: out.notConnected.source || src.id, reason: out.notConnected.reason });
    } catch (e) {
      if (!(e instanceof HomeError)) ctx.log(`inbox source ${src.id} failed: ${String(e?.message || e).split("\n")[0]}`);
      notConnected.push({ source: src.id, reason: plainReason(e) });
    }
  }));
  const t = (i) => Date.parse(i.when) || 0;
  items.sort((a, b) => ((b.severity === "high") - (a.severity === "high")) || (t(b) - t(a)));
  const bySource = {};
  for (const i of items) bySource[i.source] = (bySource[i.source] || 0) + 1;
  notConnected.sort((a, b) => String(a.source).localeCompare(String(b.source)));
  return { items, counts: { total: items.length, bySource }, notConnected, owners };
}

export function createActor(sources) {
  const handled = new Map(); // item id -> time, so a second click says "already handled"

  return async function act(ctx, { id, action, note, version }) {
    if (typeof id !== "string" || !id || typeof action !== "string" || !action) {
      throw new HomeError(400, "The home screen did not say which item and which action.", "Refresh the page and try again.", "bad_request");
    }
    if (note !== undefined && note !== null && typeof note !== "string") {
      throw new HomeError(400, "The note must be text.", "Write the note again and send it.", "bad_request");
    }
    if (version !== undefined && version !== null && typeof version !== "string") {
      throw new HomeError(400, "The home screen sent a version it should not have.", "Refresh the page and try again.", "bad_request");
    }
    const { items, owners } = await mergeInbox({ ...ctx, acting: true }, sources);
    const item = items.find((i) => i.id === id);
    if (!item) {
      if (handled.has(id)) throw new HomeError(409, "This was already handled.", "Nothing more to do here.", "already_handled");
      throw new HomeError(404, "This item is no longer waiting for you.", "Refresh the inbox.", "not_found");
    }
    const spec = (item.actions || []).find((a) => a.id === action);
    if (!spec) throw new HomeError(400, "That action is not offered for this item.", "Refresh the inbox and pick one of the buttons shown.", "bad_action");
    const text = typeof note === "string" ? note.trim() : "";
    if (spec.needsNote && !text) {
      throw new HomeError(400, "This needs a short note.", "Write what should change, then send it.", "needs_note");
    }
    if (text.length > 4000) throw new HomeError(400, "The note is too long.", "Keep it under 4000 characters.", "note_too_long");
    if (typeof item.version === "string" && item.version && version !== item.version) {
      throw new HomeError(409, "This changed after you looked at it. Nothing was done.", "Look at it again, then decide.", "changed_since_seen");
    }
    const out = await owners.get(id).act({ ...ctx, acting: true, item }, id, action, text || null);
    handled.set(id, Date.now());
    if (handled.size > 500) handled.delete(handled.keys().next().value);
    return { ok: true, message: out?.message || "Done." };
  };
}
