// Everything the generation door knows about Higgsfield (PLAN-V5 K21): the one origin and its
// paths, the one HTTP exchange with it, the upload's PUT, the output's fetch, and the tools the
// door calls with every answer read tolerantly and checked. Nothing else in the engine names
// Higgsfield's address. Higgsfield's answers are hostile text: ids are matched by pattern,
// numbers must be finite and at least 0, texts are scrubbed of both tokens and cut to 300
// characters, and no redirect is ever followed. Zero dependencies.
//
// The sign-in authority, chosen on purpose (`.router/V5-MODELS.md` section 1 row 9): Higgsfield
// advertises two. Its protected-resource document names Clerk (clerk.higgsfield.ai, /oauth/*);
// the MCP host's own authorization-server document names itself (/oauth2/*, with dynamic client
// registration, PKCE S256, `none` client authentication and the refresh grant). The door uses
// the MCP host's own, because then the sign-in, the code exchange, every refresh and every MCP
// call go to ONE pinned origin: the code, the verifier and both tokens never reach a second
// host, the token is minted by the host that checks it, and there is one name to pin, not two
// (one of them another company's service, with wider scopes). The paths are constants here and
// no metadata document is read at run time, so a changed document cannot move the sign-in.
// What it costs: a client that follows the 2025-06-18 discovery would pick Clerk; if the MCP
// host ever refuses our client, Higgsfield stays off (fails closed) until a planned change.
import http from "node:http";
import { connect as tcpConnect } from "node:net";
import { StringDecoder } from "node:string_decoder";
import { createBrotliDecompress, createGunzip } from "node:zlib";
import { checkAddress, isOwnAddress, isPublic } from "../web/address.mjs";
import { REAL_NET, fetchPublic } from "../web/fetch.mjs";
import { HF_UPLOAD_SUFFIXES } from "./registry.mjs";
import { sniffOutput } from "./state.mjs";

export const HF_ORIGIN = "https://mcp.higgsfield.ai";
const HF_HOST = new URL(HF_ORIGIN).hostname;
export const HF_PATHS = Object.freeze({ mcp: "/mcp", register: "/oauth2/register", authorize: "/oauth2/authorize", token: "/oauth2/token" });
const STAND_IN = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/;
const MB = 1024 * 1024;

export const HF_LIMITS = Object.freeze({
  answerBytes: 2 * MB,        // one MCP answer (K21)
  callMs: 60_000,             // one MCP call, end to end (K21)
  authBytes: 64 * 1024,       // one sign-in or token answer
  authMs: 30_000,
  uploadMs: 30_000,           // one PUT (K21)
  uploadAnswerBytes: 64 * 1024,
  downloadMs: 300_000,        // one output, as Runway's
  videoBytes: 200 * MB,
  pictureBytes: 30 * MB,
  maxAddresses: 32,
  waitSec: 15,                // jobs_wait's own limit
});

export const JOB_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
export const MEDIA_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
export const TEXT_MAX = 300;

// Returns { origin, protocol, hostname, port, standIn, resource } for Higgsfield's one origin
// or a stand-in on http://127.0.0.1:<port>; throws on anything else. Compared as given.
export function checkHfOrigin(origin) {
  if (origin === HF_ORIGIN) {
    return Object.freeze({ origin, protocol: "https:", hostname: HF_HOST, port: 443, standIn: false, resource: `${origin}${HF_PATHS.mcp}` });
  }
  const m = typeof origin === "string" ? STAND_IN.exec(origin) : null;
  if (m && Number(m[1]) <= 65535) {
    return Object.freeze({ origin, protocol: "http:", hostname: "127.0.0.1", port: Number(m[1]), standIn: true, resource: `${origin}${HF_PATHS.mcp}` });
  }
  throw new Error(`origin must be ${HF_ORIGIN} or a stand-in on http://127.0.0.1:<port>`);
}

