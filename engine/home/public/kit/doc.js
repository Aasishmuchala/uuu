// A staged document (brief, plan, summary, check) as headings and plain text. CONTRACTS-V2 13.2.
// `doc` is { name, file, sections: [{ heading, text }] } (17.3); `unclear` the stage's open questions.
// Agents wrote this text: it is shown as text, never as HTML.
import { html } from "../vendor/preact-htm.js";
import { Icon } from "./icon.js";

const text = (v) => (v === null || v === undefined ? "" : String(v));
const isUnclear = (heading) => /^anything unclear$/i.test(text(heading).trim());

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
      <div class="k-doc__text">${text(s && s.text)}</div>
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
      <div class="k-doc__text">${fallback || "None."}</div>
    </section>`;
  }
  return html`<section class="k-doc__section k-doc__unclear">
    <h3 class="k-doc__heading"><${Icon} name="alert" /><span>${heading}</span></h3>
    <p class="k-doc__unclear-lead">${questions.length === 1 ? "One question is waiting for your answer." : `${questions.length} questions are waiting for your answer.`}</p>
    <ol class="k-doc__questions">${questions.map((q) => html`<li>${text(q)}</li>`)}</ol>
  </section>`;
}
