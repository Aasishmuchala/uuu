// The Needs you drawer (CONTRACTS-V3 26.2): opened from the pill in the top bar, from anywhere, and by
// pages through openNeeds({ department }). A drawer on the right holding the approval card of every item
// (compact), urgent first and then newest, with the not-connected lines under them and a link to the
// full list. It reads GET /api/inbox when it opens and again each time the shell refreshes.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { DecisionCard, Drawer, ErrorNotice, Loading } from "../kit/index.js";
import { DEPARTMENTS } from "../routes.js";

// Which department a Needs-you item's source belongs to (CONTRACTS-V3 26.4).
export const SOURCE_DEPARTMENT = { books: "books", people: "people", support: "support", marketing: "marketing", customers: "sales" };

const SOURCE_WORDS = { board: "The board", books: "The books", customers: "Customers", support: "Support", people: "People", marketing: "Marketing", studio: "Studio", goal: "Tasks" };

const cap = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const timeOf = (iso) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

// Urgent first, then newest first; items of the same rank keep their order.
export function sortNeeds(items) {
  const list = (Array.isArray(items) ? items : []).filter((i) => i && typeof i === "object" && i.id);
  return list
    .map((item, n) => ({ item, n, urgent: item.severity === "high" ? 0 : 1, at: timeOf(item.when) }))
    .sort((a, b) => a.urgent - b.urgent || b.at - a.at || a.n - b.n)
    .map((x) => x.item);
}

// The items of one department: those raised by one of its agents (`agent.slug`) or whose source is its
// dashboard. `departments` is /api/map's list ({ id, agents: [{ slug }] }), when it could be read.
export function needsFor(items, department, departments) {
  const list = Array.isArray(items) ? items : [];
  if (!department) return list;
  const dep = (Array.isArray(departments) ? departments : []).find((d) => d && d.id === department);
  const slugs = new Set((Array.isArray(dep?.agents) ? dep.agents : []).map((a) => (a && typeof a === "object" ? a.slug : a)).filter(Boolean));
  return list.filter((i) => (i.agent && slugs.has(i.agent.slug)) || SOURCE_DEPARTMENT[i.source] === department);
}

// The drawer's title: "Needs you", or "Needs you: Sales" for one department.
export function needsTitle(department, departments) {
  if (!department) return "Needs you";
  const known = (Array.isArray(departments) ? departments : []).find((d) => d && d.id === department);
  const title = cap(known?.title, 40) || DEPARTMENTS.find((d) => d.id === department)?.title || "";
  return title ? `Needs you: ${title}` : "Needs you";
}

export function NeedsDrawer({ open, department, stamp, onClose, onDone }) {
  const [s, setS] = useState({ data: null, error: null, loading: false });
  const [map, setMap] = useState(null);
  const seq = useRef(0);

  const load = (quiet) => {
    const n = ++seq.current;
    if (!quiet) setS((p) => ({ data: p.data, error: null, loading: true }));
    api.get("/api/inbox")
      .then((data) => { if (n === seq.current) setS({ data, error: null, loading: false }); })
      .catch((error) => {
        if (n !== seq.current) return;
        setS((p) => (quiet && p.data ? { ...p, loading: false } : { data: null, error, loading: false }));
      });
  };

  useEffect(() => {
    if (!open) return;
    load(false);
  }, [open]);

  // Refresh with the shell, quietly, while open.
  useEffect(() => {
    if (open && s.data) load(true);
  }, [stamp]);

  // For one department, its agents come from /api/map; without it the items are matched by source alone.
  useEffect(() => {
    if (!open || !department || map) return undefined;
    let live = true;
    api.get("/api/map").then((m) => { if (live) setMap(Array.isArray(m?.departments) ? m.departments : []); }).catch(() => { if (live) setMap([]); });
    return () => { live = false; };
  }, [open, department]);

  const items = needsFor(sortNeeds(s.data?.items), department, map);
  const notConnected = (Array.isArray(s.data?.notConnected) ? s.data.notConnected : []).slice(0, 10);
  const full = department ? `#/needs-you?d=${encodeURIComponent(department)}` : "#/needs-you";

  let body;
  if (s.error && !s.data) body = html`<${ErrorNotice} error=${s.error} onRetry=${() => load(false)} />`;
  else if (!s.data) body = html`<${Loading} lines=${3} label="Loading what needs you" />`;
  else if (!items.length) body = html`<p class="s-needs-empty">Nothing needs you.</p>`;
  else {
    body = html`
      <div class="s-needs-list">
        ${items.map((item) => html`<${DecisionCard} key=${item.id} item=${item} compact=${true} onDone=${(r) => onDone?.(r && r.message)} />`)}
      </div>`;
  }

  return html`
    <${Drawer} open=${open} side="right" title=${needsTitle(department, map)} onClose=${onClose}>
      <div class="s-needs-drawer">
        ${body}
        ${notConnected.length ? html`
          <ul class="s-needs-quiet">
            ${notConnected.map((n, i) => html`
              <li key=${i}><span class="s-needs-source">${SOURCE_WORDS[n && n.source] || "A part"}:</span> ${cap(n && n.reason, 200)}</li>`)}
          </ul>` : null}
        <a class="s-needs-full" href=${full} onClick=${onClose}>Open the full list</a>
      </div>
    <//>`;
}
