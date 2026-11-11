// Light, dark, or the system's setting ("auto"), and one accent colour. Both are remembered in this
// browser (lib/settings.js also keeps them on the home server).
const KEY = "home.theme";
const ACCENT_KEY = "home.accent";
const ORDER = ["auto", "light", "dark"];

export const ACCENTS = ["graphite", "blue", "green", "violet", "orange", "rose"];
export const ACCENT_WORDS = { graphite: "Graphite", blue: "Blue", green: "Green", violet: "Violet", orange: "Orange", rose: "Rose" };

const root = () => (typeof document === "undefined" ? null : document.documentElement);

function remember(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private windows may refuse storage; the choice then lasts for this visit only.
  }
}

export function currentTheme() {
  const t = root()?.getAttribute("data-theme");
  return t === "light" || t === "dark" ? t : "auto";
}

// Sets the attribute at once. `remember: false` leaves this browser's stored choice alone.
export function setTheme(choice, { remember: keep = true } = {}) {
  const el = root();
  if (el) {
    if (choice === "light" || choice === "dark") el.setAttribute("data-theme", choice);
    else el.removeAttribute("data-theme");
  }
  if (keep) remember(KEY, choice === "light" || choice === "dark" ? choice : null);
}

export function nextTheme(choice) {
  return ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];
}

export const THEME_WORDS = { auto: "Auto", light: "Light", dark: "Dark" };

export function currentAccent() {
  const a = root()?.getAttribute("data-accent");
  return ACCENTS.includes(a) ? a : "graphite";
}

export function setAccent(accent, { remember: keep = true } = {}) {
  const a = ACCENTS.includes(accent) ? accent : "graphite";
  root()?.setAttribute("data-accent", a);
  if (keep) remember(ACCENT_KEY, a);
}
