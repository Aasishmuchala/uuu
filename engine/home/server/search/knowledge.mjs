// Search source "knowledge": the company documents, through the full-text index.
import { run, storeFor } from "../knowledge/glue.mjs";

export default {
  id: "knowledge",
  label: "Knowledge",
  async search(ctx, q) {
    return run(ctx, () => storeFor(ctx).search(q, 8)).map((r) => ({
      title: r.name, snippet: r.snippet, link: { page: "knowledge", id: r.name },
    }));
  },
};
