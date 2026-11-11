// Light, dark, or the system's setting ("auto"). The choice is remembered in this browser.
const KEY = "home.theme";
const ORDER = ["auto", "light", "dark"];

export function currentTheme() {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" || t === "dark" ? t : "auto";
}

export function setTheme(choice) {
  if (choice === "light" || choice === "dark") document.documentElement.setAttribute("data-theme", choice);
  else document.documentElement.removeAttribute("data-theme");
  try {
    if (choice === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Private windows may refuse storage; the choice then lasts for this visit only.
  }
}

export function nextTheme(choice) {
  return ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];
}

export const THEME_WORDS = { auto: "Auto", light: "Light", dark: "Dark" };