// ---- tokens out of texts ----------------------------------------------------------------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const anyOf = (pieces) => (pieces.length ? new RegExp([...new Set(pieces)].sort((a, b) => b.length - a.length).map(escapeRe).join("|"), "gi") : null);
const INVISIBLE = /[\x00-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩﻿]/g;

// A guard over secrets (the access and the refresh token). `scrub(text)`: each secret whole, in
// its JSON and percent spellings, and its first and last 12 characters, removed; control and
// invisible characters removed; cut to 300 characters. `holds(text)`: true when the text has a
// secret whole or its last 12 characters (the first 12 of a JWT are the same for every JWT, so
// they are scrubbed but never make an answer refused).
export function tokenGuard(secrets) {
  const all = [];
  const strong = [];
  for (const t of Array.isArray(secrets) ? secrets : []) {
    if (typeof t !== "string" || t.length < 16) continue;
    const forms = [t, JSON.stringify(t).slice(1, -1), encodeURIComponent(t)];
    all.push(...forms, t.slice(0, 12), t.slice(-12));
    strong.push(...forms, t.slice(-12));
  }
  const scrubRe = anyOf(all);
  const holdsRe = anyOf(strong);
  return Object.freeze({
    scrub(text, max = TEXT_MAX) {
      if (typeof text !== "string") return "";
      const out = (scrubRe ? text.replace(scrubRe, "[removed]") : text).replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
      return out.slice(0, max);
    },
    holds(text) {
      if (holdsRe === null || typeof text !== "string") return false;
      holdsRe.lastIndex = 0;
      return holdsRe.test(text);
    },
  });
}
export const NO_SECRETS = tokenGuard([]);

// ---- the one exchange ----------------------------------------------------------------------

function untilDeadline(promise, deadline, signal) {
  return new Promise((resolve) => {
    const end = (v) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve(v);
    };
    const onAbort = () => end(null);
    const timer = setTimeout(() => end(null), Math.max(0, deadline - Date.now()));
    if (signal) {
      if (signal.aborted) return end(null);
      signal.addEventListener("abort", onAbort);
    }
    let p;
    try { p = Promise.resolve(promise); } catch { return end(null); }
    p.then(end, () => end(null));
  });
}

// A socket to `host`: the stand-in's own 127.0.0.1 port, or a public host whose name is looked
// up ONCE, every answer checked (K11 row 10), and the connection made to the checked address
// itself with the name as TLS server name. { ok: true, socket } or { ok: false, why }.
async function openSocket({ net, host, port, secure, loopback, deadline, signal, maxAddresses }) {
  if (loopback) {
    try { return { ok: true, socket: tcpConnect({ host: "127.0.0.1", port }) }; } catch { return { ok: false, why: "connect" }; }
  }
  let asked;
  try { asked = net.resolve(host); } catch { asked = null; }
  const list = await untilDeadline(asked, deadline, signal);
  if (!Array.isArray(list) || list.length === 0 || list.length > maxAddresses) return { ok: false, why: "resolve" };
  const found = [];
  for (const a of list) {
    const address = typeof a === "string" ? a : a && typeof a.address === "string" ? a.address : null;
    if (address === null) return { ok: false, why: "resolve" };
    found.push({ address, family: address.includes(":") ? 6 : 4 });
  }
  if (found.some((a) => !isPublic(a.address) || isOwnAddress(a.address))) return { ok: false, why: "private_address" };
  let socket;
  try {
    socket = net.connect({ address: found[0].address, family: found[0].family, port, hostname: host, secure });
  } catch {
    return { ok: false, why: "connect" };
  }
  if (!socket || typeof socket.on !== "function") return { ok: false, why: "connect" };
  return { ok: true, socket };
}

function rawValues(rawHeaders, name) {
  const out = [];
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) if (String(rawHeaders[i]).toLowerCase() === name) out.push(String(rawHeaders[i + 1]));
  return out;
}

