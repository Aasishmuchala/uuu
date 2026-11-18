// Everything the generation door knows about Runway's MCP server, the owner's second way in to
// Runway (PLAN-ONBOARD R1, decisions R-3 to R-10): the one origin and its fixed paths, the scope,
// the only tools the door calls, and those tools' answers read tolerantly and checked. Nothing
// else in the engine names this origin (the developer service is ./runway.mjs). The constants are
// R0's (`.router/RUNWAY-MCP-FACTS.md`, read 18 November 2026); no metadata document is read at run
// time, so a changed document cannot move the sign-in. Runway's answers are hostile text: ids are
// matched by pattern, numbers must be finite and at least 0, texts are scrubbed of the tokens and
// cut to 300 characters, and no redirect is ever followed. Zero dependencies.
//
// The money rule, written down plainly (the facts file, section 4). Runway publishes no price
// table and no price tool. A generation tool asked WITHOUT `costApproval` is expected to answer
// `cost_confirmation_required` with a quote and an approval string; the same request sent again
// WITH that string makes the job. It is NOT known whether every unapproved request is answered
// with a quote, or whether a cheap one may start, and charge, at once. So:
//   - the door holds the row's ceiling in the ledger BEFORE the first (unapproved) call, inside
//     every limit and approval, so even a job that starts at once is inside them (if its real
//     cost is within the ceiling; the ceiling is the door's own, see registry.mjs);
//   - a first answer that names a task, or that is neither a quote nor a clear refusal, is never
//     accepted: `quote` answers `started` or `unclear`, and the door counts the whole ceiling as
//     spent and pauses Generation until the owner presses Start again;
//   - a quote is used only when it is plainly one: the marker, one approval string, one credit
//     count that is a whole number of at least 1 under a name that says "credits", and no task
//     named; a quote above the row's ceiling is refused;
//   - the door checks the quote against the daily and monthly limits and the batch or the app's
//     allowance again before it sends the approval;
//   - until a real quote has confirmed this reader (no real one was seen, R0), a job is settled
//     at the row's ceiling, not at the quote, or at more if Runway later states more. The quote
//     is noted in the ledger beside the ceiling, so the first real jobs show whether it is right.
// What cannot be made safe here: if Runway charged a job that started without a quote MORE than
// the row's ceiling and never said so, the ledger would hold less than was spent. Such a job is
// followed to its end (a cost Runway states raises the charge), and the pause after it limits
// that to one job until the owner looks.
import { HF_LIMITS, NO_SECRETS, TEXT_MAX, creditsValue, hfRequest } from "./higgsfield.mjs";
import { RW_UPLOAD_SUFFIXES, accountRatios } from "./registry.mjs";
import { sniffOutput } from "./state.mjs";
import { checkAddress } from "../web/address.mjs";
import { REAL_NET, fetchPublic } from "../web/fetch.mjs";

export const RW_MCP_ORIGIN = "https://mcp.runwayml.com";
const RW_HOST = new URL(RW_MCP_ORIGIN).hostname;
export const RW_PATHS = Object.freeze({ mcp: "/mcp", register: "/register", authorize: "/authorize", token: "/token" });
export const RW_SCOPE = "openid api:read_write";
// The only tools the door may call: the balance (whoami, which also confirms the sign-in), a
// picture, a clip, a larger still, a job's state, and a picture's upload. Never a workflow, an
// agent run, a checkout, a feedback or a tracking tool.
export const RW_TOOLS = Object.freeze(["whoami", "generate_image", "generate_video", "upscale_image", "get_task", "init_upload", "complete_upload"]);
export const QUOTE_MARK = "cost_confirmation_required";
const STAND_IN = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/;

