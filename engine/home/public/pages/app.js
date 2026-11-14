// One app opened inside App Studio (PLAN-V5 K17, K22, K23, T80): the whole window under the top bar. On top, the
// home screen's own bar (the app cannot draw over it): back to App Studio, the app's picture, name and state, what
// it may spend today with "Allow spending" or "Stop spending", the model it thinks with, "Open in its own window"
// and the switch. Under it, the app in an iframe at its own port on this Mac (from /api/apps, never from the app's
// text), set only once the app is on; off, starting, stopped and not ready each have their own card. The allowance
// sheet is the kit's dialog: four amounts, those over what is left of today's limit disabled.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { useApp } from "../lib/context.js";
import { Button, Dialog, ErrorNotice, Icon, Loading, Menu, NextStep, StatusDot } from "../kit/index.js";
import {
  AppIcon, Refusal, Restart, SLUG, STATE_WORDS, WORDS, allowLabel, amountChoices, appAddress, appsOf, firstAmount, plain, postApp, sheetTitle,
  shownState, spendingLine, spends, stateSentence, stateTone, stateWord, thinksLabel, useAppsView,
} from "./apps.js";

// Starting: /api/apps is asked every 2 seconds for up to a minute.
export const POLL_STARTING_MS = 2000;
export const STARTING_FOR_MS = 60000;
// On: every 10 seconds, so the bar's spending and state stay true.
export const POLL_ON_MS = 10000;

// The iframe's fixed permissions (T80): scripts, its own origin, forms, downloads and windows of its own, never the
// home screen's address bar.
export const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox";
export const ALLOW = "fullscreen; clipboard-write";

const hostnameNow = () => (typeof location === "undefined" ? "" : String(location.hostname || ""));

// The address of the app's frame from this page's hostname, or null.
export const frameAddress = (app) => appAddress(hostnameNow(), app && app.port);

// Opens the app in a window of its own, with no way back to this one.
export function openOwnWindow(address) {
  if (!address || typeof window === "undefined" || typeof window.open !== "function") return;
  window.open(address, "_blank", "noopener,noreferrer");
}

// The allowance sheet (K22, K23).
function AllowanceSheet({ app, onClose, onAllowed }) {
  const left = app.spending.limitLeft;
  const choices = amountChoices(left);
  const [cents, setCents] = useState(() => firstAmount(left));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ready = !app.ready || app.ready.runway === true || app.ready.higgsfield === true;
  const allow = async () => {
    if (!cents) return;
    setBusy(true);
    setError(null);
    const r = await onAllowed(cents);
    setBusy(false);
    if (r.error) setError(r.error);
  };
  const footer = html`
    <${Button} variant="quiet" onClick=${onClose}>Cancel<//>
    <${Button} variant="primary" busy=${busy} disabled=${!cents || !ready} onClick=${allow}>${allowLabel(cents || 500)}<//>`;
  return html`<${Dialog} open=${true} title=${sheetTitle(app.name)} size="sm" onClose=${onClose} footer=${footer}>
    <div class="p-app__sheet">
      <p class="p-app__sheet-body">${WORDS.sheetBody}</p>
      <div class="p-app__amounts" role="group" aria-label="How much it may spend today">
        ${choices.map((c) => html`<${Button}
          key=${c.cents}
          variant=${c.cents === cents ? "primary" : "plain"}
          class="p-app__amount"
          aria-pressed=${c.cents === cents ? "true" : "false"}
          disabled=${c.disabled}
          data-autofocus=${c.cents === cents ? "" : undefined}
          onClick=${() => setCents(c.cents)}
        >${c.label}<//>`)}
      </div>
      <p class="p-app__left">${plain(app.spending.limitWords, 120)}</p>
      ${ready ? null : html`<p class="p-app__left">${WORDS.noProvider}</p>`}
      <${Refusal} error=${error} />
    </div>
  <//>`;
}

