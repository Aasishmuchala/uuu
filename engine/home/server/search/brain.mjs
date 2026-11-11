// Search source "brain": the company brain's files (CONTRACTS-V3 32.2), through its own index.
// Text and tables by their words; pictures and PDF files by their names only.
import { brainFor, brainRun } from "../brain/store.mjs";

export default {
  id: "brain",
  label: "Files",
  async search(ctx, q) {
    return brainRun(ctx, () => brainFor(ctx.config).search(q, 8)).map((r) => ({
      title: r.name, snippet: r.snippet, link: { page: "files", id: r.token },
    }));
  },
};