export const RW_LIMITS = Object.freeze({
  answerBytes: HF_LIMITS.answerBytes,
  callMs: HF_LIMITS.callMs,
  authBytes: HF_LIMITS.authBytes,
  authMs: HF_LIMITS.authMs,
  uploadMs: HF_LIMITS.uploadMs,
  uploadAnswerBytes: HF_LIMITS.uploadAnswerBytes,
  downloadMs: HF_LIMITS.downloadMs,
  videoBytes: HF_LIMITS.videoBytes,
  pictureBytes: HF_LIMITS.pictureBytes,
  maxAddresses: HF_LIMITS.maxAddresses,
  maxCredits: 1_000_000,          // a stated cost above this is no cost at all
});

export const TASK_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const APPROVAL_RE = /^[\x21-\x7e]{1,4096}$/;
const UPLOAD_ID_RE = /^[\x21-\x7e]{1,1024}$/;
const ETAG_RE = /^[A-Za-z0-9._:/+=-]{1,200}$/;
const ASSET_URL_MAX = 4096;

// Returns { origin, protocol, hostname, port, standIn, resource } for Runway's one MCP origin or
// a stand-in on http://127.0.0.1:<port>; throws on anything else. Compared as given.
export function checkRwOrigin(origin) {
  if (origin === RW_MCP_ORIGIN) {
    return Object.freeze({ origin, protocol: "https:", hostname: RW_HOST, port: 443, standIn: false, resource: `${origin}${RW_PATHS.mcp}` });
  }
  const m = typeof origin === "string" ? STAND_IN.exec(origin) : null;
  if (m && Number(m[1]) <= 65535) {
    return Object.freeze({ origin, protocol: "http:", hostname: "127.0.0.1", port: Number(m[1]), standIn: true, resource: `${origin}${RW_PATHS.mcp}` });
  }
  throw new Error(`origin must be ${RW_MCP_ORIGIN} or a stand-in on http://127.0.0.1:<port>`);
}

// ---- tolerant readers ------------------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// Only names that say "credits": a number under a name with no unit (`cost`, `price`, `amount`,
// `estimatedCost`) may be dollars or cents, and is never read as a count of credits.
const CREDIT_KEYS = ["credits", "creditCost", "creditsCost", "credit_cost", "credits_cost", "estimatedCredits", "estimated_credits",
  "totalCredits", "total_credits", "creditsRequired", "credits_required", "requiredCredits"];
const NESTS = ["quote", "cost", "result", "data", "estimate", "confirmation", "task", "error"];

// Every object reachable from `v` through NESTS, `v` first, at most three deep.
function layers(v) {
  const out = [];
  const walk = (o, depth) => {
    if (!isObj(o) || depth > 3 || out.includes(o)) return;
    out.push(o);
    for (const k of NESTS) if (Object.hasOwn(o, k)) walk(o[k], depth + 1);
  };
  walk(v, 0);
  return out;
}
// The distinct values found under `keys` in any layer.
function found(v, keys, take) {
  const seen = [];
  for (const o of layers(v)) {
    for (const k of keys) {
      if (!Object.hasOwn(o, k)) continue;
      const x = take(o[k]);
      if (x !== null && !seen.includes(x)) seen.push(x);
    }
  }
  return seen;
}
const credit = (v) => {
  const c = creditsValue(typeof v === "object" && v !== null && !Array.isArray(v) ? v.credits : v);
  return c !== null && c <= RW_LIMITS.maxCredits ? c : null;
};
// The task ids an answer names (a list, and a task named in a list counts).
function taskIdsIn(v, { plainId }) {
  const ids = [];
  const add = (x) => { if (x !== undefined && x !== null && x !== "" && !ids.includes(x)) ids.push(x); };
  for (const o of layers(v)) {
    for (const k of ["taskId", "task_id"]) if (Object.hasOwn(o, k)) add(o[k]);
    for (const k of ["taskIds", "task_ids", "tasks"]) {
      if (!Object.hasOwn(o, k)) continue;
      if (!Array.isArray(o[k])) { add(o[k]); continue; }
      for (const t of o[k]) add(isObj(t) ? (t.id !== undefined ? t.id : t.taskId) : t);
    }
  }
  if (plainId && isObj(v) && Object.hasOwn(v, "id")) add(v.id);
  return ids;
}
// True when the answer says it is a cost question: the marker as a value of a word field, or as a key.
function marked(v) {
  for (const o of layers(v)) {
    if (Object.hasOwn(o, QUOTE_MARK)) return true;
    for (const k of ["status", "type", "code", "kind", "reason", "error", "result", "state"]) {
      if (typeof o[k] === "string" && o[k].trim().toLowerCase() === QUOTE_MARK) return true;
    }
  }
  return false;
}

