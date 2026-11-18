// One entity of the brain and what is linked to it (PLAN-BRAIN T13, B10 `GET /api/brain/links/:key`): its name and
// kind at the top, then "Linked" as a plain grouped list (each row a button to that entity's own view), then
// "Where it is mentioned" as the same cards the search shows. No graph is drawn.
// Every string from the server is put in as text, never as HTML.
import { html, useEffect, useRef } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { fileToken } from "../lib/format.js";
import { Button, Empty, ErrorNotice, Loading } from "../kit/index.js";
import { BRAIN_WORDS, KIND_WORDS, PassageList, needsRestart } from "./find.js";

const NAME_MAX = 120;
const LINKED_MAX = 40;

const str = (v) => (typeof v === "string" ? v : "");
const arr = (v) => (Array.isArray(v) ? v : []);
const cut = (v, n) => str(v).slice(0, n);

// The groups of "Linked", in order. A customer is its own group, for an invoice, deal, project or person's view.
export const LINK_GROUPS = [
  { type: "customer", title: "Customers" },
  { type: "invoice", title: "Invoices" },
  { type: "deal", title: "Deals" },
  { type: "project", title: "Projects" },
  { type: "ticket", title: "Support requests" },
  { type: "person", title: "People" },
];

export const LINKS_WORDS = {
  linked: "Linked",
  noLinks: "Nothing is linked to this.",
  mentioned: "Where it is mentioned",
  noMentions: "It is not mentioned in your files or the books.",
  loading: "Opening what is linked",
};

// The address part of an entity key: the base64url of its UTF-8 text, as the server reads it.
export const keyPart = (key) => fileToken(str(key));

// The linked entities, grouped in the order of LINK_GROUPS: [{ type, title, items: [{ key, name }] }]. A key seen
// twice (linked both ways) is listed once; a kind not in the list is left out.
export function groupLinked(linked) {
  const seen = new Set();
  const by = new Map(LINK_GROUPS.map((g) => [g.type, []]));
  for (const l of arr(linked).slice(0, LINKED_MAX)) {
    const e = l && l.entity;
    const key = str(e && e.key);
    if (!key || seen.has(key) || !by.has(e.type)) continue;
    seen.add(key);
    by.get(e.type).push({ key, name: cut(e.name, NAME_MAX) || key });
  }
  return LINK_GROUPS.map((g) => ({ ...g, items: by.get(g.type) })).filter((g) => g.items.length);
}

export function LinksView({ entityKey, onOpen, onBack, backLabel = "Back" }) {
  const res = useResource(`/api/brain/links/${keyPart(entityKey)}`);
  const head = useRef(null);
  const name = cut(res.data && res.data.entity && res.data.entity.name, NAME_MAX);
  // The heading takes focus once the entity is shown, so a keyboard or screen reader lands on it.
  useEffect(() => { if (name && head.current && head.current.focus) head.current.focus({ preventScroll: true }); }, [name]);

  const back = onBack ? html`<div class="p-brain-find__back"><${Button} size="sm" variant="quiet" icon="arrow-left" onClick=${onBack}>${backLabel}<//></div>` : null;
  if (res.loading && !res.data) return html`<div class="p-brain-find__links">${back}<${Loading} lines=${3} label=${LINKS_WORDS.loading} /></div>`;
  if (res.error) {
    return html`<div class="p-brain-find__links">${back}${needsRestart(res.error)
      ? html`<${Empty} inline title=${BRAIN_WORDS.restart} />`
      : res.error.status === 404
      ? html`<${Empty} inline title=${cut(res.error.message, 200) || "That is not in the brain's index."} />`
      : html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`}</div>`;
  }
  const d = res.data || {};
  const entity = d.entity || {};
  const groups = groupLinked(d.linked);
  const passages = arr(d.passages).filter((p) => p && typeof p === "object");
  return html`<div class="p-brain-find__links">
    ${back}
    <header class="p-brain-find__entity">
      <h2 class="p-brain-find__entity-name" tabindex="-1" ref=${head}>${name || cut(entity.key, NAME_MAX)}</h2>
      <p class="p-brain-find__entity-kind">${KIND_WORDS[entity.type] || "Record"}</p>
    </header>
    <section class="p-brain-find__section" aria-label=${LINKS_WORDS.linked}>
      <h3 class="p-brain-find__section-title">${LINKS_WORDS.linked}</h3>
      ${groups.length
        ? groups.map((g) => html`<div key=${g.type} class="p-brain-find__group">
            <h4 class="p-brain-find__group-title">${g.title}</h4>
            <ul class="p-brain-find__linked">
              ${g.items.map((it) => html`<li key=${it.key}>
                <button type="button" class="p-brain-find__linked-item" onClick=${() => onOpen && onOpen(it.key)}>${it.name}</button>
              </li>`)}
            </ul>
          </div>`)
        : html`<p class="p-brain-find__empty">${LINKS_WORDS.noLinks}</p>`}
    </section>
    <section class="p-brain-find__section" aria-label=${LINKS_WORDS.mentioned}>
      <h3 class="p-brain-find__section-title">${LINKS_WORDS.mentioned}</h3>
      ${passages.length ? html`<${PassageList} items=${passages} />` : html`<p class="p-brain-find__empty">${LINKS_WORDS.noMentions}</p>`}
    </section>
  </div>`;
}

export default LinksView;
