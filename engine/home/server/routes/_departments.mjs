// Shared by the four department pages (routes/{books,customers,support,people}.mjs), the bench inbox
// source and the bench search source. It holds no route of its own: the default export is a no-op so the
// module loader (lib/loader.mjs) accepts it. Everything here talks to the books with the owner's key
// through ctx.bench and reads the board with no Authorization header through ctx.board.
import { HomeError } from "../lib/errors.mjs";
import { descendants, loadIssues, plainState } from "../lib/goals.mjs";
import { money } from "../lib/format.mjs";

export default function register() {}

// ---- the agents' bench users (CONTRACTS 8)
export const AGENTS = {
  bookkeeper: { email: "bookkeeper@engine.localhost", name: "Bookkeeper" },
  sales: { email: "sales@engine.localhost", name: "Sales" },
  support: { email: "support@engine.localhost", name: "Support" },
  people: { email: "people@engine.localhost", name: "People" },
};
export const AGENT_BY_EMAIL = new Map(Object.entries(AGENTS).map(([slug, a]) => [a.email, { slug, name: a.name }]));
export const AGENT_EMAILS = [...AGENT_BY_EMAIL.keys()];

export const REPLY_MARK = "DRAFT REPLY:";
// Frappe may keep a comment's text inside <p>...</p>; look past leading tags and spaces.
export const plainText = (html) => String(html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
export const isDraftReply = (content) => plainText(content).startsWith(REPLY_MARK);

// ---- documents an agent may leave as a draft for the owner to approve. Doctype and field names live here.
export const DRAFT_TYPES = {
  "Sales Invoice": {
    source: "books", plain: "invoice",
    fields: ["name", "customer", "posting_date", "due_date", "grand_total", "outstanding_amount", "docstatus", "owner", "modified"],
    party: (d) => d.customer, amount: (d) => money(d.grand_total),
    details: (d) => [["Customer", d.customer], ["Date", dateText(d.posting_date)], ["Due", dateText(d.due_date)], ["Total", money(d.grand_total)]],
  },
  Quotation: {
    source: "books", plain: "quotation",
    fields: ["name", "party_name", "customer_name", "transaction_date", "valid_till", "grand_total", "docstatus", "owner", "modified"],
    party: (d) => d.customer_name || d.party_name, amount: (d) => money(d.grand_total),
    details: (d) => [["Customer", d.customer_name || d.party_name], ["Date", dateText(d.transaction_date)], ["Valid until", dateText(d.valid_till)], ["Total", money(d.grand_total)]],
  },
  "Purchase Invoice": {
    source: "books", plain: "bill",
    fields: ["name", "supplier", "posting_date", "due_date", "grand_total", "outstanding_amount", "docstatus", "owner", "modified"],
    party: (d) => d.supplier, amount: (d) => money(d.grand_total),
    details: (d) => [["Supplier", d.supplier], ["Date", dateText(d.posting_date)], ["Due", dateText(d.due_date)], ["Total", money(d.grand_total)]],
  },
  "Journal Entry": {
    source: "books", plain: "journal entry",
    fields: ["name", "total_debit", "posting_date", "docstatus", "owner", "modified"],
    party: () => "", amount: (d) => money(d.total_debit),
    details: (d) => [["Date", dateText(d.posting_date)], ["Amount", money(d.total_debit)]],
  },
  "Payment Entry": {
    source: "books", plain: "payment",
    fields: ["name", "party", "paid_amount", "posting_date", "docstatus", "owner", "modified"],
    party: (d) => d.party, amount: (d) => money(d.paid_amount),
    details: (d) => [["Paid to or by", d.party], ["Date", dateText(d.posting_date)], ["Amount", money(d.paid_amount)]],
  },
  "Leave Application": {
    source: "people", plain: "leave request",
    fields: ["name", "employee_name", "from_date", "to_date", "status", "docstatus", "owner", "modified"],
    party: (d) => d.employee_name, amount: () => "",
    details: (d) => [["Person", d.employee_name], ["From", dateText(d.from_date)], ["To", dateText(d.to_date)]],
  },
  Attendance: {
    source: "people", plain: "attendance record",
    fields: ["name", "employee_name", "attendance_date", "status", "docstatus", "owner", "modified"],
    party: (d) => d.employee_name, amount: () => "",
    details: (d) => [["Person", d.employee_name], ["Date", dateText(d.attendance_date)], ["Marked", d.status]],
  },
  "HD Ticket Comment": {
    source: "support", plain: "reply",
    fields: ["name", "reference_ticket", "content", "commented_by", "docstatus", "owner", "modified", "creation"],
    party: (d) => `request ${d.reference_ticket}`, amount: () => "",
    details: (d) => [["Request", `#${d.reference_ticket}`], ["Reply", plainText(d.content).slice(REPLY_MARK.length).trim()]],
  },
};
export const plainType = (doctype) => DRAFT_TYPES[doctype]?.plain || doctype;
export const inboxIdOf = (doctype, name) => `bench:${doctype}:${name}`;
export const sentBackKey = (doctype, name) => `benchsentback:${doctype}:${name}`;
export const decidedKey = (doctype, name) => `benchdecided:${doctype}:${name}`;

// ---- dates, always Asia/Kolkata
const IST_MS = 5.5 * 3600 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const istIso = (ms) => new Date(ms + IST_MS).toISOString();

export function istNow(now = new Date()) {
  const today = istIso(now.getTime()).slice(0, 10);
  const [y, m] = today.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    today,
    monthStart: `${y}-${pad(m)}-01`,
    nextMonthStart: m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`,
    weekAgo: istIso(now.getTime() - 6 * 86400000).slice(0, 10),
  };
}

export function dateText(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ""));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
}

// "2026-11-11 14:30:00.123456" (the books' clock is India time) -> ISO time in UTC, or null.
export function stampToIso(s) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,6})?/.exec(String(s || ""));
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}${m[3] ? m[3].slice(0, 4).padEnd(4, "0") : ""}+05:30`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function ageText(stamp, now = new Date()) {
  const day = (s) => Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`);
  const from = day(stamp);
  if (!Number.isFinite(from)) return "";
  const days = Math.max(0, Math.round((day(istNow(now).today) - from) / 86400000));
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  if (days < 60) return `${days} days`;
  return `${Math.round(days / 30)} months`;
}

export const sum = (rows, key) => Math.round(rows.reduce((t, r) => t + (Number(r[key]) || 0), 0) * 100) / 100;
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---- reading the books
const NOT_THERE = (e) => e instanceof HomeError && (e.upstreamStatus === 404 || e.excType === "DoesNotExistError");

export async function listDocs(ctx, doctype, { fields, filters, order_by, limit = 500 } = {}) {
  const out = await ctx.bench.get(`/api/resource/${encodeURIComponent(doctype)}`, {
    fields, filters: filters || [], order_by, limit_page_length: limit,
  });
  return Array.isArray(out?.data) ? out.data : [];
}

// Drafts an agent made and the owner has not dealt with. `source` is books | people | support (or omitted for all).
// Each draft: { doctype, name, id, owner, agent: { slug, name }, modified, doc }.
// A draft the owner sent back stays out of the list until the agent changes it again.
export async function listDrafts(ctx, source) {
  const out = [];
  await Promise.all(Object.entries(DRAFT_TYPES).filter(([, t]) => !source || t.source === source).map(async ([doctype, t]) => {
    const filters = [["docstatus", "=", 0], ["owner", "in", AGENT_EMAILS]];
    if (doctype === "HD Ticket Comment") filters.push(["content", "like", `%${REPLY_MARK}%`]);
    let rows;
    try {
      rows = await listDocs(ctx, doctype, { fields: t.fields, filters, order_by: "modified desc", limit: 200 });
    } catch (e) {
      if (NOT_THERE(e)) return;
      throw e;
    }
    for (const doc of rows) {
      const agent = AGENT_BY_EMAIL.get(doc.owner);
      if (!agent || Number(doc.docstatus) !== 0) continue;
      if (doctype === "HD Ticket Comment" && (!isDraftReply(doc.content) || ctx.decisions.get(decidedKey(doctype, doc.name)))) continue;
      if (ctx.decisions.get(sentBackKey(doctype, doc.name)) === doc.modified) continue;
      out.push({ doctype, name: String(doc.name), id: inboxIdOf(doctype, doc.name), owner: doc.owner, agent, modified: doc.modified, doc });
    }
  }));
  return out.sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
}

// ---- the page frame (CONTRACTS 9.6)
const SWITCH_EXPLAIN = "Connect an account to turn this on.";
export const offSwitch = (id, label) => ({ id, label, on: false, explain: SWITCH_EXPLAIN });

const AGENT_STATES = {
  free: "Free", working: "Working", paused: "Paused", problem: "Has a problem", waiting_for_you: "Waiting for your approval",
};

async function agentAndWork(ctx, slug, fallbackName) {
  const empty = { agent: null, inFlight: [] };
  try {
    const ids = ctx.ids();
    const companyId = ids?.companyId || (await ctx.board.companyId());
    const base = `/api/companies/${encodeURIComponent(companyId)}`;
    const [agents, live] = await Promise.all([
      ctx.board.get(`${base}/agents`),
      ctx.board.get(`${base}/live-runs`).catch(() => []),
    ]);
    const a = (Array.isArray(agents) ? agents : []).find((x) => x.id === ids?.agents?.[slug] || x.urlKey === slug);
    if (!a) return empty;
    let state = "free";
    if (a.status === "pending_approval") state = "waiting_for_you";
    else if (a.status === "error") state = "problem";
    else if (a.status === "paused") state = "paused";
    else if ((Array.isArray(live) ? live : []).some((r) => r.agentId === a.id) || a.status === "running") state = "working";
    const inFlight = [];
    if (ids?.projectId) {
      const issues = await loadIssues(ctx, companyId);
      const open = (i) => i.status !== "done" && i.status !== "cancelled";
      for (const g of issues.filter((i) => !i.parentId && i.projectId === ids.projectId && open(i))) {
        if (descendants(issues, g.id).some((s) => s.assigneeAgentId === a.id)) {
          inFlight.push({ goalId: g.id, identifier: g.identifier, title: g.title, plainState: plainState(g.status).plainState });
        }
      }
    }
    return { agent: { name: a.name || fallbackName, state, plainState: AGENT_STATES[state] }, inFlight };
  } catch (e) {
    if (e instanceof HomeError) return empty;
    throw e;
  }
}

// def: { id, title, agentSlug, agentName, mainDoctype, switches: [...] }; build(ctx) -> { figures, sections }.
export async function departmentPage(ctx, def, build) {
  const frame = { id: def.id, title: def.title, switches: def.switches };
  const off = async (reason, next) => ({
    ...frame, connected: false, notConnected: { reason, next },
    ...(await agentAndWork(ctx, def.agentSlug, def.agentName)), figures: [], sections: [],
  });
  if (!ctx.bench.installed()) return off("Books is not installed on this Mac yet.", "Run: engine/books/install.sh");
  const gone = () => off("This part was left out when Books was installed, because the disk was nearly full.",
    "Free some disk space, then run: engine/books/install.sh");
  let there;
  try {
    there = await ctx.bench.has(def.mainDoctype);
  } catch (e) {
    if (e instanceof HomeError && e.code === "bench_off") return off("Books is switched off.", "Run: engine start");
    throw e;
  }
  if (!there) return gone();
  let data;
  try {
    data = await build(ctx);
  } catch (e) {
    if (NOT_THERE(e)) return gone();
    if (e instanceof HomeError && e.code === "bench_off") return off("Books is switched off.", "Run: engine start");
    throw e;
  }
  return { ...frame, connected: true, notConnected: null, ...(await agentAndWork(ctx, def.agentSlug, def.agentName)), ...data };
}

export const figure = (id, label, value, hint = "") => ({ id, label, value, hint });
export const section = (id, title, emptyText, columns, rows) => ({
  id, title, emptyText, columns: columns.map(([key, label]) => ({ key, label })), rows: rows.slice(0, 50),
});
