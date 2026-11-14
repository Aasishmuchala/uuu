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
import http from "node:http";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, createReadStream, mkdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkCaller, ensureSecret, headerValues, readBody, refuse, sendJson, statusFile, wantsUpgrade } from "../doors/common.mjs";
import { describeError } from "../relay/relay.mjs";
import { checkAddress } from "../web/address.mjs";
import { REAL_NET, fetchPublic } from "../web/fetch.mjs";
import { createLedger, dayOf, rotateLedger } from "./ledger.mjs";
import {
  API_LIMITS, KINDS, ORGANIZATION_PATH, PRICES, RUNWAY_ORIGIN, UPSCALE_MAX_SIDE, VIDEO_KINDS, buildRequest, callRunway,
  checkUpstream, chosen, credits as creditsOf, defaultModel, errorText, estimate, failureKind, holdsKey, pictureFailure, priced,
  ratioFits, readTask, scrub, taskPath,
} from "./runway.mjs";
import {
  HASH_RE, ID_RE, INPUTS_KEPT, INPUT_MAX, INPUT_MIN, SHOT_RE, newId, readBatch, readGenState, readRunwayKey, sniffOutput, sniffPicture, workStore,
} from "./state.mjs";

const MB = 1024 * 1024;
export const BODY_BYTES = 8 * 1024;
export const MAX_RUNNING = 2;
export const REFUSALS_TO_FREEZE = 2;
export const REFUSALS_TO_PAUSE = 3;
// Requests Runway answered with a 4xx and did not start cost nothing, so no cap holds them (T48
// F1): two for one shot of a batch refuse that shot, and three in a day pause the door until the
// owner's "Start again", both counted in the ledger since the owner last started it again. The
// Artist's role sends a request at most twice (once more after gen_limited's wait), so a third
// is never its rule working; three is also the refusals' pause, whose sentence the owner already
// sees ("Runway refused three requests in a day"). A job Runway has not answered yet counts toward
// both while it waits (T49f N3): the next request is answered gen_busy until it is known.
export const NOT_STARTED_PER_SHOT = 2;
export const NOT_STARTED_TO_PAUSE = 3;
export const LIMITED_SEC = 60;            // the wait after Runway's 429 when it names none
export const PROMPT_KEPT = 1000;          // the prompt kept in a job's record, as sent
const WAITING = "Another request is still waiting for Runway's answer. Wait, then send it again.";
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
});

const JOB = "([A-Za-z0-9_-]{1,64})";
const ROUTES = [
  { method: "POST", re: /^\/gen\/inputs$/, name: "inputs", spends: true },
  { method: "POST", re: /^\/gen\/estimate$/, name: "estimate", either: true },
  { method: "POST", re: /^\/gen\/jobs$/, name: "jobs", spends: true },
  { method: "GET", re: new RegExp(`^/gen/jobs/${JOB}$`), name: "job" },
  { method: "GET", re: new RegExp(`^/gen/jobs/${JOB}/output$`), name: "output" },
  { method: "POST", re: /^\/gen\/owner\/balance$/, name: "balance", owner: true },
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
  return out;
}

// What the door does not send again, by its pictures' bytes (their hashes, never the upload's id,
// T48 F5): a refused job's pictures and prompt (a picture refused for itself, T49f N4, is kept in
// `marks` alone); and a request Runway did not start, as it was sent (its batch, shot, pictures and prompt).
const fingerprint = (kind, model, hashes, promptText) =>
  createHash("sha256").update(JSON.stringify([kind, model, [...(hashes || [])].sort(), promptText || ""])).digest("hex");
const resendPrint = (batch, shot, kind, model, hashes, promptText) =>
  createHash("sha256").update(JSON.stringify(["resend", batch, shot, kind, model, [...(hashes || [])].sort(), promptText || ""])).digest("hex");

