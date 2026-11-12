// Fetching one public address (PLAN-V5 K11), for the web door, its search and later the
// generation door's outputs. GET only. Each hop: the address is checked (row 8), the owner's
// lists applied (row 9), the name resolved ONCE and every answer checked (row 10), then the
// connection is made to the checked address itself, with the name as Host and as the TLS
// server name, so there is no second lookup to race. Sent headers are fixed: never a cookie,
// a referrer, a credential or anything from the caller. Proxy variables are never read: the
// socket is made here, with no agent. Every byte the site sends is capped: as sent and after
// unpacking gzip or brotli, under one deadline for the whole fetch.
import http from "node:http";
import { connect as tcpConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { lookup } from "node:dns/promises";
import { createBrotliDecompress, createGunzip } from "node:zlib";
import { checkAddress, hostAllowed, isOwnAddress, isPublic } from "./address.mjs";

const MB = 1024 * 1024;
export const TEXT_TYPES = Object.freeze(["text/html", "application/xhtml+xml", "text/plain", "application/json"]);
export const WEB_LIMITS = Object.freeze({
  maxBytes: 5 * MB,     // the answer, as sent and as unpacked
  totalMs: 20_000,      // the whole fetch, every hop, from the first lookup to the last byte
  maxRedirects: 5,      // the sixth is refused
  types: TEXT_TYPES,    // null takes any type (the caller checks the bytes itself)
  maxAddresses: 32,     // answers to one lookup
});
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
export const SENT_HEADERS = Object.freeze({
  "User-Agent": "Mozilla/5.0 (compatible; reader/1.0)",
  Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.9,*/*;q=0.1",
  "Accept-Encoding": "gzip, br",
});

// The real network, used by main() and nothing else. Frozen: nothing can swap a method. A
// test passes its own `net` to createWebDoor; no file, setting or variable can.
export const REAL_NET = Object.freeze({
  // [{ address, family }] for a name, from the system's resolver, once.
  resolve(host) {
    return lookup(host, { all: true, order: "ipv4first" });
  },
  // A socket to exactly this address. TLS checks the certificate against `hostname`.
  connect({ address, family, port, hostname, secure }) {
    if (secure) {
      return tlsConnect({
        host: address, family, port, servername: hostname, rejectUnauthorized: true,
        minVersion: "TLSv1.2", ALPNProtocols: ["http/1.1"],
      });
    }
    return tcpConnect({ host: address, family, port });
  },
});

const fail = (code, extra) => ({ ok: false, code, ...(extra || {}) });

// The media type (lower case) and charset of a Content-Type value; null when absent or
// odd (more than one value, a control character).
function contentType(values) {
  if (values.length !== 1 || typeof values[0] !== "string" || /[\x00-\x08\x0a-\x1f\x7f]/.test(values[0])) return null;
  const [type, ...params] = values[0].split(";");
  let charset = null;
  for (const p of params) {
    const m = /^\s*charset\s*=\s*"?([A-Za-z0-9._:-]{1,40})"?\s*$/i.exec(p);
    if (m) charset = m[1].toLowerCase();
  }
  return { type: type.trim().toLowerCase(), charset };
}

function rawValues(rawHeaders, name) {
  const out = [];
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    if (String(rawHeaders[i]).toLowerCase() === name) out.push(rawHeaders[i + 1]);
  }
  return out;
}

// One GET to one checked address. Resolves to { status, location } for a redirect,
// { status, type, charset, body } for an answer, or a failure; never rejects.
function oneHop({ net, target, address, family, lim, deadline, signal, extra }) {
  return new Promise((resolve) => {
    let done = false;
    let socket = null;
    let req = null;
    let res = null;
    let unpack = null;
    const onAbort = () => finish(fail("web_unreachable", { why: "closed" }));
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (unpack) unpack.destroy();
      if (res) res.destroy();
      if (req) req.destroy();
      if (socket) socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(fail("web_unreachable", { why: "time" })), Math.max(0, deadline - Date.now()));
    if (signal) {
      if (signal.aborted) return finish(fail("web_unreachable", { why: "closed" }));
      signal.addEventListener("abort", onAbort);
    }
    try {
      socket = net.connect({ address, family, port: target.port, hostname: target.host, secure: target.secure });
    } catch {
      return finish(fail("web_unreachable", { why: "connect" }));
    }
    if (!socket || typeof socket.on !== "function") return finish(fail("web_unreachable", { why: "connect" }));
    socket.on("error", () => finish(fail("web_unreachable", { why: "socket" })));
    const hostHeader = target.port === (target.secure ? 443 : 80) ? target.host : `${target.host}:${target.port}`;
    try {
      req = http.request({
        method: "GET",
        path: `${target.url.pathname}${target.url.search}`,
        headers: { Host: hostHeader, ...SENT_HEADERS, ...(extra || {}), Connection: "close" },
        setHost: false,
        createConnection: () => socket,
        maxHeaderSize: 16 * 1024,
        insecureHTTPParser: false,
      });
    } catch {
      return finish(fail("web_unreachable", { why: "request" }));
    }
    req.on("error", () => finish(fail("web_unreachable", { why: "answer" })));
    req.on("upgrade", () => finish(fail("web_unreachable", { why: "upgrade" })));
    req.on("response", (r) => {
      res = r;
      const status = r.statusCode;
      if (!Number.isInteger(status) || status < 200 || status > 599) return finish(fail("web_unreachable", { why: "status" }));
      if (REDIRECTS.has(status)) {
        const loc = rawValues(r.rawHeaders, "location");
        if (loc.length !== 1) return finish(fail("web_unreachable", { why: "location" }));
        return finish({ ok: true, status, location: String(loc[0]) });
      }
      const ct = contentType(rawValues(r.rawHeaders, "content-type"));
      if (lim.types && (ct === null || !lim.types.includes(ct.type))) return finish(fail("web_not_text"));
      const lengths = rawValues(r.rawHeaders, "content-length");
      if (lengths.length > 0 && Number(lengths[0]) > lim.maxBytes) return finish(fail("web_too_big"));
      const encs = rawValues(r.rawHeaders, "content-encoding").map((e) => String(e).trim().toLowerCase());
      if (encs.length > 1) return finish(fail("web_not_text", { why: "encoding" }));
      const enc = encs.length === 0 || encs[0] === "identity" ? null : encs[0];
      if (enc !== null && enc !== "gzip" && enc !== "x-gzip" && enc !== "br") return finish(fail("web_not_text", { why: "encoding" }));

      const chunks = [];
      let sent = 0;
      let unpacked = 0;
      const take = (c) => {
        if (done) return;
        unpacked += c.length;
        if (unpacked > lim.maxBytes) return finish(fail("web_too_big"));
        chunks.push(c);
      };
      const complete = () => {
        if (done) return;
        const body = Buffer.concat(chunks);
        finish({ ok: true, status, type: ct ? ct.type : null, charset: ct ? ct.charset : null, body, sent });
      };
      if (enc !== null) {
        unpack = enc === "br" ? createBrotliDecompress() : createGunzip();
        unpack.on("data", take);
        unpack.on("end", complete);
        unpack.on("error", () => finish(fail("web_not_text", { why: "unpack" })));
      }
      r.on("data", (c) => {
        if (done) return;
        sent += c.length;
        if (sent > lim.maxBytes) return finish(fail("web_too_big"));
        if (unpack) unpack.write(c);
        else take(c);
      });
      r.on("end", () => {
        if (done) return;
        if (!r.complete) return finish(fail("web_unreachable", { why: "cut" }));
        if (unpack) unpack.end();
        else complete();
      });
      r.on("error", () => finish(fail("web_unreachable", { why: "cut" })));
      r.on("aborted", () => finish(fail("web_unreachable", { why: "cut" })));
    });
    req.end();
  });
}

// Waits for a promise until the deadline (or an abort); a late or failed one is null.
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

// The lookup's answers as [{ address, family }], at most `max`; null when it is not that.
function answers(list, max) {
  if (!Array.isArray(list) || list.length === 0 || list.length > max) return null;
  const out = [];
  for (const a of list) {
    const address = typeof a === "string" ? a : a && typeof a.address === "string" ? a.address : null;
    if (address === null) return null;
    out.push({ address, family: address.includes(":") ? 6 : 4 });
  }
  return out;
}

// The one header a caller may add: { "X-Subscription-Token": value } (any letter case in the
// name), the value 1 to 512 printable ASCII characters. {} or nothing is no header; anything
// else is null (refused).
export const CALLER_HEADER = "X-Subscription-Token";
const HEADER_VALUE = /^[\x21-\x7e]{1,512}$/;
function callerHeaders(headers) {
  if (headers === undefined || headers === null) return undefined;
  if (typeof headers !== "object" || Array.isArray(headers) || Object.getPrototypeOf(headers) !== Object.prototype) return null;
  const names = Object.keys(headers);
  if (Object.getOwnPropertySymbols(headers).length > 0) return null;
  if (names.length === 0) return undefined;
  if (names.length !== 1 || names[0].toLowerCase() !== CALLER_HEADER.toLowerCase()) return null;
  const value = headers[names[0]];
  if (typeof value !== "string" || !HEADER_VALUE.test(value)) return null;
  return { [CALLER_HEADER]: value };
}

// Fetches `url`. { ok: true, url (final), host, status, type, charset, body (Buffer), sent,
// hops, lookups } or { ok: false, code, url, host, hops, lookups } with a K11 code:
// web_bad_address, web_blocked, web_private_address, web_too_big, web_not_text,
// web_unreachable. `allow` and `block` are the owner's lists (left out: no list applies).
// `own(ip)` says whether an address is this Mac's own (default: its interfaces, read now).
// `signal` (an AbortSignal) ends the fetch early as web_unreachable. `headers` may carry
// exactly one header, X-Subscription-Token (the keyed search provider's key): it is sent on
// the FIRST hop only, to the host the caller named, and dropped on any redirect; any other
// name, or a value that is not printable ASCII, refuses the fetch (web_bad_request) before
// a lookup. The value is never put in what this returns. Never throws.
export async function fetchPublic(url, { net = REAL_NET, limits, allow, block, own = isOwnAddress, signal, headers } = {}) {
  const lim = { ...WEB_LIMITS, ...(limits || {}) };
  const extra = callerHeaders(headers);
  if (extra === null) return { ok: false, code: "web_bad_request", url: null, host: null, hops: 0, lookups: 0 };
  const deadline = Date.now() + lim.totalMs;
  let current = url;
  let hops = 0;
  let lookups = 0;
  let host = null;
  const stop = (code, extra) => ({ ok: false, code, url: typeof current === "string" ? current : null, host, hops, lookups, ...(extra || {}) });
  for (;;) {
    const target = checkAddress(current);
    if (!target.ok) return stop("web_bad_address", { reason: target.reason });
    host = target.host;
    current = target.href;
    if ((allow !== undefined || block !== undefined) && !hostAllowed(target.host, allow, block)) return stop("web_blocked");
    lookups += 1;
    let asked;
    try { asked = net.resolve(target.host); } catch { asked = null; }
    const found = answers(await untilDeadline(asked, deadline, signal), lim.maxAddresses);
    if (found === null) return stop("web_unreachable", { why: "resolve" });
    if (found.some((a) => !isPublic(a.address) || own(a.address))) return stop("web_private_address");
    hops += 1;
    const got = await oneHop({
      net, target, address: found[0].address, family: found[0].family, lim, deadline, signal, extra: hops === 1 ? extra : undefined,
    });
    if (!got.ok) return stop(got.code, got.why ? { why: got.why } : undefined);
    if (got.location === undefined) {
      return { ok: true, url: current, host, status: got.status, type: got.type, charset: got.charset, body: got.body, sent: got.sent, hops, lookups };
    }
    if (hops > lim.maxRedirects) return stop("web_unreachable", { why: "redirects" });
    let next;
    try {
      next = new URL(got.location, current).href;
    } catch {
      return stop("web_bad_address", { reason: "redirect" });
    }
    current = next;
  }
}
