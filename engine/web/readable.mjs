// A page's readable text (PLAN-V5 K11): HTML in, { title, text, links, truncated } out, by
// one linear scanner. Nothing runs and nothing else is fetched. The contents of script,
// style, noscript, template, svg, iframe, object (and textarea, select, canvas, math) are
// dropped; attributes never reach the text (so no `onclick`), only an anchor's `href` is
// read; entities are decoded once; block tags become line breaks. Control characters, and
// the invisible ones that reorder or hide text, are removed from everything returned.

export const MAX_TEXT = 200_000;
export const MAX_LINKS = 200;
export const MAX_TITLE = 300;
const MAX_LINK_TEXT = 200;
const MAX_HREF = 2048;

// Dropped with everything inside. In RAW the first closing tag ends it (the HTML rule for
// raw text); the others may nest and are counted.
const RAW = new Set(["script", "style", "noscript", "iframe", "textarea", "xmp", "noembed", "noframes", "plaintext"]);
const NESTED = new Set(["template", "svg", "object", "math", "select", "canvas"]);
const BLOCK = new Set(["address", "article", "aside", "blockquote", "br", "dd", "details", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr",
  "li", "main", "nav", "ol", "p", "pre", "section", "summary", "table", "tr", "ul", "caption", "body", "html"]);
const CELL = new Set(["td", "th"]);

const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  mdash: "—", ndash: "–", hellip: "…", copy: "©", reg: "®", trade: "™",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
  middot: "·", bull: "•", deg: "°", times: "×", divide: "÷", euro: "€",
  pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶", frac12: "½",
  frac14: "¼", frac34: "¾", eacute: "é", egrave: "è", aacute: "á", agrave: "à",
  iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", ouml: "ö", uuml: "ü",
  auml: "ä", szlig: "ß", ccedil: "ç", rarr: "→", larr: "←", minus: "−",
};
const ENTITY = /&(#[0-9]{1,8};?|#[xX][0-9a-fA-F]{1,7};?|[A-Za-z][A-Za-z0-9]{1,31};)/g;

// Removes control characters (but line breaks and tabs) and the characters that reorder,
// join or hide text (bidirectional controls, zero-width marks, the byte-order mark).
const HIDDEN = /[\x00-\x08\x0b-\x1f\x7f-\x9f­​-‏‪-‮⁠-⁤⁦-⁯﻿￹-￻]/g;
export function clean(text) {
  return String(text).replace(HIDDEN, "");
}

export function decodeEntities(text) {
  return text.replace(ENTITY, (whole, body) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const n = parseInt(body.slice(hex ? 2 : 1).replace(";", ""), hex ? 16 : 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return "�";
      if (n < 0x20 && n !== 0x09 && n !== 0x0a) return " ";
      return String.fromCodePoint(n);
    }
    const name = body.slice(0, -1);
    return Object.hasOwn(NAMED, name) ? NAMED[name] : whole;
  });
}

// Collapses spaces inside lines, trims each line and keeps at most one empty line in a row.
function tidy(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let blank = 0;
  for (const raw of lines) {
    const line = raw.replace(/[ \t\f\v ]+/g, " ").trim();
    if (line === "") {
      blank += 1;
      if (blank === 1 && out.length > 0) out.push("");
      continue;
    }
    blank = 0;
    out.push(line);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

function oneLine(text, max) {
  const t = clean(text).replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) : t;
}

// Reads a tag starting at `i` (the `<`). Returns { name, closing, end, attrs } where `end`
// is the index after `>` (or the text's end), or null when `<` does not start a tag.
const NAME = /[A-Za-z][A-Za-z0-9:-]{0,40}/y;
function readTag(html, i, wantHref) {
  let j = i + 1;
  const closing = html[j] === "/";
  if (closing) j += 1;
  NAME.lastIndex = j;
  const m = NAME.exec(html);
  if (!m) return null;
  const name = m[0].toLowerCase();
  j = NAME.lastIndex;
  let href = null;
  // Attributes: name, optional = and a value, quoted or not. Quotes may hold `>`.
  const n = html.length;
  while (j < n) {
    const c = html[j];
    if (c === ">") return { name, closing, end: j + 1, href };
    if (c === "\"" || c === "'") {
      const k = html.indexOf(c, j + 1);
      j = k === -1 ? n : k + 1;
      continue;
    }
    if (c === "=") {
      j += 1;
      continue;
    }
    if (/[\s/]/.test(c)) {
      j += 1;
      continue;
    }
    // An attribute name.
    const start = j;
    while (j < n && !/[\s/>=]/.test(html[j])) j += 1;
    const attr = html.slice(start, j).toLowerCase();
    while (j < n && /\s/.test(html[j])) j += 1;
    if (html[j] !== "=") continue;
    j += 1;
    while (j < n && /\s/.test(html[j])) j += 1;
    let value;
    if (html[j] === "\"" || html[j] === "'") {
      const q = html[j];
      const k = html.indexOf(q, j + 1);
      value = html.slice(j + 1, k === -1 ? n : k);
      j = k === -1 ? n : k + 1;
    } else {
      const s = j;
      while (j < n && !/[\s>]/.test(html[j])) j += 1;
      value = html.slice(s, j);
    }
    if (wantHref && attr === "href" && href === null) href = value;
  }
  return { name, closing, end: n, href };
}

// Where the element `name` that opened before `from` ends: the index after its closing tag
// (or the text's end) as { inner (where the closing tag starts), end }. RAW elements and
// the title end at the first closing tag; NESTED ones count depth.
function skipElement(html, name, from) {
  const raw = RAW.has(name) || name === "title";
  const re = new RegExp(`<(/?)${name}(?=[\\s/>]|$)`, "gi");
  re.lastIndex = from;
  let depth = 1;
  for (;;) {
    const m = re.exec(html);
    if (!m) return { inner: html.length, end: html.length };
    if (m[1] === "/") {
      depth -= 1;
      if (depth === 0 || raw) {
        const close = html.indexOf(">", re.lastIndex);
        return { inner: m.index, end: close === -1 ? html.length : close + 1 };
      }
    } else if (!raw) {
      depth += 1;
    }
  }
}

// A link's address made absolute against the page's own final address (a <base> tag is
// ignored); only http and https, without a user or password. Null otherwise.
function absolute(href, base) {
  const raw = clean(decodeEntities(href)).trim();
  if (raw === "" || raw.length > MAX_HREF) return null;
  let u;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) return null;
  u.hash = "";
  return u.href.length > MAX_HREF ? null : u.href;
}

