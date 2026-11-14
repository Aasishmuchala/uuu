// The strip under a stage (PLAN-COOK T33, from the C3 mockup's "strip", "S02" and "S04"): one set of cards to choose
// from. OptionCards make a radio group (one is chosen; the arrows move the choice, Space and Enter take it);
// TakeCards are a plain row of pressable cards. Every picture address arrives already checked (R3); every string is text.
import { html, useEffect, useRef } from "../vendor/preact-htm.js";
import { Icon } from "./icon.js";
import { cx, isEmpty } from "./util.js";

const has = (v) => !isEmpty(v);
const TONES = ["good", "warn", "bad", "neutral"];
const MAX_BOARDS = 2;

// A state is { tone, text, icon } or plain words; it is drawn as the card's one chip.
function Chip({ state }) {
  if (!has(state)) return null;
  const s = typeof state === "object" && !Array.isArray(state) && !state.type ? state : { text: state };
  const tone = TONES.includes(s.tone) ? s.tone : "neutral";
  return html`<span class=${cx("k-strip__chip", `k-strip__chip--${tone}`)}>
    ${typeof s.icon === "string" ? html`<${Icon} name=${s.icon} size=${12} />` : null}<span>${s.text}</span>
  </span>`;
}

function Thumb({ src, alt, cls }) {
  return html`<span class=${cx("k-strip__thumb", cls)}>
    ${typeof src === "string" && src ? html`<img src=${src} alt=${typeof alt === "string" ? alt : ""} decoding="async" />` : null}
  </span>`;
}

// Moves the choice with the arrows: the next card takes focus and is picked.
function stripKeys(event) {
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 0, End: 0 };
  if (!(event.key in keys) || event.target?.getAttribute?.("role") !== "radio") return;
  const all = Array.from(event.currentTarget?.querySelectorAll?.('[role="radio"]') || []);
  const at = all.indexOf(event.target);
  if (at < 0 || !all.length) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? all.length - 1 : (at + keys[event.key] + all.length) % all.length;
  all[next].focus();
  all[next].click();
}

const listOf = (children) => (Array.isArray(children) ? children.flat(Infinity) : [children]);

export function Strip({ label, children }) {
  const ref = useRef(null);
  const radio = listOf(children).some((c) => c && c.type === OptionCard);
  // A radio group is one Tab stop: the chosen card, or the first when none is chosen yet.
  useEffect(() => {
    const el = ref.current;
    if (!radio || !el || !el.querySelector) return;
    if (!el.querySelector('[role="radio"][aria-checked="true"]')) {
      const first = el.querySelector('[role="radio"]');
      if (first) first.setAttribute("tabindex", "0");
    }
  });
  return html`<div ref=${ref} class=${cx("k-strip", radio ? "k-strip--radio" : "k-strip--row")}
    role=${radio ? "radiogroup" : "group"} aria-label=${label || undefined} onKeyDown=${radio ? stripKeys : undefined}>
    ${children}
  </div>`;
}

// A card with one picture puts it at the left, its amount beside its chip under the title, and its sentence across the
// card's foot; with many, the boards run along the top.
// `boards`: one picture ({ src, alt }) drawn at the card's left, or a list of them drawn as a row on top (each with
// `on` for the chosen one and `onClick` to choose it; past two, a "+n" tile). Anything else is drawn as given.
function Boards({ boards }) {
  if (!Array.isArray(boards)) return html`<div class="k-opt__boards">${boards}</div>`;
  const list = boards.filter((b) => b && typeof b === "object");
  const shown = list.length > MAX_BOARDS + 1 ? list.slice(0, MAX_BOARDS) : list;
  const extra = list.length - shown.length;
  return html`<div class="k-opt__boards">
    ${shown.map((b, i) => (b.onClick
      ? html`<button key=${i} type="button" class=${cx("k-opt__board", b.on && "k-opt__board--on")} aria-label=${b.label || undefined}
          aria-pressed=${b.on ? "true" : "false"} tabindex="-1" onClick=${b.onClick}><${Thumb} src=${b.src} alt=${b.alt} /></button>`
      : html`<span key=${i} class=${cx("k-opt__board", b.on && "k-opt__board--on")}><${Thumb} src=${b.src} alt=${b.alt} /></span>`))}
    ${extra > 0 ? html`<span class="k-opt__board k-opt__board--more" aria-label=${`${extra} more`}>+${extra}</span>` : null}
  </div>`;
}

export function OptionCard({ checked, onPick, title, amount, sub, state, say, boards }) {
  const one = Array.isArray(boards) && boards.filter(Boolean).length === 1 && !boards[0].onClick;
  const many = has(boards) && !one;
  const pick = () => onPick && onPick();
  const onKeyDown = (event) => {
    if (event.target !== event.currentTarget || (event.key !== " " && event.key !== "Enter")) return;
    event.preventDefault();
    pick();
  };
  return html`<div class=${cx("k-opt", one && "k-opt--side", many && "k-opt--top", checked && "k-opt--on")}
    role="radio" aria-checked=${checked ? "true" : "false"} tabindex=${checked ? "0" : "-1"} onClick=${pick} onKeyDown=${onKeyDown}>
    ${one ? html`<${Thumb} src=${boards[0].src} alt=${boards[0].alt} cls="k-opt__thumb" />` : null}
    ${many ? html`<${Boards} boards=${boards} />` : null}
    <div class="k-opt__body">
      <div class="k-opt__line">
        <span class="k-opt__radio" aria-hidden="true"></span>
        <span class="k-opt__title">${title}</span>
        ${has(amount) && !one ? html`<span class="k-opt__amount">${amount}</span>` : null}
      </div>
      ${one && has(sub) ? html`<div class="k-opt__line k-opt__line--sub"><span class="k-opt__sub">${sub}</span></div>` : null}
      ${has(state) || (one ? has(amount) : has(sub))
        ? html`<div class="k-opt__line k-opt__line--sub">
            ${one && has(amount) ? html`<span class="k-opt__amount k-opt__amount--left">${amount}</span>` : null}
            ${!one && has(sub) ? html`<span class="k-opt__sub">${sub}</span>` : null}
            <${Chip} state=${state} />
          </div>`
        : null}
    </div>
    ${has(say) ? html`<p class="k-opt__say">${say}</p>` : null}
  </div>`;
}

// A take of a shot: its still at 96 by 54, its name and cost, a line under, one chip. `thumb.making` dims the still
// while it is being made.
export function TakeCard({ pressed, thumb, title, amount, sub, state, onPick }) {
  const t = thumb && typeof thumb === "object" && !thumb.type ? thumb : null;
  return html`<button type="button" class=${cx("k-take", pressed && "k-take--on")} aria-pressed=${pressed ? "true" : "false"}
    onClick=${() => onPick && onPick()}>
    ${t ? html`<${Thumb} src=${t.src} alt=${t.alt} cls=${cx("k-take__thumb", t.making && "k-take__thumb--making")} />` : html`<span class="k-strip__thumb k-take__thumb">${thumb}</span>`}
    <span class="k-take__body">
      <span class="k-take__line">
        <span class="k-take__title">${title}</span>
        ${has(amount) ? html`<span class="k-take__amount">${amount}</span>` : null}
      </span>
      ${has(sub) ? html`<span class="k-take__sub">${sub}</span>` : null}
      <${Chip} state=${state} />
    </span>
  </button>`;
}