export function createGenerateDoor({ listenPort, upstream, paths, config, log, now, net, limits } = {}) {
  const up = checkUpstream(upstream);
  const P = doorPaths(paths);
  const theNet = net === undefined ? REAL_NET : net;
  if (!theNet || typeof theNet.resolve !== "function" || typeof theNet.connect !== "function") {
    throw new Error("createGenerateDoor: net needs resolve and connect");
  }
  const agentList = config && config.doors && config.doors.generate && Array.isArray(config.doors.generate.agents)
    ? config.doors.generate.agents.filter((s) => typeof s === "string") : [];
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
  // jobs, the byte hashes of pictures Runway refused or could not use for the picture itself (with
  // any prompt; a refusal of the words alone bars only its fingerprint), and
  // requests not started, as sent. Filled from the door's own job records at its start and as jobs
  // end, so a job request reads no other job's record. And the time before which Runway's 429 said
  // not to ask again (Date.now() ms, this run only).
  const marks = { refused: new Set(), pictures: new Set(), resend: new Set() };
  let limitedUntil = 0;

  // ---- the status file ------------------------------------------------------
  const status = { startedAt: null, on: false, key: false, running: 0, today: { day: null, jobs: 0, credits: 0, refused: 0 }, lastAt: null };
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
    }
    status.running = running.size;
    status.lastAt = iso();
    statusOut.save(status);
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
    // A refusal about the picture bars its bytes with any words; one of the words (or of the output)
    // bars only this same picture with this same prompt (T49f N4).
    const picture = pictureFailure(t.failureCode);
    if (picture) {
      for (const id of j.inputIds) store.markInputRefused(id);
      for (const h of j.inputSha256) marks.pictures.add(h);
    }
    if (kind === "refused" && j.record && typeof j.record.fingerprint === "string") marks.refused.add(j.record.fingerprint);
    const credits = settle(j, t, kind === "refused" ? "refused" : kind, true);
    if (kind === "refused") {
      const what = picture ? "Runway refused this picture. It will not be sent again." : "Runway refused this prompt or its result. This picture will not be sent again with this prompt.";
      endJob(j, "refused", { credits, reason: `${what}${words ? ` Runway said: ${words}` : ""}`, failureCode: t.failureCode });
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
  const caller = (req) => checkCaller({ rawHeaders: req.rawHeaders, secretPath: P.secret, idsPath: P.ids, agents: agentList, now: clock() });

  // Rows 3 and 4 for this route: a code, or { who, gs, key }.
  function admitted(req, r) {
    const who = caller(req);
    if (who === null || typeof who !== "object") return "gen_no_token";
    if (r.owner && who.kind !== "t") return "gen_no_token";
    if (!r.owner && !r.either && who.kind !== "a") return "gen_no_token";
    const gs = readGenState(P.state, clock());
    status.on = gs.ok && gs.on;
    const owner = who.kind === "t";
    if (!owner && (!gs.ok || !gs.on)) return "gen_off";
    let key = null;
    if (r.spends || r.owner) {
      if (!owner) {
        if (gs.paused !== null) return "gen_paused";
        const t = ledger.totals(clock(), { resumedAt: gs.resumedAt });
        if (t.ok && t.paused) return "gen_paused";
      }
      key = readRunwayKey(P.key);
      if (key === null) return "gen_no_key";
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
  function takeInput(res, slug, raw, type) {
    if (type === undefined || raw.length < INPUT_MIN) return no(res, "gen_bad_input");
    const pic = sniffPicture(raw);
    if (!pic || pic.type !== type) return no(res, "gen_bad_input");
    const at = clock();
    store.sweep(at);
    if (store.countInputs(slug, at) >= INPUTS_KEPT) return no(res, "gen_bad_input", "This agent already keeps 40 pictures from the last day.");
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
      const credits = estimate({ kind: it.kind, model, seconds });
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
    // A job Runway has not answered yet may come back not started: it counts toward both limits now,
    // so two jobs in flight cannot both pass at one below a limit (T49f N3). The caller waits.
    const unanswered = [...running.values()].filter((x) => x.runwayTask === null);
    if (t.notStartedRecent + unanswered.length >= NOT_STARTED_TO_PAUSE) return no(res, "gen_busy", WAITING, { retryAfterSec: 30 });
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
      const inShot = unanswered.filter((x) => x.batch === body.batch && x.shot === body.shot).length;
      if (t.notStarted(body.shot) + inShot >= NOT_STARTED_PER_SHOT) return no(res, "gen_busy", WAITING, { retryAfterSec: 30 });
      model = shot.model;
    } else {
      if (body.kind === "text_to_video") return no(res, "gen_not_approved", "Video from text alone needs the owner's approval.");
      model = defaultModel(body.kind, gs.models);
    }
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
    if (running.size >= MAX_RUNNING) return no(res, "gen_busy", undefined, { retryAfterSec: 30 });
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

  async function onRequest(req, res) {
    // 1. Upgrades are never let through; then health; then the path, as sent.
    if (wantsUpgrade(req.rawHeaders)) return no(res, "gen_refused");
    const target = req.url;
    if (req.method === "GET" && target === "/gen/health") {
      const gs = readGenState(P.state, clock());
      return sendJson(res, 200, { status: "ok", part: "generate", on: gs.ok && gs.on, key: readRunwayKey(P.key) !== null });
    }
    const r = route(req.method, target);
    if (r === null) return no(res, "gen_not_found");
    // 3 and 4. The token, the switch, a pause and the key.
    let ok = admitted(req, r);
    if (typeof ok === "string") return no(res, ok);
    if (r.name === "job") return doGetJob(res, ok.who, r.args[0]);
    if (r.name === "output") return doOutput(res, ok.who, r.args[0]);
    // 5 and 6. The body.
    let raw;
    let type;
    if (r.name === "inputs") {
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
      raw = await readBody(req, BODY_BYTES);
      if (raw === null) return undefined;
      if (raw === "too-big") return no(res, "gen_bad_request");
    }
    // 3 and 4 again: the owner may have switched off, paused or removed the key meanwhile.
    ok = admitted(req, r);
    if (typeof ok === "string") return no(res, ok);
    if (r.name === "inputs") return takeInput(res, ok.who.slug, raw, type);
    if (r.name === "estimate") return doEstimate(res, raw, ok.gs);
    if (r.name === "balance") return doBalance(res, ok.key);
    const body = parseJob(raw);
    if (body === null) return no(res, "gen_bad_request");
    return doJob(res, ok.who, body, ok.gs, ok.key);
  }

  // At start: every reservation with no end is settled by one question to Runway per task;
  // one with no task id (the door stopped before Runway answered) stays spent at its estimate.
  async function settleOpen() {
    const gs = readGenState(P.state, clock());
    const t = ledger.totals(clock(), { resumedAt: gs.ok ? gs.resumedAt : null });
    if (!t.ok) return;
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
      if (pictureFailure(rec.failureCode)) for (const h of sent) marks.pictures.add(h);
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
