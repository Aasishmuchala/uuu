// App Studio (PLAN-V5 K17, K22, K23, T80; PLAN-COOK T60, TB2, R5-F): the apps that run on this Mac, as rows in one
// card under a bar that filters them (all, on, off): each row its 32 px tile (its own picture, else its initials), its
// name and its state as a one-line chip, what it does and one meta row (what it may spend today, the model it thinks
// with); at the right Open while it runs or starts and its switch, Turn on or Turn off; under them, across the row,
// what the fence does not cover (T86: in full while the app is off, short while it is on); then the sites the team
// made (T88) as a group of cards.
// Everything comes from GET /api/apps; every POST answers the whole view again, so the page shows that answer.
// An app's name, its line and every sentence are shown as plain capped text, never as HTML. The pure helpers here
// are shared with pages/app.js (one app opened inside).
// PLAN-3D-ALL U14: a surface screen. The title, its line and the bar stand in the room header (kit/room.js) with
// the terrace's glimpse behind them, from 860 px only (on a phone the band is a title strip with no picture). The
// rows stay on the ground; each app's full sentence stays beside Turn on, never over the picture (ADR 0016).
import { html, useCallback, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api, useVisibleInterval } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { Button, Card, Empty, ErrorNotice, Icon, Loading, NextStep, Notice, RoomHeader, Section, Segmented, St, Tag, Tile, Time, glimpseFor, previewAddress, safeViewUrl, siteAddress, tintFor } from "../kit/index.js";

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
  // The list's filter (T60) and what it says when a filter leaves no app.
  show: "Show apps",
  all: "All",
  onlyOn: "On",
  onlyOff: "Off",
  noneOn: "No app is on.",
  noneOff: "Every app is on.",
  // The allowance sheet: why an amount cannot be picked (T60).
  overLeft: "More than is left today",
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

// The same state as the kit's St (a glyph and the words): { tone, icon }.
const ST_OF = {
  on: { tone: "good", icon: "check" }, starting: { tone: "neutral", icon: "clock" }, off: { tone: "neutral", icon: "power" },
  failed: { tone: "bad", icon: "alert" }, not_installed: { tone: "neutral", icon: "clock" }, damaged: { tone: "bad", icon: "alert" },
  host_off: { tone: "warn", icon: "alert" },
};
export const stateSt = (shown) => ST_OF[shown] || ST_OF.off;

// The same state as the kit's Tag, a one-line chip (TB2): on good, starting info, off and not ready neutral, stopped
// and damaged bad, waiting for App Studio warn.
const TAG_OF = { on: "good", starting: "info", off: "neutral", failed: "bad", not_installed: "neutral", damaged: "bad", host_off: "warn" };
export const stateTag = (shown) => TAG_OF[shown] || TAG_OF.off;

// The tile's words when an app has no picture: the first letters of its first and last words ("Render to Film" ->
// "RF", "broken-app" -> "BA", "Storyboard" -> "S"), or "?" for no name.
export function initials(name) {
  const words = plain(name, 60).split(/[\s_-]+/).filter(Boolean);
  const ends = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  const out = ends.map((w) => Array.from(w)[0] || "").join("").toUpperCase();
  return out || "?";
}

// A money sentence as sent, cut into its words and its amounts, so the amounts can be set in tabular figures without
// a word changing: "Allowed today: $5.00. Spent: $1.20." -> [{ text: "Allowed today: " }, { text: "$5.00", money: true }, …].
export function moneyParts(text) {
  return String(text ?? "").split(/(\$[0-9][0-9,]*(?:\.[0-9]+)?)/).filter((t) => t !== "").map((t) => (/^\$[0-9]/.test(t) ? { text: t, money: true } : { text: t }));
}
export function MoneyWords({ text, cls }) {
  return html`<span class=${cls}>${moneyParts(text).map((p) => (p.money ? html`<span class="p-money">${p.text}</span>` : p.text))}</span>`;
}

// The list's filter: "all", "on" (switched on) or "off". -> the apps it keeps.
export const FILTERS = Object.freeze(["all", "on", "off"]);
export function filterApps(apps, filter) {
  const list = arr(apps);
  if (filter === "on") return list.filter((a) => obj(a) && a.on === true);
  if (filter === "off") return list.filter((a) => obj(a) && a.on !== true);
  return list;
}

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

// The same as a control's label or a meta fact: no full stop (TB2). "Thinks with Claude Opus 5.5".
export const thinksShort = (thinks) => thinksLabel(thinks).replace(/\.$/, "");

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

