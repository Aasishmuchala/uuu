// A conversation between the owner and the agents, and a file as a row. CONTRACTS-V2 13.2, restyled by CONTRACTS-V3 28,
// redrawn by PLAN-COOK T37 (R02) and grouped by T104: the entries are told in rounds. A marker ("Brief written",
// "Round 1 · Passed") opens a round; each round is a card holding its entries, the marker as the card's head line,
// and a 1 px line joins the 20 px pictures of one card's entries. Entries before the first marker are a card with no
// head; a marker with no entry after it stays a quiet trail line. A message is { who, kind, text, at, files?, marker? }
// (17.3, 17.5); the owner's `who.slug` is "you". What kind of message it is (Check, Result, Asked, Note) is one 12 px
// chip of the kit's tag system in its own tone (T114): a check is info, a result good, a question warn, a note neutral.
// Agents wrote these words: they are shown as text, never as HTML.
// `fold: true` on an agent's message (the task page sets it on agents' comments, M63 item 28) shows only the first
// lines of a long text, with a quiet "Read all" button that opens the rest and "Show less" that closes it again.
import { html, useState } from "../vendor/preact-htm.js";
import { bytes, fullWhen, when } from "../lib/format.js";
import { Avatar } from "./avatar.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { Mono } from "./text.js";

const text = (v) => (v === null || v === undefined ? "" : String(v));

const KIND_LABELS = { result: "Result", verdict: "Check", ask: "Asked" };
// The tone of each kind's chip (T114); a kind not listed is neutral.
export const KIND_TONES = { verdict: "info", result: "ok", ask: "warn" };
const MARKER_TONES = ["neutral", "ok", "warn", "bad"];
const MARKER_MAX = 120;

