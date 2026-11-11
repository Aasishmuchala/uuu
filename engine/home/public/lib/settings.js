// The owner's appearance settings: theme and accent. They live on the home server (GET and POST
// /api/settings) and in this browser's storage, and take effect at once through two attributes on
// <html>. While the server has no settings route, this browser's storage alone is used.
import { api } from "./api.js";
import { ACCENTS, currentAccent, currentTheme, setAccent, setTheme } from "./theme.js";

const THEMES = ["auto", "light", "dark"];

const clean = (a = {}) => ({
  theme: THEMES.includes(a.theme) ? a.theme : "auto",
  accent: ACCENTS.includes(a.accent) ? a.accent : "graphite",
});

// "?theme=" and "?accent=" in the address hold for this visit only; the server must not undo them.
function asked(name) {
  try { return new URLSearchParams(location.search).get(name); } catch { return null; }
}

function local() {
  return { theme: currentTheme(), accent: currentAccent() };
}

// → { theme, accent, accents: [{ id, label }], saved: true when the server keeps them }
export async function loadSettings() {
  try {
    const data = await api.get("/api/settings");
    const s = clean(data.appearance);
    if (!asked("theme")) setTheme(s.theme);
    if (!asked("accent")) setAccent(s.accent);
    return { ...local(), accents: Array.isArray(data.accents) ? data.accents : null, saved: true };
  } catch {
    return { ...local(), accents: null, saved: false };
  }
}

// Changes what is on screen and in this browser at once, then tells the server. Resolves to the
// same object as loadSettings(); `saved` is false when the server could not keep the choice.
export async function saveSettings({ theme, accent } = {}) {
  if (theme !== undefined) setTheme(THEMES.includes(theme) ? theme : "auto");
  if (accent !== undefined) setAccent(accent);
  const body = {};
  if (theme !== undefined) body.theme = currentTheme();
  if (accent !== undefined) body.accent = currentAccent();
  try {
    await api.post("/api/settings", body);
    return { ...local(), accents: null, saved: true };
  } catch {
    return { ...local(), accents: null, saved: false };
  }
}