// One request on an open socket, once. A redirect is answered as it is (never followed); the
// answer is capped in bytes (as sent and as unpacked) and in time. `onChunk(chunk, { status,
// type })` sees each unpacked piece and may end the reading early by returning a value.
// Resolves to { ok: true, status, rawHeaders, type, body, early } or { ok: false, why }.
function exchange({ socket, method, path, headers, body, maxBytes, deadline, signal, onChunk }) {
  return new Promise((resolve) => {
    let done = false;
    let req = null;
    let res = null;
    let unpack = null;
    const onAbort = () => finish({ ok: false, why: "closed" });
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (unpack) unpack.destroy();
      if (res) res.destroy();
      if (req) req.destroy();
      socket.destroy();
      resolve(v);
    };
    const timer = setTimeout(() => finish({ ok: false, why: "time" }), Math.max(0, deadline - Date.now()));
    if (signal) {
      if (signal.aborted) return finish({ ok: false, why: "closed" });
      signal.addEventListener("abort", onAbort);
    }
    socket.on("error", () => finish({ ok: false, why: "network" }));
    try {
      req = http.request({ method, path, headers, setHost: false, createConnection: () => socket, maxHeaderSize: 16 * 1024, insecureHTTPParser: false });
    } catch {
      return finish({ ok: false, why: "request" });
    }
    req.on("error", () => finish({ ok: false, why: "network" }));
    req.on("upgrade", () => finish({ ok: false, why: "upgrade" }));
    req.on("response", (r) => {
      res = r;
      const status = r.statusCode;
      if (!Number.isInteger(status) || status < 200 || status > 599) return finish({ ok: false, why: "status" });
      const types = rawValues(r.rawHeaders, "content-type");
      const type = types.length === 1 ? types[0].split(";")[0].trim().toLowerCase() : null;
      if (status >= 300 && status < 400) {
        r.resume();
        return finish({ ok: true, status, rawHeaders: r.rawHeaders, type, body: Buffer.alloc(0), early: undefined });
      }
      const lengths = rawValues(r.rawHeaders, "content-length");
      if (lengths.length > 1 || (lengths.length === 1 && !(Number(lengths[0]) <= maxBytes))) return finish({ ok: false, why: "too_big" });
      const encs = rawValues(r.rawHeaders, "content-encoding").map((e) => e.trim().toLowerCase());
      const enc = encs.length === 0 || (encs.length === 1 && encs[0] === "identity") ? null : encs.length === 1 ? encs[0] : "many";
      if (enc !== null && enc !== "gzip" && enc !== "x-gzip" && enc !== "br") return finish({ ok: false, why: "encoding" });
      const chunks = [];
      let sent = 0;
      let unpacked = 0;
      const take = (c) => {
        if (done) return;
        unpacked += c.length;
        if (unpacked > maxBytes) return finish({ ok: false, why: "too_big" });
        chunks.push(c);
        if (onChunk) {
          let early;
          try { early = onChunk(c, { status, type }); } catch { return finish({ ok: false, why: "reader" }); }
          if (early !== undefined) finish({ ok: true, status, rawHeaders: r.rawHeaders, type, body: Buffer.concat(chunks), early });
        }
      };
      const complete = () => {
        if (!done) finish({ ok: true, status, rawHeaders: r.rawHeaders, type, body: Buffer.concat(chunks), early: undefined });
      };
      if (enc !== null) {
        unpack = enc === "br" ? createBrotliDecompress() : createGunzip();
        unpack.on("data", take);
        unpack.on("end", complete);
        unpack.on("error", () => finish({ ok: false, why: "encoding" }));
      }
      r.on("data", (c) => {
        if (done) return;
        sent += c.length;
        if (sent > maxBytes) return finish({ ok: false, why: "too_big" });
        if (unpack) unpack.write(c);
        else take(c);
      });
      r.on("end", () => {
        if (done) return;
        if (!r.complete) return finish({ ok: false, why: "cut" });
        if (unpack) unpack.end();
        else complete();
      });
      r.on("error", () => finish({ ok: false, why: "cut" }));
      r.on("aborted", () => finish({ ok: false, why: "cut" }));
    });
    req.end(body || undefined);
  });
}

