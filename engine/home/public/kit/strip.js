// The strip under a stage (PLAN-COOK T33, from the C3 mockup's "strip", "S02" and "S04"): one set of cards to choose
// from. OptionCards make a radio group (one is chosen; the arrows move the choice, Space and Enter take it);
// TakeCards are a plain row of pressable cards. Every picture address arrives already checked (R3); every string is text.
import { html, useEffect, useRef } from "../vendor/preact-htm.js";
import { Icon } from "./icon.js";
import { cx, isEmpty } from "./util.js";

const has = (v) => !isEmpty(v);
const TONES = ["good", "warn", "bad", "neutral"];

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

// One picture at the card's left, always 72 by 48. `boards`: one picture ({ src, alt }), or a list of them: the
// card shows the chosen one (`on`), else the first, with a small tag on its corner saying how many there are (the
// stage has its own board picker, so the card draws no board buttons and a board's `onClick` is never called here).
// Anything else (a node) is drawn in the picture's place as given.
function pictureOf(boards) {
  if (!has(boards)) return null;
  if (!Array.isArray(boards)) {
    if (typeof boards === "object" && !boards.type && "src" in boards) return { board: boards, count: 1 };
    return { node: boards };
  }
  const list = boards.filter((b) => b && typeof b === "object");
  if (!list.length) return null;
  return { board: list.find((b) => b.on) || list[0], count: list.length };
}

function Picture({ pic }) {
  if (pic.node) return html`<span class="k-strip__thumb k-opt__thumb">${pic.node}</span>`;
  const { board, count } = pic;
  return html`<span class="k-opt__pic">
    <${Thumb} src=${board.src} alt=${board.alt} cls="k-opt__thumb" />
    ${count > 1 ? html`<span class="k-opt__count" aria-label=${`${count} boards`}>${count}</span>` : null}
  </span>`;
}

// Words for a `title` attribute: only plain text and numbers (a node keeps no tooltip).
const words = (v) => (typeof v === "string" || typeof v === "number" ? String(v) : undefined);

// An option card at about 96 to 110 px: the picture at the left; beside it the radio and the title, then the grey
// sub with the amount on the right edge; across the foot the one-line reason with the one chip on the same right
// edge. (At 264 px a card, the title with its amount, or the sub with the chip, do not fit one line beside the
// picture; this order keeps every title, amount, sub and chip whole and cuts only the reason.) A reader hears the
// chip before the reason; the reason is drawn first.
export function OptionCard({ checked, onPick, title, amount, sub, state, say, boards }) {
  const pic = pictureOf(boards);
  const pick = () => onPick && onPick();
  const onKeyDown = (event) => {
    if (event.target !== event.currentTarget || (event.key !== " " && event.key !== "Enter")) return;
    event.preventDefault();
    pick();
  };
  return html`<div class=${cx("k-opt", pic && "k-opt--side", checked && "k-opt--on")}
    role="radio" aria-checked=${checked ? "true" : "false"} tabindex=${checked ? "0" : "-1"} onClick=${pick} onKeyDown=${onKeyDown}>
    ${pic ? html`<${Picture} pic=${pic} />` : null}
    <div class="k-opt__line k-opt__line--head">
      <span class="k-opt__radio" aria-hidden="true"></span>
      <span class="k-opt__title" title=${words(title)}>${title}</span>
    </div>
    ${has(sub) || has(amount)
      ? html`<div class="k-opt__line k-opt__line--sub">
          ${has(sub) ? html`<span class="k-opt__sub" title=${words(sub)}>${sub}</span>` : null}
          ${has(amount) ? html`<span class="k-opt__amount">${amount}</span>` : null}
        </div>`
      : null}
    ${has(say) || has(state)
      ? html`<div class="k-opt__line k-opt__line--foot">
          <${Chip} state=${state} />
          ${has(say) ? html`<p class="k-opt__say" title=${words(say)}>${say}</p>` : null}
        </div>`
      : null}
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
