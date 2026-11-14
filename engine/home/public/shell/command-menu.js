// The command menu (CONTRACTS-V2 14.2, CONTRACTS-V3 26.2): ⌘K or Ctrl+K, and "/" outside the map. A
// dialog with one field. Empty, it lists New task and Every job, the seven departments, then the pages. Typed
// text finds pages, departments, agents and jobs by name at once, then what /api/search finds (after 2
// characters, 200 ms after the last key), grouped by source. Arrows move, Enter opens, Esc closes.
// Drawn as a floating panel over a dim page (PLAN-COOK T21, T103): centred on the window, its top 18 percent
// down; the field is its head, so it has no title bar; focus stays in the field (the rows are chosen with the
// arrows) and goes back to the opener on close. Each row has its icon (a department its sidebar icon) and at its
// right a hint: what needs the owner in a department, a page's "g" keys, "Enter" on the chosen row. The list
// ends on a whole row, so no group's heading stands alone at its foot.
import { html, useEffect, useMemo, useRef, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { linkHref } from "../lib/format.js";
import { useApp } from "../lib/context.js";
import { Avatar, Icon, Kbd } from "../kit/index.js";
import { DEPARTMENTS, routeById } from "../routes.js";
import { jobsOf } from "./compose-dialog.js";
import { fitWholeRows } from "./queue.js";
import { TEAM_ICONS } from "./sidenav.js";

// The pages the menu offers, in this order.
const PAGE_IDS = ["map", "tasks", "dashboards", "files", "apps", "needs-you", "jobs", "team", "routines", "health", "settings"];
const PAGES = PAGE_IDS.map((id) => routeById(id));
const MAX_JOBS = 8;
// A page's keys: "g" then this letter (the shell's GO table in app-shell.js).
export const PAGE_KEYS = { map: "M", tasks: "T", dashboards: "D", files: "F", "needs-you": "N", jobs: "J" };

// After the browser has drawn the change (at once where there is no browser, as in the tests).
const later = (f) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(f) : f());
const norm = (s) => String(s || "").toLowerCase().trim();
const hit = (text, q) => norm(text).includes(q);
const cap = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const pageItem = (r) => ({ id: `page:${r.id}`, group: "Pages", label: r.title, icon: r.icon, href: `#/${r.id}` });
const departmentItem = (d) => ({ id: `dept:${d.id}`, group: "Departments", label: d.title, icon: TEAM_ICONS[d.id] || "map", href: `#/departments/${encodeURIComponent(d.id)}` });
const jobItem = (j) => ({
  id: `job:${j.id}`, group: "Jobs", label: cap(j.title, 120), icon: "jobs",
  hint: j.ready === false ? "Cannot start yet" : cap(j.department?.title, 40), href: linkHref({ page: "jobs", id: j.id }),
});

