// ctx.bench: talks to the system of record with the owner's key.
// The key file is read at call time and its content never leaves this file: not logged, not returned.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HomeError } from "./errors.mjs";
import { httpRequest, parseJson } from "./httpclient.mjs";

export function benchOff() {
  return new HomeError(502, "The books are not answering.", "Run: engine start", "bench_off");
}

function encodeQuery(query) {
  if (!query) return "";
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

// The books' own reason for a validation refusal, in plain words: tags, trace text, class names and
// underscored names are removed. Real books answer HTTP 417 with `exception` ("frappe.exceptions.X: text")
// and `_server_messages` (a JSON string of JSON strings, each with a `message`). Returns "" when none.
export function validationReason(body) {
  if (!body || typeof body !== "object") return "";
  const found = [];
  try {
    const list = typeof body._server_messages === "string" ? JSON.parse(body._server_messages) : body._server_messages;
    for (const m of Array.isArray(list) ? list : []) {
      let one = m;
      if (typeof one === "string") { try { one = JSON.parse(one); } catch { one = { message: one }; } }
      if (one && typeof one.message === "string") found.push(one.message);
    }
  } catch { /* fall back to the exception text */ }
  if (!found.length && typeof body.exception === "string") {
    found.push(body.exception.split(/\n|Traceback/)[0].replace(/^\s*(?:[\w.]+\.)?\w*(?:Error|Exception)\s*:\s*/, ""));
  }
  const clean = String(found[0] || "")
    .split(/Traceback|\n[^\S\n]*File "/)[0]
    .replace(/<br\s*\/?>|<\/(?:p|div|li)>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;|&#39;/g, "'")
    .replace(/\b(?:[A-Za-z]+_)+[A-Za-z]+\b/g, (w) => w.replace(/_/g, " "))
    .replace(/\s+/g, " ").trim();
  return clean.length > 240 ? `${clean.slice(0, 239).trimEnd()}…` : clean;
}

export function createBench({ baseUrl, site, keyFile, booksDir, log = () => {}, timeoutMs = 15000 }) {
  function authHeader() {
    let lines;
    try {
      lines = readFileSync(keyFile, "utf8").split("\n").map((l) => l.trim());
    } catch {
      lines = [];
    }
    if (!lines[0] || !lines[1]) {
      throw new HomeError(502, "The books are installed but the home screen has no key to open them.",
        "Run: engine setup", "bench_no_key");
    }
    return `token ${lines[0]}:${lines[1]}`;
  }

  async function call(method, path, { query, body } = {}) {
    if (typeof path !== "string" || !path.startsWith("/api/") || path.includes("..")) {
      throw new Error(`bench: refusing path ${path}`);
    }
    const headers = { accept: "application/json", authorization: authHeader(), "x-frappe-site-name": site };
    if (body !== undefined) headers["content-type"] = "application/json";
    let res;
    try {
      res = await httpRequest(baseUrl + path + encodeQuery(query), { method, headers, body, timeoutMs });
    } catch {
      throw benchOff();
    }
    const parsed = parseJson(res.text);
    if (res.status >= 200 && res.status < 300 && parsed !== undefined) return parsed;
    const excType = parsed && typeof parsed === "object" ? String(parsed.exc_type || "") || null : null;
    log(`bench ${method} ${path} -> ${res.status}${excType ? ` ${excType}` : ""}`);
    const extra = { upstreamStatus: res.status, excType };
    const exc = parsed && typeof parsed === "object" ? String(parsed.exception || "") : "";
    if (res.status === 417 || excType === "ValidationError" || /^(?:[\w.]+\.)?ValidationError\b/.test(exc)) {
      const err = new HomeError(409, "The books did not accept this.", "The draft is kept. Look at it in the books.", "bench_invalid", extra);
      err.reason = validationReason(parsed);
      throw err;
    }
    if (res.status === 404) throw new HomeError(404, "That record is not in the books.", "Refresh the page.", "bench_not_found", extra);
    if (res.status === 401 || res.status === 403) {
      throw new HomeError(502, "The books refused the home screen's key.", "Run: engine setup", "bench_refused", extra);
    }
    throw new HomeError(502, "The books could not do this just now.",
      "Try again in a minute. If it keeps happening, look at Health.", "bench_error", extra);
  }

  return {
    installed: () => existsSync(join(booksDir, "bench")),
    get: (path, query) => call("GET", path, { query }),
    post: (path, body = {}) => call("POST", path, { body }),
    // true when the document type exists in the books; false when its app is not installed.
    async has(doctype) {
      try {
        await call("GET", `/api/resource/${encodeURIComponent(doctype)}`, { query: { limit_page_length: 1 } });
        return true;
      } catch (e) {
        if (e instanceof HomeError && (e.upstreamStatus === 404 || e.excType === "DoesNotExistError")) return false;
        throw e;
      }
    },
  };
}
