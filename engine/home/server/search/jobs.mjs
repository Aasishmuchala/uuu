// Search source "jobs" (CONTRACTS-V3 33.4): the jobs of the catalogue whose title and summary together contain
// every word of the search. Read from the repo's job files only; the board is not asked.
import { snippet } from "../lib/format.mjs";
import { jobRef, loadCatalogue } from "../lib/jobs.mjs";

export default {
  id: "jobs",
  label: "Jobs",
  async search(ctx, q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out = [];
    for (const job of loadCatalogue(ctx.config).jobs.values()) {
      const hay = `${job.title}\n${job.summary}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      out.push({ title: job.title, snippet: snippet(job.summary, words), link: { page: "jobs", id: jobRef(job) } });
      if (out.length >= 8) break;
    }
    return out;
  },
};