// The app's picture at `size` px, or, when it has none or it cannot be loaded, its initials on the kit's Tile in the
// app's own quiet tint (R5-F; never an empty square). `cls` is the page's own class.
// `has: false` (the server's record says the app has no picture) draws the initials without asking for one.
export function AppIcon({ slug, name, size, cls, has = true }) {
  const [broken, setBroken] = useState(false);
  const src = has ? iconHref(slug) : null;
  if (!src || broken) {
    const s = size === 28 ? 28 : 32;
    return html`<span class=${`${cls} ${cls}--none`} aria-hidden="true"><${Tile} text=${initials(name || slug)} tint=${tintFor(slug)} size=${s} /></span>`;
  }
  return html`<img class=${cls} src=${src} alt="" width=${size} height=${size} onError=${() => setBroken(true)} />`;
}

// The restart sentence (rule 11), as written.
export function Restart() {
  return html`<${Empty} icon="power" text=${WORDS.restart} />`;
}

// ---------------------------------------------------------------------------------------------------------------
// The list

// The model in the meta row: its name, "Thinks with " said to a screen reader and on hover (the glyph says it to the
// eye), so the row stays one line beside what it may spend.
function thinksMeta(label) {
  const m = /^(Thinks with )(.+)$/.exec(label);
  return m ? html`<span class="k-sr">${m[1]}</span>${m[2]}` : label;
}

// One app, a row of the list (R5-F): its 32 px picture; its name and state chip, what it does and one meta row (what
// it may spend today, the model it thinks with); at the right Open (the filled one only while it runs) and its switch,
// a small ghost; under them, across the row's width, what the fence does not cover (T86: in full while the app is
// off, short while it is on). A row is as tall as what it holds.
function AppRow({ app, host, view }) {
  const { announce } = useApp() || {};
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);
  const shown = shownState(app, host);
  const name = plain(app.name, 40) || app.slug;
  const about = plain(app.about, 120);
  const href = appHref(app.slug);
  // The meta row: what it may spend today while it may, and the model it thinks with once one is picked.
  const spending = spends(app) && app.spending.open;
  const thinks = obj(app.thinks) && (app.thinks.name || app.thinks.model) ? thinksShort(app.thinks) : "";

  const turn = async (on) => {
    setBusy(on ? "on" : "off");
    setError(null);
    const r = await postApp(view, app.slug, "switch", { on });
    setBusy("");
    if (r.error) setError(r.error);
    else if (announce) announce(`${name}: ${on ? "turned on" : "turned off"}.`);
  };

  const canOpen = shown === "on" || shown === "starting";
  // Open while it runs (the filled one) or starts; its page waits for it.
  const open = canOpen && href
    ? html`<${Button} size="sm" variant=${shown === "on" ? "primary" : "ghost"} href=${href} class="p-apps__main">${WORDS.open}<//>`
    : null;
  // Its switch beside Open: Turn off while switched on (open, starting or stopped), Turn on while off; an app that is
  // not ready or damaged has neither.
  const toggle = app.on
    ? html`<${Button} variant="ghost" size="sm" class="p-apps__switch" busy=${busy === "off"} onClick=${() => turn(false)}>${WORDS.turnOff}<//>`
    : shown === "off"
      ? html`<${Button} variant="ghost" size="sm" class="p-apps__switch" busy=${busy === "on"} onClick=${() => turn(true)}>${WORDS.turnOn}<//>`
      : null;
  const trust = toggle ? (app.on ? WORDS.trustShort : WORDS.trust) : "";
  return html`<li class=${`p-apps__tile p-apps__tile--${shown}`}>
    <${AppIcon} slug=${app.slug} name=${name} size=${32} cls="p-apps__icon" has=${app.icon != null} />
    <div class="p-apps__info">
      <div class="p-apps__names">
        <h3 class="p-apps__name">${name}</h3>
        <span class="p-apps__state"><${Tag} tone=${stateTag(shown)}>${stateWord(shown)}<//></span>
      </div>
      ${about ? html`<p class="p-apps__about">${about}</p>` : null}
      ${spending || thinks
        ? html`<p class="p-apps__facts">
            ${spending ? html`<span class="p-apps__spend"><${Icon} name="tag" size=${14} /><${MoneyWords} text=${spendingLine(app)} /></span>` : null}
            ${thinks ? html`<span class="p-apps__fact" title=${thinks}><${Icon} name="brain" size=${14} /><span>${thinksMeta(thinks)}</span></span>` : null}
          </p>`
        : null}
      ${shown === "failed" ? html`<p class="p-apps__hint">${WORDS.tryAgain} <a href="#/health">${WORDS.health}</a></p>` : null}
      <${Refusal} error=${error} />
    </div>
    ${open || toggle ? html`<div class="p-apps__acts">${open}${toggle}</div>` : null}
    ${trust ? html`<p class="p-apps__trust">${trust}</p>` : null}
  </li>`;
}

