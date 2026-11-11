// Small helpers the kit's modules share. Private to kit/: kit/index.js does not re-export them.

// cx("k-btn", busy && "k-btn--busy") → "k-btn k-btn--busy"
export const cx = (...parts) => parts.filter(Boolean).join(" ");

// Ids that tie a label or a hint to its control. Stable for a component's life (kept in useState).
let seq = 0;
export const nextId = (prefix) => `${prefix}-${++seq}`;

// Only addresses inside this app: "#/tasks", "/files/x", "./x". Anything else ("javascript:", another host) gives null.
export function safeHref(href) {
  if (typeof href !== "string") return null;
  const h = href.trim();
  if (h.startsWith("#")) return h;
  if (h.startsWith("/") && !h.startsWith("//") && !h.startsWith("/\\")) return h;
  if (h.startsWith("./") || h.startsWith("../")) return h;
  return null;
}

// True when children would render nothing.
export const isEmpty = (children) =>
  children == null || children === false || children === "" || (Array.isArray(children) && children.every(isEmpty));