// The card in place of the app while it is not on.
function StageCard({ app, host, shown, late, busy, onTurnOn, onCheck }) {
  const name = plain(app.name, 40) || app.slug;
  let title = "";
  let text = "";
  let action = null;
  if (shown === "off") {
    title = `${name} is off.`;
    action = html`<${Button} variant="primary" busy=${busy} onClick=${onTurnOn}>${WORDS.turnOn}<//>`;
  } else if (shown === "starting") {
    title = late ? WORDS.late : `Starting ${name}…`;
    action = late
      ? html`<${Button} onClick=${onCheck}>${WORDS.checkAgain}<//> <a class="p-app__link" href="#/health">${WORDS.health}</a>`
      : html`<${StatusDot} tone="wait" pulse=${true} label=${STATE_WORDS.starting} hideLabel=${true} />`;
  } else if (shown === "failed") {
    title = stateSentence(shown, host);
    text = WORDS.tryAgain;
    action = html`<a class="p-app__link" href="#/health">${WORDS.health}</a>`;
  } else if (shown === "host_off") {
    return html`<div class="p-app__card" role="status"><p class="p-app__card-title">${name} cannot run right now.</p>
      <${NextStep} text=${stateSentence(shown, host)} /></div>`;
  } else {
    title = stateSentence(shown, host);
  }
  return html`<div class="p-app__card" role="status">
    <p class="p-app__card-title">${title}</p>
    ${text ? html`<p class="p-app__card-text">${text}</p>` : null}
    ${action ? html`<div class="p-app__card-actions">${action}</div>` : null}
  </div>`;
}

// True below 860 px, where the bar is two rows, the model's menu shows only its mark, and a long state is only its
// mark too (the card under the bar says it in full), so the app's name keeps its room.
const NARROW = "(max-width: 859px)";
function useNarrow() {
  const get = () => typeof matchMedia === "function" && matchMedia(NARROW).matches;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== "function") return undefined;
    const m = matchMedia(NARROW);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

