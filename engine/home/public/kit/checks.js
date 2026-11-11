// The Checker's numbered checks with a pass or fail mark and an evidence count, and one piece of evidence shown
// large. CONTRACTS-V2 13.2. A check is { n, question, answer: "yes"|"no", reason, evidence: [file-entry] } (17.3).
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { safeHref } from "./util.js";
import { Icon } from "./icon.js";
import { FileCard } from "./conversation.js";
import { Loading, ErrorNotice } from "./states.js";

const text = (v) => (v === null || v === undefined ? "" : String(v));
const passed = (c) => text(c && c.answer).toLowerCase() === "yes";

export function CheckList({ checks = [], selected, onSelect }) {
  const list = Array.isArray(checks) ? checks : [];
  if (list.length === 0) return html`<p class="k-checks k-checks--empty">No checks in this round.</p>`;
  return html`<ol class="k-checks">
    ${list.map((c) => {
      const ok = passed(c);
      const count = Array.isArray(c.evidence) ? c.evidence.length : 0;
      const isSel = selected !== undefined && selected !== null && Number(selected) === Number(c.n);
      const inner = html`
        <span class=${`k-checks__mark k-checks__mark--${ok ? "pass" : "fail"}`}>
          <${Icon} name=${ok ? "check" : "cross"} />
          <span class="k-checks__word">${ok ? "Passed" : "Failed"}</span>
        </span>
        <span class="k-checks__body">
          <span class="k-checks__question"><span class="k-checks__n">${text(c.n)}.</span> ${text(c.question)}</span>
          ${c.reason && html`<span class="k-checks__reason">${text(c.reason)}</span>`}
        </span>
        <span class="k-checks__count">${count === 0 ? "No evidence" : `${count} ${count === 1 ? "file" : "files"}`}</span>`;
      return html`<li class=${`k-checks__item${isSel ? " k-checks__item--selected" : ""}`} key=${c.n}>
        ${onSelect
          ? html`<button type="button" class="k-checks__row" aria-pressed=${isSel ? "true" : "false"}
              onClick=${() => onSelect(c.n)}>${inner}</button>`
          : html`<div class="k-checks__row">${inner}</div>`}
      </li>`;
    })}
  </ol>`;
}

const TEXT_NAME = /\.(md|txt|json|py|csv|log)$/i;

// One file of evidence: an image shown large, a text file shown as plain text, anything else as a FileCard.
export function Evidence({ file }) {
  const viewUrl = file ? safeHref(file.viewUrl) : null;
  const isImage = !!(viewUrl && file.kind === "image");
  const isText = !!(viewUrl && !isImage && (file.kind === "text" || TEXT_NAME.test(text(file.name))));
  const [s, setS] = useState({ loading: isText, data: null, error: null });
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!isText) return undefined;
    let live = true;
    setS({ loading: true, data: null, error: null });
    api.get(viewUrl).then(
      (data) => { if (live) setS({ loading: false, data, error: null }); },
      (error) => { if (live) setS({ loading: false, data: null, error }); },
    );
    return () => { live = false; };
  }, [isText, viewUrl, n]);

  if (!file) return null;
  const name = text(file.name);
  if (isImage) {
    return html`<figure class="k-evidence k-evidence--image">
      <img src=${viewUrl} alt=${`Evidence: ${name}`} loading="lazy" />
      <figcaption class="k-evidence__name u-mono">${name}</figcaption>
    </figure>`;
  }
  if (isText) {
    return html`<figure class="k-evidence k-evidence--text">
      ${s.loading && html`<${Loading} lines=${4} label=${`Loading ${name}`} />`}
      ${s.error && html`<${ErrorNotice} error=${s.error} onRetry=${() => setN(n + 1)} />`}
      ${s.data && html`<pre class="k-evidence__text u-mono">${text(s.data.text)}</pre>`}
      ${s.data && s.data.truncated && html`<p class="k-evidence__more u-mono">Only the start of this file is shown.</p>`}
      <figcaption class="k-evidence__name u-mono">${name}</figcaption>
    </figure>`;
  }
  return html`<div class="k-evidence k-evidence--file"><${FileCard} file=${file} /></div>`;
}
