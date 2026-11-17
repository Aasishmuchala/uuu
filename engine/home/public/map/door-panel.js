// A door's panel on the Map, and its confirm (PLAN-3D D12, 2.3; revision R1: "Open and shut").
// Shutting is one click. Opening takes three deliberate steps and never happens from one press:
//   1. the door's row, or the door in the studio, opens this panel only (no request);
//   2. "Open this door" opens the confirm only (no request; it reads the view Settings reads, fresh);
//   3. the confirm's yes sends the request. The yes is aria-disabled and ignores clicks, Enter and Space for its first
//      600 ms, and again for 600 ms after any sentence in the confirm changes; focus never starts on it.
// The confirm shows, whole, the sentences Settings shows beside that switch, from the same sources and never retyped:
// the Settings module's own warning (imported) and the server's sentences from the route Settings reads. A door that
// Settings locks shows that module's own blocker lines and a link to its section, with no yes; a refusal from the
// server shows its message and next as sent. The request is Settings' own: api.post to the same path with { on }.
// The Settings modules are loaded by import() when a door's panel first opens, never with the page.
// Server text is hostile: every sentence here is a text node.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { Icon, Loading } from "../kit/index.js";
import { WORDS as W, doorSettingsHref } from "../world/words.js";

export const ARM_MS = 600;

// Each door: the route Settings reads, the switch it sends, and its Settings module.
export const DOORS = Object.freeze({
  web: Object.freeze({ view: "/api/web", path: "/api/web/switch", module: "web" }),
  generation: Object.freeze({ view: "/api/generation", path: "/api/generation/switch", module: "generation" }),
  higgsfield: Object.freeze({ view: "/api/generation", path: "/api/generation/higgsfield/switch", module: "generation" }),
});

// The panel's own words (labels only; every sentence about the door is the server's or Settings').
export const DOOR_WORDS = Object.freeze({
  open: "Open",
  shut: "Shut",
  close: "Close",
  loading: "Reading what Settings shows for this door",
  confirmTitle: (title) => `Open the ${title}?`,
});

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v : "");

// The Settings modules, loaded once, on demand.
const loaded = {};
export function settingsModule(which) {
  if (!loaded[which]) {
    loaded[which] = which === "web" ? import("../pages/settings-web.js") : import("../pages/settings-generation.js");
    loaded[which].catch(() => { delete loaded[which]; });
  }
  return loaded[which];
}

// The word Settings says for a door's new state.
export function stateWord(id, mod, on) {
  if (!mod) return "";
  if (id === "higgsfield") return on ? mod.HF_WORDS.on : mod.HF_WORDS.off;
  return mod.switchLine(on);
}

// An error in the server's words, as sent.
const errorOf = (e) => ({ message: str(e && e.message), next: str(e && e.next) });

// The limits and what was spent, exactly as the Generation section draws them, through its own helpers.
function limitsOf(mod, view) {
  const s = obj(view.spent) ? view.spent : {};
  const caps = obj(view.caps) ? view.caps : {};
  const rows = mod.CAPS.map((c) => {
    const spent = s.ok === false ? null : c.key === "daily" ? s.day : s.month;
    const left = c.key === "daily" ? s.dayLeft : s.monthLeft;
    return { key: c.key, label: c.short, spent: mod.spentLine(spent, caps[c.key]), left: Number.isInteger(spent) ? mod.leftLine(left) : "" };
  });
  const lines = [...mod.capsLines(view), mod.pausedLine(view), mod.ledgerLine(view), mod.runningLine(s.running), mod.WORDS.money].filter(Boolean);
  return { rows, lines };
}

// What the confirm shows for a door, from its Settings module and the fresh view:
// { warning, sentences: [string], limits: { rows, lines } | null, refused: [string] | null, already: string }.
export function confirmOf(id, mod, view) {
  const v = obj(view) ? view : {};
  if (id === "web") {
    const door = obj(v.door) ? v.door : {};
    return {
      warning: mod.WORDS.leaves,
      sentences: [str(door.sentence)].filter(Boolean),
      limits: null,
      refused: v.on !== true && v.canSwitchOn === false ? mod.blockerLines(v) : null,
      already: v.on === true ? mod.switchLine(true) : "",
    };
  }
  if (id === "generation") {
    const door = obj(v.door) ? v.door : {};
    return {
      warning: mod.WORDS.sent,
      sentences: [str(door.sentence), v.example ? mod.plain(v.example, 300) : ""].filter(Boolean),
      limits: limitsOf(mod, v),
      refused: v.on !== true && v.canSwitchOn === false ? mod.blockerLines(v) : null,
      already: v.on === true ? mod.switchLine(true) : "",
    };
  }
  const h = obj(v.higgsfield) ? v.higgsfield : {};
  return {
    warning: mod.HF_WORDS.sent,
    sentences: [str(h.sentence), mod.hfSwitchLine(v)].filter(Boolean),
    limits: limitsOf(mod, v),
    // Settings does not lock this switch: the server's checks decide, and a refusal is shown as sent.
    refused: null,
    already: h.on === true ? mod.HF_WORDS.on : "",
  };
}

