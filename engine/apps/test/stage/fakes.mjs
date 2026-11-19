// The stand-ins of the staging harness (PLAN-APPS-ASTRYX T6): a fake generation door and a fake
// model relay, lifted from engine/apps/test/arch-film-studio-real.test.mjs and made general for
// either app. Each checks its token the way the real part does (checkCaller for the door, the
// relay's checkToken), records every call, and answers in the real part's shape. The door prices
// by the door's own table (registry.mjs estimateCents), keeps an allowance that is open with
// $20.00 and a little spent, and hands back real pictures and clips (pictures.mjs) picked by the
// job's kind and by the render the job's picture was made from. The relay answers each app's
// thinking (analysis, storyboard, people check, close-up finding, the editor's chat) with canned,
// believable text in the shape that app's parser reads. Port 0 on 127.0.0.1 only; nothing here
// reaches the internet.
import http from "node:http";
import { readFileSync } from "node:fs";
import { checkCaller, headerValues } from "../../../doors/common.mjs";
import { checkToken } from "../../../relay/token.mjs";
import { appModels, estimateCents, parseAppJob } from "../../../generate/registry.mjs";

// The real door's gen_no_allowance sentence.
export const NO_ALLOWANCE = "This app may not spend anything right now. The owner can allow it in App Studio.";

const sendJson = (res, status, value) => {
  const text = JSON.stringify(value);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text), "Cache-Control": "no-store" });
  res.end(text);
};
const no = (res, status, code, message) => sendJson(res, status, { error: { message }, code });

function readAll(req) {
  return new Promise((ok) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => ok(Buffer.concat(chunks)));
    req.on("error", () => ok(Buffer.alloc(0)));
  });
}

// The still a job hands back, by what its prompt asks for.
function stillVariant(prompt) {
  const p = String(prompt || "").toLowerCase();
  if (/close-up of|cinematic close-up/.test(p)) return "closeup";
  if (/blue hour|night|moonlit|moonlight|after dark|dusk light|lit night/.test(p)) return "dusk";
  if (/golden hour|golden-hour|sunset|warm evening|low sun|evening/.test(p)) return "warm";
  return "enhanced";
}

// ---------------------------------------------------------------------------
// The door. `apps` is the list the door accepts (the staged app alone).

