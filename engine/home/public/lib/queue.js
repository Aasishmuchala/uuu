// What needs the owner, as the queue panel and the Needs you page both read it (PLAN-COOK T21, section 4):
// the order (urgent first, then newest), one department's share, the panel's title, the four groups and the
// address a row opens. Pure helpers only, so a page can import them without the shell.
import { linkHref, when } from "./format.js";
import { DEPARTMENTS } from "../routes.js";

// Which department a Needs-you item's source belongs to (CONTRACTS-V3 26.4).
export const SOURCE_DEPARTMENT = { books: "books", people: "people", support: "support", marketing: "marketing", customers: "sales" };

const cap = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const timeOf = (iso) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

// A row's time: the clock alone for an item of today ("14:27"), the shared helper's words for any other day,
// nothing for an empty or broken date.
export function rowTime(iso, now = new Date()) {
  const at = when(iso, now);
  return at.startsWith("today ") ? at.slice(6) : at;
}

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
  // The server now says which department an item belongs to (the same rule the map and the sidebar use);
  // the older matching by agent or source stays for an answer that does not carry it.
  return list.filter((i) => (typeof i.department === "string" && i.department
    ? i.department === department
    : (i.agent && slugs.has(i.agent.slug)) || SOURCE_DEPARTMENT[i.source] === department));
}

// The queue's title: "Needs you", or "Needs you: Sales" for one department.
export function needsTitle(department, departments) {
  if (!department) return "Needs you";
  const known = (Array.isArray(departments) ? departments : []).find((d) => d && d.id === department);
  const title = cap(known?.title, 40) || DEPARTMENTS.find((d) => d.id === department)?.title || "";
  return title ? `Needs you: ${title}` : "Needs you";
}

// The four groups, in this order, empty ones left out, each sorted by sortNeeds:
// [{ id, title, heading: "To approve · 3", items }].
const GROUPS = [
  { id: "approve", title: "To approve", has: (k) => k === "shotlist" || k === "pick" || k === "approval" },
  { id: "answer", title: "To answer", has: (k) => k === "question" },
  { id: "accept", title: "To accept", has: (k) => k === "result" },
  { id: "know", title: "To know", has: () => true },
];
export function queueGroups(items) {
  const left = sortNeeds(items);
  const out = [];
  for (const g of GROUPS) {
    const mine = [];
    for (let i = 0; i < left.length;) {
      if (g.has(left[i].kind)) mine.push(left.splice(i, 1)[0]);
      else i += 1;
    }
    if (mine.length) out.push({ id: g.id, title: g.title, heading: `${g.title} · ${mine.length}`, items: mine });
  }
  return out;
}

// The address a row opens (decision 9): a result or a pick of a task opens that task; anything else, a
// shotlist included, opens the item on the Needs you page.
export function queueHref(item) {
  const own = `#/needs-you?item=${encodeURIComponent(String(item?.id ?? ""))}`;
  if (!item || item.kind === "shotlist") return own;
  if (item.link && item.link.page === "tasks" && (item.kind === "result" || item.kind === "pick")) return linkHref(item.link) || own;
  return own;
}
