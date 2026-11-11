// The top of every page: its heading (focused after a page change), a lead line, and any buttons.
import { html, useEffect } from "../vendor/preact-htm.js";
import { useApp } from "../lib/context.js";

export function PageHeader({ title, lead, children, back }) {
  const { state } = useApp();
  const company = state?.company?.name;
  useEffect(() => {
    document.title = company ? `${title} · ${company}` : title;
  }, [title, company]);
  return html`
    <header class="page-header">
      ${back ? html`<p class="back"><a href=${back.href}>${back.label}</a></p>` : null}
      <div class="page-header-row">
        <h1 id="page-title" tabindex="-1">${title}</h1>
        ${children ? html`<div class="page-header-actions">${children}</div>` : null}
      </div>
      ${lead ? html`<p class="lead">${lead}</p>` : null}
    </header>`;
}

export function Section({ title, children, id, aside }) {
  const hid = id ? `${id}-title` : null;
  return html`
    <section class="section" aria-labelledby=${hid}>
      <div class="section-head">
        <h2 id=${hid}>${title}</h2>
        ${aside || null}
      </div>
      ${children}
    </section>`;
}
