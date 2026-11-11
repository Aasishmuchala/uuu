// The top of every page (its heading takes focus after a page change) and a titled section.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { useApp } from "../lib/context.js";
import { Creature } from "./creature.js";
import { CREATURES } from "./creature-data.js";
import { Icon } from "./icon.js";
import { cx, nextId, safeHref } from "./util.js";

const TEXT_MAX = 200;
const short = (v) => (typeof v === "string" ? v.slice(0, TEXT_MAX) : v);

// The breadcrumb chip: `chip = { label, href }`. `label` is a string, or a list of parts shown with "/" between
// them ("Marketing", "A carousel from a concept"); `href` is where its close link goes.
function Crumb({ chip }) {
  const parts = (Array.isArray(chip.label) ? chip.label : [chip.label]).filter((p) => p !== undefined && p !== null && p !== "");
  if (!parts.length) return null;
  const close = safeHref(chip.href);
  return html`<div class="k-page-header__chip">
    <span class="k-page-header__crumb">
      ${parts.map((p, i) => html`${i ? html`<span class="k-page-header__sep" aria-hidden="true">/</span>` : null}<span
          class=${i === parts.length - 1 ? "k-page-header__crumb-last" : "k-page-header__crumb-part"}
        >${short(p)}</span>`)}
    </span>
    ${close
      ? html`<a class="k-page-header__chip-close" href=${close} aria-label=${chip.closeLabel || "Close"} title=${chip.closeLabel || "Close"}>
          <${Icon} name="cross" size=${12} />
        </a>`
      : null}
  </div>`;
}

// Sets the window's title to "<title> · <company>". `over` is the overline above the title; `creature` is a
// department's creature id, shown left of the title at 48 px; `back` is a glass chip with an arrow.
export function PageHeader({ title, lead, back, actions, over, creature, chip, children }) {
  const app = useApp() || {};
  const company = app.shell?.company?.name || app.state?.company?.name || "";
  const name = typeof title === "string" ? title : "";
  useEffect(() => {
    if (typeof document === "undefined") return;
    const text = [name, company].filter(Boolean).join(" · ");
    if (text) document.title = text;
  }, [name, company]);
  const backHref = back ? safeHref(back.href) : null;
  const pet = typeof creature === "string" && Object.hasOwn(CREATURES, creature) ? html`<${Creature} id=${creature} size=${48} />` : null;
  const hasOver = over !== undefined && over !== null && over !== "";
  const top = backHref || (chip && typeof chip === "object");
  return html`<header class=${cx("k-page-header", pet && "k-page-header--creature")}>
    ${top
      ? html`<div class="k-page-header__top">
          ${backHref
            ? html`<a class="k-page-header__back" href=${backHref}>
                <${Icon} name="arrow-left" size=${14} class="k-page-header__back-icon" />
                <span>${short(back.label) || "Back"}</span>
              </a>`
            : null}
          ${chip && typeof chip === "object" ? html`<${Crumb} chip=${chip} />` : null}
        </div>`
      : null}
    <div class="k-page-header__row">
      <div class="k-page-header__name">
        ${pet ? html`<span class="k-page-header__creature">${pet}</span>` : null}
        <div class="k-page-header__titles">
          ${hasOver ? html`<p class="k-page-header__over">${short(over)}</p>` : null}
          <h1 id="page-title" class="k-page-header__title" tabindex="-1">${title}</h1>
        </div>
      </div>
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