export function startDoor({ slug, secretPath, idsPath, apps, pictures, budget = 2000, spent = 340, maxRunning = 8 }) {
  const calls = [];
  const state = {
    open: true, budget, spent, maxRunning, hold: false,
    inputs: new Map(), // input id -> the picture set it was made from
    jobs: new Map(),   // job id -> { kind, model, asked, held, file, type, cents }
    n: 0,
  };
  const server = http.createServer(async (req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    const body = await readAll(req);
    const who = checkCaller({ rawHeaders: req.rawHeaders, secretPath, idsPath, agents: [], apps, now: Date.now() });
    const call = { part: "door", method: req.method, url: req.url, who, bytes: body.length, at: Date.now() };
    calls.push(call);
    if (typeof who !== "object" || who.kind !== "p" || who.app !== slug) return no(res, 401, "gen_no_token", "No token.");
    const url = req.url;
    if (req.method === "GET" && url === "/gen/app/models") {
      return sendJson(res, 200, { models: appModels({}, { runway: true, higgsfield: true }) });
    }
    if (req.method === "GET" && url === "/gen/app/allowance") {
      return sendJson(res, 200, state.open
        ? { open: true, budget: state.budget, spent: state.spent, left: Math.max(0, state.budget - state.spent), expiresAt: "2099-01-01T00:00:00.000Z" }
        : { open: false, budget: 0, spent: 0, left: 0, expiresAt: null });
    }
    if (req.method === "POST" && url === "/gen/app/estimate") {
      let v;
      try { v = JSON.parse(body.toString("utf8")); } catch { return no(res, 400, "gen_bad_request", "Not JSON."); }
      const items = (Array.isArray(v?.items) ? v.items : []).map((i) => ({ model: i.model, cents: estimateCents(i) }));
      const total = items.some((i) => i.cents === null) ? null : items.reduce((s, i) => s + i.cents, 0);
      return sendJson(res, 200, { items, total });
    }
    if (req.method === "POST" && url === "/gen/app/inputs") {
      const type = headerValues(req.rawHeaders, "content-type")[0];
      if (type !== "image/jpeg" || body.length < 4 || body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff) {
        return no(res, 400, "gen_bad_input", "The door takes a picture: a JPG, PNG or WebP.");
      }
      const input = `in_${(state.n += 1)}`;
      state.inputs.set(input, pictures ? await pictures.nearest(body) : null);
      call.input = input;
      return sendJson(res, 201, { input, type, bytes: body.length });
    }
    if (req.method === "POST" && url === "/gen/app/jobs") {
      const parsed = parseAppJob(body);
      call.job = parsed.ok ? parsed.job : { refused: parsed.why };
      if (!parsed.ok) return no(res, 400, "gen_bad_request", parsed.why);
      const j = parsed.job;
      if (!j.inputs.every((i) => state.inputs.has(i.input))) return no(res, 400, "gen_bad_request", "A picture is not one this app sent in the last day.");
      if (!state.open) return no(res, 403, "gen_no_allowance", NO_ALLOWANCE);
      const cents = estimateCents({ kind: j.kind, model: j.model, seconds: j.seconds ?? undefined, resolution: j.resolution ?? undefined, scale: j.scale ?? undefined });
      if (cents === null) return no(res, 403, "gen_no_price", "The door has no price for this model, so nothing is made with it.");
      const running = [...state.jobs.values()].filter((x) => x.asked < 2 || x.held).length;
      if (running >= state.maxRunning) return no(res, 403, "gen_busy", "Two jobs are already running. Wait for one to finish.");
      if (state.spent + cents > state.budget) return no(res, 403, "gen_no_allowance", NO_ALLOWANCE);
      state.spent += cents;
      const job = `job_${(state.n += 1)}`;
      const first = j.inputs[0] ? state.inputs.get(j.inputs[0].input) : null;
      const set = first || pictures?.sets[0] || null;
      let file = null;
      let type = "image/jpeg";
      if (set) {
        if (j.kind === "image_to_video" || j.kind === "text_to_video") { file = set.clip; type = "video/mp4"; }
        else if (j.kind === "still_upscale") file = set.master;
        else file = set[stillVariant(j.prompt)];
      }
      state.jobs.set(job, { kind: j.kind, model: j.model, asked: 0, held: state.hold, file, type, cents });
      call.made = job;
      return sendJson(res, 202, { job, cents });
    }
    const m = /^\/gen\/app\/jobs\/([A-Za-z0-9_-]{1,64})(\/output)?$/.exec(url);
    if (req.method === "GET" && m) {
      const j = state.jobs.get(m[1]);
      if (!j) return no(res, 404, "gen_not_found", "The door has no such job.");
      if (!j.file) return sendJson(res, 200, { job: m[1], state: "failed", progress: 0, credits: null, reason: "The stand-in has no picture.", output: null });
      const bytes = readFileSync(j.file);
      if (!m[2]) {
        // Asked once while running, then done; a held job runs until it is let go.
        if (!j.held) j.asked += 1;
        if (j.held || j.asked < 2) return sendJson(res, 200, { job: m[1], state: "running", progress: j.held ? 0.4 : 0.5, credits: null, reason: null, output: null });
        return sendJson(res, 200, { job: m[1], state: "done", progress: 1, credits: null, reason: null, output: { type: j.type, bytes: bytes.length } });
      }
      if (j.held || j.asked < 2) return no(res, 409, "gen_not_ready", "Not ready.");
      res.writeHead(200, { "Content-Type": j.type, "Content-Length": bytes.length, "Cache-Control": "no-store" });
      return void res.end(bytes);
    }
    return no(res, 404, "gen_not_found", "No such route.");
  });
  return {
    server, calls, state,
    jobPosts: () => calls.filter((c) => c.method === "POST" && c.url === "/gen/app/jobs"),
    setAllowance({ open, budget, spent } = {}) {
      if (typeof open === "boolean") state.open = open;
      if (Number.isFinite(budget)) state.budget = budget;
      if (Number.isFinite(spent)) state.spent = spent;
    },
    // New jobs stay running (true) or finish as usual (false).
    holdNew(on) { state.hold = Boolean(on); },
    // Every held job finishes on its next two asks.
    releaseAll() { for (const j of state.jobs.values()) j.held = false; },
  };
}

// ---------------------------------------------------------------------------
// The relay's canned thinking.