// The items that need no search, for the typed text. Each item:
// { id, group, label, hint?, icon?, agent?, href?, action?: "compose", text? }. `jobs` are jobs of shape job.
export function localItems(query, team = [], jobs = []) {
  const q = norm(query);
  const allJobs = (Array.isArray(jobs) ? jobs : []).filter((j) => j && typeof j.id === "string" && j.id.includes("/"));
  // Empty: what to start and the departments first; the pages last, since the capsule already shows four.
  if (!q) {
    return [
      { id: "act:compose", group: "Start", label: "New task", icon: "plus", action: "compose" },
      { id: "act:jobs", group: "Start", label: "Every job", icon: "jobs", href: "#/jobs" },
      ...DEPARTMENTS.map(departmentItem),
      ...PAGES.map(pageItem),
    ];
  }
  const pages = PAGES.filter((r) => hit(r.title, q)).map(pageItem);
  const departments = DEPARTMENTS.filter((d) => hit(d.title, q)).map(departmentItem);
  const agents = (Array.isArray(team) ? team : []).filter((a) => a && (hit(a.name, q) || hit(a.slug, q)))
    .map((a) => ({ id: `agent:${a.slug}`, group: "Team", label: cap(a.name, 60), hint: cap(a.plainState, 60), agent: a, href: `#/team/${encodeURIComponent(a.slug)}` }));
  const found = allJobs.filter((j) => hit(j.title, q) || hit(j.summary, q)).slice(0, MAX_JOBS).map(jobItem);
  const text = String(query).trim();
  return [
    ...pages,
    ...departments,
    ...agents,
    ...found,
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
      if (href) out.push({ id: `found:${g.source}:${i}`, group: g.label || g.source, label: cap(r.title, 120), hint: cap(r.snippet, 160), icon: g.source === "jobs" ? "jobs" : "file", href });
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

// The field's placeholder. The dialog's title already says "Search", so the field does not say it again;
// below 860 px a shorter one fits the phone's width.
export const PLACEHOLDER = "Pages, jobs, agents and tasks, or say what you want done";
export const PLACEHOLDER_SHORT = "Find, or say what you want done";
const narrowNow = () => typeof matchMedia === "function" && matchMedia("(max-width: 859px)").matches;

export function CommandMenu({ open, onClose, team, onCompose }) {
  const [jobs, setJobs] = useState([]);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState({ q: "", items: [], state: "idle" });
  const [active, setActive] = useState(0);
  const input = useRef(null);
  const list = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  // True while the list holds more below what shows: its bottom edge then fades.
  const [more, setMore] = useState(false);
  const measure = () => {
    const el = list.current;
    setMore(Boolean(el && el.scrollHeight - el.scrollTop - el.clientHeight > 4));
  };
  // What needs the owner in each department, from the shell's dock (the sidebar's counts).
  const { dock } = useApp();
  const needs = new Map((Array.isArray(dock) ? dock : []).map((d) => [d && d.id, Math.max(0, Math.floor(Number(d && d.needsYou) || 0))]));

  useEffect(() => {
    if (!open) return undefined;
    setQuery("");
    setFound({ q: "", items: [], state: "idle" });
    setActive(0);
    const opener = typeof document === "undefined" ? null : document.activeElement;
    later(() => input.current?.focus());
    let live = true;
    api.get("/api/jobs").then((a) => { if (live) setJobs(jobsOf(a)); }).catch(() => {});
    return () => {
      live = false;
      // Back to what opened it, unless the choice moved focus somewhere else (a new page, the compose dialog).
      later(() => {
        const a = document.activeElement;
        if (opener && opener.isConnected && opener !== document.body && (!a || a === document.body)) opener.focus();
      });
    };
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
    const local = localItems(query, team, jobs);
    if (!query.trim()) return local;
    // Pages, departments, agents and jobs first, then what the search found, then the two "Start" lines.
    const start = local.filter((i) => i.group === "Start");
    const rest = local.filter((i) => i.group !== "Start");
    return [...rest, ...(found.q === query.trim() ? found.items : []), ...start];
  }, [query, team, jobs, found]);

  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, items.length - 1))); }, [items.length]);
  // The list ends on a whole row (again when the window changes), then says whether more lies below.
  useEffect(() => {
    if (!open) return undefined;
    const fit = () => { fitWholeRows(list.current, ".s-cmd-item"); measure(); };
    fit();
    if (typeof window === "undefined") return undefined;
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [open, items, found.state]);
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
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close.current?.();
    } else if (e.key === "Tab") {
      // The field is the one stop: the rows are reached with the arrows.
      e.preventDefault();
      input.current?.focus();
    } else if (e.key === "ArrowDown") {
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

  // The right end of a row: a department's count, a page's keys, or "Enter" on the chosen row.
  const rowEnd = (it, chosen) => {
    const count = it.id.startsWith("dept:") ? needs.get(it.id.slice(5)) || 0 : 0;
    const keys = it.id.startsWith("page:") ? PAGE_KEYS[it.id.slice(5)] : null;
    if (!count && !keys && !chosen) return null;
    return html`
      <span class="s-cmd-end" aria-hidden="true">
        ${count ? html`<span class="s-cmd-count u-num">${count}</span>` : null}
        ${chosen ? html`<${Kbd}>Enter<//>` : keys ? html`<span class="s-cmd-keys"><${Kbd}>G<//><${Kbd}>${keys}<//></span>` : null}
      </span>`;
  };

  if (!open) return null;
  let n = -1;
  const groups = grouped(items);
  const q = query.trim();
  return html`
    <div class="s-cmd-layer">
      <div class="s-cmd-scrim" aria-hidden="true" onClick=${() => close.current?.()}></div>
      <div class="s-cmd" role="dialog" aria-modal="true" aria-label="Search" onKeyDown=${onKey}>
        <div class="s-cmd-field">
          <${Icon} name="search" size=${18} class="s-cmd-field-icon" />
          <input ref=${input} data-autofocus class="s-cmd-input" type="text" value=${query} autocomplete="off" spellcheck=${false}
            placeholder=${narrowNow() ? PLACEHOLDER_SHORT : PLACEHOLDER}
            role="combobox" aria-expanded="true" aria-controls="s-cmd-list" aria-label="Search"
            aria-activedescendant=${items.length ? `s-cmd-${active}` : undefined}
            onInput=${(e) => { setQuery(e.currentTarget.value); setActive(0); }} />
        </div>
        <div class=${`s-cmd-list${more ? " has-more" : ""}`} id="s-cmd-list" role="listbox" aria-label="Results" tabindex="-1" ref=${list} onScroll=${measure}>
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
                    ${rowEnd(it, i === active)}
                  </div>`;
              })}
            </div>`)}
          ${q.length >= 2 && found.state === "loading" ? html`<p class="s-cmd-note">Searching…</p>` : null}
          ${q.length >= 2 && found.state === "failed" ? html`<p class="s-cmd-note">Search is not answering right now. Pages and agents still work.</p>` : null}
          ${q.length >= 2 && found.state === "done" && found.q === q && !found.items.length ? html`<p class="s-cmd-note">Nothing else found for "${q}".</p>` : null}
        </div>
        <p class="s-cmd-help" aria-hidden="true">
          <span><${Kbd}>↑<//><${Kbd}>↓<//> to move</span><span><${Kbd}>Enter<//> to open</span><span><${Kbd}>Esc<//> to close</span>
        </p>
      </div>
    </div>`;
}
