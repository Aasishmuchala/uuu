// Arch Film Studio in the real fence, end to end (PLAN-AFS T5): the host's own spawner runs
// `app-exec arch-film-studio --run` in a temp copy of engine/ whose config.json puts the state in
// a temp folder (as host-sandbox.test.mjs does), and the app's built code, copied there with its
// packages cloned, answers on its manifest port 3172. A fake generation door and a fake model
// relay on port 0 check every token the way the real ones do (fixture-app/harness.mjs,
// fakeParts), the door's job bodies by the door's own table (registry.mjs, parseAppJob). What it
// proves, one button at a time: the page and the host's policy; a project and an upload with
// its copies on disk; the analysis through the relay; the door's refusal while the allowance is
// closed, nothing spent; an enhancement, a master by the fake upscale, a storyboard, two clips
// and a film made by ffmpeg inside the fence; the door asked exactly once per button; and the
// fence holding (no network, the owner's home closed). Nothing here writes the live engine's
// state, reaches the internet, or opens a port but the host's own (port 0), the app's (3172) and
// the two fakes' (port 0).
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync,
  symlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCaller, headerValues } from "../../doors/common.mjs";
import { checkToken } from "../../relay/token.mjs";
import { appModels, estimateCents, parseAppJob } from "../../generate/registry.mjs";
import { appExecSpawner, contentPolicy, createAppHost } from "../host.mjs";
import { ownerHome } from "../fence.mjs";
import { loadConfig } from "../../lib/config.mjs";
import { NODE, header, jsonOf, own, send, wait, waitFor } from "./fixture-app/harness.mjs";

const ENGINE = realpathSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const REPO_APP = join(ENGINE, "..", "apps", "arch-film-studio");
const SLUG = "arch-film-studio";
const PORT = 3172;
const SRT = join(ENGINE, "node_modules", ".bin", "srt");
const FFMPEG = "/opt/homebrew/bin/ffmpeg";
const FFPROBE = "/opt/homebrew/bin/ffprobe";
const LIVE_DEPS = join(ownerHome(), ".paperclip", "uuu-engine", "apps", SLUG, "deps");

async function portBusy(p) {
  return new Promise((ok) => {
    const s = net.createServer();
    s.once("error", () => ok(true));
    s.listen(p, "127.0.0.1", () => s.close(() => ok(false)));
  });
}

const missing = [
  [SRT, "the sandbox tool"], [NODE, "Node 24"], [FFMPEG, "ffmpeg"], [FFPROBE, "ffprobe"],
  [join(REPO_APP, ".build", "index.mjs"), "the app's .build/index.mjs (run app-exec arch-film-studio --build)"],
  [join(REPO_APP, "dist", "index.html"), "the app's dist/index.html"],
  [join(LIVE_DEPS, "node_modules"), "the app's packages (~/.paperclip/uuu-engine/apps/arch-film-studio/deps/node_modules)"],
].filter(([p]) => !existsSync(p)).map(([, words]) => words);
const SKIP = missing.length > 0 ? `missing on this Mac: ${missing.join(", ")}`
  : (await portBusy(PORT)) ? `port ${PORT} is busy, so the app cannot be reached on its manifest port` : false;

// What the fake door says when the allowance is closed: the real door's gen_no_allowance sentence.
const NO_ALLOWANCE = "This app may not spend anything right now. The owner can allow it in App Studio.";

let root;
let cfg;
let host;
let lines = [];
let door;
let relay;
let fakeDir;
let dataDir;       // the app's data folder in the temp state
let repoReady;     // the repo's READY as it was before the tests (its bytes, or null when absent)
let projectId;
let image;
const ids = {};

// ---------------------------------------------------------------------------
// The fakes. Each checks its token as the real part does and records every call.

const calls = [];
const doorState = { open: false, budget: 1000, spent: 0, inputs: new Map(), jobs: new Map(), n: 0 };
const jobPosts = () => calls.filter((c) => c.part === "door" && c.method === "POST" && c.url === "/gen/app/jobs");
const OUTPUT_OF = { still_variation: ["image/jpeg", "enhanced.jpg"], still_upscale: ["image/jpeg", "upscaled.jpg"], image_to_video: ["video/mp4", "clip.mp4"] };