// What the first (unapproved) answer of a generation tool is: { kind: "quote", credits, approval }
// | { kind: "started", taskId } | { kind: "refused" } (marked as a cost question, or a refusal,
// and naming no task, but without a usable quote: nothing started) | { kind: "unclear" }.
// `v` is the parsed result or refusal (or null); `plain` its text when it was not JSON.
export function readFirstAnswer(v, plain = "") {
  const mark = (v !== null && marked(v)) || (typeof plain === "string" && plain.toLowerCase().includes(QUOTE_MARK));
  const ids = v === null ? [] : taskIdsIn(v, { plainId: !mark });
  if (ids.length > 0) return { kind: "started", taskId: ids.length === 1 && typeof ids[0] === "string" && TASK_ID_RE.test(ids[0]) ? ids[0] : null };
  if (!mark) return { kind: "unclear" };
  if (v === null) return { kind: "refused" };
  const approvals = found(v, ["costApproval", "cost_approval"], (x) => (typeof x === "string" && APPROVAL_RE.test(x) ? x : null));
  const credits = found(v, CREDIT_KEYS, credit);
  // A quote is a whole number of at least one credit: 0, a part of a credit, or two counts are no quote.
  if (approvals.length !== 1 || credits.length !== 1 || !Number.isInteger(credits[0]) || credits[0] < 1) return { kind: "refused" };
  return { kind: "quote", credits: credits[0], approval: approvals[0] };
}

const DONE = new Set(["succeeded", "success", "completed", "complete", "done", "finished", "ready"]);
const FAILED = new Set(["failed", "failure", "error", "errored", "cancelled", "canceled", "expired", "timeout", "timed_out"]);
const WORKING = new Set(["pending", "queued", "running", "in_progress", "processing", "throttled", "starting", "submitted", "created", "generating", "waiting"]);
const FLAG_WORDS = /safety|moderat|nsfw|content_policy|flagged|blocked/i;
const URL_PATHS = [
  ["output", 0], ["output", 0, "url"], ["outputs", 0], ["outputs", 0, "url"], ["artifacts", 0, "url"], ["artifacts", 0], ["assetUrl"], ["asset_url"],
  ["url"], ["output", "url"], ["result", "url"], ["result", "output", 0], ["result", "artifacts", 0, "url"], ["asset", "url"],
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
  for (const k of ["failure", "error", "message", "reason", "failureReason", "error_message", "detail"]) {
    const v = entry[k];
    if (typeof v === "string") return v;
    if (isObj(v) && typeof v.message === "string") return v.message;
  }
  return "";
}

// ---- uploads -----------------------------------------------------------------------------------

const PICTURE_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const HOST_SUFFIX = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
function checkSuffixes(list) {
  if (!Array.isArray(list) || !list.every((s) => typeof s === "string" && HOST_SUFFIX.test(s))) throw new Error("createRunwayMcp: upload suffixes must be host names");
  return Object.freeze([...list]);
}
const underSuffix = (host, suffixes) => suffixes.some((s) => host === s || host.endsWith(`.${s}`));

