// The Brain pages (PLAN-MAC-2 M4, shots B01 to B05): Files with `?tab=brain` and Settings → Brain, on a stub home on
// the V2 seed (as the harness's scenes/plain.mjs starts it). Written here, not in the cook harness: there was no scene
// for these pages.
//   brain on   the brain's switch on (lib/doors.mjs updateDoors, as the server's own tests do), the five files of the
//              brain's test fixture written into this home's own temp state, and the index built by the server's own
//              code through POST /api/brain/index/refresh. The books are the stub bench of the seed.
//   brain off  the switch as a new home has it: off. The brain door is not running here; the stub home has no address
//              for it, so nothing is called.
// Nothing leaves 127.0.0.1; every port is the system's free one (port 0).
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { imp } from "./_lib.mjs";

export const homes = "each";

export async function start({ engine, state }) {
  const I = imp(engine);
  const seeds = await I("test/stubs/seed.mjs");
  const { startOnV2Seed } = await I("home/server/lib/testing-v2.mjs");
  const h = await startOnV2Seed(seeds, { port: 0, log: () => {} });
  try {
    if (states[state]?.brain === "on") {
      const { call } = await I("home/server/lib/testing.mjs");
      const { updateDoors } = await I("home/server/lib/doors.mjs");
      const { FILES } = await I("brain/test/fixture.mjs");
      h.config.minFreeDiskGb = 0;
      const docs = h.config.paths.knowledgeDocs;
      for (const [rel, text] of Object.entries(FILES)) {
        const to = join(docs, rel);
        mkdirSync(dirname(to), { recursive: true });
        writeFileSync(`${to}.tmp`, text);
        renameSync(`${to}.tmp`, to);
      }
      updateDoors(h.config, (s) => { s.brain.on = true; });
      const r = await call(h.url, "POST", "/api/brain/index/refresh", { body: {} });
      if (r.status !== 200 || typeof r.json?.builtAt !== "string") throw new Error(`brain index: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    }
  } catch (e) { await h.close(); throw e; }
  return { base: h.url, stop: () => h.close() };
}

const ACME = encodeURIComponent("customer:Acme Interiors");
export const states = {
  // B01: the Brain tab before a search: what the index holds and the search field.
  "brain-before": { address: "#/files?tab=brain", brain: "on" },
  // B02: a search with results (three passages about refunds).
  "brain-results": { address: "#/files?tab=brain&ask=refunds", brain: "on" },
  // B03: a search where one word is in nothing: one passage (the team file), then the "Not found in the brain:" line,
  // both on the first screen.
  "brain-not-found": { address: "#/files?tab=brain&ask=Priya%20zebra", brain: "on" },
  // B04: the links view of one entity of the index (the customer Acme Interiors: its invoices, deal, contact, files).
  "brain-links": { address: `#/files?tab=brain&ask=Acme%20Interiors&entity=${ACME}`, brain: "on" },
  // B05: Settings → Brain with the switch off.
  "settings-brain-off": { address: "#/settings?s=brain", brain: "off" },
};
