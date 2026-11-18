// The Brain view of Files (PLAN-BRAIN T13, B10): what the brain's index holds, a search over your files and the
// books at once, each passage found as a card, and the names in the question as chips that open the link view
// (brain/links-view.js). The address keeps the state: #/files?tab=brain&ask=<words>&entity=<key>.
// Every string from the server is put in as text (Preact sets text nodes), never as HTML or Markdown.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { go } from "../lib/router.js";
import { count, fullWhen, linkHref } from "../lib/format.js";
import { Button, Empty, ErrorNotice, Icon, Loading, TextInput } from "../kit/index.js";
import { LinksView } from "./links-view.js";

const EVERY = 10000;
const ASK_MIN = 2;
const ASK_MAX = 200;
const KEY_MAX = 200;
const TITLE_MAX = 120;
const PLACE_MAX = 160;
const TEXT_MAX = 900;
const SOURCE_MAX = 200;
const NAMES_SHOWN = 5;

const str = (v) => (typeof v === "string" ? v : "");
const arr = (v) => (Array.isArray(v) ? v : []);
const cut = (v, n) => str(v).slice(0, n);
const num = (v) => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

// The words of this view, pinned by test/pages/brain-find.test.mjs.
export const BRAIN_WORDS = {
  tab: "Brain",
  title: "Brain",
  lead: "Find what your files and the books say, and what is linked to what.",
  first: "The brain is being read for the first time.",
  booksOff: "The books were not answering, so only your files are searchable.",
  refresh: "Refresh",
  refreshed: "The brain is being read again.",
  ask: "Search the brain",
  placeholder: "A few words, such as a customer's name",
  search: "Search",
  tooShort: "Type at least two letters.",
  nothing: "Nothing in the brain matches this.",
  names: "See what is linked to",
  restart: "This page appears after the home screen is restarted.",
  searching: "Searching the brain",
};

// The words for a record's doctype in a source line.
const DOCTYPE_WORDS = {
  Customer: "Customer", "Sales Invoice": "Invoice", "CRM Deal": "Deal", Project: "Project",
  "HD Ticket": "Support request", Contact: "Contact", Employee: "Staff",
};

// The kind of an entity in words.
export const KIND_WORDS = {
  customer: "Customer", person: "Person", deal: "Deal", invoice: "Invoice", project: "Project", ticket: "Support request",
};

// A query from the address or the box: one line, trimmed, at most 200 characters; "" when it is not one.
export function cleanAsk(v) {
  return cut(str(v).replace(/[\u0000-\u001f\u007f]+/g, " ").trim(), ASK_MAX).trim();
}

// An entity key from the address: at most 200 characters, no control characters; "" otherwise.
export function cleanKey(v) {
  const s = str(v);
  return s && s.length <= KEY_MAX && !/[\u0000-\u001f\u007f]/.test(s) ? s : "";
}

// The address of a state of this view.
export function brainHref({ ask, entity } = {}) {
  const qs = new URLSearchParams();
  qs.set("tab", "brain");
  const a = cleanAsk(ask);
  if (a) qs.set("ask", a);
  const k = cleanKey(entity);
  if (k) qs.set("entity", k);
  return `#/files?${qs.toString()}`;
}