// One request to Higgsfield's origin (`up` from checkHfOrigin), once, as `exchange` says. The
// headers given are the caller's; Host, Content-Length, Accept-Encoding and Connection are set
// here. Never follows a redirect and never reads a proxy variable. Never rejects.
export async function hfRequest(up, { net = REAL_NET, method, path, headers = {}, body = null, maxBytes, ms, signal, onChunk } = {}) {
  const deadline = Date.now() + ms;
  const s = await openSocket({ net, host: up.hostname, port: up.port, secure: up.protocol === "https:", loopback: up.standIn, deadline, signal, maxAddresses: HF_LIMITS.maxAddresses });
  if (!s.ok) return s;
  const head = { ...headers, Host: up.standIn ? `127.0.0.1:${up.port}` : up.hostname, "Accept-Encoding": "identity", Connection: "close" };
  if (body) head["Content-Length"] = String(body.length);
  return exchange({ socket: s.socket, method, path, headers: head, body, maxBytes, deadline, signal, onChunk });
}

// ---- tolerant readers ------------------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const NUMBER_TEXT = /^[0-9]{1,9}(\.[0-9]{1,6})?$/;
// A count of credits: a finite number at least 0, or such a number written as text; else null.
export function creditsValue(v) {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v === "string" && NUMBER_TEXT.test(v.trim())) return Number(v.trim());
  if (isObj(v)) return creditsValue(v.credits);
  return null;
}
const CREDIT_KEYS = ["credits", "cost", "total_credits", "credits_cost", "credit_cost", "estimated_credits", "estimated_cost", "price", "credits_spent", "amount"];
// The first credit count found under one of the known names, at the top or one level down in
// `result`, `data` or `cost`; null when there is none.
export function creditsIn(obj) {
  const look = (o) => {
    if (!isObj(o)) return null;
    for (const k of CREDIT_KEYS) if (Object.hasOwn(o, k)) { const c = creditsValue(o[k]); if (c !== null) return c; }
    return null;
  };
  const top = look(obj);
  if (top !== null) return top;
  for (const k of ["result", "data", "cost"]) { const c = isObj(obj) ? look(obj[k]) : null; if (c !== null) return c; }
  return null;
}
// True when the answer names a job: what a price-only (`get_cost`) answer must never do.
function namesJob(obj) {
  if (!isObj(obj)) return false;
  const something = (v) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v !== "" : v !== null && v !== undefined && v !== false);
  return ["job_id", "jobId", "job_ids", "jobs", "job"].some((k) => Object.hasOwn(obj, k) && something(obj[k]));
}
// The one job id a start answer names: { ok: true, id } or { ok: false, why }.
function jobIdOf(obj) {
  if (!isObj(obj)) return { ok: false, why: "no_job_id" };
  const ids = [];
  for (const k of ["job_id", "jobId"]) if (Object.hasOwn(obj, k)) ids.push(obj[k]);
  if (isObj(obj.job)) for (const k of ["id", "job_id"]) if (Object.hasOwn(obj.job, k)) ids.push(obj.job[k]);
  if (Array.isArray(obj.jobs)) for (const j of obj.jobs) ids.push(isObj(j) ? (j.job_id !== undefined ? j.job_id : j.id) : j);
  if (Array.isArray(obj.job_ids)) ids.push(...obj.job_ids);
  if (ids.length === 0 && Object.hasOwn(obj, "id")) ids.push(obj.id);
  const distinct = [...new Set(ids)];
  if (distinct.length === 0) return { ok: false, why: "no_job_id" };
  if (distinct.length > 1) return { ok: false, why: "several_jobs" };
  return typeof distinct[0] === "string" && JOB_ID_RE.test(distinct[0]) ? { ok: true, id: distinct[0] } : { ok: false, why: "bad_job_id" };
}

