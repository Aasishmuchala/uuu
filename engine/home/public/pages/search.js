// Search across the engine: results grouped by where they live; parts that were not searched are named.
// Everything in the results was written by someone else: it is shown as text and the links are our own pages.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { linkHref } from "../lib/format.js";
import { Empty, ErrorNotice, Loading, Notice, PageHeader, Section, TextInput } from "../kit/index.js";

// How many results there are across all the groups.
export function groupCount(groups) {
  if (!Array.isArray(groups)) return 0;
  return groups.reduce((n, g) => n + (g && Array.isArray(g.results) ? g.results.length : 0), 0);
}

// The owner's words for a group, where the server's label is an older one.
const GROUP_WORDS = { goals: "Tasks", knowledge: "Files", brain: "Files", jobs: "Jobs" };
export const groupLabel = (g) => GROUP_WORDS[g && g.source] || (g && g.label) || "";

export default function Page({ route }) {
  const fromAddress = ((route && route.query && route.query.get("q")) || "").trim();
  const [text, setText] = useState(fromAddress);
  useEffect(() => setText(fromAddress), [fromAddress]);
  const q = fromAddress;
  const ok = q.length >= 2;
  const res = useResource(ok ? `/api/search?q=${encodeURIComponent(q)}` : null);
  const groups = (res.data && res.data.groups) || [];
  const notSearched = (res.data && res.data.notSearched) || [];
  const total = groupCount(groups);

  function submit(e) {
    e.preventDefault();
    location.hash = `#/search?q=${encodeURIComponent(text.trim())}`;
  }

  return html`
    <div class="p-search">
      <${PageHeader} title="Search" />
      <form class="p-search__form" role="search" onSubmit=${submit}>
        <${TextInput} type="search" value=${text} aria-label="Search" placeholder="Search tasks, jobs, files and records"
          maxLength=${200} onInput=${(e) => setText(e.target.value)} />
      </form>
      ${!ok ? html`<p class="p-search__hint">Type at least two letters.</p>` : null}
      ${ok && res.loading && !res.data ? html`<${Loading} lines=${4} label="Searching" />` : null}
      ${res.error ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
      ${ok && res.data && !total ? html`<${Empty} title=${`Nothing found for "${q}".`} />` : null}
      ${groups.map((g) => html`
        <${Section} key=${g.source} title=${groupLabel(g)} count=${g.results.length}>
          <ul class="p-search__list">
            ${g.results.map((r, i) => {
              const href = linkHref(r.link);
              return html`
                <li key=${i} class="p-search__item">
                  ${href ? html`<a class="p-search__title" href=${href}>${r.title}</a>` : html`<span class="p-search__title">${r.title}</span>`}
                  ${r.snippet ? html`<p class="p-search__snippet">${r.snippet}</p>` : null}
                </li>`;
            })}
          </ul>
        <//>`)}
      ${notSearched.length ? html`
        <${Notice} title="Not searched this time">
          <ul class="p-search__list">
            ${notSearched.map((n, i) => html`<li key=${i}>${n.source}: ${n.reason}</li>`)}
          </ul>
        <//>` : null}
    </div>`;
}
