// The Home screen's brief (CONTRACTS-V2 17.2): reading the routine's brief file and computing one when there
// is none. Pure functions, no file or network access. It holds no route of its own: the default export is a
// no-op so the module loader (lib/loader.mjs) accepts it. The file text was written by an agent: it is cut
// to size here and only ever shown as text.
export default function register() {}

export const MAX_ITEMS = 8;
const DAY = 24 * 3600e3;
const TITLE_MAX = 120;
const TEXT_MAX = 400;
const HEAD = /^# Daily brief: (\d{4}-\d{2}-\d{2})[ \t]*$/;

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// text -> { date, items: [{ title, by, about, text }] }. A file whose first line is not the heading gives no
// date and no items. An item with no `by:` or no `about:` line is dropped. Linear in the length of the text.
export function parseBrief(text) {
  const out = { date: null, items: [] };
  if (typeof text !== "string") return out;
  const lines = text.split(/\r?\n/);
  const head = HEAD.exec(lines[0].replace(/^﻿/, ""));
  if (!head) return out;
  out.date = head[1];
  let cur = null;
  const close = () => {
    if (cur && cur.by && cur.about && out.items.length < MAX_ITEMS) {
      out.items.push({ title: cur.title, by: cur.by, about: cur.about, text: cur.lines.join(" ") });
    }
    cur = null;
  };
  for (let i = 1; i < lines.length && out.items.length < MAX_ITEMS; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) {
      close();
      const title = clip(line.slice(3).trim(), TITLE_MAX);
      cur = title ? { title, by: "", about: "", lines: [] } : null;
      continue;
    }
    if (!cur) continue;
    const t = line.trim();
    if (!t) continue;
    const by = /^by:\s*(.*)$/i.exec(t);
    const about = /^about:\s*(.*)$/i.exec(t);
    if (by && !cur.by) cur.by = clip(by[1].trim(), 60);
    else if (about && !cur.about) cur.about = clip(about[1].trim(), 60);
    else if (cur.lines.length < 3) cur.lines.push(clip(t, TEXT_MAX));
  }
  close();
  return out;
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// The brief when no routine wrote one. `accepted`: [{ id, identifier, title, result, at }] (at: ISO time the owner
// accepted); `lessons`: [{ slug, name, text, date }] (date: YYYY-MM-DD); `working`, `total`: agent counts.
// -> { date, items: [{ id, title, text, who, about, at }] }, in the order of the contract.
export function computeBrief({ accepted = [], lessons = [], working = 0, total = 0, now = Date.now() } = {}) {
  const today = isoDay(now);
  const yesterday = isoDay(now - DAY);
  const chief = { slug: "chief-of-staff", name: "Chief of staff" };
  const items = [];
  const push = (it) => { if (items.length < MAX_ITEMS) items.push({ id: `b${items.length + 1}`, ...it }); };

  const recent = accepted
    .map((a) => ({ ...a, ms: Date.parse(a.at) }))
    .filter((a) => Number.isFinite(a.ms) && a.ms <= now + 60e3 && now - a.ms <= DAY)
    .sort((a, b) => b.ms - a.ms);
  for (const a of recent) {
    const result = String(a.result || "").replace(/\s+/g, " ").trim();
    push({
      title: clip(`Finished: ${a.title}`, TITLE_MAX),
      text: result.slice(0, 200),
      who: chief,
      about: { label: a.identifier || "Task", link: a.id ? { page: "tasks", id: a.id } : null },
      at: new Date(a.ms).toISOString(),
    });
  }
  for (const l of lessons) {
    if (l.date !== today && l.date !== yesterday) continue;
    push({
      title: `${l.name} learned something`,
      text: clip(String(l.text || "").replace(/\s+/g, " ").trim(), 200),
      who: { slug: l.slug, name: l.name },
      about: { label: l.name, link: { page: "team", id: l.slug } },
      at: `${l.date}T00:00:00.000Z`,
    });
  }
  const none = items.length === 0;
  push({
    title: none ? "A quiet day" : "Who is working",
    text: `${working} of ${total} agents are working right now.`,
    who: chief,
    about: { label: "Team", link: { page: "team", id: null } },
    at: new Date(now).toISOString(),
  });
  return { date: today, items };
}
