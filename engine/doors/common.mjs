// What the three doors share (PLAN-V5, contracts K1 and K3): the switches file, the caller's
// token, refusals, request bodies, the status file and the door's own secret. Zero
// dependencies. The token is the relay's (engine/relay/token.mjs), keyed with each door's own
// secret, so a token for one door is nothing at another. Files are read with the relay's trust
// rule (engine/relay/state.mjs) on every call; nothing is cached.
import { randomBytes } from "node:crypto";
import {
  chmodSync, closeSync, constants, fstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { checkToken } from "../relay/token.mjs";
import { MAX_FILE_BYTES, readIds, readSecret } from "../relay/state.mjs";

const BEARER = /^bearer +(\S+)$/i;
export const STATUS_EVERY_MS = 2000;

// K1's switches file with every field at its default: every door off.
export const DOORS_DEFAULTS = Object.freeze({
  web: {
    on: false, allow: [], block: [],
    watchHosts: ["youtube.com", "youtu.be", "googlevideo.com", "ytimg.com", "vimeo.com", "vimeocdn.com"],
    search: "keyless", perHour: 60, perDay: 300,
  },
  generate: {
    on: false, dailyCredits: 300, monthlyCredits: 1000, autoUnderCredits: 0, paused: null,
    models: { video: "gen4_turbo", videoBest: "gen4.5", still: "gen4_image", upscale: "magnific_precision_upscaler_v2" },
  },
  viewer: { on: false },
});

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const copy = (v) => JSON.parse(JSON.stringify(v));

// The file's text when it exists and passes the trust rule (a regular file, not a link, owned
// by this user, no write bit for group or others, at most 1 MB); "missing" when there is no
// file; null otherwise. Checked on the open handle, so a swap in between changes nothing.
function readTrusted(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    return err && err.code === "ENOENT" ? "missing" : null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid() || (st.mode & 0o022) !== 0 || st.size > MAX_FILE_BYTES) return null;
    const buf = Buffer.alloc(MAX_FILE_BYTES + 1);
    let size = 0;
    for (;;) {
      const n = readSync(fd, buf, size, buf.length - size, null);
      if (n === 0) break;
      size += n;
      if (size > MAX_FILE_BYTES) return null;
    }
    return buf.subarray(0, size).toString("utf8");
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

// One field: the file's value when it has the default's kind, else undefined (a broken file).
function field(key, def, value) {
  if (key === "paused") return value === null || typeof value === "string" || isObject(value) ? value : undefined;
  if (typeof def === "boolean") return typeof value === "boolean" ? value : undefined;
  if (typeof def === "number") return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof def === "string") return typeof value === "string" ? value : undefined;
  if (Array.isArray(def)) return Array.isArray(value) && value.every((s) => typeof s === "string") ? [...value] : undefined;
  if (isObject(def) && isObject(value) && Object.values(value).every((s) => typeof s === "string")) {
    return { ...def, ...value };
  }
  return undefined;
}

// `<state>/doors/state.json` as { ok: true, web, generate, viewer }, each field the file's or
// K1's default when missing; no file is every door off. { ok: false } when the file is
// untrusted, not one JSON object, or a field has the wrong kind: every door refuses agents.
export function readDoorsState(path) {
  const text = readTrusted(path);
  const out = { ok: true, ...copy(DOORS_DEFAULTS) };
  if (text === "missing") return out;
  if (text === null) return { ok: false };
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!isObject(data)) return { ok: false };
  for (const name of Object.keys(DOORS_DEFAULTS)) {
    const block = data[name];
    if (block === undefined || block === null) continue;
    if (!isObject(block)) return { ok: false };
    for (const [key, def] of Object.entries(DOORS_DEFAULTS[name])) {
      if (!Object.hasOwn(block, key)) continue;
      const v = field(key, def, block[key]);
      if (v === undefined) return { ok: false };
      out[name][key] = v;
    }
  }
  return out;
}

// Header values from rawHeaders, so duplicates are seen (req.headers drops or joins them).
export function headerValues(rawHeaders, name) {
  const out = [];
  if (!Array.isArray(rawHeaders)) return out;
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    if (String(rawHeaders[i]).toLowerCase() === name) out.push(rawHeaders[i + 1]);
  }
  return out;
}

export function wantsUpgrade(rawHeaders) {
  if (headerValues(rawHeaders, "upgrade").length > 0) return true;
  return headerValues(rawHeaders, "connection").some((v) => /(^|,)\s*upgrade\s*(,|$)/i.test(v));
}

