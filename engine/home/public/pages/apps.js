// App Studio (PLAN-V5 K17, K22, K23, T80): the apps that run on this Mac, each a large tile with its picture, its
// name, what it does and its state, with Open, Turn on and Turn off, and beside the switch what the fence does not
// cover (T86: in full while the app is off, short while it is on); then the sites the team made (T88).
// Everything comes from GET /api/apps; every POST answers the whole view again, so the page shows that answer.
// An app's name, its line and every sentence are shown as plain capped text, never as HTML. The pure helpers here
// are shared with pages/app.js (one app opened inside).
import { html, useCallback, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api, useVisibleInterval } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { Button, Card, Empty, ErrorNotice, Icon, Loading, NextStep, Notice, PageHeader, Section, StatusDot, Time, previewAddress, safeViewUrl, siteAddress } from "../kit/index.js";

// K23's words, as written, and the few these pages add.
export const WORDS = {
  title: "App Studio",
  intro: "Apps that run on this Mac. They reach Runway and Higgsfield only through the engine, inside the limits in Settings.",
  open: "Open",
  turnOn: "Turn on",
  turnOff: "Turn off",
  ownWindow: "Open in its own window",
  noSpending: "This app cannot spend anything right now.",
  allow: "Allow spending",
  stop: "Stop spending",
  sheetBody: "Each picture or clip shows its price before you make it. This ends at midnight.",
  team: "Made by the team",
  teamEmpty: "Sites the Builder makes appear here after you accept them.",
  noApps: "No apps are on this Mac yet.",
  restart: "This page appears after the home screen is restarted: engine stop, then engine start.",
  noApp: "App Studio has no app by that name.",
  noProvider: "Add a Runway key or sign in to Higgsfield in Settings first.",
  tryAgain: "Turn it off, then on, to try again.",
  late: "It is taking longer than a minute to start.",
  checkAgain: "Check again",
  health: "Open Health",
  back: "App Studio",
  waitsForHost: "Waits for App Studio.",
  openTask: "Open the task",
  badPreview: "The preview gave an address this page does not open.",
  noPicture: "No picture yet",
  badHost: "Apps open only when the home screen is opened at 127.0.0.1 or localhost.",
  checking: "Checking the app…",
  // What the fence does not cover (T85 finding 1, ADR 0016): in full beside Turn on, short while the app is on.
  trust: "This app's own program runs inside the fence: it cannot reach the internet or your files. Its page runs in your browser, and a page in your browser can still reach the internet, as any web page can. Turn on only an app whose code you trust.",
  trustShort: "This app's page runs in your browser and can reach the internet. Its program cannot.",
};

// K23's card states (the server sends the same words; these are used when it sends none).
export const STATE_WORDS = {
  off: "Off",
  starting: "Starting…",
  on: "On",
  failed: "Stopped. It could not start.",
  not_installed: "Not ready yet.",
  damaged: "This app's description is damaged.",
};
const STATE_TONES = { off: "off", starting: "wait", on: "ok", failed: "bad", not_installed: "wait", damaged: "bad", host_off: "warn" };

export const SLUG = /^[a-z0-9][a-z0-9-]{0,23}$/;
// K17: an app's port is its manifest's, 3171 to 3189.
export const APP_PORTS = Object.freeze({ first: 3171, last: 3189 });
// The two names the home screen is opened by; an app is framed by the same one (its content policy names both).
const HOSTNAMES = ["127.0.0.1", "localhost"];
// K22, K23: the four amounts of the allowance sheet, in cents: whole dollars only, as the server takes them.
export const AMOUNTS = Object.freeze([200, 500, 1000, 2000]);
export const FIRST_AMOUNT = 500;

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);

// Plain text: control and invisible characters taken out, at most `n` characters.
export const plain = (v, n = 200) => String(v ?? "")
  .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "")
  .slice(0, n);

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (tested in test/pages/apps.test.mjs and test/pages/app.test.mjs)

// The address an app is framed at: the home's own hostname and the app's own port, or null for any other hostname
// or a port outside 3171 to 3189. Never an address from an app's own text.
export function appAddress(hostname, port) {
  if (!HOSTNAMES.includes(hostname)) return null;
  if (!Number.isInteger(port) || port < APP_PORTS.first || port > APP_PORTS.last) return null;
  return `http:${"//"}${hostname}:${port}/`;
}

// "#/apps/<slug>" for a good slug, else null.
export const appHref = (slug) => (typeof slug === "string" && SLUG.test(slug) ? `#/apps/${slug}` : null);