export default function AppPage({ route }) {
  const narrow = useNarrow();
  const slug = route && Array.isArray(route.parts) ? route.parts[1] : "";
  const ctx = useApp() || {};
  const [every, setEvery] = useState(POLL_STARTING_MS);
  const view = useAppsView(every);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [waitFrom, setWaitFrom] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const data = view.data && typeof view.data === "object" ? view.data : null;
  const host = data && data.host && typeof data.host === "object" ? data.host : { state: "off", sentence: "" };
  const app = SLUG.test(String(slug || "")) ? appsOf(data).find((a) => a.slug === slug) || null : null;
  const shown = app ? shownState(app, host) : null;
  const late = shown === "starting" && waitFrom !== null && now - waitFrom > STARTING_FOR_MS;
  const name = app ? plain(app.name, 40) || app.slug : "";

  // Starting: ask every 2 seconds for up to a minute, then wait for the owner's "Check again".
  useEffect(() => {
    if (shown === "starting") {
      if (waitFrom === null) setWaitFrom(Date.now());
    } else if (waitFrom !== null) setWaitFrom(null);
  }, [shown]);
  useEffect(() => { setNow(Date.now()); }, [view.data]);
  useEffect(() => {
    setEvery(shown === "starting" ? (late ? 0 : POLL_STARTING_MS) : POLL_ON_MS);
  }, [shown, late]);

  // The window's title, as every page's header sets it.
  const company = ctx.shell?.company?.name || "";
  useEffect(() => {
    if (typeof document === "undefined") return;
    const text = [name || "App Studio", company].filter(Boolean).join(" · ");
    document.title = text;
  }, [name, company]);

  const act = async (what, body, said) => {
    setBusy(what);
    setError(null);
    const r = await postApp(view, slug, what, body);
    setBusy("");
    if (r.error) setError(r.error);
    else if (said && ctx.announce) ctx.announce(said(r.view));
    return r;
  };
  const turn = (on) => act("switch", { on }, () => `${name}: ${on ? "turned on" : "turned off"}.`);
  const after = (v) => spendingLine(appsOf(v).find((a) => a.slug === slug));
  // The sheet shows its own refusal; a yes closes it and the bar shows the new words.
  const allow = async (cents) => {
    const r = await postApp(view, slug, "allowance", { cents });
    if (r.ok) {
      setSheet(false);
      if (ctx.announce) ctx.announce(after(r.view));
    }
    return r;
  };
  const stop = () => act("allowance/stop", {}, after);
  const think = (model) => act("thinks", { model }, () => `${name} thinks with the model you chose.`);
  const checkAgain = () => { setWaitFrom(Date.now()); setNow(Date.now()); view.reload(); };

  if (view.loading && !data) return html`<div class="p-app p-app--plain"><${Loading} label="Loading the app" /></div>`;
  if (view.error && view.error.status === 404) return html`<div class="p-app p-app--plain"><${Restart} /></div>`;
  if (view.error && !data) return html`<div class="p-app p-app--plain"><${ErrorNotice} error=${view.error} onRetry=${view.reload} /></div>`;
  if (!app) {
    return html`<div class="p-app p-app--plain">
      <div class="k-empty">
        <p class="k-empty__title" id="page-title" tabindex="-1">${WORDS.noApp}</p>
        <div class="k-empty__actions"><${Button} href="#/apps" icon="arrow-left">${WORDS.back}<//></div>
      </div>
    </div>`;
  }

  const address = shown === "on" ? frameAddress(app) : null;
  const t = app.thinks && typeof app.thinks === "object" ? app.thinks : null;
  const thinkItems = t && Array.isArray(t.choices)
    ? t.choices.filter((c) => c && typeof c.id === "string").slice(0, 40).map((c) => ({
      id: c.id, label: plain(c.name || c.id, 60), icon: c.id === t.model ? "check" : undefined, onSelect: () => think(c.id),
    }))
    : [];

  return html`<div class="p-app">
    <header class="p-app__bar" aria-label=${`${name}, from App Studio`}>
      <div class="p-app__who">
        <a class="p-app__back" href="#/apps" aria-label="Back to App Studio" title="Back to App Studio">
          <${Icon} name="arrow-left" size=${16} />
        </a>
        <${AppIcon} slug=${app.slug} size=${28} cls="p-app__icon" />
        <h1 class="p-app__name" id="page-title" tabindex="-1">${name}</h1>
        <${StatusDot} tone=${stateTone(shown)} label=${stateWord(shown)} pulse=${shown === "starting"}
          hideLabel=${narrow && shown !== "on" && shown !== "off"} />
      </div>
      <span class="p-app__break" aria-hidden="true"></span>
      ${spends(app)
        ? html`<div class="p-app__spend">
            <span class="p-app__spend-words">${spendingLine(app)}</span>
            ${app.spending.open
              ? html`<${Button} size="sm" busy=${busy === "allowance/stop"} onClick=${stop}>${WORDS.stop}<//>`
              : html`<${Button} size="sm" variant="primary" onClick=${() => { setError(null); setSheet(true); }}>${WORDS.allow}<//>`}
          </div>`
        : null}
      ${t && thinkItems.length
        ? html`<div class="p-app__thinks"><${Menu} label=${thinksLabel(t)} icon=${narrow ? "brain" : undefined} items=${thinkItems} /></div>`
        : null}
      ${address
        ? html`<${Button} size="sm" variant="quiet" icon="external" class="p-app__own" title=${WORDS.ownWindow}
            onClick=${() => openOwnWindow(address)}><span class="p-app__own-word">${WORDS.ownWindow}</span><//>`
        : null}
      ${app.on
        ? html`<${Button} size="sm" variant="quiet" class="p-app__switch" busy=${busy === "switch"} onClick=${() => turn(false)}>${WORDS.turnOff}<//>`
        : null}
    </header>
    ${error ? html`<div class="p-app__problem"><${Refusal} error=${error} /></div>` : null}
    <div class="p-app__stage">
      ${address
        ? html`<iframe
            key=${address}
            class="p-app__frame"
            title=${name}
            sandbox=${SANDBOX}
            referrerpolicy="no-referrer"
            allow=${ALLOW}
            src=${address}
          ></iframe>`
        : shown === "on"
          ? html`<div class="p-app__card" role="status"><p class="p-app__card-title">${WORDS.badHost}</p></div>`
          : html`<${StageCard} app=${app} host=${host} shown=${shown} late=${late} busy=${busy === "switch"}
              onTurnOn=${() => turn(true)} onCheck=${checkAgain} />`}
    </div>
    ${sheet && spends(app) ? html`<${AllowanceSheet} app=${app} onClose=${() => setSheet(false)} onAllowed=${allow} />` : null}
  </div>`;
}
