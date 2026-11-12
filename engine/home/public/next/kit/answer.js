// A question to the company brain and its answer (shape `ask`, CONTRACTS-V3 33.5).
// The answer was written by an agent: every word is shown as text, sizes are capped, and a source is a link
// only when the home server found it in the brain's own listing (`found` and `link`), never on the agent's word.
import { html } from "../vendor/preact-htm.js";
import { linkHref } from "../lib/format.js";
import { Icon } from "./icon.js";
import { Time } from "./text.js";
import { cx } from "./util.js";

const MAX_QUESTION = 2000;
const MAX_TEXT = 8000;
const MAX_SOURCES = 12;
const MAX_LINE = 300;

const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");

// "A [1] b [2][3]." → [{ text: "A " }, { mark: 1 }, { text: " b " }, { mark: 2 }, { mark: 3 }, { text: "." }].
// Only [1] to [12], written without a leading zero, are marks; [0], [13] and [01] stay text. One pass, linear time.
export function splitMarks(text) {
  const s = typeof text === "string" ? text : "";
  const out = [];
  let buf = "";
  const re = /\[(\d{1,2})\]/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const n = Number(m[1]);
    const ok = n >= 1 && n <= MAX_SOURCES && String(n) === m[1];
    if (!ok) continue;
    buf += s.slice(last, m.index);
    if (buf) out.push({ text: buf });
    buf = "";
    out.push({ mark: n });
    last = m.index + m[0].length;
  }
  buf += s.slice(last);
  if (buf) out.push({ text: buf });
  return out;
}

// Pure. Joins each run of marks to the word before it, and to a closing stop after it, so a line never
// breaks between a word and its marks (M50 F7, M18-28): "a refund [1]." gives
// [{ text: "a " }, { word: "refund", marks: [1], after: "." }]. The space before a mark is dropped.
export function glueMarks(parts) {
  const list = Array.isArray(parts) ? parts.slice() : [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p || !p.mark) {
      if (p && typeof p.text === "string" && p.text) out.push({ text: p.text });
      continue;
    }
    const marks = [];
    while (i < list.length && list[i] && list[i].mark) marks.push(list[i++].mark);
    i -= 1;
    let word = "";
    const prev = out[out.length - 1];
    if (prev && typeof prev.text === "string") {
      const m = /(\S*)\s*$/.exec(prev.text);
      word = m ? m[1] : "";
      prev.text = prev.text.slice(0, prev.text.length - m[0].length);
      if (!prev.text) out.pop();
    }
    let after = "";
    const next = list[i + 1];
    if (next && typeof next.text === "string") {
      const m = /^[.,;:!?)\]»”’]+/.exec(next.text);
      if (m) {
        after = m[0];
        list[i + 1] = { text: next.text.slice(after.length) };
      }
    }
    out.push({ word, marks, after });
  }
  return out;
}

const taskHref = (ask) => {
  const id = ask.identifier || ask.taskId || ask.id;
  return id ? `#/tasks/${encodeURIComponent(String(id))}` : null;
};

export function SourceMark({ n, source }) {
  const href = source && source.found ? linkHref(source.link) : null;
  const words = `Source ${n}`;
  return html`<sup class="k-answer__mark">${href
    ? html`<a class="k-answer__mark-link" href=${href} aria-label=${words}>${n}</a>`
    : html`<span class="k-answer__mark-link" aria-label=${words}>${n}</span>`}</sup>`;
}

function SourceRow({ source }) {
  const n = Number(source.n);
  const path = clip(source.path, 200);
  // A file by its title when the home server sends one, else by its own name: no folder path on screen
  // (C3 25, M50 F17).
  const file = path.split("/").pop() || path;
  const title = source.found ? clip(source.title, 120) : "";
  const note = clip(source.note, 200);
  const href = source.found ? linkHref(source.link) : null;
  const body = html`<span class="k-answer__source-n" aria-hidden="true">${n}</span>
    <${Icon} name="file" size=${14} class="k-answer__source-icon" />
    <span class="k-answer__source-name">${title || file}</span>
    ${title && title !== file ? html`<span class="k-answer__source-note">${file}</span>` : null}
    ${note ? html`<span class="k-answer__source-note">${note}</span>` : null}`;
  if (href) {
    return html`<li class="k-answer__source"><a class="k-answer__source-link" href=${href}>${body}
      <${Icon} name="chevron-right" size=${14} class="k-answer__source-go" /></a></li>`;
  }
  return html`<li class="k-answer__source k-answer__source--missing">
    <span class="k-answer__source-link">${body}<span class="k-answer__source-missing">not in your files</span></span>
  </li>`;
}

