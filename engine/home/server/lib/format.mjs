// Formatting shared by routes. Money is formatted on the server: "₹ 1,18,000.00".
export function money(n) {
  const v = Number(n) || 0;
  const neg = v < 0;
  const [whole, frac] = Math.abs(v).toFixed(2).split(".");
  let grouped = whole;
  if (whole.length > 3) {
    const head = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    grouped = `${head},${whole.slice(-3)}`;
  }
  return `${neg ? "-" : ""}₹ ${grouped}.${frac}`;
}

// The first line of a text, cut to `max` characters.
export function firstLine(text, max = 80) {
  const line = String(text || "").trim().split("\n")[0].trim();
  return line.length > max ? line.slice(0, max).trimEnd() : line;
}

export const TEXT_MAX = 16000;
export const LINE_MAX = 2000;

// Text an agent wrote, cut before any pattern runs over it: at most TEXT_MAX characters in all and LINE_MAX
// per line (a longer line, or the whole text, ends with "…"). Every place that cleans or summarises agent
// text calls this first; shorter text comes back unchanged. Linear in its input.
export function capText(text, { total = TEXT_MAX, line = LINE_MAX } = {}) {
  const s = String(text || "");
  if (s.length <= line && s.length <= total) return s;
  const out = [];
  let used = 0;
  let at = 0;
  while (at <= s.length && used < total) {
    let end = s.indexOf("\n", at);
    if (end < 0) end = s.length;
    const ln = end - at > line ? `${s.slice(at, at + line - 1)}…` : s.slice(at, end);
    if (used + ln.length > total) {
      out.push(`${ln.slice(0, Math.max(0, total - used - 1))}…`);
      return out.join("\n");
    }
    out.push(ln);
    used += ln.length + 1;
    at = end + 1;
  }
  if (at < s.length && !out[out.length - 1].endsWith("…")) out[out.length - 1] += "…";
  return out.join("\n");
}

export function snippet(text, words, max = 160) {
  const t = capText(text).replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const lower = t.toLowerCase();
  const hit = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  let start = Math.max(0, hit - 40);
  // Start on a whole word: never "…s Please" from the end of the word before.
  if (start > 0 && /\S/.test(t[start - 1])) { const sp = t.indexOf(" ", start); if (sp >= 0 && sp < hit) start = sp + 1; }
  const cut = t.slice(start, start + max).trim();
  return `${start > 0 ? "…" : ""}${cut}${start + max < t.length ? "…" : ""}`;
}
