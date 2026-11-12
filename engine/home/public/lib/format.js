// Plain-language formatting for times, sizes and counts, and the page address of a link.

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

// The token of a file in the company brain: the base64url of its path inside the brain, without padding
// (CONTRACTS-V3 32.2). Works in the browser and in Node.
export function fileToken(path) {
  const bytes = new TextEncoder().encode(String(path ?? ""));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const RECORDS = ["books", "customers", "support", "people", "marketing", "studio"];

// The page address for a `link` the API sends ({ page, id }) (CONTRACTS-V2 14.4, CONTRACTS-V3 26.3).
// Null without a page. Old page names go where their addresses now redirect.
export function linkHref(link) {
  if (!link || !link.page) return null;
  const page = String(link.page);
  const has = link.id !== undefined && link.id !== null && link.id !== "";
  const raw = has ? String(link.id) : "";
  const id = encodeURIComponent(raw);
  // A job's id is "<department>/<id>": each part is its own part of the address.
  const path = raw.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  switch (page) {
    case "tasks":
    case "goals": return has ? `#/tasks/${id}` : "#/tasks";
    case "team":
    case "company": return has ? `#/team/${id}` : "#/team";
    case "files": return has ? `#/files?file=${id}` : "#/files";
    case "docs":
    case "knowledge": return has ? `#/files?file=${fileToken(raw)}` : "#/files";
    case "jobs":
    case "gallery": return has && path ? `#/jobs/${path}` : "#/jobs";
    case "departments": return has ? `#/departments/${id}` : "#/map";
    case "map": return has ? `#/map/${id}` : "#/map";
    case "home": return "#/map";
    case "inbox":
    case "needs-you": return "#/needs-you";
    case "dashboards": return has ? `#/dashboards/${id}` : "#/dashboards";
    case "routines": return has ? `#/routines/${id}` : "#/routines";
    case "studio": return has ? `#/dashboards/studio?sprite=${id}` : "#/dashboards/studio";
    default:
      if (RECORDS.includes(page)) return `#/dashboards/${page}`;
      return `#/${encodeURIComponent(page)}`;
  }
}

// Splits "Run: engine start" into a lead-in and a command, so the command can be shown as one.
export function splitCommand(text) {
  const m = /^(.*?\bRun:)\s+(.+)$/.exec(String(text || ""));
  return m ? { lead: m[1], command: m[2] } : null;
}

// Waiting its turn (M63). The server works out from the board's records how many tasks are ahead of a task in its
// agent's line and sends `queue: { ahead }`; nothing here guesses a number. aheadCount(queue) -> that number, or
// 0 when the server sent none (then the present words hold).
export function aheadCount(queue) {
  const n = queue && typeof queue === "object" ? queue.ahead : null;
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : 0;
}
const tasksAhead = (n) => (n === 1 ? "1 task is" : `${n} tasks are`);

// "Waiting its turn: 3 tasks are ahead of it." for a task waiting to start or to go on; "" when nothing is ahead.
export function waitingLine(queue) {
  const n = aheadCount(queue);
  return n ? `Waiting its turn: ${tasksAhead(n)} ahead of it.` : "";
}

// Before something is sent or started: "3 tasks are ahead, so it waits its turn."; "" when nothing is ahead.
export function aheadLine(queue) {
  const n = aheadCount(queue);
  return n ? `${tasksAhead(n)} ahead, so it waits its turn.` : "";
}
