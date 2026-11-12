// The web door's search (PLAN-V5 K11, T27). The door calls
//   search({ q, count, state, keyPath, fetchPublic }) -> { provider, results: [{ title, url, snippet }] }
// or the call throws { code: "web_search_down", reason? }. `fetchPublic(url[, { headers }])` is the
// door's own fetch (its net, caps and close); it never throws and answers { ok, status, type,
// charset, body } or { ok: false, code }.
//
// Two providers, both named only here:
//  - keyless: DuckDuckGo's plain HTML page. It needs no account and is plain HTML. It is the
//    least bad way, not a good one: it is not an official service, it may change its page,
//    ask for a check or block this Mac at any time. Then the page has no result links and the
//    answer is `web_search_down`; the owner sees "Search is not answering" in Settings (and
//    in Test) and switches to the keyed provider there.
//  - brave: Brave's search API with the owner's key, sent only as `X-Subscription-Token`.
//
// A result page is hostile text. It is read by ONE linear scanner below (no pattern that can
// backtrack, every tag capped, no script run, nothing fetched); only titles, addresses and
// snippets come out, as plain capped text; every address passes `checkAddress` again.
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { checkAddress } from "./address.mjs";
import { clean, decodeBody, decodeEntities } from "./readable.mjs";

const KEYLESS_ORIGIN = "https://html.duckduckgo.com/html/";
const KEYED_ORIGIN = "https://api.search.brave.com/res/v1/web/search";
export const MAX_Q = 200;
const MAX_TAG = 8192;        // one tag, name and attributes
const MAX_CANDIDATES = 60;   // result links read from one page, before filtering
const MAX_TITLE = 300;
const MAX_SNIPPET = 600;
const MAX_COLLECT = 4000;    // characters kept while reading one title or snippet
const MAX_JSON = 1024 * 1024;
const KEY_RE = /^[\x21-\x7e]{8,200}$/;
const SKIP = new Set(["script", "style", "noscript", "template", "svg", "iframe", "object", "textarea", "xmp", "noembed", "noframes", "math", "select", "canvas"]);

const down = (reason) => ({ code: "web_search_down", ...(reason ? { reason } : {}) });

// ---- the one-tag reader -----------------------------------------------------------------
// The tag starting at src[i] === "<": { name, closing, attrs: Map, end } with `end` just past
// it, or null when it is not a tag. Always consumes at least one character, at most MAX_TAG.
function readTag(src, i) {
  const n = src.length;
  const limit = Math.min(n, i + MAX_TAG);
  let j = i + 1;
  let closing = false;
  if (src[j] === "/") { closing = true; j += 1; }
  const c0 = src.charCodeAt(j);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return null;
  const nameStart = j;
  while (j < limit && /[A-Za-z0-9:_-]/.test(src[j])) j += 1;
  const name = src.slice(nameStart, j).toLowerCase();
  const attrs = new Map();
  while (j < limit) {
    const ch = src[j];
    if (ch === ">") { j += 1; return { name, closing, attrs, end: j }; }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "/") { j += 1; continue; }
    const s = j;
    while (j < limit && !" \t\n\r\f=/>".includes(src[j])) j += 1;
    const key = src.slice(s, j).toLowerCase();
    while (j < limit && " \t\n\r\f".includes(src[j])) j += 1;
    let value = "";
    if (src[j] === "=") {
      j += 1;
      while (j < limit && " \t\n\r\f".includes(src[j])) j += 1;
      const q = src[j];
      if (q === "\"" || q === "'") {
        const close = src.indexOf(q, j + 1);
        const stop = close === -1 || close >= limit ? limit : close;
        value = src.slice(j + 1, stop);
        j = close === -1 || close >= limit ? limit : close + 1;
      } else {
        const v = j;
        while (j < limit && !" \t\n\r\f>".includes(src[j])) j += 1;
        value = src.slice(v, j);
      }
    }
    if (key !== "" && !attrs.has(key)) attrs.set(key, value);
    if (j === s) j += 1;
  }
  // No `>` within the cap (or the end of the page): the tag swallows what it has read.
  return { name, closing, attrs, end: Math.max(limit, i + 1) };
}

const classes = (tag) => new Set((tag.attrs.get("class") || "").toLowerCase().split(/\s+/).filter(Boolean));