function startDoor(secretPath, idsPath, apps) {
  const sendJson = (res, status, value) => {
    const text = JSON.stringify(value);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text), "Cache-Control": "no-store" });
    res.end(text);
  };
  const no = (res, status, code, message) => sendJson(res, status, { error: { message }, code });
  return http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const who = checkCaller({ rawHeaders: req.rawHeaders, secretPath, idsPath, agents: [], apps, now: Date.now() });
      const call = { part: "door", method: req.method, url: req.url, who, bytes: body.length };
      calls.push(call);
      if (typeof who !== "object" || who.kind !== "p" || who.app !== SLUG) return no(res, 401, "gen_no_token", "No token.");
      const url = req.url;
      if (req.method === "GET" && url === "/gen/app/models") {
        return sendJson(res, 200, { models: appModels({}, { runway: true, higgsfield: true }) });
      }
      if (req.method === "GET" && url === "/gen/app/allowance") {
        const s = doorState;
        return sendJson(res, 200, s.open
          ? { open: true, budget: s.budget, spent: s.spent, left: Math.max(0, s.budget - s.spent), expiresAt: "2099-01-01T00:00:00.000Z" }
          : { open: false, budget: 0, spent: 0, left: 0, expiresAt: null });
      }
      if (req.method === "POST" && url === "/gen/app/estimate") {
        const v = JSON.parse(body.toString("utf8"));
        const items = v.items.map((i) => ({ model: i.model, cents: estimateCents(i) }));
        const total = items.some((i) => i.cents === null) ? null : items.reduce((s, i) => s + i.cents, 0);
        return sendJson(res, 200, { items, total });
      }
      if (req.method === "POST" && url === "/gen/app/inputs") {
        const type = headerValues(req.rawHeaders, "content-type")[0];
        if (type !== "image/jpeg" || body.length < 4 || body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff) {
          return no(res, 400, "gen_bad_input", "The door takes a picture: a JPG, PNG or WebP.");
        }
        const input = `in_${(doorState.n += 1)}`;
        doorState.inputs.set(input, body.length);
        call.input = input;
        return sendJson(res, 201, { input, type, bytes: body.length });
      }
      if (req.method === "POST" && url === "/gen/app/jobs") {
        const parsed = parseAppJob(body);
        call.job = parsed.ok ? parsed.job : { refused: parsed.why };
        if (!parsed.ok) return no(res, 400, "gen_bad_request", parsed.why);
        const j = parsed.job;
        if (!j.inputs.every((i) => doorState.inputs.has(i.input))) return no(res, 400, "gen_bad_request", "A picture is not one this app sent in the last day.");
        if (!doorState.open) return no(res, 403, "gen_no_allowance", NO_ALLOWANCE);
        const cents = estimateCents({ kind: j.kind, model: j.model, seconds: j.seconds ?? undefined, resolution: j.resolution ?? undefined, scale: j.scale ?? undefined });
        if (cents === null) return no(res, 403, "gen_no_price", "The door has no price for this model, so nothing is made with it.");
        const running = [...doorState.jobs.values()].filter((x) => x.asked < 2).length;
        if (running >= 2) return no(res, 403, "gen_busy", "Two jobs are already running. Wait for one to finish.");
        doorState.spent += cents;
        const job = `job_${(doorState.n += 1)}`;
        doorState.jobs.set(job, { kind: j.kind, model: j.model, asked: 0 });
        return sendJson(res, 202, { job, cents });
      }
      const m = /^\/gen\/app\/jobs\/([A-Za-z0-9_-]{1,64})(\/output)?$/.exec(url);
      if (req.method === "GET" && m) {
        const j = doorState.jobs.get(m[1]);
        if (!j) return no(res, 404, "gen_not_found", "The door has no such job.");
        const [type, file] = OUTPUT_OF[j.kind];
        const bytes = readFileSync(join(fakeDir, file));
        if (!m[2]) {
          // Asked once while running, then done.
          j.asked += 1;
          if (j.asked < 2) return sendJson(res, 200, { job: m[1], state: "running", progress: 0.5, credits: null, reason: null, output: null });
          return sendJson(res, 200, { job: m[1], state: "done", progress: 1, credits: null, reason: null, output: { type, bytes: bytes.length } });
        }
        if (j.asked < 2) return no(res, 409, "gen_not_ready", "Not ready.");
        res.writeHead(200, { "Content-Type": type, "Content-Length": bytes.length, "Cache-Control": "no-store" });
        return void res.end(bytes);
      }
      return no(res, 404, "gen_not_found", "No such route.");
    });
  });
}

