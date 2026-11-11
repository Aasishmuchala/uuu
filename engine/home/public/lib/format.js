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

// How long something took, in words: 45 seconds, 9 minutes, 2 hours 5 minutes, 3 days 4 hours.
export function duration(ms) {
  const v = Math.max(0, Math.floor(Number(ms) || 0));
  const secs = Math.floor(v / 1000);
  if (secs < 60) return count(secs, "second");
  const mins = Math.floor(secs / 60);
  if (mins < 60) return count(mins, "minute");
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 ? `${count(hours, "hour")} ${count(mins % 60, "minute")}` : count(hours, "hour");
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${count(days, "day")} ${count(hours % 24, "hour")}` : count(days, "day");
}

// "Good morning" before 12:00, "Good afternoon" before 17:00, else "Good evening" (the local clock).
export function greeting(date = new Date()) {
  const h = new Date(date).getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// The page address for a `link` the API sends ({ page, id }) (CONTRACTS-V2 14.4). Null without a page.
export function linkHref(link) {
  if (!link || !link.page) return null;
  const page = String(link.page);
  const has = link.id !== undefined && link.id !== null && link.id !== "";
  const id = has ? encodeURIComponent(String(link.id)) : "";
  switch (page) {
    case "tasks":
    case "goals": return has ? `#/tasks/${id}` : "#/tasks";
    case "team": return has ? `#/team/${id}` : "#/team";
    case "docs":
    case "knowledge": return has ? `#/docs?doc=${id}` : "#/docs";
    case "routines": return has ? `#/routines/${id}` : "#/routines";
    case "gallery": return has ? `#/gallery?open=${id}` : "#/gallery";
    case "studio": return has ? `#/studio?sprite=${id}` : "#/studio";
    default: return `#/${encodeURIComponent(page)}`;
  }
}

// Splits "Run: engine start" into a lead-in and a command, so the command can be shown as one.
export function splitCommand(text) {
  const m = /^(.*?\bRun:)\s+(.+)$/.exec(String(text || ""));
  return m ? { lead: m[1], command: m[2] } : null;
}