// How long ago the index was built, in words: "just now", "5 minutes ago", "2 hours ago", "yesterday", "4 days ago".
// "" when the time cannot be read.
export function updatedAgo(iso, now = new Date()) {
  const t = Date.parse(str(iso));
  if (!Number.isFinite(t)) return "";
  const min = Math.floor((now.getTime() - t) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return min === 1 ? "1 minute ago" : `${min} minutes ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? "1 hour ago" : `${h} hours ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

// The status of the index as sentences, from GET /api/brain/index.
export function statusLines(index, now = new Date()) {
  const ix = index && typeof index === "object" ? index : {};
  if (!str(ix.builtAt)) return [BRAIN_WORDS.first];
  const files = count(num(ix.files), "file");
  const what = ix.books === "ok" ? `${files} and ${count(num(ix.records), "record")} from the books` : files;
  const ago = updatedAgo(ix.builtAt, now);
  const lines = [`Searchable: ${what}.${ago ? ` Updated ${ago}.` : ""}`];
  if (ix.books === "off") lines.push(BRAIN_WORDS.booksOff);
  const long = arr(ix.truncated).filter((p) => typeof p === "string" && p).map((p) => cut(p, SOURCE_MAX));
  if (long.length) {
    const shown = long.slice(0, NAMES_SHOWN).join(", ");
    const more = long.length > NAMES_SHOWN ? `, and ${long.length - NAMES_SHOWN} more` : "";
    lines.push(`Some files are long; only their first part is searchable: ${shown}${more}.`);
  }
  return lines;
}

// Where a passage comes from, in words: "From your files: pricing/services.md" or
// "From the books: Invoice ACC-SINV-2026-00003".
export function sourceLine(r) {
  const source = cut(r && r.source, SOURCE_MAX);
  const m = /^books:([^:]+):(.+)$/s.exec(source);
  if (m) return `From the books: ${DOCTYPE_WORDS[m[1]] || m[1]} ${m[2]}`;
  return `From your files: ${source}`;
}

// "Not found in the brain: warranty." or "" when every word was found.
export function notFoundLine(list) {
  const words = arr(list).filter((w) => typeof w === "string" && w).map((w) => cut(w, 60));
  return words.length ? `Not found in the brain: ${words.join(", ")}.` : "";
}

// True for a 404 that means the home screen runs without these routes yet (not the brain saying "not there").
export const needsRestart = (error) => Boolean(error) && error.status === 404 && error.code !== "entity_not_found";

// True while the brain switch is off: every route of this view answers `brain_off` with one sentence.
export const isOff = (error) => Boolean(error) && error.code === "brain_off";

// The server's sentence for the switch off, shown as sent: plain text, not an error with a retry.
export function OffLine({ error }) {
  return html`<p class="p-brain-find__line p-brain-find__off" role="status">${cut(error && error.message, 300)}</p>`;
}

// ---------------------------------------------------------------------------------------------------------------
// One passage, as a card: its title, its place in the file, the text as written, and where it comes from.

export function PassageCard({ r }) {
  const title = cut(r && r.title, TITLE_MAX);
  const place = cut(r && r.locator, PLACE_MAX);
  const text = cut(r && r.text, TEXT_MAX);
  const href = linkHref(r && r.link);
  const line = sourceLine(r);
  return html`<article class="p-brain-find__card">
    ${title ? html`<h3 class="p-brain-find__card-title">${title}</h3>` : null}
    ${place ? html`<p class="p-brain-find__place">${place}</p>` : null}
    ${text ? html`<p class="p-brain-find__text">${text}</p>` : null}
    <p class="p-brain-find__source">
      ${href
        ? html`<a class="p-brain-find__source-link" href=${href}>${line}</a>`
        : html`<span>${line}</span>`}
    </p>
  </article>`;
}

export function PassageList({ items }) {
  const list = arr(items).filter((r) => r && typeof r === "object");
  return html`<ol class="p-brain-find__results">
    ${list.map((r, i) => html`<li key=${`${str(r.source)}#${i}`} class="p-brain-find__result"><${PassageCard} r=${r} /></li>`)}
  </ol>`;
}

// ---------------------------------------------------------------------------------------------------------------
// The status line and Refresh

function Status({ res }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = async () => {
    setBusy(true);
    setMessage("");
    try {
      await api.post("/api/brain/index/refresh", {});
      setMessage(BRAIN_WORDS.refreshed);
      res.refresh();
    } catch (e) {
      setMessage(needsRestart(e) ? BRAIN_WORDS.restart : cut(e && e.message, 300) || "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const lines = res.data ? statusLines(res.data) : [];
  const at = res.data && str(res.data.builtAt);
  return html`<div class="p-brain-find__status">
    <div class="p-brain-find__status-words" title=${at ? fullWhen(at) : undefined}>
      ${res.loading && !res.data
        ? html`<p class="p-brain-find__line">Reading what the brain holds.</p>`
        : res.error && !res.data
        ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`
        : lines.map((l, i) => html`<p key=${i} class="p-brain-find__line">${l}</p>`)}
    </div>
    <${Button} size="sm" variant="ghost" icon="loop" busy=${busy || Boolean(res.data && res.data.building)} onClick=${refresh}>${BRAIN_WORDS.refresh}<//>
    ${message ? html`<p class="p-brain-find__message" role="status">${message}</p>` : null}
  </div>`;
}

// ---------------------------------------------------------------------------------------------------------------
// The answer to one search

function Answer({ ask, onOpen }) {
  const res = useResource(`/api/brain/find?q=${encodeURIComponent(ask)}`);
  if (res.loading && !res.data) return html`<${Loading} lines=${3} label=${BRAIN_WORDS.searching} />`;
  if (res.error) {
    if (isOff(res.error)) return html`<${OffLine} error=${res.error} />`;
    return needsRestart(res.error)
      ? html`<${Empty} inline title=${BRAIN_WORDS.restart} />`
      : html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
  }
  const d = res.data || {};
  const results = arr(d.results).filter((r) => r && typeof r === "object");
  const entities = arr(d.entities).filter((e) => e && cleanKey(e.key));
  const missing = notFoundLine(d.notFound);
  return html`<div class="p-brain-find__answer">
    ${entities.length
      ? html`<div class="p-brain-find__names" role="group" aria-label=${BRAIN_WORDS.names}>
          <span class="p-brain-find__names-label">${BRAIN_WORDS.names}</span>
          ${entities.map((e) => html`<${Button} key=${e.key} size="sm" variant="ghost" class="p-brain-find__chip"
              aria-label=${`${cut(e.name, 80)}, ${KIND_WORDS[e.type] || "Record"}: see what is linked`}
              onClick=${() => onOpen(e.key)}>${cut(e.name, 80)}<//>`)}
        </div>`
      : null}
    ${results.length ? html`<${PassageList} items=${results} />` : null}
    ${missing ? html`<p class="p-brain-find__missing">${missing}</p>` : null}
    ${results.length ? null : html`<p class="p-brain-find__empty">${BRAIN_WORDS.nothing}</p>`}
  </div>`;
}

// ---------------------------------------------------------------------------------------------------------------
// The view: the status, then the search and its answer, or one entity's links.
// `navigate` keeps the address in step (the router's `go`); the view also keeps its own state, so it answers at once.

export function BrainView({ ask, entity, navigate = go }) {
  const status = useResource("/api/brain/index", { every: EVERY });
  const [view, setView] = useState({ ask: cleanAsk(ask), entity: cleanKey(entity) });
  const [q, setQ] = useState(cleanAsk(ask));
  const [hint, setHint] = useState("");
  useEffect(() => {
    setView({ ask: cleanAsk(ask), entity: cleanKey(entity) });
    setQ(cleanAsk(ask));
  }, [ask, entity]);

  const move = (next) => {
    setView(next);
    try { navigate(brainHref(next)); } catch { /* the view still shows it */ }
  };
  const submit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const words = cleanAsk(q);
    if (words.length < ASK_MIN) { setHint(BRAIN_WORDS.tooShort); return; }
    setHint("");
    move({ ask: words, entity: "" });
  };

  // The switch off: the server's sentence and nothing else (no search, no Refresh).
  if (isOff(status.error)) return html`<div class="p-brain-find"><${OffLine} error=${status.error} /></div>`;
  if (needsRestart(status.error) && !status.data) {
    return html`<div class="p-brain-find"><${Empty} inline title=${BRAIN_WORDS.restart} /></div>`;
  }
  return html`<div class="p-brain-find">
    <${Status} res=${status} />
    ${view.entity
      ? html`<${LinksView} key=${view.entity} entityKey=${view.entity}
          onOpen=${(key) => move({ ask: view.ask, entity: key })}
          onBack=${() => move({ ask: view.ask, entity: "" })} backLabel=${view.ask ? "Back to the search" : "Back"} />`
      : html`
        <form class="p-brain-find__form" role="search" onSubmit=${submit}>
          <label class="p-brain-find__box">
            <${Icon} name="search" size=${16} />
            <${TextInput} type="search" value=${q} maxLength=${ASK_MAX} placeholder=${BRAIN_WORDS.placeholder}
              aria-label=${BRAIN_WORDS.ask} onInput=${(e) => setQ(e.currentTarget.value)} />
          </label>
          <${Button} type="submit" size="sm" variant="primary">${BRAIN_WORDS.search}<//>
        </form>
        ${hint ? html`<p class="p-brain-find__hint" role="status">${hint}</p>` : null}
        ${view.ask ? html`<${Answer} key=${view.ask} ask=${view.ask} onOpen=${(key) => move({ ask: view.ask, entity: key })} />` : null}`}
  </div>`;
}

export default BrainView;