const ANALYSIS = {
  subject: "A stone courtyard house", spaceType: "exterior", composition: "One-point, centred", camera: "Eye level, 24 mm",
  materials: ["limestone", "oak"], lighting: "Soft overcast", landscaping: "Olive trees", notableElements: ["pool"],
  peoplePresent: false, summary: "A limestone courtyard house at dusk.",
};
const shot = (imageCode, videoPrompt, transition) => ({
  imageCode, shotType: "Wide", creativeDirection: "Calm", cameraMovement: "Dolly in", speed: "slow", lighting: "Dusk",
  humanActivity: "none", purpose: "Arrival", videoPrompt, durationSeconds: 2, transition,
});
const STORYBOARD = {
  title: "Light on stone", narrative: "Arrival at dusk.", grade: "Warm", musicDirection: "Soft piano",
  shots: [shot("IMG-001", "Slow dolly-in.", "fade"), shot("IMG-099", "A shot of a picture that is not a master.", "cut"), shot("IMG-001", "Slow pan right.", "cut")],
};

function startRelay(secret) {
  return http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const auth = headerValues(req.rawHeaders, "authorization");
      const token = auth.length === 1 ? auth[0].replace(/^Bearer /, "") : null;
      const who = token ? checkToken(secret, token, Date.now()) : null;
      let body = null;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* recorded as null */ }
      const content = body?.messages?.[0]?.content ?? [];
      calls.push({
        part: "relay", method: req.method, url: req.url, who, model: body?.model ?? null,
        version: headerValues(req.rawHeaders, "anthropic-version")[0] ?? null,
        images: Array.isArray(content) ? content.filter((b) => b?.type === "image").length : 0,
      });
      if (!who) {
        res.writeHead(401, { "Content-Type": "application/json" });
        return void res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "no token" } }));
      }
      const answer = body?.model === "claude-sonnet-5-5" ? ANALYSIS : STORYBOARD;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "message", content: [{ type: "text", text: "```json\n" + JSON.stringify(answer) + "\n```" }], stop_reason: "end_turn" }));
    });
  });
}

// ---------------------------------------------------------------------------
// The browser's side: the page's own requests through the host on 3172.

const ORIGIN = { ...own(PORT), Origin: `http://127.0.0.1:${PORT}` };

async function query(name, input) {
  const path = `/trpc/${name}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`}`;
  const r = await send({ port: PORT, path, headers: own(PORT), timeoutMs: 30000 });
  assert.equal(r.status, 200, `${name}: ${r.status} ${r.body?.toString().slice(0, 300)}`);
  return jsonOf(r).result.data;
}

async function mutate(name, input) {
  const r = await send({ port: PORT, method: "POST", path: `/trpc/${name}`, headers: { ...ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify(input), timeoutMs: 30000 });
  return { status: r.status, json: r.body ? JSON.parse(r.body.toString("utf8") || "null") : null };
}

async function mutateOk(name, input) {
  const r = await mutate(name, input);
  assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.json).slice(0, 400)}`);
  return r.json.result.data;
}

// project.get every second (the page asks every 3 s; advance runs at most once in 3 s) until
// `pick(project)` is truthy.
async function until(pick, what, ms = 90000) {
  let last;
  const got = await waitFor(async () => {
    last = await query("project.get", { id: projectId });
    return pick(last);
  }, ms, 1000);
  assert.ok(got, `${what} did not happen; the project: ${JSON.stringify(last).slice(0, 1500)}\n${lines.slice(-20).join("\n")}`);
  return got;
}

const imageOf = (p) => p.images.find((i) => i.id === image.id);
const dataFile = (key) => join(dataDir, "objects", key);

// ---------------------------------------------------------------------------