// Pure. What kind of file a name is, by its ending: "text", "code", "data", "picture", "model", "video" or "file".
const ENDINGS = {
  text: ["md", "markdown", "txt", "rtf", "pdf", "doc", "docx", "log"],
  code: ["py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "sh", "rb", "go", "rs", "java", "c", "h", "cpp", "css", "html", "scad"],
  data: ["json", "csv", "tsv", "yaml", "yml", "xml", "toml", "sqlite", "xlsx"],
  picture: ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"],
  model: ["step", "stp", "stl", "obj", "3mf", "glb", "gltf", "f3d", "dxf"],
  video: ["mp4", "mov", "webm"],
};
export function fileKind(name) {
  const base = text(name).split("/").pop();
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "file";
  const ext = base.slice(dot + 1).toLowerCase();
  for (const [kind, exts] of Object.entries(ENDINGS)) if (exts.includes(ext)) return kind;
  return "file";
}

// The kit's line icon for each kind of file.
export const FILE_ICONS = { text: "docs", code: "chip", data: "grid", picture: "image", model: "layers", video: "video", file: "file" };

// `file` is a file-entry (17.1), drawn as a 36 px row: an icon for its kind (from the name's ending), its own name,
// its size in 12 px muted tabular figures, then two fixed columns of quiet icon buttons, Open and Download. A file
// that cannot be viewed here (or fetched) shows that button disabled, its spoken name saying why, so the columns
// never skip. Each button's spoken name says which file it is for, so a list of files is not "Open, Open, Open"
// (M52 K9).
export function FileCard({ file, onOpen }) {
  if (!file) return null;
  const name = text(file.name);
  // The file's own name only: folder paths stay off screen outside Health (C3 25, M50 F17).
  const short = name.split("/").pop() || name;
  const canView = !!file.viewUrl;
  const kind = file.kind === "image" ? "picture" : fileKind(short);
  const word = (w) => html`<span class="k-sr">${w}</span>`;
  const open = canView
    ? onOpen
      ? html`<${Button} variant="quiet" size="sm" icon="external" class="k-file__btn" aria-label=${`Open ${short}`} title="Open" onClick=${() => onOpen(file)}>${word("Open")}<//>`
      : html`<${Button} variant="quiet" size="sm" icon="external" class="k-file__btn" aria-label=${`Open ${short}`} title="Open" href=${file.viewUrl}>${word("Open")}<//>`
    : html`<${Button} variant="quiet" size="sm" icon="external" class="k-file__btn" disabled aria-label=${`Open ${short}: this kind of file cannot be shown here, download it instead`} title="Cannot be shown here">${word("Open")}<//>`;
  const download = file.url
    ? html`<${Button} variant="quiet" size="sm" icon="download" class="k-file__btn" aria-label=${`Download ${short}`} title="Download" href=${file.url} download=${short}>${word("Download")}<//>`
    : html`<${Button} variant="quiet" size="sm" icon="download" class="k-file__btn" disabled aria-label=${`Download ${short}: it cannot be fetched`} title="Cannot be fetched">${word("Download")}<//>`;
  return html`<div class="k-file">
    <span class=${`k-file__icon k-file__icon--${kind}`}><${Icon} name=${FILE_ICONS[kind]} size=${16} /></span>
    <span class="k-file__name" title=${short}>${short}</span>
    <span class="k-file__meta">${Number.isFinite(Number(file.size)) && html`<span>${bytes(file.size)}</span>`}</span>
    <span class="k-file__actions">${open}${download}</span>
  </div>`;
}

// Pure. A message's marker as { label, tone }, or null. The label is cut to one short line.
export function markerOf(message) {
  const m = message && message.marker;
  if (!m || typeof m !== "object") return null;
  const label = text(m.label).replace(/\s+/g, " ").trim().slice(0, MARKER_MAX);
  if (!label) return null;
  return { label, tone: MARKER_TONES.includes(m.tone) ? m.tone : "neutral" };
}

// A trail line: a glyph that carries the tone and the words in grey.
const MARKER_ICONS = { neutral: "arrow-right", ok: "check", warn: "alert", bad: "cross" };

function Marker({ marker }) {
  return html`<li class=${`k-convo__marker k-convo__marker--${marker.tone}`}>
    <${Icon} name=${MARKER_ICONS[marker.tone]} size=${14} class="k-convo__marker-icon" />
    <span class="k-convo__marker-text">${marker.label}</span>
  </li>`;
}

// A text is long when it has more than FOLD_LINES lines or FOLD_CHARS characters. Folded, the first HEAD_LINES
// lines show, at most HEAD_CHARS characters of them.
export const FOLD_LINES = 12;
export const FOLD_CHARS = 900;
const HEAD_LINES = 6;
const HEAD_CHARS = 480;

// foldText(text) -> { long, head }: `head` is the folded view of a long text, else the text itself. Linear.
export function foldText(value) {
  const t = text(value);
  let lines = 1;
  let cut = -1;
  for (let i = 0; i < t.length && lines <= FOLD_LINES; i += 1) {
    if (t.charCodeAt(i) === 10) {
      lines += 1;
      if (lines === HEAD_LINES + 1 && cut < 0) cut = i;
    }
  }
  const long = lines > FOLD_LINES || t.length > FOLD_CHARS;
  if (!long) return { long: false, head: t };
  let head = cut >= 0 ? t.slice(0, cut) : t;
  if (head.length > HEAD_CHARS) {
    head = head.slice(0, HEAD_CHARS);
    const space = head.lastIndexOf(" ");
    if (space > HEAD_CHARS * 0.6) head = head.slice(0, space);
  }
  head = head.trimEnd();
  return { long: true, head: /[.!?…]$/.test(head) ? head : `${head}…` };
}

let foldSeq = 0;

// An agent's long text with its first lines showing and one quiet button to open or close the rest.
function FoldedText({ value }) {
  const [open, setOpen] = useState(false);
  const [id] = useState(() => `k-convo-fold-${(foldSeq += 1)}`);
  const f = foldText(value);
  return html`
    <div class="k-convo__text" id=${id}>${open ? text(value) : f.head}</div>
    <button type="button" class=${`k-convo__fold${open ? " k-convo__fold--open" : ""}`} aria-expanded=${open ? "true" : "false"}
      aria-controls=${id} onClick=${() => setOpen(!open)}>
      <${Icon} name="chevron-down" size=${14} />
      <span>${open ? "Show less" : "Read all"}</span>
    </button>`;
}

// Pure. The messages in rounds: [{ marker, messages }]. A message with a marker opens a new round (the marker is its
// head); the messages before the first marker are a round with no head. A marker alone (no words, no files) heads
// a round that may stay empty.
export function roundsOf(messages) {
  const out = [];
  let cur = null;
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m) continue;
    const marker = markerOf(m);
    if (marker || !cur) { cur = { marker, messages: [] }; out.push(cur); }
    const files = Array.isArray(m.files) ? m.files : [];
    if (marker && !text(m.text) && files.length === 0) continue;
    cur.messages.push(m);
  }
  return out;
}