// A button drawn as the kit's, so the panel can hold a ref to it (focus goes back to it).
function KitButton({ variant = "plain", size = "md", bref, children, icon, ...rest }) {
  return html`<button type="button" ref=${bref} class=${`k-btn k-btn--${variant} k-btn--${size}`} ...${rest}>
    ${icon ? html`<${Icon} name=${icon} size=${size === "sm" ? 14 : 16} />` : null}<span class="k-btn__label">${children}</span></button>`;
}

const SettingsLink = ({ id }) => html`<a class="p-map__link p-map__door-settings" href=${doorSettingsHref(id)}>${W.openInSettings}<${Icon} name="chevron-right" size=${14} /></a>`;

// The confirm (2.3): an alertdialog over the panel; its text takes focus; Cancel, then the yes.
function DoorConfirm({ door, mod, onCancel, onDone }) {
  const conf = DOORS[door.id];
  const [read, setRead] = useState({ loading: true, view: null, error: null });
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const textRef = useRef(null);
  const cancelRef = useRef(null);
  const yesRef = useRef(null);
  const armed = useRef({ key: null, at: 0 });
  const ids = useRef(`p-map-door-${door.id}`);

  // The view Settings reads, fresh, as the confirm opens.
  useEffect(() => {
    let alive = true;
    api.get(conf.view).then(
      (view) => { if (alive) setRead({ loading: false, view, error: null }); },
      (e) => { if (alive) setRead({ loading: false, view: null, error: errorOf(e) }); },
    );
    return () => { alive = false; };
  }, []);

  // Focus lands on the confirm's text, never on its yes.
  useEffect(() => { if (textRef.current) textRef.current.focus(); }, []);

  const c = read.view ? confirmOf(door.id, mod, read.view) : null;
  const canYes = !!c && !c.refused && !c.already && !read.error;
  // Any change in what the confirm says arms the yes again, 600 ms from now.
  const key = JSON.stringify([read.loading, read.error, c, failure, canYes]);
  if (armed.current.key !== key) armed.current = { key, at: Date.now() };
  const ready = Date.now() - armed.current.at >= ARM_MS;
  useEffect(() => {
    if (ready) return undefined;
    const t = setTimeout(() => setTick((n) => n + 1), ARM_MS - (Date.now() - armed.current.at) + 10);
    return () => clearTimeout(t);
  }, [key, ready]);

  async function yes(e) {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    if (!canYes || busy || Date.now() - armed.current.at < ARM_MS) return;
    setBusy(true);
    setFailure(null);
    try {
      await api.post(conf.path, { on: true });
      onDone(true);
    } catch (err) {
      setFailure(errorOf(err));
    } finally {
      setBusy(false);
    }
  }

  const onYesKey = (e) => {
    if ((e.key === "Enter" || e.key === " " || e.key === "Spacebar") && Date.now() - armed.current.at < ARM_MS) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const stops = [cancelRef.current, yesRef.current].filter(Boolean);
    const at = stops.indexOf(globalThis.document && globalThis.document.activeElement);
    const next = e.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at < 0 || at >= stops.length - 1 ? 0 : at + 1);
    if (stops[next]) {
      e.preventDefault();
      stops[next].focus();
    }
  };

  const title = DOOR_WORDS.confirmTitle(door.title || door.id);
  const lines = (list) => list.map((s, i) => html`<p key=${i} class="p-map__confirm-line">${s}</p>`);
  let body;
  if (read.loading) body = html`<${Loading} lines=${3} label=${DOOR_WORDS.loading} />`;
  else if (read.error) {
    body = html`<div class="p-map__confirm-refused" role="alert">${lines([read.error.message, read.error.next].filter(Boolean))}</div>
      <${SettingsLink} id=${door.id} />`;
  } else if (c) {
    body = html`
      <p class="p-map__confirm-warning">${c.warning}</p>
      ${lines(c.sentences)}
      ${c.limits ? html`<dl class="p-map__confirm-limits">
        ${c.limits.rows.map((r) => html`<div key=${r.key} class="p-map__confirm-limit">
          <dt>${r.label}</dt><dd class="p-map__confirm-spent">${r.spent}</dd>${r.left ? html`<dd class="p-map__confirm-left">${r.left}</dd>` : null}</div>`)}
      </dl>${lines(c.limits.lines)}` : null}
      ${c.already ? html`<p class="p-map__confirm-line p-map__confirm-line--state">${c.already}</p>` : null}
      ${c.refused ? html`<div class="p-map__confirm-refused">${lines(c.refused)}</div><${SettingsLink} id=${door.id} />` : null}
      ${failure ? html`<div class="p-map__confirm-refused" role="alert">${lines([failure.message, failure.next].filter(Boolean))}</div>
        <${SettingsLink} id=${door.id} />` : null}`;
  }

  return html`
    <div class="p-map__confirm-back" aria-hidden="true" onClick=${onCancel}></div>
    <div class="p-map__confirm" data-surface="paper" role="alertdialog" aria-modal="true" aria-labelledby=${`${ids.current}-title`} aria-describedby=${`${ids.current}-text`}
      onKeyDown=${onKey}>
      <h3 class="p-map__confirm-title" id=${`${ids.current}-title`}>${title}</h3>
      <div class="p-map__confirm-text" id=${`${ids.current}-text`} tabindex="-1" ref=${textRef}>${body}</div>
      <div class="p-map__confirm-foot">
        <${KitButton} variant="quiet" bref=${cancelRef} onClick=${onCancel}>${W.cancel}<//>
        ${canYes ? html`<${KitButton} variant="primary" bref=${yesRef} data-yes="" aria-disabled=${ready && !busy ? undefined : "true"}
            aria-busy=${busy ? "true" : undefined} onClick=${yes} onKeyDown=${onYesKey}>${W.yesOpenDoor}<//>` : null}
      </div>
    </div>`;
}

// The door's panel: its title, open or shut in words, the server's sentence whole, and its one action.
// door: a door of worldState() (state.js). onClose(); onChanged() reads /api/world again; announce(sentence).
export function DoorPanel({ door, onClose, onChanged, announce }) {
  const conf = DOORS[door && door.id];
  const [mod, setMod] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const openRef = useRef(null);
  const headRef = useRef(null);

  useEffect(() => {
    let alive = true;
    if (conf) settingsModule(conf.module).then((m) => { if (alive) setMod(m); }, () => {});
    return () => { alive = false; };
  }, [door && door.id]);
  useEffect(() => { setConfirm(false); setFailure(null); }, [door && door.id]);
  if (!conf) return null;

  // Step 2: the confirm, and nothing else. A second press while it is open does nothing.
  const ask = () => {
    if (confirm || !mod || door.on) return;
    setFailure(null);
    setConfirm(true);
  };
  const cancel = () => {
    setConfirm(false);
    setTimeout(() => { if (openRef.current) openRef.current.focus(); }, 0);
  };
  const opened = () => {
    setConfirm(false);
    if (announce) announce(stateWord(door.id, mod, true));
    if (onChanged) onChanged();
    setTimeout(() => { if (headRef.current) headRef.current.focus(); }, 0);
  };
  // Shutting: one click, the request of 2.3.
  async function shut() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await api.post(conf.path, { on: false });
      if (announce) announce(stateWord(door.id, mod, false));
      if (onChanged) onChanged();
    } catch (e) {
      setFailure(errorOf(e));
    } finally {
      setBusy(false);
    }
  }

  const onKey = (e) => {
    if (e.key === "Escape" && !e.defaultPrevented && !confirm) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  const hid = `p-map-door-${door.id}-head`;
  return html`<section class=${`p-map__panel p-map__panel--door${confirm ? " is-asking" : ""}`} data-surface="over" aria-labelledby=${hid} data-panel-door=${door.id} onKeyDown=${onKey}>
    <div class="p-map__panel-head">
      <div class="p-map__panel-titles">
        <h2 class="p-map__panel-title" id=${hid} tabindex="-1" ref=${headRef}>${door.title}</h2>
        <p class="p-map__door-word">
          <span class=${`p-map__door-mark p-map__door-mark--${door.state}`} aria-hidden="true"></span>
          <span>${door.on ? DOOR_WORDS.open : DOOR_WORDS.shut}</span></p>
      </div>
      <button type="button" class="p-map__close" onClick=${onClose}><span>${DOOR_WORDS.close}</span><kbd class="p-map__esc" aria-hidden="true">Esc</kbd></button>
    </div>
    <div class="p-map__panel-body">
      ${door.sentence ? html`<p class="p-map__door-sentence">${door.sentence}</p>` : null}
      ${failure ? html`<div class="p-map__door-failure" role="alert">
        ${failure.message ? html`<p class="p-map__confirm-line">${failure.message}</p>` : null}
        ${failure.next ? html`<p class="p-map__confirm-line">${failure.next}</p>` : null}</div>` : null}
    </div>
    <div class="p-map__panel-foot">
      ${door.on
        ? html`<${KitButton} variant="danger-quiet" aria-busy=${busy ? "true" : undefined} onClick=${shut}>${W.shutDoor}<//>`
        : html`<${KitButton} variant="primary" bref=${openRef} aria-haspopup="dialog" aria-expanded=${confirm ? "true" : "false"}
            aria-disabled=${mod ? undefined : "true"} onClick=${ask}>${W.openDoor}<//>`}
      <${SettingsLink} id=${door.id} />
    </div>
    ${confirm && mod ? html`<${DoorConfirm} door=${door} mod=${mod} onCancel=${cancel} onDone=${opened} />` : null}
  </section>`;
}