// A temporary upload address, by rules of its own (its shape is not known yet: R0 saw none).
// Taken only for a host under the pinned suffixes: https, no port, no user info, no fragment,
// written exactly as read; a plain path; the query plain names and values, each name once. At
// most 4,096 characters. { ok, url, host, port } or { ok: false, why }. A look-alike host
// (`upload.example.evil`, `xupload.example`) is under no suffix and is refused.
const UPLOAD_MAX = 4096;
const UPLOAD_PRINTABLE = /^[\x21-\x7e]+$/;
const UPLOAD_PATH = /^\/[A-Za-z0-9._~%/-]{1,1024}$/;
const QUERY_NAME = /^[A-Za-z0-9._~-]{1,64}$/;
const QUERY_VALUE = /^[A-Za-z0-9%._~-]{0,3584}$/;
export function checkRwUploadAddress(text, suffixes) {
  const no = (why) => ({ ok: false, why });
  if (typeof text !== "string" || text.length > UPLOAD_MAX || !UPLOAD_PRINTABLE.test(text)) return no("upload_address");
  let url;
  try { url = new URL(text); } catch { return no("upload_address"); }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" || url.hash !== "") return no("upload_address");
  const host = url.hostname;
  if (!HOST_SUFFIX.test(host)) return no("upload_address");
  if (!underSuffix(host, suffixes)) return no("upload_host");
  const lead = `https://${host}`;
  if (text.slice(0, lead.length).toLowerCase() !== lead || text.slice(lead.length) !== `${url.pathname}${url.search}`) return no("upload_address");
  if (!UPLOAD_PATH.test(url.pathname) || url.pathname.includes("//") || /(^|\/)\.\.?(\/|$)/.test(url.pathname)) return no("upload_address");
  const seen = new Set();
  for (const part of url.search === "" ? [] : url.search.slice(1).split("&")) {
    const eq = part.indexOf("=");
    const name = eq > 0 ? part.slice(0, eq) : "";
    if (!QUERY_NAME.test(name) || seen.has(name) || !QUERY_VALUE.test(part.slice(eq + 1))) return no("upload_address");
    seen.add(name);
  }
  return { ok: true, url, host, port: 443 };
}
// The host of an offered upload address, when it is a plain host name; else null (for the log).
function offeredHost(text) {
  try {
    const u = new URL(text);
    return u.protocol === "https:" && HOST_SUFFIX.test(u.hostname) ? u.hostname : null;
  } catch {
    return null;
  }
}

// ---- the door's calls ----------------------------------------------------------------------------