before(async () => {
  if (SKIP) return;
  repoReady = existsSync(join(REPO_APP, "READY")) ? readFileSync(join(REPO_APP, "READY")) : null;
  root = realpathSync(mkdtempSync("/private/tmp/uuu-afs-"));
  const eng = join(root, "engine");
  mkdirSync(join(eng, "apps"), { recursive: true });
  mkdirSync(join(eng, "lib"));
  for (const f of ["app-exec", "fence.mjs", "manifest.mjs"]) copyFileSync(join(ENGINE, "apps", f), join(eng, "apps", f));
  chmodSync(join(eng, "apps", "app-exec"), 0o755);
  for (const f of ["config.mjs", "config.py", "config.sh"]) copyFileSync(join(ENGINE, "lib", f), join(eng, "lib", f));
  const raw = JSON.parse(readFileSync(join(ENGINE, "config.json"), "utf8"));
  raw.stateRoot = join(root, "s");
  raw.paperclip.instanceRoot = join(root, "instance");
  raw.doors.generate.apps = [SLUG];
  writeFileSync(join(eng, "config.json"), JSON.stringify(raw));
  symlinkSync(realpathSync(join(ENGINE, "node_modules")), join(eng, "node_modules"));

  // The app: a clone of the repo's folder (source, .build, dist), READY in the copy only, and
  // its packages a clone of the real deps in the temp state, linked as the repo's are.
  const code = join(root, "apps", SLUG);
  mkdirSync(join(root, "apps"));
  const cp = spawnSync("/bin/cp", ["-cR", REPO_APP, code], { encoding: "utf8" });
  assert.equal(cp.status, 0, cp.stderr);
  rmSync(join(code, "node_modules"), { force: true });
  rmSync(join(code, "READY"), { force: true });
  writeFileSync(join(code, "READY"), "test\n");
  const state = join(root, "s", "apps", SLUG);
  mkdirSync(state, { recursive: true, mode: 0o700 });
  const dep = spawnSync("/bin/cp", ["-cR", LIVE_DEPS, join(state, "deps")], { encoding: "utf8" });
  assert.equal(dep.status, 0, dep.stderr);
  symlinkSync(join(state, "deps", "node_modules"), join(code, "node_modules"));
  dataDir = join(state, "data");

  // What the fake door hands back: real pictures and a real clip, made once here.
  fakeDir = join(root, "fake");
  mkdirSync(fakeDir);
  const ff = (args) => {
    const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  };
  ff(["-f", "lavfi", "-i", "color=c=0x8a7f70:s=1600x1000", "-frames:v", "1", join(fakeDir, "render.jpg")]);
  ff(["-f", "lavfi", "-i", "color=c=0x9a8f80:s=1920x1200", "-frames:v", "1", join(fakeDir, "enhanced.jpg")]);
  ff(["-f", "lavfi", "-i", "color=c=0xaa9f90:s=3840x2400", "-frames:v", "1", join(fakeDir, "upscaled.jpg")]);
  ff(["-f", "lavfi", "-i", "testsrc=size=1280x720:rate=24", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(fakeDir, "clip.mp4")]);

  cfg = loadConfig({ path: join(eng, "config.json") });
  // As main() would load it in the temp engine: the apps' folder beside it, its own address on port 0.
  cfg.paths.appsCode = join(root, "apps");
  cfg.ports.apps = 0;
  mkdirSync(join(cfg.paths.state, "secrets", "doors"), { recursive: true, mode: 0o700 });
  mkdirSync(join(cfg.paths.state, "secrets", "provider"), { recursive: true, mode: 0o700 });
  const doorSecret = randomBytes(32).toString("hex");
  const relaySecret = randomBytes(32).toString("hex");
  writeFileSync(cfg.paths.generateSecret, `${doorSecret}\n`, { mode: 0o600 });
  writeFileSync(cfg.paths.relaySecret, `${relaySecret}\n`, { mode: 0o600 });
  door = startDoor(cfg.paths.generateSecret, cfg.paths.ids, cfg.doors.generate.apps);
  relay = startRelay(relaySecret);
  await new Promise((ok) => door.listen(0, "127.0.0.1", ok));
  await new Promise((ok) => relay.listen(0, "127.0.0.1", ok));
  cfg.urls.generate = `http://127.0.0.1:${door.address().port}`;
  cfg.urls.relay = `http://127.0.0.1:${relay.address().port}`;

  host = createAppHost({ cfg, log: (l) => lines.push(l), spawnApp: appExecSpawner(join(eng, "apps", "app-exec")), limits: { everyMs: 300 } });
  await host.listen();
  mkdirSync(cfg.paths.apps, { recursive: true, mode: 0o700 });
  writeFileSync(cfg.paths.appsState, JSON.stringify({ version: 1, apps: { [SLUG]: { on: true } }, changedAt: new Date().toISOString() }), { mode: 0o600 });
  await waitFor(() => host.app(SLUG)?.state === "on", 90000, 200);
});

after(async () => {
  if (host) await host.close();
  for (const s of [door, relay]) {
    if (s) await new Promise((ok) => { s.closeAllConnections(); s.close(() => ok()); });
  }
  if (root) rmSync(root, { recursive: true, force: true });
});

