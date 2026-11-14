// A small coloured mark plus a word: how every state is shown. Never colour alone.
import { html } from "../vendor/preact-htm.js";
import { Icon } from "./icon.js";
import { cx } from "./util.js";

const TONES = ["live", "ok", "wait", "warn", "bad", "off"];

// The word screen readers hear when no label is given.
const WORDS = { live: "Working", ok: "Done", wait: "Waiting", warn: "Waiting for you", bad: "Problem", off: "Off" };

export function StatusDot({ tone, label, pulse, hideLabel }) {
  const t = TONES.includes(tone) ? tone : "off";
  const moving = pulse === undefined ? t === "live" : Boolean(pulse);
  const text = label == null || label === "" ? WORDS[t] : label;
  const visible = !hideLabel && !(label == null || label === "");
  return html`<span class=${cx("k-dot", `k-dot--${t}`, moving && "k-dot--pulse")}>
    <span class="k-dot__mark" aria-hidden="true"></span>
    <span class=${visible ? "k-dot__label" : "k-sr"}>${text}</span>
  </span>`;
}

// The "waiting for you" mark.
export function Waiting({ hideLabel } = {}) {
  return html`<${StatusDot} tone="warn" label="Waiting for you" hideLabel=${hideLabel} />`;
}

// The live mark.
export function Live({ hideLabel } = {}) {
  return html`<${StatusDot} tone="live" label="Working" hideLabel=${hideLabel} />`;
}

// A state in a line: a 14 px glyph in the tone's colour and the words beside it. The words stay in the first ink
// unless the tone is good or bad. `icon` replaces the tone's own glyph.
const ST_TONES = ["neutral", "good", "warn", "bad", "info"];
const ST_ICONS = { neutral: null, good: "check", warn: "alert", bad: "cross", info: "info" };

export function St({ tone = "neutral", icon, children }) {
  const t = ST_TONES.includes(tone) ? tone : tone === "ok" ? "good" : "neutral";
  const glyph = typeof icon === "string" ? icon : ST_ICONS[t];
  return html`<span class=${cx("k-st", `k-st--${t}`)}>
    ${glyph ? html`<${Icon} name=${glyph} size=${14} />` : null}
    <span class="k-st__text">${children}</span>
  </span>`;
}
