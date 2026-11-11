// Search source "gallery": ready-made goals whose title, summary and text contain every word of the search.
import { snippet } from "../lib/format.mjs";
import { loadGallery } from "../routes/gallery.mjs";

export default {
  id: "gallery",
  label: "Ready-made goals",
  async search(ctx, q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let gallery;
    try { gallery = loadGallery(ctx); } catch { return { notSearched: "The ready-made goals could not be read just now." }; }
    const out = [];
    for (const d of gallery.departments) {
      for (const g of d.goals) {
        const hay = `${g.title}\n${g.summary}\n${g.text}`.toLowerCase();
        if (words.every((w) => hay.includes(w))) out.push({ title: g.title, snippet: snippet(`${g.summary} ${g.text}`, words), link: { page: "gallery", id: g.id } });
      }
    }
    return out.slice(0, 8);
  },
};
