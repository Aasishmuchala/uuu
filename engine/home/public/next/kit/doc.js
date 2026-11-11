// A staged document (brief, plan, summary, check) as headings and readable text, and Markdown: a Markdown file
// (an agent's instructions, a check's evidence) shown as headings, lists, bold, code and tables. CONTRACTS-V2 13.2.
// `doc` is { name, file, sections: [{ heading, text }] } (17.3); `unclear` the stage's open questions.
// Agents wrote this text: it is parsed into plain data and built as elements, never set as HTML. Links are shown
// as their words only, and images as their description.
import { html } from "../vendor/preact-htm.js";
import { Icon } from "./icon.js";

const text = (v) => (v === null || v === undefined ? "" : String(v));
const isUnclear = (heading) => /^anything unclear$/i.test(text(heading).trim());

// --- Markdown: parsed to plain blocks, then built as elements -------------------------------------------------

const MAX_DEPTH = 8; // quotes and lists inside each other
const MAX_REACH = 600; // how far an opening * or ` looks for its closing mark
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const TABLE_RULE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

const indentOf = (line) => line.length - line.replace(/^ +/, "").length;
const blank = (line) => !line.trim();
const isTableStart = (lines, i) => lines[i].includes("|") && i + 1 < lines.length && lines[i + 1].includes("|")
  && TABLE_RULE.test(lines[i + 1]);
const startsBlock = (lines, i) => FENCE.test(lines[i]) || HEADING.test(lines[i]) || RULE.test(lines[i])
  || QUOTE.test(lines[i]) || ITEM.test(lines[i]) || isTableStart(lines, i);

// One table row's cells; a "|" after a backslash stays in its cell.
function cells(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const out = [];
  let cur = "";
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i += 1; } else if (s[i] === "|") { out.push(cur.trim()); cur = ""; } else cur += s[i];
  }
  out.push(cur.trim());
  return out;
}

// A list starting at line i: its items, each parsed again as blocks, so lists can hold lists.
function parseList(lines, i, depth) {
  const first = ITEM.exec(lines[i]);
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let cur = null;
  let gap = false;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (blank(line)) { if (cur) cur.body.push(""); gap = true; continue; }
    const m = ITEM.exec(line);
    const ind = indentOf(line);
    if (m && ind <= base + 1) {
      if (/\d/.test(m[2]) !== ordered) break;
      cur = { pad: m[1].length + m[2].length + 1, body: [text(m[3])], n: ordered ? Number.parseInt(m[2], 10) : null };
      items.push(cur);
      gap = false;
      continue;
    }
    if (ind > base) { cur.body.push(line.slice(Math.min(ind, cur.pad))); gap = false; continue; }
    // A line that is not indented carries on the item's words, unless a gap or a new block comes first.
    if (!gap && !startsBlock(lines, i)) { cur.body.push(line.trim()); continue; }
    break;
  }
  while (items.length && items.at(-1).body.length && blank(items.at(-1).body.at(-1))) items.at(-1).body.pop();
  // A list with a gap between or inside its items is "loose": its items' words are shown as paragraphs.
  const loose = items.some((it) => it.body.some(blank));
  const out = items.map((it) => {
    let body = it.body;
    let done = null;
    const box = /^\[([ xX])\][ \t]+/.exec(body[0] || "");
    if (box) { done = box[1] !== " "; body = [body[0].slice(box[0].length), ...body.slice(1)]; }
    return { done, blocks: parseBlocks(body, depth + 1) };
  });
  return { block: { type: "list", ordered, loose, start: ordered && items.length ? items[0].n : null, items: out }, next: i };
}

