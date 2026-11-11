// Settings: how it looks, and what could be switched on later. Nothing else is on this page.
import { html, useState } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { Button, Card, ErrorNotice, Loading, PageHeader, Section, Switch } from "../kit/index.js";

export const THEMES = [
  { id: "auto", label: "Auto" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export default function Page() {
  const { saveSettings } = useApp();
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

  const theme = chosen.theme || (d.appearance && d.appearance.theme) || "auto";
  const accent = chosen.accent || (d.appearance && d.appearance.accent) || "graphite";
  function change(patch) {
    setChosen({ ...chosen, ...patch });
    saveSettings({ theme, accent, ...patch });
  }

  return html`
    <div class="p-settings">
      <${PageHeader} title="Settings" />

      <${Section} title="Appearance">
        <${Card}>
          <div class="p-settings__group" role="group" aria-labelledby="set-theme">
            <h3 id="set-theme" class="p-settings__label">Theme</h3>
            <div class="p-settings__themes">
              ${THEMES.map((t) => html`
                <button key=${t.id} type="button" class=${`k-btn k-btn--${theme === t.id ? "primary" : "plain"} k-btn--md`}
                  aria-pressed=${theme === t.id ? "true" : "false"} onClick=${() => change({ theme: t.id })}>${t.label}</button>`)}
            </div>
          </div>
          <div class="p-settings__group" role="radiogroup" aria-labelledby="set-accent">
            <h3 id="set-accent" class="p-settings__label">Accent colour</h3>
            <div class="p-settings__swatches">
              ${(d.accents || []).map((a) => html`
                <label key=${a.id} class="p-settings__swatch">
                  <input type="radio" name="accent" value=${a.id} checked=${accent === a.id} onChange=${() => change({ accent: a.id })} />
                  <span class=${`p-settings__dot p-settings__dot--${String(a.id).replace(/[^a-z]/g, "")}`} aria-hidden="true"></span>
                  <span>${a.label}</span>
                </label>`)}
            </div>
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