// One site the team made: its picture (the top of the first page), its name, its task and when, and Open, which loads
// it into the preview and opens that address in a new tab (only the preview's own address); the task's page holds the
// rest.
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
  return html`<${Card} padding="none" class="p-apps__site">
    <div class="p-apps__shot">
      ${site.picture
        ? html`<img src=${site.picture} alt="" loading="lazy" />`
        : html`<span class="p-apps__noshot"><${Icon} name="image" size=${16} /><span>${WORDS.noPicture}</span></span>`}
    </div>
    <div class="p-apps__site-body">
      <div class="p-apps__site-head">
        <h3 class="p-apps__site-name">${site.name}</h3>
        <${Button} size="sm" icon="external" busy=${busy} onClick=${open}>${WORDS.open}<//>
      </div>
      <p class="p-apps__site-task">
        <a href=${site.href}>${site.identifier ? `${site.identifier}: ` : ""}${site.title}</a>
        ${site.at ? html` <${Time} at=${site.at} />` : null}
      </p>
      <${Refusal} error=${error} />
      ${error ? html`<div class="p-apps__actions"><${Button} variant="quiet" size="sm" href=${site.href}>${WORDS.openTask}<//></div>` : null}
    </div>
  <//>`;
}

// True while the window is 860 px wide or more: only then does the band ask for its picture (as Settings and Files).
// Where the window cannot be asked (no matchMedia) the band asks for none: the page's own pictures stay the only ones.
const WIDE = "(min-width: 860px)";
function useWide() {
  const read = () => typeof matchMedia === "function" && matchMedia(WIDE).matches === true;
  const [wide, setWide] = useState(read);
  useEffect(() => {
    if (typeof matchMedia !== "function") return undefined;
    const mq = matchMedia(WIDE);
    const again = () => setWide(mq.matches === true);
    if (mq.addEventListener) mq.addEventListener("change", again);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", again); };
  }, []);
  return wide;
}

export default function AppsPage() {
  const wide = useWide();
  const [fast, setFast] = useState(false);
  const [filter, setFilter] = useState("all");
  const view = useAppsView(fast ? 2000 : 10000);
  const data = obj(view.data) ? view.data : null;
  const host = data && obj(data.host) ? data.host : { state: "off", sentence: "" };
  const apps = appsOf(data);
  const sites = sitesOfView(data);
  const starting = apps.some((a) => shownState(a, host) === "starting");
  useEffect(() => { setFast(starting); }, [starting]);
  const shownApps = filterApps(apps, filter);

  const restart = view.error && view.error.status === 404;
  // The bar: the filter at the left; at the right, while App Studio is on, its own sentence (when it is off the notice
  // under the bar says so, with its command, once).
  const bar = data && apps.length
    ? html`<div class="p-apps__bar">
        <${Segmented} label=${WORDS.show} size="sm" current=${filter} onChange=${setFilter} items=${[
          { id: "all", label: WORDS.all, count: apps.length },
          { id: "on", label: WORDS.onlyOn, count: filterApps(apps, "on").length },
          { id: "off", label: WORDS.onlyOff, count: filterApps(apps, "off").length },
        ]} />
        ${host.state === "on" && host.sentence
          ? html`<span class="p-apps__host"><${St} tone="good" icon="power">${plain(host.sentence, 120)}<//></span>`
          : null}
      </div>`
    : null;
  return html`<div class="p-apps">
    <${RoomHeader} glimpse=${wide ? glimpseFor("apps") : null} pull strip title=${WORDS.title} lead=${WORDS.intro}>${bar}<//>
    ${view.loading && !data ? html`<${Loading} label="Loading App Studio" />` : null}
    ${restart ? html`<${Restart} />` : null}
    ${view.error && !restart ? html`<${ErrorNotice} error=${view.error} onRetry=${view.reload} />` : null}
    ${data
      ? html`
        ${host.state !== "on" && host.sentence ? html`<${Notice} tone="warn"><${NextStep} text=${plain(host.sentence, 300)} /><//>` : null}
        ${data.problemSentence ? html`<${Notice} tone="warn">${plain(data.problemSentence, 300)}<//>` : null}
        <${Section} title="Your apps" count=${shownApps.length || undefined}>
          ${shownApps.length
            ? html`<${Card} padding="none" class="p-apps__list"><ul class="p-apps__rows">${shownApps.map((a) => html`<${AppRow} key=${a.slug} app=${a} host=${host} view=${view} />`)}</ul><//>`
            : apps.length
              ? html`<${Empty} icon="apps" title=${filter === "on" ? WORDS.noneOn : WORDS.noneOff} />`
              : html`<${Empty} icon="apps" title=${WORDS.noApps} />`}
        <//>
        <${Section} title=${WORDS.team} count=${sites.length || undefined}>
          ${sites.length
            ? html`<div class="p-apps__sites">${sites.map((x) => html`<${SiteTile} key=${`${x.id}/${x.ref}`} site=${x} />`)}</div>`
            : html`<${Empty} icon="globe" text=${WORDS.teamEmpty} />`}
        <//>`
      : null}
  </div>`;
}