test("the app comes on in the fence and answers /healthz and its page through 3172 with the host's policy", { skip: SKIP }, async () => {
  assert.equal(host.app(SLUG).state, "on", lines.join("\n"));
  const h = await send({ port: PORT, path: "/healthz", headers: own(PORT) });
  assert.equal(h.status, 200);
  assert.equal(h.body.toString(), "ok");
  const page = await send({ port: PORT, path: "/", headers: { ...own(PORT), Accept: "text/html" } });
  assert.equal(page.status, 200);
  assert.match(page.body.toString(), /<title>Arch Film Studio<\/title>/);
  assert.deepEqual(header(page.headers, "content-security-policy"), [contentPolicy(cfg.ports.home)]);
  assert.deepEqual(header(page.headers, "x-content-type-options"), ["nosniff"]);
  // The page's own script, served by the app from dist/, under the same policy.
  const src = /<script[^>]+src="([^"]+)"/.exec(page.body.toString())?.[1];
  assert.ok(src && src.startsWith("/assets/"), page.body.toString());
  const js = await send({ port: PORT, path: src, headers: own(PORT) });
  assert.equal(js.status, 200);
  assert.deepEqual(header(js.headers, "content-security-policy"), [contentPolicy(cfg.ports.home)]);
});

test("a project is made and a real JPEG uploaded the way the page sends it; work.jpg and thumb.jpg are on disk", { skip: SKIP }, async () => {
  const p = await mutateOk("project.create", { name: "Courtyard house" });
  projectId = p.id;
  assert.ok((await query("project.list")).some((s) => s.id === projectId));
  const bytes = readFileSync(join(fakeDir, "render.jpg"));
  const r = await send({ port: PORT, method: "POST", path: `/api/upload?project=${encodeURIComponent(projectId)}`,
    headers: { ...ORIGIN, "Content-Type": "image/jpeg", "x-file-name": encodeURIComponent("Courtyard view – 01.jpg") }, body: bytes });
  assert.equal(r.status, 200, r.body.toString());
  image = jsonOf(r).image;
  assert.equal(image.code, "IMG-001");
  assert.equal(image.name, "Courtyard view – 01.jpg");
  assert.equal(image.width, 1600);
  assert.equal(image.height, 1000);
  for (const key of [image.originalKey, image.workKey, image.thumbKey]) assert.ok(statSync(dataFile(key)).size > 0, key);
  assert.ok(image.workKey.endsWith("/work.jpg") && image.thumbKey.endsWith("/thumb.jpg"));
  assert.deepEqual(readFileSync(dataFile(image.originalKey)), bytes, "the original is kept as sent");
  // The kept copy, served back to the page.
  const served = await send({ port: PORT, path: `/files/${image.thumbKey}`, headers: own(PORT) });
  assert.equal(served.status, 200);
  assert.deepEqual(served.body, readFileSync(dataFile(image.thumbKey)));
  // And a file that is not a picture is refused with the pinned sentence.
  const bad = await send({ port: PORT, method: "POST", path: `/api/upload?project=${encodeURIComponent(projectId)}`,
    headers: { ...ORIGIN, "Content-Type": "image/jpeg", "x-file-name": "notes.jpg" }, body: Buffer.from("just some text, not a picture") });
  assert.equal(bad.status, 400);
  assert.equal(jsonOf(bad).error.message, "That file is not a JPG, PNG or WebP picture.");
});

test("Analyse: the analysis goes through the fake relay, as this app, and lands in the document", { skip: SKIP }, async () => {
  const before = calls.filter((c) => c.part === "relay").length;
  await mutateOk("image.analyse", { projectId, imageIds: [image.id] });
  const p = await until((x) => imageOf(x).analysis?.state !== "running" && x, "the analysis");
  const a = imageOf(p).analysis;
  assert.equal(a.state, "succeeded", JSON.stringify(a));
  assert.equal(a.result.subject, ANALYSIS.subject);
  assert.deepEqual(a.result.materials, ["limestone", "oak"]);
  const relayCalls = calls.filter((c) => c.part === "relay").slice(before);
  assert.equal(relayCalls.length, 1);
  assert.equal(relayCalls[0].url, "/v1/messages");
  assert.equal(relayCalls[0].model, "claude-sonnet-5-5");
  assert.equal(relayCalls[0].who.subject, `app-${SLUG}`);
  assert.equal(relayCalls[0].version, "2023-06-01");
  assert.equal(relayCalls[0].images, 1, "work.jpg went with it");
});

