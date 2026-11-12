// Light, dark, or the system's setting ("auto"), one accent colour, the background behind the pages
// (the aurora, the stars alone, or plain) and whether it moves. All are remembered in this browser
// (lib/settings.js also keeps theme and accent on the home server). With no choice the theme is dark.
const KEY = "home.theme";
const ACCENT_KEY = "home.accent";
const BACKDROP_KEY = "home.backdrop";
const MOTION_KEY = "home.motion";
const ORDER = ["auto", "light", "dark"];

export const ACCENTS = ["graphite", "blue", "green", "violet", "orange", "rose"];
export const ACCENT_WORDS = { graphite: "Graphite", blue: "Blue", green: "Green", violet: "Violet", orange: "Orange", rose: "Rose" };
export const BACKDROPS = ["aurora", "stars", "plain"];
export const MOTIONS = ["on", "off"];

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
  return ORDER.includes(t) ? t : "dark";
}

// Sets the attribute at once. `remember: false` leaves this browser's stored choice alone.
// "auto" is kept as a choice of its own, since no choice at all now means dark.
export function setTheme(choice, { remember: keep = true } = {}) {
  const t = ORDER.includes(choice) ? choice : "dark";
  root()?.setAttribute("data-theme", t);
  if (keep) remember(KEY, t);
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

export function currentBackdrop() {
  const b = root()?.getAttribute("data-backdrop");
  return BACKDROPS.includes(b) ? b : "aurora";
}

export function setBackdrop(backdrop, { remember: keep = true } = {}) {
  const b = BACKDROPS.includes(backdrop) ? backdrop : "aurora";
  root()?.setAttribute("data-backdrop", b);
  if (keep) remember(BACKDROP_KEY, b);
}

export function currentMotion() {
  const m = root()?.getAttribute("data-motion");
  return MOTIONS.includes(m) ? m : "on";
}

export function setMotion(motion, { remember: keep = true } = {}) {
  const m = MOTIONS.includes(motion) ? motion : "on";
  root()?.setAttribute("data-motion", m);
  if (keep) remember(MOTION_KEY, m);
}
