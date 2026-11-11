// Search across the engine: results grouped by where they live; parts that were not searched are named.
import { html } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { linkHref } from "../lib/format.js";
import { ErrorNotice, Loading, Notice } from "../components/notice.js";
import { PageHeader } from "../components/page.js";

const SOURCE_WORDS = {
  goals: "Goals", knowledge: "Knowledge", books: "Books", customers: "Customers",
  support: "Support", people: "People", marketing: "Marketing",
};

export function SearchPage({ route }) {
  const q = (route.query.get("q") || "").trim();
  const ok = q.length >= 2;
  const res = useResource(ok ? `/api/search?q=${encodeURIComponent(q)}` : null);
  const groups = res.data?.groups || [];
  const notSearched = res.data?.notSearched || [];
  const total = groups.reduce((n, g) => n + g.results.length, 0);

  let lead = "Find goals, documents and records anywhere in the engine.";
  if (ok && res.data) lead = total ? `${total === 1 ? "1 result" : `${total} results`} for “${q}”.` : `Nothing found for “${q}”.`;
  else if (ok) lead = `Searching for “${q}”…`;

  return html`
    <${PageHeader} title="Search" lead=${lead} />
    ${!ok ? html`
      <div class="empty">
        <p class="empty-title">${q ? "Type at least two letters to search." : "Type in the search box above."}</p>
        <p class="muted">Press <kbd>/</kbd> from any page to jump to the search box.</p>
      </div>` : null}
    ${ok && res.loading && !res.data ? html`<div class="card"><${Loading} lines=${4} label="Searching" /></div>` : null}
    <${ErrorNotice} error=${res.error} onRetry=${res.reload} />
    ${ok && res.data && !total ? html`
      <div class="empty">
        <p class="empty-title">Nothing matches “${q}”.</p>
        <p class="muted">Try fewer words, or a different word for the same thing.</p>
      </div>` : null}
    ${groups.map((g) => html`
      <section key=${g.source} class="section" aria-labelledby=${`results-${g.source}`}>
        <div class="section-head"><h2 id=${`results-${g.source}`}>${g.label || SOURCE_WORDS[g.source] || "Other"}</h2></div>
        <ul class="rows">
          ${g.results.map((r, i) => {
            const href = linkHref(r.link);
            return html`
              <li key=${i} class="row">
                <div class="row-main">
                  ${href ? html`<a class="row-title" href=${href}>${r.title}</a>` : html`<p class="row-title-text">${r.title}</p>`}
                  ${r.snippet ? html`<p class="row-sub">${r.snippet}</p>` : null}
                </div>
              </li>`;
          })}
        </ul>
      </section>`)}
    ${notSearched.length ? html`
      <${Notice} title="Not searched this time">
        <ul class="plain-list">
          ${notSearched.map((n) => html`<li key=${n.source}><strong>${SOURCE_WORDS[n.source] || "A part"}:</strong> ${n.reason}</li>`)}
        </ul>
      <//>` : null}`;
}
