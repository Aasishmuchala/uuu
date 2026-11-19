// Many at once (PLAN-STRESS T4): each GET 200 times at 20 at once (p50, p95, max); each state-changing POST 20 times
// at once with the same body, then the state folder's JSON files all parse and no temp file is left; and the races
// with a different body per key, where no update may be lost.
//
// How the home writes (engine/home/server/lib/decisions.mjs and the stores like it): the whole file is written to a
// temp file named `<file>.<pid>.tmp` and renamed over the old one, from a copy kept in memory or read just before.
// A lost update needs a read, an await, and a write: the races below aim at the stores that read, wait, and write
// (setup skips and settings in decisions.json, the generation door's file, brain files and knowledge documents in
// their folders, an agent's lessons file, the inbox's hidden items, the brand kit's version check).
import { loadavg } from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SKIP } from "./bodies.mjs";
import { judge, keyOf } from "./checks.mjs";
import { percentile, pool, short, stateHealth } from "./common.mjs";
import { fill } from "./table.mjs";

const P95_TARGET_MS = 150;
const fileOf = (r) => [`engine/home/server/${r.file}`];

// GET load. -> { p50, p95, max } per route in env.p95ByRoute.
export async function getLoad(env, r, { times = 200, at = 20 } = {}) {
  const key = keyOf(r);
  const path = env.paths.get(key) || fill(r.pattern, env.ids);
  const load = loadavg()[0];
  const ms = [];
  let bad = 0;
  await pool(at, Array.from({ length: times }), async () => {
    const res = await env.hit(env.port, "GET", path, { route: `load ${key}` });
    env.check();
    if (res.status && res.status < 500 && !res.error) ms.push(res.ms);
    else if (bad++ === 0) judge(env, r, res, "load-get", key, `GET ${path} at ${at} at once`);
  });
  const p50 = percentile(ms, 50);
  const p95 = percentile(ms, 95);
  const max = ms.length ? Math.max(...ms) : null;
  const noisy = load > 4;
  env.p95ByRoute[key] = { p50, p95, max, n: ms.length, failed: bad, noisy, load: Number(load.toFixed(2)) };
  if (!noisy && env.dataset === "normal" && p95 !== null && p95 > P95_TARGET_MS) {
    env.issue("medium", "load-p95", key, { title: `${key}: p95 ${p95} ms at ${at} at once (target ${P95_TARGET_MS} ms)`, expected: `p95 <= ${P95_TARGET_MS} ms on normal`, actual: `p50 ${p50} p95 ${p95} max ${max} over ${ms.length}`, files: fileOf(r) });
  }
}

// One state-changing POST 20 times at once with the same body.
export async function postBurst(env, r, { at = 20 } = {}) {
  const key = keyOf(r);
  if (r.method === "GET" || SKIP[key]) return;
  const path = env.paths.get(key) || fill(r.pattern, env.ids);
  const valid = env.valid.get(key);
  const body = valid === null || valid === undefined ? "" : valid;
  const res = await Promise.all(Array.from({ length: at }, () => env.hit(env.port, r.method, path, { body, route: `burst ${key}` })));
  env.check(at);
  for (const x of res) if (!judge(env, r, x, "load-burst", key, `${at} at once, the same body`)) break;
  await afterBurst(env, key, fileOf(r));
}

async function afterBurst(env, what, files) {
  // Writes settle; then every JSON file parses and no temp file older than 5 s is left behind.
  await new Promise((r) => setTimeout(r, 300));
  const h = stateHealth(env.st.state);
  env.check();
  if (h.badJson.length) env.issue("high", "load-state-json", what, { title: `a state file does not parse after ${what} at once`, expected: "every JSON file parses", actual: h.badJson.slice(0, 10).join(", "), files });
  if (h.oldTmp.length) env.issue("medium", "load-state-tmp", what, { title: `temp files were left after ${what} at once`, expected: "no *.tmp older than 5 s", actual: h.oldTmp.slice(0, 10).join(", "), files });
}

function readDecisions(env) {
  try { return JSON.parse(readFileSync(join(env.st.state, "home", "decisions.json"), "utf8")); } catch { return null; }
}

