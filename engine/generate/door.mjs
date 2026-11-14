// The generation door: the only way an agent (the Artist) reaches the paid picture and video
// service (PLAN-V5 K13). It runs unfenced as the owner, spends the owner's money and sends the
// owner's pictures out, so it trusts nothing a request carries and nothing the service answers
// (docs/adr/0007). Checks, in K13's order: upgrades and CONNECT, health, the path (raw, no
// query string), the token (this door's own secret; an agent of `doors.generate.agents`), the
// switch, a pause and the key, the body, then the token and switch again, the inputs, the
// owner's batch, the price and the caps, a reservation in the ledger synced to disk, and only
// then one call out. Pictures arrive as bytes and results leave as bytes: no path an agent
// names is ever opened. Every service detail is in ./runway.mjs; money is ./ledger.mjs.
// Log lines never hold a header, a body, a prompt, a token or a key.
//
// Step 5 (PLAN-V5 K19 to K22, T73): a second service, Higgsfield, through its MCP server
// (./higgsfield.mjs, ./mcp.mjs, the owner's sign-in in ./oauth.mjs), and apps of App Studio
// (tokens of kind `p` the App Studio host mints) on their own routes under /gen/app/, spending
// only inside the owner's allowance for that app. One table of models (./registry.mjs), one
// ledger in US cents, one set of caps, one pause and one running limit for the Artist and every
// app. A Runway row takes step 3's path; a Higgsfield row takes K21's job flow (the uploads, the
// live price as a guard, the caps again, the reservation, the call, jobs_wait).
import http from "node:http";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, createReadStream, mkdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkCaller, ensureSecret, headerValues, readBody, refuse, sendJson, statusFile, wantsUpgrade } from "../doors/common.mjs";
import { describeError } from "../relay/relay.mjs";
import { checkAddress } from "../web/address.mjs";
import { REAL_NET, fetchPublic } from "../web/fetch.mjs";
import { HF_ORIGIN, createHiggsfield } from "./higgsfield.mjs";
import { createLedger, dayOf, extrasByJob, rotateLedger, summarize } from "./ledger.mjs";
import { createMcpClient } from "./mcp.mjs";
import { createHfAuth } from "./oauth.mjs";
import { APP_JOB_BYTES, DEFAULT_CENTS_PER_CREDIT, appModels, estimateCents, estimateUnits, parseAppJob, rowOf, runwayRequest, upscaleFits } from "./registry.mjs";
import {
  API_LIMITS, KINDS, ORGANIZATION_PATH, PRICES, RUNWAY_ORIGIN, UPSCALE_MAX_SIDE, VIDEO_KINDS, buildRequest, callRunway,
  checkUpstream, chosen, credits as creditsOf, defaultModel, errorText, estimate, failureKind, holdsKey, priced, ratioFits,
  readTask, scrub, taskPath,
} from "./runway.mjs";
import {
  ALLOWANCE_ID_RE, HASH_RE, ID_RE, INPUTS_KEPT, INPUTS_KEPT_APP, INPUT_MAX, INPUT_MIN, SHOT_RE, newId, readAllowance, readBatch, readGenState,
  readRunwayKey, sniffOutput, sniffPicture, workStore,
} from "./state.mjs";

const MB = 1024 * 1024;
export const BODY_BYTES = 8 * 1024;
export const MAX_RUNNING = 2;             // jobs running at once for one caller, an agent or an app
export const MAX_RUNNING_ALL = 4;         // and for every caller together (K20)
export const REFUSALS_TO_FREEZE = 2;
export const REFUSALS_TO_PAUSE = 3;
// Requests Runway answered with a 4xx and did not start cost nothing, so no cap holds them (T48
// F1): two for one shot of a batch refuse that shot, and three in a day pause the door until the
// owner's "Start again", both counted in the ledger since the owner last started it again. The
// Artist's role sends a request at most twice (once more after gen_limited's wait), so a third
// is never its rule working; three is also the refusals' pause, whose sentence the owner already
// sees ("Runway refused three requests in a day").
export const NOT_STARTED_PER_SHOT = 2;
export const NOT_STARTED_TO_PAUSE = 3;
export const LIMITED_SEC = 60;            // the wait after Runway's 429 when it names none
export const PROMPT_KEPT = 1000;          // the prompt kept in a job's record, as sent
// Where the owner's browser comes back after Higgsfield's sign-in: the home server's (T79).
export const HF_RETURN_PATH = "/api/generation/higgsfield/back";
export const GEN_LIMITS = Object.freeze({
  ...API_LIMITS,
  pollMs: 6_000,            // between two questions about one task
  jobMs: 20 * 60_000,       // one job, from the call to the end
  pollErrors: 5,            // unclear answers in a row before the door gives up on a task
  downloadMs: 300_000,      // one output download
  videoBytes: 200 * MB,
  pictureBytes: 30 * MB,
});

// Every refusal: [status, sentence]. All go through `refuse`, which never sends 429 or 5xx.
export const CODES = Object.freeze({
  gen_refused: [403, "The generation door does not take this kind of request."],
  gen_not_found: [404, "The generation door has no such address."],
  gen_no_token: [401, "The generation door needs a valid token for an agent that may use it."],
  gen_off: [403, "Generation is off. The owner can switch it on in Settings."],
  gen_paused: [403, "Generation is paused. The owner must press Start again in Settings."],
  gen_no_key: [403, "No Runway key is saved. The owner can paste one in Settings."],
  gen_bad_input: [400, "Send one PNG, JPEG or WebP picture of 512 bytes to 3.3 MB, with its type. At most 40 are kept a day."],
  gen_bad_request: [400, "The generation door takes one JSON object with only the keys this kind of job uses."],
  gen_not_approved: [403, "The owner has not approved this. Nothing was spent."],
  gen_no_price: [403, "The door has no price for this model, so nothing was spent."],
  gen_ledger: [403, "The spending ledger cannot be read or written, so nothing was spent."],
  gen_cap_zero: [403, "A spending limit in Settings is 0, so nothing will be made."],
  gen_over_daily: [403, "Today's spending limit is reached. Nothing more will be made until tomorrow, or the owner raises the limit."],
  gen_over_monthly: [403, "This month's spending limit is reached. The owner can raise it in Settings."],
  gen_over_batch: [403, "This would go over the cost the owner approved for this batch."],
  gen_busy: [403, "Two jobs are already running. Wait for one to finish."],
  gen_key_refused: [403, "Runway refused the key. The owner can check it in Settings."],
  gen_limited: [403, "Runway says too many requests for now. Wait before asking again."],
  gen_could_not_start: [403, "Runway did not start this job."],
  gen_not_ready: [403, "This job has no result to fetch."],
  // Step 5 (K19, K21, K22).
  gen_hf_off: [403, "Higgsfield is off. The owner can switch it on in Settings."],
  gen_hf_signed_out: [403, "Higgsfield is not signed in. The owner can sign in from Settings."],
  gen_hf_refused: [403, "Higgsfield asked for a new sign-in. The owner can sign in again from Settings."],
  gen_hf_sign_in: [403, "The Higgsfield sign-in did not finish. Try again."],
  gen_no_allowance: [403, "This app may not spend anything right now. The owner can allow it in App Studio."],
  gen_over_allowance: [403, "This would go over what the owner allowed this app today."],
  gen_price_changed: [403, "Higgsfield's price for this is higher than the door's table, so nothing was spent."],
});

const JOB = "([A-Za-z0-9_-]{1,64})";
const ROUTES = [
  { method: "POST", re: /^\/gen\/inputs$/, name: "inputs", spends: true },
  { method: "POST", re: /^\/gen\/estimate$/, name: "estimate", either: true },
  { method: "POST", re: /^\/gen\/jobs$/, name: "jobs", spends: true },
  { method: "GET", re: new RegExp(`^/gen/jobs/${JOB}$`), name: "job" },
  { method: "GET", re: new RegExp(`^/gen/jobs/${JOB}/output$`), name: "output" },
  { method: "POST", re: /^\/gen\/owner\/balance$/, name: "balance", owner: true },
  // Apps of App Studio (K19): tokens of kind `p` only.
  { method: "GET", re: /^\/gen\/app\/models$/, name: "appModels", app: true },
  { method: "POST", re: /^\/gen\/app\/estimate$/, name: "appEstimate", app: true },
  { method: "POST", re: /^\/gen\/app\/inputs$/, name: "appInputs", app: true, spends: true },
  { method: "POST", re: /^\/gen\/app\/jobs$/, name: "appJobs", app: true, spends: true },
  { method: "GET", re: new RegExp(`^/gen/app/jobs/${JOB}$`), name: "appJob", app: true },
  { method: "GET", re: new RegExp(`^/gen/app/jobs/${JOB}/output$`), name: "appOutput", app: true },
  { method: "GET", re: /^\/gen\/app\/allowance$/, name: "appAllowance", app: true },
  // The owner's Higgsfield sign-in and balance (K21): no Runway key needed, the switch may be off.
  { method: "POST", re: /^\/gen\/owner\/higgsfield\/begin$/, name: "hfBegin", owner: true, hf: true },
  { method: "POST", re: /^\/gen\/owner\/higgsfield\/finish$/, name: "hfFinish", owner: true, hf: true },
  { method: "POST", re: /^\/gen\/owner\/higgsfield\/forget$/, name: "hfForget", owner: true, hf: true },
  { method: "POST", re: /^\/gen\/owner\/higgsfield\/balance$/, name: "hfBalance", owner: true, hf: true },
];
const PICTURE_TYPES = { "image/png": "image/png", "image/jpeg": "image/jpeg", "image/jpg": "image/jpeg", "image/webp": "image/webp" };
const JOB_KEYS = ["batch", "shot", "kind", "input", "inputs", "promptText", "seconds", "ratio", "scale"];
// For each kind: the keys it must have and may have (beyond batch and shot).
const KIND_KEYS = {
  image_to_video: { need: ["input", "promptText", "seconds", "ratio"], may: [] },
  text_to_video: { need: ["promptText", "seconds", "ratio"], may: [] },
  still_variation: { need: ["inputs", "promptText", "ratio"], may: [] },
  still_upscale: { need: ["input"], may: ["scale"] },
};
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

function route(method, target) {
  for (const r of ROUTES) {
    if (r.method !== method) continue;
    const m = r.re.exec(target);
    if (m) return { ...r, args: m.slice(1) };
  }
  return null;
}