// The app's picture, by its slug only (the home server's own route).
export const iconHref = (slug) => (typeof slug === "string" && SLUG.test(slug) ? `/api/apps/${slug}/icon` : null);

// Cents as the owner reads them in a choice: 500 -> "$5", 250 -> "$2.50".
export function dollarWord(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "$0";
  return n % 100 === 0 ? `$${n / 100}` : `$${(n / 100).toFixed(2)}`;
}

// What the owner sees of an app's state: the server's state, read with its switch and the host. An app switched on
// that the host has not started yet is "starting"; one switched off is "off" however the host is still winding it
// down; with App Studio itself not on, an app switched on shows the host's sentence ("host_off").
export function shownState(app, host) {
  const a = obj(app) ? app : {};
  const s = Object.hasOwn(STATE_WORDS, a.state) ? a.state : "off";
  if (s === "damaged" || s === "not_installed") return s;
  if (!a.on) return "off";
  if (obj(host) && host.state && host.state !== "on") return "host_off";
  if (s === "failed") return "failed";
  if (s === "on") return "on";
  return "starting";
}

// The sentence for a shown state.
export function stateSentence(shown, host) {
  if (shown === "host_off") return plain(obj(host) && host.sentence, 300) || "App Studio is off.";
  return STATE_WORDS[shown] || STATE_WORDS.off;
}

// The short word beside an app's mark: its state, or, while App Studio itself is not on, that it waits for it (the
// page says why and what to do, once, above the apps).
export function stateWord(shown) {
  if (shown === "host_off") return WORDS.waitsForHost;
  return STATE_WORDS[shown] || STATE_WORDS.off;
}

// The mark beside it: a tone of the kit's StatusDot.
export const stateTone = (shown) => STATE_TONES[shown] || "off";

// True when the app makes pictures or clips, so it has an allowance (the server sends limitWords only then).
export const spends = (app) => obj(app) && obj(app.spending) && typeof app.spending.limitWords === "string";

// The spending bar's words: K23's "Allowed today: $5.00. Spent: $1.20." or "This app cannot spend anything right now."
export function spendingLine(app) {
  const s = obj(app) && obj(app.spending) ? app.spending : {};
  return plain(s.words, 200) || WORDS.noSpending;
}

// The sheet's choices for what is left of today's limit (cents): [{ cents, label, disabled }].
export function amountChoices(limitLeft) {
  const left = Number.isInteger(limitLeft) ? limitLeft : 0;
  return AMOUNTS.map((cents) => ({ cents, label: dollarWord(cents), disabled: cents > left }));
}

// The choice picked when the sheet opens: $5, or the largest that fits, or null when none does.
export function firstAmount(limitLeft) {
  const fits = amountChoices(limitLeft).filter((c) => !c.disabled);
  if (fits.some((c) => c.cents === FIRST_AMOUNT)) return FIRST_AMOUNT;
  return fits.length ? fits[fits.length - 1].cents : null;
}

// The sheet's title and button: "Let Render to Film spend today", "Allow $5 today".
export const sheetTitle = (name) => `Let ${plain(name, 40)} spend today`;
export const allowLabel = (cents) => `Allow ${dollarWord(cents)} today`;

// "Thinks with Claude Opus 5.5." or, before a model is picked, the menu's plain name.
export function thinksLabel(thinks) {
  const t = obj(thinks) ? thinks : {};
  const name = plain(t.name || t.model, 60);
  return name ? `Thinks with ${name}.` : "Choose how it thinks";
}

// The apps of the view, the good ones only (a slug the routes accept).
export const appsOf = (view) => arr(obj(view) ? view.apps : null).filter((a) => obj(a) && typeof a.slug === "string" && SLUG.test(a.slug));

