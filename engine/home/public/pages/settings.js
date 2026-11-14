// Settings (PLAN-COOK T53): a list of sections and one readable column (kit/layout.js DocLayout). Appearance and Later
// are drawn here; Models, Web, Generation and Page viewer are each their own module (pages/settings-models.js,
// settings-web.js, settings-generation.js, settings-viewer.js), drawn inside the column. The chosen section is in the
// address: "#/settings?s=generation"; no `s` is Appearance.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { currentMotion, currentTheme } from "../lib/theme.js";
import { Button, DocLayout, ErrorNotice, Group, Loading, Row, Rows, Segmented, Switch } from "../kit/index.js";
import ModelsSection, * as models from "./settings-models.js";
import WebSection, * as web from "./settings-web.js";
import GenerationSection, * as generation from "./settings-generation.js";
import ViewerSection, * as viewer from "./settings-viewer.js";

export const THEMES = [
  { id: "auto", label: "Auto" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

// The sidebar's width, chosen here and kept in this browser by the shell (setSide). "auto" is the shell's own rule.
export const SIDES = [
  { id: "open", label: "Names" },
  { id: "icons", label: "Icons" },
  { id: "auto", label: "Automatic" },
];

// What a section's line in the list says when its module cannot say yet.
export const NOT_KNOWN = "Not known yet";

// The sections, in order. A door's module may export statusLine(data), read from the answer at `from` (the address
// the module itself loads); the list and the section's head show it.
export const SECTIONS = [
  { id: "appearance", label: "Appearance", icon: "sun" },
  { id: "models", label: "Models", icon: "chip", from: "/api/models", mod: models, Body: ModelsSection },
  { id: "web", label: "Web", icon: "globe", from: "/api/web", mod: web, Body: WebSection },
  { id: "generation", label: "Generation", icon: "film", from: "/api/generation", mod: generation, Body: GenerationSection },
  { id: "viewer", label: "Page viewer", icon: "eye", from: "/api/viewer", mod: viewer, Body: ViewerSection },
  { id: "later", label: "Later", icon: "clock" },
];

const IDS = SECTIONS.map((s) => s.id);

// The section an address asks for: `s`, else the way back from Higgsfield's page (`generation=connected|failed`,
// which settings-generation.js reads and takes out), else Appearance.
export function sectionOf(query) {
  const get = (k) => (query && typeof query.get === "function" ? query.get(k) : null);
  const s = get("s");
  if (IDS.includes(s)) return s;
  if (get("generation") === "connected" || get("generation") === "failed") return "generation";
  return "appearance";
}

// The address of a section.
export const sectionHref = (id) => (id === "appearance" || !IDS.includes(id) ? "#/settings" : `#/settings?s=${id}`);

const TONES = ["good", "warn", "bad", "neutral"];

// What a module's statusLine(data) said -> { tone, text }; words alone are neutral. Anything else, a throw, or no
// answer yet is the plain fallback.
export function statusOf(fn, data) {
  const fallback = { tone: "neutral", text: NOT_KNOWN };
  if (typeof fn !== "function" || data === null || data === undefined) return fallback;
  let said;
  try { said = fn(data); } catch { return fallback; }
  if (typeof said === "string") return said.trim() ? { tone: "neutral", text: said.trim().slice(0, 60) } : fallback;
  if (said && typeof said === "object" && typeof said.text === "string" && said.text.trim()) {
    return { tone: TONES.includes(said.tone) ? said.tone : "neutral", text: said.text.trim().slice(0, 60) };
  }
  return fallback;
}

// Appearance's line: the theme's word.
export const appearanceLine = (theme) => ({ tone: "neutral", text: (THEMES.find((t) => t.id === theme) || THEMES[2]).label });

// Later's line: "5 things, all off".
export function laterLine(later) {
  const n = Array.isArray(later) ? later.length : 0;
  if (!n) return { tone: "neutral", text: NOT_KNOWN };
  return { tone: "neutral", text: n === 1 ? "1 thing, off" : `${n} things, all off` };
}

// Each thing that may come later, its line icon.
const LATER_ICONS = { local_model: "chip", chat_apps: "reply", workflow_engine: "layers", pixel_editor: "brush", aseprite_files: "image" };

// ---- the sidebar's width -----------------------------------------------------------------------------------------
// The shell keeps the owner's choice and tells pages only what it draws (side: "open", "icons" or "none"), so the row
// shows what is drawn, and Automatic once the owner has picked it here. This page does not change the width itself.
export function sideShown(side, picked) {
  if (picked === "auto" || picked === "open" || picked === "icons") return picked;
  return side === "icons" ? "icons" : side === "open" ? "open" : "auto";
}

// ---- the two sections drawn here ---------------------------------------------------------------------------------
function Appearance({ theme, motion, sideChoice, onTheme, onMotion, onSide }) {
  return html`<${Group}>
    <${Rows}>
      <${Row} icon="moon" title="Theme" say="Auto follows this Mac's own setting."
        control=${html`<${Segmented} label="Theme" items=${THEMES} current=${theme} onChange=${onTheme} />`} />
      <${Row} icon="sidebar" title="Sidebar" say="Automatic hides the names beside work and in a narrow window."
        control=${html`<${Segmented} label="Sidebar" items=${SIDES} current=${sideChoice} onChange=${onSide} />`} />
      <${Row} icon="loop" title="Motion" say="Panels slide open. Off, everything changes at once."
        control=${html`<${Switch} on=${motion !== "off"} label="Motion" onChange=${onMotion} />`} />
    <//>
  <//>`;
}

function Later({ later }) {
  const [technical, setTechnical] = useState(false);
  const list = Array.isArray(later) ? later.filter((l) => l && typeof l.id === "string") : [];
  return html`<${Group}>
    <${Rows}>
      ${list.map((l) => html`<${Row} key=${l.id} icon=${LATER_ICONS[l.id] || "clock"} title=${l.label}
        say=${html`<span class="p-settings__lines">
          <span>${l.explain}</span>
          ${technical ? html`<span>${l.cost}</span><span>${l.how}</span>` : null}
          ${technical && l.technical ? html`<span class="p-settings__tech">${l.technical}</span>` : null}
        </span>`}
        control=${html`<${Switch} on=${false} disabled=${true} label=${l.label} />`} />`)}
    <//>
    ${list.some((l) => l.technical)
      ? html`<div class="p-settings__foot">
          <${Button} variant="quiet" size="sm" aria-expanded=${technical ? "true" : "false"} onClick=${() => setTechnical(!technical)}>
            ${technical ? "Hide technical details" : "Show technical details"}<//>
        </div>`
      : null}
  <//>`;
}

const INTRO = {
  appearance: "How the home screen looks. A change applies at once and is kept.",
  later: "What could be added later. None of it is built yet, so each stays off.",
};

export default function Page({ route }) {
  const app = useApp() || {};
  const { saveSettings, setTop, side, setSide } = app;
  const current = sectionOf(route && route.query);
  const res = useResource("/api/settings");
  const [chosen, setChosen] = useState({});
  const [sidePicked, setSidePicked] = useState(null);
  const d = res.data;

  // The doors' state lines, from what each module loads, for the modules that can say.
  const lines = {};
  const answers = {
    models: useResource(typeof models.statusLine === "function" ? "/api/models" : null, { every: 30000 }),
    web: useResource(typeof web.statusLine === "function" ? "/api/web" : null, { every: 30000 }),
    generation: useResource(typeof generation.statusLine === "function" ? "/api/generation" : null, { every: 30000 }),
    viewer: useResource(typeof viewer.statusLine === "function" ? "/api/viewer" : null, { every: 30000 }),
  };
  for (const s of SECTIONS) if (s.mod) lines[s.id] = statusOf(s.mod.statusLine, answers[s.id].data);

  // What is on screen wins over what the server keeps: "?theme=" and "?motion=" hold for this visit.
  const theme = chosen.theme || currentTheme() || (d && d.appearance && d.appearance.theme) || "dark";
  const motion = chosen.motion || currentMotion() || (d && d.appearance && d.appearance.motion) || "on";
  lines.appearance = appearanceLine(theme);
  lines.later = d ? laterLine(d.later) : { tone: "neutral", text: NOT_KNOWN };
  function change(patch) {
    setChosen({ ...chosen, ...patch });
    if (typeof saveSettings === "function") saveSettings({ theme, motion, ...patch });
  }

  const here = SECTIONS.find((s) => s.id === current) || SECTIONS[0];
  const company = app.shell && app.shell.company && app.shell.company.name;
  useEffect(() => {
    if (typeof document !== "undefined") document.title = [`Settings, ${here.label}`, company].filter(Boolean).join(" · ");
    if (typeof setTop === "function") setTop({ crumbs: [{ label: "Settings", href: "#/settings" }, { label: here.label }] });
  }, [here.id, company, setTop]);

  // A new section starts at the top, and on a phone its name is brought into the row of names.
  const first = useRef(true);
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!first.current && typeof window.scrollTo === "function") window.scrollTo(0, 0);
    first.current = false;
    const pick = document.querySelector(".p-settings .k-doc__pick[aria-current]");
    if (pick && typeof pick.scrollIntoView === "function") pick.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current]);

  const sections = SECTIONS.map((s) => ({ id: s.id, label: s.label, icon: s.icon, href: sectionHref(s.id), status: lines[s.id] }));
  const headState = here.mod && lines[here.id].text !== NOT_KNOWN ? lines[here.id] : null;

  let body;
  if (here.Body) body = html`<${here.Body} />`;
  else if (!d) {
    body = html`${res.loading ? html`<${Loading} lines=${4} label="Loading your settings" />` : null}
      ${res.error ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}`;
  } else if (here.id === "later") body = html`<${Later} later=${d.later} />`;
  else {
    body = html`<${Appearance} theme=${theme} motion=${motion} sideChoice=${sideShown(side, sidePicked)}
      onTheme=${(id) => change({ theme: id })}
      onMotion=${(on) => change({ motion: on ? "on" : "off" })}
      onSide=${(id) => { setSidePicked(id); if (typeof setSide === "function") setSide(id === "open" || id === "icons" ? id : null); }} />`;
  }

  return html`<div class=${`p-settings p-settings--${here.id}`}>
    <${DocLayout} title=${here.label} state=${headState} intro=${INTRO[here.id]} sections=${sections} current=${here.id}>
      ${body}
    <//>
  </div>`;
}