test("Enhance with the allowance closed: the door's own sentence reaches the document and nothing is spent", { skip: SKIP }, async () => {
  const allowance = await query("money.allowance");
  assert.equal(allowance.open, false);
  assert.equal(allowance.needs, "Allow spending in the bar above.");
  const quote = await query("money.quote", { items: [{ model: "gemini_image3_pro", kind: "still_variation", resolution: "4K" }] });
  assert.equal(quote.words, "About $0.40");
  const jobsBefore = jobPosts().length;
  await mutateOk("image.enhance", { projectId, imageIds: [image.id] });
  const p = await until((x) => imageOf(x).enhancements[0]?.state === "failed" && x, "the refusal");
  const run = imageOf(p).enhancements[0];
  assert.equal(run.version, 1);
  assert.equal(run.error, NO_ALLOWANCE);
  assert.equal(run.taskId, undefined);
  assert.equal(run.cents, undefined);
  await wait(3500);
  await query("project.get", { id: projectId });
  assert.equal(jobPosts().length - jobsBefore, 1, "the door was asked once, and not again");
  assert.equal(doorState.spent, 0);
  assert.equal(doorState.jobs.size, 0);
  ids.closedJobs = jobPosts().length - jobsBefore;
});

test("Enhance with the allowance open: one job at the door, its picture kept under media/", { skip: SKIP }, async () => {
  doorState.open = true;
  const allowance = await query("money.allowance");
  assert.equal(allowance.open, true);
  assert.equal(allowance.words, "Allowed today: $10.00. Spent: $0.00.");
  const models = await query("money.models");
  assert.deepEqual(models.map((m) => [m.id, m.ready]), [["gemini_image3_pro", true], ["nano_banana_2.1", true],
    ["gemini_image3.1_flash", true], ["magnific_precision_upscaler_v2", true], ["gen4.5", true]]);
  const jobsBefore = jobPosts().length;
  await mutateOk("image.enhance", { projectId, imageIds: [image.id] });
  const p = await until((x) => ["succeeded", "failed"].includes(imageOf(x).enhancements[1]?.state) && x, "the enhancement");
  const run = imageOf(p).enhancements[1];
  assert.equal(run.state, "succeeded", JSON.stringify(run));
  assert.equal(run.version, 2);
  assert.match(run.storedKey, /^media\/[0-9a-f-]{36}\.jpg$/);
  assert.deepEqual(readFileSync(dataFile(run.storedKey)), readFileSync(join(fakeDir, "enhanced.jpg")));
  assert.deepEqual(run.outputSize, { width: 1920, height: 1200 });
  assert.equal(run.cents, 40);
  const posts = jobPosts().slice(jobsBefore);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].job.model, "gemini_image3_pro");
  assert.equal(posts[0].job.kind, "still_variation");
  assert.equal(posts[0].job.resolution, "4K");
  assert.equal(posts[0].job.inputs[0].role, "ref");
  assert.match(posts[0].job.prompt, /the reference image "ref1"/);
  ids.enhanceRun = run.id;
  ids.enhanceJobs = posts.length;
});

test("Approve, then Make master: the fake upscale (2x to 3840) makes a locked master", { skip: SKIP }, async () => {
  await mutateOk("image.decide", { projectId, imageId: image.id, runId: ids.enhanceRun, decision: "approved" });
  const jobsBefore = jobPosts().length;
  await mutateOk("image.master", { projectId, imageIds: [image.id] });
  const p = await until((x) => ["succeeded", "failed"].includes(imageOf(x).master?.state) && x, "the master");
  const m = imageOf(p).master;
  assert.equal(m.state, "succeeded", JSON.stringify(m));
  assert.equal(m.locked, true);
  assert.equal(m.reusedEnhancement, undefined);
  assert.equal(m.targetLongEdge, 3840);
  assert.equal(m.scale, 2);
  assert.deepEqual(m.outputSize, { width: 3840, height: 2400 });
  assert.deepEqual(readFileSync(dataFile(m.storedKey)), readFileSync(join(fakeDir, "upscaled.jpg")));
  const posts = jobPosts().slice(jobsBefore);
  assert.equal(posts.length, 1);
  assert.deepEqual([posts[0].job.model, posts[0].job.kind, posts[0].job.scale, posts[0].job.prompt, posts[0].job.inputs[0].role],
    ["magnific_precision_upscaler_v2", "still_upscale", 2, "", "image"]);
  // A locked master takes no new decision.
  const again = await mutate("image.decide", { projectId, imageId: image.id, runId: ids.enhanceRun, decision: "rejected" });
  assert.equal(again.status, 412);
  assert.equal(again.json.error.message, "This image has a locked master.");
  ids.masterJobs = posts.length;
});

