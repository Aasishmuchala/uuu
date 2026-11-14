// The top of every page (its heading takes focus after a page change) and a titled section.
// The header draws the kind line, the title, a lede and the actions; where you are (the crumbs) goes to the top bar.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { useApp } from "../lib/context.js";
import { nextId, safeHref } from "./util.js";

const TEXT_MAX = 200;
const CRUMB_MAX = 60;
const short = (v) => (typeof v === "string" ? v.slice(0, TEXT_MAX) : v);
const filled = (v) => v !== undefined && v !== null && v !== "";

// The kind line is sentence case: a word written all in capitals ("DASHBOARD") is shown as "Dashboard".
// Anything with a small letter in it is shown as written. Pure.
export function kindLine(v) {
  if (typeof v !== "string") return v;
  const s = v.slice(0, TEXT_MAX);
  if (!/[A-Z]/.test(s) || /[a-z]/.test(s)) return s;
  const low = s.toLowerCase();
  return low.charAt(0).toUpperCase() + low.slice(1);
}

// The crumbs a header gives the top bar, as [{ label, href? }] (the last one is where you are, with no link).
// From `crumbs` when given; else from the old breadcrumb chip `{ label, href }`, whose label parts become
// crumbs and whose `href` is the parent's address; else none, and the shell says where you are by the route.
// Pure: labels are text, capped at 60; an address that is not the app's own is dropped.
export function headerCrumbs({ crumbs, chip } = {}) {
  const clean = (list) =>
    list
      .map((c) => (c && typeof c === "object" ? c : { label: c }))
      .filter((c) => (typeof c.label === "string" || typeof c.label === "number") && String(c.label) !== "")
      .map((c) => {
        const out = { label: String(c.label).slice(0, CRUMB_MAX) };
        const href = safeHref(c.href);
        if (href) out.href = href;
        return out;
      });
  if (Array.isArray(crumbs)) {
    const list = clean(crumbs);
    if (list.length) delete list[list.length - 1].href;
    return list;
  }
  if (chip && typeof chip === "object") {
    const parts = clean((Array.isArray(chip.label) ? chip.label : [chip.label]).map((label) => ({ label })));
    const href = safeHref(chip.href);
    if (parts.length > 1 && href) parts[parts.length - 2].href = href;
    return parts;
  }
  return [];
}

// Sets the window's title to "<title> · <company>". `over` is the kind line above the title; `lede` (or the
// older `lead`) is the sentence under it. `chip`, `crumbs` and `back` say where you are: the crumbs go to
// the top bar through the shell's setTop, when the shell has one. `creature` is accepted and not drawn.
export function PageHeader({ title, lede, lead, back, actions, over, creature, chip, crumbs, children }) {
  const app = useApp() || {};
  const company = app.shell?.company?.name || app.state?.company?.name || "";
  const name = typeof title === "string" ? title : "";
  useEffect(() => {
    if (typeof document === "undefined") return;
    const text = [name, company].filter(Boolean).join(" · ");
    if (text) document.title = text;
  }, [name, company]);
  const trail = headerCrumbs({ crumbs, chip });
  const key = JSON.stringify(trail);
  const setTop = typeof app.setTop === "function" ? app.setTop : null;
  useEffect(() => {
    if (setTop && trail.length) setTop({ crumbs: trail });
  }, [key, setTop]);
  const sentence = filled(lede) ? lede : lead;
  return html`<header class="k-page-header">
    <div class="k-page-header__row">
      <div class="k-page-header__titles">
        ${filled(over) ? html`<p class="k-page-header__over">${kindLine(over)}</p>` : null}
        <h1 id="page-title" class="k-page-header__title" tabindex="-1">${title}</h1>
      </div>
      ${actions ? html`<div class="k-page-header__actions">${actions}</div>` : null}
    </div>
    ${filled(sentence) ? html`<p class="k-page-header__lede k-page-header__lead">${short(sentence)}</p>` : null}
    ${children ? html`<div class="k-page-header__more">${children}</div>` : null}
  </header>`;
}

export function Section({ title, hint, count, aside, children }) {
  const [id] = useState(() => nextId("k-section"));
  const hasCount = filled(count);
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