// The end of a dropped element: just past its closing tag (raw text ends at the first one;
// the others are counted), or the end of the page.
function skipElement(src, name, from) {
  const nested = name !== "script" && name !== "style" && name !== "textarea" && name !== "xmp" && name !== "noscript"
    && name !== "iframe" && name !== "noembed" && name !== "noframes";
  let depth = 1;
  let i = from;
  for (;;) {
    const lt = src.indexOf("<", i);
    if (lt === -1) return src.length;
    const t = readTag(src, lt);
    if (t === null) { i = lt + 1; continue; }
    i = t.end;
    if (t.name !== name) continue;
    if (t.closing) { depth -= 1; if (depth === 0 || !nested) return i; }
    else if (nested) depth += 1;
  }
}

const oneLine = (text, max) => clean(text).replace(/\s+/g, " ").trim().slice(0, max);

// Any markup in a short string (a keyed provider's title) as plain text.
export function markupToText(text, max) {
  const src = typeof text === "string" ? text.slice(0, 20000) : "";
  const out = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) { out.push(decodeEntities(src.slice(i))); break; }
    out.push(decodeEntities(src.slice(i, lt)));
    const t = readTag(src, lt);
    if (t === null) { out.push("<"); i = lt + 1; continue; }
    i = t.end;
    if (!t.closing && SKIP.has(t.name)) i = skipElement(src, t.name, i);
    else out.push(" ");
  }
  return oneLine(out.join(""), max);
}

// ---- keyless: the HTML page ---------------------------------------------------------------
// -> { found: [{ href, title, snippet }], empty } where `empty` says the page itself said
// "no results" (class no-results), so a page with none is a real answer, not a changed page.
export function parseHtmlResults(html) {
  const src = typeof html === "string" ? html : "";
  const n = src.length;
  const found = [];
  let empty = false;
  let open = null; // { kind: "title"|"snippet", name, depth, parts, size, target }
  let i = 0;
  const add = (text) => {
    if (!open || open.size > MAX_COLLECT) return;
    open.parts.push(text);
    open.size += text.length;
  };
  const finish = () => {
    const text = oneLine(open.parts.join(""), open.kind === "title" ? MAX_TITLE : MAX_SNIPPET);
    if (open.kind === "title") open.target.title = text;
    else if (open.target.snippet === "") open.target.snippet = text;
    open = null;
  };
  while (i < n && found.length <= MAX_CANDIDATES) {
    const lt = src.indexOf("<", i);
    const stop = lt === -1 ? n : lt;
    if (stop > i) add(decodeEntities(src.slice(i, stop)));
    if (lt === -1) break;
    i = lt;
    if (src.startsWith("<!--", i)) {
      const k = src.indexOf("-->", i + 4);
      i = k === -1 ? n : k + 3;
      continue;
    }
    if (src[i + 1] === "!" || src[i + 1] === "?") {
      const k = src.indexOf(">", i + 2);
      i = k === -1 ? n : k + 1;
      continue;
    }
    const tag = readTag(src, i);
    if (tag === null) { add("<"); i += 1; continue; }
    i = tag.end;
    if (!tag.closing && SKIP.has(tag.name)) { i = skipElement(src, tag.name, i); add(" "); continue; }
    if (open) {
      if (tag.name === open.name) {
        if (tag.closing) { open.depth -= 1; if (open.depth === 0) finish(); }
        else open.depth += 1;
      } else if (tag.name === "br" || tag.name === "p" || tag.name === "div") add(" ");
      continue;
    }
    if (tag.closing) continue;
    const cl = classes(tag);
    if (cl.has("no-results")) empty = true;
    if (tag.name === "a" && cl.has("result__a")) {
      const entry = { href: tag.attrs.get("href") || "", title: "", snippet: "" };
      found.push(entry);
      open = { kind: "title", name: "a", depth: 1, parts: [], size: 0, target: entry };
    } else if (cl.has("result__snippet") && found.length > 0) {
      open = { kind: "snippet", name: tag.name, depth: 1, parts: [], size: 0, target: found[found.length - 1] };
    }
  }
  if (open) finish();
  return { found, empty };
}

const SEARCH_HOST = /(^|\.)duckduckgo\.com$/;

// The real address of a result link: the `uddg` parameter when the link is the search
// engine's own redirect, else the link itself. Null when it is neither usable.
function unwrap(href) {
  let u;
  try {
    u = new URL(href.trim(), KEYLESS_ORIGIN);
  } catch {
    return null;
  }
  if (SEARCH_HOST.test(u.hostname.toLowerCase())) {
    const target = u.searchParams.get("uddg");
    return target === null ? null : target; // the engine's own pages (ads, more links) are no results
  }
  return u.href;
}

