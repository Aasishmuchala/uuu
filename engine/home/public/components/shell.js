// The frame around every page: the rail of pages (a top bar with "Menu" on a narrow window),
// the header with search, "Give a goal" and the theme switch, and the goal box when it is open.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { useApp } from "../lib/context.js";
import { go } from "../lib/router.js";
import { currentTheme, nextTheme, setTheme, THEME_WORDS } from "../lib/theme.js";

export const NAV_GROUPS = [
  { label: null, items: [{ id: "inbox", label: "Inbox" }, { id: "goals", label: "Goals" }, { id: "company", label: "Company" }] },
  {
    label: "Departments",
    items: [
      { id: "books", label: "Books" }, { id: "customers", label: "Customers" }, { id: "support", label: "Support" },
      { id: "people", label: "People" }, { id: "marketing", label: "Marketing" }, { id: "studio", label: "Studio" },
      { id: "knowledge", label: "Knowledge" },
    ],
  },
  { label: null, items: [{ id: "health", label: "Health" }] },
];

function EngineLine() {
  const { state, stateError } = useApp();
  let tone = "good";
  let text = "The engine is on";
  if (stateError) {
    tone = "bad";
    text = "The engine is not answering";
  } else if (!state) {
    return html`<p class="engine-line engine-line--wait"><span class="state-mark" aria-hidden="true"></span>Checking the engine…</p>`;
  } else if (state.engine?.board !== "on") {
    tone = "warn";
    text = "Agents are switched off";
  }
  return html`<a class=${`engine-line engine-line--${tone}`} href="#/health"><span class="state-mark" aria-hidden="true"></span>${text}</a>`;
}

function Nav({ current, onPick }) {
  const { state } = useApp();
  const inbox = state?.counts?.inbox || 0;
  return html`
    <nav class="nav" aria-label="Pages">
      ${NAV_GROUPS.map((g, gi) => html`
        <div class="nav-group" key=${gi}>
          ${g.label ? html`<p class="nav-group-label" id=${`nav-group-${gi}`}>${g.label}</p>` : null}
          <ul aria-labelledby=${g.label ? `nav-group-${gi}` : null}>
            ${g.items.map((it) => html`
              <li key=${it.id}>
                <a href=${`#/${it.id}`} class="nav-link" aria-current=${current === it.id ? "page" : null} onClick=${onPick}>
                  <span>${it.label}</span>
                  ${it.id === "inbox" && inbox > 0 ? html`<span class="count" aria-label=${`${inbox} waiting`}>${inbox}</span>` : null}
                </a>
              </li>`)}
          </ul>
        </div>`)}
    </nav>`;
}

export function Rail({ current }) {
  const { state } = useApp();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [current]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); document.getElementById("menu-button")?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const name = state?.company?.name || "Home";
  const inbox = state?.counts?.inbox || 0;
  return html`
    <div class=${`rail${open ? " rail--open" : ""}`}>
      <div class="rail-top">
        <a class="brand" href="#/inbox">
          <span class="brand-name">${name}</span>
          <span class="brand-sub">Home</span>
        </a>
        <button type="button" id="menu-button" class="btn menu-button" aria-expanded=${open ? "true" : "false"} aria-controls="rail-panel"
          onClick=${() => setOpen(!open)}>
          ${open ? "Close" : "Menu"}${!open && inbox > 0 ? html`<span class="count" aria-label=${`, ${inbox} in the inbox`}>${inbox}</span>` : null}
        </button>
      </div>
      <div class="rail-panel" id="rail-panel">
        <${Nav} current=${current} onPick=${() => setOpen(false)} />
        <${EngineLine} />
      </div>
    </div>`;
}

function ThemeSwitch() {
  const [theme, setT] = useState(currentTheme);
  const next = nextTheme(theme);
  return html`
    <button type="button" class="btn btn--quiet theme-switch" onClick=${() => { setTheme(next); setT(next); }}
      aria-label=${`Colour theme: ${THEME_WORDS[theme]}. Switch to ${THEME_WORDS[next]}.`} title=${`Switch to ${THEME_WORDS[next]}`}>
      Theme: ${THEME_WORDS[theme]}
    </button>`;
}

export function Header({ route, goalBoxOpen, onGoalBox }) {
  const onSearch = route.parts[0] === "search";
  const [q, setQ] = useState(onSearch ? route.query.get("q") || "" : "");
  const input = useRef(null);
  useEffect(() => {
    setQ(onSearch ? route.query.get("q") || "" : "");
  }, [onSearch, route.query.toString()]);

  function submit(e) {
    e.preventDefault();
    const v = q.trim();
    go(`#/search?q=${encodeURIComponent(v)}`);
  }

  return html`
    <div class="header">
      <form class="search" role="search" onSubmit=${submit}>
        <label class="visually-hidden" for="search">Search</label>
        <input id="search" ref=${input} type="search" value=${q} placeholder="Search everything"
          autocomplete="off" enterkeyhint="search" onInput=${(e) => setQ(e.currentTarget.value)} />
        <button type="submit" class="btn">Search</button>
      </form>
      <div class="header-tools">
        ${route.parts[0] !== "inbox" ? html`
          <button type="button" class="btn btn--primary" aria-expanded=${goalBoxOpen ? "true" : "false"} aria-controls="goal-box-top"
            onClick=${onGoalBox}>Give a goal</button>` : null}
        <${ThemeSwitch} />
      </div>
    </div>`;
}
