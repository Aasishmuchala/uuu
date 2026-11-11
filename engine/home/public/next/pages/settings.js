// Settings: how it looks, and what could be switched on later. Nothing else is on this page.
import { html, useState } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { currentAccent, currentBackdrop, currentMotion, currentTheme } from "../lib/theme.js";
import { Button, Card, ErrorNotice, Loading, PageHeader, Section, Segmented, Switch } from "../kit/index.js";

export const THEMES = [
  { id: "auto", label: "Auto" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

// The backgrounds, in case the server's list has not arrived yet (CONTRACTS-V3 27.3).
export const BACKDROPS = [
  { id: "aurora", label: "Aurora" },
  { id: "stars", label: "Stars" },
  { id: "plain", label: "Plain" },
];

// Each accent's colour in the light and the dark theme (CONTRACTS-V2 12), for the swatches only. The tokens
// hold just the current accent, so the swatches need their own copy of the six.
export const SWATCHES = {
  graphite: ["#18181b", "#fafafa"],
  blue: ["#2563eb", "#60a5fa"],
  green: ["#15803d", "#4ade80"],
  violet: ["#7c3aed", "#a78bfa"],
  orange: ["#c2410c", "#fb923c"],
  rose: ["#be123c", "#fb7185"],
};

// True when the page is drawn dark: chosen, or "auto" on a Mac set to dark.
function drawnDark() {
  if (typeof document === "undefined") return false;
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "dark" || t === "light") return t === "dark";
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

export default function Page() {
  const { saveSettings, settings } = useApp();
  const res = useResource("/api/settings");
  const [chosen, setChosen] = useState({});
  const [technical, setTechnical] = useState(false);
  const d = res.data;

  if (!d) {
    return html`
      <div class="p-settings">
        <${PageHeader} title="Settings" />
        ${res.loading ? html`<${Loading} lines=${4} label="Loading your settings" />` : null}
        ${res.error ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
      </div>`;
  }

  // What is on screen wins over what the server keeps: "?theme=" and "?accent=" hold for this visit.
  const theme = chosen.theme || currentTheme() || (d.appearance && d.appearance.theme) || "auto";
  const accent = chosen.accent || currentAccent() || (d.appearance && d.appearance.accent) || "graphite";
  const backdrop = chosen.backdrop || currentBackdrop() || (d.appearance && d.appearance.backdrop) || "aurora";
  const motion = chosen.motion || currentMotion() || (d.appearance && d.appearance.motion) || "on";
  const backdrops = (Array.isArray(d.backdrops) && d.backdrops.length ? d.backdrops : settings && Array.isArray(settings.backdrops) && settings.backdrops.length ? settings.backdrops : BACKDROPS)
    .filter((b) => b && typeof b.id === "string").map((b) => ({ id: b.id, label: String(b.label || b.id) }));
  const dark = drawnDark();
  function change(patch) {
    setChosen({ ...chosen, ...patch });
    saveSettings({ theme, accent, backdrop, motion, ...patch });
  }

  return html`
    <div class="p-settings">
      <${PageHeader} title="Settings" />

      <${Section} title="Appearance">
        <${Card}>
          <div class="p-settings__group" role="group" aria-labelledby="set-theme">
            <h3 id="set-theme" class="p-settings__label">Theme</h3>
            <${Segmented} label="Theme" items=${THEMES} current=${theme} onChange=${(id) => change({ theme: id })} />
          </div>
          <div class="p-settings__group" role="radiogroup" aria-labelledby="set-accent">
            <h3 id="set-accent" class="p-settings__label">Accent colour</h3>
            <div class="p-settings__swatches">
              ${(d.accents || []).map((a) => html`
                <label key=${a.id} class="p-settings__swatch">
                  <input type="radio" name="accent" value=${a.id} checked=${accent === a.id} onChange=${() => change({ accent: a.id })} />
                  <span class="p-settings__dot" style=${SWATCHES[a.id] ? `background:${SWATCHES[a.id][dark ? 1 : 0]}` : ""} aria-hidden="true"></span>
                  <span>${a.label}</span>
                </label>`)}
            </div>
          </div>
          <div class="p-settings__group" role="group" aria-labelledby="set-backdrop">
            <h3 id="set-backdrop" class="p-settings__label">Background</h3>
            <${Segmented} label="Background" items=${backdrops} current=${backdrop} onChange=${(id) => change({ backdrop: id })} />
          </div>
          <div class="p-settings__group">
            <${Switch} on=${motion !== "off"} label="Moving background" explain="The colours drift slowly. Switch it off to save battery."
              onChange=${(on) => change({ motion: on ? "on" : "off" })} />
          </div>
        <//>
      <//>

      <${Section} title="Later, when you want it"
        aside=${html`<${Button} variant="quiet" onClick=${() => setTechnical(!technical)}>${technical ? "Hide technical details" : "Show technical details"}<//>`}>
        <ul class="p-settings__later">
          ${(d.later || []).map((l) => html`
            <li key=${l.id} class="p-settings__item">
              <${Switch} on=${false} disabled=${true} label=${l.label} explain=${l.explain} />
              <p class="p-settings__sub">${l.cost}</p>
              <p class="p-settings__sub">${l.how}</p>
              ${technical && l.technical ? html`<p class="p-settings__tech">${l.technical}</p>` : null}
            </li>`)}
        </ul>
      <//>
    </div>`;
}