// Titles, addresses and snippets that pass `checkAddress`, in page order, no repeats.
function finishResults(list, count) {
  const out = [];
  const seen = new Set();
  for (const r of list) {
    if (out.length >= count) break;
    if (typeof r.url !== "string") continue;
    const a = checkAddress(r.url);
    if (!a.ok || seen.has(a.href)) continue;
    seen.add(a.href);
    out.push({ title: r.title || a.host, url: a.href, snippet: r.snippet || "" });
  }
  return out;
}

// ---- the key -------------------------------------------------------------------------------
// The key from the trusted file: a regular file the owner alone can use, read once to be sent.
function readKey(path) {
  if (typeof path !== "string" || path === "") return null;
  let fd = null;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const st = fstatSync(fd);
    if (!st.isFile() || st.size === 0 || st.size > 512 || (st.mode & 0o077) !== 0) return null;
    const buf = Buffer.alloc(st.size);
    const got = readSync(fd, buf, 0, st.size, 0);
    const key = buf.subarray(0, got).toString("utf8").trim();
    return KEY_RE.test(key) ? key : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) try { closeSync(fd); } catch { /* nothing to do */ }
  }
}

// ---- the call --------------------------------------------------------------------------------
function readQuery(q) {
  if (typeof q !== "string") throw down("bad_query");
  const t = q.trim();
  if (t === "" || t.length > MAX_Q || /[\x00-\x1f\x7f-\x9f]/.test(t)) throw down("bad_query");
  const enc = encodeURIComponent(t).replace(/%20/g, "+");
  // The whole query string must pass row 8 (256 characters) with room for `&count=10`.
  if (enc.length > 230) throw down("bad_query");
  return enc;
}

const readCount = (c) => (Number.isInteger(c) && c >= 1 && c <= 10 ? c : 10);

async function ask(fetchPublic, url, opts) {
  let r;
  try {
    r = await (opts ? fetchPublic(url, opts) : fetchPublic(url));
  } catch {
    throw down("fetch");
  }
  if (!r || typeof r !== "object" || r.ok !== true) throw down("fetch");
  return r;
}

async function searchKeyless(enc, count, fetchPublic) {
  const r = await ask(fetchPublic, `${KEYLESS_ORIGIN}?q=${enc}`);
  // A block page, a check or an error page is not an answer.
  if (r.status !== 200 || !Buffer.isBuffer(r.body)) throw down("page");
  const page = parseHtmlResults(decodeBody(r.body, r.charset));
  if (page.found.length === 0) {
    if (page.empty) return { provider: "keyless", results: [] };
    throw down("page_changed");
  }
  const list = page.found.map((f) => ({ url: unwrap(f.href), title: f.title, snippet: f.snippet }));
  return { provider: "keyless", results: finishResults(list, count) };
}

async function searchKeyed(enc, count, keyPath, fetchPublic) {
  const key = readKey(keyPath);
  if (key === null) throw down("no_key");
  const r = await ask(fetchPublic, `${KEYED_ORIGIN}?q=${enc}&count=${count}`, { headers: { "X-Subscription-Token": key } });
  if (r.status === 401 || r.status === 403) throw down("key_refused");
  if (r.status !== 200 || !Buffer.isBuffer(r.body) || r.body.length > MAX_JSON) throw down("page");
  let data;
  try {
    data = JSON.parse(decodeBody(r.body, r.charset));
  } catch {
    throw down("page_changed");
  }
  const rows = data && typeof data === "object" && data.web && typeof data.web === "object" ? data.web.results : undefined;
  if (!Array.isArray(rows)) {
    // A real "nothing found" answer has no `web` block at all but says what it is.
    if (data && typeof data === "object" && data.type === "search" && data.web === undefined) return { provider: "brave", results: [] };
    throw down("page_changed");
  }
  const list = rows.slice(0, 50).map((x) => (x && typeof x === "object"
    ? { url: x.url, title: markupToText(x.title, MAX_TITLE), snippet: markupToText(x.description, MAX_SNIPPET) }
    : {}));
  return { provider: "brave", results: finishResults(list, count) };
}

export async function search({ q, count, state, keyPath, fetchPublic } = {}) {
  if (typeof fetchPublic !== "function") throw down();
  const enc = readQuery(q);
  const n = readCount(count);
  try {
    if (state && state.search === "brave") return await searchKeyed(enc, n, keyPath, fetchPublic);
    return await searchKeyless(enc, n, fetchPublic);
  } catch (err) {
    // Only our own plain refusals leave; anything else (a parser surprise) is the same refusal.
    if (err && err.code === "web_search_down") throw err;
    throw down("page_changed");
  }
}
