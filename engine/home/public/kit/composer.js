// Where the owner says what should be done. CONTRACTS-V2 13.2, changed by CONTRACTS-V3 28. Two modes:
// - "task" (the default): a text area pinned to the bottom of its container; "/" at the start of a line opens the
//   jobs, "@" opens the agents and sets who it is for; Enter sends, Shift+Enter makes a new line; a "Plan first" box
//   when allowed. onSend({ text, to, planFirst, template }) -> promise. Picking a job calls onPickJob(job) when it is
//   given (the page opens the job); without it the job's text fills the line, as in version 2.
// - "ask": the map's box. One outlined box with the round send button and the hint under it; no Plan first, no
//   "/" or "@" lists. onSend({ text }) -> promise.
// PLAN-COOK T37: both modes are one outlined box on the panel step (nothing blurs), 15 px words, the round send button
// in the accent fill, the hint at 13 px. A job in the "/" list shows its department's line icon, never a colour (O7).
// PLAN-COOK T118: a host can draw its own foot without reaching inside. In task mode:
// - `bare`: no box of its own (no edge, no fill: the host's surface shows); while the field has focus a 2 px accent
//   bar at its left; the "/" and "@" lists open under the words, in the flow; Plan first is the kit's Checkbox.
// - `sendLabel`: the send button is the kit's small primary with this word instead of the round icon button.
// - `controls`: the host's own controls, in the foot row after Plan first (the left side). Either nodes, or a
//   function ({ edit }) -> nodes, where edit((text, caret) => ({ text, caret })) changes the words as if typed (the
//   lists open, the field takes focus with the caret where it says).
// - `keys`: the keys hint the host draws, at the right of the foot row before Send (in place of the default hint).
// `maxHeight` (both modes): the largest height the field grows to, in px (a number or "320px") or a share of the
// window ("40vh"); without it, 240 px as before.
import { html, useEffect, useMemo, useRef, useState } from "../vendor/preact-htm.js";
import { Avatar } from "./avatar.js";
import { Button } from "./button.js";
import { Checkbox } from "./fields.js";
import { Icon } from "./icon.js";
import { Kbd } from "./text.js";

export const DEFAULT_PLACEHOLDER = "Say what you want done.  /  for jobs,  @  to pick who.";

export const SHORT_PLACEHOLDER = "Say what you want done.";

// The words of the box in "ask" mode (CONTRACTS-V3 25).
export const ASK_PLACEHOLDER = "Ask the company brain, or say what you want done.";
export const ASK_HINT = "Enter to send. A real agent reads your files, so an answer takes a minute or two.";
// Below 480 px the pinned placeholder is cut mid-word (M18-04), so a phone gets a shorter one.
export const ASK_SHORT_PLACEHOLDER = "Ask the brain, or say what to do.";
const PHONE = "(max-width: 479px)";

// True while the window is narrower than 480 px; follows the window as it changes.
function usePhone() {
  const query = () => (typeof matchMedia === "function" ? matchMedia(PHONE) : null);
  const [phone, setPhone] = useState(() => !!query()?.matches);
  useEffect(() => {
    const mq = query();
    if (!mq) return undefined;
    const on = () => setPhone(mq.matches);
    on();
    if (mq.addEventListener) { mq.addEventListener("change", on); return () => mq.removeEventListener("change", on); }
    return undefined;
  }, []);
  return phone;
}

const text = (v) => (v === null || v === undefined ? "" : String(v));

// Pure. What the owner is typing at the caret: { kind: "/", query } for "/" at the start of a line,
// { kind: "@", query } for "@" at the start of a word, else null.
export function trigger(value, caret) {
  const all = text(value);
  const at = Number.isInteger(caret) ? Math.max(0, Math.min(caret, all.length)) : all.length;
  const before = all.slice(0, at);
  let m = /(?:^|\n)\/([^\s/]*)$/.exec(before);
  if (m) return { kind: "/", query: m[1] };
  m = /(?:^|\s)@([^\s@]*)$/.exec(before);
  if (m) return { kind: "@", query: m[1] };
  return null;
}

const MAX_OPTIONS = 8;
const fold = (s) => text(s).toLowerCase();

// The departments' line icons (as the sidebar draws them).
const DEPT_ICONS = { brain: "brain", operations: "layers", sales: "trend", marketing: "horn", studio: "film", support: "buoy", people: "team", books: "book" };

// A job's department id (shape `job`: { department: { id } }), or a plain id string, or "".
const deptOf = (g) => {
  const d = g && g.department;
  const id = d && typeof d === "object" ? d.id : d;
  return typeof id === "string" && /^[a-z][a-z-]{0,31}$/.test(id) ? id : "";
};

