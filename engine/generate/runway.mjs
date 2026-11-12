// Everything the generation door knows about Runway (PLAN-V5 K13, `.router/V5-RUNWAY.md`): the
// one origin, every endpoint, the headers, the request bodies, the price table, how a task
// answer is read, and the one HTTP call. Nothing else in the engine names Runway's address.
// Zero dependencies. Runway's answers are hostile text: every field is checked, every string
// passed on is scrubbed of the key, and a call is made once, never retried.
import http from "node:http";
import https from "node:https";

export const RUNWAY_ORIGIN = "https://api.dev.runwayml.com";
export const RUNWAY_VERSION = "2024-11-06";
// A Runway key: `key_` and 128 hex characters (Runway's own words).
export const KEY_RE = /^key_[0-9a-f]{128}$/;
export const TASK_RE = /^[A-Za-z0-9-]{1,64}$/;
const STAND_IN = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/;
const MB = 1024 * 1024;

export const API_LIMITS = Object.freeze({
  answerBytes: 1 * MB,  // one API answer, as sent
  apiMs: 30_000,        // one API call, end to end
});

// Returns { origin, protocol, hostname, port } for the one accepted origin or a stand-in on
// http://127.0.0.1:<port>; throws on anything else. Compared as given: no other spelling.
export function checkUpstream(origin) {
  if (origin === RUNWAY_ORIGIN) return { origin, protocol: "https:", hostname: "api.dev.runwayml.com", port: 443 };
  const m = typeof origin === "string" ? STAND_IN.exec(origin) : null;
  if (m && Number(m[1]) <= 65535) return { origin, protocol: "http:", hostname: "127.0.0.1", port: Number(m[1]) };
  throw new Error(`upstream must be ${RUNWAY_ORIGIN} or a stand-in on http://127.0.0.1:<port>`);
}

// ---- kinds, models, prices ----------------------------------------------------

export const KINDS = Object.freeze(["image_to_video", "text_to_video", "still_variation", "still_upscale"]);
export const VIDEO_KINDS = Object.freeze(["image_to_video", "text_to_video"]);
const VIDEO_RATIOS = ["1280:720", "720:1280", "1104:832", "832:1104", "960:960", "1584:672"];
const STILL_RATIOS = ["1024:1024", "1080:1080", "1168:880", "1360:768", "1440:1080", "1080:1440", "1808:768",
  "1920:1080", "1080:1920", "2112:912", "1280:720", "720:1280", "720:720", "960:720", "720:960", "1680:720"];

// The price table (credits; one credit is one US cent), from Runway's pricing page. A still is
// always priced at its highest row (gen4_image: 8, the 1080p price), and an upscale whose
// output would pass 4096 px is refused, so its price is always the 25 row. A model that is not
// here has no price, and the door spends nothing on it.
export const PRICES = Object.freeze({
  gen4_turbo: Object.freeze({ perSecond: 5, kinds: Object.freeze(["image_to_video"]), ratios: VIDEO_RATIOS }),
  "gen4.5": Object.freeze({ perSecond: 12, kinds: Object.freeze(["image_to_video", "text_to_video"]), ratios: VIDEO_RATIOS }),
  gen4_image: Object.freeze({ perPicture: 8, kinds: Object.freeze(["still_variation"]), ratios: STILL_RATIOS }),
  gen4_image_turbo: Object.freeze({ perPicture: 2, kinds: Object.freeze(["still_variation"]), ratios: STILL_RATIOS }),
  magnific_precision_upscaler_v2: Object.freeze({ perPicture: 25, kinds: Object.freeze(["still_upscale"]), ratios: null }),
});
export const MIN_SECONDS = 2;
export const MAX_SECONDS = 10;
export const UPSCALE_MAX_SIDE = 4096;
// A cost Runway states above this is held at this (it still blocks every cap); a negative,
// fractional-NaN or non-number cost is not a cost at all.
export const MAX_CREDITS = 1_000_000;

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
export const priced = (model) => typeof model === "string" && has(PRICES, model);

