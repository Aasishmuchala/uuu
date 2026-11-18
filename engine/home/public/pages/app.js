// One app opened inside App Studio (PLAN-V5 K17, K22, K23, T80; PLAN-COOK T60, TB2, R5-F, R6-F): the whole window
// under the top bar, whose crumbs say App Studio / <name> (the one place the eye reads its name). On top, the home
// screen's own bar, one 44 px row on the shell's ground with its hairline (the app cannot draw over it): the app's
// state and what it may spend today; at the right the model it thinks with (a quiet text menu), "Stop spending" (or
// "Allow spending"), Turn off, and "Open in its own window" as a small mark. Then the stage, and on it
// the app's window: a 1 px edge, a 12 px corner and 16 px round it, so it reads as another program's page; its head,
// inside that edge, a 28 px strip with what the fence does not cover, whole (T86, ADR 0016); under it the app in an
// iframe at its own port on this Mac (from /api/apps, never from the app's text), set only once the app is on and
// kept through one answer that says otherwise ("Checking the app…"); off, starting, stopped, App Studio off and not
// ready each have the kit's Empty in the window's place. In full, the sentence stands beside Turn on. The allowance
// sheet is the kit's dialog with four radio rows in whole dollars, those over what is left of today's limit disabled
// with the reason as text.
// PLAN-3D-ALL U14: a surface screen with no room header (the frame needs every pixel). Only the bar is restyled, on
// the new tokens; the frame is untouched from the bar's lower edge to the window's. The allowance sheet carries money
// sentences, so it is the kit's dialog on paper (D4), its words, buttons, order and requests unchanged.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { useApp } from "../lib/context.js";
import { Button, Dialog, Empty, ErrorNotice, Icon, Loading, Menu, NextStep, StatusDot, Tag } from "../kit/index.js";
import {
  MoneyWords, Refusal, Restart, SLUG, STATE_WORDS, WORDS, allowLabel, amountChoices, appAddress, appsOf, firstAmount, frameRefusal, plain,
  portsOf, postApp, sheetTitle, shownState, spendingLine, spends, stateSentence, stateTag, stateWord, thinksShort, useAppsView,
} from "./apps.js";

// Starting: /api/apps is asked every 2 seconds for up to a minute.
export const POLL_STARTING_MS = 2000;
export const STARTING_FOR_MS = 60000;
// On: every 10 seconds, so the bar's spending and state stay true.
export const POLL_ON_MS = 10000;

// The iframe's fixed permissions (T80, T86): scripts, its own origin, forms and downloads. No window of its own (a
// popup is a way off this Mac, T85 finding 1) and never the home screen's address bar.
export const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-downloads";
export const ALLOW = "fullscreen; clipboard-write";

const hostnameNow = () => (typeof location === "undefined" ? "" : String(location.hostname || ""));
const portNow = () => (typeof location === "undefined" ? "" : String(location.port || ""));

// The address of the app's frame from this page's hostname and the server's range of app ports, or null.
export const frameAddress = (app, ports) => appAddress(hostnameNow(), app && app.port, ports, portNow());

// Opens the app in a window of its own, with no way back to this one.
export function openOwnWindow(address) {
  if (!address || typeof window === "undefined" || typeof window.open !== "function") return;
  window.open(address, "_blank", "noopener,noreferrer");
}

// Arrows move the choice between the sheet's radio rows that can be picked (and take it, as a radio group does);
// Home and End go to the ends. Pure, so it is tested without a document: -> the index to move to, or -1.
export function amountStep(choices, at, key) {
  const open = choices.map((c, i) => (c.disabled ? -1 : i)).filter((i) => i >= 0);
  if (!open.length) return -1;
  const here = open.indexOf(at);
  if (key === "Home") return open[0];
  if (key === "End") return open[open.length - 1];
  const step = key === "ArrowDown" || key === "ArrowRight" ? 1 : key === "ArrowUp" || key === "ArrowLeft" ? -1 : 0;
  if (!step) return -1;
  if (here < 0) return open[0];
  return open[(here + step + open.length) % open.length];
}

