// Plain-language formatting for times, sizes and counts.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n) => String(n).padStart(2, "0");
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// "today 14:05", "yesterday 09:10", "3 Nov", "3 Nov 2025". Empty for a missing or broken time.
export function when(iso, now = new Date()) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.round((dayStart(now) - dayStart(d)) / 86400000);
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (days === 0) return `today ${clock}`;
  if (days === 1) return `yesterday ${clock}`;
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? date : `${date} ${d.getFullYear()}`;
}

// The same time written out in full, for a tooltip and for screen readers.
export function fullWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function bytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} ${v === 1 ? "byte" : "bytes"}`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(v < 10240 ? 1 : 0)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
  return `${(v / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// count(1, "agent") → "1 agent"; count(3, "agent") → "3 agents".
export function count(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// The page address for a `link` the API sends ({ page, id }).
export function linkHref(link) {
  if (!link || !link.page) return null;
  if (link.page === "goals" && link.id) return `#/goals/${encodeURIComponent(link.id)}`;
  return `#/${encodeURIComponent(link.page)}`;
}

// Splits "Run: engine start" into a lead-in and a command, so the command can be shown as one.
export function splitCommand(text) {
  const m = /^(.*?\bRun:)\s+(.+)$/.exec(String(text || ""));
  return m ? { lead: m[1], command: m[2] } : null;
}