// The door's estimate in whole credits, or null when the table has no price for it.
export function estimate({ kind, model, seconds }) {
  if (!priced(model)) return null;
  const row = PRICES[model];
  if (!row.kinds.includes(kind)) return null;
  if (VIDEO_KINDS.includes(kind)) {
    if (!Number.isInteger(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS) return null;
    return row.perSecond * seconds;
  }
  return row.perPicture;
}

// The model the owner chose in Settings for a kind when no batch names one.
export function defaultModel(kind, models) {
  if (!models || typeof models !== "object") return null;
  if (kind === "image_to_video") return models.video;
  if (kind === "text_to_video") return models.videoBest;
  if (kind === "still_variation") return models.still;
  if (kind === "still_upscale") return models.upscale;
  return null;
}

// True when `model` is one the owner chose for this kind of work (the state file's models).
export function chosen(kind, model, models) {
  if (!models || typeof models !== "object") return false;
  const pool = VIDEO_KINDS.includes(kind) ? [models.video, models.videoBest]
    : kind === "still_variation" ? [models.still] : kind === "still_upscale" ? [models.upscale] : [];
  return pool.includes(model);
}

export const ratioFits = (model, ratio) => priced(model) && Array.isArray(PRICES[model].ratios) && PRICES[model].ratios.includes(ratio);

// ---- request bodies ---------------------------------------------------------------

const dataUri = (pic) => `data:${pic.type};base64,${pic.bytes.toString("base64")}`;

// { path, body } for one generation. `pictures` are the door's own kept inputs:
// [{ type, bytes }]. Nothing here comes from the agent but the prompt, the ratio and the
// seconds, all checked before.
export function buildRequest({ kind, model, promptText, seconds, ratio, scale, pictures }) {
  if (kind === "image_to_video") {
    const body = { model, promptImage: dataUri(pictures[0]), ratio, duration: seconds };
    if (typeof promptText === "string" && promptText !== "") body.promptText = promptText;
    return { path: "/v1/image_to_video", body };
  }
  if (kind === "text_to_video") return { path: "/v1/text_to_video", body: { model, promptText, ratio, duration: seconds } };
  if (kind === "still_variation") {
    return {
      path: "/v1/text_to_image",
      body: { model, promptText, ratio, referenceImages: pictures.map((p, i) => ({ uri: dataUri(p), tag: `ref${i + 1}` })) },
    };
  }
  if (kind === "still_upscale") return { path: "/v1/image_upscale", body: { model, imageUri: dataUri(pictures[0]), scaleFactor: scale } };
  throw new Error("buildRequest: unknown kind");
}

export const taskPath = (id) => {
  if (typeof id !== "string" || !TASK_RE.test(id)) throw new Error("taskPath: not a task id");
  return `/v1/tasks/${id}`;
};
export const ORGANIZATION_PATH = "/v1/organization";

// ---- reading Runway's answers -------------------------------------------------------

// A credit count Runway stated: whole credits from 0 to MAX_CREDITS (a larger one is held at
// MAX_CREDITS and said), or null when it is not a number of credits at all.
export function credits(v) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return Math.min(Math.ceil(v), MAX_CREDITS);
}
const creditsOf = (obj) => (obj && typeof obj === "object" && !Array.isArray(obj) ? credits(obj.credits) : null);
const STATUSES = new Set(["PENDING", "THROTTLED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]);

// A task answer, read field by field: { id, status (one of the six, else "UNKNOWN"), progress
// (0 to 1 or null), estimated, cost (credits or null), costZero (Runway said exactly 0),
// output (up to 4 strings), failure (raw string or null), failureCode }. Never throws.
export function readTask(json) {
  const o = json && typeof json === "object" && !Array.isArray(json) ? json : {};
  const id = typeof o.id === "string" && TASK_RE.test(o.id) ? o.id : null;
  const status = typeof o.status === "string" && STATUSES.has(o.status) ? o.status : "UNKNOWN";
  const progress = typeof o.progress === "number" && Number.isFinite(o.progress) ? Math.min(1, Math.max(0, o.progress)) : null;
  const cost = creditsOf(o.cost);
  const costZero = !!(o.cost && typeof o.cost === "object" && o.cost.credits === 0);
  const output = Array.isArray(o.output) ? o.output.filter((u) => typeof u === "string" && u.length <= 4096).slice(0, 4) : [];
  const failure = typeof o.failure === "string" ? o.failure.slice(0, 4000) : null;
  const failureCode = typeof o.failureCode === "string" && /^[A-Za-z0-9_.]{1,64}$/.test(o.failureCode) ? o.failureCode : null;
  return { id, status, progress, estimated: creditsOf(o.estimatedCost), cost, costZero, output, failure, failureCode };
}

// What a FAILED task's code means: "refused" (moderation: never sent again, counted),
// "bad_input" (the file itself; not sent again), or "failed" (Runway's own trouble).
export function failureKind(code) {
  if (typeof code !== "string") return "failed";
  if (/^SAFETY\./.test(code) || /^INTERNAL\.BAD_OUTPUT\./.test(code) || /^INPUT_PREPROCESSING\.SAFETY\./.test(code)) return "refused";
  if (code === "ASSET.INVALID" || /^ASSET\./.test(code)) return "bad_input";
  return "failed";
}

// ---- the key, scrubbed -------------------------------------------------------------

// The spellings of the key looked for in Runway's answers: the key, its JSON and percent
// forms (the relay's), and its first and last 12 characters. Matched in any letter case.
export function keyPieces(key) {
  if (typeof key !== "string" || key.length < 24) return [];
  const json = JSON.stringify(key).slice(1, -1);
  return [...new Set([key, json, encodeURIComponent(key), key.slice(0, 12), key.slice(-12)])];
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const keyRegex = (key) => {
  const pieces = keyPieces(key);
  return pieces.length ? new RegExp(pieces.sort((a, b) => b.length - a.length).map(escape).join("|"), "gi") : null;
};

export function holdsKey(text, key) {
  const re = keyRegex(key);
  return re !== null && typeof text === "string" && re.test(text);
}

// Runway's own text as the caller may see it: the key and its pieces removed, control and
// invisible characters removed, at most `max` characters.
export function scrub(text, key, max = 300) {
  if (typeof text !== "string") return "";
  const re = keyRegex(key);
  let out = re ? text.replace(re, "[removed]") : text;
  out = out.replace(/[\x00-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩﻿]/g, " ").replace(/\s+/g, " ").trim();
  return out.slice(0, max);
}

// Runway's refusal text for a create call: `error`, then the first issue's message.
export function errorText(json, key) {
  if (!json || typeof json !== "object") return "";
  const parts = [];
  if (typeof json.error === "string") parts.push(json.error);
  if (Array.isArray(json.issues) && json.issues[0] && typeof json.issues[0].message === "string") parts.push(json.issues[0].message);
  return scrub(parts.join(": "), key);
}

// ---- the one call ------------------------------------------------------------------

const agents = new Map();
function agentFor(up) {
  // The door's own connection pool per origin: proxy variables are never honoured.
  if (!agents.has(up.origin)) agents.set(up.origin, up.protocol === "https:" ? new https.Agent({ keepAlive: false }) : new http.Agent({ keepAlive: false }));
  return agents.get(up.origin);
}

// One call to Runway, once. Resolves to { ok: true, status, json (an object or null),
// retryAfter (seconds or null), keyInAnswer } or { ok: false, why }; never rejects. The answer
// is capped in size and time; its head and body are checked for the key (keyInAnswer).
export function callRunway(up, { method, path, key, json, limits, signal }) {
  const lim = { ...API_LIMITS, ...(limits || {}) };
  return new Promise((resolve) => {
    let done = false;
    let req = null;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (req) req.destroy();
      resolve(v);
    };
    const onAbort = () => finish({ ok: false, why: "closed" });
    const timer = setTimeout(() => finish({ ok: false, why: "time" }), lim.apiMs);
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort);
    }
    const body = json === undefined ? null : Buffer.from(JSON.stringify(json), "utf8");
    const headers = {
      Host: up.port === 443 && up.protocol === "https:" ? up.hostname : `${up.hostname}:${up.port}`,
      Authorization: `Bearer ${key}`,
      "X-Runway-Version": RUNWAY_VERSION,
      Accept: "application/json",
      "Accept-Encoding": "identity",
      Connection: "close",
    };
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(body.length);
    }
    try {
      req = (up.protocol === "https:" ? https : http).request({
        host: up.hostname, port: up.port, servername: up.protocol === "https:" ? up.hostname : undefined,
        method, path, headers, setHost: false, agent: agentFor(up), maxHeaderSize: 16 * 1024,
      });
    } catch {
      return finish({ ok: false, why: "request" });
    }
    req.on("error", () => finish({ ok: false, why: "network" }));
    req.on("upgrade", () => finish({ ok: false, why: "upgrade" }));
    req.on("response", (res) => {
      const status = res.statusCode;
      if (!Number.isInteger(status) || status < 200 || status > 599) return finish({ ok: false, why: "status" });
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        if (done) return;
        size += c.length;
        if (size > lim.answerBytes) return finish({ ok: false, why: "too_big" });
        chunks.push(c);
      });
      res.on("end", () => {
        if (done) return;
        if (!res.complete) return finish({ ok: false, why: "cut" });
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = null;
        try {
          const v = text === "" ? null : JSON.parse(text);
          parsed = v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
        } catch { parsed = null; }
        const ra = res.headers["retry-after"];
        const retryAfter = typeof ra === "string" && /^[0-9]{1,6}$/.test(ra.trim()) ? Number(ra.trim()) : null;
        const head = [res.statusMessage || "", ...res.rawHeaders].join("\n");
        finish({ ok: true, status, json: parsed, retryAfter, keyInAnswer: holdsKey(head, key) || holdsKey(text, key) });
      });
      res.on("error", () => finish({ ok: false, why: "cut" }));
      res.on("aborted", () => finish({ ok: false, why: "cut" }));
    });
    req.end(body || undefined);
  });
}
