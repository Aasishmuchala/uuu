// The money block: what a treatment costs against today's limit. Every figure comes from the numbers the home
// server sent (credits; one credit is one cent), written the way creditsDollars writes them. The server's own
// sentences are shown as sent, never reworded here.
import { html } from "../vendor/preact-htm.js";
import { cx } from "./util.js";

// "$1.50" for 150 credits, as shotlist.js's creditsDollars writes it (that file is the card's, so it is not imported).
const dollars = (c) => `$${(c / 100).toFixed(2)}`;
const credit = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const pct = (x) => Math.round(x * 1000) / 10;

// Labels the block shows for what the caller does not give. They are labels, not the server's sentences.
export const MONEY_WORDS = { about: "about", upTo: "up to", leftToday: "Left today", leftMonth: "Left this month", over: "Over today's limit", spent: "spent", limit: "limit" };

// n = { base, most, daily, dayLeft, monthly, monthLeft } in credits. null when the numbers cannot draw the meter.
export function moneyParts(n) {
  if (!n || typeof n !== "object" || !credit(n.base) || !credit(n.daily) || !credit(n.dayLeft)) return null;
  const spent = Math.max(0, n.daily - n.dayLeft);
  const scale = Math.max(n.daily, spent + n.base) || 1;
  const fits = Math.min(n.base, n.dayLeft);
  const over = Math.max(0, n.base - n.dayLeft);
  return {
    figure: dollars(n.base),
    upTo: credit(n.most) && n.most > n.base ? dollars(n.most) : null,
    spent: dollars(spent),
    limit: dollars(n.daily),
    left: dollars(n.dayLeft),
    overBy: over > 0 ? dollars(over) : null,
    month: credit(n.monthly) && credit(n.monthLeft) ? `${dollars(n.monthLeft)} of ${dollars(n.monthly)}` : null,
    shares: { spent: pct(spent / scale), fits: pct(fits / scale), over: pct(over / scale) },
    tick: pct(n.daily / scale),
    blocked: over > 0,
  };
}

const share = (x) => (typeof x === "number" && Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : 0);

// shares = { spent, fits, over } in percent; tick = where the limit is, in percent; legend = { spent, limit } words.
// The plain form (`plain`) is one --ink part, for "spent of approved": its width is shares.spent.
export function Meter({ shares, tick, legend, plain = false, label }) {
  const s = shares || {};
  const parts = plain
    ? [["k-meter__fill", share(s.spent)]]
    : [["k-meter__spent", share(s.spent)], ["k-meter__fits", share(s.fits)], ["k-meter__over", share(s.over)]];
  const t = !plain && typeof tick === "number" && Number.isFinite(tick) ? share(tick) : null;
  const name = label || (legend ? [legend.spent, legend.limit].filter(Boolean).join(", ") : undefined);
  return html`<div class=${cx("k-meter", plain && "k-meter--plain")} role="img" aria-label=${name}>
    <div class="k-meter__track">
      ${parts.filter(([, w]) => w > 0).map(([c, w]) => html`<i class=${c} style=${`width: ${w}%;`}></i>`)}
    </div>
    ${t !== null ? html`<b class="k-meter__tick" style=${`left: ${t}%;`}></b>` : null}
    ${legend
      ? html`<div class="k-meter__legend" aria-hidden="true">
          <span class="k-meter__legend-spent">${legend.spent}</span>
          ${legend.limit ? html`<span class=${cx("k-meter__legend-limit", t !== null && t < 50 && "k-meter__legend-limit--after")} style=${t !== null ? `left: ${t}%;` : undefined}>${legend.limit}</span>` : null}
        </div>`
      : null}
  </div>`;
}

// rows = [{ label, value, tone?: "bad" | "quiet" }]; every value sits on one right edge.
export function Sum({ rows }) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.value !== null && r.value !== undefined && r.value !== "");
  if (!list.length) return null;
  return html`<dl class="k-money__sum">
    ${list.map((r) => html`<div class=${cx("k-money__row", r.tone && `k-money__row--${r.tone}`)}><dt>${r.label}</dt><dd>${r.value}</dd></div>`)}
  </dl>`;
}

// label: "Treatment A costs". parts: moneyParts(...). words: the server's sentences, shown alone when parts is null.
// overWords: the caller's words for the over-the-limit row. The Meter's legend is made from parts.
export function MoneyBlock({ label, parts, words, overWords }) {
  const lines = (Array.isArray(words) ? words : words ? [words] : []).filter((w) => typeof w === "string" && w);
  if (!parts) {
    return html`<section class="k-money k-money--words">
      ${label ? html`<h3 class="k-money__label">${label}</h3>` : null}
      ${lines.map((w) => html`<p class="k-money__say">${w}</p>`)}
    </section>`;
  }
  const W = MONEY_WORDS;
  const legend = { spent: `${parts.spent} ${W.spent}`, limit: `${W.limit} ${parts.limit}` };
  const rows = [
    parts.overBy ? { label: overWords || W.over, value: parts.overBy, tone: "bad" } : null,
    { label: W.leftToday, value: parts.left },
    parts.month ? { label: W.leftMonth, value: parts.month, tone: "quiet" } : null,
  ].filter(Boolean);
  return html`<section class=${cx("k-money", parts.blocked && "k-money--over")}>
    ${label ? html`<h3 class="k-money__label">${label}</h3>` : null}
    <p class="k-money__figure"><span class="k-money__about">${W.about}</span><span class="k-money__amount">${parts.figure}</span></p>
    ${parts.upTo ? html`<p class="k-money__upto">${W.upTo} ${parts.upTo}</p>` : null}
    <${Meter} shares=${parts.shares} tick=${parts.tick} legend=${legend} />
    <${Sum} rows=${rows} />
  </section>`;
}
