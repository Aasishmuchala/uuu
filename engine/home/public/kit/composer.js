// Where the owner says what should be done. CONTRACTS-V2 13.2. A text area pinned to the bottom of its container;
// "/" at the start of a line opens the ready-made goals, "@" opens the agents and sets who it is for; Enter sends,
// Shift+Enter makes a new line; a "Plan first" box when allowed. onSend({ text, to, planFirst, template }) -> promise.
import { html, useEffect, useMemo, useRef, useState } from "../vendor/preact-htm.js";
import { Avatar } from "./avatar.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { Kbd } from "./text.js";

export const DEFAULT_PLACEHOLDER = "Say what you want done.  /  for ready-made goals,  @  to pick who.";

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

function optionsFor(t, templates, agents) {
  if (!t) return [];
  const q = fold(t.query);
  if (t.kind === "/") {
    return (Array.isArray(templates) ? templates : [])
      .filter((g) => g && (!q || fold(g.title).includes(q) || fold(g.summary).includes(q) || fold(g.id).includes(q)))
      .slice(0, MAX_OPTIONS)
      .map((g) => ({ key: `/${g.id}`, kind: "/", value: g }));
  }
  return (Array.isArray(agents) ? agents : [])
    .filter((a) => a && a.slug && a.slug !== "you" && (!q || fold(a.name).includes(q) || fold(a.slug).includes(q)))
    .slice(0, MAX_OPTIONS)
    .map((a) => ({ key: `@${a.slug}`, kind: "@", value: a }));
}

let seq = 0;

export function Composer({
  placeholder = DEFAULT_PLACEHOLDER, onSend, to = null, agents = [], templates = [], allowPlanFirst = true,
  busy = false, autoFocus = false, initialText = "",
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
  const ids = useMemo(() => { seq += 1; return { list: `k-composer-list-${seq}`, field: `k-composer-field-${seq}` }; }, []);

  useEffect(() => { setWho(to || null); }, [to]);
  useEffect(() => { if (autoFocus && area.current) area.current.focus(); }, [autoFocus]);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);

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
    requestAnimationFrame(() => {
      const el = area.current;
      if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    });
  };

  const pick = (opt) => {
    if (!opt) return;
    if (opt.kind === "/") {
      const g = opt.value;
      setTemplate(text(g.id) || null);
      if (g.to) setWho(g.to);
      if (allowPlanFirst) setPlanFirst(!!g.planFirst);
      const insert = text(g.text);
      // A ready-made goal replaces the whole line it was picked from.
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

  return html`<div class=${`k-composer${isBusy ? " k-composer--busy" : ""}`}>
    ${open && html`<div class="k-composer__menu" id=${ids.list} role="listbox"
        aria-label=${t.kind === "/" ? "Ready-made goals" : "Agents"}>
      <p class="k-composer__menu-head">${t.kind === "/" ? "Ready-made goals" : "Give it to"}</p>
      ${options.map((o, i) => html`<button type="button" role="option" tabindex="-1" key=${o.key}
          id=${`${ids.list}-${i}`} aria-selected=${i === current ? "true" : "false"}
          class=${`k-composer__option${i === current ? " k-composer__option--active" : ""}`}
          onMouseDown=${(e) => e.preventDefault()} onClick=${() => pick(o)}>
        ${o.kind === "@"
          ? html`<${Avatar} slug=${o.value.slug} name=${o.value.name} size=${20} /><span class="k-composer__option-title">${text(o.value.name)}</span>`
          : html`<span class="k-composer__option-title">${text(o.value.title)}</span>
              ${o.value.summary && html`<span class="k-composer__option-hint">${text(o.value.summary)}</span>`}`}
      </button>`)}
    </div>`}
    <div class="k-composer__box">
      ${(whoAgent || template) && html`<div class="k-composer__context">
        ${whoAgent && html`<span class="k-composer__to">
          <span class="k-composer__to-label">For</span>
          <${Avatar} slug=${whoAgent.slug} name=${whoAgent.name} size=${20} />
          <span>${text(whoAgent.name)}</span>
          <button type="button" class="k-composer__clear" aria-label=${`Do not give it to ${text(whoAgent.name)}`}
            onClick=${() => setWho(null)}><${Icon} name="cross" /></button>
        </span>`}
        ${template && html`<span class="k-composer__template"><${Icon} name="layers" /><span>Ready-made goal</span></span>`}
      </div>`}
      <label class="u-visually-hidden" for=${ids.field}>What you want done</label>
      <textarea id=${ids.field} ref=${area} class="k-composer__field" rows="2" value=${value}
        placeholder=${text(placeholder) || DEFAULT_PLACEHOLDER} readOnly=${isBusy} aria-busy=${isBusy ? "true" : "false"}
        aria-autocomplete="list" aria-expanded=${open ? "true" : "false"}
        aria-controls=${open ? ids.list : undefined}
        aria-activedescendant=${open ? `${ids.list}-${current}` : undefined}
        onInput=${onInput} onKeyDown=${onKeyDown} onKeyUp=${track} onClick=${track}></textarea>
      <div class="k-composer__bar">
        ${allowPlanFirst && html`<label class="k-composer__plan">
          <input type="checkbox" checked=${planFirst} disabled=${isBusy}
            onChange=${(e) => setPlanFirst(e.currentTarget.checked)} />
          <span>Plan first</span>
        </label>`}
        <span class="k-composer__hint" aria-hidden="true"><${Kbd}>Enter<//> to send, <${Kbd}>Shift<//> + <${Kbd}>Enter<//> for a new line</span>
        <${Button} variant="primary" icon="send" busy=${isBusy} disabled=${isBusy || !value.trim()} onClick=${send}>Send<//>
      </div>
      ${error && html`<p class="k-composer__error" role="alert"><${Icon} name="alert" /><span>${error}</span></p>`}
    </div>
  </div>`;
}
