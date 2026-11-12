// A conversation between the owner and the agents, and a file as a card. CONTRACTS-V2 13.2, restyled by CONTRACTS-V3 28.
// A message is { who, kind, text, at, files?, marker? } (17.3, 17.5); the owner's `who.slug` is "you". The owner's
// message is a glass bubble at the right with an initials badge; an agent's message is plain text in the column under
// its picture, name and time. `marker` ({ label, tone }) is a centred quiet line before the message, such as
// "Brief written" or "Round 1 · Repairing"; a message with only a marker is only that line.
// Agents wrote these words: they are shown as text, never as HTML.
// `fold: true` on an agent's message (the task page sets it on agents' comments, M63 item 28) shows only the first
// lines of a long text, with a "Show all" button that opens the rest and "Show less" that closes it again.
import { html, useState } from "../vendor/preact-htm.js";
import { bytes, fullWhen, when } from "../lib/format.js";
import { Avatar } from "./avatar.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { Mono } from "./text.js";

const text = (v) => (v === null || v === undefined ? "" : String(v));

const KIND_LABELS = { result: "Result", verdict: "Check", ask: "Asked" };
const MARKER_TONES = ["neutral", "ok", "warn", "bad"];
const MARKER_MAX = 120;

// `file` is a file-entry (17.1). One button: Open when the file can be viewed here, else Download.
export function FileCard({ file, onOpen }) {
  if (!file) return null;
  const name = text(file.name);
  // The file's own name only: folder paths stay off screen outside Health (C3 25, M50 F17).
  const short = name.split("/").pop() || name;
  const canView = !!file.viewUrl;
  // Each button says which file it is for, so a list of files is not "Open, Open, Open" (M52 K9).
  const button = canView
    ? onOpen
      ? html`<${Button} size="sm" icon="external" aria-label=${`Open ${short}`} onClick=${() => onOpen(file)}>Open<//>`
      : html`<${Button} size="sm" icon="external" aria-label=${`Open ${short}`} href=${file.viewUrl}>Open<//>`
    : file.url
      ? html`<${Button} size="sm" icon="download" aria-label=${`Download ${short}`} href=${file.url} download=${short}>Download<//>`
      : null;
  return html`<div class="k-file">
    <span class="k-file__icon"><${Icon} name=${file.kind === "image" ? "image" : "file"} /></span>
    <span class="k-file__body">
      <span class="k-file__name" title=${short}>${short}</span>
      <span class="k-file__meta">${Number.isFinite(Number(file.size)) && html`<span>${bytes(file.size)}</span>`}</span>
    </span>
    ${button}
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

function Marker({ marker }) {
  return html`<li class=${`k-convo__marker k-convo__marker--${marker.tone}`}>
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

// An agent's long text with its first lines showing and one real button to open or close the rest.
function FoldedText({ value }) {
  const [open, setOpen] = useState(false);
  const [id] = useState(() => `k-convo-fold-${(foldSeq += 1)}`);
  const f = foldText(value);
  return html`
    <div class="k-convo__text" id=${id}>${open ? text(value) : f.head}</div>
    <button type="button" class=${`k-convo__fold${open ? " k-convo__fold--open" : ""}`} aria-expanded=${open ? "true" : "false"}
      aria-controls=${id} onClick=${() => setOpen(!open)}>
      <${Icon} name="chevron-down" size=${14} />
      <span>${open ? "Show less" : "Show all"}</span>
    </button>`;
}

export function Conversation({ messages = [] }) {
  const list = Array.isArray(messages) ? messages : [];
  if (list.length === 0) return html`<p class="k-convo k-convo--empty">No messages yet.</p>`;
  const out = [];
  list.forEach((m, i) => {
    if (!m) return;
    const marker = markerOf(m);
    if (marker) out.push(html`<${Marker} key=${`m${i}`} marker=${marker} />`);
    const files = Array.isArray(m.files) ? m.files : [];
    if (marker && !text(m.text) && files.length === 0) return;
    const who = m.who || { slug: "", name: "" };
    const mine = who.slug === "you";
    const stamp = m.at && html`<time class="k-convo__time" datetime=${text(m.at)} title=${fullWhen(m.at)}>${when(m.at)}</time>`;
    const fileList = files.length > 0 && html`<div class="k-convo__files">${files.map((f) => html`<${FileCard} file=${f} />`)}</div>`;
    if (mine) {
      out.push(html`<li class="k-convo__msg k-convo__msg--you" key=${i}>
        <span class="u-visually-hidden">You said:</span>
        <div class="k-convo__mine">
          <div class="k-convo__bubble">${text(m.text)}</div>
          <span class="k-convo__badge"><${Avatar} slug="you" name=${text(who.name) || "You"} size=${24} /></span>
        </div>
        ${fileList}
        <div class="k-convo__meta k-convo__meta--you">${m.kind === "note" && html`<span>Note</span>`}${stamp}</div>
      </li>`);
      return;
    }
    const label = KIND_LABELS[m.kind];
    out.push(html`<li class=${`k-convo__msg k-convo__msg--agent${m.kind ? ` k-convo__msg--${text(m.kind)}` : ""}`} key=${i}>
      <div class="k-convo__head">
        <${Avatar} slug=${who.slug} name=${who.name} size=${24} />
        <span class="k-convo__who">${text(who.name)}</span>
        ${label && html`<span class="k-convo__kind">${label}</span>`}
        ${m.identifier && html`<${Mono}>${text(m.identifier)}<//>`}
        ${stamp}
      </div>
      <div class="k-convo__content">
        ${m.fold && foldText(m.text).long ? html`<${FoldedText} value=${m.text} />` : html`<div class="k-convo__text">${text(m.text)}</div>`}
        ${fileList}
      </div>
    </li>`);
  });
  return html`<ol class="k-convo">${out}</ol>`;
}
