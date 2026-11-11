// The top of every page (its heading takes focus after a page change) and a titled section.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { useApp } from "../lib/context.js";
import { Icon } from "./icon.js";
import { nextId, safeHref } from "./util.js";

// Sets the window's title to "<title> · <company>".
export function PageHeader({ title, lead, back, actions, children }) {
  const app = useApp() || {};
  const company = app.shell?.company?.name || app.state?.company?.name || "";
  const name = typeof title === "string" ? title : "";
  useEffect(() => {
    if (typeof document === "undefined") return;
    const text = [name, company].filter(Boolean).join(" · ");
    if (text) document.title = text;
  }, [name, company]);
  const backHref = back ? safeHref(back.href) : null;
  return html`<header class="k-page-header">
    ${backHref
      ? html`<a class="k-page-header__back" href=${backHref}>
          <${Icon} name="chevron-right" size=${14} class="k-page-header__back-icon" />
          <span>${back.label || "Back"}</span>
        </a>`
      : null}
    <div class="k-page-header__row">
      <h1 id="page-title" class="k-page-header__title" tabindex="-1">${title}</h1>
      ${actions ? html`<div class="k-page-header__actions">${actions}</div>` : null}
    </div>
    ${lead ? html`<p class="k-page-header__lead">${lead}</p>` : null}
    ${children ? html`<div class="k-page-header__more">${children}</div>` : null}
  </header>`;
}

export function Section({ title, hint, count, aside, children }) {
  const [id] = useState(() => nextId("k-section"));
  const hasCount = count !== undefined && count !== null && count !== "";
  return html`<section class="k-section" aria-labelledby=${title ? id : undefined}>
    ${title || aside
      ? html`<div class="k-section__head">
          ${title
            ? html`<h2 class="k-section__title" id=${id}>
                <span>${title}</span>
                ${hasCount ? html`<span class="k-section__count">${count}</span>` : null}
              </h2>`
            : null}
          ${aside ? html`<div class="k-section__aside">${aside}</div>` : null}
        </div>`
      : null}
    ${hint ? html`<p class="k-section__hint">${hint}</p>` : null}
    <div class="k-section__body">${children}</div>
  </section>`;
}
