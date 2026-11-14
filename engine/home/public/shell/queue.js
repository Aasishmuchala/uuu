// The queue (PLAN-COOK T21, CONTRACTS-V3 26.2): what needs the owner, as a panel that floats under the top bar
// at the page column's left edge, opened by the Queue button, the key "q" and openQueue({ department }) from
// any page. Not modal: the page stays usable beside it. The items in four groups (to approve, to answer, to
// accept, to know), each row opening the item's own page; then the not-connected lines and a link to the
// whole list. It reads GET /api/inbox when it opens and again each time the shell refreshes while open.
// Focus goes to the first row; Up and Down move, Enter follows; Esc, a click outside and a second "q" close it
// and give focus back to the Queue button; a page change closes it. Below 860 px it is not drawn: the Needs
// you tab opens the page.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { fullWhen } from "../lib/format.js";
import { needsFor, needsTitle, queueGroups, queueHref, rowTime, sortNeeds } from "../lib/queue.js";
import { ErrorNotice, Icon, Kbd, Loading, StateIcon } from "../kit/index.js";

// The shell's tests read the helpers from here, with the panel.
export { SOURCE_DEPARTMENT, needsFor, needsTitle, queueGroups, queueHref, rowTime, sortNeeds } from "../lib/queue.js";

// A row's icon by its kind. "done" is the board's Done mark (a ring with a tick), drawn by StateIcon.
export const KIND_ICON = { shotlist: "video", pick: "layers", approval: "check", question: "reply", result: "done" };
const iconOf = (kind) => KIND_ICON[kind] || "alert";
const KindIcon = ({ kind }) => (iconOf(kind) === "done" ? html`<${StateIcon} column="done" label="" />` : html`<${Icon} name=${iconOf(kind)} />`);

const SOURCE_WORDS = { board: "The board", books: "The books", customers: "Customers", support: "Support", people: "People", marketing: "Marketing", studio: "Studio", goal: "Tasks" };

const cap = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
// After the browser has drawn the change (at once where there is no browser, as in the tests).
const later = (f) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(f) : f());
const hashNow = () => (typeof location === "undefined" ? "" : location.hash);
const rowsIn = (el) => (el && el.querySelectorAll ? [...el.querySelectorAll(".s-queue-row")] : []);

// `here` is the address being shown ("#/..."); its row is marked current.
export function QueuePanel({ open, narrow, department, stamp, here, onClose }) {
  const [s, setS] = useState({ data: null, error: null });
  const [map, setMap] = useState(null);
  const seq = useRef(0);
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const shown = open && !narrow;

  const load = (quiet) => {
    const n = ++seq.current;
    if (!quiet) setS((p) => ({ data: p.data, error: null }));
    api.get("/api/inbox")
      .then((data) => { if (n === seq.current) setS({ data, error: null }); })
      .catch((error) => {
        if (n !== seq.current) return;
        setS((p) => (quiet && p.data ? p : { data: null, error }));
      });
  };

  useEffect(() => {
    if (shown) load(false);
  }, [shown]);

  // Refresh with the shell, quietly, while open.
  useEffect(() => {
    if (shown && s.data) load(true);
  }, [stamp]);

  // For one department, its agents come from /api/map; without it the items are matched by source alone.
  useEffect(() => {
    if (!shown || !department || map) return undefined;
    let live = true;
    api.get("/api/map").then((m) => { if (live) setMap(Array.isArray(m?.departments) ? m.departments : []); }).catch(() => { if (live) setMap([]); });
    return () => { live = false; };
  }, [shown, department]);

  // Open: focus the panel at once, and the first row as soon as there is one. Closed by Esc, "q" or a click
  // on nothing: focus goes back to the Queue button. Closed by a page change or a click on something that
  // takes focus: focus stays where that put it.
  useEffect(() => {
    if (!shown) return undefined;
    const from = hashNow();
    const panel = ref.current;
    const first = rowsIn(panel)[0];
    (first || panel)?.focus?.();
    const outside = (e) => {
      const btn = document.querySelector?.(".s-queue-btn");
      if (ref.current?.contains(e.target) || btn?.contains(e.target)) return;
      close.current?.();
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      later(() => {
        const a = document.activeElement;
        if (hashNow() !== from || (a && a !== document.body && a.isConnected)) return;
        document.querySelector?.(".s-queue-btn")?.focus();
      });
    };
  }, [shown]);

  const items = needsFor(sortNeeds(s.data?.items), department, map);
  const ready = !!s.data;
  useEffect(() => {
    if (!shown || !ready) return;
    const panel = ref.current;
    if (document.activeElement === panel) rowsIn(panel)[0]?.focus();
  }, [shown, ready]);

  if (!shown) return null;

  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close.current?.();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = rowsIn(ref.current);
    if (!rows.length) return;
    e.preventDefault();
    const at = rows.indexOf(document.activeElement);
    const next = at < 0 ? (e.key === "ArrowDown" ? 0 : rows.length - 1)
      : Math.min(rows.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)));
    rows[next].focus();
  };

  const groups = queueGroups(items);
  const notConnected = (Array.isArray(s.data?.notConnected) ? s.data.notConnected : []).slice(0, 10);
  const full = department ? `#/needs-you?d=${encodeURIComponent(department)}` : "#/needs-you";
  const title = needsTitle(department, map);

  let body;
  if (s.error && !s.data) body = html`<div class="s-queue-state"><${ErrorNotice} error=${s.error} onRetry=${() => load(false)} /></div>`;
  else if (!s.data) body = html`<div class="s-queue-state"><${Loading} lines=${3} label="Loading what needs you" /></div>`;
  else if (!items.length) body = html`<p class="s-queue-empty">Nothing needs you.</p>`;
  else {
    body = groups.map((g) => html`
      <section key=${g.id} class="s-queue-group" aria-label=${g.heading}>
        <h3 class="s-queue-group-title" aria-hidden="true">${g.heading}</h3>
        ${g.items.map((item) => {
          const href = queueHref(item);
          const at = rowTime(item.when);
          return html`
            <a key=${item.id} class="s-queue-row" href=${href} aria-current=${href === here ? "true" : undefined}
              onClick=${() => close.current?.()}>
              <span class="s-queue-icon"><${KindIcon} kind=${item.kind} /></span>
              <span class="s-queue-title">${cap(item.title, 120)}</span>
              ${at ? html`<time class="s-queue-when" datetime=${item.when} title=${fullWhen(item.when)}>${at}</time>` : null}
              ${item.summary ? html`<span class="s-queue-line">${cap(item.summary, 200)}</span>` : null}
            </a>`;
        })}
      </section>`);
  }

  return html`
    <div class="s-queue" role="dialog" aria-modal="false" aria-label=${title} tabindex="-1" ref=${ref} onKeyDown=${onKey}>
      <p class="s-queue-head">
        <span class="s-queue-name">${title}</span>
        ${ready ? html`<span class="s-queue-count u-num">${items.length}</span>` : null}
        <${Kbd}>Q<//>
      </p>
      ${body}
      ${notConnected.length ? html`
        <ul class="s-queue-quiet">
          ${notConnected.map((n, i) => html`
            <li key=${i}><span class="s-queue-source">${SOURCE_WORDS[n && n.source] || "A part"}:</span> ${cap(n && n.reason, 200)}</li>`)}
        </ul>` : null}
      <a class="s-queue-full" href=${full} onClick=${() => close.current?.()}>Open the whole list</a>
    </div>`;
}