function optionsFor(t, templates, agents) {
  if (!t) return [];
  const q = fold(t.query);
  if (t.kind === "/") {
    return (Array.isArray(templates) ? templates : [])
      .filter((g) => g && (!q || fold(g.title).includes(q) || fold(g.summary).includes(q) || fold(g.id).includes(q)
        || fold(g.department && g.department.title).includes(q)))
      .slice(0, MAX_OPTIONS)
      .map((g) => ({ key: `/${g.id}`, kind: "/", value: g }));
  }
  return (Array.isArray(agents) ? agents : [])
    .filter((a) => a && a.slug && a.slug !== "you" && (!q || fold(a.name).includes(q) || fold(a.slug).includes(q)))
    .slice(0, MAX_OPTIONS)
    .map((a) => ({ key: `@${a.slug}`, kind: "@", value: a }));
}

let seq = 0;

// Pure. The host's largest height as a CSS length: a number of px, "<n>px", or "<n>vh" (a share of the window);
// anything else is null (the 240 px default holds).
export function heightLimit(max) {
  if (typeof max === "number") return Number.isFinite(max) && max > 0 ? `${max}px` : null;
  if (typeof max === "string" && /^\d+(\.\d+)?(px|vh|dvh|svh)$/.test(max.trim()) && parseFloat(max) > 0) return max.trim();
  return null;
}

// Grows the text area with what is typed, up to 240 px, or up to the host's limit when it gives one.
function useGrow(area, value, max) {
  const limit = heightLimit(max);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    if (limit) {
      el.style.maxHeight = limit;
      el.style.height = `${el.scrollHeight}px`;
    } else {
      el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
    }
  }, [value, limit]);
}

const later = (fn) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(fn, 0));

export function Composer(props) {
  return props && props.mode === "ask" ? html`<${AskBox} ...${props} />` : html`<${TaskComposer} ...${props} />`;
}

