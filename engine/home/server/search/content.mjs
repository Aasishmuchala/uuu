// Search source "marketing": content drafts, by title and text.
import { storeOf } from "../content/context.mjs";
import { snippet } from "../lib/format.mjs";

async function search(ctx, q) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return storeOf(ctx).sync().drafts
    .filter((d) => { const hay = `${d.title}\n${d.body}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
    .slice(0, 8)
    .map((d) => ({ title: d.title, snippet: snippet(d.body, words), link: { page: "marketing", id: d.id } }));
}

export default { id: "marketing", label: "Marketing", search };
