// A conversation between the owner and the agents, and a file as a card. CONTRACTS-V2 13.2.
// A message is { who, kind, text, at, files? } (17.3, 17.5); the owner's `who.slug` is "you".
// Agents wrote these words: they are shown as text, never as HTML.
import { html } from "../vendor/preact-htm.js";
import { bytes, fullWhen, when } from "../lib/format.js";
import { Avatar } from "./avatar.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { Mono } from "./text.js";

const text = (v) => (v === null || v === undefined ? "" : String(v));

const KIND_LABELS = { result: "Result", verdict: "Check", ask: "Asked" };

// `file` is a file-entry (17.1). One button: Open when the file can be viewed here, else Download.
export function FileCard({ file, onOpen }) {
  if (!file) return null;
  const name = text(file.name);
  const short = name.split("/").pop() || name;
  const folder = name.length > short.length ? name.slice(0, name.length - short.length - 1) : "";
  const canView = !!file.viewUrl;
  const button = canView
    ? onOpen
      ? html`<${Button} size="sm" icon="external" onClick=${() => onOpen(file)}>Open<//>`
      : html`<${Button} size="sm" icon="external" href=${file.viewUrl}>Open<//>`
    : file.url
      ? html`<${Button} size="sm" icon="download" href=${file.url} download=${short}>Download<//>`
      : null;
  return html`<div class="k-file">
    <span class="k-file__icon"><${Icon} name=${file.kind === "image" ? "image" : "file"} /></span>
    <span class="k-file__body">
      <span class="k-file__name" title=${name}>${short}</span>
      <span class="k-file__meta">${folder && html`<span class="k-file__folder u-mono">${folder}</span>`}${Number.isFinite(Number(file.size)) && html`<span>${bytes(file.size)}</span>`}</span>
    </span>
    ${button}
  </div>`;
}

export function Conversation({ messages = [] }) {
  const list = Array.isArray(messages) ? messages : [];
  if (list.length === 0) return html`<p class="k-convo k-convo--empty">No messages yet.</p>`;
  return html`<ol class="k-convo">
    ${list.map((m, i) => {
      const who = (m && m.who) || { slug: "", name: "" };
      const files = Array.isArray(m.files) ? m.files : [];
      const mine = who.slug === "you";
      const stamp = m.at && html`<time class="k-convo__time" datetime=${text(m.at)} title=${fullWhen(m.at)}>${when(m.at)}</time>`;
      const fileList = files.length > 0 && html`<div class="k-convo__files">${files.map((f) => html`<${FileCard} file=${f} />`)}</div>`;
      if (mine) {
        return html`<li class="k-convo__msg k-convo__msg--you" key=${i}>
          <span class="u-visually-hidden">You said:</span>
          <div class="k-convo__bubble">${text(m.text)}</div>
          ${fileList}
          <div class="k-convo__meta k-convo__meta--you">${m.kind === "note" && html`<span>Note</span>`}${stamp}</div>
        </li>`;
      }
      const label = KIND_LABELS[m.kind];
      return html`<li class=${`k-convo__msg k-convo__msg--agent${m.kind ? ` k-convo__msg--${text(m.kind)}` : ""}`} key=${i}>
        <${Avatar} slug=${who.slug} name=${who.name} size=${24} />
        <div class="k-convo__content">
          <div class="k-convo__meta">
            <span class="k-convo__who">${text(who.name)}</span>
            ${label && html`<span class="k-convo__kind">${label}</span>`}
            ${m.identifier && html`<${Mono}>${text(m.identifier)}<//>`}
            ${stamp}
          </div>
          <div class="k-convo__text">${text(m.text)}</div>
          ${fileList}
        </div>
      </li>`;
    })}
  </ol>`;
}