// The map's box: a question for the company brain or a request, sent as the owner typed it.
function AskBox({ placeholder, hint, onSend, busy = false, autoFocus = false, initialText = "", maxHeight }) {
  const [value, setValue] = useState(text(initialText));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const area = useRef(null);
  const ids = useMemo(() => { seq += 1; return { field: `k-composer-field-${seq}`, hint: `k-composer-hint-${seq}` }; }, []);
  useEffect(() => { if (autoFocus && area.current) area.current.focus(); }, [autoFocus]);
  useGrow(area, value, maxHeight);
  const phone = usePhone();
  const isBusy = busy || sending;

  const send = async () => {
    const body = value.trim();
    if (!body || isBusy || !onSend) return;
    setSending(true);
    setError("");
    try {
      await onSend({ text: body });
      setValue("");
    } catch (e) {
      setError(text(e && e.message) || "That did not go through. Try again.");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (ev) => {
    if (ev.isComposing) return;
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      send();
    }
  };

  const onInput = (ev) => {
    setValue(ev.currentTarget.value);
    if (error) setError("");
  };

  return html`<div class=${`k-composer k-composer--ask${isBusy ? " k-composer--busy" : ""}`}>
    <div class="k-composer__box">
      <label class="u-visually-hidden" for=${ids.field}>Ask, or say what you want done</label>
      <textarea id=${ids.field} ref=${area} class="k-composer__field" rows="1" value=${value}
        placeholder=${phone && (!text(placeholder) || placeholder === ASK_PLACEHOLDER) ? ASK_SHORT_PLACEHOLDER : text(placeholder) || ASK_PLACEHOLDER} readOnly=${isBusy} aria-busy=${isBusy ? "true" : "false"}
        aria-describedby=${ids.hint} onInput=${onInput} onKeyDown=${onKeyDown}></textarea>
      <button type="button" class="k-composer__send" aria-label=${isBusy ? "Sending" : "Send"}
        disabled=${isBusy || !value.trim()} onClick=${send}><${Icon} name="send" /></button>
    </div>
    <p class="k-composer__note" id=${ids.hint}>${text(hint) || ASK_HINT}</p>
    ${error && html`<p class="k-composer__error" role="alert"><${Icon} name="alert" /><span>${error}</span></p>`}
  </div>`;
}

function TaskComposer({
  placeholder = DEFAULT_PLACEHOLDER, onSend, onPickJob, hint, to = null, agents = [], templates = [], allowPlanFirst = true,
  busy = false, autoFocus = false, initialText = "", bare = false, sendLabel = "", controls = null, keys = null, maxHeight,
}) {
  const [value, setValue] = useState(text(initialText));
  const [who, setWho] = useState(to || null);
  const [planFirst, setPlanFirst] = useState(false);
  const [template, setTemplate] = useState(null);
  const [caret, setCaret] = useState(text(initialText).length);
  const [active, setActive] = useState(0);
  const [closed, setClosed] = useState(false); // Esc closed the list until the next keystroke
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const area = useRef(null);
  const phone = usePhone();
  const ids = useMemo(() => { seq += 1; return { list: `k-composer-list-${seq}`, field: `k-composer-field-${seq}` }; }, []);

  useEffect(() => { setWho(to || null); }, [to]);
  useEffect(() => { if (autoFocus && area.current) area.current.focus(); }, [autoFocus]);
  useGrow(area, value, maxHeight);

  const t = closed ? null : trigger(value, caret);
  const options = optionsFor(t, templates, agents);
  const open = options.length > 0;
  const current = Math.min(active, Math.max(0, options.length - 1));
  const agentOf = (slug) => (Array.isArray(agents) ? agents.find((a) => a && a.slug === slug) : null) || null;
  const whoAgent = who ? agentOf(who) || { slug: who, name: who } : null;
  const isBusy = busy || sending;

  const replaceTrigger = (insert) => {
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const start = before.length - (t ? t.query.length + 1 : 0);
    const next = before.slice(0, start) + insert + after;
    const pos = start + insert.length;
    setValue(next);
    setCaret(pos);
    later(() => {
      const el = area.current;
      if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    });
  };

  // The host's change to the words, as if typed: the lists open again and the field takes focus at the new caret.
  const edit = (change) => {
    if (typeof change !== "function" || isBusy) return;
    const el = area.current;
    const at = el && Number.isInteger(el.selectionStart) ? el.selectionStart : caret;
    const next = change(value, at) || {};
    const words = text(next.text);
    const pos = Number.isInteger(next.caret) ? Math.max(0, Math.min(next.caret, words.length)) : words.length;
    setValue(words);
    setCaret(pos);
    setClosed(false);
    setActive(0);
    if (error) setError("");
    later(() => {
      const f = area.current;
      if (f) { f.focus(); f.setSelectionRange(pos, pos); }
    });
  };

  const pick = (opt) => {
    if (!opt) return;
    if (opt.kind === "/" && typeof onPickJob === "function") {
      // The page opens the job, with its own questions; the "/" and what follows it are taken out of the line.
      replaceTrigger("");
      onPickJob(opt.value);
    } else if (opt.kind === "/") {
      const g = opt.value;
      setTemplate(text(g.id) || null);
      if (g.to) setWho(g.to);
      if (allowPlanFirst) setPlanFirst(!!g.planFirst);
      const insert = text(g.text);
      // A job's text replaces the whole line it was picked from.
      replaceTrigger(insert);
    } else {
      setWho(opt.value.slug);
      replaceTrigger("");
    }
    setActive(0);
  };

  const send = async () => {
    const body = value.trim();
    if (!body || isBusy || !onSend) return;
    setSending(true);
    setError("");
    try {
      await onSend({ text: body, to: who || null, planFirst: allowPlanFirst ? planFirst : false, template });
      setValue("");
      setCaret(0);
      setTemplate(null);
      setPlanFirst(false);
      setWho(to || null);
    } catch (e) {
      setError(text(e && e.message) || "That did not go through. Try again.");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (ev) => {
    if (ev.isComposing) return;
    if (open) {
      if (ev.key === "ArrowDown") { ev.preventDefault(); setActive((current + 1) % options.length); return; }
      if (ev.key === "ArrowUp") { ev.preventDefault(); setActive((current - 1 + options.length) % options.length); return; }
      if (ev.key === "Enter" || ev.key === "Tab") { ev.preventDefault(); pick(options[current]); return; }
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); setClosed(true); return; }
    }
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      send();
    }
  };

  const track = (ev) => {
    const el = ev.currentTarget;
    setCaret(el.selectionStart);
  };

  const onInput = (ev) => {
    const el = ev.currentTarget;
    setValue(el.value);
    setCaret(el.selectionStart);
    setClosed(false);
    setActive(0);
    if (error) setError("");
  };

  const menu = open && html`<div class="k-composer__menu" id=${ids.list} role="listbox"
        aria-label=${t.kind === "/" ? "Jobs" : "Agents"}>
      <p class="k-composer__menu-head">${t.kind === "/" ? "Jobs" : "Give it to"}</p>
      ${options.map((o, i) => html`<button type="button" role="option" tabindex="-1" key=${o.key}
          id=${`${ids.list}-${i}`} aria-selected=${i === current ? "true" : "false"}
          class=${`k-composer__option${i === current ? " k-composer__option--active" : ""}${o.kind === "/" && o.value.ready === false ? " k-composer__option--dim" : ""}`}
          onMouseDown=${(e) => e.preventDefault()} onClick=${() => pick(o)}>
        ${o.kind === "@"
          ? html`<${Avatar} slug=${o.value.slug} name=${o.value.name} size=${20} /><span class="k-composer__option-title">${text(o.value.name)}</span>`
          : html`<span class="k-composer__option-icon" data-dept=${deptOf(o.value) || undefined} aria-hidden="true"><${Icon} name=${DEPT_ICONS[deptOf(o.value)] || "jobs"} size=${16} /></span>
              <span class="k-composer__option-title">${text(o.value.title)}</span>
              ${o.value.summary && html`<span class="k-composer__option-hint">${text(o.value.summary)}</span>`}`}
      </button>`)}
    </div>`;
  const errorLine = error && html`<p class="k-composer__error" role="alert"><${Icon} name="alert" /><span>${error}</span></p>`;
  const canSend = !isBusy && Boolean(value.trim());
  const hostControls = typeof controls === "function" ? controls({ edit }) : controls;

  return html`<div class=${`k-composer${bare ? " k-composer--bare" : ""}${isBusy ? " k-composer--busy" : ""}`}>
    ${!bare && menu}
    <div class="k-composer__box">
      ${(whoAgent || template) && html`<div class="k-composer__context">
        ${whoAgent && html`<span class="k-composer__to">
          <span class="k-composer__to-label">For</span>
          <${Avatar} slug=${whoAgent.slug} name=${whoAgent.name} size=${20} />
          <span>${text(whoAgent.name)}</span>
          <button type="button" class="k-composer__clear" aria-label=${`Do not give it to ${text(whoAgent.name)}`}
            onClick=${() => setWho(null)}><${Icon} name="cross" /></button>
        </span>`}
        ${template && html`<span class="k-composer__template"><${Icon} name="layers" /><span>Job</span></span>`}
      </div>`}
      <label class="u-visually-hidden" for=${ids.field}>What you want done</label>
      <textarea id=${ids.field} ref=${area} class="k-composer__field" rows="2" value=${value}
        placeholder=${phone && (!text(placeholder) || placeholder === DEFAULT_PLACEHOLDER) ? SHORT_PLACEHOLDER : text(placeholder) || DEFAULT_PLACEHOLDER} readOnly=${isBusy} aria-busy=${isBusy ? "true" : "false"}
        aria-autocomplete="list" aria-expanded=${open ? "true" : "false"}
        aria-controls=${open ? ids.list : undefined}
        aria-activedescendant=${open ? `${ids.list}-${current}` : undefined}
        onInput=${onInput} onKeyDown=${onKeyDown} onKeyUp=${track} onClick=${track}></textarea>
      ${bare && menu}
      ${bare && errorLine}
      <div class="k-composer__bar">
        ${allowPlanFirst && (bare
          ? html`<${Checkbox} class="k-composer__plan" label="Plan first" checked=${planFirst} disabled=${isBusy} onChange=${setPlanFirst} />`
          : html`<label class="k-composer__plan">
          <input type="checkbox" checked=${planFirst} disabled=${isBusy}
            onChange=${(e) => setPlanFirst(e.currentTarget.checked)} />
          <span>Plan first</span>
        </label>`)}
        ${hostControls && html`<span class="k-composer__controls">${hostControls}</span>`}
        ${keys
          ? html`<span class="k-composer__hint k-composer__keys" aria-hidden="true">${keys}</span>`
          : text(hint)
            ? html`<span class="k-composer__hint">${text(hint)}</span>`
            : html`<span class="k-composer__hint" aria-hidden="true"><${Kbd}>Enter<//> to send, <${Kbd}>Shift<//> + <${Kbd}>Enter<//> for a new line</span>`}
        ${text(sendLabel)
          ? html`<${Button} variant="primary" size="sm" class="k-composer__send-word" disabled=${!canSend && !isBusy} busy=${isBusy} onClick=${send}>${text(sendLabel)}<//>`
          : html`<button type="button" class="k-composer__send" aria-label=${isBusy ? "Sending" : "Send"}
          disabled=${!canSend} onClick=${send}><${Icon} name="send" /></button>`}
      </div>
      ${!bare && errorLine}
    </div>
  </div>`;
}
