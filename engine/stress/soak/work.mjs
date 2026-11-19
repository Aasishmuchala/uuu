// The soak's steady door work (PLAN-STRESS T6), shared with the recovery sweep: one fake generation job, one web
// door fetch, one brain door ask, one relay answer and one gate call, each as its caller would make it, on the
// stage's fakes only. Tokens are minted with the STAGE's made-up secrets (never a live one). Built-in modules only.
//   prepareDoors(stage)  switches the three doors on in the stage's switches file, with limits a 60-minute soak
//                        stays under, and writes one approved batch for the Artist
//   doorCalls(stage)     -> { generate(), web(), brain(), relay(), gate() }, each -> { part, ok, status, ms, code, note };
//                        and for the recovery's work in the middle of a kill: submitJob(), jobState(id), fetchPage(url),
//                        siteCheck(), relayStream()
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { call, ownerPost } from "../lib/http.mjs";

const SHOTS = 90; // 90 shots of 5 takes: 450 jobs, more than one every 15 s for 60 minutes (240)
export const BATCH_ID = "bstresssoak0000000001";
const RESEARCHER = "a0000000-0000-4000-8000-0000000000aa";
const BOARD_TOKEN = "stub-builder-token"; // the stub board's seeded agent key (engine/test/stubs/board.mjs)
const FOLLOW_MS = 120_000;
const ENDED = new Set(["done", "failed", "cancelled"]);
const ASKER = "chief-of-staff";
const MODEL = "claude-sonnet-4-5";

function put(path, data) {
  rmSync(path, { force: true });
  writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

// The staged config's paths (loaded by the copy's own loader, as the parts load it).
export async function stagedPaths(stage) {
  const { loadConfig } = await import(pathToFileURL(join(stage.engineDir, "lib", "config.mjs")).href);
  return loadConfig({ path: join(stage.engineDir, "config.json") });
}

export async function prepareDoors(stage, { viewer = false } = {}) {
  const cfg = await stagedPaths(stage);
  const p = cfg.paths;
  const now = Date.now();
  mkdirSync(p.doors, { recursive: true, mode: 0o700 });
  mkdirSync(p.batches, { recursive: true, mode: 0o700 });
  chmodSync(p.batches, 0o700);
  const was = readJson(p.doorsState) || {};
  put(p.doorsState, {
    ...was,
    version: 1,
    web: { on: true, allow: [], block: [], watchHosts: [], search: "keyless", perHour: 100000, perDay: 1000000 },
    generate: {
      on: true, dailyCredits: 1000000, monthlyCredits: 10000000, autoUnderCredits: 0, paused: null,
      models: { video: "gen4_turbo", videoBest: "gen4.5", still: "gen4_image", upscale: "magnific_precision_upscaler_v2" },
      runwayAccount: { centsPerCredit: 3 },
    },
    viewer: { on: viewer === true },
    brain: { on: true },
    changedAt: new Date(now).toISOString(),
  });
  // The Researcher is not on the seed's ids (the web door's caller); the relay needs a pick for the asker. Both are
  // written the way the engine writes them, in the stage only.
  const ids = readJson(p.ids);
  if (ids && ids.agents && !ids.agents.researcher) {
    ids.agents.researcher = RESEARCHER;
    put(p.ids, ids);
  }
  mkdirSync(p.models, { recursive: true, mode: 0o700 });
  const models = readJson(p.modelsState) || { mode: "plans" };
  put(p.modelsState, { ...models, mode: models.mode || "plans", picks: { ...(models.picks || {}), [ASKER]: { model: MODEL } } });
  // The brain door answers only from an index; the home builds it as the owner's refresh does.
  try { await ownerPost(stage, "/api/brain/index/refresh", {}, { timeoutMs: 60000 }); } catch { /* the ask then says so */ }
  const shots = {};
  for (let i = 1; i <= SHOTS; i += 1) shots[`s${String(i).padStart(3, "0")}`] = { kind: "text_to_video", model: "gen4.5", maxSeconds: 5, takes: 5 };
  put(join(p.batches, `${BATCH_ID}.json`), {
    id: BATCH_ID, task: "stress-soak", slug: "artist", approvedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 6 * 86400_000).toISOString(), budgetCredits: 10000000, textToVideo: true, shots,
  });
  return cfg;
}