test("Write storyboard: the fake relay's canned answer becomes shots; a shot naming no master is dropped", { skip: SKIP }, async () => {
  const before = calls.filter((c) => c.part === "relay").length;
  await mutateOk("storyboard.create", { projectId, brief: "Arrive at dusk.", format: "16:9" });
  const p = await until((x) => x.storyboard?.state !== "running" && x, "the storyboard");
  const sb = p.storyboard;
  assert.equal(sb.state, "succeeded", JSON.stringify(sb));
  assert.equal(sb.title, "Light on stone");
  assert.equal(sb.musicDirection, "Soft piano");
  assert.deepEqual(sb.shots.map((s) => [s.number, s.imageId, s.videoPrompt]), [[1, image.id, "Slow dolly-in."], [2, image.id, "Slow pan right."]]);
  const relayCalls = calls.filter((c) => c.part === "relay").slice(before);
  assert.equal(relayCalls.length, 1);
  assert.equal(relayCalls[0].model, "claude-opus-5-5");
  assert.equal(relayCalls[0].images, 1, "the master went with it");
  ids.shots = sb.shots.map((s) => s.id);
});

test("Make clip, once per shot: each a gen4.5 job from the master, the clip kept and approved", { skip: SKIP }, async () => {
  ids.clipJobs = [];
  for (const shotId of ids.shots) {
    const jobsBefore = jobPosts().length;
    await mutateOk("shot.generate", { projectId, shotIds: [shotId] });
    const p = await until((x) => {
      const v = x.storyboard.shots.find((s) => s.id === shotId).video;
      return ["succeeded", "failed"].includes(v?.state) && x;
    }, "the clip");
    const v = p.storyboard.shots.find((s) => s.id === shotId).video;
    assert.equal(v.state, "succeeded", JSON.stringify(v));
    assert.match(v.storedKey, /^media\/[0-9a-f-]{36}\.mp4$/);
    assert.deepEqual(readFileSync(dataFile(v.storedKey)), readFileSync(join(fakeDir, "clip.mp4")));
    assert.equal(v.width, 1280);
    assert.equal(v.durationSeconds, 2);
    const posts = jobPosts().slice(jobsBefore);
    assert.equal(posts.length, 1);
    assert.deepEqual([posts[0].job.model, posts[0].job.kind, posts[0].job.seconds, posts[0].job.ratio, posts[0].job.inputs[0].role],
      ["gen4.5", "image_to_video", 2, "1280:720", "first"]);
    ids.clipJobs.push(posts.length);
    await mutateOk("shot.decide", { projectId, shotId, decision: "approved" });
  }
});

test("Assemble film: ffmpeg inside the fence stitches the approved clips, and ffprobe reads a duration", { skip: SKIP }, async () => {
  const jobsBefore = jobPosts().length;
  await mutateOk("film.assemble", { projectId, transition: "fade" });
  const p = await until((x) => x.film?.state !== "running" && x, "the film", 120000);
  const film = p.film;
  assert.equal(film.state, "succeeded", JSON.stringify(film));
  assert.equal(film.withMusic, false);
  assert.match(film.finalStoredKey, /^media\/.+\.mp4$/);
  const probe = spawnSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height", "-of", "json",
    dataFile(film.finalStoredKey)], { encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  const info = JSON.parse(probe.stdout);
  const duration = Number(info.format.duration);
  assert.ok(duration > 3 && duration < 4, `two 2 s clips with a 0.5 s fade: ${duration}`);
  assert.equal(info.streams[0].width, 1280);
  assert.ok(Math.abs(film.stitch.durationSeconds - duration) < 0.1);
  assert.equal(jobPosts().length, jobsBefore, "the film asks the door for nothing");
  // The film, served for download.
  const dl = await send({ port: PORT, path: `/files/${film.finalStoredKey}?download`, headers: own(PORT) });
  assert.equal(dl.status, 200);
  assert.match(header(dl.headers, "content-disposition")[0] ?? "", /attachment/);
});

test("the door saw exactly one job per button, and nothing was sent twice", { skip: SKIP }, async () => {
  assert.deepEqual([ids.closedJobs, ids.enhanceJobs, ids.masterJobs, ...ids.clipJobs], [1, 1, 1, 1, 1]);
  await wait(3500);
  await query("project.get", { id: projectId });
  const posts = jobPosts();
  assert.equal(posts.length, 5);
  assert.deepEqual(posts.map((c) => c.job.model), ["gemini_image3_pro", "gemini_image3_pro", "magnific_precision_upscaler_v2", "gen4.5", "gen4.5"]);
  assert.equal(doorState.jobs.size, 4, "the refused one was never started");
  assert.equal(doorState.spent, 40 + 25 + 2 * estimateCents({ kind: "image_to_video", model: "gen4.5", seconds: 2 }));
  // Every call reached the fakes as this app and no other.
  for (const c of calls) {
    if (c.part === "door") assert.deepEqual(c.who, { kind: "p", slug: `app-${SLUG}`, app: SLUG, subject: `app-${SLUG}` });
    else assert.equal(c.who?.subject, `app-${SLUG}`);
  }
  const allowance = await query("money.allowance");
  assert.equal(allowance.spent, doorState.spent);
});