// Runway's account tools for the door, over an MCP client (`createMcpClient` with Runway's
// origin, path and tools). `uploadSuffixes` is for tests only (main passes none: the registry's).
// `log(line)` hears the upload host Runway offered while none is pinned (a host name only).
// Every method resolves, never rejects: { ok: true, ... } or { ok: false, why, text? }.
export function createRunwayMcp({ mcp, net, limits, uploadSuffixes, log } = {}) {
  if (!mcp || typeof mcp.call !== "function") throw new Error("createRunwayMcp: mcp needs call");
  const theNet = net === undefined ? REAL_NET : net;
  if (!theNet || typeof theNet.resolve !== "function" || typeof theNet.connect !== "function") throw new Error("createRunwayMcp: net needs resolve and connect");
  const lim = { ...RW_LIMITS, ...(limits || {}) };
  const suffixes = checkSuffixes(uploadSuffixes === undefined ? RW_UPLOAD_SUFFIXES : uploadSuffixes);
  const scrub = (t) => (typeof mcp.scrub === "function" ? mcp.scrub(t, TEXT_MAX) : NO_SECRETS.scrub(t, TEXT_MAX));
  const say = (line) => { try { if (typeof log === "function") log(line); } catch { /* a log failure changes nothing */ } };
  const failed = (r) => ({ ok: false, why: r.why, text: r.text || "", sent: r.sent === true, status: Number.isInteger(r.status) ? r.status : null });

  // The tool and its arguments for one job of `row` (an account row of the registry). `params` is
  // the door's checked job: { kind, prompt, ratio, seconds, scale, assets: [ { url, role } ],
  // width, height }. The row's pins go last. `confirmRepeat` is always true: each job the door
  // sends is one the owner's approval asked for, and an earlier task never stands in for it.
  function toolCall(row, params) {
    if (!row || row.provider !== "runway-account" || !params || !row.kinds.includes(params.kind)) return { ok: false, why: "not_account" };
    const assets = Array.isArray(params.assets) ? params.assets : [];
    if (assets.length > row.refs.max || !assets.every((a) => isObj(a) && typeof a.url === "string" && a.url.length <= ASSET_URL_MAX
      && a.url.startsWith("https://") && row.refs.roles.includes(a.role))) return { ok: false, why: "bad_asset" };
    const fits = (typeof params.prompt === "string" && params.prompt.length <= row.promptMax)
      && (row.ratios === null ? params.ratio == null : accountRatios(row, params.kind).includes(params.ratio))
      && (row.seconds === null ? params.seconds == null
        : Number.isInteger(params.seconds) && (row.seconds.list ? row.seconds.list.includes(params.seconds) : params.seconds >= row.seconds.min && params.seconds <= row.seconds.max));
    if (!fits) return { ok: false, why: "not_the_rows" };
    if (row.tool === "upscale_image") {
      const ok = assets.length === 1 && row.scales !== null && row.scales.includes(params.scale);
      if (!ok) return { ok: false, why: "bad_asset" };
      const image = { url: assets[0].url };
      if (Number.isInteger(params.width) && Number.isInteger(params.height)) Object.assign(image, { width: params.width, height: params.height });
      return { ok: true, name: row.tool, args: { image, scaleFactor: params.scale, ...row.fixed, confirmRepeat: true } };
    }
    const a = { model: row.remote, promptText: params.prompt, ratio: params.ratio };
    if (row.tool === "generate_video") {
      a.duration = params.seconds;
      const first = assets.find((x) => x.role === "first");
      if (first) a.startFrame = { url: first.url };
    } else {
      a.count = 1;
      if (assets.length) a.referenceImages = assets.map((x, i) => (row.tags ? { url: x.url, tag: `ref${i + 1}` } : { url: x.url }));
    }
    return { ok: true, name: row.tool, args: { ...a, ...row.fixed, confirmRepeat: true } };
  }

  return {
    // The first, unapproved call: { ok: true, credits, approval } (a plain quote), or { ok: false,
    // why, clear, taskId? }: why `started` (it named a task) or `unclear` (neither a quote nor a
    // clear refusal) is never accepted and clear is false; `no_quote` (a cost question the door
    // cannot read) and a clear refusal are clear (nothing started).
    async quote(row, params) {
      const c = toolCall(row, params);
      if (!c.ok) return { ...c, text: "", clear: true };
      const r = await mcp.call(c.name, c.args);
      if (r.ok) {
        const a = readFirstAnswer(r.result);
        if (a.kind === "quote") return { ok: true, credits: a.credits, approval: a.approval };
        if (a.kind === "started") return { ok: false, why: "started", taskId: a.taskId, text: "", clear: false };
        if (a.kind === "refused") return { ok: false, why: "no_quote", text: "", clear: true };
        return { ok: false, why: "unclear", text: "", clear: false };
      }
      if (r.why === "tool_error" || r.why === "no_result") {
        const a = readFirstAnswer(r.refusal === undefined ? null : r.refusal, r.plain || "");
        if (a.kind === "quote") return { ok: true, credits: a.credits, approval: a.approval };
        if (a.kind === "started") return { ok: false, why: "started", taskId: a.taskId, text: "", clear: false };
        if (a.kind === "refused") return { ok: false, why: "no_quote", text: "", clear: true };
        // A refusal that is not a cost question is Runway saying no before the tool ran.
        if (r.why === "tool_error") return { ok: false, why: "tool_error", text: r.text || "", clear: true };
        return { ok: false, why: "unclear", text: "", clear: false };
      }
      const clear = r.sent !== true || r.why === "rpc_error" || (Number.isInteger(r.status) && r.status >= 400 && r.status < 500);
      return { ok: false, why: r.why, text: r.text || "", clear };
    },

    // The approved call: the same arguments and the approval string. { ok: true, taskId, credits
    // (a cost the answer states, or null) } or { ok: false, why, text, clear }. A second quote
    // (the price moved) is `quote_again` and clear: nothing started.
    async start(row, params, approval) {
      const c = toolCall(row, params);
      if (!c.ok) return { ...c, text: "", clear: true };
      if (typeof approval !== "string" || !APPROVAL_RE.test(approval)) return { ok: false, why: "bad_approval", text: "", clear: true };
      const r = await mcp.call(c.name, { ...c.args, costApproval: approval });
      const v = r.ok ? r.result : r.why === "tool_error" || r.why === "no_result" ? (r.refusal === undefined ? null : r.refusal) : null;
      const plain = r.ok ? "" : r.plain || "";
      if (r.ok || r.why === "tool_error" || r.why === "no_result") {
        const a = readFirstAnswer(v, plain);
        // Another cost question (the price moved, or the approval was not taken): nothing started.
        if (a.kind === "quote" || a.kind === "refused") return { ok: false, why: "quote_again", text: "", clear: true };
        if (r.ok && a.kind === "started" && a.taskId !== null) {
          const cost = found(r.result, CREDIT_KEYS, credit);
          return { ok: true, taskId: a.taskId, credits: cost.length === 1 ? cost[0] : null };
        }
        if (r.why === "tool_error" && a.kind === "unclear") return { ok: false, why: "tool_error", text: r.text || "", clear: true };
        return { ok: false, why: a.kind === "started" ? "bad_task_id" : "no_task_id", text: "", clear: false };
      }
      const clear = r.sent !== true || r.why === "rpc_error" || (Number.isInteger(r.status) && r.status >= 400 && r.status < 500);
      return { ok: false, why: r.why, text: r.text || "", clear };
    },

    // Asks about one task once. { ok: true, state: working | done | failed | refused (flagged) |
    // unknown, url, cost, costZero, reason }.
    async task(taskId) {
      if (typeof taskId !== "string" || !TASK_ID_RE.test(taskId)) return { ok: false, why: "bad_task_id", text: "" };
      const r = await mcp.call("get_task", { id: taskId });
      if (!r.ok) return failed(r);
      const res = isObj(r.result) && isObj(r.result.task) ? r.result.task : r.result;
      const unknown = { ok: true, state: "unknown", url: null, cost: null, costZero: false, reason: "" };
      if (!isObj(res)) return unknown;
      const named = [res.id, res.taskId, res.task_id].filter((x) => x !== undefined);
      if (named.some((x) => x !== taskId)) return unknown;
      const raw = [res.status, res.state].find((s) => typeof s === "string" && s.length <= 40);
      const status = raw === undefined ? "" : raw.trim().toLowerCase();
      const costs = found(res, CREDIT_KEYS, credit);
      const cost = costs.length === 1 ? costs[0] : costs.length > 1 ? Math.max(...costs) : null;
      const reason = reasonIn(res);
      const code = [res.failureCode, res.failure_code, res.code].find((x) => typeof x === "string") || "";
      const out = { ok: true, url: null, cost, costZero: cost === 0 && costs.length === 1, reason: scrub(reason) };
      if (DONE.has(status)) return { ...out, state: "done", url: urlIn(res) };
      if (FAILED.has(status)) return { ...out, state: FLAG_WORDS.test(code) || FLAG_WORDS.test(reason) ? "refused" : "failed" };
      if (WORKING.has(status)) return { ...out, state: "working" };
      return { ...unknown, cost, costZero: out.costZero };
    },

    // One kept picture to Runway: `init_upload`, the one PUT, `complete_upload`. The PUT goes only
    // to an https address on a host under the pinned suffixes. With none pinned, the door asks
    // for an upload address once, logs the host it was offered (so a person can pin it), sends
    // no bytes, and answers `upload_host_unknown`. { ok: true, url (the asset's address) }.
    async upload(picture) {
      const ext = picture && PICTURE_EXT[picture.type];
      if (!ext || !Buffer.isBuffer(picture.bytes) || picture.bytes.length === 0) return { ok: false, why: "bad_picture" };
      const filename = `input.${ext}`;
      const r = await mcp.call("init_upload", { filename, fileSize: picture.bytes.length, mimeType: picture.type });
      if (!r.ok) return failed(r);
      const res = r.result;
      const urls = isObj(res) && Array.isArray(res.uploadUrls) ? res.uploadUrls : isObj(res) && typeof res.uploadUrl === "string" ? [res.uploadUrl] : null;
      const uploadId = isObj(res) ? res.uploadId : undefined;
      if (!urls || urls.length === 0) return { ok: false, why: "no_upload_address" };
      const first = isObj(urls[0]) && typeof urls[0].url === "string" ? urls[0].url : urls[0];
      if (suffixes.length === 0) {
        const host = offeredHost(first);
        say(`runway upload host offered and not pinned: ${host === null ? "(not a plain host)" : host}`);
        return { ok: false, why: "upload_host_unknown" };
      }
      if (urls.length !== 1) return { ok: false, why: "upload_parts" };
      if (typeof uploadId !== "string" || !UPLOAD_ID_RE.test(uploadId)) return { ok: false, why: "bad_upload_id" };
      const a = checkRwUploadAddress(first, suffixes);
      if (!a.ok) return { ok: false, why: a.why };
      const put = await hfRequest({ hostname: a.host, port: a.port, protocol: "https:", standIn: false }, {
        net: theNet, method: "PUT", path: `${a.url.pathname}${a.url.search}`, maxBytes: lim.uploadAnswerBytes, ms: lim.uploadMs,
        headers: { "Content-Type": picture.type }, body: picture.bytes,
      });
      if (!put.ok) return { ok: false, why: put.why === "private_address" ? "upload_private_address" : "upload_unreachable" };
      if (put.status >= 300 && put.status < 400) return { ok: false, why: "upload_redirect" };
      if (put.status < 200 || put.status > 299) return { ok: false, why: "upload_refused" };
      const tags = [];
      for (let i = 0; i + 1 < put.rawHeaders.length; i += 2) if (String(put.rawHeaders[i]).toLowerCase() === "etag") tags.push(String(put.rawHeaders[i + 1]));
      const etag = tags.length === 1 ? tags[0].trim().replace(/^W\//, "").replace(/^"(.*)"$/, "$1") : null;
      if (etag === null || !ETAG_RE.test(etag)) return { ok: false, why: "upload_no_etag" };
      const c = await mcp.call("complete_upload", { uploadId, parts: [{ partNumber: 1, etag }], filename, mimeType: picture.type });
      if (!c.ok) return failed(c);
      const url = isObj(c.result) ? [c.result.assetUrl, c.result.url, isObj(c.result.asset) ? c.result.asset.url : undefined].find((x) => typeof x === "string") : undefined;
      if (typeof url !== "string" || url.length > ASSET_URL_MAX || !url.startsWith("https://") || !UPLOAD_PRINTABLE.test(url)) return { ok: false, why: "no_asset_address" };
      return { ok: true, url };
    },

    // The owner's credits (Settings' Test): `whoami`, which costs nothing and confirms the sign-in.
    // { ok: true, credits (a number, or null when Runway gives none) }.
    async balance() {
      const r = await mcp.call("whoami", {});
      if (!r.ok) return failed(r);
      const res = r.result;
      if (!isObj(res) || res.authenticated === false) return { ok: false, why: "unauthorized", text: "" };
      const c = isObj(res.credits) ? res.credits : null;
      let credits = c === null ? credit(res.credits) : credit(c.total);
      if (credits === null && c !== null) credits = credit(c.remaining);
      return { ok: true, credits };
    },

    // A finished job's result, fetched as Runway's and Higgsfield's are (K13): https, a public
    // host, the lookup pinned, no redirect, no header of ours, at most 200 MB a video and 30 MB a
    // picture, and the first bytes those of an MP4, PNG, JPEG or WebP. { ok: true, kind, body, host }.
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

    // For tests: the arguments a job would carry.
    toolCall,
  };
}