const DONE = new Set(["completed", "complete", "done", "succeeded", "success", "successful", "finished", "ready"]);
const FAILED = new Set(["failed", "failure", "error", "errored", "canceled", "cancelled", "expired", "timeout", "timed_out"]);
const FLAGGED = new Set(["nsfw", "flagged", "moderated", "blocked", "rejected", "safety", "content_policy", "content_filtered", "policy_violation"]);
const WORKING = new Set(["queued", "pending", "in_progress", "processing", "running", "waiting", "started", "submitted", "in_queue", "created", "generating"]);
// Where a finished job's address may be, most likely first.
const URL_PATHS = [
  ["result", "url"], ["result"], ["result", "urls", 0], ["result", "video", "url"], ["result", "image", "url"], ["result", "images", 0, "url"],
  ["result", "videos", 0, "url"], ["result", "media", 0, "url"], ["result", "outputs", 0, "url"], ["result", "raw", "url"],
  ["output", "url"], ["output"], ["outputs", 0, "url"], ["outputs", 0], ["output_url"], ["url"], ["urls", 0], ["video", "url"], ["image", "url"],
  ["images", 0, "url"], ["videos", 0, "url"], ["media", 0, "url"], ["results", 0, "url"],
];
const at = (o, path) => path.reduce((v, k) => (v !== null && typeof v === "object" ? v[k] : undefined), o);
function urlIn(entry) {
  for (const p of URL_PATHS) {
    const v = at(entry, p);
    if (typeof v === "string" && v.length > 0 && v.length <= 4096) return v;
  }
  return null;
}
function reasonIn(entry) {
  for (const k of ["error", "message", "reason", "failure", "error_message", "detail"]) {
    const v = entry[k];
    if (typeof v === "string") return v;
    if (isObj(v) && typeof v.message === "string") return v.message;
  }
  return "";
}

// ---- the door's calls ------------------------------------------------------------------------

const PICTURE_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const HEADER_VALUE = /^[\x20-\x7e]{0,2048}$/;
// Answer headers never passed on to the upload host: K21's three, and every framing name.
const NOT_PASSED = new Set(["authorization", "cookie", "host", "content-type", "content-length", "transfer-encoding", "connection", "upgrade",
  "te", "trailer", "expect", "keep-alive", "proxy-authorization", "proxy-connection"]);
const HOST_SUFFIX = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function checkSuffixes(list) {
  if (!Array.isArray(list) || !list.every((s) => typeof s === "string" && HOST_SUFFIX.test(s))) throw new Error("createHiggsfield: upload suffixes must be host names");
  return Object.freeze([...list]);
}
const underSuffix = (host, suffixes) => suffixes.some((s) => host === s || host.endsWith(`.${s}`));