const parseObject = (buf) => {
  try {
    const v = JSON.parse(buf.toString("utf8"));
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};
const idText = (v) => typeof v === "string" && ID_RE.test(v);
const prompt = (v) => typeof v === "string" && v.trim() !== "" && v.length <= 1000 && !/[\x00-\x08\x0b-\x1f\x7f]/.test(v);

// A job body, checked: the kind's keys and nothing else, each of the right kind; null otherwise.
export function parseJob(buf) {
  const v = parseObject(buf);
  if (v === null || !KINDS.includes(v.kind)) return null;
  const { need, may } = KIND_KEYS[v.kind];
  const keys = Object.keys(v);
  if (!keys.every((k) => JOB_KEYS.includes(k) && (k === "kind" || k === "batch" || k === "shot" || need.includes(k) || may.includes(k)))) return null;
  if (!need.every((k) => Object.hasOwn(v, k)) || !Object.hasOwn(v, "batch")) return null;
  if (v.batch !== null && !idText(v.batch)) return null;
  if (v.batch === null ? !(v.shot === undefined || v.shot === null) : !(typeof v.shot === "string" && SHOT_RE.test(v.shot))) return null;
  if (Object.hasOwn(v, "input") && !idText(v.input)) return null;
  if (Object.hasOwn(v, "inputs") && !(Array.isArray(v.inputs) && v.inputs.length >= 1 && v.inputs.length <= 3 && v.inputs.every(idText)
    && new Set(v.inputs).size === v.inputs.length)) return null;
  if (Object.hasOwn(v, "promptText") && !prompt(v.promptText)) return null;
  if (Object.hasOwn(v, "seconds") && !(Number.isInteger(v.seconds) && v.seconds >= 2 && v.seconds <= 10)) return null;
  if (Object.hasOwn(v, "ratio") && !(typeof v.ratio === "string" && /^[0-9]{3,4}:[0-9]{3,4}$/.test(v.ratio))) return null;
  if (Object.hasOwn(v, "scale") && v.scale !== 2 && v.scale !== 4) return null;
  return {
    kind: v.kind, batch: v.batch, shot: v.batch === null ? null : v.shot, input: v.input || null, inputs: v.inputs || null,
    promptText: v.promptText === undefined ? null : v.promptText, seconds: v.seconds === undefined ? null : v.seconds,
    ratio: v.ratio || null, scale: v.kind === "still_upscale" ? (v.scale || 2) : null,
  };
}

// The paths the door needs, from the config's names (or short ones).
function doorPaths(paths) {
  const p = paths || {};
  const pick = (...names) => names.map((n) => p[n]).find((v) => typeof v === "string" && v !== "");
  const out = {
    state: pick("doorsState", "state"),
    ids: pick("ids"),
    secret: pick("generateSecret", "secret"),
    status: pick("generateStatus", "status"),
    key: pick("runwayKey", "key"),
    ledger: pick("ledger"),
    batches: pick("batches"),
    work: pick("doorWork", "work"),
  };
  for (const k of Object.keys(out)) if (!out[k]) throw new Error(`createGenerateDoor: paths.${k} is needed`);
  // Step 5's two, optional: without them no app may spend and Higgsfield is signed out.
  out.allowances = pick("allowances") || null;
  out.higgsfieldAuth = pick("higgsfieldAuth") || null;
  return out;
}

// What the door does not send again, by its pictures' bytes (their hashes, never the upload's id,
// T48 F5): a refused job's pictures and prompt (a refused picture alone is kept in `marks`); and a
// request Runway did not start, as it was sent (its batch, shot, pictures and prompt).
const fingerprint = (kind, model, hashes, promptText) =>
  createHash("sha256").update(JSON.stringify([kind, model, [...(hashes || [])].sort(), promptText || ""])).digest("hex");
const resendPrint = (batch, shot, kind, model, hashes, promptText) =>
  createHash("sha256").update(JSON.stringify(["resend", batch, shot, kind, model, [...(hashes || [])].sort(), promptText || ""])).digest("hex");

// Step 5 helpers. A model of the table that Higgsfield makes.
const isHiggsfield = (model) => { const row = rowOf(model); return row !== null && row.provider === "higgsfield"; };
// A row's largest size: the one an agent's job (which names none) is made and priced at.
function topSize(row) {
  if (row.resolutions === null) return undefined;
  const by = row.price && row.price.byResolution;
  if (!by) return row.resolutions[row.resolutions.length - 1];
  return row.resolutions.reduce((best, r) => (by[r] > by[best] ? r : best), row.resolutions[0]);
}
// An agent's ratio in the row's own words: as it is, or by its lowest terms ("1920:1080" is "16:9").
function rowRatio(row, ratio) {
  if (typeof ratio !== "string") return null;
  if (row.ratios.includes(ratio)) return ratio;
  const m = /^([0-9]{1,5}):([0-9]{1,5})$/.exec(ratio);
  if (!m || Number(m[1]) === 0 || Number(m[2]) === 0) return null;
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(Number(m[1]), Number(m[2]));
  const low = `${Number(m[1]) / g}:${Number(m[2]) / g}`;
  return row.ratios.includes(low) ? low : null;
}
// Higgsfield credits in whole US cents at a rate (K20), rounded up; 0 when the rate is not one.
const centsOf = (units, rate) => (Number.isInteger(rate) && rate >= 1 && rate <= 50 && typeof units === "number" && Number.isFinite(units) && units >= 0
  ? Math.ceil(Math.round(units * rate * 1e6) / 1e6) : 0);
const rateOf = (gs) => (gs && gs.ok && gs.higgsfield ? gs.higgsfield.centsPerCredit : DEFAULT_CENTS_PER_CREDIT);

// `higgsfield` (step 5): { origin, redirectUri, net?, uploadSuffixes?, limits?, authLimits?, mcpLimits? }:
// Higgsfield's one origin (main) or a stand-in (tests), and the home server's sign-in return address.
// Without it the door has no Higgsfield: every Higgsfield job is refused `gen_hf_signed_out`.
export function createGenerateDoor({ listenPort, upstream, paths, config, log, now, net, limits, higgsfield } = {}) {
  const up = checkUpstream(upstream);
  const P = doorPaths(paths);
  const theNet = net === undefined ? REAL_NET : net;
  if (!theNet || typeof theNet.resolve !== "function" || typeof theNet.connect !== "function") {
    throw new Error("createGenerateDoor: net needs resolve and connect");
  }
  const agentList = config && config.doors && config.doors.generate && Array.isArray(config.doors.generate.agents)
    ? config.doors.generate.agents.filter((s) => typeof s === "string") : [];
  const appList = config && config.doors && config.doors.generate && Array.isArray(config.doors.generate.apps)
    ? config.doors.generate.apps.filter((s) => typeof s === "string") : [];
  const lim = { ...GEN_LIMITS, ...(limits || {}) };
  const clock = typeof now === "function" ? now : typeof now === "number" ? () => now : () => Date.now();
  const iso = () => new Date(clock()).toISOString();
  const say = (line) => {
    try {
      if (typeof log === "function") log(line);
      else if (typeof log === "string" && log) appendFileSync(log, `${line}\n`);
    } catch {
      // A log failure changes nothing.
    }
  };
  const ledger = createLedger(P.ledger);
  // Every write of the door's own marks the ledger read again for the status file; an answer
  // alone never reads it (T48 F1: a refusal must not cost a whole ledger read).
  let moneyStale = true;
  for (const name of ["reserve", "note", "settle", "pause"]) {
    const write = ledger[name];
    ledger[name] = (...args) => { moneyStale = true; return write(...args); };
  }
  const store = workStore(P.work);
  const running = new Map();   // job -> the job in memory, while Runway works on it
  const controllers = new Set();
  let closing = false;
  // What Runway refused or did not start before, so it is not sent again: fingerprints of refused
  // jobs, the byte hashes of pictures Runway refused or could not use (with any prompt), and
  // requests not started, as sent. Filled from the door's own job records at its start and as jobs
  // end, so a job request reads no other job's record. And the time before which Runway's 429 said
  // not to ask again (Date.now() ms, this run only).
  const marks = { refused: new Set(), pictures: new Set(), resend: new Set() };
  let limitedUntil = 0;

  // ---- Higgsfield (K21): the owner's sign-in, the MCP client and the door's tools ----------------
  if (higgsfield && !P.higgsfieldAuth) throw new Error("createGenerateDoor: paths.higgsfieldAuth is needed for Higgsfield");
  const hf = higgsfield ? (() => {
    const hfNet = higgsfield.net === undefined ? theNet : higgsfield.net;
    const auth = createHfAuth({ origin: higgsfield.origin, file: P.higgsfieldAuth, redirectUri: higgsfield.redirectUri, net: hfNet, now: clock, log: say,
      limits: higgsfield.authLimits });
    const mcp = createMcpClient({ origin: higgsfield.origin, token: (o) => auth.token(o), net: hfNet, log: say, limits: higgsfield.mcpLimits });
    const tools = createHiggsfield({ mcp, net: hfNet, uploadSuffixes: higgsfield.uploadSuffixes, limits: higgsfield.limits });
    return { auth, mcp, tools };
  })() : null;
  const hfStatus = () => (hf ? hf.auth.status() : { signedIn: false, refused: false });

  // ---- the running limit (K20): two at once for one caller, an agent or an app, and four in all.
  // A Higgsfield job holds its place from its checks to its reservation (its uploads and price
  // question come between), so two cannot both pass the limit only one fits.
  const starting = new Map();   // caller -> Higgsfield jobs checked but not yet reserved
  let startingAll = 0;
  function busyFor(slug) {
    let mine = starting.get(slug) || 0;
    for (const j of running.values()) if (j.slug === slug) mine += 1;
    if (mine >= MAX_RUNNING) return "Two jobs are already running. Wait for one to finish.";
    if (running.size + startingAll >= MAX_RUNNING_ALL) return "Four jobs are already running in all. Wait for one to finish.";
    return null;
  }
  function claim(slug) {
    starting.set(slug, (starting.get(slug) || 0) + 1);
    startingAll += 1;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      const n = (starting.get(slug) || 1) - 1;
      if (n > 0) starting.set(slug, n);
      else starting.delete(slug);
      startingAll -= 1;
    };
  }

  // ---- the status file ------------------------------------------------------
  const status = {
    startedAt: null, on: false, key: false, running: 0, today: { day: null, jobs: 0, credits: 0, refused: 0 }, lastAt: null,
    higgsfield: { signedIn: false, refused: false }, apps: {},
  };
  const statusOut = statusFile(P.status);
  function touch(what) {
    const day = dayOf(clock());
    if (status.today.day !== day) {
      status.today = { day, jobs: 0, credits: 0, refused: 0 };
      moneyStale = true;
    }
    if (what) status.today[what] += 1;
    if (moneyStale) {
      moneyStale = false;
      const t = ledger.totals(clock());
      if (t.ok) status.today.credits = t.day;
      status.apps = appsToday();
    }
    status.higgsfield = hfStatus();
    status.running = running.size;
    status.lastAt = iso();
    statusOut.save(status);
  }

  // Today's jobs and cents for each app, from the ledger (the status file's `apps`); {} when it
  // cannot be read.
  function appsToday() {
    const r = ledger.read();
    if (!r.ok) return {};
    const day = dayOf(clock());
    const extras = extrasByJob(r.lines);
    const out = {};
    for (const j of summarize(r.lines).jobs.values()) {
      const app = extras.has(j.job) ? extras.get(j.job).app : undefined;
      if (typeof app !== "string" || dayOf(j.at) !== day) continue;
      if (!Object.hasOwn(out, app)) out[app] = { jobs: 0, cents: 0 };
      out[app].jobs += 1;
      out[app].cents += j.charge;
    }
    return out;
  }

  // ---- answers --------------------------------------------------------------
  function no(res, code, sentence, extra) {
    say(`${iso()} refused ${code}`);
    touch("refused");
    const [st, def] = CODES[code] || [403, "The generation door refused this request."];
    return refuse(res, st, code, sentence || def, extra);
  }

  // ---- jobs in memory and on disk -----------------------------------------------
  function record(j, fields) {
    Object.assign(j.record, fields);
    try { store.saveJob(j.record); } catch { say(`${iso()} job record not written ${j.job}`); }
  }
  const knownCharge = (j, t) => Math.max(j.estimate, j.known || 0, (t && t.cost) || 0, (t && t.estimated) || 0);

  // Ends a job's money: released (0) only when Runway's own answer said its cost was 0 for a
  // job that failed or was cancelled; otherwise spent at the highest of what is known.
  function settle(j, t, verdict, allowZero) {
    const zero = allowZero && t && t.costZero;
    const amount = zero ? 0 : knownCharge(j, t);
    try {
      ledger.settle(iso(), j, { state: zero ? "released" : "spent", credits: amount, verdict, runwayTask: j.runwayTask });
    } catch {
      say(`${iso()} ledger not written for ${j.job}; its reservation stays counted`);
    }
    say(`${iso()} end ${j.job} ${verdict} credits=${amount}`);
    return amount;
  }

  function endJob(j, state, fields) {
    running.delete(j.job);
    record(j, { state, endedAt: iso(), ...fields });
    touch();
  }

  async function cancel(j) {
    const key = readRunwayKey(P.key);
    if (key && j.runwayTask) await callRunway(up, { method: "DELETE", path: taskPath(j.runwayTask), key, limits: lim });
  }

  // When the door has now seen three refusals, or three requests Runway did not start, in a day
  // (since the owner last started it again), it pauses itself in the ledger.
  function maybePause() {
    const gs = readGenState(P.state, clock());
    const t = ledger.totals(clock(), { resumedAt: gs.ok ? gs.resumedAt : null });
    if (!t.ok || t.paused) return;
    const refusals = t.refusedRecent >= REFUSALS_TO_PAUSE;
    if (!refusals && t.notStartedRecent < NOT_STARTED_TO_PAUSE) return;
    try {
      ledger.pause(iso(), refusals ? "three_refusals" : "three_not_started");
      say(`${iso()} paused after ${refusals ? `${t.refusedRecent} refusals` : `${t.notStartedRecent} requests Runway did not start`}`);
    } catch {
      say(`${iso()} ledger not written for a pause`);
    }
  }

  async function download(j, t, key) {
    const url = t.output[0];
    const want = VIDEO_KINDS.includes(j.kind) ? "video" : "picture";
    const bad = (why) => ({ ok: false, why });
    if (typeof url !== "string") return bad("no_address");
    if (holdsKey(url, key)) return bad("key_in_address");
    const a = checkAddress(url);
    if (!a.ok || !a.secure) return bad("address");
    const ctl = new AbortController();
    controllers.add(ctl);
    let r;
    try {
      r = await fetchPublic(a.href, {
        net: theNet, signal: ctl.signal,
        limits: { maxRedirects: 0, maxBytes: want === "video" ? lim.videoBytes : lim.pictureBytes, types: null, totalMs: lim.downloadMs },
      });
    } finally {
      controllers.delete(ctl);
    }
    if (!r.ok) return bad(r.code);
    if (r.status !== 200) return bad("status");
    const kind = sniffOutput(r.body, want);
    if (!kind) return bad("not_media");
    return { ok: true, kind, body: r.body, host: r.host };
  }

  async function succeeded(j, t, key) {
    const credits = settle(j, t, "done", false);
    const got = await download(j, t, key);
    if (closing) return;
    if (!got.ok) {
      say(`${iso()} output refused ${j.job} ${got.why}`);
      return endJob(j, "failed", { credits, progress: 1, reason: "Runway made it and it is paid for, but its result was not safe to fetch, so nothing was kept." });
    }
    try {
      store.saveOutput(j.job, got.kind.ext, got.body);
    } catch {
      return endJob(j, "failed", { credits, progress: 1, reason: "The result could not be kept on this Mac." });
    }
    say(`${iso()} output ${j.job} ${got.host} ${got.body.length}`);
    return endJob(j, "done", { credits, progress: 1, reason: null, output: { ext: got.kind.ext, type: got.kind.type, bytes: got.body.length } });
  }

  function failed(j, t, key) {
    const kind = failureKind(t.failureCode);
    const words = scrub(t.failure || "", key);
    if (kind === "refused" || kind === "bad_input") {
      for (const id of j.inputIds) store.markInputRefused(id);
      for (const h of j.inputSha256) marks.pictures.add(h);
    }
    if (kind === "refused" && j.record && typeof j.record.fingerprint === "string") marks.refused.add(j.record.fingerprint);
    const credits = settle(j, t, kind === "refused" ? "refused" : kind, true);
    if (kind === "refused") {
      endJob(j, "refused", { credits, reason: `Runway refused this picture or prompt. It will not be sent again.${words ? ` Runway said: ${words}` : ""}`, failureCode: t.failureCode });
      maybePause();
      return;
    }
    const lead = kind === "bad_input" ? "Runway could not use this picture." : "Runway could not make this. It may work later.";
    endJob(j, "failed", { credits, reason: `${lead}${words ? ` Runway said: ${words}` : ""}`, failureCode: t.failureCode });
  }

  async function giveUp(j, sentence) {
    await cancel(j);
    const credits = settle(j, null, "unknown", false);
    endJob(j, "failed", { credits, reason: sentence });
  }

  // Handles one task answer; true when the job has ended.
  async function onTask(j, t, key) {
    if (t.estimated !== null) j.known = Math.max(j.known || 0, t.estimated);
    if (t.status === "SUCCEEDED") { await succeeded(j, t, key); return true; }
    if (t.status === "FAILED") { failed(j, t, key); return true; }
    if (t.status === "CANCELLED") {
      const credits = settle(j, t, "cancelled", true);
      endJob(j, "failed", { credits, reason: "Runway cancelled this job." });
      return true;
    }
    if (t.status === "RUNNING") record(j, { state: "working", progress: t.progress });
    else record(j, { state: "waiting" });
    return false;
  }

  const wait = (ms, signal) => new Promise((resolve) => {
    if (signal.aborted) return resolve(true);
    const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(false); }, ms);
    const stop = () => { clearTimeout(timer); resolve(true); };
    signal.addEventListener("abort", stop, { once: true });
  });

  // Asks Runway about the task every pollMs until it ends, the job's time is up, or Runway
  // stops answering clearly. Closing the door leaves the reservation for the next start.
  async function track(j) {
    const ctl = new AbortController();
    controllers.add(ctl);
    const deadline = j.startedMs + lim.jobMs;
    let errors = 0;
    try {
      for (;;) {
        if (await wait(lim.pollMs, ctl.signal) || closing) return;
        if (Date.now() >= deadline) return void await giveUp(j, "Runway did not finish in 20 minutes. The job was stopped and its cost stays counted.");
        const key = readRunwayKey(P.key);
        const r = key ? await callRunway(up, { method: "GET", path: taskPath(j.runwayTask), key, limits: lim, signal: ctl.signal }) : { ok: false };
        if (closing) return;
        if (r.ok && r.status === 404) {
          const credits = settle(j, null, "cancelled", false);
          return void endJob(j, "failed", { credits, reason: "Runway no longer has this job." });
        }
        const t = r.ok && r.status === 200 ? readTask(r.json) : null;
        if (!t || t.id !== j.runwayTask || t.status === "UNKNOWN") {
          errors += 1;
          if (errors >= lim.pollErrors) return void await giveUp(j, "Runway stopped answering clearly about this job. Its cost stays counted.");
          continue;
        }
        errors = 0;
        if (await onTask(j, t, key)) return;
      }
    } catch (err) {
      say(`${iso()} job ${j.job} stopped: ${describeError(err)}`);
    } finally {
      controllers.delete(ctl);
    }
  }

  // ---- checks ------------------------------------------------------------------
  const caller = (req) => checkCaller({ rawHeaders: req.rawHeaders, secretPath: P.secret, idsPath: P.ids, agents: agentList, apps: appList, now: clock() });

  // Rows 3 and 4 for this route: a code, or { who, gs, key }.
  function admitted(req, r) {
    const who = caller(req);
    if (who === null || typeof who !== "object") return "gen_no_token";
    // An app (K19): its own routes only, and only an app on them. It needs no Artist's switch and
    // no Runway key here (each model's service is checked at its job); a pause holds it too.
    if (who.kind === "p" || r.app) {
      if (who.kind !== "p" || !r.app) return "gen_no_token";
      const gs = readGenState(P.state, clock());
      status.on = gs.ok && gs.on;
      if (!gs.ok) return "gen_off";
      if (r.spends) {
        if (gs.paused !== null) return "gen_paused";
        const t = ledger.totals(clock(), { resumedAt: gs.resumedAt });
        if (t.ok && t.paused) return "gen_paused";
      }
      return { who, gs, key: readRunwayKey(P.key) };
    }
    if (r.owner && who.kind !== "t") return "gen_no_token";
    if (!r.owner && !r.either && who.kind !== "a") return "gen_no_token";
    const gs = readGenState(P.state, clock());
    status.on = gs.ok && gs.on;
    const owner = who.kind === "t";
    if (!owner && (!gs.ok || !gs.on)) return "gen_off";
    let key = null;
    if (r.spends || (r.owner && !r.hf)) {
      if (!owner) {
        if (gs.paused !== null) return "gen_paused";
        const t = ledger.totals(clock(), { resumedAt: gs.resumedAt });
        if (t.ok && t.paused) return "gen_paused";
      }
      key = readRunwayKey(P.key);
      // With Higgsfield on, an agent may work without a Runway key: a Runway job is refused at its
      // model (doJob), a Higgsfield one goes on.
      if (key === null && !(r.spends && !owner && gs.higgsfield.on)) return "gen_no_key";
    }
    return { who, gs, key };
  }

  // The money: a code (with an optional sentence), or null when `cost` fits every limit.
  function overLimit(gs, t, cost, batch) {
    if (gs.dailyCredits === 0 || gs.monthlyCredits === 0) return "gen_cap_zero";
    if (t.day + cost > gs.dailyCredits) return "gen_over_daily";
    if (t.month + cost > gs.monthlyCredits) return "gen_over_monthly";
    if (batch && t.batch + cost > batch.budgetCredits) return "gen_over_batch";
    return null;
  }

  // ---- the routes ----------------------------------------------------------------
  function takeInput(res, slug, raw, type, { kept = INPUTS_KEPT, full = "This agent already keeps 40 pictures from the last day." } = {}) {
    if (type === undefined || raw.length < INPUT_MIN) return no(res, "gen_bad_input");
    const pic = sniffPicture(raw);
    if (!pic || pic.type !== type) return no(res, "gen_bad_input");
    const at = clock();
    store.sweep(at);
    if (store.countInputs(slug, at) >= kept) return no(res, "gen_bad_input", full);
    let rec;
    try {
      rec = store.saveInput(slug, pic, raw, at);
    } catch {
      return no(res, "gen_bad_input", "The picture could not be kept on this Mac.");
    }
    say(`${iso()} input ${slug} ${pic.type} ${raw.length}`);
    return sendJson(res, 201, { input: rec.id, type: rec.type, width: rec.width, height: rec.height, bytes: rec.bytes });
  }

  function doEstimate(res, buf, gs) {
    const v = parseObject(buf);
    if (!v || Object.keys(v).length !== 1 || !Array.isArray(v.items) || v.items.length < 1 || v.items.length > 50) return no(res, "gen_bad_request");
    const out = [];
    for (const it of v.items) {
      if (!it || typeof it !== "object" || Array.isArray(it) || !Object.keys(it).every((k) => ["kind", "model", "seconds"].includes(k))) return no(res, "gen_bad_request");
      if (!KINDS.includes(it.kind)) return no(res, "gen_bad_request");
      const model = it.model === undefined ? defaultModel(it.kind, gs.ok ? gs.models : null) : it.model;
      const seconds = VIDEO_KINDS.includes(it.kind) ? it.seconds : null;
      const credits = agentPrice(it.kind, model, seconds, gs);
      if (credits === null) return no(res, "gen_no_price");
      out.push({ kind: it.kind, model, seconds, credits });
    }
    return sendJson(res, 200, { items: out, total: out.reduce((s, x) => s + x.credits, 0) });
  }

  async function doJob(res, who, body, gs, key) {
    const slug = who.slug;
    const at = clock();
    // Runway said too many requests: nothing goes out until the wait it named has passed.
    const hold = limitedUntil - Date.now();
    if (hold > 0) return no(res, "gen_limited", undefined, { retryAfterSec: Math.ceil(hold / 1000) });
    // The inputs: only this agent's, kept in the last day, never one Runway refused.
    const ids = body.kind === "still_variation" ? body.inputs : body.input ? [body.input] : [];
    const pictures = [];
    for (const id of ids) {
      const pic = store.readInput(slug, id, at);
      if (!pic) return no(res, "gen_bad_request", "An input is not one this agent sent in the last day.");
      if (pic.refused || marks.pictures.has(pic.sha256)) return no(res, "gen_not_approved", "Runway refused this picture before. The door will not send it again.");
      pictures.push(pic);
    }
    if (body.kind === "still_upscale") {
      const p = pictures[0];
      if (Math.min(p.width, p.height) < 300 || Math.max(p.width, p.height) > 8000 || Math.max(p.width, p.height) * body.scale > UPSCALE_MAX_SIDE) {
        return no(res, "gen_bad_request", "An upscale needs a picture of 300 px or more a side whose result stays within 4096 px.");
      }
    }
    // Row 7, the owner's yes, and row 8, the money: read now, and the reservation written
    // before anything else can run, so two jobs cannot both fit a limit only one fits.
    const t = ledger.totals(at, { batch: body.batch, resumedAt: gs.resumedAt });
    if (!t.ok) return no(res, "gen_ledger");
    // Paused by the counts themselves, even when the pause line could not be written.
    if (t.refusedRecent >= REFUSALS_TO_PAUSE || t.notStartedRecent >= NOT_STARTED_TO_PAUSE) return no(res, "gen_paused");
    let batch = null;
    let model;
    if (body.batch !== null) {
      const b = readBatch(P.batches, body.batch, { slug, now: at });
      if (!b.ok) {
        const why = {
          expired: "This batch's approval has ended. Ask the owner again.",
          other_agent: "This batch was approved for another agent.",
        }[b.why];
        return no(res, "gen_not_approved", why || "No batch the owner approved has this name.");
      }
      batch = b.batch;
      if (batch.frozen || t.batchRefused >= REFUSALS_TO_FREEZE) return no(res, "gen_not_approved", "Runway refused two pictures or prompts in this film. It needs you.");
      const shot = batch.shots[body.shot];
      if (!shot) return no(res, "gen_not_approved", "This shot is not in the batch the owner approved.");
      if (shot.kind !== body.kind || (VIDEO_KINDS.includes(body.kind) && body.seconds > shot.maxSeconds)) {
        return no(res, "gen_not_approved", "This is more than the owner approved for this shot.");
      }
      if (body.kind === "text_to_video" && !batch.textToVideo) return no(res, "gen_not_approved", "The owner did not approve video from text alone.");
      if (t.takes(body.shot) >= shot.takes) return no(res, "gen_not_approved", "This shot has had every take the owner approved.");
      if (t.notStarted(body.shot) >= NOT_STARTED_PER_SHOT) return no(res, "gen_not_approved", "Runway did not start this shot twice. It needs you.");
      model = shot.model;
    } else {
      if (body.kind === "text_to_video") return no(res, "gen_not_approved", "Video from text alone needs the owner's approval.");
      model = defaultModel(body.kind, gs.models);
    }
    if (isHiggsfield(model)) return hfAgentJob(res, who, body, gs, { t, batch, model, pictures, ids });   // step 5: K21's flow
    if (key === null) return no(res, "gen_no_key");
    if (!priced(model) || !PRICES[model].kinds.includes(body.kind)) return no(res, "gen_no_price");
    if (!chosen(body.kind, model, gs.models)) return no(res, "gen_not_approved", "This model is not the one chosen in Settings.");
    if (body.kind !== "still_upscale" && !ratioFits(model, body.ratio)) return no(res, "gen_bad_request", "This shape of picture is not one this model makes.");
    const cost = estimate({ kind: body.kind, model, seconds: body.seconds });
    if (cost === null) return no(res, "gen_no_price");
    if (batch === null && t.unasked + cost > gs.autoUnderCredits) {
      return no(res, "gen_not_approved", "Nothing is spent without the owner's approval of a batch.");
    }
    const hashes = pictures.map((p) => p.sha256);
    const print = fingerprint(body.kind, model, hashes, body.promptText);
    if (marks.refused.has(print)) {
      return no(res, "gen_not_approved", "Runway refused this same picture or prompt before. The door will not send it again.");
    }
    const resend = resendPrint(body.batch, body.shot, body.kind, model, hashes, body.promptText);
    if (marks.resend.has(resend)) return no(res, "gen_not_approved", "Runway did not start this same request before. The door will not send it again.");
    const busy = busyFor(slug);
    if (busy) return no(res, "gen_busy", busy, { retryAfterSec: 30 });
    const over = overLimit(gs, t, cost, batch);
    if (over) return no(res, over);
    const j = {
      job: newId("g"),
      batch: body.batch, shot: body.shot, slug, kind: body.kind, model, seconds: body.seconds, estimate: cost,
      known: 0, runwayTask: null, startedMs: Date.now(), inputIds: ids, inputSha256: hashes, record: null,
    };
    try {
      ledger.reserve(iso(), { job: j.job, batch: j.batch, shot: j.shot, slug, kind: j.kind, model, seconds: j.seconds, estimate: cost });
    } catch {
      return no(res, "gen_ledger");
    }
    running.set(j.job, j);
    // The record keeps what was sent (T48 F3): the prompt as sent and each input's byte hash, in
    // the order of `inputs`, for the owner's film view.
    j.record = {
      job: j.job, slug, kind: j.kind, model, seconds: j.seconds, batch: j.batch, shot: j.shot, estimate: cost, fingerprint: print,
      state: "waiting", progress: null, credits: cost, reason: null, runwayTask: null, output: null, startedAt: iso(), endedAt: null, inputs: ids,
      prompt: typeof body.promptText === "string" ? body.promptText.slice(0, PROMPT_KEPT) : null, inputSha256: hashes, resend, notStarted: null,
    };
    record(j, {});
    say(`${iso()} job ${slug} ${j.job} ${j.kind} ${model} ${j.seconds || 0}s est=${cost}`);
    touch("jobs");

    // The one call out.
    const req = buildRequest({ kind: j.kind, model, promptText: body.promptText, seconds: j.seconds, ratio: body.ratio, scale: body.scale, pictures });
    const r = await callRunway(up, { method: "POST", path: req.path, key, json: req.body, limits: lim });
    const created = r.ok && r.status >= 200 && r.status < 300 ? readTask(r.json) : null;
    if (created && created.id) {
      j.runwayTask = created.id;
      j.known = created.estimated || 0;
      try {
        ledger.note(iso(), j, { credits: Math.max(cost, j.known), runwayTask: j.runwayTask });
      } catch {
        say(`${iso()} ledger not written for ${j.job}'s task; its reservation stays counted`);
      }
      record(j, { runwayTask: j.runwayTask, credits: Math.max(cost, j.known) });
      // Runway's own price is higher than the table's: if that no longer fits, stop it now.
      if (j.known > cost) {
        const again = ledger.totals(clock(), { batch: j.batch, resumedAt: gs.resumedAt });
        const code = again.ok ? overLimit(gs, again, 0, batch) : "gen_ledger";
        if (code) {
          await cancel(j);
          const credits = settle(j, created, "stopped", false);
          endJob(j, "failed", { credits, reason: "Runway's price was higher than the door's and went over a limit, so the job was stopped." });
          return no(res, code);
        }
      }
      sendJson(res, 202, { job: j.job, estimate: cost });
      track(j);
      return undefined;
    }
    // Not started. A clear refusal (4xx) cost nothing; anything else may have started a task
    // the door cannot see, so its estimate stays counted.
    const words = r.ok ? errorText(r.json, key) : "";
    const clear = r.ok && r.status >= 400 && r.status < 500;
    const retrySec = r.ok && r.retryAfter !== null ? Math.max(1, Math.min(r.retryAfter, 86400)) : LIMITED_SEC;
    if (clear) {
      try {
        ledger.settle(iso(), j, { state: "released", credits: 0, verdict: `not_started_${r.status}` });
      } catch {
        say(`${iso()} ledger not written for ${j.job}; its reservation stays counted`);
      }
    } else {
      settle(j, null, "unknown", false);
    }
    endJob(j, "failed", { credits: clear ? 0 : cost, reason: words ? `Runway did not start it. Runway said: ${words}` : "Runway did not start it.", notStarted: clear ? r.status : null });
    if (clear) {
      // Free, so it is counted (two a shot, three a day pause the door); a 429's wait is kept at
      // the door; and the same request is not sent again, but after a 401 (the owner may mend the
      // key) or a 429 (the role's one resend after the wait).
      if (r.status === 429) limitedUntil = Math.max(limitedUntil, Date.now() + retrySec * 1000);
      else if (r.status !== 401) marks.resend.add(resend);
      maybePause();
    }
    if (r.ok && r.status === 401) return no(res, "gen_key_refused");
    if (r.ok && r.status === 429) return no(res, "gen_limited", undefined, { retryAfterSec: retrySec });
    return no(res, "gen_could_not_start", words ? `Runway did not start this job. Runway said: ${words}` : undefined);
  }

  function doGetJob(res, who, job) {
    const rec = store.readJob(job);
    if (!rec || rec.slug !== who.slug) return no(res, "gen_not_found");
    return sendJson(res, 200, {
      job: rec.job, state: rec.state, progress: rec.progress, credits: rec.credits, reason: rec.reason,
      output: rec.output ? { type: rec.output.type, bytes: rec.output.bytes } : null,
    });
  }

  function doOutput(res, who, job) {
    const rec = store.readJob(job);
    if (!rec || rec.slug !== who.slug) return no(res, "gen_not_found");
    if (rec.state !== "done" || !rec.output) return no(res, "gen_not_ready");
    const h = store.openOutput(job, rec.output.ext, rec.output.bytes);
    if (!h) return no(res, "gen_not_ready");
    res.writeHead(200, {
      "Content-Type": rec.output.type, "Content-Length": h.size, "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", Connection: "close",
    });
    const s = createReadStream(null, { fd: h.fd, autoClose: true });
    s.on("error", () => res.destroy());
    s.pipe(res);
    return undefined;
  }

  async function doBalance(res, key) {
    const r = await callRunway(up, { method: "GET", path: ORGANIZATION_PATH, key, limits: lim });
    say(`${iso()} balance owner ${r.ok ? r.status : r.why}`);
    if (r.ok && r.status === 401) return no(res, "gen_key_refused");
    if (r.ok && r.status === 429) return no(res, "gen_limited", undefined, { retryAfterSec: r.retryAfter !== null ? Math.min(r.retryAfter, 86400) : 60 });
    if (!r.ok || r.status !== 200 || !r.json) return no(res, "gen_could_not_start", "Runway did not answer the balance question.");
    const tier = r.json.tier && typeof r.json.tier === "object" ? r.json.tier : {};
    return sendJson(res, 200, { creditBalance: creditsOf(r.json.creditBalance), maxMonthlyCreditSpend: creditsOf(tier.maxMonthlyCreditSpend) });
  }

  // ---- step 5: Higgsfield and apps (K19 to K22) ---------------------------------------------------

  // Whether Higgsfield may be used now: null, or the code that says why not (K19 row A2).
  function hfNotReady(gs) {
    if (!gs || !gs.higgsfield || !gs.higgsfield.on) return "gen_hf_off";
    if (!hf) return "gen_hf_signed_out";
    const st = hf.auth.status();
    if (st.refused) return "gen_hf_refused";
    return st.signedIn ? null : "gen_hf_signed_out";
  }
  // A sign-in reason from Higgsfield's modules as the door's code, or null.
  const hfCode = (why) => (why === "refused" || why === "unauthorized" ? "gen_hf_refused" : why === "signed_out" ? "gen_hf_signed_out" : null);

  // An agent's price in cents (K20): step 3's five Runway rows as step 3 priced them; a Higgsfield
  // row at its largest size, at the owner's rate. Null when the door has no price.
  function agentPrice(kind, model, seconds, gs) {
    const row = rowOf(model);
    if (row === null || (row.provider === "runway" && !priced(model))) return null;
    const item = { kind, model, seconds: VIDEO_KINDS.includes(kind) ? seconds : undefined, resolution: row.provider === "higgsfield" ? topSize(row) : undefined };
    return estimateCents(item, { centsPerCredit: rateOf(gs) });
  }

  // `p` (the door's own kept picture) to Higgsfield and back is the same picture; these four turn
  // an agent's job into the row's words.
  async function hfAgentJob(res, who, body, gs, { t, batch, model, pictures, ids }) {
    const slug = who.slug;
    if (batch === null) return no(res, "gen_not_approved", "Higgsfield is used only inside a batch the owner approved.");
    const nr = hfNotReady(gs);
    if (nr) return no(res, nr);
    const row = rowOf(model);
    if (!row.kinds.includes(body.kind)) return no(res, "gen_no_price");
    if (!chosen(body.kind, model, gs.models)) return no(res, "gen_not_approved", "This model is not the one chosen in Settings.");
    const role = body.kind === "still_variation" ? "ref" : body.kind === "still_upscale" ? "image" : row.refs.roles.includes("first") ? "first" : "ref";
    if (pictures.length > row.refs.max || (pictures.length > 0 && !row.refs.roles.includes(role))) return no(res, "gen_bad_request", "This model takes other pictures.");
    const ratio = row.ratios === null ? null : rowRatio(row, body.ratio);
    if (row.ratios !== null && ratio === null) return no(res, "gen_bad_request", "This shape of picture is not one this model makes.");
    const seconds = VIDEO_KINDS.includes(body.kind) ? body.seconds : null;
    if (seconds !== null && !(row.seconds && (row.seconds.list ? row.seconds.list.includes(seconds) : seconds >= row.seconds.min && seconds <= row.seconds.max))) {
      return no(res, "gen_bad_request", "These seconds are not ones this model makes.");
    }
    if (body.kind === "still_upscale" && !upscaleFits(row, pictures[0].width, pictures[0].height, body.scale)) {
      return no(res, "gen_bad_request", "An upscale's result must stay within the model's size.");
    }
    const rate = gs.higgsfield.centsPerCredit;
    const item = { kind: body.kind, model, seconds: seconds === null ? undefined : seconds, resolution: topSize(row), refs: pictures.length };
    const units = estimateUnits(item);
    const cost = estimateCents(item, { centsPerCredit: rate });
    if (units === null || cost === null) return no(res, "gen_no_price");
    const hashes = pictures.map((p) => p.sha256);
    const print = fingerprint(body.kind, model, hashes, body.promptText);
    if (marks.refused.has(print)) return no(res, "gen_not_approved", "Higgsfield refused this same picture or prompt before. The door will not send it again.");
    const resend = resendPrint(body.batch, body.shot, body.kind, model, hashes, body.promptText);
    if (marks.resend.has(resend)) return no(res, "gen_not_approved", "Higgsfield did not start this same request before. The door will not send it again.");
    const busy = busyFor(slug);
    if (busy) return no(res, "gen_busy", busy, { retryAfterSec: 30 });
    const over = overLimit(gs, t, cost, batch);
    if (over) return no(res, over);
    return hfRun(res, {
      slug, app: null, row, kind: body.kind, model, seconds, prompt: body.promptText || "", ratio, resolution: topSize(row) || null,
      pictures: pictures.map((p) => ({ ...p, role })), ids, hashes, cost, units, rate, batchId: body.batch, shot: body.shot, print, resend,
      reply: (j) => ({ job: j.job, estimate: cost }),
    });
  }

  // Everything checked again just before the reservation of a Higgsfield job (its uploads and
  // price question came between): the switches, the sign-in, the pause, the ledger, the owner's
  // batch or allowance and every cap. Null, or [code, sentence?].
  function recheck(c) {
    const gs = readGenState(P.state, clock());
    if (!gs.ok || (c.app === null && !gs.on)) return ["gen_off"];
    if (gs.paused !== null) return ["gen_paused"];
    const nr = hfNotReady(gs);
    if (nr) return [nr];
    const t = ledger.totals(clock(), { batch: c.batchId, resumedAt: gs.resumedAt });
    if (!t.ok) return ["gen_ledger"];
    if (t.paused || t.refusedRecent >= REFUSALS_TO_PAUSE || t.notStartedRecent >= NOT_STARTED_TO_PAUSE) return ["gen_paused"];
    if (c.app !== null) {
      const a = readAllowance(P.allowances, c.app, clock());
      if (!a.ok || a.allowance.id !== c.batchId) return ["gen_no_allowance"];
      const code = overApp(gs, t, c.cost, a.allowance);
      return code ? [code] : null;
    }
    const b = readBatch(P.batches, c.batchId, { slug: c.slug, now: clock() });
    if (!b.ok) return ["gen_not_approved", "This batch's approval has ended. Ask the owner again."];
    if (b.batch.frozen || t.batchRefused >= REFUSALS_TO_FREEZE) return ["gen_not_approved", "Runway or Higgsfield refused two pictures or prompts in this film. It needs you."];
    const shot = b.batch.shots[c.shot];
    if (!shot || shot.model !== c.model || shot.kind !== c.kind) return ["gen_not_approved", "This shot is not in the batch the owner approved."];
    if (t.takes(c.shot) >= shot.takes) return ["gen_not_approved", "This shot has had every take the owner approved."];
    if (!chosen(c.kind, c.model, gs.models)) return ["gen_not_approved", "This model is not the one chosen in Settings."];
    const code = overLimit(gs, t, c.cost, b.batch);
    return code ? [code] : null;
  }

  // The money for an app's job (K19 row A5): the caps shared with the Artist, then the allowance.
  function overApp(gs, t, cost, allowance) {
    const code = overLimit(gs, t, cost, null);
    if (code) return code;
    return t.batch + cost > allowance.budgetCents ? "gen_over_allowance" : null;
  }

  // A Higgsfield job, K21's flow, for an agent or an app whose checks have passed: the uploads, the
  // live price as a guard, everything checked again, the reservation (synced), the call, and then
  // jobs_wait until it ends. `c` carries the checked job and its price in units and cents.
  async function hfRun(res, c) {
    const release = claim(c.slug);
    try {
      const medias = [];
      for (const p of c.pictures) {
        const up = await hf.tools.upload({ type: p.type, bytes: p.bytes });
        if (!up.ok) {
          say(`${iso()} higgsfield upload not made ${up.why}`);
          const code = hfCode(up.why);
          if (code) return no(res, code);
          return no(res, "gen_could_not_start", up.why === "upload_host_unknown"
            ? "The door does not know Higgsfield's upload address yet, so no picture can go to Higgsfield. Nothing was spent."
            : "Higgsfield did not take the picture, so nothing was spent.");
        }
        medias.push({ mediaId: up.mediaId, role: p.role });
      }
      const params = { kind: c.kind, prompt: c.prompt, ratio: c.ratio, resolution: c.resolution, seconds: c.seconds, medias };
      if (c.kind === "still_upscale") Object.assign(params, { width: c.pictures[0].width, height: c.pictures[0].height });
      // Higgsfield's live price: never the price, only a guard (K20).
      const live = await hf.tools.cost(c.row, params);
      if (!live.ok) {
        if (live.why === "job_started") {
          chargeStarted(c, live.jobId);
          return no(res, "gen_could_not_start", "Higgsfield started a job when asked only for its price. Its cost is counted.");
        }
        say(`${iso()} higgsfield price not given ${live.why}`);
        const code = hfCode(live.why);
        return code ? no(res, code) : no(res, "gen_could_not_start", "Higgsfield did not say its price, so nothing was spent.");
      }
      if (live.credits > c.units) {
        say(`${iso()} higgsfield price ${live.credits} over the table's ${c.units} for ${c.model}`);
        return no(res, "gen_price_changed");
      }
      if (closing) return no(res, "gen_could_not_start", "The door is stopping. Nothing was spent.");
      const again = recheck(c);
      if (again) return no(res, again[0], again[1]);
      const j = {
        job: newId("g"), batch: c.batchId, shot: c.shot, slug: c.slug, kind: c.kind, model: c.model, seconds: c.seconds, estimate: c.cost,
        known: 0, runwayTask: null, startedMs: Date.now(), inputIds: c.ids, inputSha256: c.hashes, record: null,
        provider: "higgsfield", units: c.units, rate: c.rate, ...(c.app ? { app: c.app } : {}),
      };
      try {
        ledger.reserve(iso(), {
          job: j.job, batch: j.batch, shot: j.shot, slug: j.slug, kind: j.kind, model: j.model, seconds: j.seconds, estimate: c.cost,
          provider: "higgsfield", units: c.units, rate: c.rate, ...(c.app ? { app: c.app } : {}),
        });
      } catch {
        return no(res, "gen_ledger");
      }
      running.set(j.job, j);
      release();
      j.record = jobRecord(j, c);
      record(j, {});
      say(`${iso()} job ${c.slug} ${j.job} ${j.kind} ${j.model} ${j.seconds || 0}s est=${c.cost} higgsfield`);
      touch("jobs");

      // The one call out.
      const s = await hf.tools.start(c.row, params);
      if (s.ok) {
        j.runwayTask = s.jobId;
        if (s.credits !== null && s.credits > j.units) {
          j.units = s.credits;
          j.known = centsOf(s.credits, j.rate);
        }
        const held = Math.max(c.cost, j.known);
        try {
          ledger.note(iso(), j, { credits: held, runwayTask: j.runwayTask });
        } catch {
          say(`${iso()} ledger not written for ${j.job}'s task; its reservation stays counted`);
        }
        record(j, { runwayTask: j.runwayTask, credits: held });
        sendJson(res, 202, c.reply(j));
        trackHf(j);
        return undefined;
      }
      // Not started. Only a clear refusal (the call never went, or Higgsfield said no) is free, and
      // it is counted as Runway's 4xx are (T48 F1): two a shot, three a day pause the door.
      const words = typeof s.text === "string" ? s.text.slice(0, 300) : "";
      if (s.clear) {
        const st = s.why === "limited" ? 429 : s.why === "unauthorized" || hfCode(s.why) ? 401 : 400;
        try {
          ledger.settle(iso(), j, { state: "released", credits: 0, verdict: `not_started_${st}` });
        } catch {
          say(`${iso()} ledger not written for ${j.job}; its reservation stays counted`);
        }
        endJob(j, "failed", { credits: 0, reason: words ? `Higgsfield did not start it. Higgsfield said: ${words}` : "Higgsfield did not start it.", notStarted: st });
        if (st !== 401 && st !== 429) marks.resend.add(c.resend);
        maybePause();
      } else {
        const credits = settle(j, null, "unknown", false);
        endJob(j, "failed", { credits, reason: "Higgsfield's answer was lost on the way, so the job may have started. Its cost stays counted." });
      }
      const code = hfCode(s.why);
      if (code) return no(res, code);
      if (s.why === "limited") return no(res, "gen_limited", "Higgsfield says too many requests for now. Wait before asking again.", { retryAfterSec: LIMITED_SEC });
      return no(res, "gen_could_not_start", words ? `Higgsfield did not start this job. Higgsfield said: ${words}` : "Higgsfield did not start this job.");
    } finally {
      release();
    }
  }

  // A job record, as step 3's (what was sent, for the owner's views), with its service.
  function jobRecord(j, c) {
    return {
      job: j.job, slug: j.slug, kind: j.kind, model: j.model, seconds: j.seconds, batch: j.batch, shot: j.shot, estimate: j.estimate,
      fingerprint: c.print, state: "waiting", progress: null, credits: j.estimate, reason: null, runwayTask: null, output: null, startedAt: iso(),
      endedAt: null, inputs: c.ids, prompt: typeof c.prompt === "string" && c.prompt !== "" ? c.prompt.slice(0, PROMPT_KEPT) : null,
      inputSha256: c.hashes, resend: c.resend, notStarted: null, provider: j.provider || "runway", ...(c.app ? { app: c.app } : {}),
    };
  }

  // Higgsfield answered a price question with a job: it may be spending, so it is counted at once.
  function chargeStarted(c, jobId) {
    const j = {
      job: newId("g"), batch: c.batchId, shot: c.shot, slug: c.slug, kind: c.kind, model: c.model, seconds: c.seconds, estimate: c.cost,
      runwayTask: typeof jobId === "string" ? jobId : null, provider: "higgsfield", units: c.units, rate: c.rate, ...(c.app ? { app: c.app } : {}),
    };
    try {
      ledger.reserve(iso(), { job: j.job, batch: j.batch, shot: j.shot, slug: j.slug, kind: j.kind, model: j.model, seconds: j.seconds, estimate: c.cost,
        provider: "higgsfield", units: c.units, rate: c.rate, runwayTask: j.runwayTask, ...(c.app ? { app: c.app } : {}) });
      ledger.settle(iso(), j, { state: "spent", credits: c.cost, verdict: "job_started" });
    } catch {
      say(`${iso()} ledger not written for a job Higgsfield started on a price question`);
    }
    say(`${iso()} higgsfield started a job on a price question; ${c.cost} counted`);
    touch();
  }

  // Ends a Higgsfield job's money: released (0) only when Higgsfield's answer said it cost 0 for a
  // job that failed or was refused; otherwise spent at the table's price or a higher stated one.
  function settleHf(j, w, verdict, allowZero) {
    const zero = allowZero && w && w.costZero;
    const amount = zero ? 0 : Math.max(j.estimate, j.known || 0);
    try {
      ledger.settle(iso(), j, { state: zero ? "released" : "spent", credits: amount, verdict, runwayTask: j.runwayTask });
    } catch {
      say(`${iso()} ledger not written for ${j.job}; its reservation stays counted`);
    }
    say(`${iso()} end ${j.job} ${verdict} credits=${amount}`);
    return amount;
  }

  // Handles one jobs_wait answer; true when the job has ended.
  async function onHf(j, w) {
    if (w.cost !== null && w.cost > (j.units || 0)) {
      j.units = w.cost;
      j.known = Math.max(j.known || 0, centsOf(w.cost, j.rate));
    }
    if (w.state === "done") {
      const credits = settleHf(j, w, "done", false);
      const want = VIDEO_KINDS.includes(j.kind) ? "video" : "picture";
      const ctl = new AbortController();
      controllers.add(ctl);
      let got;
      try {
        got = typeof w.url === "string" ? await hf.tools.output(w.url, want, { signal: ctl.signal }) : { ok: false, why: "no_address" };
      } finally {
        controllers.delete(ctl);
      }
      if (closing) return true;
      if (!got.ok) {
        say(`${iso()} output refused ${j.job} ${got.why}`);
        endJob(j, "failed", { credits, progress: 1, reason: "Higgsfield made it and it is paid for, but its result was not safe to fetch, so nothing was kept." });
        return true;
      }
      try {
        store.saveOutput(j.job, got.kind.ext, got.body);
      } catch {
        endJob(j, "failed", { credits, progress: 1, reason: "The result could not be kept on this Mac." });
        return true;
      }
      say(`${iso()} output ${j.job} ${got.host} ${got.body.length}`);
      endJob(j, "done", { credits, progress: 1, reason: null, output: { ext: got.kind.ext, type: got.kind.type, bytes: got.body.length } });
      return true;
    }
    if (w.state === "refused" || w.state === "failed") {
      const refused = w.state === "refused";
      const said = w.reason ? ` Higgsfield said: ${w.reason}` : "";
      if (refused) {
        for (const id of j.inputIds) store.markInputRefused(id);
        for (const h of j.inputSha256) marks.pictures.add(h);
        if (j.record && typeof j.record.fingerprint === "string") marks.refused.add(j.record.fingerprint);
      }
      const credits = settleHf(j, w, refused ? "refused" : "failed", true);
      if (refused) {
        endJob(j, "refused", { credits, reason: `Higgsfield refused this picture or prompt. It will not be sent again.${said}` });
        maybePause();
      } else {
        endJob(j, "failed", { credits, reason: `Higgsfield could not make this. It may work later.${said}` });
      }
      return true;
    }
    record(j, { state: "working" });
    return false;
  }

  function giveUpHf(j, sentence) {
    const credits = settleHf(j, null, "unknown", false);
    endJob(j, "failed", { credits, reason: sentence });
  }

  // Asks Higgsfield about the job every pollMs (jobs_wait, not waiting on its side) until it ends,
  // its 20 minutes are up, or Higgsfield stops answering clearly. Closing leaves it for the next start.
  async function trackHf(j) {
    const ctl = new AbortController();
    controllers.add(ctl);
    const deadline = j.startedMs + lim.jobMs;
    let errors = 0;
    try {
      for (;;) {
        if (await wait(lim.pollMs, ctl.signal) || closing) return;
        if (Date.now() >= deadline) return void giveUpHf(j, "Higgsfield did not finish in 20 minutes. Its cost stays counted.");
        const w = await hf.tools.wait(j.runwayTask, 0);
        if (closing) return;
        if (!w.ok || w.state === "unknown") {
          errors += 1;
          if (errors >= lim.pollErrors) return void giveUpHf(j, "Higgsfield stopped answering clearly about this job. Its cost stays counted.");
          continue;
        }
        errors = 0;
        if (await onHf(j, w)) return;
      }
    } catch (err) {
      say(`${iso()} job ${j.job} stopped: ${describeError(err)}`);
    } finally {
      controllers.delete(ctl);
    }
  }

  // At start (K21): an open Higgsfield job is asked once; no clear answer, and it is spent.
  async function settleOpenHf(j) {
    if (!j.runwayTask || !hf) {
      const credits = settleHf(j, null, "unknown", false);
      endJob(j, "failed", { credits, reason: "The door stopped before Higgsfield answered. The estimate stays counted." });
      return;
    }
    const w = await hf.tools.wait(j.runwayTask, 0);
    if (closing) return;
    running.set(j.job, j);
    if (!w.ok || w.state === "unknown") {
      const credits = settleHf(j, null, "unknown", false);
      endJob(j, "failed", { credits, reason: "Higgsfield did not say how this job ended. Its cost stays counted." });
      return;
    }
    if (!(await onHf(j, w))) trackHf(j);
  }

  // ---- the app routes (K19) ----

  async function doAppJob(res, who, raw, gs, key) {
    const slug = who.slug;
    const parsed = parseAppJob(raw);
    if (!parsed.ok) return no(res, "gen_bad_request", parsed.why);
    const job = parsed.job;
    const row = rowOf(job.model);
    // A2: the model's service is ready.
    if (row.provider === "runway" && key === null) return no(res, "gen_no_key");
    if (row.provider === "higgsfield") {
      const nr = hfNotReady(gs);
      if (nr) return no(res, nr);
    }
    const rate = gs.higgsfield.centsPerCredit;
    const item = {
      kind: job.kind, model: job.model, seconds: job.seconds === null ? undefined : job.seconds, resolution: job.resolution === null ? undefined : job.resolution,
      scale: job.scale === null ? undefined : job.scale, refs: job.inputs.length,
    };
    const units = estimateUnits(item);
    const cost = estimateCents(item, { centsPerCredit: rate });
    if (units === null || cost === null) return no(res, "gen_no_price");
    if (row.provider === "runway") {
      const hold = limitedUntil - Date.now();
      if (hold > 0) return no(res, "gen_limited", undefined, { retryAfterSec: Math.ceil(hold / 1000) });
    }
    // A3: the pictures, only this app's, kept in the last day, never one refused before.
    const at = clock();
    const pictures = [];
    for (const it of job.inputs) {
      const pic = store.readInput(slug, it.input, at);
      if (!pic) return no(res, "gen_bad_request", "A picture is not one this app sent in the last day.");
      if (pic.refused || marks.pictures.has(pic.sha256)) return no(res, "gen_not_approved", "This picture was refused before. The door will not send it again.");
      pictures.push({ ...pic, role: it.role });
    }
    if (job.kind === "still_upscale") {
      const p = pictures[0];
      const small = row.provider === "runway" && (Math.min(p.width, p.height) < 300 || Math.max(p.width, p.height) > 8000);
      if (small || !upscaleFits(row, p.width, p.height, job.scale)) {
        return no(res, "gen_bad_request", "An upscale needs a picture of 300 px or more a side whose result stays within 4096 px.");
      }
    }
    // A4: the owner's allowance for this app, read now.
    const a = readAllowance(P.allowances, who.app, at);
    if (!a.ok) {
      return no(res, "gen_no_allowance", a.why === "expired" ? "The owner's allowance for this app has ended. The owner can allow it again in App Studio." : undefined);
    }
    const allowance = a.allowance;
    // A1 and A5: the pause and the money.
    const t = ledger.totals(at, { batch: allowance.id, resumedAt: gs.resumedAt });
    if (!t.ok) return no(res, "gen_ledger");
    if (t.refusedRecent >= REFUSALS_TO_PAUSE || t.notStartedRecent >= NOT_STARTED_TO_PAUSE) return no(res, "gen_paused");
    const hashes = pictures.map((p) => p.sha256);
    const print = fingerprint(job.kind, job.model, hashes, job.prompt);
    if (marks.refused.has(print)) return no(res, "gen_not_approved", "This same picture or prompt was refused before. The door will not send it again.");
    const resend = resendPrint(allowance.id, null, job.kind, job.model, hashes, job.prompt);
    if (marks.resend.has(resend)) return no(res, "gen_not_approved", "This same request was not started before. The door will not send it again.");
    const over = overApp(gs, t, cost, allowance);
    if (over) return no(res, over);
    // A7: the running limit.
    const busy = busyFor(slug);
    if (busy) return no(res, "gen_busy", busy, { retryAfterSec: 30 });
    const c = {
      slug, app: who.app, row, kind: job.kind, model: job.model, seconds: job.seconds, prompt: job.prompt, ratio: job.ratio, resolution: job.resolution,
      pictures, ids: job.inputs.map((i) => i.input), hashes, cost, units, rate, batchId: allowance.id, shot: null, print, resend,
      reply: (j) => ({ job: j.job, cents: cost }),
    };
    if (row.provider === "higgsfield") return hfRun(res, c);
    return runwayAppJob(res, c, gs, key, job, allowance);
  }

  // An app's Runway job: step 3's path (the reservation, the one call, the task followed), the
  // body from the table's row with its pins, the money held to the allowance too.
  async function runwayAppJob(res, c, gs, key, job, allowance) {
    const j = {
      job: newId("g"), batch: c.batchId, shot: null, slug: c.slug, kind: c.kind, model: c.model, seconds: c.seconds, estimate: c.cost,
      known: 0, runwayTask: null, startedMs: Date.now(), inputIds: c.ids, inputSha256: c.hashes, record: null, provider: "runway", app: c.app,
    };
    try {
      ledger.reserve(iso(), { job: j.job, batch: j.batch, shot: null, slug: j.slug, kind: j.kind, model: j.model, seconds: j.seconds, estimate: c.cost,
        provider: "runway", app: c.app });
    } catch {
      return no(res, "gen_ledger");
    }
    running.set(j.job, j);
    j.record = jobRecord(j, c);
    record(j, {});
    say(`${iso()} job ${c.slug} ${j.job} ${j.kind} ${j.model} ${j.seconds || 0}s est=${c.cost}`);
    touch("jobs");

    const req = runwayRequest(c.row, job, c.pictures);
    const r = await callRunway(up, { method: "POST", path: req.path, key, json: req.body, limits: lim });
    const created = r.ok && r.status >= 200 && r.status < 300 ? readTask(r.json) : null;
    if (created && created.id) {
      j.runwayTask = created.id;
      j.known = created.estimated || 0;
      try {
        ledger.note(iso(), j, { credits: Math.max(c.cost, j.known), runwayTask: j.runwayTask });
      } catch {
        say(`${iso()} ledger not written for ${j.job}'s task; its reservation stays counted`);
      }
      record(j, { runwayTask: j.runwayTask, credits: Math.max(c.cost, j.known) });
      if (j.known > c.cost) {
        const again = ledger.totals(clock(), { batch: j.batch, resumedAt: gs.resumedAt });
        const code = again.ok ? overApp(gs, again, 0, allowance) : "gen_ledger";
        if (code) {
          await cancel(j);
          const credits = settle(j, created, "stopped", false);
          endJob(j, "failed", { credits, reason: "Runway's price was higher than the door's and went over a limit, so the job was stopped." });
          return no(res, code);
        }
      }
      sendJson(res, 202, c.reply(j));
      track(j);
      return undefined;
    }
    // Not started: as an agent's (doJob), free only when Runway clearly refused it, and counted.
    const words = r.ok ? errorText(r.json, key) : "";
    const clear = r.ok && r.status >= 400 && r.status < 500;
    const retrySec = r.ok && r.retryAfter !== null ? Math.max(1, Math.min(r.retryAfter, 86400)) : LIMITED_SEC;
    if (clear) {
      try {
        ledger.settle(iso(), j, { state: "released", credits: 0, verdict: `not_started_${r.status}` });
      } catch {
        say(`${iso()} ledger not written for ${j.job}; its reservation stays counted`);
      }
    } else {
      settle(j, null, "unknown", false);
    }
    endJob(j, "failed", { credits: clear ? 0 : c.cost, reason: words ? `Runway did not start it. Runway said: ${words}` : "Runway did not start it.", notStarted: clear ? r.status : null });
    if (clear) {
      if (r.status === 429) limitedUntil = Math.max(limitedUntil, Date.now() + retrySec * 1000);
      else if (r.status !== 401) marks.resend.add(c.resend);
      maybePause();
    }
    if (r.ok && r.status === 401) return no(res, "gen_key_refused");
    if (r.ok && r.status === 429) return no(res, "gen_limited", undefined, { retryAfterSec: retrySec });
    return no(res, "gen_could_not_start", words ? `Runway did not start this job. Runway said: ${words}` : undefined);
  }

  // K19's estimate: 1 to 20 items, priced from the table only; an item the door has no price for
  // is `cents: null` (then `total` is null too).
  function doAppEstimate(res, buf, gs) {
    const v = parseObject(buf);
    if (!v || Object.keys(v).length !== 1 || !Array.isArray(v.items) || v.items.length < 1 || v.items.length > 20) return no(res, "gen_bad_request");
    const rate = gs.higgsfield.centsPerCredit;
    const items = [];
    for (const it of v.items) {
      if (!it || typeof it !== "object" || Array.isArray(it) || !Object.keys(it).every((k) => ["model", "kind", "seconds", "resolution", "scale"].includes(k))) return no(res, "gen_bad_request");
      if (typeof it.model !== "string" || it.model.length > 64 || !KINDS.includes(it.kind)) return no(res, "gen_bad_request");
      if ((it.seconds !== undefined && !Number.isInteger(it.seconds)) || (it.scale !== undefined && !Number.isInteger(it.scale))
        || (it.resolution !== undefined && (typeof it.resolution !== "string" || it.resolution.length > 8))) return no(res, "gen_bad_request");
      const cents = estimateCents({ kind: it.kind, model: it.model, seconds: it.seconds, resolution: it.resolution, scale: it.scale }, { centsPerCredit: rate });
      items.push({ model: it.model, cents });
    }
    const total = items.some((i) => i.cents === null) ? null : items.reduce((s, i) => s + i.cents, 0);
    return sendJson(res, 200, { items, total });
  }

  // K19's allowance: { open, budget, spent, left, expiresAt } in cents; `left` is also held to what
  // is left of today's and this month's caps.
  function doAllowance(res, who, gs) {
    const at = clock();
    const a = readAllowance(P.allowances, who.app, at);
    if (!a.ok) return sendJson(res, 200, { open: false, budget: 0, spent: 0, left: 0, expiresAt: null });
    const t = ledger.totals(at, { batch: a.allowance.id, resumedAt: gs.resumedAt });
    if (!t.ok) return no(res, "gen_ledger");
    const budget = a.allowance.budgetCents;
    const left = Math.max(0, Math.min(budget - t.batch, gs.dailyCredits - t.day, gs.monthlyCredits - t.month));
    return sendJson(res, 200, { open: true, budget, spent: t.batch, left, expiresAt: a.allowance.expiresAt });
  }

  // ---- the owner's Higgsfield routes (K21) ----

  async function doHfOwner(res, name, raw) {
    if (!hf) return no(res, "gen_hf_signed_out");
    if (name === "hfBegin" || name === "hfForget") {
      const empty = raw.length === 0 || (() => { const v = parseObject(raw); return v !== null && Object.keys(v).length === 0; })();
      if (!empty) return no(res, "gen_bad_request");
      if (name === "hfForget") {
        hf.auth.forget();
        hf.mcp.reset();
        touch();
        return sendJson(res, 200, { connected: false });
      }
      const b = await hf.auth.begin();
      if (!b.ok) return no(res, "gen_hf_sign_in");
      return sendJson(res, 200, { url: b.url });
    }
    if (name === "hfFinish") {
      const v = parseObject(raw);
      const fits = v !== null && Object.keys(v).length === 2 && typeof v.code === "string" && typeof v.state === "string";
      // The pending sign-in is cleared whatever happens (K21): a body of the wrong shape ends it too.
      const f = await hf.auth.finish(fits ? { code: v.code, state: v.state } : {});
      if (!fits) return no(res, "gen_bad_request");
      if (!f.ok) return no(res, "gen_hf_sign_in");
      hf.mcp.reset();
      touch();
      return sendJson(res, 200, { connected: true });
    }
    const r = await hf.tools.balance();
    say(`${iso()} higgsfield balance owner ${r.ok ? "ok" : r.why}`);
    if (!r.ok) {
      const code = hfCode(r.why);
      return code ? no(res, code) : no(res, "gen_could_not_start", "Higgsfield did not answer the balance question.");
    }
    return sendJson(res, 200, { credits: r.credits, plan: r.plan });
  }

  async function onRequest(req, res) {
    // 1. Upgrades are never let through; then health; then the path, as sent.
    if (wantsUpgrade(req.rawHeaders)) return no(res, "gen_refused");
    const target = req.url;
    if (req.method === "GET" && target === "/gen/health") {
      const gs = readGenState(P.state, clock());
      return sendJson(res, 200, { status: "ok", part: "generate", on: gs.ok && gs.on, key: readRunwayKey(P.key) !== null, higgsfield: hfStatus().signedIn });
    }
    const r = route(req.method, target);
    if (r === null) return no(res, "gen_not_found");
    // 3 and 4. The token, the switch, a pause and the key.
    let ok = admitted(req, r);
    if (typeof ok === "string") return no(res, ok);
    if (r.name === "job") return doGetJob(res, ok.who, r.args[0]);
    if (r.name === "output") return doOutput(res, ok.who, r.args[0]);
    if (r.name === "appJob") return doGetJob(res, ok.who, r.args[0]);
    if (r.name === "appOutput") return doOutput(res, ok.who, r.args[0]);
    if (r.name === "appModels") return sendJson(res, 200, { models: appModels(ok.gs, { runway: ok.key !== null, higgsfield: hfNotReady(ok.gs) === null }) });
    if (r.name === "appAllowance") return doAllowance(res, ok.who, ok.gs);
    // 5 and 6. The body.
    let raw;
    let type;
    if (r.name === "inputs" || r.name === "appInputs") {
      const types = headerValues(req.rawHeaders, "content-type").map((v) => String(v).split(";")[0].trim().toLowerCase());
      type = types.length === 1 ? PICTURE_TYPES[types[0]] : undefined;
      raw = await readBody(req, INPUT_MAX);
      if (raw === null) return undefined;
      if (raw === "too-big") {
        say(`${iso()} refused gen_bad_input`);
        touch("refused");
        return refuse(res, 413, "gen_bad_input", CODES.gen_bad_input[1]);
      }
    } else {
      raw = await readBody(req, r.name === "appJobs" ? APP_JOB_BYTES : BODY_BYTES);
      if (raw === null) return undefined;
      if (raw === "too-big") return no(res, "gen_bad_request");
    }
    // 3 and 4 again: the owner may have switched off, paused or removed the key meanwhile.
    ok = admitted(req, r);
    if (typeof ok === "string") return no(res, ok);
    if (r.name === "inputs") return takeInput(res, ok.who.slug, raw, type);
    if (r.name === "appInputs") return takeInput(res, ok.who.slug, raw, type, { kept: INPUTS_KEPT_APP, full: "This app already keeps 200 pictures from the last day." });
    if (r.name === "estimate") return doEstimate(res, raw, ok.gs);
    if (r.name === "appEstimate") return doAppEstimate(res, raw, ok.gs);
    if (r.name === "appJobs") return doAppJob(res, ok.who, raw, ok.gs, ok.key);
    if (r.hf) return doHfOwner(res, r.name, raw);
    if (r.name === "balance") return doBalance(res, ok.key);
    const body = parseJob(raw);
    if (body === null) return no(res, "gen_bad_request");
    // An allowance is an app's, never a batch (K22): an agent naming one is refused.
    if (body.batch !== null && ALLOWANCE_ID_RE.test(body.batch)) return no(res, "gen_not_approved", "An app's spending allowance is not a batch. Nothing was spent.");
    return doJob(res, ok.who, body, ok.gs, ok.key);
  }

  // At start: every reservation with no end is settled by one question to Runway per task;
  // one with no task id (the door stopped before Runway answered) stays spent at its estimate.
  async function settleOpen() {
    const gs = readGenState(P.state, clock());
    const t = ledger.totals(clock(), { resumedAt: gs.ok ? gs.resumedAt : null });
    if (!t.ok) return;
    const read = ledger.read();
    const extras = read.ok ? extrasByJob(read.lines) : new Map();
    for (const o of t.open) {
      if (closing) return;
      const rec = store.readJob(o.job);
      const j = {
        job: o.job, batch: o.batch, shot: o.shot, slug: o.slug, kind: o.kind, model: o.model, seconds: o.seconds,
        estimate: o.estimate, known: o.reserved, runwayTask: o.runwayTask, startedMs: rec ? Date.parse(rec.startedAt) || Date.now() : Date.now(),
        inputIds: rec && Array.isArray(rec.inputs) ? rec.inputs.filter((x) => typeof x === "string") : [],
        inputSha256: rec && Array.isArray(rec.inputSha256) ? rec.inputSha256.filter((x) => typeof x === "string" && HASH_RE.test(x)) : [],
        record: rec || { job: o.job, slug: o.slug, kind: o.kind, model: o.model, seconds: o.seconds, batch: o.batch, shot: o.shot,
          estimate: o.estimate, fingerprint: null, state: "waiting", progress: null, credits: o.reserved, reason: null,
          runwayTask: o.runwayTask, output: null, startedAt: null, endedAt: null, inputs: [], prompt: null, inputSha256: [], resend: null, notStarted: null },
      };
      Object.assign(j, extras.get(o.job) || {});   // step 5: provider, units, rate, app
      if (j.provider === "higgsfield") {
        await settleOpenHf(j);
        continue;
      }
      const key = readRunwayKey(P.key);
      if (!j.runwayTask) {
        settle(j, null, "unknown", false);
        endJob(j, "failed", { credits: knownCharge(j, null), reason: "The door stopped before Runway answered. The estimate stays counted." });
        continue;
      }
      if (!key) continue;   // asked again at the next start; it counts as spent meanwhile
      const r = await callRunway(up, { method: "GET", path: taskPath(j.runwayTask), key, limits: lim });
      const task = r.ok && r.status === 200 ? readTask(r.json) : null;
      running.set(j.job, j);
      if (!task || task.id !== j.runwayTask || task.status === "UNKNOWN") {
        settle(j, null, "unknown", false);
        endJob(j, "failed", { credits: knownCharge(j, null), reason: "Runway did not say how this job ended. Its cost stays counted." });
        continue;
      }
      if (TERMINAL.has(task.status)) await onTask(j, task, key);
      else {
        await onTask(j, task, key);
        track(j);
      }
    }
  }

  // At start: what the door's own job records (two days of them) say Runway refused, or did not
  // start, read once here and never per request.
  function loadMarks() {
    for (const rec of store.listJobs()) {
      const sent = Array.isArray(rec.inputSha256) ? rec.inputSha256.filter((x) => typeof x === "string" && HASH_RE.test(x)) : [];
      const kind = rec.state === "refused" ? "refused" : failureKind(rec.failureCode);
      if (kind === "refused" || kind === "bad_input") for (const h of sent) marks.pictures.add(h);
      if (rec.state === "refused" && typeof rec.fingerprint === "string") marks.refused.add(rec.fingerprint);
      if (Number.isInteger(rec.notStarted) && rec.notStarted !== 401 && rec.notStarted !== 429 && typeof rec.resend === "string") marks.resend.add(rec.resend);
    }
  }

  const server = http.createServer((req, res) => {
    onRequest(req, res).catch((err) => {
      say(`${iso()} request failed: ${describeError(err)}`);
      if (!res.headersSent) no(res, "gen_bad_request");
      else res.destroy();
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 60_000;
  const onRaw = (_req, socket) => {
    say(`${iso()} refused gen_refused`);
    const text = JSON.stringify({ error: { message: CODES.gen_refused[1] }, code: "gen_refused" });
    socket.pause();
    socket.removeAllListeners("data");
    socket.on("error", () => {});
    if (!socket.writable) return void socket.destroy();
    socket.end(`HTTP/1.1 403 Forbidden\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(text)}\r\n` +
      `Cache-Control: no-store\r\nConnection: close\r\n\r\n${text}`, () => socket.destroy());
    setTimeout(() => socket.destroy(), 1000).unref();
  };
  server.on("upgrade", onRaw);
  server.on("connect", onRaw);

  let settling = Promise.resolve();
  return {
    server,
    get port() {
      const a = server.address();
      return a && typeof a === "object" ? a.port : null;
    },
    // Resolves when the reservations left by an earlier run have been asked about.
    settled: () => settling,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(listenPort, "127.0.0.1", () => {
          server.off("error", reject);
          status.startedAt = iso();
          const gs = readGenState(P.state, clock());
          status.on = gs.ok && gs.on;
          status.key = readRunwayKey(P.key) !== null;
          try { store.sweep(clock()); } catch { /* nothing to sweep yet */ }
          try { loadMarks(); } catch (err) { say(`${iso()} job records not read: ${describeError(err)}`); }
          // The ledger is tidied here, synchronously, before any request or settling can
          // append to it (PLAN-V5 C3); a failure leaves it as it was.
          try {
            const tidy = rotateLedger(P.ledger, clock());
            if (tidy.moved > 0) say(`${iso()} ledger tidied: ${tidy.moved} old lines moved, ${tidy.kept} kept`);
            if (tidy.folded > 0) say(`${iso()} ledger tidied: ${tidy.folded} requests Runway did not start folded into one line`);
          } catch (err) {
            say(`${iso()} ledger not tidied: ${describeError(err)}`);
          }
          touch();
          statusOut.flush();
          settling = settleOpen().catch((err) => say(`${iso()} settling failed: ${describeError(err)}`));
          resolve(server.address().port);
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        closing = true;
        for (const c of controllers) c.abort();
        const done = () => {
          if (status.startedAt) statusOut.flush();
          resolve();
        };
        if (!server.listening) return void done();
        server.close(done);
        server.closeAllConnections();
      });
    },
  };
}

// What main() starts the door with. The origin and the real network are fixed here: nothing in
// a file, the config or the environment can replace them.
export function generateDoorOptions(cfg) {
  return {
    listenPort: cfg.ports.generate,
    upstream: RUNWAY_ORIGIN,
    paths: cfg.paths,
    config: cfg,
    log: (line) => console.log(line),
    net: REAL_NET,
    // Higgsfield's one origin (higgsfield.mjs) and the home server's sign-in return address.
    higgsfield: Number.isInteger(cfg.ports && cfg.ports.home)
      ? { origin: HF_ORIGIN, redirectUri: `http://127.0.0.1:${cfg.ports.home}${HF_RETURN_PATH}`, net: REAL_NET } : undefined,
  };
}

function ownFolder(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function lastResort(err) {
  console.log(`${new Date().toISOString()} generation door caught an error it did not expect: ${describeError(err)}`);
}

async function main() {
  process.on("uncaughtException", lastResort);
  process.on("unhandledRejection", lastResort);
  const { loadConfig } = await import("../lib/config.mjs");
  const cfg = loadConfig();
  ownFolder(cfg.paths.doors);
  ownFolder(cfg.paths.doorWork);
  ensureSecret(cfg.paths.generateSecret);
  const door = createGenerateDoor(generateDoorOptions(cfg));
  try {
    await door.listen();
  } catch (err) {
    console.log(`${new Date().toISOString()} generation door could not start on 127.0.0.1:${cfg.ports.generate}: ${err.code || "error"}`);
    process.exit(1);
  }
  console.log(`${new Date().toISOString()} generation door started on 127.0.0.1:${cfg.ports.generate}`);
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    await door.close();
    console.log(`${new Date().toISOString()} generation door stopped (${signal})`);
    process.exit(0);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

const self = fileURLToPath(import.meta.url);
let invoked = "";
try {
  invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
} catch {
  invoked = "";
}
if (invoked === realpathSync(self)) {
  main().catch((err) => {
    console.log(`${new Date().toISOString()} generation door failed: ${describeError(err)}`);
    process.exit(1);
  });
}
