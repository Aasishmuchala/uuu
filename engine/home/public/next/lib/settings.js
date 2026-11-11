// The owner's appearance settings: theme, accent, the background behind the pages and whether it moves.
// They live on the home server (GET and POST /api/settings) and in this browser's storage, and take
// effect at once through four attributes on <html>. While the server has no settings route, or does not
// know a key yet, this browser's storage alone is used for it.
import { api } from "./api.js";
import {
  ACCENTS, BACKDROPS, MOTIONS, currentAccent, currentBackdrop, currentMotion, currentTheme,
  setAccent, setBackdrop, setMotion, setTheme,
} from "./theme.js";

const THEMES = ["auto", "light", "dark"];

// Only the keys the server sent, each checked; a key it did not send is left to this browser.
export function cleanAppearance(a = {}) {
  const out = {};
  const x = a && typeof a === "object" ? a : {};
  if (x.theme !== undefined) out.theme = THEMES.includes(x.theme) ? x.theme : "dark";
  if (x.accent !== undefined) out.accent = ACCENTS.includes(x.accent) ? x.accent : "graphite";
  if (x.backdrop !== undefined) out.backdrop = BACKDROPS.includes(x.backdrop) ? x.backdrop : "aurora";
  if (x.motion !== undefined) out.motion = MOTIONS.includes(x.motion) ? x.motion : "on";
  return out;
}

// "?theme=", "?accent=", "?backdrop=" and "?motion=" in the address hold for this visit only; the server
// must not undo them.
function asked(name) {
  try { return new URLSearchParams(location.search).get(name); } catch { return null; }
}

function local() {
  return { theme: currentTheme(), accent: currentAccent(), backdrop: currentBackdrop(), motion: currentMotion() };
}

const SETTERS = { theme: setTheme, accent: setAccent, backdrop: setBackdrop, motion: setMotion };

// → { theme, accent, backdrop, motion, accents: [{ id, label }] | null, backdrops: [{ id, label }] | null,
//     saved: true when the server keeps them }
export async function loadSettings() {
  try {
    const data = await api.get("/api/settings");
    const s = cleanAppearance(data.appearance);
    for (const [k, v] of Object.entries(s)) if (!asked(k)) SETTERS[k](v);
    return {
      ...local(),
      accents: Array.isArray(data.accents) ? data.accents : null,
      backdrops: Array.isArray(data.backdrops) ? data.backdrops : null,
      saved: true,
    };
  } catch {
    return { ...local(), accents: null, backdrops: null, saved: false };
  }
}

// Changes what is on screen and in this browser at once, then tells the server. Resolves to the
// same object as loadSettings(); `saved` is false when the server could not keep the choice.
export async function saveSettings({ theme, accent, backdrop, motion } = {}) {
  const wanted = { theme, accent, backdrop, motion };
  const body = {};
  for (const [k, v] of Object.entries(wanted)) {
    if (v === undefined) continue;
    SETTERS[k](v);
    body[k] = local()[k];
  }
  try {
    await api.post("/api/settings", body);
    return { ...local(), accents: null, backdrops: null, saved: true };
  } catch {
    return { ...local(), accents: null, backdrops: null, saved: false };
  }
}