// Higgsfield's tools for the door, over an MCP client (`createMcpClient`): each answer read
// tolerantly and checked. `uploadSuffixes` is for tests only (main passes none: the registry's).
// Every method resolves, never rejects: { ok: true, ... } or { ok: false, why, text? }.
export function createHiggsfield({ mcp, net, limits, uploadSuffixes } = {}) {
  if (!mcp || typeof mcp.call !== "function") throw new Error("createHiggsfield: mcp needs call");
  const theNet = net === undefined ? REAL_NET : net;
  if (!theNet || typeof theNet.resolve !== "function" || typeof theNet.connect !== "function") throw new Error("createHiggsfield: net needs resolve and connect");
  const lim = { ...HF_LIMITS, ...(limits || {}) };
  const suffixes = checkSuffixes(uploadSuffixes === undefined ? HF_UPLOAD_SUFFIXES : uploadSuffixes);
  const scrub = (t) => (typeof mcp.scrub === "function" ? mcp.scrub(t, TEXT_MAX) : NO_SECRETS.scrub(t, TEXT_MAX));
  const failed = (r) => ({ ok: false, why: r.why, text: r.text || "", sent: r.sent === true });

  // The tool and its arguments for one job of `row` (a Higgsfield row of the registry). `params`
  // is the door's checked job: { kind, prompt, ratio, resolution, seconds, medias: [ { mediaId,
  // role } ], width, height } (width and height: the upscaled picture's own size).
  function toolCall(row, params) {
    if (!row || row.provider !== "higgsfield" || !params || !row.kinds.includes(params.kind)) return { ok: false, why: "not_higgsfield" };
    // The door checked the job against the row (parseAppJob); checked again here, so nothing
    // the row does not name can reach Higgsfield's arguments.
    const fits = (typeof params.prompt === "string" && params.prompt.length <= row.promptMax)
      && (row.ratios === null ? params.ratio == null : row.ratios.includes(params.ratio))
      && (row.resolutions === null ? params.resolution == null : row.resolutions.includes(params.resolution))
      && (row.seconds === null ? params.seconds == null
        : Number.isInteger(params.seconds) && (row.seconds.list ? row.seconds.list.includes(params.seconds) : params.seconds >= row.seconds.min && params.seconds <= row.seconds.max));
    if (!fits) return { ok: false, why: "not_the_rows" };
    const medias = Array.isArray(params.medias) ? params.medias : [];
    if (medias.length > row.refs.max || !medias.every((m) => isObj(m) && typeof m.mediaId === "string" && MEDIA_ID_RE.test(m.mediaId) && row.refs.roles.includes(m.role))) {
      return { ok: false, why: "bad_media" };
    }
    if (row.tool === "upscale_image") {
      const ok = medias.length === 1 && [params.width, params.height].every((n) => Number.isInteger(n) && n >= 1 && n <= 20000);
      if (!ok) return { ok: false, why: "bad_media" };
      return { ok: true, name: row.tool, args: { image_id: medias[0].mediaId, width: params.width, height: params.height, resolution: params.resolution, ...row.fixed } };
    }
    const p = { model: row.remote, prompt: params.prompt };
    if (typeof params.ratio === "string") p.aspect_ratio = params.ratio;
    if (row.resolutionParam && typeof params.resolution === "string") p[row.resolutionParam] = params.resolution;
    if (row.tool === "generate_video") p.duration = params.seconds;
    if (medias.length) p.medias = medias.map((m) => ({ value: m.mediaId, role: row.hfRoles[m.role] }));
    return { ok: true, name: row.tool, args: { params: { ...p, ...row.fixed, use_unlim: false, use_free_gens: false } } };
  }
  const priced = (c) => (c.name === "upscale_image" ? { ...c.args, get_cost: true } : { params: { ...c.args.params, get_cost: true } });

  return {
    // Higgsfield's live price for the job, in credits, asked with `get_cost: true` and the same
    // arguments the job will carry. An answer that names a job is refused (`job_started`).
    async cost(row, params) {
      const c = toolCall(row, params);
      if (!c.ok) return c;
      const r = await mcp.call(c.name, priced(c));
      if (!r.ok) return failed(r);
      if (namesJob(r.result)) {
        const id = jobIdOf(r.result);
        return { ok: false, why: "job_started", jobId: id.ok ? id.id : null, text: "" };
      }
      const credits = creditsIn(r.result);
      return credits === null ? { ok: false, why: "no_price", text: "" } : { ok: true, credits };
    },

    // One kept picture to Higgsfield: `media_upload`, the PUT, `media_confirm`. The PUT goes only
    // to an https address on a public host under one of the upload suffixes, with Content-Type
    // and the answer's own upload headers (checked), no redirect, 30 seconds. { ok, mediaId }.
    async upload(picture) {
      const ext = picture && PICTURE_EXT[picture.type];
      if (!ext || !Buffer.isBuffer(picture.bytes) || picture.bytes.length === 0) return { ok: false, why: "bad_picture" };
      if (suffixes.length === 0) return { ok: false, why: "upload_host_unknown" };
      const r = await mcp.call("media_upload", { filename: `input.${ext}`, content_type: picture.type });
      if (!r.ok) return failed(r);
      const slot = [r.result, ...(["uploads", "files", "media"].map((k) => (isObj(r.result) && Array.isArray(r.result[k]) ? r.result[k][0] : undefined)))]
        .find((o) => isObj(o) && typeof o.upload_url === "string");
      if (!slot) return { ok: false, why: "no_upload_address" };
      const mediaId = slot.media_id !== undefined ? slot.media_id : slot.id;
      if (typeof mediaId !== "string" || !MEDIA_ID_RE.test(mediaId)) return { ok: false, why: "bad_media_id" };
      const a = checkAddress(slot.upload_url);
      if (!a.ok || !a.secure || a.port !== 443) return { ok: false, why: "upload_address" };
      if (!underSuffix(a.host, suffixes)) return { ok: false, why: "upload_host" };
      const extra = {};
      const given = slot.upload_headers === undefined || slot.upload_headers === null ? {} : slot.upload_headers;
      if (!isObj(given) || Object.keys(given).length > 16) return { ok: false, why: "upload_headers" };
      for (const [name, value] of Object.entries(given)) {
        if (!HEADER_NAME.test(name) || typeof value !== "string" || !HEADER_VALUE.test(value)) return { ok: false, why: "upload_headers" };
        if (NOT_PASSED.has(name.toLowerCase()) || name.toLowerCase().startsWith("proxy-")) continue;
        extra[name] = value;
      }
      const deadline = Date.now() + lim.uploadMs;
      const s = await openSocket({ net: theNet, host: a.host, port: a.port, secure: true, loopback: false, deadline, maxAddresses: lim.maxAddresses });
      if (!s.ok) return { ok: false, why: s.why === "private_address" ? "upload_private_address" : "upload_unreachable" };
      const put = await exchange({
        socket: s.socket, method: "PUT", path: `${a.url.pathname}${a.url.search}`, deadline, maxBytes: lim.uploadAnswerBytes,
        headers: { ...extra, Host: a.host, "Content-Type": picture.type, "Content-Length": String(picture.bytes.length), Connection: "close" },
        body: picture.bytes,
      });
      if (!put.ok) return { ok: false, why: "upload_unreachable" };
      if (put.status >= 300 && put.status < 400) return { ok: false, why: "upload_redirect" };
      if (put.status < 200 || put.status > 299) return { ok: false, why: "upload_refused" };
      const c = await mcp.call("media_confirm", { type: "image", media_id: mediaId });
      if (!c.ok) return failed(c);
      const st = isObj(c.result) && typeof c.result.status === "string" ? c.result.status.toLowerCase() : null;
      if (st !== null && (FAILED.has(st) || FLAGGED.has(st))) return { ok: false, why: "upload_not_confirmed" };
      return { ok: true, mediaId };
    },

    // Starts the job: { ok: true, jobId, credits (a cost the answer states, or null) } or
    // { ok: false, why, text, clear }. `clear` is true only when nothing can have started (the
    // call never went, or Higgsfield clearly refused it); otherwise the door keeps it spent.
    async start(row, params) {
      const c = toolCall(row, params);
      if (!c.ok) return { ...c, text: "", clear: true };
      const r = await mcp.call(c.name, c.args);
      if (!r.ok) {
        // A 4xx (a 401, a lost session, a limit) is Higgsfield refusing the call before the tool ran.
        const clear = r.sent !== true || r.why === "tool_error" || r.why === "rpc_error" || (Number.isInteger(r.status) && r.status >= 400 && r.status < 500);
        return { ok: false, why: r.why, text: r.text || "", clear };
      }
      const id = jobIdOf(r.result);
      if (!id.ok) return { ok: false, why: id.why, text: "", clear: false };
      return { ok: true, jobId: id.id, credits: creditsIn(r.result) };
    },

    // Asks about one job, waiting up to `timeoutSec` (0 to 15) on Higgsfield's side. { ok: true,
    // state: working | done | failed | refused (flagged) | unknown, url, cost, costZero, reason }.
    async wait(jobId, timeoutSec = 0) {
      if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) return { ok: false, why: "bad_job_id", text: "" };
      const timeout = Number.isInteger(timeoutSec) ? Math.min(lim.waitSec, Math.max(0, timeoutSec)) : 0;
      const r = await mcp.call("jobs_wait", { jobs: [{ index: 0, job_id: jobId }], timeout_seconds: timeout });
      if (!r.ok) return failed(r);
      const res = r.result;
      const list = isObj(res) && Array.isArray(res.jobs) ? res.jobs : isObj(res) && Array.isArray(res.results) ? res.results : [res];
      const mine = list.filter((e) => isObj(e) && (e.job_id === jobId || e.id === jobId));
      const entry = mine.length === 1 ? mine[0] : list.length === 1 && isObj(list[0]) && list[0].job_id === undefined && list[0].id === undefined ? list[0] : null;
      const unknown = { ok: true, state: "unknown", url: null, cost: null, costZero: false, reason: "" };
      if (entry === null) return unknown;
      const raw = [entry.status, entry.state].find((s) => typeof s === "string" && s.length <= 40);
      const status = raw === undefined ? "" : raw.trim().toLowerCase();
      const cost = creditsIn(entry);
      const out = { ok: true, url: null, cost, costZero: cost === 0, reason: scrub(reasonIn(entry)) };
      if (DONE.has(status)) return { ...out, state: "done", url: urlIn(entry) };
      if (FLAGGED.has(status)) return { ...out, state: "refused" };
      if (FAILED.has(status)) return { ...out, state: "failed" };
      if (WORKING.has(status)) return { ...out, state: "working" };
      return { ...unknown, cost, costZero: cost === 0 };
    },

    // The owner's credits and plan (Settings' Test). { ok: true, credits, plan }.
    async balance() {
      const r = await mcp.call("balance", {});
      if (!r.ok) return failed(r);
      const res = r.result;
      let credits = creditsIn(res);
      if (credits === null && isObj(res)) for (const k of ["balance", "credit_balance", "remaining_credits"]) if (credits === null) credits = creditsValue(res[k]);
      if (credits === null) return { ok: false, why: "no_balance", text: "" };
      const plan = isObj(res) && typeof res.plan === "string" && /^[A-Za-z0-9 _.-]{1,40}$/.test(res.plan) ? res.plan : null;
      return { ok: true, credits, plan };
    },

    // A finished job's result, fetched as Runway's are (K13): https, a public host, the lookup
    // pinned, no redirect, no header of ours, at most 200 MB a video and 30 MB a picture, and
    // the first bytes those of an MP4, PNG, JPEG or WebP. { ok: true, kind, body, host }.
    async output(url, want, { signal } = {}) {
      if (want !== "video" && want !== "picture") return { ok: false, why: "want" };
      const a = checkAddress(url);
      if (!a.ok || !a.secure) return { ok: false, why: "address" };
      const r = await fetchPublic(a.href, {
        net: theNet, signal,
        limits: { maxRedirects: 0, maxBytes: want === "video" ? lim.videoBytes : lim.pictureBytes, types: null, totalMs: lim.downloadMs },
      });
      if (!r.ok) return { ok: false, why: r.why === "redirects" ? "redirect" : r.code };
      if (r.status !== 200) return { ok: false, why: "status" };
      const kind = sniffOutput(r.body, want);
      if (!kind) return { ok: false, why: "not_media" };
      return { ok: true, kind, body: r.body, host: r.host };
    },
  };
}
