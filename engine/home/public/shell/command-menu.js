// The command menu (CONTRACTS-V2 14.2): ⌘K or Ctrl+K, and "/". A dialog with one field. Empty, it
// lists the pages, New task and Ready-made goals. Typed text finds pages and agents by name at once,
// then what /api/search finds (after 2 characters, 200 ms after the last key), grouped by source.
// Arrows move, Enter opens, Esc closes.
import { html, useEffect, useMemo, useRef, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { linkHref } from "../lib/format.js";
import { Avatar, Dialog, Icon } from "../kit/index.js";
import { ROUTES } from "../routes.js";

// The pages the menu offers, in the sidebar's order.
const PAGE_IDS = ["home", "tasks", "docs", "team", "books", "customers", "support", "people", "marketing", "studio", "routines", "gallery", "health", "settings"];
const PAGES = PAGE_IDS.map((id) => ROUTES.find((r) => r.id === id));

const norm = (s) => String(s || "").toLowerCase().trim();
const hit = (text, q) => norm(text).includes(q);

// The items that need no server, for the typed text. Each item:
// { id, group, label, hint?, icon?, agent?, href? , action?: "compose", text? }
export function localItems(query, team = []) {
  const q = norm(query);
  if (!q) {
    return [
      ...PAGES.filter((r) => r.id !== "gallery").map((r) => ({ id: `page:${r.id}`, group: "Pages", label: r.title, icon: r.icon, href: `#/${r.id}` })),
      { id: "act:compose", group: "Start", label: "New task", icon: "plus", action: "compose" },
      { id: "act:gallery", group: "Start", label: "Ready-made goals", icon: "layers", href: "#/gallery" },
    ];
  }
  const pages = PAGES.filter((r) => hit(r.title, q)).map((r) => ({ id: `page:${r.id}`, group: "Pages", label: r.title, icon: r.icon, href: `#/${r.id}` }));
  const agents = (Array.isArray(team) ? team : []).filter((a) => hit(a.name, q) || hit(a.slug, q))
    .map((a) => ({ id: `agent:${a.slug}`, group: "Team", label: a.name, hint: a.plainState || "", agent: a, href: `#/team/${encodeURIComponent(a.slug)}` }));
  const text = String(query).trim();
  return [
    ...pages,
    ...agents,
    { id: "act:compose-text", group: "Start", label: `New task: ${text}`, icon: "plus", action: "compose", text },
    { id: "act:search", group: "Start", label: `Search everything for "${text}"`, icon: "search", href: `#/search?q=${encodeURIComponent(text)}` },
  ];
}

// The /api/search answer as menu items, one group per source.
export function searchItems(answer) {
  const out = [];
  for (const g of Array.isArray(answer?.groups) ? answer.groups : []) {
    (Array.isArray(g.results) ? g.results : []).forEach((r, i) => {
      const href = linkHref(r.link);
      if (href) out.push({ id: `found:${g.source}:${i}`, group: g.label || g.source, label: r.title, hint: r.snippet || "", icon: "file", href });
    });
  }
  return out;
}

// Groups in order of first appearance: [{ group, items }].
export function grouped(items) {
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.group)) map.set(it.group, []);
    map.get(it.group).push(it);
  }
  return [...map].map(([group, list]) => ({ group, items: list }));
}

export function CommandMenu({ open, onClose, team, onCompose }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState({ q: "", items: [], state: "idle" });
  const [active, setActive] = useState(0);
  const input = useRef(null);
  const list = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setFound({ q: "", items: [], state: "idle" });
    setActive(0);
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  // Ask the server 200 ms after the last key, once there are 2 characters.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setFound({ q: "", items: [], state: "idle" });
      return undefined;
    }
    let live = true;
    const t = setTimeout(() => {
      setFound((f) => ({ ...f, state: "loading" }));
      api.get(`/api/search?q=${encodeURIComponent(q)}`)
        .then((a) => { if (live) setFound({ q, items: searchItems(a), state: "done" }); })
        .catch(() => { if (live) setFound({ q, items: [], state: "failed" }); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [query, open]);

  const items = useMemo(() => {
    const local = localItems(query, team);
    if (!query.trim()) return local;
    // Pages and agents first, then what the search found, then the two "Start" lines.
    const start = local.filter((i) => i.group === "Start");
    const rest = local.filter((i) => i.group !== "Start");
    return [...rest, ...(found.q === query.trim() ? found.items : []), ...start];
  }, [query, team, found]);

  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, items.length - 1))); }, [items.length]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const choose = (it) => {
    if (!it) return;
    onClose();
    if (it.action === "compose") onCompose(it.text ? { text: it.text } : {});
    else if (it.href) location.hash = it.href;
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (items.length ? (a + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(items[active]);
    }
  };

  let n = -1;
  const groups = grouped(items);
  const q = query.trim();
  return html`
    <${Dialog} open=${open} title="Search" onClose=${onClose} size="md">
      <div class="s-cmd">
        <div class="s-cmd-field">
          <${Icon} name="search" />
          <input ref=${input} data-autofocus class="s-cmd-input" type="text" value=${query} autocomplete="off" spellcheck=${false}
            placeholder="Search pages, agents and tasks, or say what you want done"
            role="combobox" aria-expanded="true" aria-controls="s-cmd-list" aria-label="Search"
            aria-activedescendant=${items.length ? `s-cmd-${active}` : undefined}
            onInput=${(e) => { setQuery(e.currentTarget.value); setActive(0); }} onKeyDown=${onKey} />
        </div>
        <div class="s-cmd-list" id="s-cmd-list" role="listbox" aria-label="Results" ref=${list}>
          ${groups.map((g) => html`
            <div class="s-cmd-group" role="group" aria-label=${g.group}>
              <p class="s-cmd-group-title" aria-hidden="true">${g.group}</p>
              ${g.items.map((it) => {
                n += 1;
                const i = n;
                return html`
                  <div id=${`s-cmd-${i}`} data-index=${i} role="option" aria-selected=${i === active ? "true" : "false"}
                    class=${`s-cmd-item${i === active ? " is-active" : ""}`}
                    onMouseMove=${() => { if (i !== active) setActive(i); }} onClick=${() => choose(it)}>
                    ${it.agent ? html`<${Avatar} slug=${it.agent.slug} name=${it.agent.name} size=${20} />` : html`<${Icon} name=${it.icon || "chevron-right"} />`}
                    <span class="s-cmd-label u-truncate">${it.label}</span>
                    ${it.hint ? html`<span class="s-cmd-hint u-truncate">${it.hint}</span>` : null}
                  </div>`;
              })}
            </div>`)}
          ${q.length >= 2 && found.state === "loading" ? html`<p class="s-cmd-note">Searching…</p>` : null}
          ${q.length >= 2 && found.state === "failed" ? html`<p class="s-cmd-note">Search is not answering right now. Pages and agents still work.</p>` : null}
          ${q.length >= 2 && found.state === "done" && found.q === q && !found.items.length ? html`<p class="s-cmd-note">Nothing else found for "${q}".</p>` : null}
        </div>
        <p class="s-cmd-help u-caption" aria-hidden="true">↑ ↓ to move · Enter to open · Esc to close</p>
      </div>
    <//>`;
}
