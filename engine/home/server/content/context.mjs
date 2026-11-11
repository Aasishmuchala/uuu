// The content store for a request, built from the config's paths.
import { createStore } from "./store.mjs";

export function storeOf(ctx) {
  return createStore({ root: ctx.config.paths.projectFolder, draftsDir: ctx.config.paths.contentDrafts });
}