// What the analysis says of each of the twelve sample reframings (pictures.mjs SAMPLE_FRAMES),
// by its file name; any other picture gets the plain one at the end.
const SAMPLE_ANALYSIS = {
  "Water wall, wide view.jpg": ["A stone water wall in a walled garden", "Symmetric, one-point, the wall centred", "Eye level, 24 mm", "Three spouts in the stone wall, four bronze cranes, two pools"],
  "Cranes by the west pool.jpg": ["Two bronze cranes before a riven stone wall", "Cranes in the left third, wall filling the frame", "Eye level, 50 mm", "Bronze crane sculptures, planted bed"],
  "Cranes by the east pool.jpg": ["Two bronze cranes at the east pool", "Cranes right of centre, wall behind", "Eye level, 50 mm", "Bronze cranes, pool edge"],
  "Three water spouts.jpg": ["Three water spouts falling down a stone wall", "Centred on the spouts", "Eye level, 50 mm", "Falling water, dark recesses"],
  "Stone wall against the sky.jpg": ["The top of the stone wall under a summer sky", "Wall in the lower third, clouds above", "Slightly low, 35 mm", "Cumulus clouds, tree crowns"],
  "Lamp and flowering trees.jpg": ["A garden lamp among flowering trees", "Lamp on the left third", "Eye level, 35 mm", "Pole lamp, pink blossom"],
  "Pool edge and planting.jpg": ["The curved pool edge and low planting", "Curving edge leading in from the left", "Low, 28 mm", "Still water, pale coping"],
  "Garden from the east path.jpg": ["The water garden seen from the east path", "Wall centred, pools in front", "Eye level, 28 mm", "Water wall, cranes, lamps"],
  "Wall and pools, low view.jpg": ["The water wall and pools from low down", "Wall in the upper half, pools below", "Low, 24 mm", "Reflections in the pools"],
  "Spouts from the west.jpg": ["The spouts and cranes from the west", "Spouts right of centre", "Eye level, 35 mm", "Falling water, bronze cranes"],
  "East lamp and terrace.jpg": ["The east lamp beside the stone terrace", "Lamp on the right third", "Eye level, 35 mm", "Pole lamp, flowering tree"],
  "Planting before the wall.jpg": ["Flowering planting in front of the stone wall", "Planting in the lower third", "Eye level, 50 mm", "Pink flowers, stone texture"],
};

function analysisFor(set) {
  const a = set && SAMPLE_ANALYSIS[set.name];
  const subject = a ? a[0] : "An architectural view";
  return {
    subject, spaceType: "exterior", composition: a ? a[1] : "Balanced, one-point", camera: a ? a[2] : "Eye level, 35 mm",
    materials: a ? ["riven grey stone", "bronze", "pale concrete coping", "still water"] : ["stone", "glass", "timber"],
    lighting: "Clear midday sun with soft cloud, crisp shadows", landscaping: a ? "Mixed flowering trees, low pink-flowered planting" : "Planted beds",
    notableElements: a ? a[3].split(", ") : ["entrance"], peoplePresent: false,
    summary: a ? `${subject.toLowerCase()}, in clear midday light.` : "an architectural view in clear daylight.",
  };
}

// Arch Film Studio's storyboard: six shots over the master codes the prompt lists.
function afsStoryboard(prompt) {
  const codes = [...new Set([...String(prompt).matchAll(/^(IMG-\d{3})/gm)].map((m) => m[1]))];
  const use = codes.length ? codes : ["IMG-001"];
  const beats = [
    ["Wide", "Arrival: the whole garden opens up", "Slow dolly-in at eye level, easing to a stop", "slow", "Establish the place", "fade"],
    ["Medium", "The stone and the falling water", "Lateral track left to right along the wall", "measured", "Show the material", "cut"],
    ["Detail", "Bronze cranes in the still air", "Macro glide past the cranes", "slow", "A quiet pause", "cut"],
    ["Wide", "Light moving across the stone", "Crane rise from pool level to the top of the wall", "slow", "Lift the mood", "fade"],
    ["Medium", "The pools and their reflections", "Parallax slide past the planting", "measured", "Lead toward the end", "cut"],
    ["Hero", "The garden at rest", "Slow push-in, settling on the centre spout", "slow", "Land on the hero frame", "fade"],
  ];
  return {
    title: "Stone and water", narrative: "A calm walk into a walled water garden: the wall, its water and its cranes, ending on the still centre.",
    grade: "Natural, a touch warm, soft contrast", musicDirection: "Slow solo piano with soft strings, gentle and spacious.",
    shots: beats.map(([shotType, creativeDirection, cameraMovement, speed, purpose, transition], i) => ({
      imageCode: use[i % use.length], shotType, creativeDirection, cameraMovement, speed,
      lighting: "Midday sun, cloud shadows drifting slowly over the stone", humanActivity: "none", purpose,
      videoPrompt: `${cameraMovement}. ${creativeDirection}. The architecture, stone, water and planting stay exactly as in the source frame.`,
      durationSeconds: [6, 5, 4, 6, 5, 6][i], transition,
    })),
  };
}