// The sites the team made (T88), the good ones only: a task the board names, a ref the sites route accepts, at most
// 30. The picture is the home server's own address or none; the task's page is worked out here from its id.
const TASK_ID = /^[A-Za-z0-9._-]{1,64}$/;
const SITE_REF = /^[a-z0-9][a-z0-9-]{0,35}(-[abc])?$/;
const SITES_SHOWN = 30;
export function sitesOfView(view) {
  const out = [];
  for (const s of arr(obj(view) ? view.sites : null)) {
    if (out.length >= SITES_SHOWN) break;
    if (!obj(s) || !obj(s.task) || typeof s.task.id !== "string" || !TASK_ID.test(s.task.id)) continue;
    if (typeof s.ref !== "string" || !SITE_REF.test(s.ref)) continue;
    const identifier = typeof s.task.identifier === "string" && TASK_ID.test(s.task.identifier) ? s.task.identifier : "";
    out.push({
      id: s.task.id,
      identifier,
      title: plain(s.task.title, 120),
      ref: s.ref,
      name: plain(s.direction || s.name, 60) || s.ref,
      at: typeof s.finishedAt === "string" ? s.finishedAt : null,
      picture: safeViewUrl(s.picture),
      sentence: plain(s.sentence, 200),
      pages: arr(s.pages).length,
      href: `#/tasks/${encodeURIComponent(s.task.id)}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The view, shared with pages/app.js

// GET /api/apps, refreshed quietly every `every` ms while the tab is visible; `take(view)` shows a POST's answer at
// once (a GET already on its way is then ignored). -> { data, error, loading, reload, take }.
export function useAppsView(every) {
  const [s, setS] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const load = useCallback(async (quiet) => {
    const n = ++seq.current;
    if (!quiet) setS((p) => ({ data: p.data, error: null, loading: true }));
    try {
      const data = await api.get("/api/apps");
      if (n === seq.current) setS({ data, error: null, loading: false });
    } catch (error) {
      if (n !== seq.current) return;
      setS((p) => (quiet && p.data ? { ...p, loading: false } : { data: null, error, loading: false }));
    }
  }, []);
  useEffect(() => { load(false); }, []);
  useVisibleInterval(() => load(true), every);
  const take = useCallback((data) => {
    seq.current += 1;
    if (obj(data)) setS({ data, error: null, loading: false });
  }, []);
  return { ...s, reload: () => load(false), refresh: () => load(true), take };
}

// One POST to an app's route. -> { ok: true } with the view taken, or { error } (a 404 says to restart).
export async function postApp(view, slug, what, body) {
  try {
    const answer = await api.post(`/api/apps/${slug}/${what}`, body);
    view.take(answer);
    return { ok: true, view: answer };
  } catch (error) {
    if (error && error.status === 404 && error.code !== "no_app") return { error: { message: WORDS.restart, next: "" } };
    return { error };
  }
}

// A refusal's sentence and what to do, in a notice.
export function Refusal({ error }) {
  if (!error) return null;
  const message = plain(error.message, 300) || "That did not work.";
  const next = plain(error.next, 300);
  return html`<div class="k-notice k-notice--bad" role="alert">
    <${Icon} name="alert" size=${16} class="k-notice__icon" />
    <div class="k-notice__body">
      <p class="k-notice__title">${message}</p>
      ${next ? html`<div class="k-notice__text"><${NextStep} text=${next} /></div>` : null}
    </div>
  </div>`;
}

// The app's picture at `size` px, or the kit's apps mark when it cannot be loaded. `cls` is the page's own class.
export function AppIcon({ slug, size, cls }) {
  const [broken, setBroken] = useState(false);
  const src = iconHref(slug);
  if (!src || broken) {
    return html`<span class=${`${cls} ${cls}--none`} aria-hidden="true"><${Icon} name="apps" size=${Math.round(size / 2)} /></span>`;
  }
  return html`<img class=${cls} src=${src} alt="" width=${size} height=${size} onError=${() => setBroken(true)} />`;
}

// The restart sentence (rule 11), as written.
export function Restart() {
  return html`<${Empty} text=${WORDS.restart} />`;
}

// ---------------------------------------------------------------------------------------------------------------
// The list

function Tile({ app, host, view }) {
  const { announce } = useApp() || {};
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);
  const shown = shownState(app, host);
  const name = plain(app.name, 40) || app.slug;
  const about = plain(app.about, 120);
  const href = appHref(app.slug);

  const turn = async (on) => {
    setBusy(on ? "on" : "off");
    setError(null);
    const r = await postApp(view, app.slug, "switch", { on });
    setBusy("");
    if (r.error) setError(r.error);
    else if (announce) announce(`${name}: ${on ? "turned on" : "turned off"}.`);
  };

  const canOpen = shown === "on" || shown === "starting";
  return html`<${Card} padding="lg" class="p-apps__tile">
    <div class="p-apps__tile-head">
      <${AppIcon} slug=${app.slug} size=${56} cls="p-apps__icon" />
      <div class="p-apps__names">
        <h3 class="p-apps__name">${name}</h3>
        <${StatusDot} tone=${stateTone(shown)} label=${stateWord(shown)} pulse=${shown === "starting"} />
      </div>
    </div>
    ${about ? html`<p class="p-apps__about">${about}</p>` : null}
    ${spends(app) && app.spending.open ? html`<p class="p-apps__spend"><${Icon} name="tag" size=${14} /><span>${spendingLine(app)}</span></p>` : null}
    ${shown === "failed" ? html`<p class="p-apps__hint">${WORDS.tryAgain} <a href="#/health">${WORDS.health}</a></p>` : null}
    <${Refusal} error=${error} />
    ${app.on
      ? html`<p class="p-apps__trust">${WORDS.trustShort}</p>`
      : shown === "off" ? html`<p class="p-apps__trust">${WORDS.trust}</p>` : null}
    <div class="p-apps__actions">
      ${canOpen && href ? html`<${Button} variant="primary" href=${href} icon="arrow-right">${WORDS.open}<//>` : null}
      ${app.on
        ? html`<${Button} variant=${canOpen ? "quiet" : "plain"} busy=${busy === "off"} onClick=${() => turn(false)}>${WORDS.turnOff}<//>`
        : shown === "off"
          ? html`<${Button} variant="primary" busy=${busy === "on"} onClick=${() => turn(true)}>${WORDS.turnOn}<//>`
          : null}
    </div>
  <//>`;
}

// One site the team made: its picture (the first page), its name, its task, and Open, which loads it into the preview
// and opens that address in a new tab (only the preview's own address); the task's page holds the rest.
function SiteTile({ site }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const answer = await api.post(siteAddress(site.identifier || site.id, site.ref, "preview"), {});
      const url = previewAddress(answer && answer.url);
      if (!url) setError({ message: WORDS.badPreview, next: "" });
      else if (typeof window !== "undefined" && typeof window.open === "function") window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  };
  return html`<${Card} padding="md" class="p-apps__site">
    <div class="p-apps__shot">
      ${site.picture
        ? html`<img src=${site.picture} alt="" loading="lazy" />`
        : html`<span class="p-apps__noshot">${WORDS.noPicture}</span>`}
    </div>
    <h3 class="p-apps__site-name">${site.name}</h3>
    <p class="p-apps__site-task">
      <a href=${site.href}>${site.identifier ? `${site.identifier}: ` : ""}${site.title}</a>
      ${site.at ? html` <${Time} at=${site.at} />` : null}
    </p>
    <${Refusal} error=${error} />
    <div class="p-apps__actions">
      <${Button} variant="primary" icon="external" busy=${busy} onClick=${open}>${WORDS.open}<//>
      ${error ? html`<${Button} variant="quiet" href=${site.href}>${WORDS.openTask}<//>` : null}
    </div>
  <//>`;
}

export default function AppsPage() {
  const [fast, setFast] = useState(false);
  const view = useAppsView(fast ? 2000 : 10000);
  const data = obj(view.data) ? view.data : null;
  const host = data && obj(data.host) ? data.host : { state: "off", sentence: "" };
  const apps = appsOf(data);
  const sites = sitesOfView(data);
  const starting = apps.some((a) => shownState(a, host) === "starting");
  useEffect(() => { setFast(starting); }, [starting]);

  const restart = view.error && view.error.status === 404;
  return html`<div class="p-apps">
    <${PageHeader} title=${WORDS.title} lead=${WORDS.intro} />
    ${view.loading && !data ? html`<${Loading} label="Loading App Studio" />` : null}
    ${restart ? html`<${Restart} />` : null}
    ${view.error && !restart ? html`<${ErrorNotice} error=${view.error} onRetry=${view.reload} />` : null}
    ${data
      ? html`
        ${host.state !== "on" && host.sentence ? html`<${Notice} tone="warn"><${NextStep} text=${plain(host.sentence, 300)} /><//>` : null}
        ${data.problemSentence ? html`<${Notice} tone="warn">${plain(data.problemSentence, 300)}<//>` : null}
        <${Section} title="Your apps" count=${apps.length || undefined}>
          ${apps.length
            ? html`<div class="p-apps__grid">${apps.map((a) => html`<${Tile} key=${a.slug} app=${a} host=${host} view=${view} />`)}</div>`
            : html`<${Empty} title=${WORDS.noApps} />`}
        <//>
        <${Section} title=${WORDS.team}>
          ${sites.length
            ? html`<div class="p-apps__sites">${sites.map((x) => html`<${SiteTile} key=${`${x.id}/${x.ref}`} site=${x} />`)}</div>`
            : html`<${Empty} text=${WORDS.teamEmpty} />`}
        <//>`
      : null}
  </div>`;
}
