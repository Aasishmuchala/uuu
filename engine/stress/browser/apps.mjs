// The apps' own pages (PLAN-STRESS T3). Only when the doors sweep (T5) has not said that apps cannot start inside a
// fence in the stage: a stage with apps: true (each app's port moved to base+71..), each app switched on through the
// home as the owner would, and only if the app's host then says it runs (inside its fence: appsSpawn "fenced"; an
// app's program is never started any other way), its page opened with the same load record and controls pass.
// Otherwise one line goes to OUT/pass-<n>/not-covered.txt and the sweep moves on.
//   appsPart({ ctx, notes, tally, quickCell, browserOpts, log }) -> { covered, apps: [...] }
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { call, ownerPost } from "../lib/http.mjs";
import { pressAll } from "./controls.mjs";
import { loadAndJudge } from "./loads.mjs";
import { openTab, sleep } from "./recorder.mjs";

const T5_LINE = /^apps:.*not started/m;

function notCovered(ctx, line) {
  const file = join(ctx.passDir, "not-covered.txt");
  const have = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (!have.includes(line)) appendFileSync(file, `${line}\n`);
}

export async function appsPart({ ctx, notes, tally, log }) {
  const file = join(ctx.passDir, "not-covered.txt");
  const said = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (T5_LINE.test(said)) {
    notCovered(ctx, "browser: the apps' own pages were not opened (the doors sweep found apps cannot start inside a fence in the stage)");
    return { covered: false, apps: [], why: "T5" };
  }
  const stage = await ctx.startStage({ dataset: "normal", apps: true, appsSpawn: "fenced" });
  const out = { covered: false, apps: [] };
  try {
    const list = await call(`${stage.urls.home}/api/apps`, { timeoutMs: 15000 }).then((r) => (r.json && r.json.apps) || []).catch(() => []);
    const browser = await ctx.openBrowser();
    const tab = await openTab(browser, { stage, width: 1280, height: 900 });
    const cell = { dataset: "normal", theme: "light", width: 1280 };
    for (const a of list) {
      const row = { slug: a.slug, on: false, answer: null };
      out.apps.push(row);
      const r = await ownerPost(stage, `/api/apps/${encodeURIComponent(a.slug)}/switch`, { on: true }).catch((e) => ({ status: 0, text: String(e.message || e) }));
      row.answer = r.status;
      if (r.status !== 200) { row.why = (r.json && r.json.error && r.json.error.message) || r.text.slice(0, 200); continue; }
      for (let i = 0; i < 90 && !row.on; i += 1) {
        await sleep(500);
        const now = await call(`${stage.urls.home}/api/apps`, { timeoutMs: 10000 }).catch(() => null);
        const app = now && now.json && (now.json.apps || []).find((x) => x.slug === a.slug);
        if (app && app.state === "on") row.on = true;
        if (app && app.state === "failed") { row.why = app.sentence; break; }
      }
      if (!row.on) { row.why = row.why || "not on within 45 s"; continue; }
      const page = { key: `app-${a.slug}`, route: "app", hash: `#/apps/${encodeURIComponent(a.slug)}`, expect: "page", open: null };
      await loadAndJudge({ tab, stage, page, cell, notes, tally, theme: "light", loadsFile: join(ctx.passDir, "browser", "loads.jsonl"), phase: "apps" });
      await pressAll({ ctx, tab, stage, page, notes, tally, shellDone: new Set(), quick: ctx.quick, cell });
      await ownerPost(stage, `/api/apps/${encodeURIComponent(a.slug)}/switch`, { on: false }).catch(() => {});
      out.covered = true;
    }
    await tab.close().catch(() => {});
    await browser.close().catch(() => {});
    if (!out.covered) {
      notCovered(ctx, `browser: the apps' own pages were not opened (no app came on inside its fence in the stage: ${out.apps.map((x) => `${x.slug} ${x.answer} ${String(x.why || "").slice(0, 80)}`).join("; ")})`);
    }
  } finally {
    await stage.close();
  }
  log(`apps: ${JSON.stringify(out.apps)}`);
  return out;
}