// The allowance sheet (K22, K23): the kit's dialog on paper (PLAN-3D-ALL D4), the amounts as radio rows drawn as the
// kit's single-choice rows.
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
  const onKey = (ev) => {
    const at = choices.findIndex((c) => c.cents === cents);
    const to = amountStep(choices, at, ev.key);
    if (to < 0) return;
    ev.preventDefault();
    setCents(choices[to].cents);
    const rows = ev.currentTarget && ev.currentTarget.querySelectorAll ? [...ev.currentTarget.querySelectorAll('[role="radio"]')] : [];
    if (rows[to] && typeof rows[to].focus === "function") rows[to].focus();
  };
  // One Tab stop: the chosen row, else the first that can be picked.
  const chosen = choices.findIndex((c) => c.cents === cents);
  const stop = chosen >= 0 ? chosen : Math.max(0, choices.findIndex((c) => !c.disabled));
  const footer = html`
    <${Button} variant="quiet" onClick=${onClose}>Cancel<//>
    <${Button} variant="primary" busy=${busy} disabled=${!cents || !ready} onClick=${allow}>${allowLabel(cents || 500)}<//>`;
  return html`<${Dialog} open=${true} paper=${true} title=${sheetTitle(app.name)} size="sm" onClose=${onClose} footer=${footer}>
    <div class="p-app__sheet">
      <p class="p-app__sheet-body">${WORDS.sheetBody}</p>
      <div class="k-decision__choices p-app__amounts" role="radiogroup" aria-label="How much it may spend today" onKeyDown=${onKey}>
        ${choices.map((c, i) => {
          const on = c.cents === cents;
          const why = c.disabled ? `p-app-why-${c.cents}` : undefined;
          return html`<div class="p-app__amount-row" key=${c.cents}>
            <button
              type="button"
              role="radio"
              class="k-decision__choice p-app__amount"
              aria-checked=${on ? "true" : "false"}
              aria-describedby=${why}
              tabindex=${i === stop ? "0" : "-1"}
              disabled=${c.disabled}
              data-autofocus=${on ? "" : undefined}
              onClick=${() => setCents(c.cents)}
            ><span class="k-decision__radio" aria-hidden="true"></span><span class="k-decision__choice-text">${c.label}</span></button>
            ${c.disabled ? html`<span class="p-app__amount-why" id=${why}>${WORDS.overLeft}</span>` : null}
          </div>`;
        })}
      </div>
      <p class="p-app__left">${plain(app.spending.limitWords, 120)}</p>
      ${ready ? null : html`<p class="p-app__left">${WORDS.noProvider}</p>`}
      <${Refusal} error=${error} />
    </div>
  <//>`;
}

