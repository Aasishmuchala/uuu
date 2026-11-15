// The queue (PLAN-COOK T21, T103, T111, R5-B, CONTRACTS-V3 26.2): what needs the owner, as a panel at the window's
// right under the top bar (the kit's Drawer: 420 px, the window's height, on the overlay surface with its edge at
// the left, over the standard dim), opened by the Queue button, the key "q" and openQueue({ department }) from any
// page. The items in four groups (to approve, to answer, to accept, to know), each showing as many of its first rows
// as the panel has room for (so no band stands empty above the foot) and then one line "and 8 more" in the accent
// ink to the whole list; a row is one line, the title cut with an ellipsis (its whole words on hover) and the date
// at its right (the grey line only on the current row), each row opening the item's own page; then the
// not-connected lines; the list scrolls inside, ends on a whole row, over the foot's row to the whole list. It reads GET /api/inbox when it
// opens and again each time the shell refreshes while open. Focus goes to the first row; Up and Down move (the
// "more" lines and the foot too), Enter follows, Tab stays inside; Esc, a click on the dim or outside, Close and a
// second "q" close it and give focus back to the Queue button; a page change closes it. Below 860 px it is not
// drawn: the Needs you tab opens the page.
import { html, useEffect, useLayoutEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { fullWhen } from "../lib/format.js";
import { needsFor, needsTitle, queueGroups, queueHref, rowTime, sortNeeds } from "../lib/queue.js";
import { Drawer, ErrorNotice, Icon, Loading, StateIcon } from "../kit/index.js";

// The shell's tests read the helpers from here, with the panel.
export { SOURCE_DEPARTMENT, needsFor, needsTitle, queueGroups, queueHref, rowTime, sortNeeds } from "../lib/queue.js";

// A row's icon by its kind. "done" is the board's Done mark (a ring with a tick), drawn by StateIcon.
export const KIND_ICON = { shotlist: "video", pick: "layers", approval: "check", question: "reply", result: "done", draft: "file" };
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
const stopsIn = (el) => (el && el.querySelectorAll ? [...el.querySelectorAll(".s-queue-row, .s-queue-more, .s-queue-full")] : []);

// How many rows a group shows before its "and N more" line where there is no layout to measure (the tests, the
// first frame).
export const GROUP_ROWS = 3;
export const moreWords = (n) => `and ${n} more`;

// How many rows each group shows so the groups fill `room` px and no more: every group at least one row, then a row
// more to each in turn while it fits; a group shown whole drops its "and N more" line. `sizes` are the groups'
// lengths; `row` and `more` the heights of a row and of the "more" line. Without a room it is GROUP_ROWS a group.
export function fitGroups(sizes, room, { row, more } = {}) {
  const n = Array.isArray(sizes) ? sizes.map((x) => Math.max(0, Math.floor(Number(x) || 0))) : [];
  if (!(room > 0) || !(row > 0) || !(more >= 0)) return n.map((x) => Math.min(x, GROUP_ROWS));
  const counts = n.map((x) => Math.min(x, 1));
  const cost = (c) => c.reduce((t, k, i) => t + k * row + (k < n[i] ? more : 0), 0);
  for (let grew = true; grew;) {
    grew = false;
    for (let i = 0; i < n.length; i++) {
      if (counts[i] >= n[i]) continue;
      counts[i] += 1;
      if (cost(counts) <= room + 0.5) grew = true;
      else counts[i] -= 1;
    }
  }
  return counts;
}

// A scrolling list's height cut back to the foot of the last row that shows whole (its CSS max-height is the
// room it has), so it never ends on part of a row or on a heading with no row under it: the cut lands on a row's
// own edge, and nothing of the next row shows in the padding. Nothing to do when all of it fits, or where there
// is no layout (the tests).
export function fitWholeRows(el, selector) {
  if (!el || !el.style || typeof el.getBoundingClientRect !== "function") return;
  el.style.height = "";
  const room = el.clientHeight;
  if (!room || el.scrollHeight <= room + 1) return;
  const top = el.getBoundingClientRect().top - el.scrollTop;
  let end = 0;
  for (const row of el.querySelectorAll(selector)) {
    const foot = row.getBoundingClientRect().bottom - top;
    if (foot <= room + 0.5) end = Math.max(end, foot);
  }
  if (end > 0) el.style.height = `${Math.floor(end)}px`;
}

// `here` is the address being shown ("#/..."); its row is marked current.
export function QueuePanel({ open, narrow, department, stamp, here, onClose }) {
  const [s, setS] = useState({ data: null, error: null });
  const [map, setMap] = useState(null);
  const seq = useRef(0);
  const ref = useRef(null);
  const scroller = useRef(null);
  const opener = useRef(null);
  const [per, setPer] = useState(null);
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

  // Where the keyboard was when the panel opened, taken before the Drawer moves it in (the Drawer gives it back
  // there when it goes).
  useLayoutEffect(() => {
    if (shown && typeof document !== "undefined") opener.current = document.activeElement;
  }, [shown]);

  // Open: focus the panel at once, and the first row as soon as there is one. Closed by Esc, the dim, Close, "q"
  // or a click on nothing: focus goes back to the Queue button. Closed by a page change or a click on something
  // that takes focus: focus stays where that put it.
  useEffect(() => {
    if (!shown) return undefined;
    const from = hashNow();
    const panel = ref.current;
    const first = rowsIn(panel)[0];
    (first || panel)?.focus?.();
    const outside = (e) => {
      const btn = document.querySelector?.(".s-queue-btn");
      const drawer = panel?.closest?.(".k-drawer__panel");
      if ((drawer || panel)?.contains(e.target) || btn?.contains(e.target)) return;
      close.current?.();
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      later(() => {
        const a = document.activeElement;
        if (hashNow() !== from || (a && a !== document.body && a !== opener.current && a.isConnected)) return;
        document.querySelector?.(".s-queue-btn")?.focus();
      });
    };
  }, [shown]);

  const items = needsFor(sortNeeds(s.data?.items), department, map);
  const ready = !!s.data;
  const groups = queueGroups(items);
  const sizes = groups.map((g) => g.items.length);
  const shownOf = (i) => (per && per.length === sizes.length ? per[i] : Math.min(sizes[i], GROUP_ROWS));

  // As many rows a group as the panel has room for: measured from what is drawn (a one-line row, a "more" line,
  // the room above the foot less what is not a row), then drawn again only if the counts change.
  useEffect(() => {
    if (!shown || !ready) return undefined;
    const measure = () => {
      const wrap = ref.current;
      const body = scroller.current;
      const foot = wrap?.querySelector?.(".s-queue-full");
      if (!wrap || !body || !foot || typeof body.getBoundingClientRect !== "function") return;
      const rows = rowsIn(body);
      const mores = [...body.querySelectorAll(".s-queue-more")];
      if (!rows.length) return;
      const heights = rows.map((r) => r.getBoundingClientRect().height);
      const row = Math.min(...heights);
      const more = mores.length ? mores[0].getBoundingClientRect().height : 28;
      const drawn = heights.reduce((t, h) => t + h, 0) + mores.reduce((t, m) => t + m.getBoundingClientRect().height, 0);
      const room = wrap.clientHeight - foot.getBoundingClientRect().height - (body.scrollHeight - drawn) - (heights.reduce((t, h) => t + h - row, 0));
      const next = fitGroups(sizes, room, { row, more });
      const now = sizes.map((_, i) => shownOf(i));
      if (next.some((k, i) => k !== now[i])) setPer(next);
    };
    measure();
    if (typeof window === "undefined") return undefined;
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [shown, s.data, department, map, per]);

  // The list ends on a whole row above the foot.
  useEffect(() => {
    if (!shown) return undefined;
    const fit = () => fitWholeRows(scroller.current, ".s-queue-row, .s-queue-more, .s-queue-quiet li");
    fit();
    if (typeof window === "undefined") return undefined;
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [shown, s.data, s.error, department, map, per]);
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
    const rows = stopsIn(ref.current);
    if (!rows.length) return;
    e.preventDefault();
    const at = rows.indexOf(document.activeElement);
    const next = at < 0 ? (e.key === "ArrowDown" ? 0 : rows.length - 1)
      : Math.min(rows.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)));
    rows[next].focus();
  };

  const notConnected = (Array.isArray(s.data?.notConnected) ? s.data.notConnected : []).slice(0, 10);
  const full = department ? `#/needs-you?d=${encodeURIComponent(department)}` : "#/needs-you";
  const title = needsTitle(department, map);

  let body;
  if (s.error && !s.data) body = html`<div class="s-queue-state"><${ErrorNotice} error=${s.error} onRetry=${() => load(false)} /></div>`;
  else if (!s.data) body = html`<div class="s-queue-state"><${Loading} lines=${3} label="Loading what needs you" /></div>`;
  else if (!items.length) body = html`<p class="s-queue-empty">Nothing needs you.</p>`;
  else {
    body = groups.map((g, gi) => html`
      <section key=${g.id} class="s-queue-group" aria-label=${g.heading}>
        <h3 class="s-queue-group-title" aria-hidden="true">${g.heading}</h3>
        ${g.items.slice(0, shownOf(gi)).map((item) => {
          const href = queueHref(item);
          const time = rowTime(item.when);
          const current = href === here;
          return html`
            <a key=${item.id} class="s-queue-row" href=${href} aria-current=${current ? "true" : undefined}
              title=${cap(item.title, 120)} onClick=${() => close.current?.()}>
              <span class="s-queue-icon"><${KindIcon} kind=${item.kind} /></span>
              <span class="s-queue-title">${cap(item.title, 120)}</span>
              ${time ? html`<time class="s-queue-when" datetime=${item.when} title=${fullWhen(item.when)}>${time}</time>` : null}
              ${current && item.summary ? html`<span class="s-queue-line">${cap(item.summary, 200)}</span>` : null}
            </a>`;
        })}
        ${g.items.length > shownOf(gi) ? html`
          <a class="s-queue-more" href=${full} onClick=${() => close.current?.()}>${moreWords(g.items.length - shownOf(gi))}</a>` : null}
      </section>`);
  }

  const head = html`<span class="s-queue-name">${title}</span>${ready ? html` <span class="s-queue-count u-num">${items.length}</span>` : null}`;
  return html`
    <${Drawer} open=${true} side="right" title=${head} onClose=${() => close.current?.()}>
      <div class="s-queue" tabindex="-1" ref=${ref} onKeyDown=${onKey}>
        <div class="s-queue-body" ref=${scroller}>
          ${body}
          ${notConnected.length ? html`
            <ul class="s-queue-quiet">
              ${notConnected.map((n, i) => html`
                <li key=${i}><span class="s-queue-source">${SOURCE_WORDS[n && n.source] || "A part"}:</span> ${cap(n && n.reason, 200)}</li>`)}
            </ul>` : null}
        </div>
        <a class="s-queue-full" href=${full} onClick=${() => close.current?.()}><span>Open the whole list</span><${Icon} name="arrow-right" /></a>
      </div>
    <//>`;
}