test("the fence: no network and no local port from inside, the owner's home closed, no local binding", { skip: SKIP }, async (t) => {
  // The settings app-exec gives this app's run, from the temp engine's own fence.mjs.
  const s = spawnSync("/usr/bin/env", ["-i", `HOME=${ownerHome()}`, "PATH=/usr/bin:/bin", NODE, join(root, "engine", "apps", "fence.mjs"),
    "--settings", SLUG, "run"], { encoding: "utf8" });
  assert.equal(s.status, 0, s.stderr);
  const file = s.stdout.trim();
  assert.ok(file.startsWith(join(cfg.paths.state, "fences") + "/"), file);
  const settings = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(settings.network.allowedDomains, []);
  assert.equal(settings.network.allowLocalBinding, undefined);
  assert.equal(settings.network.allowAllUnixSockets, undefined);
  assert.deepEqual(settings.network.allowUnixSockets, [join(realpathSync(cfg.paths.appsRun), SLUG)]);
  assert.ok(settings.filesystem.denyRead.includes(ownerHome()));
  assert.ok(settings.filesystem.allowRead.every((p) => !ownerHome().startsWith(p) && !p.startsWith(join(ownerHome(), ".ssh"))));
  // And as it holds: a program run under those very settings reaches no local port (the fake
  // door's, which is listening) and cannot read the owner's ~/.ssh or home.
  const probe = `const net = require("net"), fs = require("fs"); const out = {};
for (const [k, p] of [["ssh", ${JSON.stringify(join(ownerHome(), ".ssh"))}], ["home", ${JSON.stringify(ownerHome())}]]) {
  try { fs.readdirSync(p); out[k] = "read"; } catch (e) { out[k] = e.code; } }
const c = net.connect(${door.address().port}, "127.0.0.1");
const done = (v) => { out.tcp = v; c.destroy(); console.log(JSON.stringify(out)); process.exit(0); };
c.on("connect", () => done("connected")); c.on("error", (e) => done(e.code)); setTimeout(() => done("timeout"), 5000);`;
  const doorCallsBefore = calls.filter((c) => c.part === "door").length;
  const srtTmp = `/tmp/uuu-apps-${process.getuid()}`;
  assert.ok(existsSync(srtTmp), "app-exec made the sandbox tool's own temp folder");
  const r = spawnSync("/usr/bin/env", ["-i", `HOME=${join(root, "s", "apps", SLUG, "home")}`,
    `PATH=${join(cfg.node24, "bin")}:/usr/bin:/bin:/usr/sbin:/sbin`, `TMPDIR=${srtTmp}`,
    SRT, "-s", file, "--", "/usr/bin/env", `TMPDIR=${join(root, "s", "apps", SLUG, "tmp")}`, join(cfg.node24, "bin", "node"), "-e", probe],
  { cwd: join(root, "apps", SLUG), encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const got = JSON.parse(r.stdout.trim().split("\n").pop());
  t.diagnostic(`inside the fence: ${JSON.stringify(got)}`);
  assert.notEqual(got.tcp, "connected", JSON.stringify(got));
  assert.ok(["EPERM", "EACCES", "ECONNREFUSED"].includes(got.tcp), JSON.stringify(got));
  assert.ok(["EPERM", "EACCES"].includes(got.home), JSON.stringify(got));
  if (existsSync(join(ownerHome(), ".ssh"))) assert.ok(["EPERM", "EACCES"].includes(got.ssh), JSON.stringify(got));
  else assert.notEqual(got.ssh, "read");
  assert.equal(calls.filter((c) => c.part === "door").length, doorCallsBefore, "nothing reached the door from the probe");
});

test("nothing of the live state was written, and the repo's READY was not touched", { skip: SKIP }, () => {
  assert.deepEqual(existsSync(join(REPO_APP, "READY")) ? readFileSync(join(REPO_APP, "READY")) : null, repoReady);
  assert.ok(realpathSync(dataDir).startsWith(root + "/"));
  assert.ok(readdirSync(dataDir).length > 0, "the app wrote into the temp data folder");
  assert.equal(host.app(SLUG).state, "on", "the app stayed up throughout");
});
