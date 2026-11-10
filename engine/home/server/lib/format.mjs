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

export function snippet(text, words, max = 160) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const lower = t.toLowerCase();
  const hit = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, hit - 40);
  const cut = t.slice(start, start + max).trim();
  return `${start > 0 ? "…" : ""}${cut}${start + max < t.length ? "…" : ""}`;
}