// HTML to { title, text, links: [{ href, text }], truncated }. `base` is the page's final
// address. Linear in the length of `html`.
export function readable(html, base) {
  const src = typeof html === "string" ? html : "";
  const parts = [];
  let size = 0;
  let truncated = false;
  let title = null;
  const links = [];
  const seen = new Set();
  let link = null; // { href, parts: [] } while inside <a>

  const push = (t) => {
    if (truncated || t === "") return;
    parts.push(t);
    size += t.length;
    if (size > MAX_TEXT * 2) truncated = true;
    if (link) link.parts.push(t);
  };
  const endLink = () => {
    if (!link) return;
    if (link.href && links.length < MAX_LINKS && !seen.has(link.href)) {
      seen.add(link.href);
      links.push({ href: link.href, text: oneLine(link.parts.join(""), MAX_LINK_TEXT) });
    }
    link = null;
  };

  const n = src.length;
  let i = 0;
  while (i < n && !truncated) {
    const lt = src.indexOf("<", i);
    const stop = lt === -1 ? n : lt;
    if (stop > i) push(decodeEntities(src.slice(i, stop)));
    if (lt === -1) break;
    i = lt;
    // Comments, doctype, CDATA and processing instructions are skipped.
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
    const tag = readTag(src, i, true);
    if (tag === null) {
      push("<");
      i += 1;
      continue;
    }
    i = tag.end;
    const { name, closing } = tag;
    if (!closing && name === "title" && title === null) {
      const at = skipElement(src, "title", i);
      title = oneLine(decodeEntities(src.slice(i, Math.min(at.inner, i + 8 * MAX_TITLE))), MAX_TITLE);
      i = at.end;
      continue;
    }
    if (!closing && (RAW.has(name) || NESTED.has(name))) {
      i = skipElement(src, name, i).end;
      if (BLOCK.has(name) || NESTED.has(name)) push("\n");
      continue;
    }
    if (name === "a") {
      if (closing) endLink();
      else {
        endLink();
        link = { href: tag.href === null ? null : absolute(tag.href, base), parts: [] };
      }
      continue;
    }
    if (BLOCK.has(name)) push("\n");
    else if (CELL.has(name)) push(closing ? "\t" : "");
    else if (name === "img" || name === "input") push(" ");
  }
  endLink();
  let text = tidy(clean(parts.join("")));
  if (text.length > MAX_TEXT) {
    text = text.slice(0, MAX_TEXT);
    truncated = true;
  }
  return { title: title || "", text, links, truncated };
}

// Plain text or JSON as given: cleaned and capped, no title, no links.
export function plain(text) {
  let t = tidy(clean(typeof text === "string" ? text : ""));
  let truncated = false;
  if (t.length > MAX_TEXT) {
    t = t.slice(0, MAX_TEXT);
    truncated = true;
  }
  return { title: "", text: t, links: [], truncated };
}

// The body's bytes as text: the charset the answer named when this runtime knows it, else
// UTF-8. Bad bytes become U+FFFD; nothing throws.
export function decodeBody(buf, charset) {
  const label = typeof charset === "string" && /^[a-z0-9._:-]{1,40}$/.test(charset) ? charset : "utf-8";
  try {
    return new TextDecoder(label, { fatal: false }).decode(buf);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  }
}