// Markdown text as plain blocks: { type: "heading"|"paragraph"|"code"|"rule"|"quote"|"list"|"table", ... }.
function parseBlocks(lines, depth) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { i += 1; continue; }
    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1];
      const body = [];
      i += 1;
      while (i < lines.length && !(lines[i].trim().startsWith(mark[0].repeat(mark.length)) && /^[`~]+$/.test(lines[i].trim()))) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const head = HEADING.exec(line);
    if (head) {
      const words = text(head[2]).replace(/[ \t]+#+[ \t]*$/, "").replace(/^#+$/, "").trim();
      if (words) blocks.push({ type: "heading", level: head[1].length, text: words });
      i += 1;
      continue;
    }
    if (RULE.test(line)) { blocks.push({ type: "rule" }); i += 1; continue; }
    if (depth < MAX_DEPTH && QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE.test(lines[i])) { body.push(lines[i].replace(QUOTE, "")); i += 1; }
      blocks.push({ type: "quote", blocks: parseBlocks(body, depth + 1) });
      continue;
    }
    if (depth < MAX_DEPTH && ITEM.test(line)) {
      const { block, next } = parseList(lines, i, depth);
      blocks.push(block);
      i = next;
      continue;
    }
    if (isTableStart(lines, i)) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : null));
      const rows = [];
      i += 2;
      while (i < lines.length && !blank(lines[i]) && lines[i].includes("|")) { rows.push(cells(lines[i])); i += 1; }
      blocks.push({ type: "table", head, align, rows });
      continue;
    }
    const para = [line.replace(/^ +/, "")];
    i += 1;
    while (i < lines.length && !blank(lines[i]) && !startsBlock(lines, i)) { para.push(lines[i].replace(/^ +/, "")); i += 1; }
    blocks.push({ type: "paragraph", text: para.join("\n") });
  }
  return blocks;
}

export function parseMarkdown(source) {
  return parseBlocks(text(source).replace(/\r\n?/g, "\n").split("\n"), 0);
}

const word = (c) => !!c && /[\p{L}\p{N}]/u.test(c);
const PUNCT = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

// Where the bracket that opens at `at` closes, or -1.
function closing(s, at, open, close) {
  let depth = 0;
  for (let i = at; i < s.length && i < at + MAX_REACH; i += 1) {
    if (s[i] === "\\") { i += 1; continue; }
    if (s[i] === open) depth += 1;
    else if (s[i] === close) { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

// Where a run of * _ ~ that opens at `at` (length n) closes, or -1. An _ only counts at a word's edge.
function closeMark(s, at, mark) {
  const n = mark.length;
  const end = Math.min(s.length, at + n + MAX_REACH);
  for (let j = s.indexOf(mark, at + n + 1); j !== -1 && j < end; j = s.indexOf(mark, j + 1)) {
    if (/\s/.test(s[j - 1])) continue;
    if (mark[0] === "_" && word(s[j + n])) continue;
    if (mark.length === 1 && s[j + 1] === mark) { j += 1; continue; }
    return j;
  }
  return -1;
}

// A line of Markdown as plain pieces: strings, and { t: "code"|"strong"|"em"|"del"|"link"|"br", c }.
export function parseInline(source, depth = 0) {
  const s = text(source);
  const out = [];
  let buf = "";
  const push = (node) => { if (buf) out.push(buf); buf = ""; out.push(node); };
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "\n") { push({ t: "br" }); i += 1; continue; }
    if (ch === "\\" && PUNCT.test(s[i + 1] || "")) { buf += s[i + 1]; i += 1; continue; }
    if (ch === "\n") {
      if (/ {2,}$/.test(buf)) { buf = buf.replace(/ +$/, ""); push({ t: "br" }); } else buf += " ";
      continue;
    }
    if (ch === "`") {
      let n = 1;
      while (s[i + n] === "`") n += 1;
      const tick = "`".repeat(n);
      let j = s.indexOf(tick, i + n);
      while (j !== -1 && s[j + n] === "`") j = s.indexOf(tick, j + n + 1);
      if (j !== -1 && j - i < MAX_REACH * 4) {
        let code = s.slice(i + n, j).replace(/\n/g, " ");
        if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1);
        push({ t: "code", c: code });
        i = j + n - 1;
      } else { buf += tick; i += n - 1; }
      continue;
    }
    if ((ch === "[" || (ch === "!" && s[i + 1] === "[")) && depth < MAX_DEPTH) {
      const open = ch === "!" ? i + 1 : i;
      const shut = closing(s, open, "[", "]");
      if (shut !== -1 && s[shut + 1] === "(") {
        const end = closing(s, shut + 1, "(", ")");
        if (end !== -1) {
          // A link is shown as its words (an image as its description): nothing here can be followed.
          push({ t: "link", c: parseInline(s.slice(open + 1, shut), depth + 1) });
          i = end;
          continue;
        }
      }
      buf += ch;
      continue;
    }
    if (ch === "<") {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(s.slice(i, i + MAX_REACH));
      if (auto) { push({ t: "link", c: [auto[1]] }); i += auto[0].length - 1; continue; }
      buf += ch;
      continue;
    }
    if ((ch === "*" || ch === "_" || ch === "~") && depth < MAX_DEPTH) {
      let n = 1;
      while (s[i + n] === ch) n += 1;
      const size = ch === "~" ? (n >= 2 ? 2 : 0) : Math.min(n, 2);
      const flanked = size > 0 && s[i + size] && !/\s/.test(s[i + size]) && !(ch === "_" && word(s[i - 1]));
      if (flanked) {
        const mark = ch.repeat(size);
        const j = closeMark(s, i, mark);
        if (j !== -1) {
          push({ t: ch === "~" ? "del" : size === 2 ? "strong" : "em", c: parseInline(s.slice(i + size, j), depth + 1) });
          i = j + size - 1;
          continue;
        }
      }
      buf += ch.repeat(n);
      i += n - 1;
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

function Inline({ nodes }) {
  return nodes.map((n, k) => {
    if (typeof n === "string") return n;
    if (n.t === "br") return html`<br key=${k} />`;
    if (n.t === "code") return html`<code key=${k} class="k-md__code u-mono">${n.c}</code>`;
    if (n.t === "strong") return html`<strong key=${k}><${Inline} nodes=${n.c} /></strong>`;
    if (n.t === "em") return html`<em key=${k}><${Inline} nodes=${n.c} /></em>`;
    if (n.t === "del") return html`<del key=${k}><${Inline} nodes=${n.c} /></del>`;
    return html`<span key=${k} class="k-md__link"><${Inline} nodes=${n.c} /></span>`;
  });
}

const HEADING_TAGS = ["h3", "h4", "h5", "h6", "h6", "h6"];

function Blocks({ blocks, tight }) {
  return blocks.map((b, k) => {
    if (b.type === "heading") {
      const Tag = HEADING_TAGS[b.level - 1];
      return html`<${Tag} key=${k} class=${`k-md__h k-md__h${Math.min(b.level, 4)}`}><${Inline} nodes=${parseInline(b.text)} /><//>`;
    }
    if (b.type === "paragraph") {
      return tight ? html`<${Inline} key=${k} nodes=${parseInline(b.text)} />`
        : html`<p key=${k} class="k-md__p"><${Inline} nodes=${parseInline(b.text)} /></p>`;
    }
    if (b.type === "code") return html`<pre key=${k} class="k-md__pre u-mono"><code>${b.text}</code></pre>`;
    if (b.type === "rule") return html`<hr key=${k} class="k-md__rule" />`;
    if (b.type === "quote") return html`<blockquote key=${k} class="k-md__quote"><${Blocks} blocks=${b.blocks} /></blockquote>`;
    if (b.type === "list") {
      const Tag = b.ordered ? "ol" : "ul";
      const start = b.ordered && b.start !== null && b.start !== 1 ? b.start : undefined;
      return html`<${Tag} key=${k} class="k-md__list" start=${start}>
        ${b.items.map((it, n) => html`<li key=${n} class=${it.done === null ? undefined : "k-md__task"}>
          ${it.done !== null && html`<span class=${`k-md__box${it.done ? " k-md__box--done" : ""}`} aria-hidden="true">
            ${it.done ? html`<${Icon} name="check" />` : null}</span><span class="k-sr">${it.done ? "Done: " : "Not done: "}</span>`}
          <div class="k-md__item"><${Blocks} blocks=${it.blocks} tight=${!b.loose} /></div>
        </li>`)}
      <//>`;
    }
    if (b.type === "table") {
      const width = Math.max(b.head.length, ...b.rows.map((r) => r.length));
      const fill = (row) => Array.from({ length: width }, (_, n) => text(row[n]));
      const style = (n) => (b.align[n] ? `text-align: ${b.align[n]}` : undefined);
      return html`<div key=${k} class="k-md__table" role="region" aria-label="Table" tabindex="0">
        <table>
          <thead><tr>${fill(b.head).map((c, n) => html`<th key=${n} style=${style(n)}><${Inline} nodes=${parseInline(c)} /></th>`)}</tr></thead>
          <tbody>${b.rows.map((r, m) => html`<tr key=${m}>${fill(r).map((c, n) => html`<td key=${n} style=${style(n)}><${Inline} nodes=${parseInline(c)} /></td>`)}</tr>`)}</tbody>
        </table>
      </div>`;
    }
    return null;
  });
}

// Markdown text shown as readable text. `compact` is for short pieces inside another document.
export function Markdown({ text: source, compact = false }) {
  const blocks = parseMarkdown(source);
  return html`<div class=${`k-md${compact ? " k-md--compact" : ""}`}><${Blocks} blocks=${blocks} /></div>`;
}

export function DocView({ doc, unclear = [] }) {
  if (!doc) return null;
  const sections = Array.isArray(doc.sections) ? doc.sections : [];
  const open = Array.isArray(unclear) ? unclear.filter((q) => text(q).trim()) : [];
  let shownUnclear = false;
  const body = sections.map((s) => {
    if (isUnclear(s && s.heading)) {
      shownUnclear = true;
      return html`<${Unclear} heading=${text(s.heading)} questions=${open} fallback=${text(s.text)} />`;
    }
    return html`<section class="k-doc__section">
      <h3 class="k-doc__heading">${text(s && s.heading)}</h3>
      <div class="k-doc__text"><${Markdown} text=${text(s && s.text)} compact /></div>
    </section>`;
  });
  return html`<article class="k-doc">
    ${doc.name && html`<p class="k-doc__name u-mono"><${Icon} name="file" /><span>${text(doc.name)}</span></p>`}
    ${sections.length === 0 && html`<p class="k-doc__empty">This document is empty.</p>`}
    ${body}
    ${!shownUnclear && open.length > 0 && html`<${Unclear} heading="Anything unclear" questions=${open} />`}
  </article>`;
}

function Unclear({ heading, questions, fallback }) {
  if (questions.length === 0) {
    return html`<section class="k-doc__section">
      <h3 class="k-doc__heading">${heading}</h3>
      <div class="k-doc__text"><${Markdown} text=${fallback || "None."} compact /></div>
    </section>`;
  }
  return html`<section class="k-doc__section k-doc__unclear">
    <h3 class="k-doc__heading"><${Icon} name="alert" /><span>${heading}</span></h3>
    <p class="k-doc__unclear-lead">${questions.length === 1 ? "One question is waiting for your answer." : `${questions.length} questions are waiting for your answer.`}</p>
    <ol class="k-doc__questions">${questions.map((q) => html`<li>${text(q)}</li>`)}</ol>
  </section>`;
}