// The races with a different body per key. Each: { name, files, run(env) -> { sent, ok, lost: [..], note } }.
const RACES = [
  {
    name: "setup skips", files: ["engine/home/server/routes/setup.mjs", "engine/home/server/lib/decisions.mjs"],
    async run(env) {
      const steps = ["basics", "brand", "books"];
      const res = await Promise.all(steps.map((step) => env.hit(env.port, "POST", "/api/setup/skip", { body: { step, skip: true } })));
      const d = readDecisions(env);
      const kept = d && d["setup:skipped"] ? d["setup:skipped"] : {};
      return { res, lost: steps.filter((s) => kept[s] !== true) };
    },
  },
  {
    name: "settings", files: ["engine/home/server/routes/settings.mjs", "engine/home/server/lib/decisions.mjs"],
    async run(env) {
      const g = await env.hit(env.port, "GET", "/api/settings");
      const accent = (g.json?.accents || []).map((a) => a.id).find((id) => id !== g.json?.appearance?.accent);
      const want = { theme: g.json?.appearance?.theme === "dark" ? "light" : "dark", backdrop: g.json?.appearance?.backdrop === "plain" ? "stars" : "plain", motion: g.json?.appearance?.motion === "off" ? "on" : "off" };
      if (accent) want.accent = accent;
      const res = await Promise.all(Object.entries(want).map(([k, v]) => env.hit(env.port, "POST", "/api/settings", { body: { [k]: v } })));
      const after = await env.hit(env.port, "GET", "/api/settings");
      const a = after.json?.appearance || {};
      return { res, lost: Object.entries(want).filter(([k, v]) => a[k] !== v).map(([k, v]) => `${k}=${v} (kept ${a[k]})`) };
    },
  },
  {
    name: "brain files", files: ["engine/home/server/routes/brain.mjs", "engine/home/server/brain/store.mjs"],
    async run(env) {
      const names = Array.from({ length: 20 }, (_, i) => `race-${env.tag}-${i}.md`);
      const res = await Promise.all(names.map((name, i) => env.hit(env.port, "POST", "/api/brain/files", { body: { folder: "brand", name, base64: Buffer.from(`Race file ${i}.\n`).toString("base64") } })));
      const l = await env.hit(env.port, "GET", "/api/brain/folder/brand");
      const have = new Set((l.json?.files || []).map((f) => f.name));
      return { res, lost: names.filter((n, i) => res[i].status >= 200 && res[i].status < 300 && !have.has(n)) };
    },
  },
  {
    name: "knowledge documents", files: ["engine/home/server/routes/knowledge.mjs", "engine/home/server/knowledge/store.mjs"],
    async run(env) {
      const names = Array.from({ length: 20 }, (_, i) => `race-${env.tag}-${i}.md`);
      const res = await Promise.all(names.map((name, i) => env.hit(env.port, "POST", "/api/knowledge", { body: { name, text: `Race document ${i}.` } })));
      const l = await env.hit(env.port, "GET", "/api/knowledge");
      const have = new Set((l.json?.docs || []).map((d) => d.name));
      return { res, lost: names.filter((n, i) => res[i].status >= 200 && res[i].status < 300 && !have.has(n)) };
    },
  },
  {
    name: "lessons", files: ["engine/home/server/routes/team-lessons.mjs"],
    async run(env) {
      const slug = env.ids.slugs[0] || "chief-of-staff";
      const texts = Array.from({ length: 20 }, (_, i) => `Race lesson ${env.tag} number ${i}.`);
      const res = await Promise.all(texts.map((text) => env.hit(env.port, "POST", `/api/team/${slug}/lessons`, { body: { text } })));
      const l = await env.hit(env.port, "GET", `/api/team/${slug}`);
      return { res, lost: texts.filter((t, i) => res[i].status >= 200 && res[i].status < 300 && !l.text.includes(t)) };
    },
  },
  {
    name: "door switches and limits", files: ["engine/home/server/routes/generation.mjs", "engine/home/server/routes/brain-door.mjs", "engine/home/server/lib/doors.mjs"],
    async run(env) {
      const g0 = await env.hit(env.port, "GET", "/api/generation");
      const daily = (g0.json?.caps?.daily || 300) === 400 ? 450 : 400;
      const monthly = (g0.json?.caps?.monthly || 1000) === 1500 ? 1600 : 1500;
      const res = await Promise.all([
        env.hit(env.port, "POST", "/api/generation/switch", { body: { on: true } }),
        env.hit(env.port, "POST", "/api/brain-door/switch", { body: { on: true } }),
        env.hit(env.port, "POST", "/api/generation/caps", { body: { daily } }),
        env.hit(env.port, "POST", "/api/generation/caps", { body: { monthly } }),
      ]);
      const g = await env.hit(env.port, "GET", "/api/generation");
      const b = await env.hit(env.port, "GET", "/api/brain-door");
      const lost = [];
      if (res[0].status === 200 && g.json?.on !== true) lost.push("generation on");
      if (res[1].status === 200 && b.json?.on !== true) lost.push("brain door on");
      if (res[2].status === 200 && g.json?.caps?.daily !== daily) lost.push(`daily ${daily} (kept ${g.json?.caps?.daily})`);
      if (res[3].status === 200 && g.json?.caps?.monthly !== monthly) lost.push(`monthly ${monthly} (kept ${g.json?.caps?.monthly})`);
      // Back off, so the rest of the sweep sees the doors as the seed had them.
      await env.hit(env.port, "POST", "/api/generation/switch", { body: { on: false } });
      await env.hit(env.port, "POST", "/api/brain-door/switch", { body: { on: false } });
      return { res, lost };
    },
  },
  {
    name: "inbox hides", files: ["engine/home/server/routes/inbox.mjs", "engine/home/server/lib/inbox.mjs", "engine/home/server/lib/decisions.mjs"],
    async run(env) {
      const l = await env.hit(env.port, "GET", "/api/inbox");
      const items = (l.json?.items || []).filter((i) => (i.actions || []).some((a) => a.id === "dismiss" && !a.needsNote)).slice(0, 8);
      if (!items.length) return { res: [], lost: [], note: "no item the seed lets be hidden" };
      const res = await Promise.all(items.map((i) => env.hit(env.port, "POST", "/api/inbox/act", { body: i.version === undefined ? { id: i.id, action: "dismiss" } : { id: i.id, action: "dismiss", version: i.version } })));
      const after = await env.hit(env.port, "GET", "/api/inbox");
      const still = new Set((after.json?.items || []).map((i) => i.id));
      return { res, lost: items.filter((it, i) => res[i].status >= 200 && res[i].status < 300 && still.has(it.id)).map((i) => i.id) };
    },
  },
  {
    name: "brand kit versions", files: ["engine/home/server/routes/brand-kit.mjs"],
    async run(env) {
      const g = await env.hit(env.port, "GET", "/api/brand/kit");
      const kit = g.json?.kit;
      const version = g.json?.version;
      if (!kit || typeof kit !== "object") return { res: [], lost: [], note: "no brand kit to read" };
      const field = Object.keys(kit).find((k) => typeof kit[k] === "string");
      if (!field) return { res: [], lost: [], note: "no text field in the brand kit" };
      const res = await Promise.all(Array.from({ length: 20 }, (_, i) => env.hit(env.port, "POST", "/api/brand/kit", { body: { kit: { ...kit, [field]: `${String(kit[field]).slice(0, 40)} ${i}` }, version } })));
      const wins = res.filter((x) => x.status >= 200 && x.status < 300).length;
      const lost = [];
      if (wins > 1) lost.push(`${wins} writes with the same version were all taken (one should win, the rest 409)`);
      if (wins === 0) return { res, lost, note: `none taken (${short(res[0])})` };
      return { res, lost };
    },
  },
];

export async function races(env) {
  for (const race of RACES) {
    if (env.onlyRace && env.onlyRace !== race.name) continue;
    let out;
    try {
      out = await race.run(env);
    } catch (e) {
      env.log(`race ${race.name}: could not run: ${e.message}`);
      env.notCovered.push(`race ${race.name}: ${e.message}`);
      continue;
    }
    env.check(Math.max(1, out.res.length));
    for (const x of out.res) {
      if (x.hang || x.error || x.status >= 500 || x.stack) {
        env.issue("high", "race-answer", `race ${race.name}`, { title: `${race.name} at once: ${short(x)}`, expected: "no 5xx, no hang", actual: short(x), files: race.files });
        break;
      }
    }
    if (out.note) { env.log(`race ${race.name}: ${out.note}`); env.notCovered.push(`race ${race.name}: ${out.note}`); }
    if (out.lost.length) {
      env.issue("high", "race-lost", `race ${race.name}`, { title: `${race.name} at once: ${out.lost.length} updates lost`, expected: "every update that was answered 2xx is kept", actual: out.lost.slice(0, 10).join(", "), files: race.files });
    }
    await afterBurst(env, `race ${race.name}`, race.files);
  }
}

export const RACE_NAMES = RACES.map((r) => r.name);
