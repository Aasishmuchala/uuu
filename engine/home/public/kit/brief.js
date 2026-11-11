// One item of the daily brief (CONTRACTS-V2 13.2): something the owner should know that needs no decision.
// `item` is { id, title, text, who, about: { label, link }, at } (17.2).
import { html } from "../vendor/preact-htm.js";
import { linkHref, when, fullWhen } from "../lib/format.js";
import { Avatar } from "./avatar.js";
import { Icon } from "./icon.js";
import { Tag } from "./tag.js";

const text = (v) => (v === null || v === undefined ? "" : String(v));

export function BriefCard({ item }) {
  if (!item) return null;
  const who = item.who || null;
  const about = item.about || null;
  const href = about && about.link ? linkHref(about.link) : null;
  return html`<article class="k-brief">
    <div class="k-brief__head">
      ${who && html`<${Avatar} slug=${who.slug} name=${who.name} size=${24} />`}
      <h3 class="k-brief__title">${text(item.title)}</h3>
      <${Tag}>FYI<//>
    </div>
    ${item.text && html`<p class="k-brief__text">${text(item.text)}</p>`}
    <p class="k-brief__source">
      ${who && html`<span>${text(who.name)}</span>`}
      ${about && about.label && html`<span class="k-brief__about">
        <${Icon} name="file" />
        ${href ? html`<a href=${href}>${text(about.label)}</a>` : html`<span>${text(about.label)}</span>`}
      </span>`}
      ${item.at && html`<time datetime=${text(item.at)} title=${fullWhen(item.at)}>${when(item.at)}</time>`}
    </p>
  </article>`;
}