const CHECK = {
  verdict: "issues", score: 7.5, summary: "Believable people, one a little too tall for the lamp beside her.",
  checks: [
    { id: "scale", ok: false, note: "The woman by the east lamp stands about as tall as half the lamp; she should reach about a third." },
    { id: "grounding", ok: true, note: "Feet rest on the paving." },
    { id: "light", ok: true, note: "Shadows fall the same way as the trees'." },
    { id: "faces", ok: true, note: "Natural faces and hands." },
    { id: "blend", ok: true, note: "Same grain and colour as the scene." },
    { id: "fidelity", ok: true, note: "The wall, pools and cranes are unchanged." },
  ],
  fixes: "Make the woman by the east lamp shorter, her head reaching about a third of the lamp height.",
};

const CLOSEUPS = {
  shots: [
    { frame: 1, subject: "the bronze crane on the left of the west pool", framing: "tight close-up, 100mm, crane head in the left third", why: "Bronze against rough stone catches the light." },
    { frame: 1, subject: "the centre water spout where it leaves the wall", framing: "close-up, 135mm, water filling the right half", why: "Falling water reads as motion even in a still." },
    { frame: 1, subject: "the riven stone texture beside the spouts", framing: "detail, 100mm, raking light across the surface", why: "The texture is the wall's character." },
  ],
};

function plannerAnswer(prompt) {
  const m = /These (\d+) images/.exec(String(prompt));
  const count = m ? Number(m[1]) : 1;
  const titles = [["Arrival at the wall", "golden-hour", "few", "a couple walking slowly along the pool edge"],
    ["Water and stone", "early-morning", "none", ""], ["The bronze cranes", "golden-hour", "none", ""],
    ["Evening glow", "blue-hour", "one", "a woman pausing by the east lamp"], ["The quiet pools", "overcast", "none", ""],
    ["Night garden", "night-lit", "none", ""]];
  return {
    frames: Array.from({ length: count }, (_, i) => {
      const [title, look, crowd, people] = titles[i % titles.length];
      return {
        image: i + 1, space: "exterior", position: 10 + i * 15, title, beat: `${title}: the garden in its ${look.replace("-", " ")} light.`,
        look, look_why: "Fits this part of the story.", crowd, people, crowd_why: crowd === "none" ? "The view reads best empty." : "A figure gives the wall its scale.",
      };
    }),
  };
}

const EDITOR = { reply: "I set soft half-second fades between the three cuts so the film reads as one calm piece.", transition: "fade", fadeSeconds: 0.5 };

// -> the JSON the relay answers with, by the app's system prompt (and model)
export function relayAnswer(slug, body, set) {
  const system = typeof body?.system === "string" ? body.system : "";
  const content = body?.messages?.[0]?.content;
  const prompt = Array.isArray(content) ? content.filter((b) => b?.type === "text").map((b) => b.text).join("\n") : String(content || "");
  if (slug === "arch-film-studio") {
    if (/photography analyst/.test(system)) return analysisFor(set);
    if (/film director and cinematographer/.test(system) || /storyboard/i.test(prompt)) return afsStoryboard(prompt);
    return analysisFor(set);
  }
  if (/senior compositor/.test(system)) return CHECK;
  if (/stills photographer/.test(system)) return CLOSEUPS;
  if (/director of photography/.test(system)) return plannerAnswer(prompt);
  if (/film editor/.test(system)) return EDITOR;
  return { reply: "Done." };
}

export function startRelay({ slug, secret, pictures }) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    const raw = await readAll(req);
    const auth = headerValues(req.rawHeaders, "authorization");
    const token = auth.length === 1 ? auth[0].replace(/^Bearer /, "") : null;
    const who = token ? checkToken(secret, token, Date.now()) : null;
    let body = null;
    try { body = JSON.parse(raw.toString("utf8")); } catch { /* recorded as null */ }
    const content = body?.messages?.[0]?.content ?? [];
    const images = Array.isArray(content) ? content.filter((b) => b?.type === "image") : [];
    calls.push({ part: "relay", method: req.method, url: req.url, who, model: body?.model ?? null, images: images.length, system: String(body?.system || "").slice(0, 80) });
    if (!who || who.subject !== `app-${slug}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return void res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "no token" } }));
    }
    let set = null;
    if (pictures && images[0]?.source?.data) {
      try { set = await pictures.nearest(Buffer.from(images[0].source.data, "base64")); } catch { set = null; }
    }
    const answer = relayAnswer(slug, body, set);
    const text = JSON.stringify({ type: "message", content: [{ type: "text", text: "```json\n" + JSON.stringify(answer) + "\n```" }], stop_reason: "end_turn" });
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
    res.end(text);
  });
  return { server, calls };
}

export const listen = (server) => new Promise((ok, fail) => {
  server.once("error", fail);
  server.listen(0, "127.0.0.1", () => { server.off("error", fail); ok(server.address().port); });
});

export const closeServer = (server) => new Promise((ok) => {
  if (!server || !server.listening) return void ok();
  server.closeAllConnections();
  server.close(() => ok());
});