// Who is calling: { kind: "a", slug, subject } for an agent this door serves, { kind: "t",
// slug: null, subject: "owner" } for the owner's test token, or a refusal code (a string:
// no_token, two_tokens, not_bearer, no_secret, bad_token, no_ids, unknown_agent, not_listed,
// not_owner). Every refusal is the door's `<door>_no_token`. Never throws.
export function checkCaller({ rawHeaders, secretPath, idsPath, agents, now } = {}) {
  const values = headerValues(rawHeaders, "authorization");
  if (values.length === 0) return "no_token";
  if (values.length > 1) return "two_tokens";
  const m = BEARER.exec(typeof values[0] === "string" ? values[0] : "");
  if (!m) return "not_bearer";
  const secret = readSecret(secretPath);
  if (secret === null) return "no_secret";
  const who = checkToken(secret, m[1], now === undefined ? Date.now() : now);
  if (who === null) return "bad_token";
  if (who.kind === "t") return who.subject === "owner" ? { kind: "t", slug: null, subject: "owner" } : "not_owner";
  const ids = readIds(idsPath);
  if (ids === null) return "no_ids";
  const slugs = Object.keys(ids).filter((s) => ids[s] === who.subject);
  if (slugs.length !== 1) return "unknown_agent";
  if (!Array.isArray(agents) || !agents.includes(slugs[0])) return "not_listed";
  return { kind: "a", slug: slugs[0], subject: who.subject };
}

export function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    Connection: "close",
  });
  res.end(text);
}

// A door's own refusal: JSON { error: { message }, code } (plus any `extra` fields, such as
// retryAfterSec). Never 429 or 5xx, so no program retries it: any status outside 400 to 499,
// and 429 itself, is sent as 403.
export function refuse(res, status, code, sentence, extra) {
  const s = Number.isInteger(status) && status >= 400 && status <= 499 && status !== 429 ? status : 403;
  const body = { ...(isObject(extra) ? extra : {}), error: { message: String(sentence) }, code: String(code) };
  if (res.headersSent) {
    res.destroy();
    return;
  }
  sendJson(res, s, body);
}

// Reads the whole request body. Resolves to a Buffer; to "too-big" once the body (declared
// or received) passes `maxBytes`, after which the rest is read and dropped (a sender that
// keeps going is cut off at twice the limit); or to null when the client went away.
export function readBody(req, maxBytes) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      if (value === "too-big") {
        let dropped = size;
        req.removeAllListeners("data");
        req.on("data", (c) => {
          dropped += c.length;
          if (dropped > 2 * maxBytes) req.socket.destroy();
        });
        req.resume();
      }
      resolve(value);
    };
    const declared = headerValues(req.rawHeaders, "content-length");
    if (declared.length > 1 || (declared.length === 1 && !(Number(declared[0]) <= maxBytes))) return settle("too-big");
    req.on("data", (c) => {
      if (settled) return;
      size += c.length;
      if (size > maxBytes) return settle("too-big");
      chunks.push(c);
    });
    req.on("end", () => settle(Buffer.concat(chunks)));
    req.on("error", () => settle(null));
    req.on("close", () => settle(null));
  });
}

// The door's status file, written by temp file and rename (0600, its folder 0700), at most
// once every 2 seconds. `save(value)` keeps the newest value and writes it when the wait is
// over; `flush()` writes it now (on SIGTERM). A failed write leaves no temp file behind.
export function statusFile(path, { everyMs = STATUS_EVERY_MS } = {}) {
  let value = null;
  let timer = null;
  let lastWrite = 0;
  function write() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (value === null) return;
    lastWrite = Date.now();
    const dir = dirname(path);
    const tmp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(tmp, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
      renameSync(tmp, path);
    } catch {
      try { unlinkSync(tmp); } catch { /* nothing was left */ }
    }
  }
  return {
    save(next) {
      value = next;
      if (timer) return;
      const wait = Math.max(0, lastWrite + everyMs - Date.now());
      timer = setTimeout(write, wait);
      timer.unref();
    },
    flush: write,
  };
}

// Makes the door's secret when it is missing: 64 hex characters and a newline, 0600, in a
// folder made 0700. An existing secret is left as it is and never read here.
export function ensureSecret(path) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  try {
    writeFileSync(path, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600, flag: "wx" });
    return true;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    return false;
  }
}