function Answered({ ask }) {
  const a = ask.answer;
  const sources = Array.isArray(a.sources)
    ? a.sources.filter((s) => s && Number.isInteger(Number(s.n))).slice(0, MAX_SOURCES)
    : [];
  const byN = new Map(sources.map((s) => [Number(s.n), s]));
  const missing = Array.isArray(a.notInFiles) ? a.notInFiles.filter((x) => typeof x === "string" && x.trim()).slice(0, MAX_SOURCES) : [];
  const text = clip(a.text, MAX_TEXT);
  const readable = a.wellFormed !== false;
  const label = !readable
    ? "Answered. The sources could not be read."
    : a.checked === true ? "Answered from your files. Checked." : "Answered from your files. Not checked.";
  const parts = readable ? glueMarks(splitMarks(text)) : [{ text }];
  return html`
    <div class="k-answer__text">${parts.map((p, i) =>
      p.marks
        ? html`<span key=${i} class="k-answer__glue">${p.word}${p.marks.map((n, j) => html`<${SourceMark} key=${j} n=${n} source=${byN.get(n)} />`)}${p.after}</span>`
        : html`<span key=${i}>${p.text}</span>`)}</div>
    <p class=${cx("k-answer__label", !readable && "k-answer__label--warn")}>
      <${Icon} name=${readable ? "check" : "alert"} size=${14} />
      <span>${label}</span>
      ${a.at ? html`<${Time} at=${a.at} />` : null}
    </p>
    ${readable && sources.length
      ? html`<details class="k-answer__sources" open>
          <summary class="k-answer__sources-head"><${Icon} name="chevron-right" size=${14} class="k-answer__fold" /><span>${sources.length === 1 ? "1 source" : `${sources.length} sources`}</span></summary>
          <ol class="k-answer__source-list">${sources.map((s) => html`<${SourceRow} key=${s.n} source=${s} />`)}</ol>
        </details>`
      : null}
    ${readable && missing.length
      ? html`<div class="k-answer__missing">
          <p class="k-answer__missing-head">Not in your files</p>
          <ul class="k-answer__missing-list">${missing.map((m, i) => html`<li key=${i}>${clip(m, MAX_LINE)}</li>`)}</ul>
        </div>`
      : null}`;
}

function StateLine({ tone, icon, children, href, linkText }) {
  return html`<div class=${cx("k-answer__state", tone && `k-answer__state--${tone}`)}>
    ${icon === "live" ? html`<span class="k-answer__live" aria-hidden="true"></span>` : html`<${Icon} name=${icon} size=${16} />`}
    <span class="k-answer__state-text">${children}</span>
    ${href ? html`<a class="k-answer__state-link" href=${href}>${linkText}</a>` : null}
  </div>`;
}

export function AnswerView({ ask }) {
  if (!ask || typeof ask !== "object") return null;
  const question = clip(ask.question, MAX_QUESTION);
  const state = String(ask.state || "");
  const href = taskHref(ask);
  let body;
  if (state === "answered" && ask.answer && typeof ask.answer === "object") {
    body = html`<${Answered} ask=${ask} />`;
  } else if (state === "answered") {
    body = html`<${StateLine} tone="warn" icon="alert" href=${href} linkText="Open the task">Answered. The answer could not be read.<//>`;
  } else if (state === "reading") {
    body = html`<${StateLine} tone="live" icon="live">Reading your files. This takes a minute or two.<//>`;
  } else if (state === "became_task") {
    body = html`<${StateLine} icon="tasks" href=${href} linkText="Open the task">This became a task. The Chief of staff took it as work to do.<//>`;
  } else if (state === "needs_you") {
    body = html`<${StateLine} tone="warn" icon="alert" href=${href} linkText="Open the task">This question needs you.<//>`;
  } else if (state === "stopped") {
    body = html`<${StateLine} icon="cross" href=${href} linkText="Open the task">This question was stopped.<//>`;
  } else {
    body = html`<${StateLine} icon="clock" href=${href} linkText="Open the task">${clip(ask.plainState, 80) || "Waiting."}<//>`;
  }
  return html`<article class="k-answer" aria-label="A question to the company brain">
    <div class="k-answer__ask">
      <p class="k-answer__bubble">${question}</p>
      ${ask.askedAt ? html`<${Time} at=${ask.askedAt} />` : null}
    </div>
    <div class="k-answer__body" aria-live="polite">${body}</div>
  </article>`;
}