// One entry: the 20 px picture (joined to the next one by a line), the speaker, its kind and the time, then the words.
function Entry({ m }) {
  const who = m.who || { slug: "", name: "" };
  const mine = who.slug === "you";
  const files = Array.isArray(m.files) ? m.files : [];
  const stamp = m.at && html`<time class="k-convo__time" datetime=${text(m.at)} title=${fullWhen(m.at)}>${when(m.at)}</time>`;
  const fileList = files.length > 0 && html`<div class="k-convo__files">${files.map((f) => html`<${FileCard} file=${f} />`)}</div>`;
  const kind = mine ? (m.kind === "note" ? "Note" : "") : KIND_LABELS[m.kind];
  const tone = mine ? "neutral" : KIND_TONES[m.kind] || "neutral";
  const chip = kind && html`<span class=${`k-tag k-tag--${tone} k-convo__kind`}>${kind}</span>`;
  if (mine) {
    return html`<li class="k-convo__msg k-convo__msg--you">
      <span class="k-sr">You said:</span>
      <span class="k-convo__badge"><${Avatar} slug="you" name=${text(who.name) || "You"} size=${20} /></span>
      <div class="k-convo__head k-convo__mine">
        <span class="k-convo__who" aria-hidden="true">You</span>
        ${chip}
        ${stamp}
      </div>
      <div class="k-convo__content">
        <div class="k-convo__bubble">${text(m.text)}</div>
        ${fileList}
      </div>
    </li>`;
  }
  return html`<li class=${`k-convo__msg k-convo__msg--agent${m.kind ? ` k-convo__msg--${text(m.kind)}` : ""}`}>
    <span class="k-convo__badge"><${Avatar} slug=${who.slug} name=${who.name} size=${20} /></span>
    <div class="k-convo__head">
      <span class="k-convo__who">${text(who.name)}</span>
      ${chip}
      ${m.identifier && html`<${Mono}>${text(m.identifier)}<//>`}
      ${stamp}
    </div>
    <div class="k-convo__content">
      ${m.fold && foldText(m.text).long ? html`<${FoldedText} value=${m.text} />` : html`<div class="k-convo__text">${text(m.text)}</div>`}
      ${fileList}
    </div>
  </li>`;
}

export function Conversation({ messages = [] }) {
  const list = Array.isArray(messages) ? messages : [];
  if (list.length === 0) return html`<p class="k-convo k-convo--empty">No messages yet.</p>`;
  const rounds = roundsOf(list);
  return html`<ol class="k-convo">${rounds.map((r, i) => {
    if (!r.messages.length) return r.marker ? html`<${Marker} key=${`m${i}`} marker=${r.marker} />` : null;
    return html`<li class="k-convo__round" key=${`r${i}`}>
      ${r.marker && html`<ol class="k-convo__round-head"><${Marker} marker=${r.marker} /></ol>`}
      <ol class="k-convo__entries">${r.messages.map((m, j) => html`<${Entry} key=${j} m=${m} />`)}</ol>
    </li>`;
  })}</ol>`;
}
