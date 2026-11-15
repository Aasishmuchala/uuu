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

// Where the limit's label sits against its tick: ending at the tick (it reads "up to here"), or from the tick onwards
// when the tick is near the start (so it never covers "spent"). It is held inside the bar's ends either way.
export function limitAt(t) {
  if (t === null || t === undefined) return null;
  return t < 40 ? "k-meter__legend-limit--after" : "k-meter__legend-limit--end";
}

// Whether the limit is the bar's own end (the treatment fits: the whole bar is today's limit). Then no tick is drawn
// past the round end; the label ends at the bar's end.
export const tickAtEnd = (t) => typeof t === "number" && t >= 99.5;

// The tick's left edge, held inside the bar: at 0 percent it starts at the bar's start, at 100 it ends at its end.
export function tickLeft(t) {
  return `calc(${t}% - ${Math.round(t * 2) / 100}px)`;
}

const share = (x) => (typeof x === "number" && Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : 0);

// shares = { spent, fits, over } in percent; tick = where the limit is, in percent; legend = { spent, limit } words.
// The plain form (`plain`) is one --ink part, for "spent of approved": its width is shares.spent.
// Two tones and the over part: what is spent, then this treatment from where spent ends, then the part over the limit
// drawn from the tick onwards only. Each part is laid at its own place (never pushed by a gap), so the over part
// starts at the tick exactly.
export function Meter({ shares, tick, legend, plain = false, label }) {
  const s = shares || {};
  const sp = share(s.spent);
  const fi = share(s.fits);
  const ov = share(s.over);
  const t = !plain && typeof tick === "number" && Number.isFinite(tick) ? share(tick) : null;
  const parts = plain
    ? [["k-meter__fill", 0, sp]]
    : [["k-meter__spent", 0, sp], ["k-meter__fits", sp, fi], ["k-meter__over", t !== null && ov > 0 ? t : sp + fi, ov]];
  const at = (c, x, w) => (x > 0 && c !== "k-meter__over"
    ? `left: calc(${x}% + 2px); width: max(0px, calc(${w}% - 2px));`
    : `left: ${x}%; width: ${w}%;`);
  const end = tickAtEnd(t);
  const name = label || (legend ? [legend.spent, legend.limit].filter(Boolean).join(", ") : undefined);
  const where = limitAt(t);
  const labelAt = t === null ? undefined
    : end ? "left: 100%;"
    : where === "k-meter__legend-limit--end" ? `left: calc(${tickLeft(t)} + 2px);` : `left: ${tickLeft(t)};`;
  return html`<div class=${cx("k-meter", plain && "k-meter--plain")} role="img" aria-label=${name}>
    <div class="k-meter__track">
      ${parts.filter(([, , w]) => w > 0).map(([c, x, w]) => html`<i class=${c} style=${at(c, x, w)}></i>`)}
    </div>
    ${t !== null && !end ? html`<b class="k-meter__tick" style=${`left: ${tickLeft(t)};`}></b>` : null}
    ${legend
      ? html`<div class="k-meter__legend" aria-hidden="true">
          <span class="k-meter__legend-spent">${legend.spent}</span>
          ${legend.limit ? html`<span class=${cx("k-meter__legend-limit", where)} style=${labelAt}>${legend.limit}</span>` : null}
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
// overWords: the caller's words for the over-the-limit row. The Meter's legend is made from parts. The figure and the
// most it may cost share one line; the over row is the one place the problem colour is used, on its figure only.
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
    <p class="k-money__figure"><span class="k-money__about">${W.about}</span><span class="k-money__amount">${parts.figure}</span>
      ${parts.upTo ? html`<span class="k-money__upto">${W.upTo} ${parts.upTo}</span>` : null}</p>
    <${Meter} shares=${parts.shares} tick=${parts.tick} legend=${legend} />
    <${Sum} rows=${rows} />
  </section>`;
}