// The kit's Empty in the frame's place while the app is not on: what is so in the server's words, and the way on.
function StageCard({ app, host, shown, late, busy, onTurnOn, onCheck }) {
  const name = plain(app.name, 40) || app.slug;
  if (shown === "off") {
    return html`<div class="p-app__card" role="status">
      <${Empty} icon="power" title=${`${name} is off.`}>
        <${Button} variant="primary" busy=${busy} onClick=${onTurnOn}>${WORDS.turnOn}<//>
        <p class="p-app__trust-long">${WORDS.trust}</p>
      <//>
    </div>`;
  }
  if (shown === "starting") {
    return html`<div class="p-app__card" role="status">
      <${Empty} icon="clock" title=${late ? WORDS.late : `Starting ${name}…`}>
        ${late
          ? html`<${Button} onClick=${onCheck}>${WORDS.checkAgain}<//> <a class="p-app__link" href="#/health">${WORDS.health}</a>`
          : html`<${StatusDot} tone="wait" pulse=${true} label=${STATE_WORDS.starting} hideLabel=${true} />`}
      <//>
    </div>`;
  }
  if (shown === "failed") {
    return html`<div class="p-app__card" role="status">
      <${Empty} icon="alert" title=${stateSentence(shown, host)} text=${WORDS.tryAgain}>
        <a class="p-app__link" href="#/health">${WORDS.health}</a>
      <//>
    </div>`;
  }
  if (shown === "host_off") {
    return html`<div class="p-app__card" role="status">
      <${Empty} icon="power" title=${`${name} cannot run right now.`}><${NextStep} text=${stateSentence(shown, host)} /><//>
    </div>`;
  }
  return html`<div class="p-app__card" role="status"><${Empty} icon="apps" title=${stateSentence(shown, host)} /></div>`;
}

// Whether the frame is kept through this answer (T85 finding 8): an app that was on and is still switched on keeps its
// frame through one answer that says otherwise, while the page says "Checking the app…" and asks again soon; the
// next such answer is believed. The owner's own Turn off is believed at once. Worked out once per answer, during the
// render, so the frame is never taken down and put back.
function useHeld(slug, data, app, shown) {
  const m = useRef({ slug: null, data: null, wasOn: false, missed: false });
  const h = m.current;
  if (h.slug !== slug) Object.assign(h, { slug, data: null, wasOn: false, missed: false });
  if (h.data !== data) {
    h.data = data;
    if (!app || !app.on) Object.assign(h, { wasOn: false, missed: false });
    else if (shown === "on") Object.assign(h, { wasOn: true, missed: false });
    else if (h.wasOn && !h.missed) h.missed = true;
    else Object.assign(h, { wasOn: false, missed: false });
  }
  return !!app && app.on === true && shown !== "on" && h.wasOn && h.missed;
}

// True below 860 px, where the bar is two rows and the model's menu shows only its mark.
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

// The crumbs the top bar shows for an app: App Studio (a link back) and its name.
export function appCrumbs(name) {
  const n = plain(name, 40);
  return n ? [{ label: WORDS.back, href: "#/apps" }, { label: n }] : [{ label: WORDS.back }];
}

// Marks the stage while the keyboard is inside the app's frame. A browser does not mark the frame :focus (or its stage
// :focus-within) once Tab has moved into a page of another origin, so the page watches its own window lose focus to
// the frame and draws the ring round the frame itself, where the app cannot draw it or hide it. The mark is set on
// the element at once (no render in between), and only this hook writes it. -> a ref for the stage.
function useFrameFocus() {
  const stage = useRef(null);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function" || typeof document === "undefined") return undefined;
    const look = () => {
      const el = stage.current;
      if (!el || !el.classList) return;
      const a = document.activeElement;
      el.classList.toggle("p-app__stage--focus", !!a && a.localName === "iframe" && el.contains(a));
    };
    window.addEventListener("blur", look);
    window.addEventListener("focus", look);
    document.addEventListener("focusin", look);
    return () => {
      window.removeEventListener("blur", look);
      window.removeEventListener("focus", look);
      document.removeEventListener("focusin", look);
    };
  }, []);
  return stage;
}

export default function AppPage({ route }) {
  const narrow = useNarrow();
  const stageRef = useFrameFocus();
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
  const answered = app ? shownState(app, host) : null;
  const checking = useHeld(slug, view.data, app, answered);
  const shown = checking ? "on" : answered;
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
    setEvery(shown === "starting" ? (late ? 0 : POLL_STARTING_MS) : checking ? POLL_STARTING_MS : POLL_ON_MS);
  }, [shown, late, checking]);

  // The window's title, as every page's header sets it.
  const company = ctx.shell?.company?.name || "";
  useEffect(() => {
    if (typeof document === "undefined") return;
    const text = [name || "App Studio", company].filter(Boolean).join(" · ");
    document.title = text;
  }, [name, company]);

  // The top bar's crumbs: App Studio / <name>.
  const setTop = ctx.setTop;
  useEffect(() => {
    if (typeof setTop !== "function") return;
    setTop({ crumbs: appCrumbs(name || (SLUG.test(String(slug || "")) ? slug : "")) });
  }, [setTop, name, slug]);

  const act = async (what, body, said) => {
    setBusy(what);
    setError(null);
    const r = await postApp(view, slug, what, body);
    setBusy("");
    if (r.error) setError(r.error);
    else if (said && ctx.announce) ctx.announce(said(r.view));
    return r;
  };
  // A Turn on is answered before the host has started the app: ask again at once, so the frame stands as soon as the
  // server says the app is ready, not at the next periodic refresh. An answer already final (on and running, or off)
  // needs no second ask.
  const turn = async (on) => {
    const r = await act("switch", { on }, () => `${name}: ${on ? "turned on" : "turned off"}.`);
    if (!on || !r.ok) return;
    const one = appsOf(r.view).find((a) => a.slug === slug);
    const h = r.view && typeof r.view.host === "object" && r.view.host ? r.view.host : { state: "off", sentence: "" };
    if (!one || shownState(one, h) !== "on") view.refresh();
  };
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

  const ports = portsOf(data);
  const address = shown === "on" ? frameAddress(app, ports) : null;
  const refused = shown === "on" && !address ? frameRefusal(hostnameNow(), app.port, ports) : null;
  // A frame taken away takes its ring with it.
  if (!address && stageRef.current && stageRef.current.classList) stageRef.current.classList.remove("p-app__stage--focus");
  const t = app.thinks && typeof app.thinks === "object" ? app.thinks : null;
  const thinkItems = t && Array.isArray(t.choices)
    ? t.choices.filter((c) => c && typeof c.id === "string").slice(0, 40).map((c) => ({
      id: c.id, label: plain(c.name || c.id, 60), icon: c.id === t.model ? "check" : undefined, onSelect: () => think(c.id),
    }))
    : [];

  // The bar, in reading order (R6-F): the state and what it may spend today at the left; at the right the model as a
  // quiet text menu, then "Stop spending" (the owner's way to stop money leaving: one click, in view, in the danger
  // ink) or "Allow spending", then Turn off (a ghost), then its own window as a small mark. The app's name is the top
  // bar's crumb; here it is the page's heading for a screen reader only, so the eye reads it once.
  const thinks = t && thinkItems.length
    ? html`<div class="p-app__thinks"><${Menu} label=${thinksShort(t)} icon=${narrow ? "brain" : undefined} items=${thinkItems} /></div>`
    : null;
  const spendButton = spends(app)
    ? html`<span class="p-app__spend">${app.spending.open
      ? html`<${Button} size="sm" variant="danger-ghost" busy=${busy === "allowance/stop"} onClick=${stop}>${WORDS.stop}<//>`
      : html`<${Button} size="sm" variant="ghost" onClick=${() => { setError(null); setSheet(true); }}>${WORDS.allow}<//>`}</span>`
    : null;
  return html`<div class=${`p-app p-app--${shown}`}>
    <header class="p-app__bar" aria-label=${`${name}, from App Studio`}>
      <h1 class="p-app__name k-sr" id="page-title" tabindex="-1">${name}</h1>
      <div class="p-app__who">
        <span class="p-app__state"><${Tag} tone=${stateTag(shown)}>${stateWord(shown)}<//></span>
        ${spends(app) ? html`<div class="p-app__money"><${MoneyWords} cls="p-app__money-words" text=${spendingLine(app)} /></div>` : null}
      </div>
      <div class="p-app__tools">
        ${thinks}${spendButton}
        ${app.on
          ? html`<${Button} size="sm" variant="ghost" class="p-app__switch" icon="power" busy=${busy === "switch"} onClick=${() => turn(false)}>${WORDS.turnOff}<//>`
          : null}
        ${address
          ? html`<${Button} size="sm" variant="ghost" icon="external" class="p-app__own" title=${WORDS.ownWindow}
              onClick=${() => openOwnWindow(address)}><span class="p-app__own-word">${WORDS.ownWindow}</span><//>`
          : null}
      </div>
    </header>
    ${error ? html`<div class="p-app__problem"><${Refusal} error=${error} /></div>` : null}
    <div class="p-app__stage" ref=${stageRef}>
      ${address
        ? html`<div class="p-app__window">
            <div class="p-app__notes">
              <${Icon} name="info" size=${14} class="p-app__notes-icon" />
              <p class="p-app__trust">${WORDS.trustShort}</p>
              ${checking ? html`<p class="p-app__checking" role="status">${WORDS.checking}</p>` : null}
            </div>
            <iframe
              key=${address}
              class="p-app__frame"
              title=${name}
              sandbox=${SANDBOX}
              referrerpolicy="no-referrer"
              allow=${ALLOW}
              src=${address}
            ></iframe>
          </div>`
        : shown === "on"
          ? html`<div class="p-app__card" role="status"><${Empty} icon="alert" title=${refused.title} text=${refused.text} /></div>`
          : html`<${StageCard} app=${app} host=${host} shown=${shown} late=${late} busy=${busy === "switch"}
              onTurnOn=${() => turn(true)} onCheck=${checkAgain} />`}
    </div>
    ${sheet && spends(app) ? html`<${AllowanceSheet} app=${app} onClose=${() => setSheet(false)} onAllowed=${allow} />` : null}
  </div>`;
}