export async function doorCalls(stage) {
  const cfg = await stagedPaths(stage);
  const p = cfg.paths;
  const { mintToken } = await import(pathToFileURL(join(stage.engineDir, "relay", "token.mjs")).href);
  const ids = readJson(p.ids) || {};
  const agentId = (slug) => (ids.agents || {})[slug];
  const secret = (file) => { try { return readFileSync(file, "utf8").trim(); } catch { return null; } };
  const exp = () => Math.floor(Date.now() / 1000) + 600;
  const bearer = (file, kind, subject) => {
    const s = secret(file);
    return s ? { authorization: `Bearer ${mintToken(s, kind, subject, exp())}` } : {};
  };
  const json = { "content-type": "application/json" };
  let take = 0;
  const followed = []; // { job, sentAt, endedMs, state, credits, status, done }

  async function timed(part, fn) {
    const t0 = Date.now();
    try {
      const r = await fn();
      return { part, ms: Date.now() - t0, ...r };
    } catch (e) {
      return { part, ok: false, status: 0, ms: Date.now() - t0, code: e.code || "error", note: String(e.message || e).slice(0, 200), hang: !!e.hang };
    }
  }
  const codeOf = (r) => (r.json && typeof r.json.code === "string" ? r.json.code : null);

  return {
    followed,
    // One text-to-video job from the Artist on fake Runway, followed until it ends (at most 20 s).
    // One text-to-video job from the Artist on fake Runway. The call answers once the job is sent; the job is then
    // followed in the background (the door asks Runway every 6 s, so a job takes about 25 s) and its end is put on
    // `followed`. The door's own limit of two running jobs a caller ("gen_busy") is its rule, not a failure.
    generate: () => timed("generate", async () => {
      const n = take++;
      const shot = `s${String((Math.floor(n / 5) % SHOTS) + 1).padStart(3, "0")}`;
      const h = { ...json, ...bearer(p.generateSecret, "a", agentId("artist")) };
      const r = await call(`${stage.urls.generate}/gen/jobs`, {
        method: "POST", headers: h, timeoutMs: 20000,
        body: { batch: BATCH_ID, shot, kind: "text_to_video", promptText: "a stair at dawn, stress soak", seconds: 5, ratio: "1280:720" },
      });
      const id = r.json && (r.json.id || r.json.job);
      if (codeOf(r) === "gen_busy") return { ok: true, status: r.status, code: "gen_busy" };
      if (r.status >= 300 || !id) return { ok: false, status: r.status, code: codeOf(r), note: r.text.slice(0, 200) };
      const entry = { job: id, sentAt: Date.now(), endedMs: null, state: null, credits: null, status: null };
      followed.push(entry);
      entry.done = (async () => {
        const end = Date.now() + FOLLOW_MS;
        while (Date.now() < end) {
          let last;
          try {
            last = await call(`${stage.urls.generate}/gen/jobs/${encodeURIComponent(id)}`, { headers: bearer(p.generateSecret, "a", agentId("artist")), timeoutMs: 10000 });
          } catch (e) {
            entry.status = 0; entry.state = e.code || "error";
            await new Promise((res) => setTimeout(res, 2000));
            continue;
          }
          entry.status = last.status;
          entry.state = (last.json && last.json.state) || codeOf(last);
          entry.credits = last.json ? last.json.credits ?? null : null;
          if (last.status !== 200 || ENDED.has(entry.state)) break;
          await new Promise((res) => setTimeout(res, 1000));
        }
        entry.endedMs = ENDED.has(entry.state) ? Date.now() - entry.sentAt : null;
      })();
      return { ok: true, status: r.status, code: null, job: id };
    }),
    // One page from the fake internet through the Researcher's door.
    web: () => timed("web", async () => {
      const r = await call(`${stage.urls.web}/web/fetch`, {
        method: "POST", headers: { ...json, ...bearer(p.webSecret, "a", agentId("researcher") || RESEARCHER) },
        body: { url: "http://site.test/" }, timeoutMs: 20000,
      });
      return { ok: r.status === 200, status: r.status, code: codeOf(r) };
    }),
    // One question to the brain door, as the owner's own Ask (owner asks are not counted against an agent's hour).
    brain: () => timed("brain", async () => {
      const r = await call(`${stage.urls.brain}/brain/ask`, {
        method: "POST", headers: { ...json, ...bearer(p.brainSecret, "t", "owner") }, body: { q: "What do we charge for delivery?" }, timeoutMs: 20000,
      });
      return { ok: r.status === 200, status: r.status, code: codeOf(r) };
    }),
    // One short answer through the relay from the fake provider, as the home's model test asks.
    relay: () => timed("relay", async () => {
      const r = await call(`${stage.urls.relay}/v1/messages`, {
        method: "POST", headers: { ...json, "anthropic-version": "2023-06-01", ...bearer(p.relaySecret, "t", ASKER) },
        body: { model: MODEL, max_tokens: 16, messages: [{ role: "user", content: "Say ok." }] }, timeoutMs: 20000,
      });
      return { ok: r.status === 200, status: r.status, code: codeOf(r) };
    }),
    // One read through the gate to the stub board, as an agent.
    gate: () => timed("gate", async () => {
      const r = await call(`${stage.urls.gate}/api/agents/me`, { headers: { authorization: `Bearer ${BOARD_TOKEN}` }, timeoutMs: 20000 });
      return { ok: r.status > 0 && r.status < 500, status: r.status, code: codeOf(r) };
    }),
    // The recovery's pieces of work, each started and left running so a part can be killed in the middle.
    // One generation job sent, not followed: -> { status, job, code }.
    async submitJob() {
      const n = take++;
      const shot = `s${String((Math.floor(n / 5) % SHOTS) + 1).padStart(3, "0")}`;
      const r = await call(`${stage.urls.generate}/gen/jobs`, {
        method: "POST", headers: { ...json, ...bearer(p.generateSecret, "a", agentId("artist")) }, timeoutMs: 20000,
        body: { batch: BATCH_ID, shot, kind: "text_to_video", promptText: "a stair at dawn, stress recovery", seconds: 5, ratio: "1280:720" },
      });
      return { status: r.status, job: r.json && (r.json.id || r.json.job), code: codeOf(r) };
    },
    // -> the door's answer about a job: { status, state, reason, credits }.
    async jobState(id) {
      const r = await call(`${stage.urls.generate}/gen/jobs/${encodeURIComponent(id)}`, { headers: bearer(p.generateSecret, "a", agentId("artist")), timeoutMs: 10000 });
      return { status: r.status, state: r.json && r.json.state, reason: r.json && r.json.reason, credits: r.json && r.json.credits, code: codeOf(r) };
    },
    // One page through the web door (a drip.test page answers slowly). -> call()'s promise.
    fetchPage(url, timeoutMs = 60000) {
      return call(`${stage.urls.web}/web/fetch`, {
        method: "POST", headers: { ...json, ...bearer(p.webSecret, "a", agentId("researcher") || RESEARCHER) }, body: { url }, timeoutMs,
      });
    },
    // One site check by the page viewer (Chrome opened by the viewer) on a two-line site. -> call()'s promise.
    async siteCheck(timeoutMs = 90000) {
      const { writeTar } = await import(pathToFileURL(join(stage.engineDir, "viewer", "tar.mjs")).href);
      const body = writeTar([{ name: "index.html", data: "<!doctype html><title>Stress site</title><h1>A stress site</h1><p>Plain words.</p>" }]);
      return call(`${stage.urls.viewer}/view/shots`, {
        method: "POST", headers: { "content-type": "application/x-tar", ...bearer(p.viewerSecret, "t", "owner") }, body, timeoutMs,
      });
    },
    // One streamed answer through the relay (slow it with stage.setBehaviour("provider", { eventDelayMs })). -> call()'s promise.
    relayStream(timeoutMs = 60000) {
      return call(`${stage.urls.relay}/v1/messages`, {
        method: "POST", headers: { ...json, "anthropic-version": "2023-06-01", ...bearer(p.relaySecret, "t", ASKER) },
        body: { model: MODEL, max_tokens: 64, stream: true, messages: [{ role: "user", content: "Say ok slowly." }] }, timeoutMs,
      });
    },
  };
}
